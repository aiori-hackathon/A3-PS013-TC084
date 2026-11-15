"""Network investigation sessions: ingest, storage and analysis.

A network collection agent (the Mininet lab, or any collector that speaks
the same shape) posts a session of phase observations. Each session is
stored verbatim, hashed, and recorded in the chain of custody, exactly as
log evidence is — the raw bytes that arrived are what gets kept.

Analysis is never stored. Root-cause findings are derived from the stored
evidence on every read, so a report can always be traced back to the bytes
it came from, and improving the engine never rewrites history.
"""

from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import re

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field
from pydantic import ValidationError

from app import custody
from app import network_rca
from app import network_report

router = APIRouter(prefix="/api/v1/network", tags=["network"])

EVIDENCE_DIR = Path(__file__).resolve().parent.parent / "data" / "evidence"
MAX_SESSION_BYTES = 2 * 1024 * 1024  # 2 MiB

# Session and device identifiers become path segments, so they are limited to
# characters that cannot escape the directory or collide with metadata files.
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

PHASES = ("normal", "fault", "recovered")


class Observation(BaseModel):
    """One recorded phase. Unknown fields are preserved, not rejected."""

    model_config = ConfigDict(extra="allow")

    phase: str = Field(min_length=1, max_length=32)
    timestamp_utc: str = Field(min_length=1, max_length=64)
    packet_loss_percent: float | None = None
    topology: dict | None = None


class SessionBatch(BaseModel):
    model_config = ConfigDict(extra="allow")

    session_id: str = Field(min_length=1, max_length=64)
    device_id: str = Field(default="network-lab", min_length=1, max_length=64)
    source: str | None = Field(default=None, max_length=200)
    observations: list[Observation] = Field(min_length=1, max_length=200)


def session_dir(user_id: int) -> Path:
    return EVIDENCE_DIR / "users" / str(user_id) / "network"


def require_user(request: Request) -> int:
    from app.auth import current_user

    user = current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user["id"]


def load_for_analysis(user_id: int, session_id: str):
    """Stored session, its metadata and freshly derived analysis."""
    if not SAFE_ID.match(session_id):
        raise HTTPException(status_code=422, detail="Invalid session_id")

    path = session_dir(user_id) / f"{session_id}.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Network session not found")

    stored = read_session(path)
    if not isinstance(stored, dict):
        raise HTTPException(status_code=500, detail="Stored session could not be read")

    meta = read_session(path.with_suffix(".meta.json")) or {}
    observations = stored.get("observations") or []

    try:
        analysis = network_rca.analyse(observations)
    except Exception as error:  # analysis must never make evidence unreadable
        analysis = {
            "topology_available": False,
            "hypotheses": [],
            "fault_localisation": None,
            "impact": None,
            "recovery": None,
            "observed_facts": [],
            "limitations": ["Analysis failed: " + str(error)],
        }

    return summarise(session_id, stored, meta), observations, analysis


def read_session(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def summarise(session_id: str, stored: dict, meta: dict) -> dict:
    observations = stored.get("observations") or []
    phases = [o.get("phase") for o in observations if o.get("phase")]
    has_topology = any(o.get("topology") for o in observations)

    return {
        "session_id": session_id,
        "device_id": stored.get("device_id"),
        "source": stored.get("source"),
        "received_at": meta.get("received_at"),
        "sha256": meta.get("sha256"),
        "observations": len(observations),
        "phases": phases,
        "topology_available": has_topology,
    }


@router.post("/ingest", status_code=201)
async def ingest_session(request: Request, x_api_key: str | None = Header(default=None)):
    """Accept a network session from a collection agent.

    The API key identifies the owning account. Nothing in the request body
    is trusted to say who the evidence belongs to.
    """
    from app.auth import user_for_agent_api_key

    owner_user_id = user_for_agent_api_key(x_api_key)
    if owner_user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or revoked agent API key")

    chunks = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_SESSION_BYTES:
            raise HTTPException(status_code=413, detail="Session exceeds 2 MiB")
        chunks.append(chunk)
    raw_bytes = b"".join(chunks)

    try:
        payload = SessionBatch.model_validate_json(raw_bytes)
    except (ValidationError, ValueError):
        raise HTTPException(status_code=422, detail="Invalid network session")

    if not SAFE_ID.match(payload.session_id):
        raise HTTPException(status_code=422, detail="Invalid session_id")
    if not SAFE_ID.match(payload.device_id):
        raise HTTPException(status_code=422, detail="Invalid device_id")

    directory = session_dir(owner_user_id)
    directory.mkdir(parents=True, exist_ok=True)
    evidence_path = directory / f"{payload.session_id}.json"
    metadata_path = directory / f"{payload.session_id}.meta.json"

    sha256 = hashlib.sha256(raw_bytes).hexdigest()

    # Exclusive create: a session identifier is claimed once. Re-sending the
    # same id never overwrites evidence already held.
    try:
        with evidence_path.open("xb") as handle:
            handle.write(raw_bytes)
            handle.flush()
    except FileExistsError:
        existing = read_session(metadata_path) or {}
        if existing.get("sha256") == sha256:
            return {
                "session_id": payload.session_id,
                "sha256": sha256,
                "duplicate": True,
                "detail": "This session was already received; evidence left unchanged.",
            }
        raise HTTPException(
            status_code=409,
            detail="A different session is already stored under this session_id",
        )

    metadata = {
        "session_id": payload.session_id,
        "device_id": payload.device_id,
        "sha256": sha256,
        "bytes": len(raw_bytes),
        "received_at": datetime.now(timezone.utc).isoformat(),
        "observations": len(payload.observations),
    }
    metadata_path.write_text(json.dumps(metadata, indent=2))

    custody.record(
        owner_user_id,
        "ingest",
        device_id=payload.device_id,
        batch_id=payload.session_id,
        kind="network_session",
        sha256=sha256,
        observations=len(payload.observations),
    )

    return {
        "session_id": payload.session_id,
        "sha256": sha256,
        "observations": len(payload.observations),
        "received_at": metadata["received_at"],
    }


@router.get("/sessions")
def list_sessions(request: Request):
    user_id = require_user(request)
    directory = session_dir(user_id)

    items = []
    if directory.is_dir():
        for path in sorted(directory.glob("*.json")):
            if path.name.endswith(".meta.json"):
                continue
            stored = read_session(path)
            if not isinstance(stored, dict):
                continue
            meta = read_session(path.with_suffix(".meta.json")) or {}
            items.append(summarise(path.stem, stored, meta))

    items.sort(key=lambda item: item.get("received_at") or "", reverse=True)
    return {"sessions": items}


@router.get("/sessions/{session_id}")
def get_session(session_id: str, request: Request):
    session, observations, analysis = load_for_analysis(
        require_user(request), session_id
    )
    return {"session": session, "observations": observations, "rca": analysis}


@router.get("/sessions/{session_id}/report", response_class=PlainTextResponse)
def session_report(session_id: str, request: Request):
    """A plain-text investigation report, rendered from stored evidence."""
    session, observations, analysis = load_for_analysis(
        require_user(request), session_id
    )
    text = network_report.build(session, observations, analysis)
    return PlainTextResponse(
        text,
        headers={
            "Content-Disposition":
                f'attachment; filename="tracepoint_network_{session_id}.txt"'
        },
    )
