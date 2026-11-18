import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { z } from 'zod';
import { IANAZone } from 'luxon';
import { parseLog, CLOCK_TOLERANCE_SECONDS } from './parser.js';
import { utcNowIso } from './isotime.js';
import * as custody from './custody.js';
import { currentUser, userForAgentApiKey } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const router = Router();

export function getEvidenceDir() {
  return process.env.TRACEPOINT_EVIDENCE_DIR || path.resolve(__dirname, '../data/evidence');
}

export const MAX_BATCH_BYTES = 1024 * 1024; // 1 MiB
export const MAX_LOG_LINES = 1000;

export const SAFE_DEVICE_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
export const SAFE_BATCH_REGEX = /^[0-9a-fA-F-]{36}$/;
export const SAFE_ID_REGEX = /^[A-Za-z0-9_-]+$/;

export const LogBatchSchema = z.object({
  device_id: z.string().regex(SAFE_DEVICE_REGEX),
  batch_id: z.string().uuid(),
  log_type: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
  lines: z.array(z.string()).min(1).max(MAX_LOG_LINES),
  source_timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
});

function isValidTimezone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    return IANAZone.isValidZone(tz);
  } catch {
    return false;
  }
}

export function ownedEvidencePaths(ownerUserId, deviceId, batchId) {
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    const err = new Error('Sign in required');
    err.status = 401;
    throw err;
  }
  if (!SAFE_ID_REGEX.test(deviceId) || !SAFE_ID_REGEX.test(batchId)) {
    const err = new Error('Invalid evidence identifier');
    err.status = 400;
    throw err;
  }
  const deviceDir = path.join(getEvidenceDir(), 'users', String(ownerUserId), deviceId);
  return {
    evidencePath: path.join(deviceDir, `${batchId}.json`),
    metadataPath: path.join(deviceDir, `${batchId}.meta.json`),
    deviceDir,
  };
}

export function loadOwnedEvidenceMetadata(ownerUserId, deviceId, batchId) {
  const { metadataPath } = ownedEvidencePaths(ownerUserId, deviceId, batchId);
  if (!fs.existsSync(metadataPath)) {
    const err = new Error('Evidence not found');
    err.status = 404;
    throw err;
  }
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch {
    const err = new Error('Unreadable evidence metadata');
    err.status = 422;
    throw err;
  }
  if (!metadata || typeof metadata !== 'object' || metadata.owner_user_id !== ownerUserId) {
    const err = new Error('Evidence not found');
    err.status = 404;
    throw err;
  }
  return metadata;
}

export function storeLogBatch(payload, rawBytes, ownerUserId) {
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    const err = new Error('Evidence owner could not be resolved');
    err.status = 401;
    throw err;
  }
  if (!isValidTimezone(payload.source_timezone)) {
    const err = new Error('Invalid source timezone');
    err.status = 422;
    throw err;
  }

  const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');
  const { evidencePath, metadataPath, deviceDir } = ownedEvidencePaths(
    ownerUserId,
    payload.device_id,
    payload.batch_id
  );

  fs.mkdirSync(deviceDir, { recursive: true });

  const batchName = String(payload.batch_id);

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
      const existingBytes = fs.readFileSync(evidencePath);
      const existingHash = crypto.createHash('sha256').update(existingBytes).digest('hex');
      if (existingHash !== sha256) {
        const error = new Error('Batch ID already exists with different content');
        error.status = 409;
        throw error;
      }
      let existingMetadata;
      try {
        existingMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      } catch {
        const error = new Error(
          'Existing evidence has no readable ownership metadata and cannot be claimed automatically'
        );
        error.status = 409;
        throw error;
      }
      if (!existingMetadata || typeof existingMetadata !== 'object' || existingMetadata.owner_user_id !== ownerUserId) {
        const error = new Error('Evidence not found');
        error.status = 404;
        throw error;
      }

      custody.record(ownerUserId, 'ingest', {
        device_id: payload.device_id,
        batch_id: batchName,
        status: 'duplicate',
        sha256,
      });

      return {
        status: 'duplicate',
        batch_id: batchName,
        sha256,
      };
    }
    throw err;
  }

  const metadata = {
    owner_user_id: ownerUserId,
    device_id: payload.device_id,
    batch_id: batchName,
    log_type: payload.log_type,
    source_timezone: payload.source_timezone,
    line_count: payload.lines.length,
    sha256,
    received_at: utcNowIso(),
    evidence_file: path.basename(evidencePath),
  };

  const metaFd = fs.openSync(metadataPath, 'wx');
  try {
    fs.writeFileSync(metaFd, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
    fs.fsyncSync(metaFd);
  } finally {
    fs.closeSync(metaFd);
  }

  custody.record(ownerUserId, 'ingest', {
    device_id: payload.device_id,
    batch_id: batchName,
    status: 'accepted',
    sha256,
    line_count: payload.lines.length,
  });

  return { status: 'accepted', ...metadata };
}

// Timeline cache
let timelineCacheSignature = null;
let timelineCacheEvents = [];

function timelineEvidenceSignature(ownerUserId) {
  const ownerRoot = path.join(getEvidenceDir(), 'users', String(ownerUserId));
  if (!fs.existsSync(ownerRoot)) return '';

  const entries = [];
  try {
    const devices = fs.readdirSync(ownerRoot);
    for (const dev of devices.sort()) {
      const devPath = path.join(ownerRoot, dev);
      if (!fs.statSync(devPath).isDirectory()) continue;
      const files = fs.readdirSync(devPath);
      for (const file of files.sort()) {
        if (!file.endsWith('.json') || file.endsWith('.meta.json')) continue;
        const filePath = path.join(devPath, file);
        const metaPath = path.join(devPath, file.replace(/\.json$/, '.meta.json'));
        for (const candidate of [filePath, metaPath]) {
          try {
            const stat = fs.statSync(candidate);
            entries.push(`${candidate}:${stat.ino}:${stat.size}:${stat.mtimeMs}`);
          } catch {
            entries.push(`${candidate}:missing`);
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return entries.join('|');
}

export function getTimelineUncached(ownerUserId) {
  const events = [];
  const ownerRoot = path.join(getEvidenceDir(), 'users', String(ownerUserId));
  if (!fs.existsSync(ownerRoot)) {
    return { total: 0, events: [] };
  }

  try {
    const devices = fs.readdirSync(ownerRoot);
    for (const dev of devices) {
      const devDir = path.join(ownerRoot, dev);
      if (!fs.statSync(devDir).isDirectory()) continue;
      const files = fs.readdirSync(devDir);
      for (const file of files) {
        if (!file.endsWith('.json') || file.endsWith('.meta.json')) continue;
        const evidencePath = path.join(devDir, file);
        const metadataPath = path.join(devDir, file.replace(/\.json$/, '.meta.json'));

        if (!fs.existsSync(metadataPath)) continue;
        let metadata;
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        } catch {
          continue;
        }
        if (!metadata || typeof metadata !== 'object' || metadata.owner_user_id !== ownerUserId) {
          continue;
        }

        let batch;
        try {
          batch = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
        } catch {
          continue;
        }

        const receivedAt = metadata.received_at;
        const sourceTimezone = metadata.source_timezone || batch.source_timezone || 'Asia/Kolkata';

        if (Array.isArray(batch.lines)) {
          for (let index = 0; index < batch.lines.length; index++) {
            const line = batch.lines[index];
            const event = parseLog(
              line,
              batch.device_id,
              String(batch.batch_id),
              batch.log_type,
              receivedAt,
              sourceTimezone
            );
            event.line_number = index + 1;
            events.push(event);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error scanning timeline evidence:', err);
  }

  // Sort events matching Python's sort key:
  // (event["timestamp"] is None, timestamp_utc or timestamp parsed instant)
  events.sort((a, b) => {
    if (a.timestamp === null && b.timestamp !== null) return 1;
    if (a.timestamp !== null && b.timestamp === null) return -1;
    if (a.timestamp === null && b.timestamp === null) return 0;

    const timeA = a.timestamp_utc || a.timestamp;
    const timeB = b.timestamp_utc || b.timestamp;
    return String(timeA).localeCompare(String(timeB));
  });

  return { total: events.length, events };
}

export function getTimelineForUser(ownerUserId, filters = {}) {
  if (!Number.isInteger(ownerUserId) || ownerUserId <= 0) {
    const err = new Error('Sign in required');
    err.status = 401;
    throw err;
  }

  const sig = `${ownerUserId}:${timelineEvidenceSignature(ownerUserId)}`;
  if (sig !== timelineCacheSignature) {
    const data = getTimelineUncached(ownerUserId);
    timelineCacheEvents = data.events;
    timelineCacheSignature = sig;
  }

  let events = [...timelineCacheEvents];
  const { severity, device_id, event_type, username } = filters;
  if (severity) events = events.filter((e) => e.severity === severity);
  if (device_id) events = events.filter((e) => e.device_id === device_id);
  if (event_type) events = events.filter((e) => e.event_type === event_type);
  if (username) events = events.filter((e) => e.username === username);

  return { total: events.length, events };
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function clockSkewForUser(ownerUserId) {
  const events = getTimelineForUser(ownerUserId).events;
  const byDevice = new Map();

  for (const event of events) {
    const dev = event.device_id || 'unknown';
    if (!byDevice.has(dev)) byDevice.set(dev, []);
    byDevice.get(dev).push(event);
  }

  const sortedDevices = [...byDevice.keys()].sort();
  const devices = [];

  for (const dev of sortedDevices) {
    const devEvents = byDevice.get(dev);
    const offsets = devEvents
      .map((e) => e.clock_offset_seconds)
      .filter((v) => typeof v === 'number' && Number.isFinite(v));

    const inferred = devEvents.filter((e) => e.timestamp_source === 'syslog_inferred').length;

    if (offsets.length === 0) {
      devices.push({
        device_id: dev,
        events: devEvents.length,
        comparable_events: 0,
        inferred_timestamps: inferred,
        status: 'unknown',
        detail: 'No event on this device carries a timestamp that can be compared with its receipt time.',
      });
      continue;
    }

    const worstAhead = Math.max(...offsets);
    const middle = Math.round(median(offsets));

    let status;
    let detail;

    if (worstAhead > CLOCK_TOLERANCE_SECONDS) {
      status = 'clock_ahead';
      detail =
        `At least one line is dated ${worstAhead} seconds after this server received it. ` +
        "A line cannot be written after it arrives, so this device's clock is ahead.";
    } else if (middle < -CLOCK_TOLERANCE_SECONDS) {
      status = 'older_than_receipt';
      detail =
        `Lines arrive a median of ${Math.abs(middle)} seconds older than their receipt time. ` +
        'That is expected for logs collected after the fact and is not by itself evidence ' +
        'of a slow clock; compare against a device you know ships promptly.';
    } else {
      status = 'within_tolerance';
      detail = `Median offset is ${middle} seconds, inside the ${CLOCK_TOLERANCE_SECONDS}-second tolerance.`;
    }

    devices.push({
      device_id: dev,
      events: devEvents.length,
      comparable_events: offsets.length,
      inferred_timestamps: inferred,
      median_offset_seconds: middle,
      max_offset_seconds: worstAhead,
      min_offset_seconds: Math.min(...offsets),
      status,
      detail,
    });
  }

  return {
    tolerance_seconds: CLOCK_TOLERANCE_SECONDS,
    devices,
    skewed_devices: devices.filter((d) => d.status === 'clock_ahead').length,
  };
}

export function verifyEvidenceForOwner(deviceId, batchId, ownerUserId) {
  const { evidencePath } = ownedEvidencePaths(ownerUserId, deviceId, batchId);
  const metadata = loadOwnedEvidenceMetadata(ownerUserId, deviceId, batchId);

  if (!fs.existsSync(evidencePath)) {
    return {
      status: 'missing',
      verified: false,
      device_id: deviceId,
      batch_id: batchId,
      detail: 'Original evidence file is missing',
    };
  }

  const expectedHash = metadata.sha256;
  if (!expectedHash || typeof expectedHash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(expectedHash)) {
    return {
      status: 'invalid_metadata',
      verified: false,
      device_id: deviceId,
      batch_id: batchId,
      detail: 'Recorded SHA-256 hash is missing or invalid',
    };
  }

  let raw;
  try {
    raw = fs.readFileSync(evidencePath);
  } catch {
    const err = new Error('Could not read evidence file');
    err.status = 500;
    throw err;
  }

  const actualHash = crypto.createHash('sha256').update(raw).digest('hex');
  const verified = crypto.timingSafeEqual(
    Buffer.from(actualHash, 'hex'),
    Buffer.from(expectedHash.toLowerCase(), 'hex')
  );

  custody.record(ownerUserId, 'verify', {
    device_id: deviceId,
    batch_id: batchId,
    result: verified ? 'verified' : 'mismatch',
    sha256: actualHash,
  });

  return {
    status: verified ? 'verified' : 'mismatch',
    verified,
    device_id: deviceId,
    batch_id: batchId,
    expected_sha256: expectedHash,
    actual_sha256: actualHash,
    verified_at: utcNowIso(),
  };
}

export function qualityFor(deviceId, batchId, ownerUserId) {
  if (!SAFE_DEVICE_REGEX.test(deviceId) || !SAFE_BATCH_REGEX.test(batchId)) {
    const err = new Error('Invalid evidence identifier');
    err.status = 400;
    throw err;
  }

  const { evidencePath } = ownedEvidencePaths(ownerUserId, deviceId, batchId);
  const metadata = loadOwnedEvidenceMetadata(ownerUserId, deviceId, batchId);
  const expected = metadata.sha256;
  const validExpected = typeof expected === 'string' && /^[0-9a-fA-F]{64}$/.test(expected);

  let integrity;
  let raw = null;

  if (!fs.existsSync(evidencePath)) {
    integrity = 'missing';
  } else {
    try {
      raw = fs.readFileSync(evidencePath);
      const actual = crypto.createHash('sha256').update(raw).digest('hex');
      integrity = validExpected
        ? crypto.timingSafeEqual(
            Buffer.from(actual, 'hex'),
            Buffer.from(expected.toLowerCase(), 'hex')
          )
          ? 'verified'
          : 'mismatch'
        : 'invalid_metadata';
    } catch {
      const err = new Error('Cannot read evidence');
      err.status = 500;
      throw err;
    }
  }

  if (integrity !== 'verified') {
    return {
      device_id: deviceId,
      batch_id: batchId,
      score: 0,
      rating: 'Integrity alert',
      integrity,
      records: 0,
      breakdown: [
        {
          name: 'SHA-256 integrity',
          earned: 0,
          maximum: 40,
          reason: 'Evidence missing, hash mismatch, or invalid hash metadata',
        },
        {
          name: 'Parsing completeness',
          earned: 0,
          maximum: 25,
          reason: 'Not evaluated while integrity is unverified',
        },
        {
          name: 'Timestamp reliability',
          earned: 0,
          maximum: 20,
          reason: 'Not evaluated while integrity is unverified',
        },
        {
          name: 'Required field coverage',
          earned: 0,
          maximum: 15,
          reason: 'Not evaluated while integrity is unverified',
        },
      ],
      note: 'A matching hash establishes consistency with stored metadata, not source authenticity.',
    };
  }

  let batch;
  try {
    batch = JSON.parse(raw.toString('utf8'));
    if (
      !batch ||
      typeof batch !== 'object' ||
      !Array.isArray(batch.lines) ||
      batch.lines.length === 0 ||
      batch.lines.some((l) => typeof l !== 'string')
    ) {
      throw new Error('Invalid batch lines');
    }
    if (batch.device_id !== deviceId || String(batch.batch_id) !== batchId) {
      throw new Error('Evidence identifiers disagree with storage location');
    }
  } catch {
    return {
      device_id: deviceId,
      batch_id: batchId,
      score: 0,
      rating: 'Unusable evidence',
      integrity,
      records: 0,
      breakdown: [],
      note: 'Hash matches metadata, but the evidence payload cannot be parsed or has inconsistent identifiers.',
    };
  }

  const events = batch.lines.map((line) =>
    parseLog(
      line,
      deviceId,
      batchId,
      String(batch.log_type || 'unknown'),
      metadata.received_at,
      metadata.source_timezone || batch.source_timezone || 'Asia/Kolkata'
    )
  );

  const count = events.length;
  const complete = events.filter((e) => e.parse_status === 'complete').length;
  const reliable = events.filter(
    (e) => Boolean(e.timestamp_utc) && !e.timestamp_inferred && !e.timestamp_conflict
  ).length;

  let coverage = 0;
  for (const e of events) {
    for (const field of ['timestamp', 'event_type', 'log_format']) {
      if (Boolean(e[field]) && e[field] !== 'unknown') coverage++;
    }
  }

  const parsingPoints = Math.round((25 * complete) / count);
  const timePoints = Math.round((20 * reliable) / count);
  const fieldPoints = Math.round((15 * coverage) / (3 * count));
  const score = 40 + parsingPoints + timePoints + fieldPoints;

  const rating =
    score >= 90
      ? 'Strong'
      : score >= 75
        ? 'Good'
        : score >= 50
          ? 'Needs review'
          : 'Low quality';

  const breakdown = [
    {
      name: 'SHA-256 integrity',
      earned: 40,
      maximum: 40,
      reason: 'Stored evidence matches the recorded SHA-256',
    },
    {
      name: 'Parsing completeness',
      earned: parsingPoints,
      maximum: 25,
      reason: `${complete}/${count} records parsed without warnings`,
    },
    {
      name: 'Timestamp reliability',
      earned: timePoints,
      maximum: 20,
      reason: `${reliable}/${count} records have explicit, non-conflicting UTC timestamps`,
    },
    {
      name: 'Required field coverage',
      earned: fieldPoints,
      maximum: 15,
      reason: `${coverage}/${3 * count} timestamp, event type and log format fields available`,
    },
  ];

  return {
    device_id: deviceId,
    batch_id: batchId,
    score,
    rating,
    integrity,
    records: count,
    breakdown,
    note: 'Quality heuristic only. SHA-256 consistency does not prove source authenticity.',
  };
}

// Router routes
router.post('/ingest', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  const ownerUserId = userForAgentApiKey(apiKey);
  if (!ownerUserId) {
    return res.status(401).json({ detail: 'Invalid or revoked agent API key' });
  }

  const rawBytes = req.body;
  if (!Buffer.isBuffer(rawBytes)) {
    return res.status(422).json({ detail: 'Invalid log batch' });
  }
  if (rawBytes.length > MAX_BATCH_BYTES) {
    return res.status(413).json({ detail: 'Batch exceeds 1 MiB' });
  }

  let payloadObj;
  try {
    payloadObj = JSON.parse(rawBytes.toString('utf8'));
  } catch {
    return res.status(422).json({ detail: 'Invalid log batch' });
  }

  const parsed = LogBatchSchema.safeParse(payloadObj);
  if (!parsed.success) {
    return res.status(422).json({ detail: 'Invalid log batch' });
  }

  try {
    const result = storeLogBatch(parsed.data, rawBytes, ownerUserId);
    return res.status(201).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
});

router.get('/timeline', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }
  const { severity, device_id, event_type, username } = req.query;
  const result = getTimelineForUser(user.id, {
    severity: severity || undefined,
    device_id: device_id || undefined,
    event_type: event_type || undefined,
    username: username || undefined,
  });
  return res.json(result);
});

router.get('/clock-skew', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }
  return res.json(clockSkewForUser(user.id));
});

router.get('/evidence', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const ownerRoot = path.join(getEvidenceDir(), 'users', String(user.id));
  const batches = [];
  if (fs.existsSync(ownerRoot)) {
    try {
      const devices = fs.readdirSync(ownerRoot);
      for (const dev of devices) {
        const devDir = path.join(ownerRoot, dev);
        if (!fs.statSync(devDir).isDirectory()) continue;
        const files = fs.readdirSync(devDir);
        for (const file of files) {
          if (!file.endsWith('.meta.json')) continue;
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(devDir, file), 'utf8'));
            if (meta && typeof meta === 'object' && meta.owner_user_id === user.id) {
              batches.push({
                device_id: meta.device_id,
                batch_id: meta.batch_id,
                log_type: meta.log_type,
                source_timezone: meta.source_timezone || 'Asia/Kolkata',
                line_count: meta.line_count,
                sha256: meta.sha256,
                received_at: meta.received_at,
                evidence_file: meta.evidence_file,
              });
            }
          } catch {
            // ignore unreadable metadata
          }
        }
      }
    } catch {
      // ignore
    }
  }

  batches.sort((a, b) => String(b.received_at || '').localeCompare(String(a.received_at || '')));
  return res.json({ items: batches, total: batches.length });
});

router.post('/evidence/:device_id/:batch_id/verify', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }
  const { device_id, batch_id } = req.params;
  try {
    const result = verifyEvidenceForOwner(device_id, batch_id, user.id);
    return res.json(result);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
});

router.get('/evidence/trust-scores', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const ownerRoot = path.join(getEvidenceDir(), 'users', String(user.id));
  const items = [];
  if (fs.existsSync(ownerRoot)) {
    try {
      const devices = fs.readdirSync(ownerRoot).sort();
      for (const dev of devices) {
        const devDir = path.join(ownerRoot, dev);
        if (!fs.statSync(devDir).isDirectory()) continue;
        const files = fs.readdirSync(devDir).sort();
        for (const file of files) {
          if (!file.endsWith('.meta.json')) continue;
          const batchId = file.slice(0, -'.meta.json'.length);
          try {
            items.push(qualityFor(dev, batchId, user.id));
            if (items.length >= 1000) break;
          } catch {
            // ignore
          }
        }
        if (items.length >= 1000) break;
      }
    } catch {
      // ignore
    }
  }

  return res.json({ items, total: items.length });
});

router.get('/evidence/:device_id/:batch_id/trust-score', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }
  const { device_id, batch_id } = req.params;
  try {
    return res.json(qualityFor(device_id, batch_id, user.id));
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
});
