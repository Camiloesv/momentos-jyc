import Database from 'better-sqlite3';

let db;

export function initDb(dbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      id           TEXT PRIMARY KEY,
      moment       TEXT NOT NULL,
      kind         TEXT NOT NULL,
      filename     TEXT NOT NULL,
      mime         TEXT NOT NULL,
      size         INTEGER NOT NULL,
      author       TEXT,
      body         TEXT,
      ip           TEXT,
      user_agent   TEXT,
      uploader_id  TEXT,
      source       TEXT NOT NULL DEFAULT 'app',
      source_id    TEXT,
      created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      hidden       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_items_created
      ON items(created_at DESC) WHERE hidden = 0;
    CREATE INDEX IF NOT EXISTS idx_items_moment
      ON items(moment, created_at DESC) WHERE hidden = 0;
  `);

  // Migraciones idempotentes para DBs creadas por versiones previas.
  const cols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  if (!cols.includes('body')) {
    db.exec('ALTER TABLE items ADD COLUMN body TEXT');
  }
  if (!cols.includes('uploader_id')) {
    db.exec('ALTER TABLE items ADD COLUMN uploader_id TEXT');
  }
  if (!cols.includes('source')) {
    db.exec("ALTER TABLE items ADD COLUMN source TEXT NOT NULL DEFAULT 'app'");
  }
  if (!cols.includes('source_id')) {
    db.exec('ALTER TABLE items ADD COLUMN source_id TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_items_uploader ON items(uploader_id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source ON items(source, source_id) WHERE source_id IS NOT NULL');

  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

export const queries = {
  insertItem: () =>
    db.prepare(`
      INSERT INTO items (id, moment, kind, filename, mime, size, author, body, ip, user_agent, uploader_id)
      VALUES (@id, @moment, @kind, @filename, @mime, @size, @author, @body, @ip, @user_agent, @uploader_id)
    `),
  listRecent: () =>
    db.prepare(`
      SELECT id, moment, kind, filename, mime, size, author, body, uploader_id, source, created_at
      FROM items
      WHERE hidden = 0
      ORDER BY created_at DESC
      LIMIT ?
    `),
  listByMoment: () =>
    db.prepare(`
      SELECT id, moment, kind, filename, mime, size, author, body, uploader_id, source, created_at
      FROM items
      WHERE hidden = 0 AND moment = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
  listAllForExport: () =>
    db.prepare(`
      SELECT id, moment, kind, filename, mime, size, author, body, uploader_id, hidden, created_at
      FROM items
      ORDER BY created_at ASC
    `),
  hideItem: () =>
    db.prepare(`UPDATE items SET hidden = 1 WHERE id = ?`),
  hideOwnItem: () =>
    db.prepare(`UPDATE items SET hidden = 1 WHERE id = ? AND uploader_id = ? AND hidden = 0`),
  restoreOwnItem: () =>
    db.prepare(`UPDATE items SET hidden = 0 WHERE id = ? AND uploader_id = ? AND hidden = 1`),
  getItemForOwner: () =>
    db.prepare(`SELECT id, kind, uploader_id, hidden FROM items WHERE id = ?`),
  getItemPublic: () =>
    db.prepare(`
      SELECT id, moment, kind, filename, author, body, uploader_id, source, created_at
      FROM items WHERE id = ?
    `),
  listAdmin: () =>
    db.prepare(`
      SELECT id, moment, kind, filename, mime, size, author, body, uploader_id, source, hidden, created_at
      FROM items
      ORDER BY created_at DESC
      LIMIT ?
    `),
  restoreItem: () =>
    db.prepare(`UPDATE items SET hidden = 0 WHERE id = ?`),
  insertRsvpNote: () =>
    db.prepare(`
      INSERT OR IGNORE INTO items
        (id, moment, kind, filename, mime, size, author, body, ip, user_agent, uploader_id, source, source_id, created_at)
      VALUES
        (@id, 'general', 'note', '', 'text/plain', @size, @author, @body, NULL, NULL, NULL, 'rsvp', @source_id, @created_at)
    `),
};
