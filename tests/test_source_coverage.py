"""No-network tests for 3×2×category border-source evidence and Actions summary."""
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts import source_coverage as C
from scripts import report_health

UTC = timezone.utc
NOW = datetime(2026, 11, 19, 22, 30, 0, tzinfo=UTC)


def iso(age):
    return (NOW - timedelta(minutes=age)).isoformat().replace("+00:00", "Z")


def lane(minutes=0, age=5, status="reported", lanes=2):
    return {"minutes": minutes, "status": status, "observation_at": iso(age),
            "lanes_open": lanes}


def port(minutes=0):
    return {"standard": lane(minutes), "nexus": lane(3),
            "ready": lane(None, status="not_applicable", lanes=None),
            "commercial": lane(11, lanes=1),
            "fast": lane(None, status="closed", lanes=None),
            "port_status": "Open"}


def sample():
    return {
        "schema": "nexus-live-v2",
        "generated_at": iso(1),
        "sources": {
            "cbp": {"status": "ok", "retrieved_at": iso(1)},
            "cbsa": {"status": "ok", "retrieved_at": iso(1)},
        },
        "directions": {
            "us": {id: port() for id in C.CROSSINGS},
            "ca": {id: {"standard": lane(0, lanes=None),
                        "commercial": lane(14, lanes=None),
                        "nexus": None}
                   for id in C.CROSSINGS}
        },
        "supplemental": {
            "dwt": {"ca": {"lane_counts": {"nexus": 3},
                           "observation_at": iso(1)}},
            "cbsa_nexus_hours": {"tunnel": {"groups": [{"label": "NEXUS"}]}}
        }
    }


class SourceCoverageTests(unittest.TestCase):
    def test_all_30_coordinates_and_source_semantics(self):
        data = sample()
        self.assertEqual(len(C.rows(data, NOW)), 6)
        matrix = C.markdown(data, NOW)
        self.assertEqual(sum(1 for x in matrix.splitlines() if x.startswith("| Ambassador ")), 2)
        self.assertEqual(sum(1 for x in matrix.splitlines() if x.startswith("| Tunnel ")), 2)
        self.assertEqual(sum(1 for x in matrix.splitlines() if x.startswith("| Gordie Howe ")), 2)
        self.assertIn("Passenger Ready", matrix)
        self.assertIn("Commercial FAST", matrix)
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW),
                         "Recent (5m); 2 lanes reported")
        self.assertEqual(C.cell(data, "ca", "ambassador", "standard", NOW),
                         "Recent (5m); count unavailable")
        self.assertIn("Recent", C.cell(data, "us", "ambassador", "nexus", NOW))
        self.assertEqual(C.cell(data, "us", "ambassador", "ready", NOW),
                         "Agency field N/A")
        self.assertEqual(C.cell(data, "us", "ambassador", "fast", NOW),
                         "Lane closure reported")
        self.assertIn("not independently verified physical eligibility", matrix)
        self.assertIn("not a claim", C.__doc__.lower())

    def test_cbsa_special_categories_are_never_inferred(self):
        data = sample()
        for id in C.CROSSINGS:
            for cat in ("nexus", "ready", "fast"):
                self.assertEqual(C.cell(data, "ca", id, cat, NOW),
                                 "Not published",
                                 "CBSA schedule/operator counts cannot be waits")
        self.assertEqual(C.cell(data, "ca", "ambassador", "commercial", NOW),
                         "Recent (5m); count unavailable")

    def test_valid_zero_missing_no_timestamp_and_old_values(self):
        data = sample()
        self.assertEqual(data["directions"]["ca"]["tunnel"]["standard"]["minutes"], 0)
        self.assertIn("Recent", C.cell(data, "ca", "tunnel", "standard", NOW))
        del data["directions"]["us"]["ambassador"]["nexus"]
        self.assertEqual(C.cell(data, "us", "ambassador", "nexus", NOW),
                         "Wait not reported")
        data["directions"]["us"]["tunnel"]["standard"]["observation_at"] = None
        self.assertEqual(C.cell(data, "us", "tunnel", "standard", NOW),
                         "Wait has no timestamp")
        data["directions"]["us"]["gordie"]["standard"]["observation_at"] = iso(63)
        self.assertEqual(C.cell(data, "us", "gordie", "standard", NOW),
                         "Older observation (63m)")

    def test_source_outage_stale_snapshot_and_retained_previous(self):
        data = sample()
        data["sources"]["cbp"].update(status="error", retained_previous=True)
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW),
                         "Source unavailable")
        self.assertEqual(C.cell(data, "ca", "tunnel", "nexus", NOW),
                         "Not published")
        data = sample()
        data["generated_at"] = iso(40)
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW),
                         "Source/snapshot old")
        data = sample()
        data["sources"]["cbsa"]["retrieved_at"] = iso(45)
        self.assertEqual(C.cell(data, "ca", "tunnel", "standard", NOW),
                         "Source/snapshot old")

    def test_lane_vs_port_closure_is_source_report_not_live_proof(self):
        data = sample()
        data["directions"]["us"]["ambassador"]["port_status"] = "Closed"
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW),
                         "Port closure reported; currency unverified")
        data["directions"]["us"]["ambassador"]["port_status"] = "Closed due to operations"
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW),
                         "Port closure reported; currency unverified")
        data["sources"]["cbp"]["retrieved_at"] = iso(65)
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW),
                         "Port closure reported; currency unverified")
        data = sample()
        data["directions"]["us"]["tunnel"]["fast"]["observation_at"] = iso(67)
        self.assertEqual(C.cell(data, "us", "tunnel", "fast", NOW),
                         "Closure reported; currency unverified")

    def test_malformed_fields_and_future_timestamps(self):
        data = sample()
        data["directions"]["us"]["tunnel"]["standard"]["minutes"] = "0"
        self.assertEqual(C.cell(data, "us", "tunnel", "standard", NOW),
                         "Invalid wait field")
        data["directions"]["us"]["tunnel"]["standard"]["minutes"] = -3
        self.assertEqual(C.cell(data, "us", "tunnel", "standard", NOW),
                         "Invalid wait field")
        data["directions"]["us"]["tunnel"]["standard"]["minutes"] = False
        self.assertEqual(C.cell(data, "us", "tunnel", "standard", NOW),
                         "Invalid wait field")
        data["directions"]["us"]["tunnel"]["standard"]["minutes"] = 4
        data["directions"]["us"]["tunnel"]["standard"]["observation_at"] = iso(-30)
        self.assertEqual(C.cell(data, "us", "tunnel", "standard", NOW),
                         "Wait has no timestamp")
        with self.assertRaises(ValueError):
            C.cell(data, "ca", "bluewater", "standard", NOW)
        with self.assertRaises(ValueError):
            C.cell(data, "us", "tunnel", "unknown", NOW)

    def test_selected_history_and_count_bounds(self):
        data = sample()
        raw = data["directions"]["us"]["ambassador"]["standard"]
        raw["observation_at"] = iso(20)
        self.assertIn("Recent", C.cell(data, "us", "ambassador", "standard", NOW))
        raw["lanes_open"] = 101
        self.assertIn("count unavailable", C.cell(data, "us", "ambassador", "standard", NOW))
        raw["observation_at"] = iso(120)
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW), "Observation expired")
        raw["observation_at"] = iso(5)
        data["sources"]["cbp"]["last_success_at"] = iso(120)
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW), "Source/snapshot expired")
        data["sources"]["cbp"].update(status="error", retained_previous=True, last_success_at=iso(5))
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW), "Historical retained observation")
        raw.update(status="closed", observation_at=None)
        self.assertEqual(C.cell(data, "us", "ambassador", "standard", NOW), "Closure reported; currency unverified")

    def test_no_secrets_or_untrusted_notice_text_in_report(self):
        data = sample()
        data["sources"]["cbp"]["url"] = "https://source.example/?key=SECRET"
        data["directions"]["us"]["tunnel"]["notice"] = '<img src=x onerror="alert(1)">'
        out = C.markdown(data, NOW)
        self.assertNotIn("SECRET", out)
        self.assertNotIn("<img", out)
        self.assertNotIn("source.example", out)

    def test_timestamp_tz_and_skew(self):
        self.assertIsNone(C.age_minutes("2026-11-19T22:30:00", NOW))
        self.assertEqual(C.age_minutes(iso(0), NOW), 0)
        self.assertIsNone(C.age_minutes(iso(-5), NOW))
        self.assertAlmostEqual(C.age_minutes("2026-11-19T17:15:00-05:00", NOW), 15)

    def test_report_health_includes_matrix_without_changing_snapshot(self):
        data = sample()
        data["collection"] = {"trigger": "push"}
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "snapshot.json"
            output = Path(tmp) / "summary.md"
            p.write_text(json.dumps(data), encoding="utf-8")
            previous = p.read_bytes()
            capture = io.StringIO()
            with patch.dict("os.environ", {"GITHUB_STEP_SUMMARY": str(output)}):
                with patch.object(sys, "argv", ["report_health.py", str(p)]):
                    with redirect_stdout(capture):
                        report_health.main()
            summary = output.read_text(encoding="utf-8")
            self.assertIn("Official inspection-field coverage", summary)
            self.assertIn("Not published", summary)
            self.assertIn("CBP", summary.upper())
            self.assertIn("Source/snapshot", C.cell(
                {**data, "generated_at": iso(30)}, "us", "tunnel", "standard", NOW))
            self.assertEqual(p.read_bytes(), previous, "Coverage diagnostics must not edit published JSON")


if __name__ == "__main__":
    unittest.main()
