import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog, CLOCK_TOLERANCE_SECONDS } from '../src/parser.js';

describe('Parser fidelity', () => {
  const RECEIVED_AT = '2026-10-19T07:00:00+00:00';

  it('1. Syslog SSH failure burst and success', () => {
    const lines = [
      'Oct 19 10:15:20 linux-server sshd: Failed password for root from 192.0.2.10 port 50231 ssh2',
      'Oct 19 10:20:00 linux-server sshd: Failed password for admin from 192.0.2.10 port 50232 ssh2',
      'Oct 19 10:21:10 linux-server sshd: Failed password for root from 192.0.2.10 port 50233 ssh2',
      'Oct 19 10:24:00 linux-server sshd: Accepted password for admin from 192.0.2.10 port 50234 ssh2',
    ];

    const events = lines.map((line) =>
      parseLog(line, 'dev1', 'b1', 'linux_syslog', RECEIVED_AT, 'Asia/Kolkata')
    );

    assert.deepEqual(
      events.map((e) => e.event_type),
      ['failed_login', 'failed_login', 'failed_login', 'successful_login']
    );
    assert.deepEqual(
      events.map((e) => e.username),
      ['root', 'admin', 'root', 'admin']
    );
    assert.deepEqual(
      events.map((e) => e.raw_log),
      lines
    );
    assert.ok(events.every((e) => e.timestamp_inferred === true));
    assert.ok(events.every((e) => e.timestamp_utc !== null));

    const times = events.map((e) => e.timestamp_utc);
    assert.deepEqual(times, [...times].sort());
  });

  it('2. Windows Event Log JSON parsing', () => {
    const line =
      '{"EventID":4625,"TimeCreated":"2026-10-19T10:15:20Z","TargetUserName":"admin","Message":"An account failed to log on"}';
    const event = parseLog(line, 'win1', 'b1', 'windows_event', RECEIVED_AT);

    assert.equal(event.log_format, 'windows_event_json');
    assert.equal(event.event_type, 'failed_login');
    assert.equal(event.severity, 'warning');
    assert.equal(event.username, 'admin');
    assert.equal(event.timestamp, '2026-10-19T10:15:20+00:00');
    assert.equal(event.timestamp_utc, '2026-10-19T10:15:20+00:00');
    assert.equal(event.parse_status, 'complete');
  });

  it('3. Windows Event Log account lockout EventID 4740', () => {
    const line =
      '{"EventID":4740,"TimeCreated":"2026-10-19T10:16:20Z","TargetUserName":"analyst","Message":"A user account was locked out"}';
    const event = parseLog(line, 'win1', 'b1', 'windows_event', RECEIVED_AT);

    assert.equal(event.event_type, 'account_lockout');
    assert.equal(event.severity, 'warning');
    assert.equal(event.username, 'analyst');
  });

  it('4. macOS Unified Log text format', () => {
    const line =
      '2026-10-19 10:15:20.000000+0530 macbook sshd[1234]: Failed password for admin from 192.0.2.20 port 50500 ssh2';
    const event = parseLog(line, 'mac1', 'b1', 'macos_unified', RECEIVED_AT);

    assert.equal(event.log_format, 'macos_unified_text');
    assert.equal(event.event_type, 'failed_login');
    assert.equal(event.username, 'admin');
    assert.equal(event.timestamp, '2026-10-19T10:15:20+05:30');
    assert.equal(event.timestamp_utc, '2026-10-19T04:45:20+00:00');
  });

  it('5. ISO 8601 text format', () => {
    const line = '2026-10-19T08:30:00Z auth-service: Accepted password for dev';
    const event = parseLog(line, 'srv1', 'b1', 'iso', RECEIVED_AT);

    assert.equal(event.log_format, 'iso8601_text');
    assert.equal(event.event_type, 'successful_login');
    assert.equal(event.username, 'dev');
    assert.equal(event.timestamp, '2026-10-19T08:30:00+00:00');
  });

  it('6. Malformed JSON log', () => {
    const line = '{"EventID":4625,"TimeCreated":"2026-10-19T10:15:20Z"';
    const event = parseLog(line, 'win1', 'b1', 'windows_event', RECEIVED_AT);

    assert.ok(event.parse_warnings.includes('Invalid JSON log'));
    assert.equal(event.parse_status, 'partial');
  });

  it('7. Missing timestamp in log', () => {
    const line = 'sshd: Failed password for admin from 192.0.2.44';
    const event = parseLog(line, 'lin1', 'b1', 'linux_syslog', RECEIVED_AT);

    assert.equal(event.timestamp, null);
    assert.ok(event.parse_warnings.includes('Timestamp not parsed'));
    assert.equal(event.parse_status, 'partial');
  });

  it('8. Unknown event type', () => {
    const line =
      '2026-10-19 10:15:20.000000+0530 macbook securityd[123]: Unmapped policy code 739';
    const event = parseLog(line, 'mac1', 'b1', 'macos_unified', RECEIVED_AT);

    assert.equal(event.event_type, 'unknown');
    assert.ok(event.parse_warnings.includes('Event type not recognized'));
    assert.equal(event.parse_status, 'partial');
  });

  it('9. Clock skew: clock ahead', () => {
    const line =
      '{"EventID":4625,"TimeCreated":"2026-11-09T12:10:00Z","TargetUserName":"analyst","Message":"An account failed to log on"}';
    const event = parseLog(line, 'dev1', 'b1', 'auth', '2026-11-09T12:00:00+00:00');

    assert.equal(event.clock_skew, 'ahead');
    assert.equal(event.clock_offset_seconds, 600);
  });

  it('10. Clock skew: small lead within tolerance', () => {
    const line =
      '{"EventID":4625,"TimeCreated":"2026-11-09T12:00:30Z","TargetUserName":"analyst","Message":"An account failed to log on"}';
    const event = parseLog(line, 'dev1', 'b1', 'auth', '2026-11-09T12:00:00+00:00');

    assert.equal(event.clock_skew, 'within_tolerance');
    assert.equal(event.clock_offset_seconds, 30);
  });

  it('11. Clock skew: older than receipt', () => {
    const line =
      '{"EventID":4625,"TimeCreated":"2026-11-09T09:00:00Z","TargetUserName":"analyst","Message":"An account failed to log on"}';
    const event = parseLog(line, 'dev1', 'b1', 'auth', '2026-11-09T12:00:00+00:00');

    assert.equal(event.clock_skew, 'older_than_receipt');
    assert.equal(event.clock_offset_seconds, -10800);
  });

  it('12. Syslog year rollover (December log read in January)', () => {
    // Received at Jan 2, 2027 local time, log says Dec 31 23:50:00
    const received = '2027-01-02T10:00:00+05:30';
    const line = 'Dec 31 23:50:00 server sshd: Accepted password for admin';
    const event = parseLog(line, 'dev1', 'b1', 'linux_syslog', received, 'Asia/Kolkata');

    assert.equal(event.timestamp_inferred, true);
    assert.ok(event.timestamp.startsWith('2026-12-31'));
    assert.equal(event.timestamp_conflict, false);
  });

  it('13. Missing receipt time reports unknown clock skew', () => {
    const line =
      '{"EventID":4625,"TimeCreated":"2026-11-09T12:10:00Z","TargetUserName":"analyst","Message":"An account failed to log on"}';
    const event = parseLog(line, 'dev1', 'b1', 'auth', null);

    assert.equal(event.clock_skew, 'unknown');
    assert.equal(event.clock_offset_seconds, null);
  });

  it('14. Cross-timezone resolution to same UTC instant', () => {
    const indiaEvent = parseLog(
      '2026-10-19 10:30:00.000000+0530 india-host sshd[1234]: Failed password for admin',
      'dev-in',
      'b1',
      'macos_unified',
      RECEIVED_AT,
      'Asia/Kolkata'
    );

    const nyEvent = parseLog(
      '{"EventID":4625,"TimeCreated":"2026-10-19T01:00:00-04:00","TargetUserName":"admin","Message":"An account failed to log on"}',
      'dev-ny',
      'b1',
      'windows_event',
      RECEIVED_AT,
      'America/New_York'
    );

    assert.equal(indiaEvent.timestamp_utc, '2026-10-19T05:00:00+00:00');
    assert.equal(nyEvent.timestamp_utc, '2026-10-19T05:00:00+00:00');
  });
});
