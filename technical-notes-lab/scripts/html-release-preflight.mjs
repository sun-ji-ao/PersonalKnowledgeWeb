import { DatabaseSync } from 'node:sqlite';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { assertIsolatedDestination } from '../lib/html-migration.mjs';
import { openHtmlStore } from '../lib/html-store.mjs';

const [dbArg, expectedArg, mode] = process.argv.slice(2);
if (!dbArg || !/^\d+$/.test(expectedArg || '') || (mode && mode !== '--publish-legacy')) throw new Error('Usage: node scripts/html-release-preflight.mjs DB EXPECTED_LEGACY_COUNT [--publish-legacy]');
const dbPath = realpathSync(path.resolve(dbArg));
assertIsolatedDestination(path.join(path.dirname(dbPath), '.release-guard-new'));
const expected = Number(expectedArg);
const db = new DatabaseSync(dbPath, { readOnly: true });
let ids;
try {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
  const has = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!has('legacy_urls') || !has('legacy_anchor_maps')) throw new Error('Old URL and anchor maps must be installed before cutover');
  ids = db.prepare('SELECT note_id FROM legacy_urls ORDER BY url').all().map(row => row.note_id);
  if (ids.length !== expected || new Set(ids).size !== ids.length) throw new Error(`Expected ${expected} unique legacy URLs, found ${ids.length}`);
  const anchors = db.prepare('SELECT COUNT(*) AS n FROM legacy_anchor_maps').get().n;
  if (!anchors) throw new Error('Old anchor map is empty');
  const blocked = db.prepare(`SELECT n.id FROM legacy_urls l JOIN html_notes n ON n.id=l.note_id JOIN content_revisions r ON r.id=n.draft_revision_id
    WHERE r.status!='ready' OR r.render_status!='ready' OR r.publishable!=1 OR r.html_rendered IS NULL`).all();
  if (blocked.length) throw new Error(`${blocked.length} legacy drafts are not ready for publication`);
  const published = db.prepare('SELECT COUNT(*) AS n FROM html_notes WHERE published_revision_id IS NOT NULL').get().n;
  if (mode && published) throw new Error('Bulk publication requires an unpublished staging database');
  console.log(JSON.stringify({ stage: 'preflight', dbPath, legacyUrls: ids.length, legacyAnchors: anchors, published, ready: ids.length, apply: !!mode }));
} finally { db.close(); }

if (mode === '--publish-legacy') {
  const store = openHtmlStore(dbPath);
  try {
    let count = 0;
    for (const id of ids) {
      const note = store.get(id);
      store.publish(id, note.version, { revisionId: note.revision_id, sourceHash: note.source_hash });
      count++;
    }
    if (store.publicList().length !== expected) throw new Error('Public count does not match the planned cutover');
    console.log(JSON.stringify({ stage: 'published', count }));
  } finally { store.close(); }
}
