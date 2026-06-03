import Database from 'better-sqlite3';

let db;

export function initDb(dbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id         TEXT PRIMARY KEY,
      moment     TEXT NOT NULL,
      kind       TEXT NOT NULL,
      filename   TEXT NOT NULL,
      mime       TEXT NOT NULL,
      size       INTEGER NOT NULL,
      author     TEXT,
      body       TEXT,
      ip         TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      hidden     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_items_created
      ON items(created_at DESC) WHERE hidden = 0;
    CREATE INDEX IF NOT EXISTS idx_items_moment
      ON items(moment, created_at DESC) WHERE hidden = 0;
  `);

  // Migración idempotente: añade `body` si la tabla fue creada por una versión previa.
  const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  if (!cols.includes('body')) {
    db.exec('ALTER TABLE items ADD COLUMN body TEXT');
  }

  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export const queries = {
  insertItem: () =>
    db.prepare(`
      INSERT INTO items (id, moment, kind, filename, mime, size, author, body, ip, user_agent)
      VALUES (@id, @moment, @kind, @filename, @mime, @size, @author, @body, @ip, @user_agent)
    `),
  listRecent: () =>
    db.prepare(`
      SELECT id, moment, kind, filename, mime, size, author, body, created_at
      FROM items
      WHERE hidden = 0
      ORDER BY created_at DESC
      LIMIT ?
    `),
  listByMoment: () =>
    db.prepare(`
      SELECT id, moment, kind, filename, mime, size, author, body, created_at
      FROM items
      WHERE hidden = 0 AND moment = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
  hideItem: () =>
    db.prepare(`UPDATE items SET hidden = 1 WHERE id = ?`),
};
