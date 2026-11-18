import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDb, setDbPath } from '../src/db.js';
import * as evidence from '../src/evidence.js';

describe('Evidence & Timeline Layer', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-evidence-test-'));
    process.env.TRACEPOINT_EVIDENCE_DIR = tmpDir;
    setDbPath(':memory:');
    const db = getDb();
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES (1, 'u1@example.com', 'User1', 'h', '2026-11-18T00:00:00+00:00'),
             (2, 'u2@example.com', 'User2', 'h', '2026-11-18T00:00:00+00:00')
    `).run();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('stores a log batch and creates metadata file', () => {
    const payload = {
      device_id: 'linux-server',
      batch_id: '11111111-1111-1111-1111-111111111111',
      log_type: 'linux_syslog',
      lines: [
        'Oct 19 10:15:20 linux-server sshd: Failed password for root',
        'Oct 19 10:24:00 linux-server sshd: Accepted password for admin',
      ],
      source_timezone: 'Asia/Kolkata',
    };
    const rawBytes = Buffer.from(JSON.stringify(payload), 'utf8');

    const result = evidence.storeLogBatch(payload, rawBytes, 1);
    assert.equal(result.status, 'accepted');
    assert.equal(result.line_count, 2);
    assert.equal(result.owner_user_id, 1);

    const { evidencePath, metadataPath } = evidence.ownedEvidencePaths(
      1,
      payload.device_id,
      payload.batch_id
    );
    assert.ok(fs.existsSync(evidencePath));
    assert.ok(fs.existsSync(metadataPath));

    // Duplicate submission with identical content returns duplicate
    const dupResult = evidence.storeLogBatch(payload, rawBytes, 1);
    assert.equal(dupResult.status, 'duplicate');

    // Conflicting content for the same batch ID throws 409
    const conflictPayload = { ...payload, lines: ['Oct 19 10:30:00 different log'] };
    const conflictBytes = Buffer.from(JSON.stringify(conflictPayload), 'utf8');
    assert.throws(
      () => evidence.storeLogBatch(conflictPayload, conflictBytes, 1),
      (err) => err.status === 409
    );
  });

  it('retrieves timeline with correct ordering and filters', () => {
    const payload = {
      device_id: 'linux-server',
      batch_id: '22222222-2222-2222-2222-222222222222',
      log_type: 'linux_syslog',
      lines: [
        'Oct 19 10:15:20 linux-server sshd: Failed password for root',
        'Oct 19 10:20:00 linux-server sshd: Failed password for admin',
        'Oct 19 10:24:00 linux-server sshd: Accepted password for admin',
      ],
      source_timezone: 'Asia/Kolkata',
    };
    const rawBytes = Buffer.from(JSON.stringify(payload), 'utf8');
    evidence.storeLogBatch(payload, rawBytes, 1);

    const timeline = evidence.getTimelineForUser(1);
    assert.equal(timeline.total, 3);
    assert.equal(timeline.events[0].username, 'root');
    assert.equal(timeline.events[2].username, 'admin');

    // Filter by severity
    const warnings = evidence.getTimelineForUser(1, { severity: 'warning' });
    assert.equal(warnings.total, 2);

    // Filter by username
    const adminEvents = evidence.getTimelineForUser(1, { username: 'admin' });
    assert.equal(adminEvents.total, 2);

    // Filter by event_type
    const successEvents = evidence.getTimelineForUser(1, { event_type: 'successful_login' });
    assert.equal(successEvents.total, 1);
  });

  it('verifies evidence hash against metadata', () => {
    const payload = {
      device_id: 'macbook',
      batch_id: '33333333-3333-3333-3333-333333333333',
      log_type: 'macos_unified',
      lines: [
        '2026-10-19 10:15:20.000000+0530 macbook sshd[123]: Failed password for admin',
      ],
      source_timezone: 'Asia/Kolkata',
    };
    const rawBytes = Buffer.from(JSON.stringify(payload), 'utf8');
    evidence.storeLogBatch(payload, rawBytes, 1);

    const check = evidence.verifyEvidenceForOwner(payload.device_id, payload.batch_id, 1);
    assert.equal(check.status, 'verified');
    assert.equal(check.verified, true);

    // Tamper with evidence file
    const { evidencePath } = evidence.ownedEvidencePaths(1, payload.device_id, payload.batch_id);
    fs.writeFileSync(evidencePath, 'tampered content');

    const tamperedCheck = evidence.verifyEvidenceForOwner(payload.device_id, payload.batch_id, 1);
    assert.equal(tamperedCheck.status, 'mismatch');
    assert.equal(tamperedCheck.verified, false);
  });

  it('computes evidence trust score', () => {
    const payload = {
      device_id: 'win-srv',
      batch_id: '44444444-4444-4444-4444-444444444444',
      log_type: 'windows_event',
      lines: [
        '{"EventID":4625,"TimeCreated":"2026-10-19T10:15:20Z","TargetUserName":"admin","Message":"An account failed to log on"}',
        '{"EventID":4624,"TimeCreated":"2026-10-19T10:20:20Z","TargetUserName":"admin","Message":"An account was successfully logged on"}',
      ],
      source_timezone: 'UTC',
    };
    const rawBytes = Buffer.from(JSON.stringify(payload), 'utf8');
    evidence.storeLogBatch(payload, rawBytes, 1);

    const score = evidence.qualityFor(payload.device_id, payload.batch_id, 1);
    assert.equal(score.integrity, 'verified');
    assert.ok(score.score >= 80);
    assert.equal(score.records, 2);
  });
});
