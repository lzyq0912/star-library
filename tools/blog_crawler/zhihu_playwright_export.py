#!/usr/bin/env python3
"""用 Playwright 请求上下文 + Zen Cookie，经知乎官方 API 导出专栏 JSONL。

页面列表常被「系统繁忙」拦截，因此走 /api/v4/members/{token}/articles。
不读取账号密码；Cookie 仅从本机 Zen 配置文件离线拷贝读取，导出文件不含 Cookie。
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

PROFILES = [
    {
        "source_id": "zhihu-tianqing",
        "token": "tian-qing-71-69",
        "url": "https://www.zhihu.com/people/tian-qing-71-69/posts",
    },
    {
        "source_id": "zhihu-lemonround",
        "token": "lemonround",
        "url": "https://www.zhihu.com/people/lemonround/posts",
    },
    {
        "source_id": "zhihu-fafa",
        "token": "fa-fa-1-94",
        "url": "https://www.zhihu.com/people/fa-fa-1-94/posts",
    },
    {
        "source_id": "zhihu-yuanchao",
        "token": "yuan-chao-yi-83",
        "url": "https://www.zhihu.com/people/yuan-chao-yi-83/posts",
    },
    {
        "source_id": "zhihu-tongsanpang",
        "token": "tongsanpang",
        "url": "https://www.zhihu.com/people/tongsanpang/posts",
    },
    {
        "source_id": "zhihu-haotian",
        "token": "hao-tian-87",
        "url": "https://www.zhihu.com/people/hao-tian-87/posts",
        # 该作者需要导入全部文章：cutoff=None 表示不做「近三年」裁剪
        "cutoff": None,
    },
]
# 默认仅保留近三年（各 profile 可用 "cutoff" 覆盖：数字=时间戳；None=不裁剪）
CUTOFF = datetime.fromisoformat("2023-07-14T00:00:00+08:00")
CUTOFF_TS = int(CUTOFF.timestamp())


def profile_cutoff_ts(profile: dict[str, Any]) -> int | None:
    """返回该 profile 的时间戳下限；缺省用全局 CUTOFF_TS，显式 None 表示不裁剪。"""
    if "cutoff" in profile:
        return profile["cutoff"]
    return CUTOFF_TS


def default_zen_profile() -> Path:
    """默认 Zen profile 不再硬编码，从环境变量 ZHIHU_ZEN_PROFILE 读取。"""
    try:
        return Path(os.environ["ZHIHU_ZEN_PROFILE"])
    except KeyError as exc:
        raise SystemExit(
            "缺少 Zen profile：请设置环境变量 ZHIHU_ZEN_PROFILE"
            "（Zen/Firefox profile 目录路径），或用 --zen-profile 显式指定"
        ) from exc
# content 字段已包含正文；其余字段用于元数据
ARTICLES_INCLUDE = (
    "data[*].comment_count,suggest_edit,is_normal,thumbnail_extra_info,thumbnail,"
    "can_comment,comment_permission,admin_closed_comment,content,voteup_count,"
    "created,updated,upvoted_followees,voting,review_info,is_labeled,label_info;"
    "data[*].author.badge[?(type=best_answerer)].topics"
)


def plain_text(html: str) -> str:
    text = re.sub(r"<script[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<style[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def load_zen_zhihu_cookies(profile: Path) -> list[dict[str, Any]]:
    if not profile.exists():
        raise FileNotFoundError(f"Zen profile not found: {profile}")
    with tempfile.TemporaryDirectory(prefix="zen-cookies-") as tmp:
        tmp_path = Path(tmp)
        for name in ("cookies.sqlite", "cookies.sqlite-wal", "cookies.sqlite-shm"):
            src = profile / name
            if src.exists():
                shutil.copy2(src, tmp_path / name)
        db = tmp_path / "cookies.sqlite"
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            rows = conn.execute(
                """
                SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite
                FROM moz_cookies
                WHERE host LIKE '%zhihu%'
                """
            ).fetchall()
        finally:
            conn.close()

    cookies: list[dict[str, Any]] = []
    now = int(time.time())
    for name, value, host, path, expiry, is_secure, is_http_only, same_site in rows:
        if not name or value is None:
            continue
        exp = int(expiry or 0)
        if exp > 10_000_000_000:
            exp //= 1000
        if exp and exp < now:
            continue
        cookie: dict[str, Any] = {
            "name": str(name),
            "value": str(value),
            "domain": str(host),
            "path": path or "/",
            "secure": bool(is_secure),
            "httpOnly": bool(is_http_only),
        }
        if exp > 0:
            cookie["expires"] = exp
        ss = str(same_site or "").lower()
        if ss in {"no_restriction", "none"}:
            cookie["sameSite"] = "None"
        elif ss in {"lax", "strict"}:
            cookie["sameSite"] = ss.capitalize()
        cookies.append(cookie)
    if not any(c["name"] == "z_c0" for c in cookies):
        raise RuntimeError("Zen Cookie 中未找到 z_c0，请先在 Zen 登录知乎")
    return cookies


def normalize_article_url(raw: str, article_id: Any) -> str:
    if raw:
        try:
            parsed = urlparse(str(raw).strip())
            match = re.search(r"/p/(\d+)", parsed.path or "")
            if match:
                return f"https://zhuanlan.zhihu.com/p/{match.group(1)}"
        except Exception:
            pass
    if article_id is not None and str(article_id).isdigit():
        return f"https://zhuanlan.zhihu.com/p/{article_id}"
    return ""


def item_to_post(item: dict[str, Any], profile: dict[str, str]) -> dict[str, Any] | None:
    created = safe_int(item.get("created") or item.get("created_time") or 0)
    cutoff_ts = profile_cutoff_ts(profile)
    if cutoff_ts is not None and created and created < cutoff_ts:
        return None
    content = str(item.get("content") or "")
    text = plain_text(content)
    if len(re.sub(r"\s+", "", text)) < 80:
        return None
    url = normalize_article_url(str(item.get("url") or ""), item.get("id"))
    if not url:
        return None
    published_at = (
        datetime.fromtimestamp(created, timezone.utc).isoformat().replace("+00:00", "Z")
        if created
        else ""
    )
    if not published_at:
        return None
    title = str(item.get("title") or url).strip()
    post: dict[str, Any] = {
        "source_id": profile["source_id"],
        "title": title,
        "url": url,
        "source_host": "zhuanlan.zhihu.com",
        "source_seed": profile["url"],
        "published_at": published_at,
        "content_md": content,
        "content_text": text,
        "excerpt": text[:500],
        "crawled_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    # 知乎 API content 多为 HTML；标记供 import 侧走 HTML 图片本地化
    if "<" in content:
        post["content_is_html"] = True
    return post


def fetch_member_articles(context, profile: dict[str, str], delay: float, max_items: int) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    posts: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    offset = 0
    limit = 20
    seen_urls: set[str] = set()
    cutoff_ts = profile_cutoff_ts(profile)
    while True:
        query = urlencode(
            {
                "include": ARTICLES_INCLUDE,
                "offset": offset,
                "limit": limit,
                "sort_by": "created",
            }
        )
        api = f"https://www.zhihu.com/api/v4/members/{profile['token']}/articles?{query}"
        resp = context.request.get(api, timeout=60000)
        if not resp.ok:
            failures.append({"url": api, "error": f"HTTP {resp.status}"})
            break
        try:
            payload = resp.json()
        except Exception as exc:  # noqa: BLE001
            failures.append({"url": api, "error": f"json: {exc}"})
            break

        data = payload.get("data") or []
        if not data:
            break

        hit_old = False
        for item in data:
            if not isinstance(item, dict):
                continue
            created = safe_int(item.get("created") or item.get("created_time") or 0)
            if cutoff_ts is not None and created and created < cutoff_ts:
                hit_old = True
                continue
            try:
                post = item_to_post(item, profile)
            except Exception as exc:  # noqa: BLE001
                failures.append({"url": str(item.get("url") or item.get("id")), "error": str(exc)})
                continue
            if not post:
                continue
            if post["url"] in seen_urls:
                continue
            seen_urls.add(post["url"])
            posts.append(post)
            if max_items > 0 and len(posts) >= max_items:
                return posts, failures

        paging = payload.get("paging") or {}
        is_end = bool(paging.get("is_end"))
        offset += len(data)
        print(
            f"  {profile['source_id']} offset={offset} kept={len(posts)} "
            f"totals={paging.get('totals')} is_end={is_end}",
            flush=True,
        )
        if is_end or hit_old:
            break
        time.sleep(delay)
    return posts, failures


def run(args: argparse.Namespace) -> int:
    from playwright.sync_api import sync_playwright

    cookies = load_zen_zhihu_cookies(Path(args.zen_profile))
    print(f"[zhihu] loaded {len(cookies)} cookies from Zen profile", flush=True)

    selected = PROFILES
    if args.source:
        wanted = set(args.source)
        selected = [p for p in PROFILES if p["source_id"] in wanted]
        if not selected:
            raise SystemExit(f"未知 source: {args.source}")

    all_posts: list[dict[str, Any]] = []
    all_failures: list[dict[str, str]] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        try:
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/122.0.0.0 Safari/537.36"
                ),
                locale="zh-CN",
                viewport={"width": 1280, "height": 900},
                extra_http_headers={
                    "Referer": "https://www.zhihu.com/",
                    "Accept": "application/json, text/plain, */*",
                    "X-Requested-With": "fetch",
                },
            )
            context.add_cookies(cookies)
            page = context.new_page()
            page.goto("https://www.zhihu.com", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(800)
            if "/signin" in page.url:
                raise RuntimeError(f"Cookie 无效，当前在登录页: {page.url}")

            remaining = args.max_articles if args.max_articles > 0 else 0
            for profile in selected:
                print(f"[zhihu] fetch {profile['source_id']} ({profile['token']}) ...", flush=True)
                limit = remaining if remaining > 0 else 0
                posts, failures = fetch_member_articles(context, profile, args.delay, limit)
                print(f"[zhihu] {profile['source_id']}: kept={len(posts)} failed={len(failures)}", flush=True)
                all_posts.extend(posts)
                all_failures.extend(failures)
                if remaining > 0:
                    remaining -= len(posts)
                    if remaining <= 0:
                        break
                time.sleep(args.delay)
        finally:
            browser.close()

    # 去重
    unique = list({f"{p['source_id']}|{p['url']}": p for p in all_posts}.values())
    unique.sort(key=lambda p: p.get("published_at") or "", reverse=True)

    out = Path(args.output).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        "".join(json.dumps(post, ensure_ascii=False) + "\n" for post in unique),
        encoding="utf-8",
    )
    print(f"[zhihu] wrote {len(unique)} posts -> {out}", flush=True)
    if all_failures:
        print(f"[zhihu] failures={len(all_failures)} sample={all_failures[:5]}", flush=True)

    by_source: dict[str, int] = {}
    for post in unique:
        by_source[post["source_id"]] = by_source.get(post["source_id"], 0) + 1
    print("[zhihu] by source:", by_source, flush=True)
    if unique:
        return 0
    if getattr(args, "allow_empty", False):
        print("[zhihu] empty export allowed (--allow-empty)", flush=True)
        return 0
    return 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Zhihu posts via API + Zen cookies")
    default_output = os.environ.get("ZHIHU_EXPORT_PATH") or str(
        Path.home() / "Downloads" / "zhihu-browser-export.jsonl"
    )
    parser.add_argument("--zen-profile", default="")
    parser.add_argument(
        "--output",
        default=default_output,
    )
    parser.add_argument("--source", action="append", default=[], help="Limit to source_id")
    parser.add_argument("--delay", type=float, default=0.45, help="Delay between API pages")
    parser.add_argument("--max-articles", type=int, default=0, help="0 = all after cutoff")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Exit 0 when 0 posts (for cron/auto jobs)",
    )
    args = parser.parse_args()
    if not args.zen_profile:
        # 未显式传 --zen-profile 时回落到环境变量；缺失会给出清晰报错
        args.zen_profile = str(default_zen_profile())
    raise SystemExit(run(args))


if __name__ == "__main__":
    main()
