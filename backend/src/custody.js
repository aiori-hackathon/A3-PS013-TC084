import crypto from 'node:crypto';
import { Router } from 'express';
import { getDb } from './db.js';
import { utcNowIso } from './isotime.js';
import { currentUser } from './auth.js';

export const GENESIS_HASH = '0'.repeat(64);
// 'prune' records the removal of evidence. Deleting a batch without an entry
// in the chain would leave the register quietly smaller than it once was.
export const ACTIONS = new Set(['ingest', 'verify', 'link', 'export', 'prune']);

export const router = Router();

export function pyJsonDumps(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return JSON.stringify(val);
  if (Array.isArray(val)) {
    return '[' + val.map(pyJsonDumps).join(', ') + ']';
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ': ' + pyJsonDumps(val[k])).join(', ') + '}';
  }
  return 'null';
}

export function sealedBody(entry) {
  return JSON.stringify({
    action: entry.action,
    batch_id: entry.batch_id,
    case_id: entry.case_id,
    detail: entry.detail,
    device_id: entry.device_id,
    recorded_at: entry.recorded_at,
    user_id: entry.user_id,
  });
}

export function seal(prevHash, entry) {
  return crypto
    .createHash('sha256')
    .update(prevHash + '|' + sealedBody(entry), 'utf8')
    .digest('hex');
}

export function record(userId, action, opts = {}) {
  if (!ACTIONS.has(action)) {
    throw new Error(`Unknown custody action: ${action}`);
  }

  const { device_id = null, batch_id = null, case_id = null, ...detailFields } = opts;

  const detailStr = pyJsonDumps(detailFields);
  const recordedAt = utcNowIso();

  const entry = {
    user_id: userId,
    action,
    device_id,
    batch_id,
    case_id,
    detail: detailStr,
    recorded_at: recordedAt,
  };

  try {
    const db = getDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const prevStmt = db.prepare(
        'SELECT entry_hash FROM custody_log WHERE user_id = ? ORDER BY id DESC LIMIT 1'
      );
      const prevRow = prevStmt.get(userId);
      const prevHash = prevRow ? prevRow.entry_hash : GENESIS_HASH;
      const entryHash = seal(prevHash, entry);

      const insertStmt = db.prepare(`
        INSERT INTO custody_log (
          user_id, action, device_id, batch_id, case_id, detail, recorded_at, prev_hash, entry_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
        entry.user_id,
        entry.action,
        entry.device_id,
        entry.batch_id,
        entry.case_id,
        entry.detail,
        entry.recorded_at,
        prevHash,
        entryHash
      );
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (err) {
    // Evidence handling must not fail because its own record-keeping did.
    return null;
  }

  return entry.recorded_at;
}

export function entriesForUser(userId, limit = 200) {
  const db = getDb();
  const stmt = db.prepare(
    'SELECT * FROM custody_log WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  );
  return stmt.all(userId, limit);
}

export function verifyChain(userId) {
  const db = getDb();
  const stmt = db.prepare(
    'SELECT * FROM custody_log WHERE user_id = ? ORDER BY id ASC'
  );
  const rows = stmt.all(userId);

  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const position = i + 1;

    if (row.prev_hash !== expectedPrev) {
      return {
        intact: false,
        entries: rows.length,
        broken_at: position,
        entry_id: row.id,
        detail:
          'This entry does not follow the one before it. An earlier entry was changed or removed.',
      };
    }

    if (seal(row.prev_hash, row) !== row.entry_hash) {
      return {
        intact: false,
        entries: rows.length,
        broken_at: position,
        entry_id: row.id,
        detail: "This entry's contents no longer match its seal.",
      };
    }

    expectedPrev = row.entry_hash;
  }

  return {
    intact: true,
    entries: rows.length,
    broken_at: null,
    entry_id: null,
    detail:
      rows.length > 0
        ? 'Every entry matches its seal and follows the one before it.'
        : 'No evidence has been handled on this account yet.',
  };
}

router.get('', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  return res.json({
    items: entriesForUser(user.id),
    chain: verifyChain(user.id),
  });
});

router.get('/verify', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  return res.json(verifyChain(user.id));
});
