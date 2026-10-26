import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openHtmlStore } from '../lib/html-store.mjs';
import { openStore } from '../lib/store.mjs';
import { convertMarkdown, normalizeHtml, renderHtml } from '../lib/html-content.mjs';
import { sha256 } from '../lib/source-archive.mjs';
import { inspectDatabase, createJointBackup, restoreJointBackup } from '../lib/html-backup.mjs';
import { migrateLegacyDatabase, exportHtmlRollback, assertIsolatedDestination } from '../lib/html-migration.mjs';

function fixture(t, options = {}) { const root = mkdtempSync(path.join(os.tmpdir(), 'notes-html-store-')); const store = openHtmlStore(path.join(root, 'notes.sqlite'), options); t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); }); return { root, store }; }
const converted = async text => renderHtml(await convertMarkdown(Buffer.from(text), { filename: 'test.md' }));

test('HTML immutable revisions, metadata snapshots, CAS, restore and failed display isolation', async t => {
  const { store } = fixture(t), result = await converted('# Original\n\nhello');
  let note = store.create({ result, title: 'Published', tags: ['old'] }); const first = note.draft_revision_id;
  note = store.publish(note.id, note.version);
  const updated = await normalizeHtml('<p>Private new draft</p>');
  note = store.save(note.id, { version: note.version, result: { ...updated, renderStatus: 'failed', publishable: false }, title: 'Draft', tags: ['new'] });
  assert.equal(note.published.title, 'Published'); assert.deepEqual(note.published.tags, ['old']); assert.match(note.published.html_source, /hello/);
  assert.equal(note.title, 'Draft'); assert.equal(note.render_status, 'failed');
  assert.throws(() => store.publish(note.id, note.version), e => e.code === 'NOT_PUBLISHABLE');
  assert.throws(() => store.save(note.id, { version: 1, result }), e => e.code === 'VERSION_CONFLICT' && e.currentVersion === 3);
  assert.throws(() => store.db.prepare('UPDATE content_revisions SET title=? WHERE id=?').run('tamper', first), /immutable/);
  assert.throws(() => store.db.prepare('DELETE FROM content_revisions WHERE id=?').run(first), /immutable/);
  note = store.restore(note.id, first, note.version);
  assert.equal(note.version, 4); assert.equal(note.origin, 'restore'); assert.equal(note.restored_from_revision_id, first); assert.notEqual(note.draft_revision_id, first); assert.equal(note.published_revision_id, first); assert.equal(store.history(note.id).length, 3);
});

test('original bytes, source identity, idempotency and online edit conflict', async t => {
  const { store } = fixture(t), bytes = Buffer.from('\ufeff# Source\r\n\r\nold\r\n');
  const result = await renderHtml(await convertMarkdown(bytes));
  const first = store.importSource({ bytes, sourceKey: 'legacy/a.md', filename: '../original.md', result });
  assert.deepEqual(store.readArchive(first.archive.id).bytes, bytes);
  assert.equal(first.archive.sha256, sha256(bytes)); assert.equal(first.note.source_archive_id, first.archive.id);
  assert.equal(store.importSource({ bytes, sourceKey: 'legacy/a.md', result }).unchanged, true); assert.equal(store.list().length, 1); assert.equal(store.history(first.note.id).length, 1);
  const edited = store.save(first.note.id, { version: 1, result: await normalizeHtml('<p>online only</p>') });
  assert.equal(store.importSource({ bytes, sourceKey: 'legacy/a.md', result }).note.html_source, edited.html_source);
  const changed = Buffer.from('# Source\n\nchanged');
  assert.throws(() => store.importSource({ bytes: changed, sourceKey: 'legacy/a.md', result }), e => e.code === 'INVALID_SOURCE');
  const changedResult = await renderHtml(await convertMarkdown(changed));
  assert.throws(() => store.importSource({ bytes: changed, sourceKey: 'legacy/a.md', result: changedResult }), e => e.code === 'SOURCE_CONFLICT');
  assert.equal(store.get(first.note.id).html_source, edited.html_source); assert.equal(store.history(first.note.id).length, 2);
  assert.throws(() => store.readArchive('../original.md'), e => e.code === 'NOT_FOUND');
});

test('source update and history restore point at matching original archives', async t => {
  const { store } = fixture(t), bytes = Buffer.from('version one'), next = Buffer.from('version two');
  const a = store.importSource({ id: 'planned-note-id', sourceKey: 'file', bytes, result: await converted('version one') });
  assert.equal(a.note.id, 'planned-note-id');
  assert.throws(() => store.importSource({ id: a.note.id, sourceKey: 'different-file', bytes, result: a.note }), /UNIQUE/);
  assert.equal(store.list().length, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM html_import_sources').get().n, 1);
  const b = store.importSource({ id: 'ignored-on-reimport', sourceKey: 'file', bytes: next, result: await converted('version two') });
  assert.equal(a.note.id, b.note.id); assert.equal(b.note.version, 2); assert.notEqual(a.archive.id, b.archive.id);
  const restored = store.restore(a.note.id, a.note.draft_revision_id, b.note.version);
  assert.equal(restored.source_archive_id, a.archive.id); assert.deepEqual(store.readArchive(restored.source_archive_id).bytes, bytes);
});

test('archive and transaction failures do not publish incomplete references or lose existing drafts', async t => {
  let fault = null; const { root, store } = fixture(t, { failpoint: point => { if (point === fault) throw new Error(`injected:${point}`); } });
  const result = await converted('content'), bytes = Buffer.from('content');
  fault = 'archive-before-rename'; assert.throws(() => store.importSource({ sourceKey: 'file', bytes, result }), /injected/);
  assert.equal(store.list().length, 0); assert.equal(readdirSync(path.join(root, 'source-archives')).length, 0);
  fault = 'archive-after-rename'; assert.throws(() => store.importSource({ sourceKey: 'file', bytes, result }), /injected/);
  assert.equal(store.list().length, 0); assert.equal(readdirSync(path.join(root, 'source-archives')).length, 1);
  fault = 'before-commit'; assert.throws(() => store.importSource({ sourceKey: 'file', bytes, result }), /injected/);
  assert.equal(store.list().length, 0); assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM source_archives').get().n, 0);
  fault = null; const imported = store.importSource({ sourceKey: 'file', bytes, result });
  fault = 'before-commit'; assert.throws(() => store.save(imported.note.id, { version: 1, result, title: 'should rollback' }), /injected/);
  assert.equal(store.get(imported.note.id).title, imported.note.title); assert.equal(store.history(imported.note.id).length, 1);
});

test('joint backup restores database, original bytes, media and preserves rollback exports', async t => {
  const { root, store } = fixture(t), bytes = Buffer.from('\ufeff# private\r\n');
  const note = store.importSource({ sourceKey: 'private', bytes, result: await renderHtml(await convertMarkdown(bytes)) }).note;
  const published = store.publish(note.id, note.version);
  const mediaDir = path.join(root, 'media'); mkdirSync(mediaDir); writeFileSync(path.join(mediaDir, 'image.bin'), Buffer.from([0, 255, 11]));
  const destination = path.join(root, 'backup'); await createJointBackup({ dbPath: path.join(root, 'notes.sqlite'), archiveDir: store.archiveDir, mediaDir, destination });
  store.save(note.id, { version: published.version, result: await normalizeHtml('<p>after snapshot</p>') });
  const restoredPaths = restoreJointBackup({ backupDir: destination, destination: path.join(root, 'restored') });
  const restored = openHtmlStore(restoredPaths.dbPath, { archiveDir: restoredPaths.archiveDir });
  try { const recovered = restored.get(note.id); assert.equal(recovered.version, published.version); assert.equal(recovered.published_revision_id, note.draft_revision_id); assert.deepEqual(restored.readArchive(recovered.source_archive_id).bytes, bytes); } finally { restored.close(); }
  assert.deepEqual(readFileSync(path.join(restoredPaths.directory, 'media', 'image.bin')), Buffer.from([0, 255, 11]));
  exportHtmlRollback(store, path.join(root, 'rollback.json')); const exported = JSON.parse(readFileSync(path.join(root, 'rollback.json'), 'utf8')); assert.equal(exported.notes[0].note.version, published.version + 1); assert.equal(exported.notes[0].revisions.length, 2);
  assert.throws(() => restoreJointBackup({ backupDir: destination, destination: restoredPaths.directory }), /must not exist/);
  writeFileSync(path.join(destination, 'source-archives', `${sha256(bytes)}.bin`), 'corrupt');
  assert.throws(() => restoreJointBackup({ backupDir: destination, destination: path.join(root, 'bad-restore') }), /checksum mismatch/); assert.equal(existsSync(path.join(root, 'bad-restore')), false);
});

test('migration separately converts legacy draft/public metadata, preserves source DB and failed fallback', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'notes-migration-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDbPath = path.join(root, 'legacy.sqlite'), legacy = openStore(sourceDbPath);
  let original = legacy.create({ title: 'Public title', description: 'Public description', tags: ['public'], markdown: '# public body', sourceMetadata: { draftOnlySecret: 'private metadata' } }); legacy.publish(original.id, original.version);
  legacy.save(original.id, { version: 1, title: 'Draft title', description: 'Draft description', tags: ['private'], markdown: '# private body' });
  const invalid = legacy.create({ title: 'fallback', markdown: '![missing](missing.png)' }); legacy.publish(invalid.id, invalid.version);
  const before = legacy.get(original.id), destination = path.join(root, 'migrated');
  const report = await migrateLegacyDatabase({ sourceDbPath, destination });
  assert.equal(report.migrated, 1); assert.equal(report.fallback, 1); assert.deepEqual(legacy.get(original.id), before);
  const migrated = openHtmlStore(path.join(destination, 'notes.sqlite'));
  try { const note = migrated.get(original.id); assert.equal(note.title, 'Draft title'); assert.deepEqual(note.tags, ['private']); assert.match(note.html_source, /private body/); assert.equal(note.published.title, 'Public title'); assert.deepEqual(note.published.tags, ['public']); assert.match(note.published.html_source, /public body/); assert.equal(note.published.source_metadata.draftOnlySecret, undefined); assert.equal(note.published.source_metadata.publishedSourceMetadataUnavailable, true); assert.notEqual(note.draft_revision_id, note.published_revision_id); assert.equal(migrated.get(invalid.id), null); assert.equal(migrated.db.prepare('SELECT markdown FROM notes WHERE id=?').get(original.id).markdown, '# private body'); assert.match(note.source_metadata.archiveProvenance, /original upload bytes unavailable/); } finally { migrated.close(); }
  assert.equal(inspectDatabase(sourceDbPath).htmlNotes, 0); legacy.close();
});

test('Unicode metadata, invalid content hash and default data path boundaries', async t => {
  const { store } = fixture(t), result = await normalizeHtml('<p>valid</p>');
  const title = '😀'.repeat(200), description = '😀'.repeat(500);
  assert.equal(store.create({ result, title, description }).title, title);
  assert.throws(() => store.create({ result, title: title + 'x' }), e => e.code === 'INVALID_METADATA');
  assert.throws(() => store.create({ result: { ...result, sourceHash: '0'.repeat(64) } }), e => e.code === 'INVALID_CONTENT');
  assert.equal(store.list().length, 1);
  const forbidden = path.resolve('data', 'new-migration');
  assert.throws(() => assertIsolatedDestination(forbidden), /default data/);
  if (process.platform === 'win32') assert.throws(() => assertIsolatedDestination(forbidden.toUpperCase()), /default data/);
});

test('joint backup rejects unsafe/missing archive manifests and junction archive roots', async t => {
  const { root, store } = fixture(t), bytes = Buffer.from('archived');
  store.importSource({ sourceKey: 'file', bytes, result: await converted('archived') });
  const destination = path.join(root, 'backup'); await createJointBackup({ dbPath: path.join(root, 'notes.sqlite'), archiveDir: store.archiveDir, destination });
  const manifestPath = path.join(destination, 'manifest.json'), original = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, JSON.stringify({ ...original, files: original.files.filter(f => f.path === 'notes.sqlite') }));
  assert.throws(() => restoreJointBackup({ backupDir: destination, destination: path.join(root, 'missing') }), /missing a referenced archive/);
  writeFileSync(manifestPath, JSON.stringify({ ...original, files: [...original.files, { path: '../escape', sha256: '0'.repeat(64), size: 0 }] }));
  assert.throws(() => restoreJointBackup({ backupDir: destination, destination: path.join(root, 'unsafe') }), /Unsafe backup/);
  const link = path.join(root, 'linked'); symlinkSync(store.archiveDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => openHtmlStore(path.join(root, 'other.sqlite'), { archiveDir: link }), /symbolic links/);
});
