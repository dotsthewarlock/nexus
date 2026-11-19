"""Compatibility probe tests without network requests."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location(
    'probe_browser_access', Path(__file__).resolve().parents[1]/'scripts'/'probe_browser_access.py')
probe=importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class BrowserAccessProbeTests(unittest.TestCase):
    def test_cors_headers(self):
        self.assertTrue(probe.cors_permitted('*'))
        self.assertTrue(probe.cors_permitted(probe.ORIGIN))
        self.assertFalse(probe.cors_permitted(None))
        self.assertFalse(probe.cors_permitted('https://unrelated.example'))
        self.assertFalse(probe.cors_permitted('null'))

    def test_only_public_unkeyed_border_feeds(self):
        self.assertEqual(set(probe.FEEDS), {'CBP', 'CBSA'})
        for url in probe.FEEDS.values():
            self.assertNotIn('key=', url)
            self.assertTrue(url.startswith('https://'))


if __name__ == '__main__':
    unittest.main()
