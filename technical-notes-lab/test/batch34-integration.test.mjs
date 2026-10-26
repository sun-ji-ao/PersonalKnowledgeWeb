import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { JSDOM } from 'jsdom';
import { EditorState } from 'prosemirror-state';
import { parseSource, serializeSource, sourceEquivalent } from '../public/html-schema.js';
import { normalizeHtml } from '../lib/html-content.mjs';
import { openHtmlStore } from '../lib/html-store.mjs';
import { createJointBackup, restoreJointBackup } from '../lib/html-backup.mjs';

const application = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Inline emphasis order can change in ProseMirror without losing semantics.
// Compare each text run's complete mark/attribute set, retaining block shape.
function inlineMarkSnapshot(html, document) {
  const container = document.createElement('div'); container.innerHTML = html;
  const marks = new Set(['STRONG', 'EM', 'DEL', 'A', 'CODE']);
  function visit(node, active = []) {
    if (node.nodeType === 3) return [{ text: node.textContent, marks: [...active].sort() }];
    const attributes = [...node.attributes].map(a => [a.name, a.value]).sort();
    if (marks.has(node.nodeName)) return [...node.childNodes].flatMap(child => visit(child, [...active, JSON.stringify([node.nodeName, attributes])]));
    return [{ tag: node.nodeName, attributes, children: [...node.childNodes].flatMap(child => visit(child, active)) }];
  }
  return [...container.childNodes].flatMap(node => visit(node));
}

test('B3/B4 integration: canonical contract nodes survive editor edits, normalization and reopening', async t => {
  const fixtures = JSON.parse(await readFile(path.join(application, '../doc/technical-notes-lab/batch-01/cases.json'), 'utf8'));
  const samples = fixtures.cases.filter(item => item.expected.htmlSource).map(item => [item.id, item.expected.htmlSource]);
  samples.push(
    ['block-table-cells', '<table><tbody><tr><td><p>Cell paragraph</p><ul><li>Nested item</li></ul></td><th><p>Header paragraph</p></th></tr></tbody></table>'],
    ['mixed-list-content', '<ol start="3"><li data-note-checked="true">Intro <strong>strong</strong><p>Paragraph</p>Tail<ul><li>Child</li></ul></li></ol>'],
    ['figure-inline-text', '<figure>Before <img src="https://example.com/image.png" alt="image"> after<figcaption>A caption</figcaption></figure>'],
    ['figure-paragraph-image', '<figure><p><img src="https://example.com/image.png" alt="image"></p><figcaption>A caption</figcaption></figure>'],
    ['details-direct-text', '<details><summary>Summary</summary>Before<p>A paragraph</p>After</details>'],
    ['empty-blocks', '<blockquote></blockquote><ul></ul><ol start="2"></ol><figure></figure>'],
    ['nested-mark-order', '<p><em><strong>Nested marks</strong></em> <a href="https://example.com"><del>Linked deletion</del></a></p>'],
    ['root-inline-fragment', 'Intro <strong>root text</strong><span data-note-kind="math-inline">x^2</span><img src="https://example.com/x.png" alt="image"><p>After</p>'],
  );
  for (const [name, html] of samples) await t.test(name, async () => {
    const normalized = await normalizeHtml('<p>Editable ordinary text</p>' + html);
    assert.notEqual(normalized.status, 'rejected');
    const dom = new JSDOM('<!doctype html><body></body>');
    try {
      const doc = parseSource(normalized.htmlSource, dom.window.document);
      assert.ok(sourceEquivalent(normalized.htmlSource, (await normalizeHtml(serializeSource(doc, dom.window.document))).htmlSource, dom.window.document), 'Editor load guard must accept a lossless supported source');
      const state = EditorState.create({ doc });
      const changed = state.apply(state.tr.insertText('Changed ordinary text', 1, 1 + 'Editable ordinary text'.length));
      const serialized = serializeSource(changed.doc, dom.window.document);
      const stored = await normalizeHtml(serialized);
      const expected = normalized.htmlSource.replace('Editable ordinary text', 'Changed ordinary text');
      if (name === 'nested-mark-order') assert.deepEqual(inlineMarkSnapshot(stored.htmlSource, dom.window.document), inlineMarkSnapshot(expected, dom.window.document));
      else assert.equal(stored.htmlSource, expected, 'Editing ordinary text must preserve every other canonical node');
      const reopened = parseSource(stored.htmlSource, dom.window.document);
      const resaved = await normalizeHtml(serializeSource(reopened, dom.window.document));
      assert.equal(resaved.htmlSource, stored.htmlSource);
    } finally { dom.window.close(); }
  });
});

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function isolatedApplication(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'notes-batch34-'));
  const port = await freePort(), origin = `http://127.0.0.1:${port}`;
  let child, cookie = '', output = '';
  const request = (route, method = 'GET', data, authenticated = true, headers = {}) => fetch(origin + route, {
    method,
    headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin } : {}), ...(data !== undefined ? { 'Content-Type': Buffer.isBuffer(data) ? 'application/octet-stream' : 'application/json' } : {}), ...headers },
    body: data === undefined ? undefined : Buffer.isBuffer(data) ? data : JSON.stringify(data),
  });
  async function stop() {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
  }
  async function start(extraEnv = {}) {
    child = spawn(process.execPath, ['server.mjs'], { cwd: application, env: { ...process.env, PORT: String(port), DATA_DIR: directory, HTML_DB_PATH: path.join(directory, 'html-notes.sqlite'), HTML_ARCHIVE_DIR: path.join(directory, 'html-archives'), ADMIN_PASSWORD: 'Batch34-Test-Password', SEED_DEMO: '0', HTML_EDITOR: '1', ...extraEnv }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', value => output += value); child.stderr.on('data', value => output += value);
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await request('/', 'GET', undefined, false)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Isolated server did not start: ${output}`);
  }
  async function login() {
    const response = await request('/api/login', 'POST', { password: 'Batch34-Test-Password' }, false);
    assert.equal(response.status, 200); cookie = response.headers.get('set-cookie').split(';')[0];
  }
  t.after(async () => {
    await stop();
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('notes-batch34-'));
    await rm(resolved, { recursive: true, force: true });
  });
  await start();
  return { directory, request, login, start, stop };
}

// This exercises HTTP and the persistent store together, independently of the
// lower-level storage and editor schema suites. All data belongs to a temp root.
test('B3/B4 integration: authenticated HTML source survives restart and rejects competing saves', async t => {
  const app = await isolatedApplication(t);
  assert.equal((await app.request('/api/html/notes', 'GET', undefined, false)).status, 401);
  await app.login();
  const response = await app.request('/api/html/notes', 'POST', {
    title: 'Integration original', description: 'Private description', tags: ['integration'],
    htmlSource: '<h2 id="stable-heading">Original heading</h2><p>Private original</p>',
  });
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json();
  assert.ok(created.id); assert.equal(typeof created.version, 'number');
  const route = `/api/html/notes/${created.id}`;
  assert.equal((await app.request(route, 'GET', undefined, false)).status, 401);
  assert.equal((await app.request(`/notes/${created.id}`, 'GET', undefined, false)).status, 404);
  const changes = ['Competing writer A', 'Competing writer B'].map(text => ({ ...created, htmlSource: `<h2 id="stable-heading">${text}</h2><p>${text}</p>` }));
  const results = await Promise.all(changes.map(input => app.request(route, 'PUT', input)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = await results.find(result => result.ok).json();
  assert.equal(winner.version, created.version + 1);
  await app.stop(); await app.start(); await app.login();
  const reopenedResponse = await app.request(route);
  assert.equal(reopenedResponse.status, 200);
  const reopened = await reopenedResponse.json();
  assert.equal(reopened.version, winner.version);
  assert.equal(reopened.html_source, winner.html_source);
  assert.match(reopened.html_source, /id="stable-heading"/);
  const legacy = await (await app.request('/api/notes')).json();
  assert.deepEqual(legacy, [], 'HTML editing must not create legacy Markdown notes');
});

test('B3/B4 integration: byte upload, source conflicts, immutable history and archive privacy', async t => {
  const app = await isolatedApplication(t); await app.login();
  const bytes = Buffer.from('\uFEFF---\r\ntitle: 原始中文\r\ndraft: false\r\n---\r\n# Heading\r\n\r\nOriginal body\r\n');
  const uploadRoute = '/api/html/import?filename=integration.md&sourceKey=integration%3Aone';
  const first = await app.request(uploadRoute, 'POST', bytes);
  assert.equal(first.status, 201, await first.clone().text());
  const imported = await first.json(); const original = imported.note || imported;
  const route = `/api/html/notes/${original.id}`;
  assert.equal(original.published_revision_id, null);
  assert.ok(original.source_archive_id);
  const archiveRoute = `/api/html/archives/${original.source_archive_id}`;
  assert.equal((await app.request(archiveRoute, 'GET', undefined, false)).status, 401);
  const archive = await app.request(archiveRoute);
  assert.equal(archive.status, 200); assert.deepEqual(Buffer.from(await archive.arrayBuffer()), bytes);
  const initialHistory = await (await app.request(`${route}/history`)).json();
  assert.equal(initialHistory.length, 1);
  const duplicate = await app.request(uploadRoute, 'POST', bytes);
  assert.ok(duplicate.ok); const repeated = await duplicate.json();
  assert.equal((repeated.note || repeated).id, original.id);
  assert.equal((await (await app.request(`${route}/history`)).json()).length, 1);
  const replacementResponse = await app.request(uploadRoute, 'POST', Buffer.from('# Replacement source\n\nSecond original file'));
  assert.ok(replacementResponse.ok); const replacementPayload = await replacementResponse.json();
  const replacement = replacementPayload.note || replacementPayload;
  assert.equal(replacement.id, original.id); assert.notEqual(replacement.source_archive_id, original.source_archive_id);
  const online = await app.request(route, 'PUT', { title: 'Online edit', description: '', tags: [], htmlSource: '<h1 id="section-1">Heading</h1><p>Private online change</p>', version: replacement.version });
  assert.equal(online.status, 200); const edited = await online.json();
  const conflict = await app.request(uploadRoute, 'POST', Buffer.from('# Reimport attempts to replace online body'));
  assert.equal(conflict.status, 409);
  assert.equal((await (await app.request(route)).json()).html_source, edited.html_source);
  assert.equal((await app.request(`${route}/history`, 'GET', undefined, false)).status, 401);
  const staleRestore = await app.request(`${route}/restore`, 'POST', { revisionId: initialHistory[0].id, version: original.version });
  assert.equal(staleRestore.status, 409);
  const restoredResponse = await app.request(`${route}/restore`, 'POST', { revisionId: initialHistory[0].id, version: edited.version });
  assert.equal(restoredResponse.status, 200); const restored = await restoredResponse.json();
  assert.equal(restored.html_source, original.html_source); assert.equal(restored.version, edited.version + 1);
  assert.notEqual(restored.draft_revision_id, original.draft_revision_id);
  assert.equal(restored.source_archive_id, original.source_archive_id);
  const history = await (await app.request(`${route}/history`)).json();
  assert.equal(history.length, 4);
  assert.deepEqual(history.find(item => item.id === initialHistory[0].id), initialHistory[0]);
  for (const path of ['/html-notes.sqlite', '/html-archives/' + original.source_archive_id, '/source-archives/' + original.source_archive_id, `/api/public/notes/${original.id}/export`]) {
    assert.equal((await app.request(path, 'GET', undefined, false)).status, 404, path);
  }
  const beforeRejected = await (await app.request('/api/html/notes')).json();
  const rejected = await app.request('/api/html/import?filename=invalid.md&sourceKey=integration%3Ainvalid', 'POST', Buffer.from([0xc3, 0x28]));
  assert.equal(rejected.status, 422);
  assert.equal((await (await app.request('/api/html/notes')).json()).length, beforeRejected.length);
});

test('B3/B4 integration: render errors preserve semantic drafts and HTML HTTP limits exceed legacy JSON limits', async t => {
  const app = await isolatedApplication(t); await app.login();
  const source = '<p>Valid private body</p><div data-note-kind="math-block">\\unknownIntegrationCommand{</div>';
  const response = await app.request('/api/html/notes', 'POST', { title: 'Recoverable failed display', htmlSource: source, description: '', tags: [] });
  assert.equal(response.status, 201, await response.clone().text());
  const created = await response.json();
  assert.equal(created.html_source, source); assert.equal(created.publishable, false);
  assert.equal(created.render_status, 'failed'); assert.ok(created.diagnostics.some(item => item.blocksPublishing));
  const reopened = await (await app.request(`/api/html/notes/${created.id}`)).json();
  assert.equal(reopened.html_source, source); assert.equal(reopened.draft_revision_id, created.draft_revision_id);
  const exported = await app.request(`/api/html/notes/${created.id}/export`);
  assert.equal(await exported.text(), source);
  assert.equal((await app.request(`/api/html/notes/${created.id}/export`, 'GET', undefined, false)).status, 401);
  const largeSource = '<p>' + 'a'.repeat(2_100_000) + '</p>';
  const normalizedResponse = await app.request('/api/html/normalize', 'POST', { htmlSource: largeSource });
  assert.equal(normalizedResponse.status, 200, await normalizedResponse.clone().text());
  assert.equal((await normalizedResponse.json()).htmlSource, largeSource);
});

test('B3/B4 integration: online joint backup restores original bytes, published isolation and HTTP editing', async t => {
  const app = await isolatedApplication(t); await app.login();
  const bytes = Buffer.from('\uFEFF# Joint backup\r\n\r\nPublished source\r\n');
  const response = await app.request('/api/html/import?filename=joint.md&sourceKey=joint', 'POST', bytes);
  assert.equal(response.status, 201); const { note: first } = await response.json();
  await app.stop();
  const dbPath = path.join(app.directory, 'html-notes.sqlite'), archiveDir = path.join(app.directory, 'html-archives');
  const store = openHtmlStore(dbPath, { archiveDir });
  let published;
  try { published = store.publish(first.id, first.version); } finally { store.close(); }
  await app.start(); await app.login();
  const route = `/api/html/notes/${first.id}`;
  const draftResponse = await app.request(route, 'PUT', { title: 'Private snapshot', description: '', tags: ['private'], htmlSource: '<p>Snapshot draft</p>', version: published.version });
  assert.equal(draftResponse.status, 200); const snapshotNote = await draftResponse.json();
  assert.equal(snapshotNote.published_revision_id, first.draft_revision_id);
  const mediaDir = path.join(app.directory, 'private-media'); await mkdir(mediaDir);
  const mediaBytes = Buffer.from([0, 255, 10, 200]); await writeFile(path.join(mediaDir, 'sample.bin'), mediaBytes);
  const backupDir = path.join(app.directory, 'joint-backup');
  await createJointBackup({ dbPath, archiveDir, mediaDir, destination: backupDir });
  const later = await app.request(route, 'PUT', { title: 'After snapshot', description: '', tags: [], htmlSource: '<p>After snapshot edit</p>', version: snapshotNote.version });
  assert.equal(later.status, 200);
  await app.stop();
  const restored = restoreJointBackup({ backupDir, destination: path.join(app.directory, 'joint-restored') });
  assert.deepEqual(await readFile(path.join(restored.directory, 'media', 'sample.bin')), mediaBytes);
  await app.start({ DATA_DIR: path.join(app.directory, 'restored-runtime'), HTML_DB_PATH: restored.dbPath, HTML_ARCHIVE_DIR: restored.archiveDir }); await app.login();
  const reopened = await (await app.request(route)).json();
  assert.equal(reopened.html_source, snapshotNote.html_source); assert.equal(reopened.version, snapshotNote.version);
  assert.equal(reopened.published_revision_id, first.draft_revision_id); assert.equal(reopened.published.html_source, first.html_source);
  const originalResponse = await app.request(`/api/html/archives/${reopened.source_archive_id}`);
  assert.deepEqual(Buffer.from(await originalResponse.arrayBuffer()), bytes);
  const continued = await app.request(route, 'PUT', { title: 'Continued after recovery', description: '', tags: [], htmlSource: '<p>Recovery keeps writing</p>', version: reopened.version });
  assert.equal(continued.status, 200); const saved = await continued.json();
  assert.equal(saved.version, reopened.version + 1); assert.equal(saved.published_revision_id, first.draft_revision_id);
  assert.equal((await (await app.request(`${route}/history`)).json()).length, 3);
});

test('B3/B4 integration: editor equivalence guard tolerates mark order but rejects semantic losses', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  try {
    const eq = (left, right) => sourceEquivalent(left, right, dom.window.document);
    assert.ok(eq('<p><em><strong>x</strong></em></p>', '<p><strong><em>x</em></strong></p>'));
    assert.equal(eq('<p><strong>x</strong></p>', '<p>x</p>'), false);
    assert.equal(eq('<p><a href="https://a.example">x</a></p>', '<p><a href="https://b.example">x</a></p>'), false);
    assert.equal(eq('<h2 id="stable">x</h2>', '<h2 id="changed">x</h2>'), false);
    assert.equal(eq('<pre><code class="language-cpp">x\n</code></pre>', '<pre><code class="language-cpp">x</code></pre>'), false);
    assert.equal(eq('<span data-note-kind="math-inline">x</span>', '<span data-note-kind="missing-media">x</span>'), false);
    assert.equal(eq('<details><summary>x</summary><p>y</p></details>', '<p>x y</p>'), false);
  } finally { dom.window.close(); }
});
