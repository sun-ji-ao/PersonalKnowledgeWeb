import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const digest = data => createHash('sha256').update(data).digest('hex');
const protectedFiles = JSON.parse(readFileSync(path.join(here, '../batch-01/protected-manifest.json')));
const changed = protectedFiles.filter(f => digest(readFileSync(path.join(root, f.path))) !== f.sha256);
assert.equal(changed.length, 0, 'Original Markdown changed');

const uiRoot = path.join(root, 'technical-notes-lab/.test-data/batch04-browser');
const db = new DatabaseSync(path.join(uiRoot, 'html-notes.sqlite'), { readOnly: true });
let browserData;
try {
  const revisions = db.prepare('SELECT * FROM content_revisions ORDER BY rowid').all();
  const notes = db.prepare('SELECT * FROM html_notes').all();
  const sample = revisions.find(r => r.title === '第 4 批浏览器往返验收');
  assert.ok(sample);
  const sampleNote = notes.find(n => n.id === sample.note_id);
  const sampleHistory = revisions.filter(r => r.note_id === sample.note_id);
  const latest = revisions.find(r => r.id === sampleNote.draft_revision_id);
  assert.ok(sampleHistory.some(r => r.origin === 'restore' && r.restored_from_revision_id === sample.id));
  assert.ok(sampleHistory.some(r => r.render_status === 'failed' && r.publishable === 0 && r.html_source.includes('A[未闭合')));
  assert.equal(latest.description, '页面 A 已保存内容');
  assert.ok(!revisions.some(r => r.description === '页面 B 本地冲突内容必须保留'));
  const archive = db.prepare('SELECT * FROM source_archives WHERE id=?').get(sample.source_archive_id);
  const bytes = readFileSync(path.join(uiRoot, 'html-archives', `${archive.sha256}.bin`));
  assert.deepEqual(bytes, readFileSync(path.join(here, 'browser-fixtures/writing-roundtrip.md')));
  const longNote = revisions.find(r => r.title === '第 4 批合成长文验收');
  const longLatest = revisions.find(r => r.id === notes.find(n => n.id === longNote.note_id).draft_revision_id);
  assert.equal((longLatest.html_source.match(/<h2 /g) || []).length, 80);
  assert.equal((longLatest.html_source.match(/<pre>/g) || []).length, 80);
  assert.ok(longLatest.html_source.includes('长文编辑核验。'));
  const online = revisions.filter(r => r.title === '浏览器在线写作验收').at(-1);
  assert.ok(online.html_source.includes('<strong>在线写作第一段。</strong>'));
  browserData = { noteCount: notes.length, sampleRevisions: sampleHistory.length, originalBytes: bytes.length, originalHash: archive.sha256, restoredAsNewRevision: true, failedRenderDraftSaved: true, conflictDidNotOverwrite: true, onlineFormattingPersisted: true, longHeadings: 80, longCodeBlocks: 80 };
} finally { db.close(); }

const missingLinks = []; let linksChecked = 0;
for (const directory of [path.join(root, 'doc'), path.join(root, 'doc/technical-notes-lab')]) {
  for (const filename of readdirSync(directory).filter(f => f.endsWith('.md'))) {
    const source = path.join(directory, filename), text = readFileSync(source, 'utf8');
    for (const match of text.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
      const link = (match[1] || match[2]).split('#')[0];
      if (!link || /^[a-z]+:/i.test(link) || link.startsWith('/')) continue;
      linksChecked++;
      if (!existsSync(path.resolve(directory, decodeURIComponent(link)))) missingLinks.push({ source, link });
    }
  }
}
assert.deepEqual(missingLinks, []);
const report = { checkedAt: new Date().toISOString(), legacyFiles: protectedFiles.length, legacyChanged: changed.length, browserData, documentationLinks: linksChecked, missingLinks };
writeFileSync(path.join(here, 'closeout-check.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
