/* Sole SQL surface for this whole backend -- every other module reads/
   writes through the functions exported here, never through a raw
   better-sqlite3 handle of its own. Keeping every query in one file is
   what makes swapping the storage engine later (e.g. to MariaDB, if Alok
   ever wants a client-server RDBMS with its own admin GUI instead of this
   embedded, single-file database) a contained change instead of a rewrite.

   SQLite, not Postgres/MariaDB: a single admin writer, moderate read
   volume from ~57 branches + the separate Recovery Dashboard portal, and
   data shaped as a handful of named JSON blobs (not real relational
   tables) -- WAL mode gives exactly the concurrency this needs (many
   concurrent readers, one occasional writer) with none of a standalone
   DB server's operational overhead (no separate process, no connection
   secret, one file to back up). */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'npa-nas.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS datasets (
    path        TEXT PRIMARY KEY,
    content     TEXT NOT NULL,
    plain_hash  TEXT,
    updated_at  TEXT NOT NULL,
    updated_by  TEXT
  );

  CREATE TABLE IF NOT EXISTS history_index (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    file          TEXT NOT NULL,
    content       TEXT NOT NULL,
    date          TEXT,
    row_count     INTEGER,
    published_at  TEXT NOT NULL,
    published_by  TEXT,
    is_rollback   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admin_account (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    username       TEXT NOT NULL,
    password_hash  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash  TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
`);

const MAX_HISTORY_ENTRIES = 60;

/* ---------- datasets ---------- */
const stmtGetDataset = db.prepare('SELECT * FROM datasets WHERE path = ?');
const stmtUpsertDataset = db.prepare(`
  INSERT INTO datasets (path, content, plain_hash, updated_at, updated_by)
  VALUES (@path, @content, @plain_hash, @updated_at, @updated_by)
  ON CONFLICT(path) DO UPDATE SET
    content = excluded.content,
    plain_hash = excluded.plain_hash,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by
`);
function getDataset(pathName) { return stmtGetDataset.get(pathName); }
function upsertDataset({ path: p, content, plainHash, updatedBy }) {
  stmtUpsertDataset.run({
    path: p, content, plain_hash: plainHash || null,
    updated_at: new Date().toISOString(), updated_by: updatedBy || null,
  });
}

/* ---------- history ---------- */
const stmtListHistory = db.prepare('SELECT id, file, date, row_count, published_at, published_by, is_rollback FROM history_index ORDER BY id DESC');
const stmtGetHistoryByFile = db.prepare('SELECT * FROM history_index WHERE file = ?');
const stmtInsertHistory = db.prepare(`
  INSERT INTO history_index (file, content, date, row_count, published_at, published_by, is_rollback)
  VALUES (@file, @content, @date, @row_count, @published_at, @published_by, @is_rollback)
`);
const stmtCountHistory = db.prepare('SELECT COUNT(*) AS n FROM history_index');
const stmtOldestHistoryIds = db.prepare('SELECT id FROM history_index ORDER BY id ASC LIMIT ?');
const stmtDeleteHistoryById = db.prepare('DELETE FROM history_index WHERE id = ?');

function listHistory() { return stmtListHistory.all(); }
function getHistoryByFile(file) { return stmtGetHistoryByFile.get(file); }
function insertHistoryAndEvict({ file, content, date, rowCount, publishedBy, isRollback }) {
  stmtInsertHistory.run({
    file, content, date: date || null, row_count: rowCount || null,
    published_at: new Date().toISOString(), published_by: publishedBy || null,
    is_rollback: isRollback ? 1 : 0,
  });
  const { n } = stmtCountHistory.get();
  const evicted = n - MAX_HISTORY_ENTRIES;
  if (evicted > 0) {
    const ids = stmtOldestHistoryIds.all(evicted);
    const del = db.transaction((rows) => { rows.forEach(r => stmtDeleteHistoryById.run(r.id)); });
    del(ids);
  }
}

/* ---------- admin account + sessions ---------- */
const stmtGetAdmin = db.prepare('SELECT * FROM admin_account WHERE id = 1');
const stmtSetAdmin = db.prepare('INSERT INTO admin_account (id, username, password_hash) VALUES (1, ?, ?)');
const stmtUpdateAdminPassword = db.prepare('UPDATE admin_account SET password_hash = ? WHERE id = 1');
function getAdmin() { return stmtGetAdmin.get(); }
function createAdmin(username, passwordHash) { stmtSetAdmin.run(username, passwordHash); }
function updateAdminPassword(passwordHash) { stmtUpdateAdminPassword.run(passwordHash); }

const stmtInsertSession = db.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)');
const stmtGetSession = db.prepare('SELECT * FROM admin_sessions WHERE token_hash = ?');
const stmtDeleteSession = db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?');
const stmtDeleteExpiredSessions = db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?');
function createSession(tokenHash, ttlHours) {
  const now = new Date();
  const expires = new Date(now.getTime() + ttlHours * 3600 * 1000);
  stmtInsertSession.run(tokenHash, now.toISOString(), expires.toISOString());
}
function getValidSession(tokenHash) {
  stmtDeleteExpiredSessions.run(new Date().toISOString());
  return stmtGetSession.get(tokenHash);
}
function deleteSession(tokenHash) { stmtDeleteSession.run(tokenHash); }

/* Atomic multi-file publish: every dataset upsert + the history insert/
   evict for data/latest.json all succeed together or none do -- mirrors
   what js/publish.js's single Git commit already guaranteed (every file
   in one tree/commit), just via a SQLite transaction instead. */
const publishTxn = db.transaction((files, historyEntry) => {
  files.forEach(f => upsertDataset(f));
  if (historyEntry) insertHistoryAndEvict(historyEntry);
});

module.exports = {
  getDataset, upsertDataset,
  listHistory, getHistoryByFile, insertHistoryAndEvict,
  getAdmin, createAdmin, updateAdminPassword,
  createSession, getValidSession, deleteSession,
  publishTxn,
  MAX_HISTORY_ENTRIES,
};
