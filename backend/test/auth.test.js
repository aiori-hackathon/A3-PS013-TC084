import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, setDbPath } from '../src/db.js';
import * as auth from '../src/auth.js';

describe('Auth Layer', () => {
  beforeEach(() => {
    setDbPath(':memory:');
  });

  it('hashes and verifies passwords correctly', () => {
    const password = 'CorrectHorseBatteryStaple123!';
    const hashed = auth.hashPassword(password);
    assert.ok(hashed.startsWith('scrypt$'));
    assert.equal(auth.verifyPassword(password, hashed), true);
    assert.equal(auth.verifyPassword('WrongPassword', hashed), false);
    assert.equal(auth.verifyPassword('', hashed), false);
    assert.equal(auth.verifyPassword(password, 'invalid-hash'), false);
  });

  it('agent API keys can be issued, rotated, resolved, and revoked', () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES (1, 'analyst@example.com', 'Analyst', 'hash', '2026-11-18T00:00:00+00:00')
    `).run();

    // Mock request with currentUser = 1
    const req = { cookies: {} };
    // Create session for user 1
    const res = {
      cookie(name, val) {
        req.cookies[name] = val;
      },
    };
    auth.issueSession(res, 1);
    assert.equal(auth.currentUser(req)?.id, 1);

    // Issue agent key
    const apiKey = 'tp_agent_testkey12345678901234567890';
    const digest = auth.tokenDigest(apiKey);
    db.prepare('INSERT INTO agent_api_keys (user_id, token_hash, created_at) VALUES (?, ?, ?)')
      .run(1, digest, '2026-11-18T00:00:00+00:00');

    assert.equal(auth.userForAgentApiKey(apiKey), 1);
    assert.equal(auth.userForAgentApiKey('invalid_key'), null);
    assert.equal(auth.userForAgentApiKey(null), null);

    // Rotate key
    const newApiKey = 'tp_agent_newkey99999999999999999999';
    const newDigest = auth.tokenDigest(newApiKey);
    db.prepare(`
      INSERT INTO agent_api_keys (user_id, token_hash, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        token_hash = excluded.token_hash,
        created_at = excluded.created_at
    `).run(1, newDigest, '2026-11-18T01:00:00+00:00');

    assert.equal(auth.userForAgentApiKey(newApiKey), 1);
    assert.equal(auth.userForAgentApiKey(apiKey), null);

    // Revoke key
    db.prepare('DELETE FROM agent_api_keys WHERE user_id = ?').run(1);
    assert.equal(auth.userForAgentApiKey(newApiKey), null);
  });
});
