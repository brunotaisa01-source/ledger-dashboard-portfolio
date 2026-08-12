import unittest

from scripts.synthetic_e2e import ROOT, run_pipeline, scan_text


class SyntheticContractTest(unittest.TestCase):
    def test_encoding_gate_rejects_c0_controls(self):
        coverage = {"text": 0, "json": 0, "workbook": 0, "sqlite": 0, "binary": 0, "screenshots": 0, "unknown": 0}
        for codepoint in (0x00, 0x07, 0x0B, 0x1F):
            findings = []
            scan_text(ROOT / "synthetic-control-fixture.txt", b"clean" + bytes([codepoint]), coverage, findings)
            self.assertTrue(findings, f"C0 U+{codepoint:04X} was accepted")

    def test_encoding_gate_allows_valid_utf8_unicode(self):
        coverage = {"text": 0, "json": 0, "workbook": 0, "sqlite": 0, "binary": 0, "screenshots": 0, "unknown": 0}
        findings = []
        scan_text(ROOT / "synthetic-unicode-fixture.txt", "café — ✅".encode("utf-8"), coverage, findings)
        self.assertEqual(findings, [])

    def test_end_to_end_contract(self):
        result = run_pipeline(write_manifest=False)
        self.assertEqual(result["stages"]["load"], "GREEN", result["errors"])
        self.assertEqual(result["stages"]["etl_transform"], "GREEN", result["errors"])
        self.assertEqual(result["stages"]["query"]["status"], "GREEN", result["errors"])
        self.assertEqual(result["stages"]["filters"]["status"], "GREEN", result["errors"])
        self.assertEqual(result["stages"]["ui_static_smoke"]["status"], "GREEN", result["errors"])
        self.assertEqual(result["stages"]["quality_scan"]["status"], "GREEN", result["errors"])
        self.assertEqual(result["stages"]["browser_smoke"]["status"], "GREEN", result["errors"])
        self.assertEqual(result["status"], "GREEN", result["errors"])
        self.assertGreater(result["evidence"]["normalized_rows"], 0)


if __name__ == "__main__":
    unittest.main()
