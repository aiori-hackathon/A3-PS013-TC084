#!/usr/bin/env python3
"""Forward network lab evidence to a Tracepoint workspace.

The lab records evidence locally whether or not anything is listening.
This agent copies those sessions to Tracepoint, where they become
evidence like any other collection: hashed on arrival, owned by the
account the API key belongs to, and recorded in the chain of custody.

Sending is safe to repeat. The server claims a session identifier once,
so a re-run reports what it already holds instead of duplicating or
overwriting it. Nothing here deletes or edits local evidence.

Configure with environment variables or flags:

    TRACEPOINT_SERVER     e.g. https://api.tracepoint.example
    TRACEPOINT_API_KEY    an agent key from the workspace
    TRACEPOINT_DEVICE_ID  defaults to "mininet-lab"
    TRACEPOINT_EVIDENCE_DIR  defaults to ./evidence beside this script

Examples:

    ./tracepoint_agent.py --list
    ./tracepoint_agent.py                      # send everything not yet held
    ./tracepoint_agent.py network_evidence_20261115_113508.json
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# The collector normally runs beside the lab's evidence directory. Point it
# somewhere else with TRACEPOINT_EVIDENCE_DIR when it does not.
BASE_DIR = Path(__file__).resolve().parent
EVIDENCE_DIR = Path(
    os.environ.get("TRACEPOINT_EVIDENCE_DIR") or BASE_DIR / "evidence"
).expanduser()
EVIDENCE_NAME = re.compile(r"^network_evidence_(\d{8}_\d{6})\.json$")
TIMEOUT_SECONDS = 30


def session_id_for(path):
    """A stable identifier derived from the evidence filename."""
    match = EVIDENCE_NAME.match(path.name)
    return "lab-" + match.group(1) if match else None


def evidence_files(names=None):
    if not EVIDENCE_DIR.is_dir():
        return []
    if names:
        chosen = []
        for name in names:
            path = EVIDENCE_DIR / Path(name).name
            if not path.is_file():
                print(f"  skipped {name}: no such evidence file")
                continue
            chosen.append(path)
        return chosen
    return sorted(p for p in EVIDENCE_DIR.glob("network_evidence_*.json")
                  if EVIDENCE_NAME.match(p.name))


def read_observations(path):
    records = json.loads(path.read_text())
    if not isinstance(records, list) or not records:
        raise ValueError("evidence must be a non-empty list of observations")
    return records


def send(url, api_key, payload):
    request = urllib.request.Request(
        url.rstrip("/") + "/api/v1/network/ingest",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
    )
    request.add_header("Content-Type", "application/json")
    request.add_header("X-API-Key", api_key)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read() or b"{}")
        except ValueError:
            body = {}
        return error.code, body
    except urllib.error.URLError as error:
        return 0, {"detail": f"could not reach Tracepoint: {error.reason}"}


def describe(status, body):
    if status == 201 and body.get("duplicate"):
        return "already held", True
    if status == 201:
        return f"sent ({body.get('observations')} observations, sha {body.get('sha256','')[:12]})", True
    if status == 401:
        return "rejected: the API key is not valid for this workspace", False
    if status == 409:
        return "refused: a different session is already stored under this id", False
    if status == 0:
        return body.get("detail", "unreachable"), False
    return f"failed (HTTP {status}): {body.get('detail', 'unknown error')}", False


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("evidence", nargs="*",
                        help="evidence filenames to send; default is all of them")
    parser.add_argument("--url",
                        default=os.environ.get("TRACEPOINT_SERVER")
                        or os.environ.get("TRACEPOINT_URL"),
                        help="Tracepoint API base URL")
    parser.add_argument("--api-key", default=os.environ.get("TRACEPOINT_API_KEY"),
                        help="agent API key for the destination workspace")
    parser.add_argument("--device-id", default=os.environ.get("TRACEPOINT_DEVICE_ID", "mininet-lab"),
                        help="identifier this collector reports as")
    parser.add_argument("--list", action="store_true",
                        help="show local evidence sessions and exit, sending nothing")
    arguments = parser.parse_args()

    files = evidence_files(arguments.evidence)
    if not files:
        print("No evidence sessions found in", EVIDENCE_DIR)
        return 0

    if arguments.list:
        print(f"{len(files)} evidence session(s) in {EVIDENCE_DIR}:")
        for path in files:
            try:
                records = read_observations(path)
                phases = "/".join(r.get("phase", "?") for r in records)
                topology = "topology" if any(r.get("topology") for r in records) else "no topology"
                print(f"  {session_id_for(path):22s} {len(records)} obs  {phases:28s} {topology}")
            except (ValueError, OSError) as error:
                print(f"  {path.name}: unreadable ({error})")
        return 0

    if not arguments.url or not arguments.api_key:
        parser.error("set TRACEPOINT_SERVER and TRACEPOINT_API_KEY "
                     "(or pass --url and --api-key)")

    print(f"Sending {len(files)} session(s) to {arguments.url}")
    failures = 0

    for path in files:
        identifier = session_id_for(path)
        if identifier is None:
            print(f"  {path.name}: skipped, unrecognised evidence filename")
            continue
        try:
            observations = read_observations(path)
        except (ValueError, OSError) as error:
            print(f"  {identifier}: skipped, {error}")
            failures += 1
            continue

        status, body = send(arguments.url, arguments.api_key, {
            "session_id": identifier,
            "device_id": arguments.device_id,
            "source": path.name,
            "observations": observations,
        })
        message, ok = describe(status, body)
        print(f"  {identifier:22s} {message}")
        if not ok:
            failures += 1

    if failures:
        print(f"\n{failures} session(s) were not accepted. Local evidence is unchanged.")
        return 1

    print("\nAll sessions accepted.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
