import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph } from '../src/graph.js';

describe('Investigation Graph Layer', () => {
  it('creates failure_before_success edges for same user within 30 minutes', () => {
    const events = [
      {
        device_id: 'host-a',
        batch_id: 'b1',
        line_number: 1,
        username: 'alice',
        event_type: 'failed_login',
        severity: 'warning',
        timestamp: '2026-11-18T10:00:00+00:00',
        timestamp_utc: '2026-11-18T10:00:00+00:00',
        raw_log: 'failed login 1',
      },
      {
        device_id: 'host-a',
        batch_id: 'b1',
        line_number: 2,
        username: 'alice',
        event_type: 'successful_login',
        severity: 'info',
        timestamp: '2026-11-18T10:15:00+00:00',
        timestamp_utc: '2026-11-18T10:15:00+00:00',
        raw_log: 'successful login',
      },
      {
        device_id: 'host-b',
        batch_id: 'b2',
        line_number: 1,
        username: 'bob',
        event_type: 'failed_login',
        severity: 'warning',
        timestamp: '2026-11-18T10:00:00+00:00',
        timestamp_utc: '2026-11-18T10:00:00+00:00',
        raw_log: 'failed bob login',
      },
      {
        device_id: 'host-c',
        batch_id: 'b3',
        line_number: 1,
        username: 'bob',
        event_type: 'successful_login',
        severity: 'info',
        timestamp: '2026-11-18T10:20:00+00:00',
        timestamp_utc: '2026-11-18T10:20:00+00:00',
        raw_log: 'successful bob login on host-c',
      },
    ];

    const graph = buildGraph(events);
    assert.equal(graph.nodes.length, 4);
    assert.equal(graph.edges.length, 2);

    const aliceEdge = graph.edges.find((e) => e.target === 'host-a:b1:2');
    assert.ok(aliceEdge);
    assert.equal(aliceEdge.source, 'host-a:b1:1');
    assert.equal(aliceEdge.confidence, 'stronger');
    assert.equal(aliceEdge.seconds_apart, 900);

    const bobEdge = graph.edges.find((e) => e.target === 'host-c:b3:1');
    assert.ok(bobEdge);
    assert.equal(bobEdge.source, 'host-b:b2:1');
    assert.equal(bobEdge.confidence, 'tentative');
    assert.equal(bobEdge.seconds_apart, 1200);
  });

  it('does not link events outside the 30 minute window', () => {
    const events = [
      {
        device_id: 'host-a',
        batch_id: 'b1',
        line_number: 1,
        username: 'alice',
        event_type: 'failed_login',
        severity: 'warning',
        timestamp: '2026-11-18T10:00:00+00:00',
        timestamp_utc: '2026-11-18T10:00:00+00:00',
        raw_log: 'failed login',
      },
      {
        device_id: 'host-a',
        batch_id: 'b1',
        line_number: 2,
        username: 'alice',
        event_type: 'successful_login',
        severity: 'info',
        timestamp: '2026-11-18T10:35:00+00:00', // 35 minutes later
        timestamp_utc: '2026-11-18T10:35:00+00:00',
        raw_log: 'successful login',
      },
    ];

    const graph = buildGraph(events);
    assert.equal(graph.edges.length, 0);
  });
});
