"""
Topology-aware root-cause analysis for network evidence.

Ported from the Tracepoint Network Lab (Mininet) analyser. This module is
pure: it takes observation records and returns analysis. It performs no I/O,
holds no state, and never writes evidence.

Forensic contract enforced throughout this module:

  OBSERVED FACT        directly supported by collected evidence
  ROOT-CAUSE HYPOTHESIS a proposed explanation requiring verification
  CONFIRMED ROOT CAUSE  a hypothesis supported by sufficient verification

Nothing in this module ever produces a CONFIRMED ROOT CAUSE. Confidence
labels rank how well the collected evidence supports a hypothesis; they
are not probabilities and they never mean a cause is established.

Evidence recorded before topology capture existed has no "topology" key.
Such sessions degrade gracefully: the engine reports what it cannot do
rather than guessing.
"""


def _by_phase(records):
    phases = {}
    for record in records or []:
        phase = record.get("phase")
        if phase and phase not in phases:
            phases[phase] = record
    return phases


def _topology(record):
    return (record or {}).get("topology") or {}


def _links(record):
    return _topology(record).get("links") or []


def _devices(record):
    return _topology(record).get("devices") or []


def _interfaces(record, device_id):
    for device in _devices(record):
        if device.get("id") == device_id:
            return device.get("interfaces") or []
    return []


def _components(devices, links):
    """Connected components using only links whose state is UP."""
    adjacency = {device.get("id"): set() for device in devices}

    for link in links:
        if link.get("state") != "UP":
            continue
        source = link.get("source_device")
        target = link.get("target_device")
        if source in adjacency and target in adjacency:
            adjacency[source].add(target)
            adjacency[target].add(source)

    seen = set()
    components = []

    for node in adjacency:
        if node in seen:
            continue
        stack = [node]
        seen.add(node)
        group = []
        while stack:
            current = stack.pop()
            group.append(current)
            for neighbour in adjacency[current]:
                if neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
        components.append(sorted(group))

    return components


def analyse_impact(record):
    """Which hosts can still reach each other, given only UP links."""
    devices = _devices(record)
    links = _links(record)
    hosts = [d.get("id") for d in devices if d.get("type") == "host"]

    components = _components(devices, links)
    membership = {}
    for index, group in enumerate(components):
        for node in group:
            membership[node] = index

    unreachable = []
    reachable = []
    for i, first in enumerate(hosts):
        for second in hosts[i + 1:]:
            pair = [first, second]
            if membership.get(first) != membership.get(second):
                unreachable.append(pair)
            else:
                reachable.append(pair)

    # A host with no reachable peers is not automatically a suspect. If its
    # own interfaces are still UP, it lost reachability because of a fault
    # elsewhere - it is a victim, not a cause. Conflating the two would
    # point an investigator at a healthy device.
    severed = []
    stranded = []
    for host in hosts:
        peers = [h for h in hosts
                 if h != host and membership.get(h) == membership.get(host)]
        if peers:
            continue
        own = _interfaces(record, host)
        own_up = [i for i in own if i.get("operstate") == "UP"]
        if own and not own_up:
            severed.append(host)
        else:
            stranded.append(host)

    return {
        "components": components,
        "reachable_host_pairs": reachable,
        "unreachable_host_pairs": unreachable,
        "severed_hosts": severed,
        "stranded_hosts": stranded
    }


def localise_fault(normal_record, fault_record):
    """Links that were UP during NORMAL and DOWN during FAULT."""
    before = {link.get("id"): link for link in _links(normal_record)}
    after = {link.get("id"): link for link in _links(fault_record)}

    newly_down = []
    still_up = []

    for link_id, link in after.items():
        state = link.get("state")
        previous = before.get(link_id)
        if state == "DOWN":
            if previous is None or previous.get("state") == "UP":
                newly_down.append(link)
        elif state == "UP":
            still_up.append(link)

    return newly_down, still_up


def _confidence(supporting, contradicting):
    if not supporting:
        return "INSUFFICIENT"
    if contradicting:
        return "LOW"
    if len(supporting) >= 3:
        return "HIGH"
    if len(supporting) == 2:
        return "MEDIUM"
    return "LOW"


def _hypothesis(name, supporting, contradicting, missing, verification,
                affected):
    return {
        "hypothesis": name,
        "status": "NOT CONFIRMED",
        "confidence": _confidence(supporting, contradicting),
        "supporting_evidence": supporting,
        "contradicting_evidence": contradicting,
        "missing_evidence": missing,
        "verification_steps": verification,
        "affected_components": affected
    }


def _link_hypotheses(fault_record, link, still_up, impact):
    link_id = link.get("id")
    source = link.get("source_device")
    target = link.get("target_device")
    source_intf = link.get("source_interface")
    target_intf = link.get("target_interface")
    endpoints = [source + ":" + str(source_intf), target + ":" + str(target_intf)]

    loss = fault_record.get("packet_loss_percent")
    legacy_port = fault_record.get("switch_port") or {}

    def intf_entry(device_id, name):
        for entry in _interfaces(fault_record, device_id):
            if entry.get("name") == name:
                return entry
        return {}

    source_entry = intf_entry(source, source_intf)
    target_entry = intf_entry(target, target_intf)

    hypotheses = []

    # --- 1. link failure -------------------------------------------------
    supporting = []
    if link.get("source_operstate") == "DOWN" and link.get("target_operstate") == "DOWN":
        supporting.append(
            "Both endpoints of " + str(link_id) + " report operstate DOWN."
        )
    supporting.append(
        "Link " + str(link_id) + " was UP during the normal phase and DOWN "
        "during the fault phase."
    )
    if isinstance(loss, (int, float)) and loss > 0:
        supporting.append(
            "End-to-end packet loss measured " + str(loss) + "% during the fault phase."
        )
    if legacy_port.get("state") in ("LINK_DOWN", "PORT_DOWN"):
        supporting.append(
            "Switch port " + str(legacy_port.get("name")) + " reports "
            + str(legacy_port.get("state")) + "."
        )

    hypotheses.append(_hypothesis(
        "Link failure between " + str(source) + " and " + str(target),
        supporting,
        [],
        [
            "Physical or virtual cable-level diagnostics.",
            "Independent device-side link logs from both endpoints.",
            "Interface error and discard counters."
        ],
        [
            "Inspect both endpoints: ip link show " + str(source_intf)
            + " on " + str(source) + ", and ip link show " + str(target_intf)
            + " on " + str(target) + ".",
            "Inspect the switch view: ovs-ofctl show " + str(target)
            + " (or the switch owning the port)."
        ],
        endpoints + [str(link_id)]
    ))

    # --- 2. administrative shutdown --------------------------------------
    supporting = []
    contradicting = []
    for label, entry in ((endpoints[0], source_entry), (endpoints[1], target_entry)):
        if not entry:
            continue
        admin_up = entry.get("admin_up")
        carrier_up = entry.get("carrier_up")
        if admin_up is False:
            supporting.append(
                "Interface " + label + " reports administrative state DOWN, "
                "not merely a loss of carrier."
            )
        elif admin_up is True and carrier_up is False:
            contradicting.append(
                "Interface " + label + " remains administratively UP while "
                "carrier is lost, which is inconsistent with an administrative "
                "shutdown."
            )

    hypotheses.append(_hypothesis(
        "Interface administratively disabled",
        supporting,
        contradicting,
        [
            "Configuration change history for the affected interfaces.",
            "Command audit log identifying who changed the interface state.",
            "Comparison against an approved configuration baseline."
        ],
        [
            "Review interface admin state: ip link show " + str(source_intf)
            + " and ip link show " + str(target_intf) + ".",
            "Review recent configuration or command history on both devices."
        ],
        endpoints
    ))

    return hypotheses


def _switch_hypotheses(fault_record, down_links, still_up):
    """A single downed port must not be reported as a failed switch."""
    hypotheses = []

    for device in _devices(fault_record):
        if device.get("type") == "host":
            continue

        device_id = device.get("id")
        interfaces = device.get("interfaces") or []
        if not interfaces:
            continue

        involved = any(
            link.get("source_device") == device_id
            or link.get("target_device") == device_id
            for link in down_links
        )
        if not involved:
            continue

        down = [i for i in interfaces if i.get("operstate") == "DOWN"]
        up = [i for i in interfaces if i.get("operstate") == "UP"]

        supporting = []
        contradicting = []

        if down and not up:
            supporting.append(
                "All " + str(len(down)) + " interface(s) on " + str(device_id)
                + " report operstate DOWN."
            )
        if down:
            supporting.append(
                str(len(down)) + " interface(s) on " + str(device_id)
                + " report operstate DOWN: "
                + ", ".join(sorted(i.get("name", "?") for i in down)) + "."
            )

        if up:
            contradicting.append(
                str(device_id) + " retains " + str(len(up))
                + " interface(s) in state UP ("
                + ", ".join(sorted(i.get("name", "?") for i in up))
                + "), which is inconsistent with a failure of the whole device."
            )
            supporting = [s for s in supporting if "All " not in s]

        hypotheses.append(_hypothesis(
            "Switch device failure on " + str(device_id),
            supporting,
            contradicting,
            [
                "Switch process and service status.",
                "Switch system logs covering the fault window.",
                "Control-plane and datapath health indicators."
            ],
            [
                "Check the switch is present and configured: ovs-vsctl show.",
                "Check port and datapath state: ovs-ofctl show " + str(device_id) + ".",
                "Check the switch service status on the host system."
            ],
            [str(device_id)]
        ))

    return hypotheses


def _host_hypotheses(fault_record, down_links, impact):
    hypotheses = []
    # Only hosts whose own interfaces are down are candidates for host
    # failure. A host that merely lost its peers is a victim of a fault
    # elsewhere; naming it as a suspect would mislead the investigation.
    for host_id in impact.get("severed_hosts") or []:
        interfaces = _interfaces(fault_record, host_id)
        down = [i for i in interfaces if i.get("operstate") == "DOWN"]

        supporting = []
        contradicting = []

        if down:
            supporting.append(
                "Host " + str(host_id) + " interface(s) "
                + ", ".join(sorted(i.get("name", "?") for i in down))
                + " report operstate DOWN."
            )
        supporting.append(
            "Host " + str(host_id) + " has no remaining path to any other host."
        )

        for link in down_links:
            peer = None
            if link.get("source_device") == host_id:
                peer, peer_intf = link.get("target_device"), link.get("target_interface")
            elif link.get("target_device") == host_id:
                peer, peer_intf = link.get("source_device"), link.get("source_interface")
            if not peer:
                continue
            for entry in _interfaces(fault_record, peer):
                if entry.get("name") == peer_intf and entry.get("admin_up") is False:
                    contradicting.append(
                        "The peer interface " + str(peer) + ":" + str(peer_intf)
                        + " was administratively brought DOWN. A host power loss "
                        "or crash would not change administrative state on the "
                        "peer device."
                    )

        hypotheses.append(_hypothesis(
            "Host failure or shutdown on " + str(host_id),
            supporting,
            contradicting,
            [
                "Host liveness evidence (process table, uptime, console access).",
                "Host power state.",
                "Out-of-band reachability independent of the affected link."
            ],
            [
                "Attempt out-of-band access to " + str(host_id) + ".",
                "Check host uptime and recent restarts.",
                "Confirm whether the host responds on any other interface."
            ],
            [str(host_id)]
        ))

    return hypotheses


def analyse(records):
    """Entry point. Returns topology-aware RCA, or an explicit refusal."""
    phases = _by_phase(records)
    normal_record = phases.get("normal")
    fault_record = phases.get("fault")
    recovered_record = phases.get("recovered")

    available = bool(_devices(fault_record)) and bool(_links(fault_record))

    if not available:
        return {
            "topology_available": False,
            "observed_facts": [],
            "fault_localisation": None,
            "impact": None,
            "hypotheses": [],
            "recovery": None,
            "limitations": [
                "This evidence session contains no topology snapshot, so "
                "topology-aware fault localisation could not be performed.",
                "Devices, interfaces and links were not enumerated when this "
                "evidence was collected.",
                "No conclusion about fault location can be drawn from this "
                "session beyond the single-interface observations it contains."
            ]
        }

    down_links, still_up = localise_fault(normal_record, fault_record)
    impact = analyse_impact(fault_record)

    facts = []
    for link in down_links:
        facts.append(
            "Link " + str(link.get("id")) + " changed from UP to DOWN between "
            "the normal and fault phases."
        )
    for link in still_up:
        facts.append(
            "Link " + str(link.get("id")) + " remained UP during the fault phase."
        )
    for pair in impact.get("unreachable_host_pairs") or []:
        facts.append(
            "Hosts " + " and ".join(pair) + " had no connecting path through "
            "UP links during the fault phase."
        )
    for host in impact.get("severed_hosts") or []:
        facts.append(
            "Host " + str(host) + " had all interfaces DOWN and no path to any "
            "other host during the fault phase."
        )
    for host in impact.get("stranded_hosts") or []:
        facts.append(
            "Host " + str(host) + " retained an UP interface but could not reach "
            "any other host during the fault phase; its loss of reachability "
            "originates elsewhere in the topology."
        )

    hypotheses = []
    for link in down_links:
        hypotheses.extend(_link_hypotheses(fault_record, link, still_up, impact))
    hypotheses.extend(_switch_hypotheses(fault_record, down_links, still_up))
    hypotheses.extend(_host_hypotheses(fault_record, down_links, impact))

    order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "INSUFFICIENT": 3}
    hypotheses.sort(key=lambda h: order.get(h.get("confidence"), 9))

    recovery = None
    if recovered_record is not None:
        recovered_links = _links(recovered_record)
        restored = [l.get("id") for l in recovered_links if l.get("state") == "UP"]
        still_down = [l.get("id") for l in recovered_links if l.get("state") == "DOWN"]
        recovery = {
            "links_up": restored,
            "links_still_down": still_down,
            "packet_loss_percent": recovered_record.get("packet_loss_percent"),
            "assessment": (
                "All discovered links report UP and measured packet loss "
                "returned to " + str(recovered_record.get("packet_loss_percent"))
                + "%." if not still_down else
                "One or more links remain DOWN after the recovery action."
            )
        }

    limitations = [
        "Evidence was collected in a Mininet simulated environment; it does "
        "not establish physical-layer behaviour.",
        "Confidence labels rank evidential support only. They are not "
        "probabilities and no hypothesis here is a confirmed cause.",
        "Link state is derived from interface operstate at both endpoints; "
        "no independent link-layer telemetry was collected.",
        "Reachability is inferred from topology connectivity, not from "
        "per-pair connectivity testing.",
        "Timestamp proximity shows ordering within a recorded phase; it does "
        "not by itself establish causation."
    ]

    return {
        "topology_available": True,
        "observed_facts": facts,
        "fault_localisation": {
            "affected_links": [l.get("id") for l in down_links],
            "unaffected_links": [l.get("id") for l in still_up],
            "method": "Link state compared between the normal and fault "
                      "phases of the same evidence session."
        },
        "impact": impact,
        "hypotheses": hypotheses,
        "recovery": recovery,
        "limitations": limitations
    }
