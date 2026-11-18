import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  sessionIdFor,
  evidenceFiles,
  readObservations,
  describe as describeOutcome,
  send,
} from '../network_agent.js';

describe('network_agent.js unit tests', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-agent-test-'));
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('sessionIdFor extracts stable id from evidence filename', () => {
    assert.equal(
      sessionIdFor('network_evidence_20261115_113508.json'),
      'lab-20261115_113508'
    );
    assert.equal(sessionIdFor('random_file.json'), null);
  });

  it('evidenceFiles filters and sorts evidence files', () => {
    fs.writeFileSync(path.join(tmpDir, 'network_evidence_20261115_120000.json'), '[]');
    fs.writeFileSync(path.join(tmpDir, 'network_evidence_20261115_110000.json'), '[]');
    fs.writeFileSync(path.join(tmpDir, 'other.json'), '[]');

    const all = evidenceFiles(tmpDir);
    assert.equal(all.length, 2);
    assert.ok(all[0].endsWith('network_evidence_20261115_110000.json'));
    assert.ok(all[1].endsWith('network_evidence_20261115_120000.json'));

    const specific = evidenceFiles(tmpDir, ['network_evidence_20261115_120000.json', 'nonexistent.json']);
    assert.equal(specific.length, 1);
    assert.ok(specific[0].endsWith('network_evidence_20261115_120000.json'));
  });

  it('readObservations parses list of observations and rejects empty or invalid lists', () => {
    const validPath = path.join(tmpDir, 'valid.json');
    fs.writeFileSync(validPath, JSON.stringify([{ phase: 'initial', hosts: 3 }]));
    assert.deepEqual(readObservations(validPath), [{ phase: 'initial', hosts: 3 }]);

    const emptyPath = path.join(tmpDir, 'empty.json');
    fs.writeFileSync(emptyPath, '[]');
    assert.throws(() => readObservations(emptyPath), /non-empty list/);

    const invalidPath = path.join(tmpDir, 'not-an-array.json');
    fs.writeFileSync(invalidPath, '{"foo": "bar"}');
    assert.throws(() => readObservations(invalidPath), /non-empty list/);
  });

  it('describe maps HTTP status codes and responses to user-friendly messages', () => {
    const [msgDup, okDup] = describeOutcome(201, { duplicate: true });
    assert.equal(msgDup, 'already held');
    assert.equal(okDup, true);

    const [msgSent, okSent] = describeOutcome(201, { observations: 5, sha256: 'abcdef1234567890' });
    assert.equal(msgSent, 'sent (5 observations, sha abcdef123456)');
    assert.equal(okSent, true);

    const [msg401, ok401] = describeOutcome(401, {});
    assert.equal(msg401, 'rejected: the API key is not valid for this workspace');
    assert.equal(ok401, false);

    const [msg409, ok409] = describeOutcome(409, {});
    assert.equal(msg409, 'refused: a different session is already stored under this id');
    assert.equal(ok409, false);

    const [msg0, ok0] = describeOutcome(0, { detail: 'connection refused' });
    assert.equal(msg0, 'connection refused');
    assert.equal(ok0, false);
  });

  it('send transmits payload and returns response', async () => {
    let capturedReq = null;
    const origFetch = globalThis.fetch;

    globalThis.fetch = async (url, opts) => {
      capturedReq = { url, opts };
      const data = JSON.parse(opts.body);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          status: 'accepted',
          observations: data.observations.length,
          sha256: '1234567890abcdef',
        }),
      };
    };

    try {
      const { status, body } = await send('http://127.0.0.1:8000', 'test-key-xyz', {
        session_id: 'lab-1',
        device_id: 'mininet-1',
        source: 'test.json',
        observations: [{ phase: 'ping' }],
      });
      assert.equal(status, 201);
      assert.equal(body.observations, 1);
      assert.equal(capturedReq.opts.headers['X-API-Key'], 'test-key-xyz');
      assert.equal(JSON.parse(capturedReq.opts.body).session_id, 'lab-1');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
