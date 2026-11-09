
import hashlib
import json
import os
import time
import uuid
from pathlib import Path

import requests

# Everything here can be set from the environment so one agent can follow a
# real log on a real host. The defaults are the original sample setup, so
# running it with no configuration behaves exactly as before.
SERVER_URL = os.getenv(
    "TRACEPOINT_SERVER", "http://127.0.0.1:8000"
).rstrip("/") + "/api/v1/ingest"
DEVICE_ID = os.getenv("TRACEPOINT_DEVICE_ID", "macbook-01")
LOG_TYPE = os.getenv("TRACEPOINT_LOG_TYPE", "auth")

# Syslog lines carry no year and no offset, so the server has to be told which
# zone the source wrote them in. Getting this wrong silently shifts every
# inferred timestamp, which then reads as a skewed clock rather than a
# misconfigured agent. A Linux host running UTC needs TRACEPOINT_TIMEZONE=UTC.
SOURCE_TIMEZONE = os.getenv("TRACEPOINT_TIMEZONE", "Asia/Kolkata")

LOG_FILE = Path(os.getenv("TRACEPOINT_LOG_FILE", "sample.log")).expanduser()

# The read offset belongs to one file on one device. Keying the state by both
# means pointing the agent at a different log starts from its beginning
# instead of resuming at a byte offset that means nothing in the new file.
_STATE_KEY = hashlib.sha256(
    f"{DEVICE_ID}|{LOG_FILE.resolve()}".encode("utf-8")
).hexdigest()[:12]
STATE_DIR = Path(os.getenv("TRACEPOINT_STATE_DIR", ".")).expanduser()
STATE_FILE = STATE_DIR / f"agent-state-{_STATE_KEY}.json"
PENDING_FILE = STATE_DIR / f"pending-batch-{_STATE_KEY}.json"

POLL_INTERVAL = int(os.getenv("TRACEPOINT_POLL_SECONDS", "5"))
MAX_LINES = int(os.getenv("TRACEPOINT_MAX_LINES", "100"))


def save_json_atomic(path, data):
    temp_path = path.with_suffix(path.suffix + ".tmp")

    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(data, file)
        file.flush()
        os.fsync(file.fileno())

    os.replace(temp_path, path)


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())

    # First run against a log that already has history. Starting at zero would
    # replay the whole file, which on a real auth.log means thousands of lines
    # of old events arriving as if they just happened. Opt in to following
    # only what gets written from now on.
    if os.getenv("TRACEPOINT_START_AT_END") == "1" and LOG_FILE.exists():
        size = LOG_FILE.stat().st_size
        print(f"Starting at the end of the file ({size} bytes already present)")
        return {"offset": size}

    return {"offset": 0}


def send_pending_batch(api_key):
    if not PENDING_FILE.exists():
        return True

    pending = json.loads(PENDING_FILE.read_text())

    try:
        response = requests.post(
            SERVER_URL,
            headers={"X-API-Key": api_key},
            json=pending["payload"],
            timeout=10
        )

        response.raise_for_status()
        result = response.json()

        if result.get("status") not in ("accepted", "duplicate"):
            raise ValueError("Unexpected server response")

        save_json_atomic(
            STATE_FILE,
            {"offset": pending["next_offset"]}
        )

        PENDING_FILE.unlink()

        print(
            f"Batch {result['status']}: "
            f"{len(pending['payload']['lines'])} lines"
        )

        return True

    except (requests.RequestException, ValueError) as error:
        print(f"Delivery failed; will retry: {error}")
        return False


def collect_new_lines():
    if not LOG_FILE.exists():
        print(f"Log file not found: {LOG_FILE}")
        return

    state = load_state()
    offset = state["offset"]

    file_size = LOG_FILE.stat().st_size

    if file_size < offset:
        print("Log file was truncated; restarting at offset 0")
        offset = 0

    lines = []

    with LOG_FILE.open("rb") as file:
        file.seek(offset)

        while len(lines) < MAX_LINES:
            line = file.readline()

            if not line:
                break

            # Wait for a complete line before collecting it.
            if not line.endswith(b"\n"):
                break

            lines.append(line.decode("utf-8", errors="replace").rstrip("\r\n"))

        next_offset = file.tell()

    if not lines:
        return

    payload = {
        "device_id": DEVICE_ID,
        "batch_id": str(uuid.uuid4()),
        "log_type": LOG_TYPE,
        "source_timezone": SOURCE_TIMEZONE,
        "lines": lines
    }

    save_json_atomic(
        PENDING_FILE,
        {
            "payload": payload,
            "next_offset": next_offset
        }
    )

    print(f"Collected {len(lines)} new log lines")


def main():
    api_key = os.getenv("AGENT_API_KEY")

    if not api_key:
        raise RuntimeError("AGENT_API_KEY is not configured")

    print("The Missing Links Agent started")
    print(f"Watching:  {LOG_FILE}")
    print(f"Device:    {DEVICE_ID}")
    print(f"Server:    {SERVER_URL}")
    print(f"Timezone:  {SOURCE_TIMEZONE}")
    print(f"State:     {STATE_FILE}")
    print(f"Polling every {POLL_INTERVAL} seconds")

    while True:
        try:
            if PENDING_FILE.exists():
                send_pending_batch(api_key)
            else:
                collect_new_lines()

        except Exception as error:
            print(f"Agent error: {error}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAgent stopped")

