import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const app = path.join(root, 'technical-notes-lab');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const report = JSON.parse(fs.readFileSync(path.join(here, 'migration-library-final.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'migration-catalog-final.json'), 'utf8'));
const db = new DatabaseSync(path.join(app, '.test-data/batch-07-library-final/notes.sqlite'), {readOnly:true});
const checks = [];
try {
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(report.items.length, 253);
  for (const item of report.items) {
    const row = db.prepare('SELECT n.id,n.published_revision_id,r.html_source,r.source_hash,r.title,r.category,r.tags,r.source_metadata,a.sha256,a.byte_length FROM html_notes n JOIN content_revisions r ON r.id=n.draft_revision_id JOIN source_archives a ON a.id=r.source_archive_id WHERE n.id=?').get(item.noteId);
    assert.ok(row, item.path);
    assert.match(row.id, /^[a-f0-9-]+$/);
    assert.equal(row.published_revision_id, null);
    const original = fs.readFileSync(path.join(report.sourceRoot, item.path));
    const archive = fs.readFileSync(path.join(report.destination, 'source-archives', `${row.sha256}.bin`));
    assert.deepEqual(archive, original);
    assert.equal(row.byte_length, original.length);
    assert.equal(row.sha256, hash(original));
    assert.equal(row.sha256, item.originalHash);
    assert.equal(row.source_hash, hash(row.html_source));
    const metadata = catalog.entries[item.path].metadata;
    assert.equal(row.title, metadata.title);
    assert.equal(row.category, metadata.category);
    assert.deepEqual(JSON.parse(row.tags), metadata.tags);
    assert.deepEqual(JSON.parse(row.source_metadata).legacySite, metadata);
    const url = db.prepare('SELECT url FROM legacy_urls WHERE note_id=?').get(row.id);
    assert.equal(url.url, catalog.entries[item.path].oldUrl);
    checks.push({path:item.path, id:row.id, archiveVerified:true, sourceHashVerified:true, metadataVerified:true, legacyUrlVerified:true});
  }
} finally {db.close();}
const live = new DatabaseSync(path.join(app, 'data/notes.sqlite'), {readOnly:true});
const migrated = new DatabaseSync(path.join(app, '.test-data/batch-07-mvp/notes.sqlite'), {readOnly:true});
let mvp;
try {
  const originalRows = live.prepare('SELECT * FROM notes ORDER BY id').all();
  const copiedRows = migrated.prepare('SELECT * FROM notes ORDER BY id').all();
  assert.deepEqual(copiedRows, originalRows);
  mvp = {legacyRows:originalRows.length, legacyFieldsEqual:true, htmlNotes:migrated.prepare('SELECT count(*) AS n FROM html_notes').get().n,
    revisions:migrated.prepare('SELECT count(*) AS n FROM content_revisions').get().n};
} finally {live.close(); migrated.close();}
const result = {checkedAt:new Date().toISOString(), mode:'read-only-independent-verification', sourceFiles:checks.length, publishedLibraryNotes:0, checks, mvp};
fs.writeFileSync(path.join(here, 'independent-migration-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({sourceFiles:checks.length, verifiedArchives:checks.length, verifiedMetadata:checks.length, verifiedLegacyUrls:checks.length, publishedLibraryNotes:0, mvp}, null, 2));
