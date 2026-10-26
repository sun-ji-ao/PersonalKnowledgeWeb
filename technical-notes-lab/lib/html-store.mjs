import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256, writeArchive, readArchiveBytes, privateRoot } from './source-archive.mjs';

export class HtmlStoreError extends Error {
  constructor(code, message, status = 400, extra = {}) { super(message); Object.assign(this, { code, status }, extra); }
}
const error = (code, message, status, extra) => { throw new HtmlStoreError(code, message, status, extra); };
const json = JSON.stringify;
const decodeRevision = row => row ? { ...row, tags: JSON.parse(row.tags), source_metadata: JSON.parse(row.source_metadata), diagnostics: JSON.parse(row.diagnostics), headings: JSON.parse(row.headings), versions: JSON.parse(row.versions), publishable: !!row.publishable } : null;

// Explicit opt-in. Merely importing this module never creates or upgrades a database.
export function openHtmlStore(dbPath, { archiveDir = path.join(path.dirname(dbPath), 'source-archives'), failpoint, hooks = {} } = {}) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const archiveRoot = privateRoot(archiveDir);
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS html_notes (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL, draft_revision_id TEXT, published_revision_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, published_at TEXT
    );
    CREATE TABLE IF NOT EXISTS source_archives (
      id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, byte_length INTEGER NOT NULL, filename TEXT NOT NULL,
      source_kind TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_revisions (
      id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES html_notes(id), parent_revision_id TEXT,
      title TEXT NOT NULL, description TEXT NOT NULL, tags TEXT NOT NULL, source_metadata TEXT NOT NULL,
      html_source TEXT NOT NULL, html_rendered TEXT, source_hash TEXT NOT NULL,
      schema_version TEXT NOT NULL, versions TEXT NOT NULL, status TEXT NOT NULL, render_status TEXT NOT NULL,
      publishable INTEGER NOT NULL, diagnostics TEXT NOT NULL, headings TEXT NOT NULL,
      source_archive_id TEXT REFERENCES source_archives(id), origin TEXT NOT NULL, created_at TEXT NOT NULL,
      restored_from_revision_id TEXT REFERENCES content_revisions(id)
    );
    CREATE INDEX IF NOT EXISTS revision_note ON content_revisions(note_id,created_at);
    CREATE TABLE IF NOT EXISTS html_import_sources (
      source_key TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES html_notes(id),
      original_hash TEXT NOT NULL, imported_revision_id TEXT NOT NULL REFERENCES content_revisions(id)
    );
    CREATE TABLE IF NOT EXISTS html_legacy_migrations (legacy_id TEXT PRIMARY KEY, migrated_at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS content_revisions_immutable_update BEFORE UPDATE ON content_revisions BEGIN SELECT RAISE(ABORT,'Content revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS content_revisions_immutable_delete BEFORE DELETE ON content_revisions BEGIN SELECT RAISE(ABORT,'Content revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS source_archives_immutable_update BEFORE UPDATE ON source_archives BEGIN SELECT RAISE(ABORT,'Source archives are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS source_archives_immutable_delete BEFORE DELETE ON source_archives BEGIN SELECT RAISE(ABORT,'Source archives are immutable'); END;
  `);
  if (!db.prepare('PRAGMA table_info(content_revisions)').all().some(column => column.name === 'category')) db.exec("ALTER TABLE content_revisions ADD COLUMN category TEXT NOT NULL DEFAULT ''");
  function transaction(work) { db.exec('BEGIN IMMEDIATE'); try { const value = work(); failpoint?.('before-commit'); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  function row(id) { const value = db.prepare('SELECT * FROM html_notes WHERE id=?').get(id); if (!value) error('NOT_FOUND', 'Note not found', 404); return value; }
  function checkVersion(note, version) { if (!Number.isSafeInteger(version) || note.version !== version) error('VERSION_CONFLICT', 'Draft has changed; reload before saving', 409, { currentVersion: note.version }); }
  function insertRevision(note, input, origin, archiveId = undefined) {
    const result = input.result || input.convertedResult;
    if (!result || typeof result.htmlSource !== 'string' || !['ready', 'review_required'].includes(result.status) || result.schemaVersion !== 'notes-html/1' || !result.versions || result.sourceHash !== sha256(result.htmlSource)) error('INVALID_CONTENT', 'A valid converted HTML result with matching source hash is required');
    const previous = note.draft_revision_id ? decodeRevision(db.prepare('SELECT * FROM content_revisions WHERE id=?').get(note.draft_revision_id)) : null;
    const metadata = result.metadata || {};
    const title = input.title ?? metadata.title ?? previous?.title ?? '未命名笔记';
    const description = input.description ?? metadata.description ?? previous?.description ?? '';
    const tags = input.tags ?? metadata.tags ?? previous?.tags ?? [];
    const sourceCategory = metadata.sourceMetadata?.category ?? metadata.sourceMetadata?.categories;
    const category = input.category ?? metadata.category ?? (typeof sourceCategory === 'string' ? sourceCategory : Array.isArray(sourceCategory) && typeof sourceCategory[0] === 'string' ? sourceCategory[0] : undefined) ?? previous?.category ?? '';
    if (typeof category !== 'string' || [...category].length > 80) error('INVALID_METADATA', 'Category must be a string of at most 80 characters');
    if (typeof title !== 'string' || !title.trim() || [...title].length > 200 || typeof description !== 'string' || [...description].length > 500 || !Array.isArray(tags) || tags.length > 20 || tags.some(t => typeof t !== 'string' || [...t].length > 80)) error('INVALID_METADATA', 'Invalid title, description or tags');
    const diagnostics = result.diagnostics || [];
    const publishable = result.status === 'ready' && result.renderStatus === 'ready' && result.publishable === true && typeof result.htmlRendered === 'string' && !diagnostics.some(d => d.blocksPublishing);
    const id = randomUUID();
    db.prepare(`INSERT INTO content_revisions (id,note_id,parent_revision_id,title,description,tags,source_metadata,html_source,html_rendered,source_hash,schema_version,versions,status,render_status,publishable,diagnostics,headings,source_archive_id,origin,created_at,restored_from_revision_id,category) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, note.id, note.draft_revision_id || null, title.trim(), description, json(tags), json(input.sourceMetadata ?? metadata.sourceMetadata ?? previous?.source_metadata ?? {}),
      result.htmlSource, result.htmlRendered ?? null, result.sourceHash, result.schemaVersion, json(result.versions), result.status, result.renderStatus || 'pending', Number(publishable), json(diagnostics), json(result.headings || []), archiveId === undefined ? previous?.source_archive_id ?? null : archiveId, origin, new Date().toISOString(), input.restoredFromRevisionId || null, category.trim()
    );
    hooks.onRevision?.({ db, note, revision: decodeRevision(db.prepare('SELECT * FROM content_revisions WHERE id=?').get(id)) });
    return id;
  }
  function insertArchive(input) {
    const archived = writeArchive(archiveRoot, input.bytes, { failpoint });
    const id = randomUUID();
    return { id, ...archived, filename: String(input.filename || 'source.md').replace(/[\r\n\0]/g, '').slice(0, 255), source_kind: input.sourceKind || 'markdown-upload' };
  }
  function commitArchive(a) { db.prepare('INSERT INTO source_archives (id,sha256,byte_length,filename,source_kind,created_at) VALUES (?,?,?,?,?,?)').run(a.id, a.sha256, a.byte_length, a.filename, a.source_kind, new Date().toISOString()); }
  const store = {
    db, archiveDir: archiveRoot,
    get(id) {
      const note = db.prepare('SELECT * FROM html_notes WHERE id=?').get(id); if (!note) return null;
      const revision = decodeRevision(db.prepare('SELECT * FROM content_revisions WHERE id=?').get(note.draft_revision_id));
      return { ...revision, ...note, revision_id: revision?.id, published_version: note.published_revision_id, published: note.published_revision_id ? decodeRevision(db.prepare('SELECT * FROM content_revisions WHERE id=?').get(note.published_revision_id)) : null };
    },
    list() { return db.prepare('SELECT id FROM html_notes ORDER BY updated_at DESC').all().map(n => this.get(n.id)); },
    // Deliberate allowlist: never spread the private draft/revision object here.
    publicGet(id) {
      const r = db.prepare(`SELECT n.id,n.created_at,n.published_at,r.id AS revision_id,r.title,r.description,r.tags,r.headings,r.html_rendered,r.category
        FROM html_notes n JOIN content_revisions r ON r.id=n.published_revision_id AND r.note_id=n.id WHERE n.id=?`).get(id);
      return r ? { ...r, tags: JSON.parse(r.tags), headings: JSON.parse(r.headings) } : null;
    },
    publicList() { return db.prepare('SELECT id FROM html_notes WHERE published_revision_id IS NOT NULL ORDER BY published_at DESC,id').all().map(n => this.publicGet(n.id)).filter(Boolean); },
    create(input) { const id = input.id || randomUUID(), now = new Date().toISOString(); transaction(() => {
      db.prepare('INSERT INTO html_notes (id,version,draft_revision_id,published_revision_id,created_at,updated_at,published_at) VALUES (?,1,NULL,NULL,?,?,NULL)').run(id, now, now);
      const revisionId = insertRevision(row(id), input, 'online');
      db.prepare('UPDATE html_notes SET draft_revision_id=? WHERE id=?').run(revisionId, id);
    }); return this.get(id); },
    save(id, input) { transaction(() => { const note = row(id); checkVersion(note, input.version); const revisionId = insertRevision(note, input, 'online'); db.prepare('UPDATE html_notes SET draft_revision_id=?,version=version+1,updated_at=? WHERE id=?').run(revisionId, new Date().toISOString(), id); }); return this.get(id); },
    history(id) { row(id); return db.prepare('SELECT * FROM content_revisions WHERE note_id=? ORDER BY rowid DESC').all(id).map(decodeRevision); },
    getRevision(id, revisionId) { return decodeRevision(db.prepare('SELECT * FROM content_revisions WHERE note_id=? AND id=?').get(id, revisionId)); },
    restore(id, revisionId, version) { const revision = this.getRevision(id, revisionId); if (!revision) error('NOT_FOUND', 'Revision not found', 404);
      transaction(() => { const note = row(id); checkVersion(note, version); const restoredId = insertRevision(note, { title: revision.title, description: revision.description, tags: revision.tags, category: revision.category, sourceMetadata: revision.source_metadata, restoredFromRevisionId: revision.id, result: { htmlSource: revision.html_source, htmlRendered: revision.html_rendered, sourceHash: revision.source_hash, schemaVersion: revision.schema_version, versions: revision.versions, status: revision.status, renderStatus: revision.render_status, publishable: revision.publishable, diagnostics: revision.diagnostics, headings: revision.headings } }, 'restore', revision.source_archive_id);
        db.prepare('UPDATE html_notes SET draft_revision_id=?,version=version+1,updated_at=? WHERE id=?').run(restoredId, new Date().toISOString(), id);
      }); return this.get(id); },
    importSource(input) {
      if (typeof input.sourceKey !== 'string' || !input.sourceKey || input.sourceKey.length > 1000) error('INVALID_SOURCE', 'A bounded sourceKey is required');
      if (!(input.bytes instanceof Uint8Array) || input.bytes.length > 1_900_000) error('INVALID_SOURCE', 'Source must be bounded original bytes');
      const originalHash = sha256(input.bytes);
      const conversion = input.result || input.convertedResult;
      if (conversion?.originalHash && conversion.originalHash !== originalHash) error('INVALID_SOURCE', 'Converted source and original archive hashes do not match');
      const current = db.prepare('SELECT * FROM html_import_sources WHERE source_key=?').get(input.sourceKey);
      if (current?.original_hash === originalHash) return { note: this.get(current.note_id), unchanged: true, archive: null };
      const archive = insertArchive(input); let id, unchanged = false;
      transaction(() => {
        const source = db.prepare('SELECT * FROM html_import_sources WHERE source_key=?').get(input.sourceKey);
        if (source?.original_hash === originalHash) { id = source.note_id; unchanged = true; return; }
        if (source && row(source.note_id).draft_revision_id !== source.imported_revision_id) error('SOURCE_CONFLICT', 'Source has online edits; importing cannot overwrite them', 409, { currentVersion: row(source.note_id).version });
        id = source?.note_id || input.id || randomUUID(); const now = new Date().toISOString();
        if (!source) db.prepare('INSERT INTO html_notes (id,version,draft_revision_id,published_revision_id,created_at,updated_at,published_at) VALUES (?,0,NULL,NULL,?,?,NULL)').run(id, now, now);
        commitArchive(archive);
        const revisionId = insertRevision(row(id), input, 'import', archive.id);
        db.prepare('UPDATE html_notes SET draft_revision_id=?,version=version+1,updated_at=? WHERE id=?').run(revisionId, now, id);
        db.prepare('INSERT INTO html_import_sources (source_key,note_id,original_hash,imported_revision_id) VALUES (?,?,?,?) ON CONFLICT(source_key) DO UPDATE SET original_hash=excluded.original_hash, imported_revision_id=excluded.imported_revision_id').run(input.sourceKey, id, originalHash, revisionId);
      }); return { note: this.get(id), unchanged, archive: unchanged ? null : archive };
    },
    readArchive(id) { const archive = db.prepare('SELECT * FROM source_archives WHERE id=?').get(id); if (!archive) error('NOT_FOUND', 'Archive not found', 404); return { ...archive, bytes: readArchiveBytes(archiveRoot, archive.sha256) }; },
    publish(id, version, expected = {}) { transaction(() => {
      const note = row(id); checkVersion(note, version); const revision = this.getRevision(id, note.draft_revision_id);
      if ((expected.revisionId !== undefined && expected.revisionId !== revision?.id) || (expected.sourceHash !== undefined && expected.sourceHash !== revision?.source_hash)) error('REVISION_CONFLICT', 'The intended revision has changed', 409);
      if (!revision || !revision.publishable || revision.status !== 'ready' || revision.render_status !== 'ready' || typeof revision.html_rendered !== 'string' || revision.diagnostics.some(d => d.blocksPublishing) || revision.source_hash !== sha256(revision.html_source)) error('NOT_PUBLISHABLE', 'This revision has not passed source and display checks', 422);
      hooks.beforePublish?.({ db, note, revision });
      db.prepare('UPDATE html_notes SET published_revision_id=draft_revision_id,published_at=?,version=version+1 WHERE id=?').run(new Date().toISOString(), id);
      hooks.onPublishedChange?.({ db, note: row(id), revision });
    }); return this.get(id); },
    unpublish(id, version) { transaction(() => { const note = row(id); checkVersion(note, version); db.prepare('UPDATE html_notes SET published_revision_id=NULL,published_at=NULL,version=version+1 WHERE id=?').run(id); hooks.onPublishedChange?.({ db, note: row(id), revision: null }); }); return this.get(id); },
    // Used only by explicit legacy migration after independently converting each snapshot.
    migrateLegacy(input) { if (db.prepare('SELECT 1 FROM html_legacy_migrations WHERE legacy_id=?').get(input.id)) return { note: this.get(input.id), unchanged: true };
      const draftArchive = insertArchive(input.draft), publishedArchive = input.published ? insertArchive(input.published) : null;
      transaction(() => {
        const now = new Date().toISOString(); db.prepare('INSERT INTO html_notes (id,version,draft_revision_id,published_revision_id,created_at,updated_at,published_at) VALUES (?,1,NULL,NULL,?,?,NULL)').run(input.id, input.createdAt || now, now);
        commitArchive(draftArchive); const draftId = insertRevision(row(input.id), input.draft, 'legacy-draft', draftArchive.id);
        let publishedId = null;
        if (input.published) { commitArchive(publishedArchive); publishedId = insertRevision(row(input.id), input.published, 'legacy-published', publishedArchive.id); const pub = this.getRevision(input.id, publishedId); if (!pub.publishable) error('NOT_PUBLISHABLE', 'Legacy published snapshot did not pass conversion', 422); hooks.beforePublish?.({ db, note: row(input.id), revision: pub }); }
        db.prepare('UPDATE html_notes SET draft_revision_id=?,published_revision_id=?,published_at=? WHERE id=?').run(draftId, publishedId, publishedId ? input.publishedAt : null, input.id);
        hooks.onPublishedChange?.({ db, note: row(input.id), revision: publishedId ? this.getRevision(input.id, publishedId) : null });
        db.prepare('INSERT INTO html_legacy_migrations (legacy_id,migrated_at) VALUES (?,?)').run(input.id, now);
      }); return { note: this.get(input.id), unchanged: false };
    },
    close() { db.close(); },
  };
  return store;
}
