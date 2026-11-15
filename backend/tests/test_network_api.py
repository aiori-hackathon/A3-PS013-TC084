"""Network session ingest, storage and retrieval.

Covers the properties that protect evidence: only a valid agent key can
deposit a session, a session identifier is claimed once, identifiers can
never escape the storage directory, and analysis is derived on read rather
than stored.
"""

import secrets
import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import network

from test_network_rca import legacy_session, session


@pytest.fixture()
def api(tmp_path, monkeypatch):
    """A client signed in as a throwaway account, with an agent key."""
    monkeypatch.setattr(network, "EVIDENCE_DIR", tmp_path / "evidence")

    from fastapi.testclient import TestClient
    from app.main import app
    from app import auth

    client = TestClient(app)
    email = f"netlab-{secrets.token_hex(6)}@example.com"
    password = "correct horse battery staple"

    created = client.post(
        "/api/v1/auth/signup",
        json={"name": "Net Lab", "email": email, "password": password},
    )
    assert created.status_code == 201, created.text

    with auth.connect() as db:
        user_id = db.execute(
            "SELECT id FROM users WHERE email=?", (email,)
        ).fetchone()["id"]
        key = secrets.token_urlsafe(24)
        db.execute(
            "INSERT INTO agent_api_keys(user_id, token_hash, created_at) VALUES (?,?,?)",
            (user_id, auth.token_digest(key), "2026-11-15T00:00:00+00:00"),
        )
        db.commit()

    yield client, key, user_id

    with auth.connect() as db:
        db.execute("DELETE FROM agent_api_keys WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM users WHERE id=?", (user_id,))
        db.commit()


def batch(session_id="lab-test", observations=None):
    return {
        "session_id": session_id,
        "device_id": "mininet-lab",
        "observations": observations if observations is not None else session(),
    }


def test_ingest_requires_an_agent_key(api):
    client, _key, _user = api
    assert client.post("/api/v1/network/ingest", json=batch()).status_code == 401


def test_ingest_stores_a_session_and_reports_its_hash(api):
    client, key, _user = api

    response = client.post(
        "/api/v1/network/ingest", json=batch(), headers={"X-API-Key": key}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["observations"] == 3
    assert len(body["sha256"]) == 64


def test_resending_the_same_session_does_not_overwrite_evidence(api):
    client, key, _user = api
    headers = {"X-API-Key": key}

    first = client.post("/api/v1/network/ingest", json=batch(), headers=headers).json()
    again = client.post("/api/v1/network/ingest", json=batch(), headers=headers).json()

    assert again["duplicate"] is True
    assert again["sha256"] == first["sha256"]


def test_a_different_session_cannot_take_a_claimed_identifier(api):
    client, key, _user = api
    headers = {"X-API-Key": key}

    client.post("/api/v1/network/ingest", json=batch(), headers=headers)
    clash = client.post(
        "/api/v1/network/ingest",
        json=batch(observations=legacy_session()),
        headers=headers,
    )

    assert clash.status_code == 409


@pytest.mark.parametrize("bad_id", ["../../etc/passwd", "a/b", "", "has space"])
def test_identifiers_cannot_escape_the_storage_directory(api, bad_id):
    client, key, _user = api

    response = client.post(
        "/api/v1/network/ingest",
        json=batch(session_id=bad_id),
        headers={"X-API-Key": key},
    )

    assert response.status_code == 422


def test_sessions_are_private_to_the_signed_in_account(api):
    client, key, _user = api
    client.post("/api/v1/network/ingest", json=batch(), headers={"X-API-Key": key})

    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/network/sessions").status_code == 401


def test_listing_summarises_each_session(api):
    client, key, _user = api
    headers = {"X-API-Key": key}
    client.post("/api/v1/network/ingest", json=batch("with-topology"), headers=headers)
    client.post(
        "/api/v1/network/ingest",
        json=batch("without-topology", legacy_session()),
        headers=headers,
    )

    sessions = client.get("/api/v1/network/sessions").json()["sessions"]
    by_id = {item["session_id"]: item for item in sessions}

    assert by_id["with-topology"]["topology_available"] is True
    assert by_id["with-topology"]["phases"] == ["normal", "fault", "recovered"]
    assert by_id["without-topology"]["topology_available"] is False


def test_fetching_a_session_derives_the_analysis(api):
    client, key, _user = api
    client.post("/api/v1/network/ingest", json=batch(), headers={"X-API-Key": key})

    body = client.get("/api/v1/network/sessions/lab-test").json()
    rca = body["rca"]

    assert rca["topology_available"] is True
    assert rca["fault_localisation"]["affected_links"] == ["h2:h2-eth0--s1:s1-eth2"]
    assert rca["impact"]["severed_hosts"] == ["h2"]
    assert rca["impact"]["stranded_hosts"] == ["h1"]
    assert rca["hypotheses"][0]["confidence"] == "HIGH"


def test_a_session_without_topology_is_served_but_not_analysed(api):
    client, key, _user = api
    client.post(
        "/api/v1/network/ingest",
        json=batch("legacy", legacy_session()),
        headers={"X-API-Key": key},
    )

    rca = client.get("/api/v1/network/sessions/legacy").json()["rca"]

    assert rca["topology_available"] is False
    assert rca["hypotheses"] == []


def test_unknown_session_is_not_found(api):
    client, _key, _user = api
    assert client.get("/api/v1/network/sessions/nope").status_code == 404


def test_report_is_rendered_from_stored_evidence(api):
    client, key, _user = api
    client.post("/api/v1/network/ingest", json=batch(), headers={"X-API-Key": key})

    response = client.get("/api/v1/network/sessions/lab-test/report")

    assert response.status_code == 200
    assert "TRACEPOINT - NETWORK INVESTIGATION REPORT" in response.text
    assert "h2:h2-eth0--s1:s1-eth2" in response.text
    assert "attachment" in response.headers["content-disposition"]


def test_report_keeps_hypotheses_marked_unconfirmed(api):
    client, key, _user = api
    client.post("/api/v1/network/ingest", json=batch(), headers={"X-API-Key": key})

    text = client.get("/api/v1/network/sessions/lab-test/report").text

    assert "ROOT-CAUSE HYPOTHESES" in text
    assert "NOT CONFIRMED" in text
    assert "It is not a probability" in text
    # the surviving switch port must still be reported as contradicting
    assert "s1-eth1" in text


def test_report_for_a_session_without_topology_says_so(api):
    client, key, _user = api
    client.post(
        "/api/v1/network/ingest",
        json=batch("legacy", legacy_session()),
        headers={"X-API-Key": key},
    )

    text = client.get("/api/v1/network/sessions/legacy/report").text

    assert "Not available for this session." in text
    assert "FAULT LOCALISATION" not in text


def test_report_requires_sign_in(api):
    client, key, _user = api
    client.post("/api/v1/network/ingest", json=batch(), headers={"X-API-Key": key})

    client.post("/api/v1/auth/logout")

    assert client.get("/api/v1/network/sessions/lab-test/report").status_code == 401
