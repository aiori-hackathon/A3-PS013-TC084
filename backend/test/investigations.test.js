import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDb, setDbPath } from '../src/db.js';
import * as evidence from '../src/evidence.js';
import * as investigations from '../src/investigations.js';
import * as custody from '../src/custody.js';

describe('Investigations & Event Linking Layer', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-inv-test-'));
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

  it('creates, retrieves, and updates investigations', () => {
    const db = getDb();
    const now = '2026-11-18T10:00:00+00:00';
    const res = db.prepare(`
      INSERT INTO investigations (user_id, title, description, severity, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'open', ?, ?)
    `).run(1, 'Suspicious login burst', 'Multiple failed root logins', 'high', now, now);

    const caseId = Number(res.lastInsertRowid);
    const item = investigations.getOwnedCase(db, caseId, 1);
    assert.equal(item.title, 'Suspicious login burst');
    assert.equal(item.severity, 'high');
    assert.equal(item.status, 'open');

    // Access by another user throws 404
    assert.throws(() => investigations.getOwnedCase(db, caseId, 2), (err) => err.status === 404);
  });

  it('validates event references strictly against user timeline', () => {
    const payload = {
      device_id: 'linux-srv',
      batch_id: '55555555-5555-5555-5555-555555555555',
      log_type: 'linux_syslog',
      lines: ['Oct 19 10:15:20 linux-srv sshd: Failed password for root'],
      source_timezone: 'Asia/Kolkata',
    };
    const rawBytes = Buffer.from(JSON.stringify(payload), 'utf8');
    evidence.storeLogBatch(payload, rawBytes, 1);

    const timeline = evidence.getTimelineForUser(1);
    const event = timeline.events[0];

    const validRef = JSON.stringify({
      device_id: event.device_id,
      batch_id: event.batch_id,
      timestamp: event.timestamp || '',
      event_type: event.event_type,
      username: event.username,
      message: String(event.raw_log).slice(0, 100),
    });

    // Valid event reference should pass
    assert.doesNotThrow(() => investigations.validateEventReference(validRef, 1));

    // Non-existent event reference should throw 422
    const invalidRef = JSON.stringify({
      device_id: 'linux-srv',
      batch_id: event.batch_id,
      timestamp: event.timestamp || '',
      event_type: 'non_existent_event',
      username: 'unknown_user',
      message: 'not in timeline',
    });
    assert.throws(
      () => investigations.validateEventReference(invalidRef, 1),
      (err) => err.status === 422
    );

    // Another account cannot link this account's event
    assert.throws(
      () => investigations.validateEventReference(validRef, 2),
      (err) => err.status === 422
    );
  });
});
