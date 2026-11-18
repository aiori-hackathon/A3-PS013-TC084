/**
 * Topology-aware root-cause analysis for network evidence.
 * Pure functional port of Python's network_rca.py.
 */

function byPhase(records) {
  const phases = {};
  for (const record of records || []) {
    const phase = record?.phase;
    if (phase && !(phase in phases)) {
      phases[phase] = record;
    }
  }
  return phases;
}

function topologyOf(record) {
  return record?.topology || {};
}

function linksOf(record) {
  return topologyOf(record).links || [];
}

function devicesOf(record) {
  return topologyOf(record).devices || [];
}

function interfacesOf(record, deviceId) {
  for (const device of devicesOf(record)) {
    if (device.id === deviceId) {
      return device.interfaces || [];
    }
  }
  return [];
}

function componentsOf(devices, links) {
  const adjacency = new Map();
  for (const d of devices) {
    if (d?.id) adjacency.set(d.id, new Set());
  }

  for (const link of links) {
    if (link?.state !== 'UP') continue;
    const s = link.source_device;
    const t = link.target_device;
    if (adjacency.has(s) && adjacency.has(t)) {
      adjacency.get(s).add(t);
      adjacency.get(t).add(s);
    }
  }

  const seen = new Set();
  const comps = [];

  for (const node of adjacency.keys()) {
    if (seen.has(node)) continue;
    const stack = [node];
    seen.add(node);
    const group = [];
    while (stack.length > 0) {
      const current = stack.pop();
      group.push(current);
      const neighbours = adjacency.get(current) || [];
      for (const neighbour of neighbours) {
        if (!seen.has(neighbour)) {
          seen.add(neighbour);
          stack.push(neighbour);
        }
      }
    }
    comps.push(group.sort());
  }

  return comps;
}

export function analyseImpact(record) {
  const devices = devicesOf(record);
  const links = linksOf(record);
  const hosts = devices.filter((d) => d.type === 'host').map((d) => d.id);

  const comps = componentsOf(devices, links);
  const membership = new Map();
  for (let i = 0; i < comps.length; i++) {
    for (const node of comps[i]) {
      membership.set(node, i);
    }
  }

  const unreachable = [];
  const reachable = [];
  for (let i = 0; i < hosts.length; i++) {
    for (let j = i + 1; j < hosts.length; j++) {
      const pair = [hosts[i], hosts[j]];
      if (membership.get(hosts[i]) !== membership.get(hosts[j])) {
        unreachable.push(pair);
      } else {
        reachable.push(pair);
      }
    }
  }

  const severed = [];
  const stranded = [];
  for (const host of hosts) {
    const peers = hosts.filter(
      (h) => h !== host && membership.get(h) === membership.get(host)
    );
    if (peers.length > 0) continue;

    const own = interfacesOf(record, host);
    const ownUp = own.filter((i) => i.operstate === 'UP');
    if (own.length > 0 && ownUp.length === 0) {
      severed.push(host);
    } else {
      stranded.push(host);
    }
  }

  return {
    components: comps,
    reachable_host_pairs: reachable,
    unreachable_host_pairs: unreachable,
    severed_hosts: severed,
    stranded_hosts: stranded,
  };
}

export function localiseFault(normalRecord, faultRecord) {
  const before = new Map();
  for (const link of linksOf(normalRecord)) {
    if (link.id) before.set(link.id, link);
  }

  const after = new Map();
  for (const link of linksOf(faultRecord)) {
    if (link.id) after.set(link.id, link);
  }

  const newlyDown = [];
  const stillUp = [];

  for (const [linkId, link] of after.entries()) {
    const state = link.state;
    const prev = before.get(linkId);
    if (state === 'DOWN') {
      if (!prev || prev.state === 'UP') {
        newlyDown.push(link);
      }
    } else if (state === 'UP') {
      stillUp.push(link);
    }
  }

  return [newlyDown, stillUp];
}

function confidenceOf(supporting, contradicting) {
  if (!supporting || supporting.length === 0) return 'INSUFFICIENT';
  if (contradicting && contradicting.length > 0) return 'LOW';
  if (supporting.length >= 3) return 'HIGH';
  if (supporting.length === 2) return 'MEDIUM';
  return 'LOW';
}

function makeHypothesis(name, supporting, contradicting, missing, verification, affected) {
  return {
    hypothesis: name,
    status: 'NOT CONFIRMED',
    confidence: confidenceOf(supporting, contradicting),
    supporting_evidence: supporting,
    contradicting_evidence: contradicting,
    missing_evidence: missing,
    verification_steps: verification,
    affected_components: affected,
  };
}

function linkHypotheses(faultRecord, link, stillUp, impact) {
  const linkId = link.id;
  const source = link.source_device;
  const target = link.target_device;
  const sourceIntf = link.source_interface;
  const targetIntf = link.target_interface;
  const endpoints = [`${source}:${sourceIntf}`, `${target}:${targetIntf}`];

  const loss = faultRecord.packet_loss_percent;
  const legacyPort = faultRecord.switch_port || {};

  function intfEntry(deviceId, name) {
    for (const entry of interfacesOf(faultRecord, deviceId)) {
      if (entry.name === name) return entry;
    }
    return {};
  }

  const sourceEntry = intfEntry(source, sourceIntf);
  const targetEntry = intfEntry(target, targetIntf);

  const hypotheses = [];

  // 1. Link failure
  const supporting1 = [];
  if (link.source_operstate === 'DOWN' && link.target_operstate === 'DOWN') {
    supporting1.push(`Both endpoints of ${linkId} report operstate DOWN.`);
  }
  supporting1.push(`Link ${linkId} was UP during the normal phase and DOWN during the fault phase.`);
  if (typeof loss === 'number' && loss > 0) {
    supporting1.push(`End-to-end packet loss measured ${loss}% during the fault phase.`);
  }
  if (legacyPort.state === 'LINK_DOWN' || legacyPort.state === 'PORT_DOWN') {
    supporting1.push(`Switch port ${legacyPort.name} reports ${legacyPort.state}.`);
  }

  hypotheses.push(
    makeHypothesis(
      `Link failure between ${source} and ${target}`,
      supporting1,
      [],
      [
        'Physical or virtual cable-level diagnostics.',
        'Independent device-side link logs from both endpoints.',
        'Interface error and discard counters.',
      ],
      [
        `Inspect both endpoints: ip link show ${sourceIntf} on ${source}, and ip link show ${targetIntf} on ${target}.`,
        `Inspect the switch view: ovs-ofctl show ${target} (or the switch owning the port).`,
      ],
      [...endpoints, String(linkId)]
    )
  );

  // 2. Administrative shutdown
  const supporting2 = [];
  const contradicting2 = [];
  for (const [label, entry] of [
    [endpoints[0], sourceEntry],
    [endpoints[1], targetEntry],
  ]) {
    if (!entry || Object.keys(entry).length === 0) continue;
    const adminUp = entry.admin_up;
    const carrierUp = entry.carrier_up;
    if (adminUp === false) {
      supporting2.push(
        `Interface ${label} reports administrative state DOWN, not merely a loss of carrier.`
      );
    } else if (adminUp === true && carrierUp === false) {
      contradicting2.push(
        `Interface ${label} remains administratively UP while carrier is lost, which is inconsistent with an administrative shutdown.`
      );
    }
  }

  hypotheses.push(
    makeHypothesis(
      'Interface administratively disabled',
      supporting2,
      contradicting2,
      [
        'Configuration change history for the affected interfaces.',
        'Command audit log identifying who changed the interface state.',
        'Comparison against an approved configuration baseline.',
      ],
      [
        `Review interface admin state: ip link show ${sourceIntf} and ip link show ${targetIntf}.`,
        'Review recent configuration or command history on both devices.',
      ],
      endpoints
    )
  );

  return hypotheses;
}

function switchHypotheses(faultRecord, downLinks, stillUp) {
  const hypotheses = [];

  for (const device of devicesOf(faultRecord)) {
    if (device.type === 'host') continue;

    const deviceId = device.id;
    const interfaces = device.interfaces || [];
    if (interfaces.length === 0) continue;

    const involved = downLinks.some(
      (link) => link.source_device === deviceId || link.target_device === deviceId
    );
    if (!involved) continue;

    const down = interfaces.filter((i) => i.operstate === 'DOWN');
    const up = interfaces.filter((i) => i.operstate === 'UP');

    let supporting = [];
    const contradicting = [];

    if (down.length > 0 && up.length === 0) {
      supporting.push(
        `All ${down.length} interface(s) on ${deviceId} report operstate DOWN.`
      );
    }
    if (down.length > 0) {
      supporting.push(
        `${down.length} interface(s) on ${deviceId} report operstate DOWN: ` +
          down
            .map((i) => i.name || '?')
            .sort()
            .join(', ') +
          '.'
      );
    }

    if (up.length > 0) {
      contradicting.push(
        `${deviceId} retains ${up.length} interface(s) in state UP (` +
          up
            .map((i) => i.name || '?')
            .sort()
            .join(', ') +
          '), which is inconsistent with a failure of the whole device.'
      );
      supporting = supporting.filter((s) => !s.startsWith('All '));
    }

    hypotheses.push(
      makeHypothesis(
        `Switch device failure on ${deviceId}`,
        supporting,
        contradicting,
        [
          'Switch process and service status.',
          'Switch system logs covering the fault window.',
          'Control-plane and datapath health indicators.',
        ],
        [
          'Check the switch is present and configured: ovs-vsctl show.',
          `Check port and datapath state: ovs-ofctl show ${deviceId}.`,
          'Check the switch service status on the host system.',
        ],
        [String(deviceId)]
      )
    );
  }

  return hypotheses;
}

function hostHypotheses(faultRecord, downLinks, impact) {
  const hypotheses = [];
  for (const hostId of impact.severed_hosts || []) {
    const interfaces = interfacesOf(faultRecord, hostId);
    const down = interfaces.filter((i) => i.operstate === 'DOWN');

    const supporting = [];
    const contradicting = [];

    if (down.length > 0) {
      supporting.push(
        `Host ${hostId} interface(s) ` +
          down
            .map((i) => i.name || '?')
            .sort()
            .join(', ') +
          ' report operstate DOWN.'
      );
    }
    supporting.push(`Host ${hostId} has no remaining path to any other host.`);

    for (const link of downLinks) {
      let peer = null;
      let peerIntf = null;
      if (link.source_device === hostId) {
        peer = link.target_device;
        peerIntf = link.target_interface;
      } else if (link.target_device === hostId) {
        peer = link.source_device;
        peerIntf = link.source_interface;
      }
      if (!peer) continue;

      for (const entry of interfacesOf(faultRecord, peer)) {
        if (entry.name === peerIntf && entry.admin_up === false) {
          contradicting.push(
            `The peer interface ${peer}:${peerIntf} was administratively brought DOWN. A host power loss or crash would not change administrative state on the peer device.`
          );
        }
      }
    }

    hypotheses.push(
      makeHypothesis(
        `Host failure or shutdown on ${hostId}`,
        supporting,
        contradicting,
        [
          'Host liveness evidence (process table, uptime, console access).',
          'Host power state.',
          'Out-of-band reachability independent of the affected link.',
        ],
        [
          `Attempt out-of-band access to ${hostId}.`,
          'Check host uptime and recent restarts.',
          'Confirm whether the host responds on any other interface.',
        ],
        [String(hostId)]
      )
    );
  }

  return hypotheses;
}

export function analyse(records) {
  const phases = byPhase(records);
  const normalRecord = phases.normal;
  const faultRecord = phases.fault;
  const recoveredRecord = phases.recovered;

  const available =
    devicesOf(faultRecord).length > 0 && linksOf(faultRecord).length > 0;

  if (!available) {
    return {
      topology_available: false,
      observed_facts: [],
      fault_localisation: null,
      impact: null,
      hypotheses: [],
      recovery: null,
      limitations: [
        'This evidence session contains no topology snapshot, so topology-aware fault localisation could not be performed.',
        'Devices, interfaces and links were not enumerated when this evidence was collected.',
        'No conclusion about fault location can be drawn from this session beyond the single-interface observations it contains.',
      ],
    };
  }

  const [downLinks, stillUp] = localiseFault(normalRecord, faultRecord);
  const impact = analyseImpact(faultRecord);

  const facts = [];
  for (const link of downLinks) {
    facts.push(
      `Link ${link.id} changed from UP to DOWN between the normal and fault phases.`
    );
  }
  for (const link of stillUp) {
    facts.push(`Link ${link.id} remained UP during the fault phase.`);
  }
  for (const pair of impact.unreachable_host_pairs || []) {
    facts.push(
      `Hosts ${pair.join(' and ')} had no connecting path through UP links during the fault phase.`
    );
  }
  for (const host of impact.severed_hosts || []) {
    facts.push(
      `Host ${host} had all interfaces DOWN and no path to any other host during the fault phase.`
    );
  }
  for (const host of impact.stranded_hosts || []) {
    facts.push(
      `Host ${host} retained an UP interface but could not reach any other host during the fault phase; its loss of reachability originates elsewhere in the topology.`
    );
  }

  const hypotheses = [];
  for (const link of downLinks) {
    hypotheses.push(...linkHypotheses(faultRecord, link, stillUp, impact));
  }
  hypotheses.push(...switchHypotheses(faultRecord, downLinks, stillUp));
  hypotheses.push(...hostHypotheses(faultRecord, downLinks, impact));

  const order = { HIGH: 0, MEDIUM: 1, LOW: 2, INSUFFICIENT: 3 };
  hypotheses.sort((a, b) => (order[a.confidence] ?? 9) - (order[b.confidence] ?? 9));

  let recovery = null;
  if (recoveredRecord) {
    const recoveredLinks = linksOf(recoveredRecord);
    const restored = recoveredLinks.filter((l) => l.state === 'UP').map((l) => l.id);
    const stillDown = recoveredLinks.filter((l) => l.state === 'DOWN').map((l) => l.id);
    recovery = {
      links_up: restored,
      links_still_down: stillDown,
      packet_loss_percent: recoveredRecord.packet_loss_percent,
      assessment:
        stillDown.length === 0
          ? `All discovered links report UP and measured packet loss returned to ${recoveredRecord.packet_loss_percent}%.`
          : 'One or more links remain DOWN after the recovery action.',
    };
  }

  const limitations = [
    'Evidence was collected in a Mininet simulated environment; it does not establish physical-layer behaviour.',
    'Confidence labels rank evidential support only. They are not probabilities and no hypothesis here is a confirmed cause.',
    'Link state is derived from interface operstate at both endpoints; no independent link-layer telemetry was collected.',
    'Reachability is inferred from topology connectivity, not from per-pair connectivity testing.',
    'Timestamp proximity shows ordering within a recorded phase; it does not by itself establish causation.',
  ];

  return {
    topology_available: true,
    observed_facts: facts,
    fault_localisation: {
      affected_links: downLinks.map((l) => l.id),
      unaffected_links: stillUp.map((l) => l.id),
      method:
        'Link state compared between the normal and fault phases of the same evidence session.',
    },
    impact,
    hypotheses,
    recovery,
    limitations,
  };
}
