import importlib.util
import unittest
from pathlib import Path
from urllib.parse import urlparse


MODULE_PATH = Path(__file__).resolve().parents[1] / "crawl_and_import.py"
SPEC = importlib.util.spec_from_file_location("crawl_and_import", MODULE_PATH)
CRAWLER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(CRAWLER)


class ZhihuCrawlerConfigTest(unittest.TestCase):
    def test_all_profile_tokens_have_stable_source_ids(self):
        expected = {
            "tian-qing-71-69": "zhihu-tianqing",
            "lemonround": "zhihu-lemonround",
            "fa-fa-1-94": "zhihu-fafa",
            "yuan-chao-yi-83": "zhihu-yuanchao",
            "tongsanpang": "zhihu-tongsanpang",
        }
        for token, source_id in expected.items():
            with self.subTest(token=token):
                self.assertEqual(
                    CRAWLER.source_id_for(f"https://www.zhihu.com/people/{token}/posts"),
                    source_id,
                )

    def test_three_year_cutoff_is_inclusive(self):
        source = {"since": "2023-07-14T00:00:00+08:00"}
        self.assertTrue(CRAWLER.before_source_cutoff({"published_at": "2023-07-13T15:59:59Z"}, source))
        self.assertFalse(CRAWLER.before_source_cutoff({"published_at": "2023-07-13T16:00:00Z"}, source))
        self.assertFalse(CRAWLER.before_source_cutoff({"published_at": "2026-07-14T00:00:00Z"}, source))

    def test_retired_csdn_source_is_not_mapped(self):
        self.assertNotEqual(
            CRAWLER.source_id_for("https://blog.csdn.net/v_JULY_v/article/details/1"),
            "csdn_july",
        )


class ArticleUrlFilterTest(unittest.TestCase):
    SEED = "https://newsletter.maartengrootendorst.com"

    def test_rejects_substack_comments_and_support(self):
        seed = self.SEED
        junk = [
            f"{seed}/p/a-visual-guide-to-mixture-of-experts/comment/85346723",
            f"{seed}/p/a-visual-guide-to-mixture-of-experts/comments",
            f"{seed}/p/support",
            f"{seed}/p/coming-soon",
            f"{seed}/subscribe",
            f"{seed}/about",
        ]
        for url in junk:
            with self.subTest(url=url):
                self.assertFalse(CRAWLER.looks_like_article(url, seed, strong=True))
                self.assertTrue(CRAWLER.is_non_article_path(urlparse(url).path))

    def test_keeps_real_posts_including_supporting_slug(self):
        cases = [
            (self.SEED, f"{self.SEED}/p/a-visual-guide-to-mixture-of-experts"),
            (self.SEED, f"{self.SEED}/p/a-visual-guide-to-diffusiongemma"),
            # slug 含 supporting 但不是 meta 段 support
            ("https://magazine.sebastianraschka.com", "https://magazine.sebastianraschka.com/p/supporting-ahead-of-ai"),
            ("https://qingkeai.online", "https://qingkeai.online/archives/AR-VLA"),
            ("https://karpathy.bearblog.dev", "https://karpathy.bearblog.dev/power-to-the-people/"),
        ]
        for seed, url in cases:
            with self.subTest(url=url):
                self.assertTrue(CRAWLER.looks_like_article(url, seed, strong=True))


class SecurityHelpersTest(unittest.TestCase):
    def test_sanitize_source_id_strips_unsafe_chars(self):
        self.assertEqual(CRAWLER.sanitize_source_id("Zhihu/Tian..Qing"), "zhihu_tian_qing")
        self.assertEqual(CRAWLER.sanitize_source_id("../etc/passwd"), "etc_passwd")
        self.assertEqual(CRAWLER.sanitize_source_id("ok-id_1"), "ok-id_1")
        self.assertEqual(CRAWLER.sanitize_source_id(""), "unknown")
        self.assertEqual(CRAWLER.sanitize_source_id("!!!"), "unknown")

    def test_canonical_url_rejects_file_and_javascript(self):
        self.assertEqual(CRAWLER.canonical_url("file:///etc/passwd"), "")
        self.assertEqual(CRAWLER.canonical_url("javascript:alert(1)"), "")
        self.assertEqual(CRAWLER.canonical_url("data:text/html,hi"), "")
        self.assertTrue(
            CRAWLER.canonical_url("https://example.com/p/hello").startswith("https://example.com/")
        )

    def test_assert_public_http_url_rejects_private_hosts(self):
        blocked = [
            "http://127.0.0.1/x",
            "https://localhost/admin",
            "http://10.0.0.5/secret",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://172.16.0.1/internal",
        ]
        for url in blocked:
            with self.subTest(url=url):
                self.assertEqual(CRAWLER.assert_public_http_url(url), "")
        ok = CRAWLER.assert_public_http_url("https://zhuanlan.zhihu.com/p/123")
        self.assertEqual(ok, "https://zhuanlan.zhihu.com/p/123")

    def test_url_key_normalizes_http_to_https(self):
        a = CRAWLER.url_key("http://Example.com/foo/")
        b = CRAWLER.url_key("https://example.com/foo")
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("https://"))


if __name__ == "__main__":
    unittest.main()
