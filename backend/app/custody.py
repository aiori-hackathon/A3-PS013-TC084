"""Append-only chain of custody for evidence handling.

Hashing a log file proves the bytes have not changed. It says nothing about
who collected it, who checked it, or who took a copy away — which is the part
NIST SP 800-86 calls chain of custody, and the part a hash alone cannot carry.

This module records those handling events. Each entry is sealed with
SHA-256 over the previous entry's seal and its own contents, so the entries
form a chain: altering or removing one breaks every seal after it, and the
break can be located. The chain proves the record is intact. It does not
prove the record is complete, and nothing here should be read as proving an
entry was made by the person named in it.

Each account keeps its own chain, matching how evidence itself is isolated.
"""

from datetime import datetime, timezone
import hashlib
import json

from fastapi import APIRouter, HTTPException, Request

from app.auth import connect

router = APIRouter(prefix="/api/v1/custody", tags=["custody"])

# The seal a chain starts from, so the first real entry is sealed like any other.
GENESIS_HASH = "0" * 64

# Handling events worth recording. Reading a page is not one: a log nobody can
# scan is a log nobody checks.
ACTIONS = ("ingest", "verify", "link", "export")


def initialize():
    with connect() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS custody_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                action TEXT NOT NULL,
                device_id TEXT,
                batch_id TEXT,
                case_id INTEGER,
                detail TEXT NOT NULL DEFAULT '{}',
                recorded_at TEXT NOT NULL,
                prev_hash TEXT NOT NULL,
                entry_hash TEXT NOT NULL
            )
        """)
        db.execute(
            "CREATE INDEX IF NOT EXISTS custody_log_owner "
            "ON custody_log(user_id, id)"
        )


def sealed_body(entry):
    """The exact bytes an entry's seal is computed over.

    Key order is fixed by sort_keys so the same entry always hashes the same
    way, whatever order the fields were written in.
    """
    return json.dumps(
        {
            "user_id": entry["user_id"],
            "action": entry["action"],
            "device_id": entry["device_id"],
            "batch_id": entry["batch_id"],
            "case_id": entry["case_id"],
            "detail": entry["detail"],
            "recorded_at": entry["recorded_at"],
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def seal(prev_hash, entry):
    return hashlib.sha256(
        (prev_hash + "|" + sealed_body(entry)).encode("utf-8")
    ).hexdigest()


def record(user_id, action, device_id=None, batch_id=None, case_id=None, **detail):
    """Append one handling event. Never raises into the caller's request."""
    if action not in ACTIONS:
        raise ValueError(f"Unknown custody action: {action}")

    entry = {
        "user_id": user_id,
        "action": action,
        "device_id": device_id,
        "batch_id": batch_id,
        "case_id": case_id,
        "detail": json.dumps(detail, sort_keys=True, ensure_ascii=False),
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        with connect() as db:
            # One transaction, so two requests cannot seal against the same
            # predecessor and leave two entries claiming the same place.
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute(
                "SELECT entry_hash FROM custody_log "
                "WHERE user_id=? ORDER BY id DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            prev_hash = previous["entry_hash"] if previous else GENESIS_HASH
            db.execute(
                "INSERT INTO custody_log (user_id, action, device_id, batch_id,"
                " case_id, detail, recorded_at, prev_hash, entry_hash)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    entry["user_id"], entry["action"], entry["device_id"],
                    entry["batch_id"], entry["case_id"], entry["detail"],
                    entry["recorded_at"], prev_hash, seal(prev_hash, entry),
                ),
            )
    except Exception:
        # Evidence handling must not fail because its own record-keeping did.
        # A gap is visible in the chain; a refused ingest loses the evidence.
        return None
    return entry["recorded_at"]


def entries_for_user(user_id, limit=200):
    with connect() as db:
        rows = db.execute(
            "SELECT * FROM custody_log WHERE user_id=? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [dict(row) for row in rows]


def verify_chain(user_id):
    """Recompute every seal in order and report the first break."""
    with connect() as db:
        rows = [dict(row) for row in db.execute(
            "SELECT * FROM custody_log WHERE user_id=? ORDER BY id",
            (user_id,),
        ).fetchall()]

    expected_prev = GENESIS_HASH
    for position, row in enumerate(rows, 1):
        if row["prev_hash"] != expected_prev:
            return {
                "intact": False, "entries": len(rows),
                "broken_at": position, "entry_id": row["id"],
                "detail": "This entry does not follow the one before it. An "
                          "earlier entry was changed or removed.",
            }
        if seal(row["prev_hash"], row) != row["entry_hash"]:
            return {
                "intact": False, "entries": len(rows),
                "broken_at": position, "entry_id": row["id"],
                "detail": "This entry's contents no longer match its seal.",
            }
        expected_prev = row["entry_hash"]

    return {
        "intact": True, "entries": len(rows), "broken_at": None,
        "entry_id": None,
        "detail": "Every entry matches its seal and follows the one before it."
                  if rows else "No evidence has been handled on this account yet.",
    }


def current_user_id(request: Request):
    from app.auth import current_user

    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user["id"]


@router.get("")
def list_custody(request: Request):
    user_id = current_user_id(request)
    return {
        "items": entries_for_user(user_id),
        "chain": verify_chain(user_id),
    }


@router.get("/verify")
def verify_custody(request: Request):
    return verify_chain(current_user_id(request))


initialize()
