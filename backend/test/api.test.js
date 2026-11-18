import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from '../src/server.js';
import { setDbPath, getDb } from '../src/db.js';

function request(appInstance, { method = 'GET', url = '/', headers = {}, body = null }) {
  return new Promise((resolve) => {
    const parsedUrl = new URL(url, 'http://localhost');
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());

    const req = {
      method,
      url,
      path: pathname,
      query,
      headers: { ...headers },
      cookies: {},
      body,
    };

    if (headers.cookie) {
      const parts = headers.cookie.split(';');
      for (const p of parts) {
        const [k, v] = p.trim().split('=');
        if (k && v) req.cookies[k] = v;
      }
    }

    const resHeaders = {};
    let statusCode = 200;

    const res = {
      setHeader(k, v) {
        resHeaders[k.toLowerCase()] = v;
      },
      getHeader(k) {
        return resHeaders[k.toLowerCase()];
      },
      status(code) {
        statusCode = code;
        return this;
      },
      cookie(name, val) {
        resHeaders['set-cookie'] = `${name}=${val}`;
      },
      clearCookie(name) {
        resHeaders['set-cookie'] = `${name}=; Max-Age=0`;
      },
      json(obj) {
        resHeaders['content-type'] = 'application/json';
        resolve({
          status: statusCode,
          headers: {
            get(n) {
              return resHeaders[n.toLowerCase()] ?? null;
            },
            ...resHeaders,
          },
          json: async () => obj,
          text: async () => JSON.stringify(obj),
        });
      },
      send(data) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
        resolve({
          status: statusCode,
          headers: {
            get(n) {
              return resHeaders[n.toLowerCase()] ?? null;
            },
            ...resHeaders,
          },
          text: async () => buf.toString('utf8'),
          arrayBuffer: async () =>
            buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
          buffer: () => buf,
        });
      },
      end() {
        resolve({
          status: statusCode,
          headers: {
            get(n) {
              return resHeaders[n.toLowerCase()] ?? null;
            },
            ...resHeaders,
          },
        });
      },
    };

    appInstance(req, res);
  });
}

describe('TracePoint Express Server Full API Integration', () => {
  let tmpEvidenceDir;
  let sessionCookie = '';
  let agentApiKey = '';

  before(() => {
    tmpEvidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-server-test-'));
    process.env.TRACEPOINT_EVIDENCE_DIR = tmpEvidenceDir;
    setDbPath(':memory:');
    getDb();
  });

  after(() => {
    try {
      fs.rmSync(tmpEvidenceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('1. GET /health', async () => {
    const res = await request(app, { method: 'GET', url: '/health' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { status: 'ok', service: 'tracepoint' });
  });

  it('2. POST /api/v1/auth/signup', async () => {
    const res = await request(app, {
      method: 'POST',
      url: '/api/v1/auth/signup',
      body: {
        name: 'Analyst Alice',
        email: 'alice@example.com',
        password: 'SuperSecretPassword123!',
      },
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.user.email, 'alice@example.com');
    assert.equal(body.user.name, 'Analyst Alice');

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    sessionCookie = setCookie.split(';')[0];
  });

  it('3. GET /api/v1/auth/me', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.email, 'alice@example.com');
  });

  it('4. POST /api/v1/auth/agent-key', async () => {
    const res = await request(app, {
      method: 'POST',
      url: '/api/v1/auth/agent-key',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.api_key.startsWith('tp_agent_'));
    agentApiKey = body.api_key;
  });

  it('5. POST /api/v1/ingest with agent API key', async () => {
    const payload = {
      device_id: 'linux-srv-01',
      batch_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      log_type: 'linux_syslog',
      source_timezone: 'Asia/Kolkata',
      lines: [
        'Oct 19 10:15:20 linux-srv-01 sshd: Failed password for root',
        'Oct 19 10:20:00 linux-srv-01 sshd: Accepted password for admin',
      ],
    };

    const res = await request(app, {
      method: 'POST',
      url: '/api/v1/ingest',
      headers: {
        'x-api-key': agentApiKey,
      },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.status, 'accepted');
    assert.equal(body.line_count, 2);
  });

  it('6. GET /api/v1/timeline', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/v1/timeline',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(body.events[0].username, 'root');
    assert.equal(body.events[1].username, 'admin');
  });

  it('7. GET /api/v1/clock-skew', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/v1/clock-skew',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.devices));
    assert.equal(body.devices.length, 1);
  });

  it('8. GET /api/v1/evidence and verify evidence', async () => {
    const listRes = await request(app, {
      method: 'GET',
      url: '/api/v1/evidence',
      headers: { cookie: sessionCookie },
    });
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.total, 1);

    const verifyRes = await request(app, {
      method: 'POST',
      url: '/api/v1/evidence/linux-srv-01/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/verify',
      headers: { cookie: sessionCookie },
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.equal(verifyBody.verified, true);
    assert.equal(verifyBody.status, 'verified');
  });

  it('9. GET /api/v1/evidence/trust-scores', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/v1/evidence/trust-scores',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.ok(body.items[0].score >= 80);
  });

  it('10. GET /api/v1/custody and custody verify', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/v1/custody',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.items.length >= 2);
    assert.equal(body.chain.intact, true);

    const checkRes = await request(app, {
      method: 'GET',
      url: '/api/v1/custody/verify',
      headers: { cookie: sessionCookie },
    });
    assert.equal(checkRes.status, 200);
    const check = await checkRes.json();
    assert.equal(check.intact, true);
  });

  it('11. GET /api/v1/demo/scenarios and POST /api/v1/demo/ingest', async () => {
    const scRes = await request(app, {
      method: 'GET',
      url: '/api/v1/demo/scenarios',
      headers: { cookie: sessionCookie },
    });
    assert.equal(scRes.status, 200);
    const scList = await scRes.json();
    assert.ok(scList.items.length > 5);

    const ingestRes = await request(app, {
      method: 'POST',
      url: '/api/v1/demo/ingest',
      headers: {
        'x-tracepoint-demo': '1',
        cookie: sessionCookie,
      },
      body: { scenario: 'linux_ssh' },
    });
    assert.equal(ingestRes.status, 201);
    const ingestBody = await ingestRes.json();
    assert.equal(ingestBody.demo, true);
  });

  it('12. Investigation workflow: create, notes, event linking, and PDF report', async () => {
    const createRes = await request(app, {
      method: 'POST',
      url: '/api/v1/investigations',
      headers: { cookie: sessionCookie },
      body: {
        title: 'Unauthorized SSH access investigation',
        severity: 'high',
      },
    });
    assert.equal(createRes.status, 201);
    const caseObj = await createRes.json();
    const caseId = caseObj.id;

    const noteRes = await request(app, {
      method: 'POST',
      url: `/api/v1/investigations/${caseId}/notes`,
      headers: { cookie: sessionCookie },
      body: {
        content: 'Noticed root login attempts followed by admin success.',
      },
    });
    assert.equal(noteRes.status, 201);

    const timelineRes = await request(app, {
      method: 'GET',
      url: '/api/v1/timeline',
      headers: { cookie: sessionCookie },
    });
    const tl = await timelineRes.json();
    const eventToLink = tl.events[0];

    const linkRes = await request(app, {
      method: 'POST',
      url: `/api/v1/investigations/${caseId}/events`,
      headers: { cookie: sessionCookie },
      body: {
        event_reference: JSON.stringify({
          device_id: eventToLink.device_id,
          batch_id: eventToLink.batch_id,
          timestamp: eventToLink.timestamp || '',
          event_type: eventToLink.event_type,
          username: eventToLink.username,
          message: String(eventToLink.raw_log).slice(0, 100),
        }),
      },
    });
    assert.equal(linkRes.status, 201);

    const reportRes = await request(app, {
      method: 'GET',
      url: `/api/v1/investigations/${caseId}/report`,
      headers: { cookie: sessionCookie },
    });
    assert.equal(reportRes.status, 200);
    assert.equal(reportRes.headers.get('content-type'), 'application/pdf');
    const pdfBuf = await reportRes.arrayBuffer();
    assert.ok(pdfBuf.byteLength > 1000);
  });

  it('13. Network lab workflow: ingest, get session, plain text report', async () => {
    const netPayload = {
      session_id: 'net-sess-api-01',
      device_id: 'network-lab',
      observations: [
        {
          phase: 'normal',
          timestamp_utc: '2026-11-18T12:00:00+00:00',
          packet_loss_percent: 0.0,
        },
      ],
    };

    const ingestRes = await request(app, {
      method: 'POST',
      url: '/api/v1/network/ingest',
      headers: {
        'x-api-key': agentApiKey,
      },
      body: Buffer.from(JSON.stringify(netPayload), 'utf8'),
    });
    assert.equal(ingestRes.status, 201);

    const listRes = await request(app, {
      method: 'GET',
      url: '/api/v1/network/sessions',
      headers: { cookie: sessionCookie },
    });
    assert.equal(listRes.status, 200);
    const listBody = await listRes.json();
    assert.equal(listBody.sessions.length, 1);

    const repRes = await request(app, {
      method: 'GET',
      url: '/api/v1/network/sessions/net-sess-api-01/report',
      headers: { cookie: sessionCookie },
    });
    assert.equal(repRes.status, 200);
    const text = await repRes.text();
    assert.ok(text.includes('TRACEPOINT - NETWORK INVESTIGATION REPORT'));
  });

  it('14. GET /api/v1/graph', async () => {
    const res = await request(app, {
      method: 'GET',
      url: '/api/v1/graph',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.nodes));
    assert.ok(Array.isArray(body.edges));
  });

  it('15. POST /api/v1/auth/logout', async () => {
    const res = await request(app, {
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: sessionCookie },
    });
    assert.equal(res.status, 200);

    const checkRes = await request(app, {
      method: 'GET',
      url: '/api/v1/timeline',
      headers: { cookie: sessionCookie },
    });
    assert.equal(checkRes.status, 401);
  });
});
