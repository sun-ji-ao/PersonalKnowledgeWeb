import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]', markdown TEXT NOT NULL, source_metadata TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      published_title TEXT, published_description TEXT, published_tags TEXT, published_markdown TEXT,
      published_at TEXT, published_version INTEGER
    );`);
  const decode = row => row ? { ...row, tags: JSON.parse(row.tags), source_metadata: JSON.parse(row.source_metadata), published_tags: row.published_tags ? JSON.parse(row.published_tags) : [] } : null;
  return {
    db,
    get: id => decode(db.prepare('SELECT * FROM notes WHERE id = ?').get(id)),
    list: () => db.prepare('SELECT id,title,description,tags,version,created_at,updated_at,published_at,published_version FROM notes ORDER BY updated_at DESC').all().map(row => ({ ...row, tags: JSON.parse(row.tags) })),
    publicList: () => db.prepare('SELECT id,published_title AS title,published_description AS description,published_tags AS tags,published_at FROM notes WHERE published_at IS NOT NULL ORDER BY published_at DESC').all().map(row => ({ ...row, tags: JSON.parse(row.tags) })),
    create(input) {
      const id = randomUUID(), now = new Date().toISOString();
      db.prepare('INSERT INTO notes (id,title,description,tags,markdown,source_metadata,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, input.title || '未命名笔记', input.description || '', JSON.stringify(input.tags || []), input.markdown || '', JSON.stringify(input.sourceMetadata || {}), now, now);
      return this.get(id);
    },
    save(id, input) {
      const result = db.prepare('UPDATE notes SET title=?,description=?,tags=?,markdown=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(input.title, input.description, JSON.stringify(input.tags), input.markdown, new Date().toISOString(), id, input.version);
      return result.changes ? this.get(id) : null;
    },
    publish(id, version) {
      const result = db.prepare(`UPDATE notes SET published_title=title,published_description=description,published_tags=tags,published_markdown=markdown,published_at=?,published_version=version WHERE id=? AND version=?`).run(new Date().toISOString(), id, version);
      return result.changes ? this.get(id) : null;
    },
    unpublish(id) { db.prepare('UPDATE notes SET published_at=NULL,published_version=NULL,published_markdown=NULL,published_title=NULL,published_description=NULL,published_tags=NULL WHERE id=?').run(id); return this.get(id); },
    close() { db.close(); },
  };
}
