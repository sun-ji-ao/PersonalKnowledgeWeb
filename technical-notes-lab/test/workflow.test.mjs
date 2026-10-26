import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { importMarkdown, renderMarkdown } from '../lib/content.mjs';

test('Markdown: 旧frontmatter、代码别名、公式、图表及不可信HTML', async () => {
  const imported = importMarkdown('\uFEFF---\ntitle: 测试文章\ncategory: C语言\ndate: 2021-01-01\nuseRealDate: false\ndraft: false\norder: 5\n---\n\n## 正文\n内容', 'legacy.md');
  assert.equal(imported.title, '测试文章'); assert.deepEqual(imported.tags, ['C语言']);
  assert.equal(imported.sourceMetadata.useRealDate, false); assert.equal(imported.sourceMetadata.order, 5);
  assert.match(imported.markdown, /## 正文/);
  for (const [language, source] of [['c++', 'int main() { return 0; }'], ['js', 'const answer = 42;'], ['c', 'int main() { return 0; }'], ['asm', 'mov eax, 1'], ['cmd', 'echo hello'], ['csharp', 'class Test {}']]) {
    const output = await renderMarkdown(`\`\`\`${language}\n${source}\n\`\`\``);
    assert.match(output.html, /class="shiki/); assert.match(output.html, /span style="color:/, `${language} should have colored tokens`);
  }
  const rendered = await renderMarkdown('## 公式\n\n行内 $x^2$\n\n$$\nx^2 + y^2 = z^2\n$$\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n<script>alert(1)</script>\n\n[坏链接](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>');
  assert.match(rendered.html, /class="katex"/); assert.match(rendered.html, /katex-display/); assert.match(rendered.html, /class="mermaid"/);
  assert.doesNotMatch(rendered.html, /<script|onerror=|href="javascript:/); assert.equal(rendered.headings[0].id, 'section-1');
});

test('端到端：导入→编辑→发布快照→冲突→撤回→重启持久化', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'technical-notes-test-'));
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const port = 45000 + Math.floor(Math.random() * 10000), origin = `http://127.0.0.1:${port}`;
  let child, cookie = '';
  async function start() {
    child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: directory, ADMIN_PASSWORD: 'Test-Only-Password-2026', SEED_DEMO: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(output);
      try { const response = await fetch(origin); if (response.ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become ready: ${output}`);
  }
  async function stop() { if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; } }
  t.after(async () => { await stop(); const resolved = path.resolve(directory); assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith('technical-notes-test-')); await rm(resolved, { recursive: true, force: true }); });
  const request = (route, method = 'GET', input, authenticated = true, csrfOrigin = origin) => fetch(origin + route, { method, headers: { ...(authenticated && cookie ? { Cookie: cookie } : {}), ...(input !== undefined ? { 'Content-Type': 'application/json', Origin: csrfOrigin } : {}) }, body: input !== undefined ? JSON.stringify(input) : undefined });
  async function login() { const result = await request('/api/login', 'POST', { password: 'Test-Only-Password-2026' }, false); assert.equal(result.status, 200); cookie = result.headers.get('set-cookie').split(';')[0]; assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); }
  await start();
  assert.equal((await request('/api/notes', 'GET', undefined, false)).status, 401);
  assert.equal((await request('/api/login', 'POST', { password: 'wrong' }, false)).status, 401);
  await login();
  assert.equal((await request('/api/notes', 'POST', {}, true, 'https://evil.example')).status, 403);
  const uploaded = await request('/api/import', 'POST', { filename: 'legacy.md', markdown: '\uFEFF---\ntitle: 导入测试\ncategory: 算法\ndraft: false\ndate: 2021-01-01\nuseRealDate: false\n---\n\n## 原文\n\n第一版' });
  assert.equal(uploaded.status, 201); let note = await uploaded.json();
  assert.equal(note.published_at, null); assert.equal(note.source_metadata.useRealDate, false);
  assert.equal((await request(`/notes/${note.id}`, 'GET', undefined, false)).status, 404);
  assert.equal((await request(`/api/public/notes/${note.id}/export`, 'GET', undefined, false)).status, 404);
  const saved = await request(`/api/notes/${note.id}`, 'PUT', { ...note, title: '保存后的标题', markdown: '## 正文\n\n公开第一版' });
  assert.equal(saved.status, 200); const oldVersion = note.version; note = await saved.json();
  assert.equal((await request(`/api/notes/${note.id}`, 'PUT', { ...note, version: oldVersion })).status, 409);
  assert.equal((await request(`/api/notes/${note.id}/publish`, 'POST', { version: oldVersion })).status, 409);
  note = await (await request(`/api/notes/${note.id}/publish`, 'POST', { version: note.version })).json();
  const publicPage = await (await request(`/notes/${note.id}`, 'GET', undefined, false)).text();
  assert.match(publicPage, /公开第一版/); assert.match(publicPage, /保存后的标题/);
  note = await (await request(`/api/notes/${note.id}`, 'PUT', { ...note, title: '尚未公开标题', markdown: '私密第二版' })).json();
  const unchanged = await (await request(`/notes/${note.id}`, 'GET', undefined, false)).text();
  assert.match(unchanged, /公开第一版/); assert.doesNotMatch(unchanged, /私密第二版|尚未公开标题/);
  const exported = await (await request(`/api/public/notes/${note.id}/export`, 'GET', undefined, false)).text();
  assert.match(exported, /公开第一版/); assert.doesNotMatch(exported, /私密第二版/);
  await stop(); await start(); await login();
  const persisted = await (await request(`/api/notes/${note.id}`)).json(); assert.equal(persisted.markdown, '私密第二版'); assert.equal(persisted.published_markdown, '## 正文\n\n公开第一版');
  const privateExport = await (await request(`/api/notes/${note.id}/export`)).text();
  const roundTrip = importMarkdown(privateExport, 'export.md');
  assert.equal(roundTrip.title, '尚未公开标题'); assert.equal(roundTrip.markdown.trim(), '私密第二版');
  assert.equal(roundTrip.sourceMetadata.date, '2021-01-01'); assert.equal(roundTrip.sourceMetadata.useRealDate, false);
  assert.equal(roundTrip.sourceMetadata.category, '算法'); assert.deepEqual(roundTrip.tags, ['算法']);
  assert.equal((await request(`/api/notes/${note.id}/unpublish`, 'POST', {})).status, 200);
  assert.equal((await request(`/notes/${note.id}`, 'GET', undefined, false)).status, 404);
  assert.equal((await request('/api/logout', 'POST', {})).status, 200);
  assert.equal((await request('/api/notes')).status, 401);
});
