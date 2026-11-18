import { Router } from 'express';
import { z } from 'zod';
import { getDb } from './db.js';
import { utcNowIso } from './isotime.js';
import { currentUser } from './auth.js';
import * as custody from './custody.js';
import { getTimelineForUser } from './evidence.js';

export const router = Router();

const CreateInvestigationSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().max(3000).default(''),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

const UpdateInvestigationSchema = z.object({
  status: z.enum(['open', 'investigating', 'resolved']),
});

const AddNoteSchema = z.object({
  content: z.string().min(1).max(5000),
});

const LinkEventSchema = z.object({
  event_reference: z.string().min(1).max(500),
});

export function getOwnedCase(db, caseId, userId) {
  const stmt = db.prepare('SELECT * FROM investigations WHERE id = ? AND user_id = ?');
  const row = stmt.get(caseId, userId);
  if (!row) {
    const err = new Error('Investigation not found');
    err.status = 404;
    throw err;
  }
  return { ...row };
}

export function validateEventReference(referenceStr, ownerUserId) {
  let supplied;
  try {
    supplied = JSON.parse(referenceStr);
  } catch {
    const err = new Error('Event reference must be valid JSON');
    err.status = 422;
    throw err;
  }

  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
    const err = new Error('Event reference must be a JSON object');
    err.status = 422;
    throw err;
  }

  const expectedFields = ['device_id', 'batch_id', 'timestamp', 'event_type', 'username', 'message'];
  const suppliedKeys = Object.keys(supplied);
  if (
    suppliedKeys.length !== expectedFields.length ||
    !expectedFields.every((f) => suppliedKeys.includes(f))
  ) {
    const err = new Error('Invalid event reference fields');
    err.status = 422;
    throw err;
  }

  const timeline = getTimelineForUser(ownerUserId);
  for (const event of timeline.events || []) {
    const expected = {
      device_id: event.device_id || '',
      batch_id: event.batch_id || '',
      timestamp: event.timestamp || event.event_timestamp || event.received_at || '',
      event_type: event.event_type || event.type || '',
      username: event.username || '',
      message: String(event.message || event.raw_line || event.raw_log || '').slice(0, 100),
    };

    let match = true;
    for (const f of expectedFields) {
      if (String(supplied[f] || '') !== String(expected[f])) {
        match = false;
        break;
      }
    }
    if (match) return;
  }

  const err = new Error('Event reference does not match any evidence collected by this account');
  err.status = 422;
  throw err;
}

export function filterOwnedEventRows(rows, ownerUserId) {
  const fields = ['device_id', 'batch_id', 'timestamp', 'event_type', 'username', 'message'];
  const timeline = getTimelineForUser(ownerUserId);
  const allowed = new Set();

  for (const event of timeline.events || []) {
    const ref = {
      device_id: event.device_id || '',
      batch_id: event.batch_id || '',
      timestamp: event.timestamp || event.event_timestamp || event.received_at || '',
      event_type: event.event_type || event.type || '',
      username: event.username || '',
      message: String(event.message || event.raw_line || event.raw_log || '').slice(0, 100),
    };
    const sorted = {};
    for (const k of Object.keys(ref).sort()) sorted[k] = ref[k];
    allowed.add(JSON.stringify(sorted));
  }

  const visible = [];
  for (const row of rows) {
    try {
      const ref = JSON.parse(row.event_reference);
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) continue;
      const refKeys = Object.keys(ref);
      if (refKeys.length !== fields.length || !fields.every((f) => refKeys.includes(f))) {
        continue;
      }
      const sorted = {};
      for (const k of Object.keys(ref).sort()) sorted[k] = ref[k];
      if (allowed.has(JSON.stringify(sorted))) {
        visible.push({ ...row });
      }
    } catch {
      continue;
    }
  }
  return visible;
}

router.get('', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const db = getDb();
  const stmt = db.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM investigation_events e WHERE e.investigation_id = i.id) AS event_count,
      (SELECT COUNT(*) FROM investigation_notes n WHERE n.investigation_id = i.id) AS note_count
    FROM investigations i
    WHERE i.user_id = ?
    ORDER BY i.updated_at DESC
  `);
  const rows = stmt.all(user.id);
  return res.json({ items: rows });
});

router.post('', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const parsed = CreateInvestigationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ detail: parsed.error.issues.map((i) => i.message).join('; ') });
  }

  const { title, description, severity } = parsed.data;
  const now = utcNowIso();

  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO investigations (user_id, title, description, severity, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?)
  `);
  const result = insert.run(user.id, title, description, severity, now, now);
  const created = getOwnedCase(db, Number(result.lastInsertRowid), user.id);
  return res.status(201).json(created);
});

router.get('/:case_id', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const caseId = Number.parseInt(req.params.case_id, 10);
  if (Number.isNaN(caseId)) {
    return res.status(404).json({ detail: 'Investigation not found' });
  }

  const db = getDb();
  let item;
  try {
    item = getOwnedCase(db, caseId, user.id);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }

  const eventStmt = db.prepare(
    'SELECT * FROM investigation_events WHERE investigation_id = ?'
  );
  const eventRows = eventStmt.all(caseId);

  const noteStmt = db.prepare(
    'SELECT * FROM investigation_notes WHERE investigation_id = ? ORDER BY created_at DESC'
  );
  const noteRows = noteStmt.all(caseId);

  item.notes = noteRows;
  item.events = filterOwnedEventRows(eventRows, user.id);
  return res.json(item);
});

router.patch('/:case_id', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const caseId = Number.parseInt(req.params.case_id, 10);
  if (Number.isNaN(caseId)) {
    return res.status(404).json({ detail: 'Investigation not found' });
  }

  const parsed = UpdateInvestigationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ detail: 'Invalid status' });
  }

  const db = getDb();
  try {
    getOwnedCase(db, caseId, user.id);
    const now = utcNowIso();
    const update = db.prepare(
      'UPDATE investigations SET status = ?, updated_at = ? WHERE id = ?'
    );
    update.run(parsed.data.status, now, caseId);
    const updated = getOwnedCase(db, caseId, user.id);
    return res.json(updated);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
});

router.post('/:case_id/notes', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const caseId = Number.parseInt(req.params.case_id, 10);
  if (Number.isNaN(caseId)) {
    return res.status(404).json({ detail: 'Investigation not found' });
  }

  const parsed = AddNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ detail: 'Invalid note content' });
  }

  const db = getDb();
  try {
    getOwnedCase(db, caseId, user.id);
    const now = utcNowIso();

    const insert = db.prepare(
      'INSERT INTO investigation_notes (investigation_id, content, created_at) VALUES (?, ?, ?)'
    );
    const result = insert.run(caseId, parsed.data.content, now);

    const update = db.prepare('UPDATE investigations SET updated_at = ? WHERE id = ?');
    update.run(now, caseId);

    const note = db.prepare('SELECT * FROM investigation_notes WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(note);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
});

router.post('/:case_id/events', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const caseId = Number.parseInt(req.params.case_id, 10);
  if (Number.isNaN(caseId)) {
    return res.status(404).json({ detail: 'Investigation not found' });
  }

  const parsed = LinkEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ detail: 'Invalid event reference' });
  }

  const db = getDb();
  try {
    getOwnedCase(db, caseId, user.id);
    validateEventReference(parsed.data.event_reference, user.id);

    const now = utcNowIso();
    const insert = db.prepare(`
      INSERT INTO investigation_events (investigation_id, event_reference, linked_at)
      VALUES (?, ?, ?)
    `);

    let result;
    try {
      result = insert.run(caseId, parsed.data.event_reference, now);
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ detail: 'Event is already linked to this investigation' });
      }
      throw err;
    }

    const update = db.prepare('UPDATE investigations SET updated_at = ? WHERE id = ?');
    update.run(now, caseId);

    const eventRow = db
      .prepare('SELECT * FROM investigation_events WHERE id = ?')
      .get(result.lastInsertRowid);

    const ref = JSON.parse(parsed.data.event_reference);
    custody.record(user.id, 'link', {
      case_id: caseId,
      device_id: ref.device_id || null,
      batch_id: ref.batch_id || null,
      event_timestamp: ref.timestamp || null,
    });

    return res.status(201).json(eventRow);
  } catch (err) {
    return res.status(err.status || 500).json({ detail: err.message });
  }
});
