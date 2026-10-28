"""Offline URL/extraction regression tests; no provider dependencies or calls."""
import unittest

from public_urls import public_url, retrieved_pages


class PublicUrlTests(unittest.TestCase):
    def test_public_web_destinations_remain_usable(self):
        for url in ("https://directory.org/provider", "http://public.org:80/contact",
                    "https://public.org:443/contact?q=pantry", "https://8.8.8.8/",
                    "https://[2606:4700:4700::1111]/", "https://bücher.de/"):
            with self.subTest(url=url):
                self.assertTrue(public_url(url))

    def test_local_and_reserved_hosts_and_ip_spellings_are_rejected(self):
        for url in ("http://localhost/", "http://localhost./", "https://x.local/",
                    "https://metadata.google.internal/", "https://site.test/", "https://pantry.example/",
                    "https://127.0.0.1/", "https://192.168.1.1/", "https://169.254.169.254/",
                    "http://2130706433/", "http://127.1/", "http://0177.0.0.1/",
                    "http://0x7f000001/", "http://0x7f.0.0.1/", "https://[::1]/",
                    "https://[fc00::1]/", "http://[fe80::1%25eth0]/", "https://[::ffff:127.0.0.1]/"):
            with self.subTest(url=url):
                self.assertFalse(public_url(url))

    def test_credentials_ports_and_ambiguous_url_syntax_are_rejected(self):
        for url in ("https://user:pass@public.org/", "https://:pass@public.org/",
                    "https://public.org:8443/", "https://public.org:bad/", "file:///etc/passwd",
                    "javascript:alert(1)", "https://public.org/path\nother", "https://public.org/with space",
                    "https://public.org\\@private.org/", "https://public.org/" + "a" * 2048,
                    "http://[broken/", "https://singlehost/", None, 123):
            with self.subTest(url=url):
                self.assertFalse(public_url(url))

    def test_missing_or_empty_extraction_is_unavailable_not_checked_absence(self):
        urls = ["https://directory.org/a", "https://directory.org/b", "http://localhost/private"]
        data = [{"url": urls[0], "markdown": "A real directory excerpt."},
                {"url": urls[1], "markdown": " \n\t"}, {"url": urls[1], "markdown": None},
                {"url": "https://unrequested.org/", "markdown": "Unexpected page"},
                {"url": urls[2], "markdown": "Private content"}, "malformed"]
        self.assertEqual(retrieved_pages(data, urls), {urls[0]: "A real directory excerpt."})
        self.assertEqual(retrieved_pages(None, urls), {})


if __name__ == "__main__":
    unittest.main()
