import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { openHtmlStore } from '../lib/html-store.mjs';
import { normalizeHtml, renderHtml } from '../lib/html-content.mjs';
import { installLegacyAnchors, planLegacyAnchors } from '../lib/html-legacy-anchors.mjs';

const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('production origin, persistent sessions and published-only old URL redirect survive restart', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'notes-deployment-'));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const local = `http://127.0.0.1:${port}`;
  const oldUrl = '/docs/旧课程/第一课/';
  const dbPath = path.join(directory, 'notes.sqlite');
  const store = openHtmlStore(dbPath);
  const result = await renderHtml(await normalizeHtml('<h2>可见正文</h2>'));
  let note = store.create({ title: '部署样例', category: 'Windows & C++', tags: ['Kernel + PE'], result });
  store.db.exec('CREATE TABLE legacy_urls (url TEXT PRIMARY KEY,note_id TEXT NOT NULL,source_path TEXT NOT NULL)');
  store.db.prepare('INSERT INTO legacy_urls VALUES (?,?,?)').run(oldUrl, note.id, 'sample.md');
  const catalog = { entries: { 'sample.md': { oldUrl, headings: [{ depth: 2, slug: 'old-heading', text: '旧标题' }] } } };
  assert.equal(planLegacyAnchors(store.db, catalog).anchorCount, 1);
  assert.deepEqual(installLegacyAnchors(store.db, catalog), { urlCount: 1, anchorCount: 1 });
  store.close();
  let child;
  async function stop() { if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; } }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ['server.mjs'], { cwd: app, env: {
      ...process.env, HTML_EDITOR: '1', DEPLOYMENT_MODE: 'production', PUBLIC_ORIGIN: 'https://notes.example.test',
      DATA_DIR: directory, HTML_DB_PATH: dbPath, HTML_ARCHIVE_DIR: path.join(directory, 'source-archives'),
      HTML_MEDIA_DIR: path.join(directory, 'media'), SEED_DEMO: '0', ADMIN_PASSWORD: 'Deployment-test-password', PORT: String(port),
    }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
    for (let index = 0; index < 100; index++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { if ((await fetch(`${local}/_health`)).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 75));
    }
    throw new Error(logs);
  }
  const request = (route, options = {}) => fetch(`${local}${route}`, { redirect: 'manual', ...options });
  await start();
  assert.deepEqual(await (await request('/_health')).json(), { ok: true, mode: 'html' });
  assert.equal((await request('/docs/%E6%97%A7%E8%AF%BE%E7%A8%8B/%E7%AC%AC%E4%B8%80%E8%AF%BE/')).status, 404);
  const login = await request('/api/login', { method: 'POST', headers: { Origin: local, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'Deployment-test-password' }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const getNote = () => request(`/api/html/notes/${note.id}`, { headers: { Cookie: cookie } });
  assert.equal((await getNote()).status, 200);
  await stop(); await start();
  assert.equal((await getNote()).status, 200, 'writer session remains valid after process restart');
  note = await (await getNote()).json();
  const published = await request(`/api/html/notes/${note.id}/publish`, { method: 'POST', headers: { Cookie: cookie, Origin: local, 'Content-Type': 'application/json' }, body: JSON.stringify({ version: note.version, revisionId: note.revision_id, sourceHash: note.source_hash }) });
  assert.equal(published.status, 200);
  const redirect = await request('/docs/%E6%97%A7%E8%AF%BE%E7%A8%8B/%E7%AC%AC%E4%B8%80%E8%AF%BE/');
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), `/notes/${note.id}`);
  assert.equal(redirect.headers.get('cache-control'), 'no-store');
  assert.equal((await request('/docs/')).headers.get('location'), '/');
  assert.equal((await request('/docs/?q=部署')).headers.get('location'), '/?q=%E9%83%A8%E7%BD%B2');
  assert.equal((await request('/search/?q=可见正文')).headers.get('location'), '/?q=%E5%8F%AF%E8%A7%81%E6%AD%A3%E6%96%87');
  assert.match(await (await request('/categories/')).text(), /windows-and-cplusplus/);
  assert.match(await (await request('/tags/')).text(), /kernel-plus-pe/);
  assert.equal((await request('/categories/windows-and-cplusplus/')).headers.get('location'), '/?category=Windows+%26+C%2B%2B');
  assert.equal((await request('/tags/kernel-plus-pe/')).headers.get('location'), '/?tag=Kernel+%2B+PE');
  assert.equal((await request('/categories/missing/')).status, 404);
  assert.equal((await request('/tags/%ZZ/')).status, 400);
  assert.match(await (await request('/archive/')).text(), /部署样例/);
  assert.equal((await request('/?tag=Kernel+%2B+PE')).status, 200);
  const article = await (await request(`/notes/${note.id}`)).text();
  assert.match(article, /id="legacy-anchor-map"/);
  assert.match(article, /"old-heading":"section-1"/);
  assert.match(await (await request('/rss.xml')).text(), /https:\/\/notes\.example\.test/);
  assert.equal((await request('/api/logout', { method: 'POST', headers: { Cookie: cookie, Origin: local } })).status, 200);
  assert.equal((await getNote()).status, 401);
});
