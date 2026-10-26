import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isIP } from 'node:net';
import { openStore } from './lib/store.mjs';
import { openHtmlStore } from './lib/html-store.mjs';
import { convertMarkdown, normalizeHtml, renderHtml } from './lib/html-content.mjs';
import { importMarkdown, renderMarkdown, escapeHtml } from './lib/content.mjs';
import { shell, indexView, articleView, loginView, editorView, htmlEditorView } from './lib/views.mjs';
import { htmlIndexView, htmlArticleView, htmlPublicExport } from './lib/html-public.mjs';
import { createMediaManager, MEDIA_LIMIT } from './lib/html-media.mjs';
import { createDiscoveryIndex, discoveryFacets, rssFeed, sitemap } from './lib/html-discovery.mjs';
import { legacyFacetName, legacyFacetIndex, legacyArchive } from './lib/legacy-navigation.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4310);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const htmlEnabled = process.env.HTML_EDITOR === '1';
const deploymentMode = process.env.DEPLOYMENT_MODE === 'production';
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN) : null;
if (publicOrigin && (publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash || !['http:', 'https:'].includes(publicOrigin.protocol))) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path');
if (deploymentMode && (!htmlEnabled || !publicOrigin || publicOrigin.protocol !== 'https:' || process.env.SEED_DEMO !== '0')) throw new Error('Production requires HTML_EDITOR=1, HTTPS PUBLIC_ORIGIN and SEED_DEMO=0');
function resolvedPath(target) {
  const absolute = path.resolve(target), tail = []; let parent = absolute;
  while (!existsSync(parent)) { tail.unshift(path.basename(parent)); const next = path.dirname(parent); if (next === parent) break; parent = next; }
  const result = path.join(realpathSync(parent), ...tail); return process.platform === 'win32' ? result.toLowerCase() : result;
}
if (htmlEnabled) {
  if (!process.env.DATA_DIR) throw new Error('HTML_EDITOR requires an explicit isolated DATA_DIR');
  const protectedRoot = resolvedPath(path.join(root, 'data'));
  for (const target of [dataDir,process.env.HTML_DB_PATH || path.join(dataDir,'html-notes.sqlite'),process.env.HTML_ARCHIVE_DIR || path.join(dataDir,'html-archives'),process.env.HTML_MEDIA_DIR || path.join(dataDir,'media')]) {
    const resolved = resolvedPath(target); if (resolved === protectedRoot || resolved.startsWith(protectedRoot + path.sep)) throw new Error('HTML_EDITOR cannot write the protected default MVP data directory');
  }
}
if (deploymentMode && !path.relative(root, dataDir).startsWith(`..${path.sep}`) && path.relative(root, dataDir) !== '..') throw new Error('Production DATA_DIR must be outside the application release');
await mkdir(dataDir, { recursive: true });
const passwordPath = path.join(dataDir, 'admin-password.txt');
if (!existsSync(passwordPath)) await writeFile(passwordPath, randomBytes(18).toString('base64url'), { mode: 0o600 });
const adminPassword = process.env.ADMIN_PASSWORD || (await readFile(passwordPath, 'utf8')).trim();
if (adminPassword.length < 12) throw new Error('ADMIN_PASSWORD 至少需要 12 个字符');
const store = openStore(path.join(dataDir, 'notes.sqlite'));
const mediaManager = htmlEnabled ? createMediaManager(process.env.HTML_MEDIA_DIR || path.join(dataDir,'media')) : null;
const discoveryIndex = htmlEnabled ? createDiscoveryIndex() : null;
const htmlStore = htmlEnabled ? openHtmlStore(process.env.HTML_DB_PATH || path.join(dataDir, 'html-notes.sqlite'), { archiveDir: process.env.HTML_ARCHIVE_DIR || path.join(dataDir, 'html-archives'), hooks: {
  onRevision(value) { mediaManager.hooks.onRevision(value); discoveryIndex.hooks.onRevision(value); }, beforePublish:mediaManager.hooks.beforePublish,
} }) : null;
if (htmlStore) { mediaManager.attach(htmlStore.db); discoveryIndex.attach(htmlStore.db); }
const hasLegacyUrls = !!htmlStore?.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_urls'").get();
const hasLegacyAnchors = !!htmlStore?.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_anchor_maps'").get();
const sessions = new Map(), attempts = new Map();
const authDb = htmlEnabled ? new DatabaseSync(path.join(dataDir, 'auth.sqlite')) : null;
authDb?.exec('CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS login_attempts (client TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at INTEGER NOT NULL);');
const tokenHash = token => createHash('sha256').update(token).digest('hex');
const localOrigins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
const origins = new Set([...localOrigins, ...(publicOrigin ? [publicOrigin.origin] : [])]);
const allowedHosts = new Set([...localOrigins.map(value => new URL(value).host), ...(publicOrigin ? [publicOrigin.host] : [])]);
const clientKey = req => {
  const direct = req.socket.remoteAddress || 'unknown';
  const forwarded = deploymentMode && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(direct) ? req.headers['x-real-ip'] : null;
  return typeof forwarded === 'string' && isIP(forwarded) ? forwarded : direct;
};
if (!store.list().length && process.env.SEED_DEMO !== '0') {
  const sample = importMarkdown(await readFile(path.join(root, 'example.md'), 'utf8'), 'example.md');
  const note = store.create(sample); store.publish(note.id, note.version);
}
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function session(req) {
  const id = /(?:^|;\s*)notes_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (authDb) {
    if (!id || !/^[a-f0-9]{64}$/.test(id)) return false;
    const value = authDb.prepare('SELECT expires_at FROM auth_sessions WHERE token_hash=?').get(tokenHash(id));
    if (!value) return false;
    if (value.expires_at <= Date.now()) { authDb.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(id)); return false; }
    return true;
  }
  const value = sessions.get(id);
  if (!value || value < Date.now()) { sessions.delete(id); return false; }
  return true;
}
async function readBytes(req, limit) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw Object.assign(new Error('请求正文超过允许大小'), { status: 413 }); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function body(req, limit = 2 * 1024 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('请使用 JSON 请求'), { status: 415 });
  const bytes = await readBytes(req, limit);
  try { const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; } catch { throw Object.assign(new Error('请求内容不是有效 JSON 对象'), { status: 400 }); }
}
const htmlBody = req => body(req, 70_000_000); // 11.4 MB HTML plus worst-case JSON escapes.
async function htmlResult(html) {
  if (typeof html !== 'string') throw Object.assign(new Error('缺少 HTML 正文'), { status: 400 });
  const result = await normalizeHtml(html);
  if (result.htmlSource === null) throw Object.assign(new Error('HTML 正文无法保存'), { status: 422, diagnostics: result.diagnostics });
  return result;
}
function validate(input) {
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.markdown !== 'string' || typeof input.description !== 'string' || input.description.length > 500 || !Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(t => typeof t !== 'string' || t.length > 80)) throw Object.assign(new Error('标题、摘要或标签格式不正确'), { status: 400 });
  return { ...input, title: input.title.trim() };
}
async function asset(res, filename, base) {
  const resolved = path.resolve(base, filename);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) return send(res, 404, { error: '未找到文件' });
  const types = { '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
  if (!types[path.extname(resolved)]) return send(res, 404, { error: '未找到文件' });
  try { send(res, 200, await readFile(resolved), types[path.extname(resolved)]); } catch { send(res, 404, { error: '未找到文件' }); }
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    if (!allowedHosts.has(req.headers.host)) return send(res, 403, { error: '不允许的访问地址' });
    const url = new URL(req.url, publicOrigin?.origin || `http://${req.headers.host}`), route = url.pathname;
    if (!['GET', 'HEAD'].includes(req.method) && !origins.has(req.headers.origin)) return send(res, 403, { error: '请求来源校验失败' });
    if (route === '/_health' && req.method === 'GET') { htmlStore?.db.prepare('SELECT 1').get(); return send(res, 200, { ok: true, mode: htmlEnabled ? 'html' : 'markdown' }); }
    if (route.startsWith('/vendor/katex/')) return asset(res, route.slice('/vendor/katex/'.length), path.join(root, 'node_modules/katex/dist'));
    if (route.startsWith('/vendor/mermaid/')) return asset(res, route.slice('/vendor/mermaid/'.length), path.join(root, 'node_modules/mermaid/dist'));
    if (['/styles.css', '/reading-tools.css', '/reading-tools.js', '/reader.js', '/editor.js', '/html-editor.bundle.js', '/html-editor.css', '/html-editor.LICENSE.txt', '/favicon.svg'].includes(route)) return asset(res, route.slice(1), path.join(root, 'public'));
    const mediaRead = route.match(/^\/media\/([a-f0-9]{64})$/);
    if (mediaManager && mediaRead && ['GET','HEAD'].includes(req.method)) {
      const media = session(req) ? mediaManager.read(mediaRead[1]) : mediaManager.publicRead(mediaRead[1]);
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      if (media.kind !== 'image') res.setHeader('Content-Disposition', `attachment; filename="attachment-${media.id}.bin"; filename*=UTF-8''${encodeURIComponent(media.filename).replace(/'/g,'%27')}`);
      return send(res,200,req.method === 'HEAD' ? Buffer.alloc(0) : media.bytes,media.kind === 'image' ? media.mime : 'application/octet-stream');
    }
    if (route === '/api/login' && req.method === 'POST') {
      const now = Date.now(), ip = clientKey(req), previous = authDb ? authDb.prepare('SELECT count,until_at AS until FROM login_attempts WHERE client=?').get(ip) : attempts.get(ip);
      const entry = previous && previous.until > now ? previous : { count: 0, until: now + 15 * 60_000 };
      if (entry.count >= 10) return send(res, 429, { error: '尝试次数过多，请稍后再试' });
      const input = await body(req), provided = Buffer.from(String(input.password || '')), expected = Buffer.from(adminPassword);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { entry.count++; if (authDb) authDb.prepare('INSERT INTO login_attempts (client,count,until_at) VALUES (?,?,?) ON CONFLICT(client) DO UPDATE SET count=excluded.count,until_at=excluded.until_at').run(ip,entry.count,entry.until); else attempts.set(ip, entry); return send(res, 401, { error: '密码不正确' }); }
      if (authDb) authDb.prepare('DELETE FROM login_attempts WHERE client=?').run(ip); else attempts.delete(ip);
      const id = randomBytes(32).toString('hex'); sessions.set(id, now + 24 * 3600_000);
      if (authDb) authDb.prepare('INSERT INTO auth_sessions (token_hash,expires_at) VALUES (?,?)').run(tokenHash(id),now+24*3600_000);
      res.setHeader('Set-Cookie', `notes_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${publicOrigin?.protocol === 'https:' ? '; Secure' : ''}`);
      return send(res, 200, { ok: true });
    }
    if (route === '/' && req.method === 'GET') {
      const notes = htmlStore?.publicList(), params = Object.fromEntries(url.searchParams);
      return send(res,200,htmlStore ? htmlIndexView(notes,params,discoveryIndex.search(notes,params)) : indexView(store.publicList()),'text/html; charset=utf-8');
    }
    if (htmlStore && req.method === 'GET') {
      const notes = htmlStore.publicList();
      if (route === '/docs/' || route === '/docs') {
        res.writeHead(302, { Location: `/${url.search}`, 'Cache-Control': 'no-store' }); return res.end();
      }
      if (route === '/search/' || route === '/search') {
        const query = url.searchParams.get('q');
        const target = new URL('/', publicOrigin?.origin || url.origin);
        if (query !== null) target.searchParams.set('q', query);
        res.writeHead(302, { Location: target.pathname + target.search, 'Cache-Control': 'no-store' }); return res.end();
      }
      if (route === '/categories/' || route === '/categories') return send(res, 200, legacyFacetIndex(notes, 'category'), 'text/html; charset=utf-8');
      if (route === '/tags/' || route === '/tags') return send(res, 200, legacyFacetIndex(notes, 'tag'), 'text/html; charset=utf-8');
      if (route === '/archive/' || route === '/archive') return send(res, 200, legacyArchive(notes), 'text/html; charset=utf-8');
      const facetRoute = route.match(/^\/(categories|tags)\/([^/]+)\/?$/);
      if (facetRoute) {
        let slug; try { slug = decodeURIComponent(facetRoute[2]); } catch { return send(res, 400, { error: '旧链接编码无效' }); }
        const type = facetRoute[1] === 'categories' ? 'category' : 'tag';
        const name = legacyFacetName(notes, type, slug);
        if (!name) return send(res, 404, { error: '旧分类或标签不存在或尚未公开' });
        const target = new URL('/', publicOrigin?.origin || url.origin);
        target.searchParams.set(type, name);
        res.writeHead(302, { Location: target.pathname + target.search, 'Cache-Control': 'no-store' }); return res.end();
      }
    }
    if (route === '/write' && req.method === 'GET') return send(res, 200, session(req) ? editorView() : loginView(), 'text/html; charset=utf-8');
    if (route === '/admin/html' && req.method === 'GET' && htmlStore) return send(res, 200, session(req) ? htmlEditorView() : loginView(), 'text/html; charset=utf-8');
    const publicArticle = route.match(/^\/notes\/([a-f0-9-]+)$/);
    const publicExport = route.match(/^\/api\/public\/notes\/([a-f0-9-]+)\/export$/);
    const publicDto = route.match(/^\/api\/public\/notes\/([a-f0-9-]+)$/);
    if (htmlStore && req.method === 'GET') {
      if (route === '/api/public/search') { const notes = htmlStore.publicList(); return send(res,200,{results:discoveryIndex.search(notes,Object.fromEntries(url.searchParams)),...discoveryFacets(notes)}); }
      if (route === '/rss.xml') return send(res,200,rssFeed(htmlStore.publicList(),publicOrigin?.origin || url.origin),'application/rss+xml; charset=utf-8');
      if (route === '/sitemap.xml') return send(res,200,sitemap(htmlStore.publicList(),publicOrigin?.origin || url.origin),'application/xml; charset=utf-8');
      if (route === '/api/public/notes') return send(res, 200, htmlStore.publicList());
      if (publicArticle || publicExport || publicDto) {
        const note = htmlStore.publicGet((publicArticle || publicExport || publicDto)[1]);
        if (!note) return send(res, 404, { error: '未找到公开笔记' });
        if (publicDto) return send(res, 200, note);
        if (publicExport) { res.setHeader('Content-Disposition', `attachment; filename="published-${note.id}.html"`); return send(res, 200, htmlPublicExport(note, publicOrigin?.origin || url.origin), 'text/html; charset=utf-8'); }
        const validIds = new Set(note.headings.map(heading => heading.id));
        const legacyAnchors = hasLegacyAnchors ? Object.fromEntries(htmlStore.db.prepare('SELECT old_slug,new_id FROM legacy_anchor_maps WHERE note_id=?').all(note.id).filter(row => validIds.has(row.new_id)).map(row => [row.old_slug, row.new_id])) : {};
        return send(res, 200, htmlArticleView(note, legacyAnchors), 'text/html; charset=utf-8');
      }
    }
    if (htmlStore && req.method === 'GET' && route.startsWith('/docs/') && hasLegacyUrls) {
      let decoded; try { decoded = decodeURI(route); } catch { return send(res, 400, { error: '旧链接编码无效' }); }
      const legacy = htmlStore.db.prepare('SELECT note_id FROM legacy_urls WHERE url=?').get(decoded);
      if (legacy && htmlStore.publicGet(legacy.note_id)) { res.writeHead(302, { Location: `/notes/${legacy.note_id}`, 'Cache-Control': 'no-store' }); return res.end(); }
      return send(res, 404, { error: '旧链接对应的笔记尚未公开或不存在' });
    }
    if ((publicArticle || publicExport) && req.method === 'GET') {
      const note = store.get((publicArticle || publicExport)[1]);
      if (!note?.published_at) return send(res, 404, shell('未找到笔记', '<main class="login-main"><h1>这篇笔记尚未公开。</h1><a href="/">返回全部笔记</a></main>'), 'text/html; charset=utf-8');
      if (publicExport) { res.setHeader('Content-Disposition', `attachment; filename="note-${note.id}.md"`); return send(res, 200, `# ${note.published_title}\n\n${note.published_markdown}`, 'text/markdown; charset=utf-8'); }
      return send(res, 200, articleView(note, await renderMarkdown(note.published_markdown)), 'text/html; charset=utf-8');
    }
    if (route.startsWith('/api/')) {
      if (!session(req)) return send(res, 401, { error: '请先登录写作台' });
      if (route.startsWith('/api/html/') && htmlStore) {
        if (route === '/api/html/media' && req.method === 'POST') {
          if (!req.headers['content-type']?.startsWith('application/octet-stream')) return send(res,415,{error:'上传必须使用原始文件字节'});
          return send(res,201,mediaManager.upload(await readBytes(req,MEDIA_LIMIT),url.searchParams.get('filename')));
        }
        const mediaNote = route.match(/^\/api\/html\/notes\/([a-f0-9-]+)\/media(?:\/(replace))?$/);
        if (mediaNote) {
          const note = htmlStore.get(mediaNote[1]); if (!note) return send(res,404,{error:'笔记不存在'});
          if (!mediaNote[2] && req.method === 'GET') return send(res,200,mediaManager.listFor(note));
          if (mediaNote[2] === 'replace' && req.method === 'POST') return send(res,200,await mediaManager.replace(htmlStore,note.id,await body(req)));
        }
        if (route === '/api/html/normalize' && req.method === 'POST') return send(res, 200, await htmlResult((await htmlBody(req)).htmlSource));
        if (route === '/api/html/notes' && req.method === 'GET') return send(res, 200, htmlStore.list().map(n => ({ id: n.id, title: n.title, version: n.version, updated_at: n.updated_at })));
        if (route === '/api/html/notes' && req.method === 'POST') { const input = await htmlBody(req); return send(res, 201, htmlStore.create({ title: input.title, description: input.description, tags: input.tags, category:input.category, result: await renderHtml(await htmlResult(input.htmlSource)) })); }
        if (route === '/api/html/import' && req.method === 'POST') {
          if (!req.headers['content-type']?.startsWith('application/octet-stream')) return send(res, 415, { error: '上传必须使用原始文件字节' });
          const filename = url.searchParams.get('filename') || '';
          if (!/^[^\\/\r\n\0]{1,240}\.(md|markdown)$/i.test(filename)) return send(res, 400, { error: '请选择 Markdown 文件名' });
          const bytes = await readBytes(req, 1_900_000), result = await convertMarkdown(bytes, { filename });
          if (result.htmlSource === null) return send(res, 422, { error: 'Markdown 转换失败；原稿未被覆盖', diagnostics: result.diagnostics });
          const imported = htmlStore.importSource({ bytes, filename, sourceKey: url.searchParams.get('sourceKey') || `upload:${filename}`, result: await renderHtml(result) });
          return send(res, imported.unchanged ? 200 : 201, imported);
        }
        const archiveMatch = route.match(/^\/api\/html\/archives\/([a-f0-9-]+)$/);
        if (archiveMatch && req.method === 'GET') { const archive = htmlStore.readArchive(archiveMatch[1]); res.setHeader('Content-Disposition', `attachment; filename="original-${archive.id}.md"; filename*=UTF-8''${encodeURIComponent(archive.filename)}`); return send(res, 200, archive.bytes, 'application/octet-stream'); }
        const htmlMatch = route.match(/^\/api\/html\/notes\/([a-f0-9-]+)(?:\/(history|restore|export|publish|unpublish))?$/);
        if (htmlMatch) {
          const [, id, action] = htmlMatch, note = htmlStore.get(id);
          if (!note) return send(res, 404, { error: 'HTML 笔记不存在' });
          if (!action && req.method === 'GET') return send(res, 200, note);
          if (!action && req.method === 'PUT') { const input = await htmlBody(req); const result = await renderHtml(await htmlResult(input.htmlSource)); return send(res, 200, htmlStore.save(id, { version: input.version, title: input.title, description: input.description, tags: input.tags, category:input.category, result })); }
          if (action === 'history' && req.method === 'GET') return send(res, 200, htmlStore.history(id));
          if (action === 'restore' && req.method === 'POST') { const input = await body(req); return send(res, 200, htmlStore.restore(id, input.revisionId, input.version)); }
          if (action === 'publish' && req.method === 'POST') {
            const input = await body(req);
            if (typeof input.revisionId !== 'string' || typeof input.sourceHash !== 'string') return send(res, 400, { error: '发布需要已保存修订及源哈希' });
            return send(res, 200, htmlStore.publish(id, input.version, { revisionId: input.revisionId, sourceHash: input.sourceHash }));
          }
          if (action === 'unpublish' && req.method === 'POST') return send(res, 200, htmlStore.unpublish(id, (await body(req)).version));
          if (action === 'export' && req.method === 'GET') { res.setHeader('Content-Disposition', `attachment; filename="note-${id}.html"`); return send(res, 200, note.html_source, 'text/html; charset=utf-8'); }
        }
        return send(res, 404, { error: '未找到 HTML 接口' });
      }
      if (route === '/api/logout' && req.method === 'POST') { const id = /notes_session=([^;]+)/.exec(req.headers.cookie || '')?.[1]; sessions.delete(id); if (authDb && id && /^[a-f0-9]{64}$/.test(id)) authDb.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(id)); res.setHeader('Set-Cookie', `notes_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${publicOrigin?.protocol === 'https:' ? '; Secure' : ''}`); return send(res, 200, { ok: true }); }
      if (route === '/api/notes' && req.method === 'GET') return send(res, 200, store.list());
      if (route === '/api/notes' && req.method === 'POST') return send(res, 201, store.create(validate(await body(req))));
      if (route === '/api/import' && req.method === 'POST') { const input = await body(req); if (typeof input.markdown !== 'string' || !/\.(md|markdown)$/i.test(input.filename || '')) return send(res, 400, { error: '请选择 Markdown 文件' }); return send(res, 201, store.create(validate(importMarkdown(input.markdown, input.filename)))); }
      if (route === '/api/preview' && req.method === 'POST') { const input = await body(req); if (typeof input.markdown !== 'string') return send(res, 400, { error: '缺少 Markdown 内容' }); return send(res, 200, await renderMarkdown(input.markdown)); }
      const match = route.match(/^\/api\/notes\/([a-f0-9-]+)(?:\/(publish|unpublish|export))?$/);
      if (match) {
        const [, id, action] = match; const note = store.get(id);
        if (!note) return send(res, 404, { error: '笔记不存在' });
        if (action === 'export' && req.method === 'GET') { res.setHeader('Content-Disposition', `attachment; filename="note-${id}.md"`); const metadata = { ...note.source_metadata, title: note.title, description: note.description, tags: note.tags }; return send(res, 200, `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${note.markdown}`, 'text/markdown; charset=utf-8'); }
        if (!action && req.method === 'GET') return send(res, 200, note);
        if (!action && req.method === 'PUT') { const input = validate(await body(req)); const saved = store.save(id, input); return saved ? send(res, 200, saved) : send(res, 409, { error: '另一页面已修改此笔记。请先导出当前内容，再刷新重新打开。' }); }
        if (action === 'publish' && req.method === 'POST') { const input = await body(req); if (!note.title.trim() || !note.markdown.trim()) return send(res, 400, { error: '请填写标题和正文后再发布' }); const published = store.publish(id, input.version); return published ? send(res, 200, published) : send(res, 409, { error: '内容已变化，请保存后重新发布' }); }
        if (action === 'unpublish' && req.method === 'POST') return send(res, 200, store.unpublish(id));
      }
    }
    send(res, 404, { error: '未找到页面' });
  } catch (error) { send(res, error.status || 500, { error: error.status ? error.message : '处理失败，请检查输入内容或稍后重试', code: error.code, currentVersion: error.currentVersion, diagnostics: error.diagnostics }); if (!error.status) console.error(error.message); }
});
server.listen(port, '127.0.0.1', () => console.log(`知页已启动：http://127.0.0.1:${port}\n站主密码位置：${passwordPath}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); htmlStore?.close(); authDb?.close(); process.exit(0); }));
