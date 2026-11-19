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
  extractUsername,
  parseUserFilter,
  applyUserFilter,
  parseEventFilter,
  isLoginAttempt,
  applyScope,
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

describe('collection scope filtering', () => {
  it('attributes a pam session line to the account, not the word "user"', () => {
    assert.equal(
      extractUsername('sshd-session[1]: pam_unix(sshd:session): session opened for user root(uid=0) by root(uid=0)'),
      'root'
    );
  });

  it('reads the account out of the common sshd and systemd shapes', () => {
    const cases = [
      ['sshd[1]: Accepted password for root from 10.0.0.1 port 22 ssh2', 'root'],
      ['sshd[1]: Failed password for invalid user abhi from 45.1.1.1 port 1 ssh2', 'abhi'],
      ['sshd[1]: Invalid user abhi from 45.1.1.1 port 40122', 'abhi'],
      ['sshd[1]: Failed password for user from 92.1.1.1 port 51002 ssh2', 'user'],
      ['systemd[1]: Started Session 4012 of User nirikshak.', 'nirikshak'],
      ['sudo: deploy : TTY=pts/0 ; PWD=/srv ; USER=root ; COMMAND=/bin/ls', 'root'],
    ];
    for (const [line, expected] of cases) {
      assert.equal(extractUsername(line), expected, line);
    }
  });

  it('keeps only lines belonging to the named accounts', () => {
    const lines = [
      'sshd[1]: Accepted password for root from 10.0.0.1 port 22 ssh2',
      'sshd[1]: Failed password for invalid user abhi from 45.1.1.1 port 1 ssh2',
      'CRON[2]: pam_unix(cron:session): session opened for user nirikshak(uid=1001) by (uid=0)',
    ];
    const { kept, skipped } = applyUserFilter(lines, parseUserFilter('root'));
    assert.deepEqual(kept, [lines[0]]);
    assert.equal(skipped, 2);
  });

  it('collects every line when no scope is configured', () => {
    const lines = ['anything at all', 'and another'];
    const { kept, skipped } = applyUserFilter(lines, parseUserFilter(''));
    assert.deepEqual(kept, lines);
    assert.equal(skipped, 0);
  });

  it('advances past skipped lines so the agent does not stall on them', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-filter-'));
    const logFile = path.join(dir, 'auth.log');
    const stateFile = path.join(dir, 'state.json');
    const pendingFile = path.join(dir, 'pending.json');

    fs.writeFileSync(
      logFile,
      'sshd[1]: Failed password for invalid user abhi from 45.1.1.1 port 1 ssh2\n' +
        'CRON[2]: pam_unix(cron:session): session opened for user nirikshak(uid=1001) by (uid=0)\n'
    );

    collectNewLines({
      logFile,
      stateFile,
      pendingFile,
      deviceId: 'test-host',
      logType: 'auth',
      sourceTimezone: 'Asia/Kolkata',
      maxLines: 100,
      userFilter: parseUserFilter('root'),
      filterLabel: 'username in [root]',
    });

    assert.equal(fs.existsSync(pendingFile), false, 'nothing in scope, so no batch');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.equal(state.offset, fs.statSync(logFile).size, 'offset must clear the skipped lines');

    fs.appendFileSync(logFile, 'sshd[3]: Accepted password for root from 10.0.0.1 port 22 ssh2\n');

    collectNewLines({
      logFile,
      stateFile,
      pendingFile,
      deviceId: 'test-host',
      logType: 'auth',
      sourceTimezone: 'Asia/Kolkata',
      maxLines: 100,
      userFilter: parseUserFilter('root'),
      filterLabel: 'username in [root]',
    });

    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf-8'));
    assert.equal(pending.payload.lines.length, 1);
    assert.match(pending.payload.lines[0], /Accepted password for root/);
    assert.equal(pending.payload.collection_filter, 'username in [root]');

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('login-attempt scope', () => {
  const ROOT = parseUserFilter('root');
  const LOGIN = parseEventFilter('login');

  it('keeps only root login attempts out of a realistic auth.log mix', () => {
    const keep = [
      'sshd[1]: Accepted password for root from 137.97.136.22 port 51234 ssh2',
      'sshd[1]: Accepted publickey for root from 137.97.136.22 port 51235 ssh2',
      'sshd[2]: Failed password for root from 137.97.136.22 port 51240 ssh2',
    ];
    const drop = [
      'sshd[4]: Failed password for invalid user abhi from 45.1.1.1 port 1 ssh2',
      'sshd[1]: pam_unix(sshd:session): session opened for user root(uid=0) by root(uid=0)',
      'CRON[9]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)',
      'sudo: deploy : TTY=pts/0 ; PWD=/srv ; USER=root ; COMMAND=/bin/ls',
      'systemd[1]: Started Session 99 of User root.',
      'sshd[5]: Accepted password for nirikshak from 1.2.3.4 port 2 ssh2',
    ];

    const { kept, skipped } = applyScope([...keep, ...drop], ROOT, LOGIN);
    assert.deepEqual(kept, keep);
    assert.equal(skipped, drop.length);
  });

  it('cannot separate a bot targeting root from the operator, and does not pretend to', () => {
    const bot = 'sshd[3]: Failed password for root from 218.92.0.112 port 22011 ssh2';
    const { kept } = applyScope([bot], ROOT, LOGIN);
    assert.deepEqual(kept, [bot], 'a failed root login is collected whoever sent it');
  });

  it('treats a publickey login as a login attempt', () => {
    assert.equal(isLoginAttempt('Accepted publickey for root from 1.2.3.4 port 1 ssh2'), true);
    assert.equal(isLoginAttempt('session opened for user root(uid=0)'), false);
  });

  it('ignores an unrecognised event filter rather than silently dropping everything', () => {
    assert.equal(parseEventFilter('nonsense'), null);
    const lines = ['CRON[9]: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)'];
    const { kept } = applyScope(lines, ROOT, parseEventFilter('nonsense'));
    assert.deepEqual(kept, lines, 'falls back to the username scope alone');
  });
});
