import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { getEvidenceDir } from './evidence.js';
import { utcNowIso } from './isotime.js';
import * as custody from './custody.js';
import * as networkRca from './networkRca.js';
import * as networkReport from './networkReport.js';
import { currentUser, userForAgentApiKey } from './auth.js';

export const router = Router();

export const MAX_SESSION_BYTES = 2 * 1024 * 1024; // 2 MiB
export const SAFE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function sessionDir(userId) {
  return path.join(getEvidenceDir(), 'users', String(userId), 'network');
}

const ObservationSchema = z
  .object({
    phase: z.string().min(1).max(32),
    timestamp_utc: z.string().min(1).max(64),
    packet_loss_percent: z.number().nullable().optional(),
    topology: z.record(z.any()).nullable().optional(),
  })
  .passthrough();

const SessionBatchSchema = z
  .object({
    session_id: z.string().min(1).max(64).regex(SAFE_ID_REGEX),
    device_id: z.string().min(1).max(64).regex(SAFE_ID_REGEX).default('network-lab'),
    source: z.string().max(200).nullable().optional(),
    observations: z.array(ObservationSchema).min(1).max(200),
  })
  .passthrough();

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function summarise(sessionId, stored, meta) {
  const observations = stored?.observations || [];
  const phases = observations.map((o) => o?.phase).filter(Boolean);
  const hasTopology = observations.some((o) => Boolean(o?.topology));

  return {
    session_id: sessionId,
    device_id: stored?.device_id,
    source: stored?.source,
    received_at: meta?.received_at,
    sha256: meta?.sha256,
    observations: observations.length,
    phases,
    topology_available: hasTopology,
  };
}

export function loadForAnalysis(userId, sessionId) {
  if (!SAFE_ID_REGEX.test(sessionId)) {
    const err = new Error('Invalid session_id');
    err.status = 422;
    throw err;
  }

  const directory = sessionDir(userId);
  const filePath = path.join(directory, `${sessionId}.json`);
  const metaPath = path.join(directory, `${sessionId}.meta.json`);

  if (!fs.existsSync(filePath)) {
    const err = new Error('Network session not found');
    err.status = 404;
    throw err;
  }

  const stored = readJsonFile(filePath);
  if (!stored || typeof stored !== 'object') {
    const err = new Error('Stored session could not be read');
    err.status = 500;
    throw err;
  }

  const meta = readJsonFile(metaPath) || {};
  const observations = stored.observations || [];

  let analysis;
  try {
    analysis = networkRca.analyse(observations);
  } catch (error) {
    analysis = {
      topology_available: false,
      hypotheses: [],
      fault_localisation: null,
      impact: null,
      recovery: null,
      observed_facts: [],
      limitations: ['Analysis failed: ' + String(error.message || error)],
    };
  }

  return {
    summary: summarise(sessionId, stored, meta),
    observations,
    analysis,
  };
}

router.post('/ingest', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const ownerUserId = userForAgentApiKey(apiKey);
  if (!ownerUserId) {
    return res.status(401).json({ detail: 'Invalid or revoked agent API key' });
  }

  const rawBytes = req.body;
  if (!Buffer.isBuffer(rawBytes)) {
    return res.status(422).json({ detail: 'Invalid network session' });
  }
  if (rawBytes.length > MAX_SESSION_BYTES) {
    return res.status(413).json({ detail: 'Session exceeds 2 MiB' });
  }

  let bodyObj;
  try {
    bodyObj = JSON.parse(rawBytes.toString('utf8'));
  } catch {
    return res.status(422).json({ detail: 'Invalid network session' });
  }

  const parsed = SessionBatchSchema.safeParse(bodyObj);
  if (!parsed.success) {
    return res.status(422).json({ detail: 'Invalid network session' });
  }

  const payload = parsed.data;
  const directory = sessionDir(ownerUserId);
  fs.mkdirSync(directory, { recursive: true });

  const evidencePath = path.join(directory, `${payload.session_id}.json`);
  const metadataPath = path.join(directory, `${payload.session_id}.meta.json`);
  const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');

  try {
    const fd = fs.openSync(evidencePath, 'wx');
    try {
      fs.writeFileSync(fd, rawBytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if (err.code === 'EEXIST') {
      const existing = readJsonFile(metadataPath) || {};
      if (existing.sha256 === sha256) {
        return res.json({
          session_id: payload.session_id,
          sha256,
          duplicate: true,
          detail: 'This session was already received; evidence left unchanged.',
        });
      }
      return res.status(409).json({
        detail: 'A different session is already stored under this session_id',
      });
    }
    return res.status(500).json({ detail: 'Failed to write evidence' });
  }

  const receivedAt = utcNowIso();
  const metadata = {
    session_id: payload.session_id,
    device_id: payload.device_id,
    sha256,
    bytes: rawBytes.length,
    received_at: receivedAt,
    observations: payload.observations.length,
  };

  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8');

  custody.record(ownerUserId, 'ingest', {
    device_id: payload.device_id,
    batch_id: payload.session_id,
    kind: 'network_session',
    sha256,
    observations: payload.observations.length,
  });

  return res.status(201).json({
    session_id: payload.session_id,
    sha256,
    observations: payload.observations.length,
    received_at: receivedAt,
  });
});

router.get('/sessions', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const directory = sessionDir(user.id);
  const items = [];

  if (fs.existsSync(directory)) {
    try {
      const files = fs.readdirSync(directory).sort();
      for (const file of files) {
        if (!file.endsWith('.json') || file.endsWith('.meta.json')) continue;
        const sessionId = file.slice(0, -'.json'.length);
        const stored = readJsonFile(path.join(directory, file));
        if (!stored || typeof stored !== 'object') continue;
        const meta = readJsonFile(path.join(directory, `${sessionId}.meta.json`)) || {};
        items.push(summarise(sessionId, stored, meta));
      }
    } catch {
      // ignore
    }
  }

  items.sort((a, b) => String(b.received_at || '').localeCompare(String(a.received_at || '')));
  return res.json({ sessions: items });
});

router.get('/sessions/:session_id', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  try {
    const { summary, observations, analysis } = loadForAnalysis(
      user.id,
      req.params.session_id
    );
    return res.json({
      session: summary,
      observations,
      rca: analysis,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
});

router.get('/sessions/:session_id/report', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const sessionId = req.params.session_id;
  try {
    const { summary, observations, analysis } = loadForAnalysis(user.id, sessionId);
    const text = networkReport.build(summary, observations, analysis);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="tracepoint_network_${sessionId}.txt"`
    );
    return res.send(text);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
});
