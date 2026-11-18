import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let defaultDbPath = process.env.TRACEPOINT_DB_PATH || path.resolve(__dirname, '../data/thread_auth.sqlite3');
let currentDb = null;
let currentDbPath = null;

export function setDbPath(newPath) {
  if (currentDb) {
    try {
      currentDb.close();
    } catch {
      // ignore close errors
    }
    currentDb = null;
    currentDbPath = null;
  }
  defaultDbPath = newPath;
}

export function getDb() {
  if (currentDb && currentDbPath === defaultDbPath) {
    return currentDb;
  }

  if (currentDb) {
    try {
      currentDb.close();
    } catch {
      // ignore
    }
  }

  if (defaultDbPath !== ':memory:') {
    const dir = path.dirname(defaultDbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(defaultDbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);

  currentDb = db;
  currentDbPath = defaultDbPath;
  return currentDb;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_api_keys (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custody_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      device_id TEXT,
      batch_id TEXT,
      case_id INTEGER,
      detail TEXT NOT NULL DEFAULT '{}',
      recorded_at TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS custody_log_owner
    ON custody_log(user_id, id);

    CREATE TABLE IF NOT EXISTS investigations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS investigation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      investigation_id INTEGER NOT NULL
        REFERENCES investigations(id) ON DELETE CASCADE,
      event_reference TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      UNIQUE(investigation_id, event_reference)
    );

    CREATE TABLE IF NOT EXISTS investigation_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      investigation_id INTEGER NOT NULL
        REFERENCES investigations(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}
