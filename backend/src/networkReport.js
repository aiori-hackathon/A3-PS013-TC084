/**
 * Investigation report for a network session.
 * Ported from network_report.py.
 */

import { utcNowIso } from './isotime.js';

const RULE = '='.repeat(62);
const THIN = '-'.repeat(46);

function bullets(lines, items, empty = null) {
  if (items && items.length > 0) {
    for (const item of items) {
      lines.push(`- ${item}`);
    }
  } else if (empty) {
    lines.push(`- ${empty}`);
  }
}

function phaseTable(lines, observations) {
  lines.push('OBSERVATIONS');
  lines.push(THIN);
  for (const record of observations || []) {
    const phase = String(record?.phase || '?').toUpperCase();
    const loss = record?.packet_loss_percent;
    const lossText = loss === null || loss === undefined ? 'unknown' : `${loss}%`;
    lines.push(
      `${phase} - ${record?.timestamp_utc || 'unknown time'} - packet loss ${lossText}`
    );

    const topology = record?.topology || {};
    for (const link of topology.links || []) {
      lines.push(`    link ${link.id}: ${link.state}`);
    }
  }
  lines.push('');
}

function hypothesesSection(lines, hypotheses) {
  lines.push('ROOT-CAUSE HYPOTHESES');
  lines.push(THIN);
  lines.push('Confidence ranks how well the collected evidence supports a');
  lines.push('hypothesis. It is not a probability, and no hypothesis below');
  lines.push('has been confirmed.');

  for (const item of hypotheses || []) {
    lines.push('');
    lines.push(`Hypothesis: ${item.hypothesis}`);
    lines.push(`Confidence: ${item.confidence}`);
    lines.push(`Status: ${item.status}`);

    lines.push('Supporting evidence:');
    bullets(lines, item.supporting_evidence, 'None recorded.');

    lines.push('Contradicting evidence:');
    bullets(lines, item.contradicting_evidence, 'None identified from the available evidence.');

    if (item.missing_evidence && item.missing_evidence.length > 0) {
      lines.push('Missing evidence:');
      bullets(lines, item.missing_evidence);
    }

    if (item.verification_steps && item.verification_steps.length > 0) {
      lines.push('Suggested verification:');
      bullets(lines, item.verification_steps);
    }
  }
  lines.push('');
}

export function build(session, observations, rca) {
  const lines = [
    'TRACEPOINT - NETWORK INVESTIGATION REPORT',
    RULE,
    '',
    `Session: ${session?.session_id}`,
    `Collector: ${session?.device_id}`,
    `Source evidence: ${session?.source || 'not recorded'}`,
    `Evidence SHA-256: ${session?.sha256}`,
    `Received: ${session?.received_at}`,
    `Report generated: ${utcNowIso()}`,
    `Observations: ${(observations || []).length}`,
    '',
  ];

  phaseTable(lines, observations);

  if (!rca?.topology_available) {
    lines.push('TOPOLOGY-AWARE ANALYSIS');
    lines.push(THIN);
    lines.push('Not available for this session.');
    bullets(lines, rca?.limitations);
    lines.push('');
  } else {
    const localisation = rca.fault_localisation || {};
    const affected = localisation.affected_links || [];
    const unaffected = localisation.unaffected_links || [];

    lines.push('FAULT LOCALISATION');
    lines.push(THIN);
    lines.push(`Affected link(s): ${affected.join(', ') || 'none'}`);
    lines.push(`Unaffected link(s): ${unaffected.join(', ') || 'none'}`);
    lines.push(`Method: ${localisation.method || 'unspecified'}`);
    lines.push('');

    lines.push('OBSERVED FACTS');
    lines.push(THIN);
    lines.push('Each statement below is supported directly by the');
    lines.push('collected evidence.');
    bullets(lines, rca.observed_facts, 'None recorded.');
    lines.push('');

    const impact = rca.impact || {};
    const impactLines = [];
    for (const pair of impact.unreachable_host_pairs || []) {
      impactLines.push(`No path between ${pair.join(' and ')}.`);
    }
    for (const host of impact.severed_hosts || []) {
      impactLines.push(`${host}: all own interfaces DOWN (at the fault).`);
    }
    for (const host of impact.stranded_hosts || []) {
      impactLines.push(`${host}: interfaces UP but cut off by a fault elsewhere.`);
    }
    if (impactLines.length > 0) {
      lines.push('IMPACT');
      lines.push(THIN);
      bullets(lines, impactLines);
      lines.push('');
    }

    hypothesesSection(lines, rca.hypotheses || []);

    const recovery = rca.recovery || {};
    if (recovery.assessment) {
      lines.push('RECOVERY VERIFICATION');
      lines.push(THIN);
      lines.push(recovery.assessment);
      lines.push('');
    }

    lines.push('LIMITATIONS');
    lines.push(THIN);
    bullets(lines, rca.limitations);
    lines.push('');
  }

  lines.push(
    'INTEGRITY',
    THIN,
    'The SHA-256 above covers the evidence bytes as received by',
    'Tracepoint. It shows the stored session has not changed since',
    'collection. It does not establish what happened on the network,',
    'and it cannot detect replacement of both the evidence and the',
    'record of its hash.',
    '',
    'This analysis is derived from the stored evidence and is not',
    'itself evidence. Regenerating this report re-derives it.'
  );

  return lines.join('\n') + '\n';
}
