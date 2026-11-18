import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from './db.js';
import { utcNowIso } from './isotime.js';

export const SESSION_DAYS = 7;
export const router = Router();

export function tokenDigest(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [, salt, hash] = parts;
    const computed = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(hash, 'hex');
    if (computed.length !== expected.length) return false;
    return crypto.timingSafeEqual(computed, expected);
  }
  return false;
}

export function currentUser(req) {
  const token = req.cookies?.thread_session;
  if (!token) return null;

  const db = getDb();
  const digest = tokenDigest(token);
  const now = utcNowIso();

  const stmt = db.prepare(`
    SELECT u.id, u.email, u.name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  const row = stmt.get(digest, now);
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}

export function issueSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expiryDate = new Date(now.getTime() + SESSION_DAYS * 86400 * 1000);
  const expiry = expiryDate.toISOString();

  const db = getDb();
  const insert = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
  insert.run(tokenDigest(token), userId, expiry);

  res.cookie('thread_session', token, {
    httpOnly: true,
    secure: process.env.THREAD_COOKIE_SECURE?.toLowerCase() === 'true',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 86400 * 1000,
    path: '/',
  });
}

export function userForAgentApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return null;
  const digest = tokenDigest(apiKey);
  const db = getDb();
  const stmt = db.prepare('SELECT user_id FROM agent_api_keys WHERE token_hash = ?');
  const row = stmt.get(digest);
  return row ? Number(row.user_id) : null;
}

const SignupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  password: z.string().min(10).max(256),
});

const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string(),
});

router.post('/signup', (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ detail: parsed.error.issues.map((i) => i.message).join('; ') });
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();
  const hashed = hashPassword(password);
  const now = utcNowIso();

  const db = getDb();
  try {
    const insert = db.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)');
    const result = insert.run(normalizedEmail, name, hashed, now);
    const userId = Number(result.lastInsertRowid);
    issueSession(res, userId);
    return res.status(201).json({ user: { id: userId, email: normalizedEmail, name } });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ detail: 'An account with that email already exists' });
    }
    return res.status(500).json({ detail: 'Failed to create user' });
  }
});

router.post('/login', (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ detail: 'Invalid login details' });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const db = getDb();
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  const row = stmt.get(normalizedEmail);

  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ detail: 'Incorrect email or password' });
  }

  issueSession(res, row.id);
  return res.json({ user: { id: row.id, email: row.email, name: row.name } });
});

router.get('/me', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Not signed in' });
  }
  return res.json({ user });
});

router.post('/logout', (req, res) => {
  const token = req.cookies?.thread_session;
  if (token) {
    const db = getDb();
    const del = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
    del.run(tokenDigest(token));
  }
  res.clearCookie('thread_session', { path: '/', sameSite: 'lax' });
  return res.json({ ok: true });
});

router.post('/agent-key', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const apiKey = 'tp_agent_' + crypto.randomBytes(40).toString('base64url');
  const createdAt = utcNowIso();
  const digest = tokenDigest(apiKey);

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO agent_api_keys (user_id, token_hash, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      token_hash = excluded.token_hash,
      created_at = excluded.created_at
  `);
  stmt.run(user.id, digest, createdAt);

  return res.json({
    api_key: apiKey,
    created_at: createdAt,
    warning: 'Copy this key now. It cannot be retrieved later; creating another key rotates it.',
  });
});

router.delete('/agent-key', (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ detail: 'Sign in required' });
  }

  const db = getDb();
  const stmt = db.prepare('DELETE FROM agent_api_keys WHERE user_id = ?');
  const result = stmt.run(user.id);

  return res.json({ revoked: result.changes > 0 });
});
