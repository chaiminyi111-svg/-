const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { hashPassword } = require("./auth");
const { generatePassword, nowIso } = require("./util");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  chat_type TEXT NOT NULL DEFAULT 'private',
  title TEXT NOT NULL,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_message_at TEXT,
  last_message_preview TEXT,
  last_message_direction TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_assignee ON conversations(assignee_id);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);

CREATE TABLE IF NOT EXISTS canned_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_canned_replies_updated ON canned_replies(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  telegram_message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  meta_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_telegram
  ON messages(conversation_id, direction, telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  try {
    fs.chmodSync(path.dirname(dbPath), 0o700);
  } catch {}

  const db = new DatabaseSync(dbPath);
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {}
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  ensureColumn(db, "conversations", "notes", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "conversations", "tags_json", "TEXT NOT NULL DEFAULT '[]'");
  return db;
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function bootstrapAdmin(db, config) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (Number(count) > 0) return { created: false };

  const username = config.adminUsername || "admin";
  const password = config.adminPassword || generatePassword(16);
  const now = nowIso();

  db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', 1, ?, ?)`
  ).run(username, config.adminDisplayName || "管理员", hashPassword(password), now, now);

  return {
    created: true,
    username,
    password: config.adminPassword ? null : password,
    generated: !config.adminPassword
  };
}

function withTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function audit(db, userId, action, targetType = null, targetId = null, detail = null) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId || null, action, targetType, targetId === null ? null : String(targetId), detail, nowIso());
}

function getSetting(db, key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

module.exports = {
  openDatabase,
  bootstrapAdmin,
  withTransaction,
  audit,
  getSetting,
  setSetting
};
