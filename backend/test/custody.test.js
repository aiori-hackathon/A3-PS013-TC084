import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath } from '../src/db.js';
import * as custody from '../src/custody.js';

describe('Custody Chain of Custody', () => {
  beforeEach(() => {
    setDbPath(':memory:');
    const db = getDb();
    db.exec(`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES (1, 'a@example.com', 'A', 'x', '2026-11-09T00:00:00+00:00'),
             (2, 'b@example.com', 'B', 'x', '2026-11-09T00:00:00+00:00');
    `);
  });

  function getRows(userId = 1) {
    const db = getDb();
    return db
      .prepare('SELECT * FROM custody_log WHERE user_id = ? ORDER BY id ASC')
      .all(userId);
  }

  it('entries are appended in order and chain is intact', () => {
    custody.record(1, 'ingest', { device_id: 'd1', batch_id: 'b1', sha256: 'aa' });
    custody.record(1, 'verify', { device_id: 'd1', batch_id: 'b1', result: 'verified' });
    custody.record(1, 'export', { case_id: 7, format: 'pdf' });

    const rows = getRows(1);
    assert.deepEqual(
      rows.map((r) => r.action),
      ['ingest', 'verify', 'export']
    );
    assert.equal(custody.verifyChain(1).intact, true);
  });

  it('first entry follows the genesis seal', () => {
    custody.record(1, 'ingest', { batch_id: 'b1' });
    const rows = getRows(1);
    assert.equal(rows[0].prev_hash, custody.GENESIS_HASH);
  });

  it('each entry chains to the one before it', () => {
    for (let i = 0; i < 4; i++) {
      custody.record(1, 'ingest', { batch_id: `b${i}` });
    }
    const rows = getRows(1);
    for (let i = 1; i < rows.length; i++) {
      assert.equal(rows[i].prev_hash, rows[i - 1].entry_hash);
    }
  });

  it('detail is stored and retrieved', () => {
    custody.record(1, 'verify', { batch_id: 'b1', result: 'mismatch' });
    const rows = getRows(1);
    const detail = JSON.parse(rows[0].detail);
    assert.equal(detail.result, 'mismatch');
  });

  it('unknown action is refused', () => {
    assert.throws(
      () => custody.record(1, 'delete_everything', { batch_id: 'b1' }),
      /Unknown custody action/
    );
  });

  it('rewriting an entry breaks its seal', () => {
    custody.record(1, 'ingest', { device_id: 'd1', batch_id: 'b1', sha256: 'aa' });
    custody.record(1, 'verify', { device_id: 'd1', batch_id: 'b1', result: 'mismatch' });
    custody.record(1, 'export', { case_id: 7, format: 'pdf' });
    assert.equal(custody.verifyChain(1).intact, true);

    const rows = getRows(1);
    const targetId = rows[1].id;

    const db = getDb();
    db.prepare('UPDATE custody_log SET detail = ? WHERE id = ?').run(
      '{"result": "verified"}',
      targetId
    );

    const check = custody.verifyChain(1);
    assert.equal(check.intact, false);
    assert.equal(check.broken_at, 2);
    assert.equal(check.entry_id, targetId);
  });

  it('deleting an entry breaks the chain', () => {
    custody.record(1, 'ingest', { batch_id: 'b1' });
    custody.record(1, 'verify', { batch_id: 'b1' });
    custody.record(1, 'export', { case_id: 1 });

    const rows = getRows(1);
    const db = getDb();
    db.prepare('DELETE FROM custody_log WHERE id = ?').run(rows[1].id);

    const check = custody.verifyChain(1);
    assert.equal(check.intact, false);
    assert.equal(check.broken_at, 2);
  });

  it('backdating an entry breaks its seal', () => {
    custody.record(1, 'ingest', { batch_id: 'b1' });
    const targetId = getRows(1)[0].id;

    const db = getDb();
    db.prepare('UPDATE custody_log SET recorded_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00+00:00',
      targetId
    );

    const check = custody.verifyChain(1);
    assert.equal(check.intact, false);
  });

  it('chains are isolated per account', () => {
    custody.record(1, 'ingest', { batch_id: 'owned-by-1' });
    custody.record(2, 'ingest', { batch_id: 'owned-by-2' });

    assert.equal(custody.entriesForUser(1).length, 1);
    assert.equal(custody.entriesForUser(1)[0].batch_id, 'owned-by-1');
    assert.equal(custody.verifyChain(1).intact, true);
    assert.equal(custody.verifyChain(2).intact, true);

    // Tampering with account 1 leaves account 2 intact
    const db = getDb();
    db.prepare("UPDATE custody_log SET detail = '{\"x\": 1}' WHERE user_id = 1").run();

    assert.equal(custody.verifyChain(1).intact, false);
    assert.equal(custody.verifyChain(2).intact, true);
  });

  it('an account that has handled nothing is intact', () => {
    const check = custody.verifyChain(1);
    assert.equal(check.intact, true);
    assert.equal(check.entries, 0);
    assert.ok(check.detail.includes('No evidence'));
  });
});
