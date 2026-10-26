import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createJointBackup, restoreJointBackup } from '../lib/html-backup.mjs';

const application = fileURLToPath(new URL('..', import.meta.url));
async function isolatedApplication(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'notes-phase56-'));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  let child, cookie = '', output = '';
  const request = (route, method = 'GET', data, authenticated = true, headers = {}) => fetch(origin + route, {
    method, headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: origin } : {}), ...(data !== undefined ? { 'Content-Type': Buffer.isBuffer(data) ? 'application/octet-stream' : 'application/json' } : {}), ...headers },
    body: data === undefined ? undefined : Buffer.isBuffer(data) ? data : JSON.stringify(data),
  });
  async function stop() { if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; } }
  async function start(extra = {}) {
    child = spawn(process.execPath, ['server.mjs'], { cwd: application, env: { ...process.env, PORT: String(port), DATA_DIR: directory, HTML_DB_PATH: path.join(directory, 'html-notes.sqlite'), HTML_ARCHIVE_DIR: path.join(directory, 'html-archives'), HTML_MEDIA_DIR: path.join(directory, 'media'), ADMIN_PASSWORD: 'Phase56-Test-Password', SEED_DEMO: '0', HTML_EDITOR: '1', ...extra }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await request('/', 'GET', undefined, false)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Application startup failed: ${output}`);
  }
  async function login() { const result = await request('/api/login', 'POST', { password: 'Phase56-Test-Password' }, false); assert.equal(result.status, 200); cookie = result.headers.get('set-cookie').split(';')[0]; }
  t.after(async () => { await stop(); const resolved = path.resolve(directory); assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('notes-phase56-')); await rm(resolved, { recursive: true, force: true }); });
  await start(); await login();
  return { directory, request, start, stop, login };
}
async function json(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
const publishInput = note => ({ version: note.version, revisionId: note.draft_revision_id, sourceHash: note.source_hash });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

test('B5/B6 independent integration: concurrent publication CAS, bad draft isolation, export and restart', async t => {
  const app = await isolatedApplication(t);
  const originalBytes = Buffer.from('---\ntitle: 公开原稿\ntags: [公开标签]\nsecret: 仅原件秘密\n---\n## 公开章节\n\n公开正文。');
  const { note: created } = await json(await app.request('/api/html/import?filename=publication.md&sourceKey=integration-pub', 'POST', originalBytes), 201);
  const privateRoute = `/api/html/notes/${created.id}`, publicRoute = `/api/public/notes/${created.id}`;
  assert.equal((await app.request(`${privateRoute}/publish`, 'POST', publishInput(created), false)).status, 401);
  assert.equal((await app.request(`${privateRoute}/publish`, 'POST', { ...publishInput(created), sourceHash: '0'.repeat(64) })).status, 409);
  const race = await Promise.all([app.request(`${privateRoute}/publish`, 'POST', publishInput(created)), app.request(`${privateRoute}/unpublish`, 'POST', { version: created.version })]);
  assert.deepEqual(race.map(response => response.status).sort(), [200, 409]);
  let current = await json(await app.request(privateRoute));
  assert.equal(current.version, created.version + 1);
  if (!current.published_revision_id) current = await json(await app.request(`${privateRoute}/publish`, 'POST', publishInput(current)));
  const before = await json(await app.request(publicRoute, 'GET', undefined, false));
  assert.equal(before.title, '公开原稿'); assert.match(before.html_rendered, /公开正文/);
  for (const key of ['html_source', 'source_metadata', 'source_archive_id', 'draft_revision_id', 'source_hash', 'diagnostics', 'published']) assert.equal(Object.hasOwn(before, key), false, key);
  const bad = await json(await app.request(privateRoute, 'PUT', { version: current.version, title: '秘密草稿标题', description: '秘密摘要', tags: ['秘密标签'], htmlSource: '<h2 id="private-heading">秘密章节</h2><div data-note-kind="math-block">\\notARealCommand{</div>' }));
  assert.equal(bad.publishable, false);
  assert.equal((await app.request(`${privateRoute}/publish`, 'POST', publishInput(bad))).status, 422);
  assert.deepEqual(await json(await app.request(publicRoute, 'GET', undefined, false)), before);
  for (const route of ['/', '/api/public/notes', `/notes/${created.id}`, `${publicRoute}/export`]) {
    const response = await app.request(route, 'GET', undefined, false); assert.equal(response.status, 200);
    const text = await response.text(); assert.doesNotMatch(text, /秘密|private-heading/); assert.match(text, /公开原稿/);
    if (route.endsWith('/export')) { assert.match(text, /^<!doctype html>/i); assert.match(response.headers.get('content-disposition'), /attachment/); }
  }
  const privateExport = await app.request(`${privateRoute}/export`); assert.equal(await privateExport.text(), bad.html_source);
  const archive = await app.request(`/api/html/archives/${bad.source_archive_id}`); assert.deepEqual(Buffer.from(await archive.arrayBuffer()), originalBytes);
  assert.equal((await app.request(`/api/html/archives/${bad.source_archive_id}`, 'GET', undefined, false)).status, 401);
  await app.stop(); await app.start(); await app.login();
  assert.deepEqual(await json(await app.request(publicRoute, 'GET', undefined, false)), before);
  const withdrawn = await json(await app.request(`${privateRoute}/unpublish`, 'POST', { version: bad.version }));
  assert.equal(withdrawn.version, bad.version + 1);
  assert.equal((await app.request(`${privateRoute}/publish`, 'POST', publishInput(current))).status, 409);
  for (const route of [publicRoute, `${publicRoute}/export`, `/notes/${created.id}`]) assert.equal((await app.request(route, 'GET', undefined, false)).status, 404);
});

test('B5/B6 independent integration: published-only Chinese discovery and immediate withdrawal', async t => {
  const app = await isolatedApplication(t);
  let note = await json(await app.request('/api/html/notes', 'POST', { title:'事务笔记', description:'并发控制', category:'数据库', tags:['SQLite'], htmlSource:'<h2 id="transactions">事务隔离</h2><p>中文<strong>连续</strong>搜索标记与 C++ 算法</p>' }), 201);
  const route = `/api/html/notes/${note.id}`;
  note = await json(await app.request(`${route}/publish`, 'POST', publishInput(note)));
  const draft = await json(await app.request(route, 'PUT', { version:note.version, title:'草稿独占标题', description:'草稿独占摘要', category:'私有分类', tags:['私有标签'], htmlSource:'<p>草稿独占正文</p>' }));
  const search = await json(await app.request('/api/public/search?q=' + encodeURIComponent('连续搜索 C++') + '&category=' + encodeURIComponent('数据库') + '&tag=SQLite', 'GET', undefined, false));
  const results = Array.isArray(search) ? search : search.results;
  assert.equal(results.length, 1); assert.equal(results[0].title, '事务笔记'); assert.equal(results[0].category, '数据库'); assert.match(results[0].snippet, /中文连续搜索/);
  for (const query of ['草稿独占', '" OR 1=1 --']) {
    const payload = await json(await app.request('/api/public/search?q=' + encodeURIComponent(query), 'GET', undefined, false));
    assert.equal((Array.isArray(payload) ? payload : payload.results).length, 0);
  }
  assert.equal((await app.request('/api/public/search?q=' + 'a'.repeat(201), 'GET', undefined, false)).status, 400);
  for (const route of ['/', '/api/public/search', '/rss.xml', '/sitemap.xml']) {
    const response = await app.request(route, 'GET', undefined, false); assert.equal(response.status, 200);
    const text = await response.text(); assert.doesNotMatch(text, /草稿独占|私有分类|私有标签/); assert.match(text, new RegExp(note.id));
  }
  await json(await app.request(`${route}/unpublish`, 'POST', { version:draft.version }));
  for (const route of ['/', '/api/public/search', '/rss.xml', '/sitemap.xml']) {
    const text = await (await app.request(route, 'GET', undefined, false)).text(); assert.doesNotMatch(text, new RegExp(note.id)); assert.doesNotMatch(text, /数据库|SQLite|私有分类|私有标签/);
  }
});

test('B5/B6 independent integration: old schema category upgrade preserves immutable published content', async t => {
  const app = await isolatedApplication(t);
  let note = await json(await app.request('/api/html/notes', 'POST', { title:'升级前笔记', description:'', tags:['既有标签'], htmlSource:'<h2 id="stable">既有正文</h2>' }), 201);
  const route = `/api/html/notes/${note.id}`;
  note = await json(await app.request(`${route}/publish`, 'POST', publishInput(note)));
  await app.stop();
  const database = new DatabaseSync(path.join(app.directory,'html-notes.sqlite'));
  try { database.exec('ALTER TABLE content_revisions DROP COLUMN category'); } finally { database.close(); }
  await app.start(); await app.login();
  const recovered = await json(await app.request(route));
  assert.equal(recovered.html_source,note.html_source); assert.equal(recovered.source_hash,note.source_hash); assert.equal(recovered.version,note.version); assert.equal(recovered.category,'');
  let publicNote = await json(await app.request(`/api/public/notes/${note.id}`, 'GET', undefined, false));
  assert.equal(publicNote.revision_id,note.published_revision_id); assert.equal(publicNote.category,'');
  const draft = await json(await app.request(route,'PUT',{version:recovered.version,title:recovered.title,description:'',tags:recovered.tags,category:'新分类',htmlSource:recovered.html_source}));
  publicNote = await json(await app.request(`/api/public/notes/${note.id}`, 'GET', undefined, false)); assert.equal(publicNote.category,'');
  const restored = await json(await app.request(`${route}/restore`,'POST',{version:draft.version,revisionId:recovered.draft_revision_id}));
  assert.equal(restored.category,''); assert.notEqual(restored.draft_revision_id,recovered.draft_revision_id); assert.equal(restored.published_revision_id,recovered.published_revision_id);
});

test('B5/B6 independent integration: repaired media, safe attachments, backup recovery and draft-only references', async t => {
  const app = await isolatedApplication(t);
  const bytes = Buffer.from('---\ntitle: 媒体边界\n---\n![应补传](missing.png)\n\n正文');
  const { note: imported } = await json(await app.request('/api/html/import?filename=media.md&sourceKey=integration-media', 'POST', bytes), 201);
  const route = `/api/html/notes/${imported.id}`;
  assert.equal(imported.publishable, false);
  assert.equal((await app.request('/api/html/media?filename=fake.png', 'POST', Buffer.from('<script>alert(1)</script>'))).status, 415);
  const image = await json(await app.request('/api/html/media?filename=pixel.png', 'POST', pixel), 201);
  const attachmentBytes = Buffer.from('<!doctype html><script>alert("inert attachment")</script>');
  const attachment = await json(await app.request('/api/html/media?filename=sample.html', 'POST', attachmentBytes), 201);
  for (const media of [image, attachment]) assert.equal((await app.request(media.url, 'GET', undefined, false)).status, 404);
  const repairs = await Promise.all([0,1].map(() => app.request(`${route}/media/replace`, 'POST', { version:imported.version, mediaId:image.id, missingPath:'missing.png' })));
  assert.deepEqual(repairs.map(response => response.status).sort(),[200,409]);
  const repaired = await json(repairs.find(response => response.ok));
  assert.equal(repaired.version, imported.version + 1); assert.notEqual(repaired.draft_revision_id, imported.draft_revision_id); assert.equal(repaired.source_archive_id, imported.source_archive_id);
  assert.equal((await app.request(`${route}/media/replace`, 'POST', { version:imported.version, mediaId:image.id, missingPath:'missing.png' })).status, 409);
  const withAttachment = await json(await app.request(route, 'PUT', { version:repaired.version, title:repaired.title, description:repaired.description, tags:repaired.tags, htmlSource:repaired.html_source + `<p><a href="${attachment.url}">下载附件</a></p>` }));
  const published = await json(await app.request(`${route}/publish`, 'POST', publishInput(withAttachment)));
  for (const [media, expected] of [[image,pixel], [attachment,attachmentBytes]]) {
    const response = await app.request(media.url, 'GET', undefined, false); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('cache-control'), /no-store/);
    if (media === attachment) { assert.match(response.headers.get('content-disposition'), /attachment/); assert.match(response.headers.get('content-type'), /application\/octet-stream/); assert.match(response.headers.get('content-security-policy'), /sandbox|default-src 'none'/); }
  }
  let otherDraft = await json(await app.request('/api/html/notes', 'POST', { title:'仅草稿借用图', description:'', tags:[], htmlSource:'<p><img src="/media/not-yet-uploaded" alt="私有未解析历史引用"></p>' }), 201);
  otherDraft = await json(await app.request(`/api/html/notes/${otherDraft.id}`, 'PUT', { version:otherDraft.version, title:otherDraft.title, description:'', tags:[], htmlSource:`<p><img src="${image.url}" alt="草稿引用"></p>` }));
  assert.equal((await app.request(`/notes/${otherDraft.id}`, 'GET', undefined, false)).status, 404);
  const dbPath = path.join(app.directory,'html-notes.sqlite'), archiveDir = path.join(app.directory,'html-archives'), mediaDir = path.join(app.directory,'media');
  await assert.rejects(createJointBackup({ dbPath, archiveDir, destination:path.join(app.directory,'without-media') }), /media/i);
  const backupDir = path.join(app.directory,'backup'); await createJointBackup({ dbPath, archiveDir, mediaDir, destination:backupDir });
  await json(await app.request(`${route}/unpublish`, 'POST', { version:published.version }));
  for (const media of [image,attachment]) assert.equal((await app.request(media.url, 'GET', undefined, false)).status, 404, 'A private draft retaining the old image must not keep it public');
  await app.stop();
  const restored = restoreJointBackup({ backupDir, destination:path.join(app.directory,'restored') });
  await app.start({ DATA_DIR:path.join(app.directory,'restored-runtime'), HTML_DB_PATH:restored.dbPath, HTML_ARCHIVE_DIR:restored.archiveDir, HTML_MEDIA_DIR:restored.mediaDir }); await app.login();
  assert.equal((await app.request(`/notes/${imported.id}`, 'GET', undefined, false)).status, 200);
  assert.equal((await app.request(`/notes/${otherDraft.id}`, 'GET', undefined, false)).status, 404);
  assert.deepEqual(Buffer.from(await (await app.request(image.url, 'GET', undefined, false)).arrayBuffer()), pixel);
  const original = await app.request(`/api/html/archives/${imported.source_archive_id}`); assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
  assert.equal((await app.request(`/api/html/archives/${imported.source_archive_id}`, 'GET', undefined, false)).status, 401);
  const recovered = await json(await app.request(route)); await json(await app.request(`${route}/unpublish`, 'POST', { version:recovered.version }));
  assert.equal((await app.request(image.url, 'GET', undefined, false)).status, 404);
});
