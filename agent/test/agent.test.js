import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  saveJsonAtomic,
  loadState,
  readNewLines,
  collectNewLines,
  sendPendingBatch,
} from '../agent.js';

describe('agent.js unit tests', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
  });

  after(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('saveJsonAtomic atomically writes JSON and fsyncs', () => {
    const target = path.join(tmpDir, 'state.json');
    saveJsonAtomic(target, { offset: 42, active: true });
    assert.ok(fs.existsSync(target));
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    assert.deepEqual(parsed, { offset: 42, active: true });
  });

  it('loadState loads existing state or defaults to offset 0', () => {
    const stateFile = path.join(tmpDir, 'test-state.json');
    const logFile = path.join(tmpDir, 'test.log');

    const s1 = loadState(stateFile, logFile);
    assert.equal(s1.offset, 0);

    saveJsonAtomic(stateFile, { offset: 128 });
    const s2 = loadState(stateFile, logFile);
    assert.equal(s2.offset, 128);
  });

  it('readNewLines parses completed lines and stops before incomplete lines', () => {
    const logFile = path.join(tmpDir, 'auth.log');
    fs.writeFileSync(logFile, 'Line 1\nLine 2\r\nLine 3'); // Line 3 has no newline

    const r1 = readNewLines(logFile, 0, 10);
    assert.deepEqual(r1.lines, ['Line 1', 'Line 2']);
    assert.equal(r1.nextOffset, 15);

    // Append newline to Line 3 and add Line 4
    fs.appendFileSync(logFile, '\nLine 4\n');
    const r2 = readNewLines(logFile, r1.nextOffset, 10);
    assert.deepEqual(r2.lines, ['Line 3', 'Line 4']);
    assert.equal(r2.nextOffset, fs.statSync(logFile).size);
  });

  it('readNewLines detects truncation and resets offset to 0', () => {
    const logFile = path.join(tmpDir, 'trunc.log');
    fs.writeFileSync(logFile, 'Short line\n');

    const res = readNewLines(logFile, 500, 10);
    assert.deepEqual(res.lines, ['Short line']);
    assert.equal(res.nextOffset, 11);
  });

  it('collectNewLines creates a pending batch file with correct payload structure', () => {
    const logFile = path.join(tmpDir, 'sample.log');
    const stateFile = path.join(tmpDir, 'agent-state-test.json');
    const pendingFile = path.join(tmpDir, 'pending-batch-test.json');

    const lineText = 'Oct 19 09:20:00 server sshd[123]: Accepted password for root\n';
    fs.writeFileSync(logFile, lineText);

    collectNewLines({
      logFile,
      stateFile,
      pendingFile,
      deviceId: 'host-01',
      logType: 'auth',
      sourceTimezone: 'Asia/Kolkata',
      maxLines: 50,
    });

    assert.ok(fs.existsSync(pendingFile));
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf-8'));
    assert.equal(pending.payload.device_id, 'host-01');
    assert.equal(pending.payload.log_type, 'auth');
    assert.equal(pending.payload.source_timezone, 'Asia/Kolkata');
    assert.equal(pending.payload.lines.length, 1);
    assert.equal(pending.next_offset, Buffer.byteLength(lineText));
  });

  it('sendPendingBatch delivers payload to server and advances state offset', async () => {
    let capturedReq = null;
    const origFetch = globalThis.fetch;

    globalThis.fetch = async (url, opts) => {
      capturedReq = { url, opts };
      const body = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 'accepted', batch_id: body.batch_id }),
      };
    };

    const stateFile = path.join(tmpDir, 'send-state.json');
    const pendingFile = path.join(tmpDir, 'send-pending.json');

    saveJsonAtomic(stateFile, { offset: 0 });
    saveJsonAtomic(pendingFile, {
      payload: {
        device_id: 'host-01',
        batch_id: 'batch-test-1',
        log_type: 'auth',
        source_timezone: 'UTC',
        lines: ['test line 1'],
      },
      next_offset: 42,
    });

    try {
      const ok = await sendPendingBatch('http://127.0.0.1:8000/api/v1/ingest', pendingFile, stateFile, 'secret-key-123');
      assert.equal(ok, true);
      assert.equal(capturedReq.opts.headers['X-API-Key'], 'secret-key-123');
      assert.equal(JSON.parse(capturedReq.opts.body).batch_id, 'batch-test-1');
      assert.ok(!fs.existsSync(pendingFile), 'pending file should be unlinked after success');
      const updatedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      assert.equal(updatedState.offset, 42);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
