import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as networkRca from '../src/networkRca.js';
import * as networkReport from '../src/networkReport.js';

function makeInterface(name, operstate, adminUp, carrierUp, ip = null, port = null) {
  const entry = {
    name,
    mac: '00:00:00:00:00:01',
    ip,
    operstate,
    admin_up: adminUp,
    carrier_up: carrierUp,
  };
  if (port !== null) entry.port_number = port;
  return entry;
}

function makeTopology(h2State) {
  const up = h2State === 'UP';
  return {
    captured_at: '2026-11-15T11:30:00+00:00',
    source: 'mininet_api',
    schema_version: 1,
    devices: [
      {
        id: 'h1',
        name: 'h1',
        type: 'host',
        interfaces: [makeInterface('h1-eth0', 'UP', true, true, '10.0.0.1')],
      },
      {
        id: 'h2',
        name: 'h2',
        type: 'host',
        interfaces: [makeInterface('h2-eth0', h2State, up, up, '10.0.0.2')],
      },
      {
        id: 's1',
        name: 's1',
        type: 'switch',
        interfaces: [
          makeInterface('s1-eth1', 'UP', true, true, null, 1),
          makeInterface('s1-eth2', h2State, up, up, null, 2),
        ],
      },
    ],
    links: [
      {
        id: 'h1:h1-eth0--s1:s1-eth1',
        source_device: 'h1',
        source_interface: 'h1-eth0',
        source_operstate: 'UP',
        target_device: 's1',
        target_interface: 's1-eth1',
        target_operstate: 'UP',
        state: 'UP',
        active: true,
      },
      {
        id: 'h2:h2-eth0--s1:s1-eth2',
        source_device: 'h2',
        source_interface: 'h2-eth0',
        source_operstate: h2State,
        target_device: 's1',
        target_interface: 's1-eth2',
        target_operstate: h2State,
        state: h2State,
        active: up,
      },
    ],
    errors: [],
  };
}

function sampleSession() {
  return [
    {
      timestamp_utc: '2026-11-15T11:30:00+00:00',
      phase: 'normal',
      packet_loss_percent: 0.0,
      topology: makeTopology('UP'),
    },
    {
      timestamp_utc: '2026-11-15T11:30:30+00:00',
      phase: 'fault',
      packet_loss_percent: 100.0,
      switch_port: { name: 's1-eth2', config: 'PORT_DOWN', state: 'LINK_DOWN' },
      topology: makeTopology('DOWN'),
    },
    {
      timestamp_utc: '2026-11-15T11:31:00+00:00',
      phase: 'recovered',
      packet_loss_percent: 0.0,
      topology: makeTopology('UP'),
    },
  ];
}

function legacySession() {
  return [
    {
      timestamp_utc: '2026-11-14T17:33:50+00:00',
      phase: 'normal',
      packet_loss_percent: 0.0,
    },
    {
      timestamp_utc: '2026-11-14T17:34:20+00:00',
      phase: 'fault',
      packet_loss_percent: 100.0,
    },
  ];
}

describe('Network Topology RCA Engine', () => {
  it('localises the failed link and leaves the healthy one alone', () => {
    const result = networkRca.analyse(sampleSession());
    assert.equal(result.topology_available, true);
    assert.deepEqual(result.fault_localisation.affected_links, [
      'h2:h2-eth0--s1:s1-eth2',
    ]);
    assert.deepEqual(result.fault_localisation.unaffected_links, [
      'h1:h1-eth0--s1:s1-eth1',
    ]);
  });

  it('separates the severed host from the stranded one', () => {
    const impact = networkRca.analyse(sampleSession()).impact;
    assert.deepEqual(impact.severed_hosts, ['h2']);
    assert.deepEqual(impact.stranded_hosts, ['h1']);
    assert.deepEqual(impact.unreachable_host_pairs, [['h1', 'h2']]);
  });

  it('does not accuse a healthy host with an UP interface', () => {
    const result = networkRca.analyse(sampleSession());
    const accused = result.hypotheses.find((h) => h.hypothesis.includes('on h1'));
    assert.equal(accused, undefined);
  });

  it('one down port does not condemn the whole switch', () => {
    const result = networkRca.analyse(sampleSession());
    const switchHyp = result.hypotheses.find((h) =>
      h.hypothesis.includes('Switch device failure')
    );
    assert.ok(switchHyp);
    assert.equal(switchHyp.confidence, 'LOW');
    assert.ok(switchHyp.contradicting_evidence.some((e) => e.includes('s1-eth1')));
  });

  it('link failure is the best supported hypothesis', () => {
    const result = networkRca.analyse(sampleSession());
    const top = result.hypotheses[0];
    assert.ok(top.hypothesis.includes('Link failure'));
    assert.equal(top.confidence, 'HIGH');
    assert.equal(top.contradicting_evidence.length, 0);
    assert.ok(top.supporting_evidence.length >= 3);
  });

  it('nothing is ever reported as confirmed', () => {
    const result = networkRca.analyse(sampleSession());
    assert.ok(result.hypotheses.length > 0);
    for (const h of result.hypotheses) {
      assert.equal(h.status, 'NOT CONFIRMED');
      assert.ok(['HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT'].includes(h.confidence));
      assert.ok(h.verification_steps.length > 0);
    }
  });

  it('recovery is verified from evidence', () => {
    const recovery = networkRca.analyse(sampleSession()).recovery;
    assert.deepEqual(recovery.links_still_down, []);
    assert.equal(recovery.packet_loss_percent, 0.0);
  });

  it('evidence without topology snapshot refuses rather than guesses', () => {
    const result = networkRca.analyse(legacySession());
    assert.equal(result.topology_available, false);
    assert.deepEqual(result.hypotheses, []);
    assert.equal(result.fault_localisation, null);
    assert.ok(result.limitations.some((l) => l.includes('no topology snapshot')));
  });

  it('builds network plain-text investigation report', () => {
    const records = sampleSession();
    const rca = networkRca.analyse(records);
    const sessionMeta = {
      session_id: 'net-sess-01',
      device_id: 'network-lab',
      source: 'mininet',
      sha256: 'deadbeef'.repeat(8),
      received_at: '2026-11-15T11:32:00+00:00',
    };

    const report = networkReport.build(sessionMeta, records, rca);
    assert.ok(report.includes('TRACEPOINT - NETWORK INVESTIGATION REPORT'));
    assert.ok(report.includes('FAULT LOCALISATION'));
    assert.ok(report.includes('ROOT-CAUSE HYPOTHESES'));
    assert.ok(report.includes('RECOVERY VERIFICATION'));
    assert.ok(report.includes('INTEGRITY'));
  });
});
