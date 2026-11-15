"""Investigation report for a network session.

The report is written from stored evidence and analysis derived from it at
the moment of writing. It is a rendering, not a record: nothing here is
persisted, so a report can always be regenerated from the evidence and
will reflect the analysis as it stands rather than as it once stood.

The forensic separation is carried into the text. Observed facts and
hypotheses appear under different headings, every hypothesis is marked
NOT CONFIRMED, and confidence is labelled as evidential support rather
than likelihood.
"""

from datetime import datetime, timezone


RULE = "=" * 62
THIN = "-" * 46


def _bullets(lines, items, empty=None):
    if items:
        lines.extend(f"- {item}" for item in items)
    elif empty:
        lines.append(f"- {empty}")


def _phase_table(lines, observations):
    lines.append("OBSERVATIONS")
    lines.append(THIN)
    # Written without column padding so the report stays readable in a
    # proportional typeface as well as a fixed-width one.
    for record in observations:
        phase = str(record.get("phase", "?")).upper()
        loss = record.get("packet_loss_percent")
        loss_text = "unknown" if loss is None else f"{loss}%"
        lines.append(
            f"{phase} - {record.get('timestamp_utc', 'unknown time')}"
            f" - packet loss {loss_text}"
        )

        topology = record.get("topology") or {}
        for link in topology.get("links") or []:
            lines.append(f"    link {link.get('id')}: {link.get('state')}")
    lines.append("")


def _hypotheses(lines, hypotheses):
    lines.append("ROOT-CAUSE HYPOTHESES")
    lines.append(THIN)
    lines.append("Confidence ranks how well the collected evidence supports a")
    lines.append("hypothesis. It is not a probability, and no hypothesis below")
    lines.append("has been confirmed.")

    for item in hypotheses:
        lines.append("")
        lines.append(f"Hypothesis: {item.get('hypothesis')}")
        lines.append(f"Confidence: {item.get('confidence')}")
        lines.append(f"Status: {item.get('status')}")

        lines.append("Supporting evidence:")
        _bullets(lines, item.get("supporting_evidence"), "None recorded.")

        lines.append("Contradicting evidence:")
        _bullets(lines, item.get("contradicting_evidence"),
                 "None identified from the available evidence.")

        if item.get("missing_evidence"):
            lines.append("Missing evidence:")
            _bullets(lines, item.get("missing_evidence"))

        if item.get("verification_steps"):
            lines.append("Suggested verification:")
            _bullets(lines, item.get("verification_steps"))
    lines.append("")


def build(session, observations, rca):
    """Render a plain-text investigation report."""
    lines = [
        "TRACEPOINT - NETWORK INVESTIGATION REPORT",
        RULE,
        "",
        f"Session: {session.get('session_id')}",
        f"Collector: {session.get('device_id')}",
        f"Source evidence: {session.get('source') or 'not recorded'}",
        f"Evidence SHA-256: {session.get('sha256')}",
        f"Received: {session.get('received_at')}",
        f"Report generated: {datetime.now(timezone.utc).isoformat()}",
        f"Observations: {len(observations)}",
        "",
    ]

    _phase_table(lines, observations)

    if not rca.get("topology_available"):
        lines.append("TOPOLOGY-AWARE ANALYSIS")
        lines.append(THIN)
        lines.append("Not available for this session.")
        _bullets(lines, rca.get("limitations"))
        lines.append("")
    else:
        localisation = rca.get("fault_localisation") or {}
        affected = localisation.get("affected_links") or []
        unaffected = localisation.get("unaffected_links") or []

        lines.append("FAULT LOCALISATION")
        lines.append(THIN)
        lines.append("Affected link(s): " + (", ".join(affected) or "none"))
        lines.append("Unaffected link(s): " + (", ".join(unaffected) or "none"))
        lines.append("Method: " + str(localisation.get("method", "unspecified")))
        lines.append("")

        lines.append("OBSERVED FACTS")
        lines.append(THIN)
        lines.append("Each statement below is supported directly by the")
        lines.append("collected evidence.")
        _bullets(lines, rca.get("observed_facts"), "None recorded.")
        lines.append("")

        impact = rca.get("impact") or {}
        impact_lines = []
        for pair in impact.get("unreachable_host_pairs") or []:
            impact_lines.append("No path between " + " and ".join(pair) + ".")
        for host in impact.get("severed_hosts") or []:
            impact_lines.append(f"{host}: all own interfaces DOWN (at the fault).")
        for host in impact.get("stranded_hosts") or []:
            impact_lines.append(
                f"{host}: interfaces UP but cut off by a fault elsewhere."
            )
        if impact_lines:
            lines.append("IMPACT")
            lines.append(THIN)
            _bullets(lines, impact_lines)
            lines.append("")

        _hypotheses(lines, rca.get("hypotheses") or [])

        recovery = rca.get("recovery") or {}
        if recovery.get("assessment"):
            lines.append("RECOVERY VERIFICATION")
            lines.append(THIN)
            lines.append(recovery["assessment"])
            lines.append("")

        lines.append("LIMITATIONS")
        lines.append(THIN)
        _bullets(lines, rca.get("limitations"))
        lines.append("")

    lines.extend([
        "INTEGRITY",
        THIN,
        "The SHA-256 above covers the evidence bytes as received by",
        "Tracepoint. It shows the stored session has not changed since",
        "collection. It does not establish what happened on the network,",
        "and it cannot detect replacement of both the evidence and the",
        "record of its hash.",
        "",
        "This analysis is derived from the stored evidence and is not",
        "itself evidence. Regenerating this report re-derives it.",
    ])

    return "\n".join(lines) + "\n"
