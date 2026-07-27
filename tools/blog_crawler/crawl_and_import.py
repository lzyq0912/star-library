#!/usr/bin/env python3
"""QMReader 本地增量博客爬虫。

数据分层：
  - articles.jsonl：按 URL 去重的累计正文仓库
  - crawl-state.json：每个来源的发现、抓取和失败状态
  - non-blog-sources.json：从 Zen「博客」收藏中分出的非博客页面
  - markdown/<source-id>/：新增或更新文章的 Markdown 副本
  - reader/data/blog-crawl/source-icons.json：本地站点头像清单

默认只抓取累计仓库中没有的 URL；--refresh-existing 会重抓已存在正文。
知乎使用 --zhihu-export 导入已登录浏览器采集结果，不匿名请求受保护接口。
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import html as html_lib
import json
import re
import subprocess
import sys
import warnings
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

try:
    import httpx
    import yaml
    from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning
except ImportError:
    print("请先安装: pip install httpx beautifulsoup4 trafilatura pyyaml", file=sys.stderr)
    raise

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

try:
    import trafilatura
except ImportError:
    trafilatura = None

ROOT = Path(__file__).resolve().parents[2]
ZEN = ROOT.parent
PRESERVED = ZEN / "_preserved_blog_data"
DEFAULT_DATA_DIR = PRESERVED / "incremental"
DEFAULT_SEEDS = PRESERVED / "blog_sources.yaml"
DEFAULT_SAVED_PAGES = ZEN / "Web" / "saved-pages.json"
DEFAULT_BOOTSTRAP = PRESERVED / "jsonl" / "creator_contents_2026-07-13.jsonl"
DEFAULT_ICON_MANIFEST = ROOT / "data" / "blog-crawl" / "source-icons.json"
PUBLIC_ICON_DIR = ROOT / "public" / "source-icons"
PUBLIC_ARTICLE_IMAGE_DIR = ROOT / "public" / "article-images"
MAX_ARTICLE_IMAGE_BYTES = 80 * 1024 * 1024
RETIRED_SOURCE_IDS = {"csdn_july"}
ZHIHU_SOURCE_BY_TOKEN = {
    "tian-qing-71-69": "zhihu-tianqing",
    "lemonround": "zhihu-lemonround",
    "fa-fa-1-94": "zhihu-fafa",
    "yuan-chao-yi-83": "zhihu-yuanchao",
    "tongsanpang": "zhihu-tongsanpang",
    "hao-tian-87": "zhihu-haotian",
}

FEED_CANDIDATES = (
    "/feed", "/feed.xml", "/rss", "/rss.xml", "/atom.xml", "/index.xml",
    "/feeds/posts/default", "/blog/feed", "/blog/rss",
)
SITEMAP_CANDIDATES = ("/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml")
NON_BLOG_HOSTS = {"chapterpal.com", "github.com", "youtube.com", "feishu.cn", "larksuite.com"}
SKIP_PATH_PARTS = (
    "/tag/", "/tags/", "/category/", "/categories/", "/author/", "/authors/",
    "/search", "/login", "/signup", "/subscribe", "/about", "/privacy", "/terms",
    "/archives/index", "/assets/", "/static/", "/cdn-cgi/",
    "/comment/", "/comments/",
)
# 路径末段或中间段：评论页 / Support / 订阅落地页等，不是博文
# 注意：不要用 support 前缀匹配（保留 /p/supporting-ahead-of-ai 一类真文章）
NON_ARTICLE_SEGMENTS = {
    "comment", "comments", "support", "about", "privacy", "terms", "tos",
    "subscribe", "subscription", "coming-soon", "login", "signup", "sign-up",
    "account", "profile", "membership", "members", "recommend", "leaderboard",
    "shop", "store", "welcome", "contact", "donate", "pledge", "gift",
}
ASSET_RE = re.compile(r"\.(?:css|js|mjs|png|jpe?g|gif|svg|webp|ico|pdf|zip|xml|json)(?:$|\?)", re.I)
ARTICLE_PATH_RE = re.compile(
    r"/(?:posts?|blog|articles?|archives?|p|notes?|c)/|/(?:19|20)\d{2}/|\.html?$",
    re.I,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def normalized_host(url: str) -> str:
    try:
        return urlparse(url).hostname.lower().removeprefix("www.")
    except Exception:
        return ""


def canonical_url(url: str) -> str:
    try:
        p = urlparse(str(url).strip())
        if p.scheme not in {"http", "https"} or not p.netloc:
            return ""
        # 拒绝 javascript: / data: 等经 urlparse 误入的异常 netloc
        host = (p.hostname or "").lower()
        if not host or host in {"", "."}:
            return ""
        path = re.sub(r"/{2,}", "/", p.path or "/")
        return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", p.query, ""))
    except Exception:
        return ""


def is_private_or_local_host(hostname: str) -> bool:
    """请求前拒绝明显私网 / 环回 host（防 SSRF）。"""
    host = (hostname or "").strip().lower().removeprefix("[").removesuffix("]")
    if not host:
        return True
    if host in {"localhost", "127.0.0.1", "::1", "0.0.0.0", "metadata.google.internal"}:
        return True
    if host.endswith(".localhost") or host.endswith(".local"):
        return True
    if host.startswith("10.") or host.startswith("192.168.") or host.startswith("169.254."):
        return True
    # 172.16.0.0/12
    if host.startswith("172."):
        parts = host.split(".")
        if len(parts) >= 2 and parts[1].isdigit() and 16 <= int(parts[1]) <= 31:
            return True
    return False


def assert_public_http_url(url: str) -> str:
    """校验 http(s) 且 host 非私网；不通过返回空串。"""
    clean = canonical_url(url)
    if not clean:
        return ""
    try:
        host = urlparse(clean).hostname or ""
    except Exception:
        return ""
    if is_private_or_local_host(host):
        return ""
    return clean


def sanitize_source_id(raw: Any) -> str:
    text = re.sub(r"[^a-z0-9_-]+", "_", str(raw or "").lower()).strip("_")
    return text or "unknown"


def safe_under_root(root: Path, *parts: str) -> Path:
    """拼接路径并确保 resolve 后仍在 root 下（防 path traversal）。"""
    root_resolved = root.resolve()
    candidate = root_resolved.joinpath(*parts).resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError(f"path escapes root: {candidate}") from exc
    return candidate


def content_id(url: str) -> str:
    return hashlib.md5(canonical_url(url).encode("utf-8")).hexdigest()


def markdown_image_urls(markdown: str) -> list[tuple[int, int, str]]:
    """返回 Markdown 图片目标 URL 的字符区间，支持 URL 内的成对括号。"""
    text = str(markdown or "")
    found: list[tuple[int, int, str]] = []
    cursor = 0
    while True:
        start = text.find("![", cursor)
        if start < 0:
            break
        target_start = text.find("](", start + 2)
        if target_start < 0 or "\n" in text[start:target_start]:
            cursor = start + 2
            continue
        pos = target_start + 2
        while pos < len(text) and text[pos].isspace() and text[pos] != "\n":
            pos += 1
        if pos >= len(text) or text[pos] == "\n":
            cursor = target_start + 2
            continue
        if text[pos] == "<":
            end = text.find(">", pos + 1)
            if end >= 0:
                found.append((pos + 1, end, text[pos + 1:end]))
                cursor = end + 1
                continue
        depth = 1
        end = pos
        while end < len(text):
            char = text[end]
            if char == "\\":
                end += 2
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    break
            elif char == "\n":
                break
            end += 1
        if depth == 0:
            destination = text[pos:end].strip()
            # 可选标题不属于 URL；正文抽取器生成的 URL 本身不会含裸空格。
            url = re.split(r"\s+[\"']", destination, maxsplit=1)[0]
            found.append((pos, pos + len(url), url))
            cursor = end + 1
        else:
            cursor = target_start + 2
    return found


def url_key(url: str) -> str:
    clean = canonical_url(url)
    if not clean:
        return ""
    parsed = urlparse(clean)
    # 同 host 下 http/https 归一为 https，减少重复键（保留原 path/query）
    scheme = "https" if parsed.scheme in {"http", "https"} else parsed.scheme
    path = parsed.path.rstrip("/") if parsed.path not in {"", "/"} else parsed.path
    return urlunparse((scheme, parsed.netloc, path, "", parsed.query, ""))


def source_id_for(url: str, title: str = "") -> str:
    host = normalized_host(url)
    path = urlparse(url).path.lower()
    known = {
        "shichaoxin.com": "shichaoxin",
        "baoyu.io": "baoyu",
        "karpathy.bearblog.dev": "karpathy",
        "rlhfbook.com": "rlhfbook",
        "qingkeai.online": "qingkeai",
        "newsletter.maartengrootendorst.com": "maarten",
        "dwarkesh.com": "dwarkesh",
        "dwarkeshpatel.com": "dwarkesh",
        "arthurchiao.art": "arthurchiao",
        "aleksagordic.com": "aleksagordic",
        "gordicaleksa.medium.com": "aleksagordic",
        "normaluhr.github.io": "normaluhr",
        "magazine.sebastianraschka.com": "sebastianraschka",
        "lilianweng.github.io": "lilianweng",
    }
    if host == "zhihu.com":
        for token, source_id in ZHIHU_SOURCE_BY_TOKEN.items():
            if f"/people/{token}" in path:
                return source_id
    if host in known:
        return known[host]
    slug = re.sub(r"[^a-z0-9]+", "-", host).strip("-") or "saved-page"
    return "zen-" + slug[:48]


def is_non_blog(source: dict[str, Any]) -> bool:
    typ = str(source.get("type") or source.get("kind") or "").lower()
    if typ in {"other", "non-blog", "non_blog", "skip"}:
        return True
    host = normalized_host(str(source.get("url") or ""))
    return any(host == item or host.endswith("." + item) for item in NON_BLOG_HOSTS)


def load_sources(path: Path, saved_pages: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    raw: list[dict[str, Any]] = []
    if path.exists():
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if data is None:
            data = {}
        if not isinstance(data, dict):
            raise ValueError(
                f"种子文件 YAML 根节点必须是 mapping/dict，当前为 {type(data).__name__}: {path}"
            )
        raw = [item for item in data.get("sources", []) if isinstance(item, dict) and item.get("url")]
    elif saved_pages.exists():
        data = read_json(saved_pages, {})
        raw = [
            {"url": page.get("url"), "title": page.get("title", "")}
            for page in data.get("pages", [])
            if page.get("folder") == "博客" and page.get("url")
        ]

    blogs: list[dict[str, Any]] = []
    others: list[dict[str, Any]] = []
    for item in raw:
        source = dict(item)
        source["url"] = canonical_url(source["url"])
        if not source["url"]:
            continue
        raw_id = source.get("id") or source_id_for(source["url"], source.get("title", ""))
        source["id"] = sanitize_source_id(raw_id)
        source["title"] = str(source.get("title") or source["id"]).strip()
        if str(source.get("type") or "").lower() in {"local", "local-only", "local_only"}:
            continue
        if is_non_blog(source):
            source["type"] = "other"
            others.append(source)
        else:
            source["type"] = "blog"
            blogs.append(source)
    return blogs, others


def load_jsonl(path: Path) -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return items
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except Exception:
            continue
        url = canonical_url(item.get("url", ""))
        if url:
            item["url"] = url
            items[url_key(url)] = item
    return items


def write_jsonl(path: Path, items: dict[str, dict[str, Any]]) -> None:
    ordered = sorted(
        items.values(),
        key=lambda item: (str(item.get("published_at") or ""), str(item.get("crawled_at") or ""), item.get("url", "")),
        reverse=True,
    )
    atomic_write_text(path, "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in ordered))


def parsed_timestamp(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        raw = float(value)
        if raw > 10_000_000_000:
            raw /= 1000
        try:
            return datetime.fromtimestamp(raw, timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        return parsed_timestamp(float(text))
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def item_timestamp(item: dict[str, Any]) -> datetime | None:
    for key in ("published_at", "published", "created", "created_time", "updated", "updated_time"):
        parsed = parsed_timestamp(item.get(key))
        if parsed:
            return parsed
    return None


def source_cutoff(source: dict[str, Any]) -> datetime | None:
    return parsed_timestamp(source.get("since"))


def before_source_cutoff(item: dict[str, Any], source: dict[str, Any]) -> bool:
    cutoff = source_cutoff(source)
    published = item_timestamp(item)
    return bool(cutoff and published and published < cutoff)


class Crawler:
    def __init__(self, args: argparse.Namespace, catalog: dict[str, dict[str, Any]], state: dict[str, Any]):
        self.args = args
        self.catalog = catalog
        self.state = state
        self.catalog_path = Path(args.data_dir) / "articles.jsonl"
        self.state_path = Path(args.data_dir) / "crawl-state.json"
        self.markdown_dir = Path(args.data_dir) / "markdown"
        self.icon_manifest_path = Path(args.icon_manifest)
        self.icon_manifest = read_json(self.icon_manifest_path, {})
        self.zhihu_export = load_jsonl(Path(args.zhihu_export)) if args.zhihu_export else {}
        self.semaphore = asyncio.Semaphore(max(1, args.concurrency))
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(args.timeout),
            follow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36 ZenBlogCrawler/2.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )

    async def close(self) -> None:
        await self.client.aclose()

    async def fetch(self, url: str, *, binary: bool = False) -> tuple[int, str, bytes | str, str]:
        safe = assert_public_http_url(url)
        if not safe:
            return 0, url, b"" if binary else "", ""
        for attempt in range(3):
            try:
                async with self.semaphore:
                    response = await self.client.get(safe)
                # 跟随重定向后再次校验最终 URL，避免跳到私网
                final = str(response.url)
                if not assert_public_http_url(final):
                    return 0, final, b"" if binary else "", ""
                body: bytes | str = response.content if binary else response.text
                return response.status_code, final, body, response.headers.get("content-type", "")
            except Exception:
                if attempt == 2:
                    break
                await asyncio.sleep(0.7 * (attempt + 1))
        return 0, url, b"" if binary else "", ""

    async def discover_feed(self, seed: str, html: str) -> tuple[str, list[dict[str, str]]]:
        soup = BeautifulSoup(html or "", "html.parser")
        candidates: list[str] = []
        for link in soup.find_all("link", href=True):
            typ = str(link.get("type") or "").lower()
            rel = " ".join(link.get("rel") or []).lower()
            if "rss" in typ or "atom" in typ or "alternate" in rel and "xml" in typ:
                candidates.append(urljoin(seed, link["href"]))
        origin = f"{urlparse(seed).scheme}://{urlparse(seed).netloc}"
        candidates.extend(origin + path for path in FEED_CANDIDATES)
        seen: set[str] = set()
        for candidate in candidates[:16]:
            candidate = canonical_url(candidate)
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            status, final, body, _ = await self.fetch(candidate)
            if status < 200 or status >= 400 or not isinstance(body, str):
                continue
            items = parse_feed_xml(body, final)
            if items:
                return final, items
        return "", []

    async def discover_sitemaps(self, seed: str) -> tuple[list[str], list[str]]:
        origin = f"{urlparse(seed).scheme}://{urlparse(seed).netloc}"
        sitemap_urls: list[str] = []
        status, _, robots, _ = await self.fetch(origin + "/robots.txt")
        if 200 <= status < 400 and isinstance(robots, str):
            sitemap_urls.extend(re.findall(r"(?im)^\s*Sitemap:\s*(\S+)", robots))
        sitemap_urls.extend(origin + path for path in SITEMAP_CANDIDATES)
        queue = list(dict.fromkeys(canonical_url(item) for item in sitemap_urls if canonical_url(item)))
        checked: list[str] = []
        article_urls: list[str] = []
        max_urls = self.args.max_per_source if self.args.max_per_source > 0 else 2000
        while queue and len(checked) < 20 and len(article_urls) < max_urls:
            sitemap = queue.pop(0)
            if sitemap in checked:
                continue
            checked.append(sitemap)
            status, _, body, _ = await self.fetch(sitemap)
            if status < 200 or status >= 400 or not isinstance(body, str):
                continue
            child_maps, urls = parse_sitemap_xml(body)
            for child in child_maps:
                clean = canonical_url(child)
                if clean and clean not in checked and len(queue) < 30:
                    queue.append(clean)
            for url in urls:
                if same_site(seed, url) and looks_like_article(url, seed, strong=True):
                    article_urls.append(canonical_url(url))
                    if len(article_urls) >= max_urls:
                        break
        return checked, dedupe(article_urls)

    async def discover(self, source: dict[str, Any]) -> tuple[list[dict[str, str]], str, str]:
        seed = source["url"]
        if normalized_host(seed) == "zhihu.com":
            exported = [
                item for item in self.zhihu_export.values()
                if item.get("source_id") == source["id"] and not before_source_cutoff(item, source)
            ]
            exported.sort(key=lambda item: item_timestamp(item) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
            if exported:
                limit = self.args.max_per_source if self.args.max_per_source > 0 else 2000
                return [
                    {
                        "url": canonical_url(item.get("url", "")),
                        "title": str(item.get("title") or ""),
                        "published_at": str(item.get("published_at") or ""),
                    }
                    for item in exported[:limit]
                    if canonical_url(item.get("url", ""))
                ], "browser-export", ""
            print("  zhihu: 需要 --zhihu-export（已登录浏览器导出的 JSONL）", flush=True)
            return [], "", ""
        status, final, html, _ = await self.fetch(seed)
        if status < 200 or status >= 400 or not isinstance(html, str) or not html:
            return [{"url": seed, "title": source.get("title", ""), "published_at": ""}], "", ""
        base = final or seed
        feed_url, feed_items = await self.discover_feed(base, html)
        _, sitemap_urls = await self.discover_sitemaps(base)
        list_urls = extract_list_links(html, base, self.args.max_per_source or 2000)
        combined: list[dict[str, str]] = []
        by_url: set[str] = set()
        for item in feed_items:
            url = canonical_url(item.get("url", ""))
            if (
                url
                and same_site(seed, url)
                and url not in by_url
                and looks_like_article(url, seed, strong=True)
            ):
                by_url.add(url)
                combined.append({**item, "url": url})
        for url in sitemap_urls + list_urls:
            clean = canonical_url(url)
            if (
                clean
                and clean not in by_url
                and same_site(seed, clean)
                and looks_like_article(clean, seed, strong=True)
            ):
                by_url.add(clean)
                combined.append({"url": clean, "title": "", "published_at": ""})
        if not combined:
            # 种子本身若是列表首页，不强行当文章
            seed_url = canonical_url(base)
            if looks_like_article(seed_url, seed, strong=True):
                combined.append({"url": seed_url, "title": source.get("title", ""), "published_at": ""})
        limit = self.args.max_per_source if self.args.max_per_source > 0 else 2000
        return combined[:limit], feed_url, html

    async def download_icon(self, source: dict[str, Any], seed_html: str) -> str:
        if self.args.no_icons:
            return self.icon_manifest.get(source["id"], "")
        seed = source["url"]
        candidates: list[str] = []
        if seed_html:
            soup = BeautifulSoup(seed_html, "html.parser")
            weighted: list[tuple[int, str]] = []
            for link in soup.find_all("link", href=True):
                rel = " ".join(link.get("rel") or []).lower()
                if "icon" not in rel:
                    continue
                sizes = str(link.get("sizes") or "")
                match = re.search(r"(\d+)x(\d+)", sizes)
                size = max(int(match.group(1)), int(match.group(2))) if match else 16
                weighted.append((size, urljoin(seed, link["href"])))
            candidates.extend(url for _, url in sorted(weighted, reverse=True))
        origin = f"{urlparse(seed).scheme}://{urlparse(seed).netloc}"
        candidates.extend((origin + "/favicon.ico", "https://www.google.com/s2/favicons?domain=" + normalized_host(seed) + "&sz=128"))
        for candidate in dedupe(candidates):
            status, _, body, content_type = await self.fetch(candidate, binary=True)
            if status < 200 or status >= 400 or not isinstance(body, bytes) or not (32 <= len(body) <= 1024 * 1024):
                continue
            ext = image_extension(body, content_type, candidate)
            if not ext:
                continue
            try:
                target = safe_under_root(PUBLIC_ICON_DIR, f"{source['id']}.{ext}")
            except ValueError:
                continue
            PUBLIC_ICON_DIR.mkdir(parents=True, exist_ok=True)
            for old in PUBLIC_ICON_DIR.glob(source["id"] + ".*"):
                if old.suffix.lower() != "." + ext:
                    old.unlink(missing_ok=True)
            target.write_bytes(body)
            public_path = f"/source-icons/{target.name}"
            self.icon_manifest[source["id"]] = public_path
            atomic_write_text(self.icon_manifest_path, json.dumps(self.icon_manifest, ensure_ascii=False, indent=2) + "\n")
            return public_path
        return self.icon_manifest.get(source["id"], "")

    async def fetch_article(self, source: dict[str, Any], item: dict[str, str]) -> tuple[dict[str, Any] | None, str]:
        url = canonical_url(item["url"])
        if not url:
            return None, "invalid URL"
        if not looks_like_article(url, source["url"], strong=True):
            return None, "非文章页（评论/Support/列表等）"
        exported = self.zhihu_export.get(url_key(url))
        if exported and exported.get("source_id") == source["id"]:
            body = str(exported.get("content_md") or exported.get("content_text") or "")
            if len(re.sub(r"\s+", "", plain_text(body))) < 80:
                return None, "浏览器导出正文过短"
            # 知乎导出多为 HTML：抽 img 并本地化后再入库
            is_html = bool(exported.get("content_is_html")) or looks_like_html(body)
            if is_html:
                body = await self.localize_html_images(source, url, body)
            else:
                body = await self.localize_article_images(source, url, body)
            published_at = str(exported.get("published_at") or item.get("published_at") or "")
            post = {
                "content_id": str(exported.get("content_id") or content_id(url)),
                "source_id": source["id"],
                "title": str(exported.get("title") or item.get("title") or url).strip(),
                "url": url,
                "source_host": normalized_host(url),
                "source_seed": source["url"],
                "published_at": published_at,
                "content_md": body,
                "content_text": str(exported.get("content_text") or plain_text(body)),
                "excerpt": str(exported.get("excerpt") or plain_text(body))[:500],
                "crawled_at": str(exported.get("crawled_at") or utc_now()),
                "content_hash": hashlib.sha256(body.encode("utf-8")).hexdigest(),
            }
            if is_html:
                post["content_is_html"] = True
            return post, ""
        status, final, html, _ = await self.fetch(url)
        if status < 200 or status >= 400 or not isinstance(html, str) or not html:
            return None, f"HTTP {status}"
        final = canonical_url(final or url)
        extracted = extract_article(html, final)
        discovered_title = str(item.get("title") or "").strip()
        extracted_title = str(extracted.get("title") or "").strip()
        generic_titles = {"blog", "home", "karpathy", "untitled", source.get("title", "").strip().lower()}
        title = discovered_title if discovered_title and discovered_title.lower() not in generic_titles else extracted_title
        title = title or discovered_title or final
        body = extracted.get("content_md") or extracted.get("content_text") or ""
        body = await self.localize_article_images(source, final, body)
        if len(re.sub(r"\s+", "", body)) < 80 and final.rstrip("/") != source["url"].rstrip("/"):
            return None, "正文过短"
        now = utc_now()
        post = {
            "content_id": content_id(final),
            "source_id": source["id"],
            "title": title.strip(),
            "url": final,
            "source_host": normalized_host(final),
            "source_seed": source["url"],
            "published_at": extracted.get("published_at") or item.get("published_at") or "",
            "content_md": body,
            "content_text": extracted.get("content_text") or plain_text(body),
            "excerpt": (extracted.get("excerpt") or plain_text(body))[:500],
            "crawled_at": now,
            "content_hash": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        }
        return post, ""

    async def _download_article_image(
        self,
        source: dict[str, Any],
        article_folder: Path,
        remote: str,
    ) -> tuple[str, str]:
        """下载单张远程图到 article_folder；失败则返回原 URL。拒绝 SVG / 私网。"""
        if not assert_public_http_url(remote):
            return remote, remote
        asset_hash = hashlib.sha256(remote.encode("utf-8")).hexdigest()[:20]
        try:
            public_prefix = f"/article-images/{source['id']}/{article_folder.name}"
            if article_folder.exists():
                for existing in article_folder.glob(asset_hash + ".*"):
                    if existing.suffix.lower() == ".svg":
                        continue
                    return remote, f"{public_prefix}/{existing.name}"
        except Exception:
            pass
        candidates = [remote]
        parsed = urlparse(remote)
        # Halo 旧版青稞链接曾把原图改写为已失效的 thumbnail 路径；
        # 当前站点仍可通过 /upload/<文件名> 取得原图。
        thumbnail = re.search(r"/upload/thumbnails/(?:19|20)\d{2}/w\d+/(.+)$", parsed.path, re.I)
        if source["id"] == "qingkeai" and thumbnail:
            candidates.append("https://qingkeai.online/upload/" + thumbnail.group(1))
        for candidate in dedupe(candidates):
            if not assert_public_http_url(candidate):
                continue
            status, _, body, content_type = await self.fetch(candidate, binary=True)
            if (
                status < 200
                or status >= 400
                or not isinstance(body, bytes)
                or not (32 <= len(body) <= MAX_ARTICLE_IMAGE_BYTES)
            ):
                continue
            ext = image_extension(body, content_type, candidate)
            if not ext or ext == "svg":
                # 拒绝 SVG 落盘（XSS 面）
                continue
            try:
                target = safe_under_root(article_folder, f"{asset_hash}.{ext}")
            except ValueError:
                continue
            article_folder.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
            return remote, f"/article-images/{source['id']}/{article_folder.name}/{target.name}"
        return remote, remote

    def _article_image_folder(self, source: dict[str, Any], article_url: str) -> Path:
        sid = sanitize_source_id(source["id"])
        cid = content_id(article_url)[:16]
        return safe_under_root(PUBLIC_ARTICLE_IMAGE_DIR, sid, cid)

    async def localize_article_images(self, source: dict[str, Any], article_url: str, markdown: str) -> str:
        """下载正文图片并把 Markdown 图片地址替换为本地静态路径。"""
        raw = str(markdown or "")
        matches = markdown_image_urls(raw)
        if not matches:
            return raw

        def existing_local_path(value: str) -> str:
            clean = html_lib.unescape(str(value or "").strip())
            if clean.startswith("/article-images/"):
                return clean
            parsed = urlparse(clean)
            if parsed.path.startswith("/article-images/"):
                return parsed.path
            return ""

        remote_urls: list[str] = []
        for _, _, original in matches:
            if existing_local_path(original):
                continue
            remote = assert_public_http_url(urljoin(article_url, html_lib.unescape(original)))
            if remote and remote not in remote_urls:
                remote_urls.append(remote)
        # 极端页面可能把头像墙或推荐列表识别为正文；限制单篇资源数以免失控。
        remote_urls = remote_urls[:120]
        try:
            article_folder = self._article_image_folder(source, article_url)
        except ValueError:
            return raw

        gathered = await asyncio.gather(
            *(self._download_article_image(source, article_folder, url) for url in remote_urls),
            return_exceptions=True,
        )
        localized: dict[str, str] = {}
        for remote, result in zip(remote_urls, gathered):
            if isinstance(result, BaseException):
                localized[remote] = remote
            else:
                key, value = result
                localized[key] = value

        output = raw
        for start, end, original in reversed(matches):
            local = existing_local_path(original)
            remote = "" if local else assert_public_http_url(urljoin(article_url, html_lib.unescape(original)))
            if not remote and not local:
                remote = canonical_url(urljoin(article_url, html_lib.unescape(original))) or original
            src = local or localized.get(remote, remote or original)
            output = output[:start] + src + output[end:]
        return output

    async def localize_html_images(self, source: dict[str, Any], article_url: str, html: str) -> str:
        """从 HTML 抽 img/src（及 data-src/data-original），下载并替换为本地路径。"""
        raw = str(html or "")
        if not raw or "<" not in raw:
            return raw
        soup = BeautifulSoup(raw, "html.parser")
        img_nodes = soup.find_all("img")
        if not img_nodes:
            return raw

        def existing_local_path(value: str) -> str:
            clean = html_lib.unescape(str(value or "").strip())
            if clean.startswith("/article-images/"):
                return clean
            parsed = urlparse(clean)
            if parsed.path.startswith("/article-images/"):
                return parsed.path
            return ""

        def pick_src(node) -> str:
            for attr in ("src", "data-src", "data-original", "data-actualsrc", "data-lazy-src"):
                val = node.get(attr)
                if val and str(val).strip() and not str(val).strip().startswith("data:"):
                    return str(val).strip()
            return ""

        remote_urls: list[str] = []
        node_remotes: list[tuple[Any, str]] = []
        for node in img_nodes:
            original = pick_src(node)
            if not original:
                continue
            if existing_local_path(original):
                node["src"] = existing_local_path(original)
                continue
            remote = assert_public_http_url(urljoin(article_url, html_lib.unescape(original)))
            if not remote:
                continue
            node_remotes.append((node, remote))
            if remote not in remote_urls:
                remote_urls.append(remote)
        remote_urls = remote_urls[:120]
        if not remote_urls:
            return str(soup)

        try:
            article_folder = self._article_image_folder(source, article_url)
        except ValueError:
            return raw

        gathered = await asyncio.gather(
            *(self._download_article_image(source, article_folder, url) for url in remote_urls),
            return_exceptions=True,
        )
        localized: dict[str, str] = {}
        for remote, result in zip(remote_urls, gathered):
            if isinstance(result, BaseException):
                localized[remote] = remote
            else:
                key, value = result
                localized[key] = value

        for node, remote in node_remotes:
            local = localized.get(remote, remote)
            node["src"] = local
            # 清理懒加载残留，避免阅读器仍拉远程
            for attr in ("data-src", "data-original", "data-actualsrc", "data-lazy-src", "srcset"):
                if node.has_attr(attr):
                    del node[attr]
        return str(soup)

    def save_markdown(self, post: dict[str, Any]) -> None:
        body = post.get("content_md") or post.get("content_text") or ""
        if not body:
            return
        sid = sanitize_source_id(post.get("source_id") or "unknown")
        try:
            folder = safe_under_root(self.markdown_dir, sid)
        except ValueError:
            return
        folder.mkdir(parents=True, exist_ok=True)
        title = re.sub(r"[\\/:*?\"<>|\s]+", "_", post.get("title") or "").strip("._")[:90]
        cid = re.sub(r"[^a-f0-9]", "", str(post.get("content_id") or ""))[:8] or "unknown"
        name = f"{title or 'article'}_{cid}.md"
        # 文件名再过一遍 path 守卫
        try:
            target = safe_under_root(folder, name)
        except ValueError:
            return
        header = (
            f"# {post.get('title') or 'Untitled'}\n\n"
            f"- url: {post.get('url', '')}\n"
            f"- source: {sid}\n"
            f"- published: {post.get('published_at', '')}\n"
            f"- crawled: {post.get('crawled_at', '')}\n\n---\n\n"
        )
        atomic_write_text(target, header + body)

    def persist(self) -> None:
        write_jsonl(self.catalog_path, self.catalog)
        self.state["updated_at"] = utc_now()
        self.state["article_count"] = len(self.catalog)
        atomic_write_text(self.state_path, json.dumps(self.state, ensure_ascii=False, indent=2) + "\n")

    async def crawl_source(self, source: dict[str, Any]) -> dict[str, Any]:
        started = utc_now()
        print(f"\n[{source['id']}] {source['url']}", flush=True)
        discovered, feed_url, seed_html = await self.discover(source)
        if self.args.refresh_existing:
            known = {url_key(item.get("url", "")) for item in discovered}
            for post in self.catalog.values():
                url = canonical_url(post.get("url", ""))
                if (
                    not url
                    or url_key(url) in known
                    or not same_site(source["url"], url)
                    or not looks_like_article(url, source["url"], strong=True)
                ):
                    continue
                known.add(url_key(url))
                discovered.append({
                    "url": url,
                    "title": "",
                    "published_at": post.get("published_at", ""),
                })
        icon = await self.download_icon(source, seed_html)
        skipped_before_cutoff = sum(1 for item in discovered if before_source_cutoff(item, source))
        pending = [
            item for item in discovered
            if (self.args.refresh_existing or url_key(item["url"]) not in self.catalog)
            and (self.args.retry_failed or not self.recent_failure(item["url"]))
            and not before_source_cutoff(item, source)
            and looks_like_article(item["url"], source["url"], strong=True)
        ]
        print(f"  discovered={len(discovered)} pending={len(pending)} feed={feed_url or '-'} icon={icon or '-'}", flush=True)
        fetched = 0
        updated = 0
        errors: list[dict[str, str]] = []
        aborted = False
        batch_size = max(1, self.args.concurrency * 2)
        for offset in range(0, len(pending), batch_size):
            batch = pending[offset:offset + batch_size]
            results = await asyncio.gather(
                *(self.fetch_article(source, item) for item in batch),
                return_exceptions=True,
            )
            for item, result in zip(batch, results):
                if isinstance(result, BaseException):
                    post, error = None, f"exception: {result}"
                else:
                    post, error = result
                if post and before_source_cutoff(post, source):
                    skipped_before_cutoff += 1
                    continue
                if not post:
                    errors.append({"url": item["url"], "error": error})
                    failure = self.state.setdefault("failures", {}).get(url_key(item["url"]), {})
                    self.state["failures"][url_key(item["url"])] = {
                        "url": item["url"],
                        "source_id": source["id"],
                        "error": error,
                        "attempts": int(failure.get("attempts") or 0) + 1,
                        "last_at": utc_now(),
                    }
                    continue
                key = url_key(post["url"])
                previous = self.catalog.get(key)
                self.catalog[key] = post
                self.state.setdefault("failures", {}).pop(key, None)
                self.save_markdown(post)
                fetched += 1
                if previous and previous.get("content_hash") != post.get("content_hash"):
                    updated += 1
            self.persist()
            if offset + batch_size < len(pending):
                await asyncio.sleep(self.args.delay)
            print(f"  progress={min(offset + batch_size, len(pending))}/{len(pending)} saved={fetched} failed={len(errors)}", flush=True)
            if len(errors) >= self.args.max_failures_per_source and fetched < max(5, len(errors) // 5):
                aborted = True
                print(f"  circuit-break: failures={len(errors)} saved={fetched}; remaining URLs deferred", flush=True)
                break
        result = {
            "title": source.get("title", ""),
            "url": source["url"],
            "feed_url": feed_url,
            "icon": icon,
            "started_at": started,
            "finished_at": utc_now(),
            "discovered": len(discovered),
            "pending": len(pending),
            "fetched": fetched,
            "updated": updated,
            "failed": len(errors),
            "skipped_before_cutoff": skipped_before_cutoff,
            "aborted": aborted,
            "errors": errors[:50],
        }
        self.state.setdefault("sources", {})[source["id"]] = result
        self.persist()
        return result

    def recent_failure(self, url: str) -> bool:
        failure = self.state.get("failures", {}).get(url_key(url))
        if not failure or not failure.get("last_at"):
            return False
        try:
            last = datetime.fromisoformat(str(failure["last_at"]).replace("Z", "+00:00"))
        except Exception:
            return False
        return last >= datetime.now(timezone.utc) - timedelta(days=self.args.failure_retry_days)


def local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(element: ET.Element, names: set[str]) -> str:
    for child in list(element):
        if local_tag(child.tag) in names and child.text:
            return child.text.strip()
    return ""


def parse_feed_xml(content: str, base_url: str) -> list[dict[str, str]]:
    try:
        root = ET.fromstring(content.lstrip("\ufeff\n\r\t "))
    except Exception:
        return []
    items: list[dict[str, str]] = []
    for element in root.iter():
        if local_tag(element.tag) not in {"item", "entry"}:
            continue
        link = child_text(element, {"link"})
        if not link:
            for child in list(element):
                if local_tag(child.tag) == "link" and child.attrib.get("href"):
                    rel = child.attrib.get("rel", "alternate")
                    if rel in {"", "alternate"}:
                        link = child.attrib["href"]
                        break
        link = canonical_url(urljoin(base_url, html_lib.unescape(link)))
        if not link:
            continue
        title = html_lib.unescape(child_text(element, {"title"}))
        published = child_text(element, {"pubdate", "published", "updated", "date"})
        items.append({"url": link, "title": BeautifulSoup(title, "html.parser").get_text(" ", strip=True), "published_at": published})
    return dedupe_dicts(items, "url")


def parse_sitemap_xml(content: str) -> tuple[list[str], list[str]]:
    try:
        root = ET.fromstring(content.lstrip("\ufeff\n\r\t "))
    except Exception:
        return [], []
    is_index = local_tag(root.tag) == "sitemapindex"
    locs = [str(el.text or "").strip() for el in root.iter() if local_tag(el.tag) == "loc" and el.text]
    return (locs, []) if is_index else ([], locs)


def same_site(seed: str, url: str) -> bool:
    a = normalized_host(seed)
    b = normalized_host(url)
    if not a or not b:
        return False
    if a == b:
        return True
    return a.endswith("." + b) or b.endswith("." + a)


def is_non_article_path(path: str) -> bool:
    """评论、Support、订阅页等：sitemap 常混入，不能当博文入库。"""
    low = (path or "/").lower()
    if not low.startswith("/"):
        low = "/" + low
    stripped = low.rstrip("/") or "/"
    if stripped in {"/archive", "/archives", "/support", "/about", "/privacy", "/terms", "/subscribe"}:
        return True
    if re.search(r"/page/\d+/?$", low):
        return True
    if any(part in low for part in SKIP_PATH_PARTS):
        return True
    # /p/foo/comments、/p/foo/comment/123、/p/support、末段 meta slug
    segments = [segment for segment in stripped.split("/") if segment]
    if any(segment in NON_ARTICLE_SEGMENTS for segment in segments):
        return True
    # Substack 评论数字 id：…/comment/85346723（segment 已覆盖 comment）
    if re.search(r"/comments?(?:/|$)", low):
        return True
    return False


def looks_like_article(url: str, seed: str, *, strong: bool = False) -> bool:
    parsed = urlparse(url)
    path = parsed.path or "/"
    low = path.lower()
    if (
        path in {"", "/"}
        or low.rstrip("/").endswith(("/index", "/index.html", "/index.htm"))
        or ASSET_RE.search(url)
        or is_non_article_path(path)
    ):
        return False
    if canonical_url(url) == canonical_url(seed):
        return False
    if ARTICLE_PATH_RE.search(low):
        return True
    if strong:
        segments = [segment for segment in path.split("/") if segment]
        return bool(segments and len(segments[-1]) >= 7)
    return False


def extract_list_links(html: str, base_url: str, limit: int) -> list[str]:
    soup = BeautifulSoup(html or "", "html.parser")
    scored: list[tuple[int, str]] = []
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href") or "").strip()
        if not href or href.startswith(("#", "mailto:", "javascript:")):
            continue
        full = canonical_url(urljoin(base_url, href))
        if not full or not same_site(base_url, full) or not looks_like_article(full, base_url):
            continue
        text = anchor.get_text(" ", strip=True)
        score = 2 + (2 if re.search(r"/(?:19|20)\d{2}/", urlparse(full).path) else 0) + (1 if len(text) > 12 else 0)
        scored.append((score, full))
    scored.sort(key=lambda item: item[0], reverse=True)
    return dedupe(url for _, url in scored)[:limit]


def extract_page_event_times(html: str) -> set[str]:
    """页面上的直播/活动时间，不能当作文章发布时间（青稞 Talk 的 liveStartTime）。"""
    text = str(html or "")
    found: set[str] = set()
    for pattern in (
        r"liveStartTime:\s*['\"]([^'\"]+)['\"]",
        r"hotPostTime:\s*['\"]([^'\"]+)['\"]",
        r"data-live-start(?:-time)?=['\"]([^'\"]+)['\"]",
    ):
        for match in re.findall(pattern, text, flags=re.I):
            raw = str(match or "").strip()
            if not raw:
                continue
            found.add(raw)
            found.add(raw.replace("Z", "+00:00"))
            # 归一到日期，便于和 date-only 比较
            day = re.match(r"(\d{4}-\d{2}-\d{2})", raw)
            if day:
                found.add(day.group(1))
    return found


def normalize_published_candidate(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return text


def extract_article(html: str, url: str) -> dict[str, str]:
    title = ""
    content_md = ""
    content_text = ""
    published = ""
    excerpt = ""
    event_times = extract_page_event_times(html)
    if trafilatura:
        try:
            content_md = trafilatura.extract(
                html,
                url=url,
                include_comments=False,
                include_tables=True,
                include_links=True,
                include_images=True,
                output_format="markdown",
                with_metadata=True,
            ) or ""
            bare = trafilatura.bare_extraction(html, url=url, include_comments=False, include_tables=True)
            if bare:
                getter = bare.get if isinstance(bare, dict) else lambda key, default="": getattr(bare, key, default)
                title = getter("title", "") or ""
                published = getter("date", "") or ""
                content_text = getter("text", "") or ""
                excerpt = getter("description", "") or ""
        except Exception:
            pass
    soup = BeautifulSoup(html or "", "html.parser")
    # 正文抽取器经常把站点名或正文第一个 h1 当成标题。页面元数据和
    # document.title 对博客文章更可靠（Karpathy、青稞社区都属于这一类）。
    title_candidates: list[str] = []
    for selector in ('meta[property="og:title"]', 'meta[name="twitter:title"]'):
        meta = soup.select_one(selector)
        if meta and meta.get("content"):
            title_candidates.append(str(meta.get("content") or ""))
    if soup.title:
        title_candidates.append(soup.title.get_text(" ", strip=True))
    if title:
        title_candidates.append(title)
    h1 = soup.find("h1")
    if h1:
        title_candidates.append(h1.get_text(" ", strip=True))
    title = next((item.strip() for item in title_candidates if item and item.strip()), "")
    # 优先标准文章时间；排除 liveStartTime / hotPostTime 等活动时间
    meta_published = ""
    for selector, attr in (
        ('meta[property="article:published_time"]', "content"),
        ('meta[name="article:published_time"]', "content"),
        ('meta[property="og:published_time"]', "content"),
        ('time[datetime]', "datetime"),
    ):
        node = soup.select_one(selector)
        if node and node.get(attr):
            meta_published = str(node.get(attr) or "").strip()
            if meta_published:
                break
    if meta_published:
        published = meta_published
    if published:
        norm = normalize_published_candidate(published)
        day = norm[:10] if len(norm) >= 10 else ""
        if (
            published in event_times
            or norm in event_times
            or (day and day in event_times and re.search(r"T12:00:00", norm))
        ):
            published = ""
    if not content_text:
        article = soup.find("article") or soup.find("main") or soup.body
        if article:
            content_text = article.get_text("\n", strip=True)
    if not content_md:
        content_md = content_text
    return {
        "title": title,
        "content_md": content_md,
        "content_text": content_text or plain_text(content_md),
        "published_at": published,
        "excerpt": excerpt,
    }


def plain_text(value: str) -> str:
    text = BeautifulSoup(str(value or ""), "html.parser").get_text(" ", strip=True)
    text = re.sub(r"!\[[^]]*]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^]]+)]\([^)]*\)", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def dedupe(values) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def dedupe_dicts(values: list[dict[str, str]], key: str) -> list[dict[str, str]]:
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for value in values:
        marker = value.get(key, "")
        if marker and marker not in seen:
            seen.add(marker)
            out.append(value)
    return out


def looks_like_html(value: str) -> bool:
    """粗判：含标签即视作 HTML（知乎 API content 多为 HTML）。"""
    text = str(value or "").strip()
    if not text or "<" not in text:
        return False
    return bool(re.search(r"<\s*(?:p|div|img|br|h[1-6]|span|a|ul|ol|li|figure|table|section|article)\b", text, re.I))


def image_extension(body: bytes, content_type: str, url: str) -> str:
    typ = content_type.lower()
    if body.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if body.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if body.startswith((b"RIFF",)) and body[8:12] == b"WEBP":
        return "webp"
    if body.startswith(b"\x00\x00\x01\x00"):
        return "ico"
    if body.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if len(body) >= 12 and body[4:12] in {b"ftypavif", b"ftypavis"}:
        return "avif"
    # 可识别 SVG，但下载落盘路径会跳过（见 _download_article_image）
    if b"<svg" in body[:1024].lower():
        return "svg"
    if "image/png" in typ:
        return "png"
    if "image/jpeg" in typ:
        return "jpg"
    if "image/webp" in typ:
        return "webp"
    if "image/gif" in typ:
        return "gif"
    if "image/avif" in typ:
        return "avif"
    if "image/svg+xml" in typ:
        return "svg"
    if "image/x-icon" in typ or "image/vnd.microsoft.icon" in typ or urlparse(url).path.lower().endswith(".ico"):
        return "ico"
    return ""


async def main_async(args: argparse.Namespace) -> int:
    blogs, others = load_sources(Path(args.seeds_file), Path(args.saved_pages))
    if args.source:
        wanted = set(args.source)
        blogs = [source for source in blogs if source["id"] in wanted or source["url"] in wanted]
    if not blogs:
        print("没有可爬取的博客来源", file=sys.stderr)
        return 1

    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    non_blog_path = data_dir / "non-blog-sources.json"
    atomic_write_text(non_blog_path, json.dumps({"updated_at": utc_now(), "sources": others}, ensure_ascii=False, indent=2) + "\n")

    catalog_path = data_dir / "articles.jsonl"
    catalog = {
        key: item for key, item in load_jsonl(catalog_path).items()
        if item.get("source_id") not in RETIRED_SOURCE_IDS and normalized_host(item.get("url", "")) != "blog.csdn.net"
    }
    bootstrap = Path(args.bootstrap)
    if bootstrap.exists():
        before = len(catalog)
        for url, item in load_jsonl(bootstrap).items():
            if item.get("source_id") in RETIRED_SOURCE_IDS or normalized_host(item.get("url", "")) == "blog.csdn.net":
                continue
            catalog.setdefault(url, item)
        if len(catalog) != before:
            write_jsonl(catalog_path, catalog)
            print(f"[bootstrap] {before} -> {len(catalog)} articles")
    state = read_json(data_dir / "crawl-state.json", {"version": 2, "sources": {}})
    crawler = Crawler(args, catalog, state)
    results: list[dict[str, Any]] = []
    try:
        for source in blogs:
            results.append(await crawler.crawl_source(source))
    finally:
        crawler.persist()
        await crawler.close()

    summary = {
        "finished_at": utc_now(),
        "blog_sources": len(blogs),
        "non_blog_sources": len(others),
        "articles": len(crawler.catalog),
        "fetched": sum(item["fetched"] for item in results),
        "failed": sum(item["failed"] for item in results),
    }
    atomic_write_text(data_dir / "last-run.json", json.dumps({**summary, "sources": results}, ensure_ascii=False, indent=2) + "\n")
    print("\n[done] " + json.dumps(summary, ensure_ascii=False), flush=True)

    if args.import_qm:
        importer = ROOT / "scripts" / "import-preserved-blog.js"
        subprocess.check_call(["node", str(importer), str(catalog_path)], cwd=str(ROOT))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="QMReader 增量博客爬虫")
    parser.add_argument("--seeds-file", default=str(DEFAULT_SEEDS))
    parser.add_argument("--saved-pages", default=str(DEFAULT_SAVED_PAGES))
    parser.add_argument("--data-dir", default=str(DEFAULT_DATA_DIR))
    parser.add_argument("--bootstrap", default=str(DEFAULT_BOOTSTRAP))
    parser.add_argument("--icon-manifest", default=str(DEFAULT_ICON_MANIFEST))
    parser.add_argument("--zhihu-export", default="", help="已登录浏览器导出的知乎 JSONL；知乎源不会匿名直抓")
    parser.add_argument("--source", action="append", default=[], help="只抓指定来源 id 或 URL")
    parser.add_argument("--max-per-source", type=int, default=0, help="每来源最多发现数；0 表示尽量全部（安全上限 2000）")
    parser.add_argument("--refresh-existing", action="store_true", help="重抓已存在 URL；默认只抓新增")
    parser.add_argument("--retry-failed", action="store_true", help="忽略失败冷却期并立即重试")
    parser.add_argument("--import-qm", action="store_true", help="完成后导入 QMReader")
    parser.add_argument("--no-icons", action="store_true")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--delay", type=float, default=0.35)
    parser.add_argument("--timeout", type=float, default=25.0)
    parser.add_argument("--max-failures-per-source", type=int, default=80)
    parser.add_argument("--failure-retry-days", type=int, default=7)
    return asyncio.run(main_async(parser.parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
