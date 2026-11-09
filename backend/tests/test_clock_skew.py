"""A source clock that disagrees with receipt time must be reported, not fixed.

The point of these tests is the distinction the feature rests on: a line dated
after the server received it is proof the source clock is ahead, while a line
older than receipt proves nothing, because collected logs are normally old.

Run from the backend directory:
    python -m unittest discover -s tests -v
"""
from pathlib import Path
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.parser import CLOCK_TOLERANCE_SECONDS, parse_log  # noqa: E402

RECEIVED_AT = "2026-11-09T12:00:00+00:00"


def windows_line(timestamp):
    return (
        '{"EventID":4625,"TimeCreated":"' + timestamp + '",'
        '"TargetUserName":"analyst","Message":"An account failed to log on"}'
    )


def parse(line, received_at=RECEIVED_AT, source_timezone="Asia/Kolkata"):
    return parse_log(
        line, "device-01", "batch-01", "auth",
        received_at=received_at, source_timezone=source_timezone,
    )


class ClockAheadIsProvable(unittest.TestCase):
    def test_timestamp_after_receipt_is_reported_as_ahead(self):
        """A line cannot be written after it arrives, so this is real skew."""
        event = parse(windows_line("2026-11-09T12:10:00Z"))
        self.assertEqual(event["clock_skew"], "ahead")
        self.assertEqual(event["clock_offset_seconds"], 600)

    def test_small_lead_stays_inside_tolerance(self):
        """Ordinary NTP drift must not be reported as a skewed clock."""
        event = parse(windows_line("2026-11-09T12:00:30Z"))
        self.assertEqual(event["clock_skew"], "within_tolerance")
        self.assertEqual(event["clock_offset_seconds"], 30)

    def test_the_boundary_itself_is_not_skew(self):
        event = parse(windows_line("2026-11-09T12:02:00Z"))
        self.assertEqual(event["clock_offset_seconds"], CLOCK_TOLERANCE_SECONDS)
        self.assertEqual(event["clock_skew"], "within_tolerance")


class OlderThanReceiptIsNotAVerdict(unittest.TestCase):
    def test_old_log_is_an_observation_not_skew(self):
        """Collected logs are normally older than the moment they arrive."""
        event = parse(windows_line("2026-11-09T09:00:00Z"))
        self.assertEqual(event["clock_skew"], "older_than_receipt")
        self.assertEqual(event["clock_offset_seconds"], -10800)
        self.assertNotIn("ahead", event["clock_skew"])


class TimezoneIsNotSkew(unittest.TestCase):
    """The whole point: a correct clock in another zone is not a skewed clock."""

    def test_india_local_time_at_the_receipt_instant_is_within_tolerance(self):
        # 17:30+05:30 is exactly 12:00 UTC — the same instant as receipt.
        event = parse(
            "2026-11-09 17:30:00.000000+0530 host sshd[1]: Failed password for admin"
        )
        self.assertEqual(event["timestamp_utc"], "2026-11-09T12:00:00+00:00")
        self.assertEqual(event["clock_offset_seconds"], 0)
        self.assertEqual(event["clock_skew"], "within_tolerance")

    def test_a_device_an_hour_ahead_in_its_own_zone_is_still_caught(self):
        # 18:30+05:30 is 13:00 UTC, an hour after this server received it.
        event = parse(
            "2026-11-09 18:30:00.000000+0530 host sshd[1]: Failed password for admin"
        )
        self.assertEqual(event["clock_skew"], "ahead")
        self.assertEqual(event["clock_offset_seconds"], 3600)


class NothingToCompareAgainst(unittest.TestCase):
    def test_unparsed_timestamp_reports_unknown(self):
        event = parse('{"EventID":4625,"TargetUserName":"analyst"')
        self.assertEqual(event["clock_skew"], "unknown")
        self.assertIsNone(event["clock_offset_seconds"])

    def test_missing_receipt_time_reports_unknown(self):
        event = parse(windows_line("2026-11-09T12:10:00Z"), received_at=None)
        self.assertEqual(event["clock_skew"], "unknown")
        self.assertIsNone(event["clock_offset_seconds"])

    def test_original_timestamp_is_never_rewritten(self):
        """Skew is reported alongside the evidence, never applied to it."""
        line = windows_line("2026-11-09T12:10:00Z")
        event = parse(line)
        self.assertEqual(event["raw_log"], line)
        self.assertEqual(event["timestamp"], "2026-11-09T12:10:00+00:00")
        self.assertEqual(event["timestamp_utc"], "2026-11-09T12:10:00+00:00")


class DeviceSummary(unittest.TestCase):
    """The per-device rollup an analyst actually reads."""

    def summarize(self, events):
        import app.main as main

        real = main.get_timeline_for_user
        main.get_timeline_for_user = lambda user_id, **kwargs: {
            "total": len(events), "events": events,
        }
        try:
            return main.clock_skew_for_user(1)
        finally:
            main.get_timeline_for_user = real

    def test_one_bad_line_marks_the_whole_device_ahead(self):
        events = [
            parse(windows_line("2026-11-09T11:59:50Z")),
            parse(windows_line("2026-11-09T12:20:00Z")),
        ]
        summary = self.summarize(events)
        device = summary["devices"][0]
        self.assertEqual(device["status"], "clock_ahead")
        self.assertEqual(device["max_offset_seconds"], 1200)
        self.assertEqual(summary["skewed_devices"], 1)

    def test_consistently_old_logs_are_not_called_skew(self):
        events = [parse(windows_line("2026-11-09T06:00:00Z")) for _ in range(3)]
        summary = self.summarize(events)
        self.assertEqual(summary["devices"][0]["status"], "older_than_receipt")
        self.assertEqual(summary["skewed_devices"], 0)

    def test_device_with_nothing_comparable_is_unknown(self):
        events = [parse('{"EventID":4625,"TargetUserName":"a"', received_at=None)]
        summary = self.summarize(events)
        self.assertEqual(summary["devices"][0]["status"], "unknown")
        self.assertEqual(summary["devices"][0]["comparable_events"], 0)


if __name__ == "__main__":
    unittest.main()
