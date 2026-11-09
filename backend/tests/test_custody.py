"""The custody chain has to notice when someone edits the custody chain.

A log that can be quietly rewritten records nothing worth having, so these
tests spend most of their effort trying to alter one without being caught.

Run from the backend directory:
    python -m unittest discover -s tests -v
"""
from pathlib import Path
import json
import sqlite3
import tempfile
import unittest
import sys

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import app.auth as auth  # noqa: E402
import app.custody as custody  # noqa: E402


class CustodyTestCase(unittest.TestCase):
    """Each test gets its own database file, so chains never leak between them."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

        real_path = auth.DB_PATH
        auth.DB_PATH = Path(self._tmp.name) / "custody_test.sqlite3"
        self.addCleanup(lambda: setattr(auth, "DB_PATH", real_path))

        with auth.connect() as db:
            db.execute(
                "INSERT INTO users (id, email, name, password_hash, created_at)"
                " VALUES (1, 'a@example.com', 'A', 'x', '2026-11-09T00:00:00+00:00')"
            )
            db.execute(
                "INSERT INTO users (id, email, name, password_hash, created_at)"
                " VALUES (2, 'b@example.com', 'B', 'x', '2026-11-09T00:00:00+00:00')"
            )
        custody.initialize()

    def rows(self, user_id=1):
        with auth.connect() as db:
            return [dict(r) for r in db.execute(
                "SELECT * FROM custody_log WHERE user_id=? ORDER BY id", (user_id,)
            ).fetchall()]


class RecordingHandling(CustodyTestCase):
    def test_entries_are_appended_in_order(self):
        custody.record(1, "ingest", device_id="d1", batch_id="b1", sha256="aa")
        custody.record(1, "verify", device_id="d1", batch_id="b1", result="verified")
        custody.record(1, "export", case_id=7, format="pdf")

        actions = [row["action"] for row in self.rows()]
        self.assertEqual(actions, ["ingest", "verify", "export"])
        self.assertTrue(custody.verify_chain(1)["intact"])

    def test_first_entry_follows_the_genesis_seal(self):
        custody.record(1, "ingest", batch_id="b1")
        self.assertEqual(self.rows()[0]["prev_hash"], custody.GENESIS_HASH)

    def test_each_entry_chains_to_the_one_before(self):
        for index in range(4):
            custody.record(1, "ingest", batch_id=f"b{index}")
        rows = self.rows()
        for earlier, later in zip(rows, rows[1:]):
            self.assertEqual(later["prev_hash"], earlier["entry_hash"])

    def test_detail_is_kept_with_the_entry(self):
        custody.record(1, "verify", batch_id="b1", result="mismatch")
        self.assertEqual(json.loads(self.rows()[0]["detail"])["result"], "mismatch")

    def test_an_unknown_action_is_refused(self):
        with self.assertRaises(ValueError):
            custody.record(1, "delete_everything", batch_id="b1")


class TamperingWithTheLog(CustodyTestCase):
    def setUp(self):
        super().setUp()
        custody.record(1, "ingest", device_id="d1", batch_id="b1", sha256="aa")
        custody.record(1, "verify", device_id="d1", batch_id="b1", result="mismatch")
        custody.record(1, "export", case_id=7, format="pdf")
        self.assertTrue(custody.verify_chain(1)["intact"])

    def edit(self, sql, params):
        with auth.connect() as db:
            db.execute(sql, params)

    def test_rewriting_an_entry_breaks_its_seal(self):
        """Turning a failed integrity check into a passing one must not go unnoticed."""
        target = self.rows()[1]["id"]
        self.edit(
            "UPDATE custody_log SET detail=? WHERE id=?",
            (json.dumps({"result": "verified"}, sort_keys=True), target),
        )
        result = custody.verify_chain(1)
        self.assertFalse(result["intact"])
        self.assertEqual(result["broken_at"], 2)
        self.assertEqual(result["entry_id"], target)

    def test_deleting_an_entry_breaks_the_chain(self):
        """Removing an inconvenient verify leaves a hole the next seal exposes."""
        self.edit("DELETE FROM custody_log WHERE id=?", (self.rows()[1]["id"],))
        result = custody.verify_chain(1)
        self.assertFalse(result["intact"])
        self.assertEqual(result["broken_at"], 2)

    def test_backdating_an_entry_breaks_its_seal(self):
        target = self.rows()[0]["id"]
        self.edit(
            "UPDATE custody_log SET recorded_at=? WHERE id=?",
            ("2020-01-01T00:00:00+00:00", target),
        )
        self.assertFalse(custody.verify_chain(1)["intact"])

    def test_resealing_one_entry_is_not_enough(self):
        """The forger must also redo every seal after it, or the break just moves."""
        rows = self.rows()
        target = dict(rows[1])
        target["detail"] = json.dumps({"result": "verified"}, sort_keys=True)
        self.edit(
            "UPDATE custody_log SET detail=?, entry_hash=? WHERE id=?",
            (target["detail"], custody.seal(target["prev_hash"], target), target["id"]),
        )
        result = custody.verify_chain(1)
        self.assertFalse(result["intact"])
        # Entry 2 now seals correctly, so the break surfaces at entry 3.
        self.assertEqual(result["broken_at"], 3)

    def test_an_untouched_chain_stays_intact(self):
        result = custody.verify_chain(1)
        self.assertTrue(result["intact"])
        self.assertEqual(result["entries"], 3)
        self.assertIsNone(result["broken_at"])


class ChainsArePerAccount(CustodyTestCase):
    def test_one_account_cannot_see_or_disturb_another(self):
        custody.record(1, "ingest", batch_id="owned-by-1")
        custody.record(2, "ingest", batch_id="owned-by-2")

        self.assertEqual(len(custody.entries_for_user(1)), 1)
        self.assertEqual(
            custody.entries_for_user(1)[0]["batch_id"], "owned-by-1"
        )
        self.assertTrue(custody.verify_chain(1)["intact"])
        self.assertTrue(custody.verify_chain(2)["intact"])

    def test_each_account_starts_its_own_chain_at_genesis(self):
        custody.record(1, "ingest", batch_id="b1")
        custody.record(2, "ingest", batch_id="b2")
        self.assertEqual(self.rows(1)[0]["prev_hash"], custody.GENESIS_HASH)
        self.assertEqual(self.rows(2)[0]["prev_hash"], custody.GENESIS_HASH)

    def test_breaking_one_chain_leaves_the_other_intact(self):
        custody.record(1, "ingest", batch_id="b1")
        custody.record(2, "ingest", batch_id="b2")
        with auth.connect() as db:
            db.execute(
                "UPDATE custody_log SET detail='{\"x\":1}' WHERE user_id=1"
            )
        self.assertFalse(custody.verify_chain(1)["intact"])
        self.assertTrue(custody.verify_chain(2)["intact"])


class EmptyChain(CustodyTestCase):
    def test_an_account_that_has_handled_nothing_is_intact(self):
        result = custody.verify_chain(1)
        self.assertTrue(result["intact"])
        self.assertEqual(result["entries"], 0)
        self.assertIn("No evidence", result["detail"])


if __name__ == "__main__":
    unittest.main()
