import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { restoreJointBackup } from '../../../technical-notes-lab/lib/html-backup.mjs';
import { openHtmlStore } from '../../../technical-notes-lab/lib/html-store.mjs';
import { normalizeHtml, renderHtml } from '../../../technical-notes-lab/lib/html-content.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../../../technical-notes-lab');
const report = JSON.parse(fs.readFileSync(path.join(here, 'migration-library-final.json'), 'utf8'));
const destination = path.join(app, '.test-data/batch-07-content-reviewed');
const restored = restoreJointBackup({
  backupDir: path.join(app, '.test-data/batch-07-library-final-backup'),
  destination,
});
const store = openHtmlStore(restored.dbPath, { archiveDir: restored.archiveDir });
const replacements = [
  {
    fragment: '09_Windows 全架构 Hook',
    before: 'Ntdll-&gt;&gt;CPU: mov eax,SSN; syscall',
    after: 'Ntdll-&gt;&gt;CPU: mov eax, SSN &lt;br/&gt; syscall',
    reason: 'Mermaid 把分号当作语句结束；用图表换行继续表达同一两步操作。',
  },
  {
    fragment: '课时05_重写R3API',
    before: '<h3 id="section-9">3.1 安全软件如何Hook API</h3><pre><code class="language-text">',
    after: '<h3 id="section-9">3.1 安全软件如何Hook API</h3><p>原始函数：</p><pre><code class="language-text">',
    reason: '把误写为围栏语言的“原始函数：”恢复为可见说明，代码继续按纯文本展示。',
  },
];
const output = { reviewedAt: new Date().toISOString(), database: restored.dbPath, notes: [] };
try {
  for (const replacement of replacements) {
    const item = report.items.find(entry => entry.path.includes(replacement.fragment));
    assert.ok(item, replacement.fragment);
    const previous = store.get(item.noteId);
    assert.equal(previous.version, 1);
    assert.equal(previous.published_revision_id, null);
    assert.equal(previous.html_source.split(replacement.before).length, 2);
    const proposed = previous.html_source.replace(replacement.before, replacement.after);
    const result = await renderHtml(await normalizeHtml(proposed));
    assert.equal(result.status, 'ready');
    assert.equal(result.renderStatus, 'ready');
    assert.equal(result.publishable, true);
    assert.deepEqual(result.diagnostics.filter(entry => entry.blocksPublishing), []);
    const current = store.save(previous.id, { version: previous.version, result });
    assert.notEqual(current.draft_revision_id, previous.draft_revision_id);
    assert.equal(current.source_archive_id, previous.source_archive_id);
    assert.equal(current.published_revision_id, null);
    assert.equal(current.publishable, true);
    assert.equal(current.html_source, result.htmlSource);
    assert.equal(store.getRevision(previous.id, previous.draft_revision_id).html_source, previous.html_source);
    output.notes.push({
      path: item.path, noteId: item.noteId, previousRevisionId: previous.draft_revision_id,
      currentRevisionId: current.draft_revision_id, version: current.version,
      sourceArchiveId: current.source_archive_id, sourceHash: current.source_hash,
      status: current.status, renderStatus: current.render_status,
      publishable: current.publishable, diagnostics: current.diagnostics,
      change: {before: replacement.before, after: replacement.after, reason: replacement.reason},
    });
  }
  assert.equal(store.list().length, 253);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM content_revisions').get().n, 255);
  assert.equal(store.publicList().length, 0);
  output.totalNotes = 253; output.totalRevisions = 255; output.publishedNotes = 0;
  fs.writeFileSync(path.join(here, 'content-review.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify({totalNotes:253,totalRevisions:255,publishedNotes:0,reviewed:output.notes.map(note=>({path:note.path,version:note.version,status:note.status,renderStatus:note.renderStatus,publishable:note.publishable,diagnostics:note.diagnostics.map(d=>d.code)}))},null,2));
} finally { store.close(); }
