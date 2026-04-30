// SQLite database service — singleton, opened once at startup.
// Uses better-sqlite3 (synchronous API, no connection pooling needed for single-user local app).

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { config } from "../config";

// Ensure the directory exists before opening the file
const dbDir = path.dirname(config.dbPath);
fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(config.dbPath);

// Enforce foreign key constraints on every connection open
db.pragma("foreign_keys = ON");

// Create tables and index if they do not yet exist
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL DEFAULT 'New Chat',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role       TEXT    NOT NULL CHECK(role IN ('user', 'assistant', 'error', 'cancelled')),
    content    TEXT    NOT NULL,
    model      TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_created
    ON chat_messages(session_id, created_at);

  -- Memory notes — manually created by the user, never written autonomously.
  -- No automatic injection into the system prompt in v0.9.0.
  CREATE TABLE IF NOT EXISTS memories (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL CHECK(type IN ('preference', 'project', 'note')),
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_memories_type
    ON memories(type);
`);

// ── Schema migrations ─────────────────────────────────────────────────────────
//
// SQLite does not support "ADD COLUMN IF NOT EXISTS" before 3.35.0, so we
// attempt the ALTER and swallow the "duplicate column name" error that SQLite
// throws when the column already exists.  Any other error is re-thrown.

// v1.1.2: add pinned column — 0 = unpinned, 1 = pinned (user-set, not auto)
try {
  db.exec(
    "ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0"
  );
} catch (e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes("duplicate column name")) throw e;
  // Column already exists — expected on every startup after the first migration
}

console.log(`[Jarvis] Database ready at ${config.dbPath}`);

export default db;
