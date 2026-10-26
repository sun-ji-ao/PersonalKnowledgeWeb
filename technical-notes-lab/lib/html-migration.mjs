import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { backupDatabase } from './html-backup.mjs';
import { openHtmlStore } from './html-store.mjs';
import { convertMarkdown, renderHtml } from './html-content.mjs';

const liveRoot = path.resolve(fileURLToPath(new URL('../data', import.meta.url)));
export function assertIsolatedDestination(destination) {
  const target = path.resolve(destination);
  const comparable = process.platform === 'win32' ? target.toLowerCase() : target;
  const protectedRoot = process.platform === 'win32' ? liveRoot.toLowerCase() : liveRoot;
  if (comparable === protectedRoot || comparable.startsWith(protectedRoot + path.sep)) throw new Error('Writing the default data directory is forbidden by this migration tool');
  if (existsSync(target)) throw new Error('Migration destination must not exist');
  return target;
}
export async function migrateLegacyDatabase({ sourceDbPath, destination, context = {} }) {
  const target = assertIsolatedDestination(destination), dbPath = path.join(target, 'notes.sqlite');
  await backupDatabase(sourceDbPath, dbPath);
  const snapshot = new DatabaseSync(dbPath, { readOnly: true });
  let rows;
  try { rows = snapshot.prepare('SELECT * FROM notes ORDER BY id').all(); } finally { snapshot.close(); }
  const store = openHtmlStore(dbPath), report = { format: 'notes-legacy-migration/1', sourceDbPath: path.resolve(sourceDbPath), destination: target, items: [] };
  try {
    for (const row of rows) {
      const convert = async (published) => {
        const prefix = published ? 'published_' : '', bytes = Buffer.from(row[`${prefix}markdown`], 'utf8');
        const result = await renderHtml(await convertMarkdown(bytes, { ...context, filename: `${row.id}-${published ? 'published' : 'draft'}.md` }));
        return { bytes, result, filename: `${row.id}-${published ? 'published' : 'draft'}.md`, sourceKind: 'mvp-database-text', title: row[`${prefix}title`], description: row[`${prefix}description`] || '', tags: JSON.parse(row[`${prefix}tags`] || '[]'), sourceMetadata: { ...(published ? { publishedSourceMetadataUnavailable: true } : JSON.parse(row.source_metadata || '{}')), archiveProvenance: 'UTF-8 encoding of legacy SQLite text; original upload bytes unavailable', legacyId: row.id, legacyVersion: published ? row.published_version : row.version } };
      };
      try {
        const draft = await convert(false), published = row.published_at && row.published_markdown != null ? await convert(true) : null;
        const migrated = store.migrateLegacy({ id: row.id, draft, published, createdAt: row.created_at, publishedAt: row.published_at });
        report.items.push({ id: row.id, status: 'migrated', draftRevisionId: migrated.note.draft_revision_id, publishedRevisionId: migrated.note.published_revision_id });
      } catch (e) { report.items.push({ id: row.id, status: 'legacy-fallback', code: e.code || 'MIGRATION_FAILED', message: e.message }); }
    }
    // Keeps every legacy field unchanged. New writes and revisions are preserved in the full target database and joint backups.
    report.migrated = report.items.filter(i => i.status === 'migrated').length;
    report.fallback = report.items.length - report.migrated;
    writeFileSync(path.join(target, 'migration-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    return report;
  } finally { store.close(); }
}
export function exportHtmlRollback(store, destination) {
  if (existsSync(destination)) throw new Error('Rollback export must not overwrite an existing file');
  const notes = store.list().map(note => ({ note, revisions: store.history(note.id) }));
  writeFileSync(destination, JSON.stringify({ format: 'notes-html-rollback/1', createdAt: new Date().toISOString(), notes }, null, 2), { flag: 'wx', mode: 0o600 });
  return { destination, notes: notes.length };
}
