"""Tests for topology-aware network root-cause analysis.

These lock in the distinctions the engine exists to make:

  * a single downed port must not be reported as a failed switch
  * a host that merely lost its peers must not be named as a suspect
  * evidence without a topology snapshot must refuse to analyse rather
    than guess
  * no hypothesis is ever reported as confirmed
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import network_rca


def interface(name, operstate, admin_up, carrier_up, ip=None, port=None):
    entry = {
        "name": name,
        "mac": "00:00:00:00:00:01",
        "ip": ip,
        "operstate": operstate,
        "admin_up": admin_up,
        "carrier_up": carrier_up,
    }
    if port is not None:
        entry["port_number"] = port
    return entry


def topology(h2_state):
    """Two hosts on one switch. h2's link follows the requested state."""
    up = h2_state == "UP"
    return {
        "captured_at": "2026-11-15T11:30:00+00:00",
        "source": "mininet_api",
        "schema_version": 1,
        "devices": [
            {
                "id": "h1", "name": "h1", "type": "host",
                "interfaces": [interface("h1-eth0", "UP", True, True, ip="10.0.0.1")],
            },
            {
                "id": "h2", "name": "h2", "type": "host",
                "interfaces": [interface("h2-eth0", h2_state, up, up, ip="10.0.0.2")],
            },
            {
                "id": "s1", "name": "s1", "type": "switch",
                "interfaces": [
                    interface("s1-eth1", "UP", True, True, port=1),
                    interface("s1-eth2", h2_state, up, up, port=2),
                ],
            },
        ],
        "links": [
            {
                "id": "h1:h1-eth0--s1:s1-eth1",
                "source_device": "h1", "source_interface": "h1-eth0",
                "source_operstate": "UP",
                "target_device": "s1", "target_interface": "s1-eth1",
                "target_operstate": "UP",
                "state": "UP", "active": True,
            },
            {
                "id": "h2:h2-eth0--s1:s1-eth2",
                "source_device": "h2", "source_interface": "h2-eth0",
                "source_operstate": h2_state,
                "target_device": "s1", "target_interface": "s1-eth2",
                "target_operstate": h2_state,
                "state": h2_state, "active": up,
            },
        ],
        "errors": [],
    }


def session():
    return [
        {
            "timestamp_utc": "2026-11-15T11:30:00+00:00", "phase": "normal",
            "packet_loss_percent": 0.0, "h2_interface_state": "UP",
            "switch_port": {"name": "s1-eth2", "config": "0", "state": "0"},
            "topology": topology("UP"),
        },
        {
            "timestamp_utc": "2026-11-15T11:30:30+00:00", "phase": "fault",
            "packet_loss_percent": 100.0, "h2_interface_state": "DOWN",
            "switch_port": {"name": "s1-eth2", "config": "PORT_DOWN", "state": "LINK_DOWN"},
            "topology": topology("DOWN"),
        },
        {
            "timestamp_utc": "2026-11-15T11:31:00+00:00", "phase": "recovered",
            "packet_loss_percent": 0.0, "h2_interface_state": "UP",
            "switch_port": {"name": "s1-eth2", "config": "0", "state": "0"},
            "topology": topology("UP"),
        },
    ]


def legacy_session():
    """Evidence recorded before topology capture existed."""
    return [
        {
            "timestamp_utc": "2026-11-14T17:33:50+00:00", "phase": "normal",
            "packet_loss_percent": 0.0, "h2_interface_state": "UP",
            "switch_port": {"name": "s1-eth2", "config": "0", "state": "0"},
        },
        {
            "timestamp_utc": "2026-11-14T17:34:20+00:00", "phase": "fault",
            "packet_loss_percent": 100.0, "h2_interface_state": "DOWN",
            "switch_port": {"name": "s1-eth2", "config": "PORT_DOWN", "state": "LINK_DOWN"},
        },
    ]


def named(result, fragment):
    for hypothesis in result["hypotheses"]:
        if fragment in hypothesis["hypothesis"]:
            return hypothesis
    return None


def test_localises_the_failed_link_and_leaves_the_healthy_one_alone():
    result = network_rca.analyse(session())
    localisation = result["fault_localisation"]

    assert result["topology_available"] is True
    assert localisation["affected_links"] == ["h2:h2-eth0--s1:s1-eth2"]
    assert localisation["unaffected_links"] == ["h1:h1-eth0--s1:s1-eth1"]


def test_separates_the_severed_host_from_the_stranded_one():
    impact = network_rca.analyse(session())["impact"]

    # h2 is at the fault; h1 is healthy and merely lost its peer.
    assert impact["severed_hosts"] == ["h2"]
    assert impact["stranded_hosts"] == ["h1"]
    assert impact["unreachable_host_pairs"] == [["h1", "h2"]]


def test_does_not_accuse_a_healthy_host():
    result = network_rca.analyse(session())
    assert named(result, "h1") is None, "a host with an UP interface is not a suspect"


def test_one_down_port_does_not_condemn_the_whole_switch():
    switch = named(network_rca.analyse(session()), "Switch device failure")

    assert switch is not None
    assert switch["confidence"] == "LOW"
    assert any("s1-eth1" in item for item in switch["contradicting_evidence"]), (
        "the surviving port must be reported as contradicting evidence"
    )


def test_link_failure_is_the_best_supported_hypothesis():
    result = network_rca.analyse(session())
    top = result["hypotheses"][0]

    assert "Link failure" in top["hypothesis"]
    assert top["confidence"] == "HIGH"
    assert not top["contradicting_evidence"]
    assert len(top["supporting_evidence"]) >= 3


def test_nothing_is_ever_reported_as_confirmed():
    result = network_rca.analyse(session())

    assert result["hypotheses"]
    for hypothesis in result["hypotheses"]:
        assert hypothesis["status"] == "NOT CONFIRMED"
        assert hypothesis["confidence"] in {"HIGH", "MEDIUM", "LOW", "INSUFFICIENT"}
        assert hypothesis["verification_steps"], "every hypothesis needs a way to check it"


def test_recovery_is_verified_from_evidence():
    recovery = network_rca.analyse(session())["recovery"]

    assert recovery["links_still_down"] == []
    assert recovery["packet_loss_percent"] == 0.0


def test_evidence_without_topology_refuses_rather_than_guesses():
    result = network_rca.analyse(legacy_session())

    assert result["topology_available"] is False
    assert result["hypotheses"] == []
    assert result["fault_localisation"] is None
    assert any("no topology snapshot" in item for item in result["limitations"])


def test_empty_evidence_does_not_raise():
    result = network_rca.analyse([])
    assert result["topology_available"] is False
