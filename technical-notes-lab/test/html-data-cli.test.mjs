import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openHtmlStore } from '../lib/html-store.mjs';
import { openStore } from '../lib/store.mjs';
import { convertMarkdown, normalizeHtml } from '../lib/html-content.mjs';

const run = promisify(execFile);
const application = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = async (...args) => JSON.parse((await run(process.execPath, ['scripts/html-data.mjs', ...args], { cwd: application, windowsHide: true })).stdout);

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'notes-html-cli-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('notes-html-cli-'));
    await rm(resolved, { recursive: true, force: true });
  });
  return root;
}

test('HTML data CLI: mixed editor directory rejects ambiguous backup and explicit backup restores actual HTML revisions and bytes', async t => {
  const root = await fixture(t), dataDir = path.join(root, 'editor-data');
  const legacy = openStore(path.join(dataDir, 'notes.sqlite')); legacy.close();
  const dbPath = path.join(dataDir, 'html-notes.sqlite'), archiveDir = path.join(dataDir, 'html-archives');
  const store = openHtmlStore(dbPath, { archiveDir });
  const bytes = Buffer.from('\uFEFF# CLI original\r\n\r\nOriginal bytes\r\n');
  let saved;
  try {
    const { note } = store.importSource({ bytes, sourceKey: 'cli-original', filename: 'original.md', result: await convertMarkdown(bytes) });
    saved = store.save(note.id, { version: note.version, title: 'Edited via HTML', result: await normalizeHtml('<p>Private edited HTML</p>') });
  } finally { store.close(); }
  const ambiguous = path.join(root, 'ambiguous-backup');
  await assert.rejects(cli('backup', dataDir, ambiguous), error => error.code === 1 && /Ambiguous data directory/.test(error.stderr));
  await assert.rejects(access(ambiguous));
  await assert.rejects(cli('backup', dataDir, path.join(root, 'incomplete-flags'), '--db', dbPath), error => error.code === 1 && /both --db/.test(error.stderr));
  const backupDir = path.join(root, 'explicit-backup');
  const backup = await cli('backup', dataDir, backupDir, '--db', dbPath, '--archives', archiveDir);
  assert.equal(backup.source.dbPath, dbPath); assert.equal(backup.source.archiveDir, archiveDir);
  const restoredPaths = await cli('restore', backupDir, path.join(root, 'restored'));
  const inspection = await cli('inspect', restoredPaths.dbPath);
  assert.equal(inspection.htmlNotes, 1); assert.equal(inspection.legacyNotes, 0);
  const restored = openHtmlStore(restoredPaths.dbPath, { archiveDir: restoredPaths.archiveDir });
  try {
    const note = restored.get(saved.id);
    assert.equal(note.html_source, '<p>Private edited HTML</p>'); assert.equal(note.version, 2);
    assert.equal(restored.history(saved.id).length, 2);
    assert.deepEqual(restored.readArchive(note.source_archive_id).bytes, bytes);
  } finally { restored.close(); }
});

test('HTML data CLI: a single standard HTML or legacy database is detected without guessing', async t => {
  const root = await fixture(t), htmlDir = path.join(root, 'html-only');
  const html = openHtmlStore(path.join(htmlDir, 'html-notes.sqlite'), { archiveDir: path.join(htmlDir, 'html-archives') });
  try { html.create({ result: await normalizeHtml('<p>Only HTML database</p>') }); } finally { html.close(); }
  const htmlBackup = await cli('backup', htmlDir, path.join(root, 'html-backup'));
  assert.equal(htmlBackup.source.dbPath, path.join(htmlDir, 'html-notes.sqlite'));
  assert.equal((await cli('inspect', path.join(htmlBackup.directory, 'notes.sqlite'))).htmlNotes, 1);
  const legacyDir = path.join(root, 'legacy-only'), legacy = openStore(path.join(legacyDir, 'notes.sqlite'));
  try { legacy.create({ title: 'Legacy fixture', markdown: 'legacy body' }); } finally { legacy.close(); }
  const legacyBackup = await cli('backup', legacyDir, path.join(root, 'legacy-backup'));
  assert.equal(legacyBackup.source.dbPath, path.join(legacyDir, 'notes.sqlite'));
  assert.equal((await cli('inspect', path.join(legacyBackup.directory, 'notes.sqlite'))).legacyNotes, 1);
});
