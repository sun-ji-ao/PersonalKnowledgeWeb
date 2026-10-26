import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { escapeText } from '../lib/html-core.mjs';
const { values } = parseArgs({ options: { report: { type: 'string' }, port: { type: 'string', default: '4312' } } });
if (!values.report) throw new Error('--report <precheck-output-directory> is required');
const root = await realpath(values.report);
const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const report = JSON.parse(await readFile(path.join(root, 'report.json'), 'utf8'));
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const shell = (title, body) => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeText(title)}</title><link rel="stylesheet" href="/vendor/katex/katex.min.css"><style>body{max-width:980px;margin:40px auto;padding:0 24px;font:17px/1.8 system-ui;color:#dce4ed;background:#111923}a{color:#8bc8ff}pre{overflow:auto;padding:18px;background:#1b2734;border-radius:8px}img,svg{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #526173;padding:8px}aside{background:#243248;padding:16px}li[data-note-checked=true]::before{content:'☑ '}li[data-note-checked=false]::before{content:'☐ '}[data-note-align=right]{text-align:right}[data-note-align=center]{text-align:center}[data-note-kind=missing-media]{color:#ffbd86}</style><body>${body}<script type="module" src="/reader.js"></script></body></html>`;
async function safeFile(base, relative) {
  const target = await realpath(path.join(base, relative)); const rel = path.relative(base, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Outside preview boundary');
  return readFile(target);
}
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy', csp); res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://127.0.0.1');
    let body, type = 'text/html; charset=utf-8';
    if (url.pathname === '/') body = shell('转换预检查', '<h1>转换预检查</h1><p>仅本地预览，不连接文章数据库。</p><ul>' + report.items.map(item => `<li><a href="/notes/${item.id}">${escapeText(item.path)}</a> — ${item.status} / ${item.renderStatus || 'not-run'}</li>`).join('') + '</ul>');
    else if (url.pathname.startsWith('/notes/')) {
      const item = report.items.find(i => `/notes/${i.id}` === url.pathname); if (!item?.file) throw new Error('Not found');
      const data = JSON.parse(await safeFile(root, item.file));
      body = shell(data.metadata?.title || item.path, `<a href="/">← 全部样本</a><h1>${escapeText(data.metadata?.title || item.path)}</h1><aside>状态：${item.status}；展示：${item.renderStatus}<ul>${item.diagnostics.map(d => `<li>${escapeText(d.code + ': ' + d.message)}</li>`).join('')}</ul></aside><article>${data.htmlRendered || `<pre>${escapeText(data.htmlSource || '')}</pre>`}</article>`);
    } else if (url.pathname.startsWith('/media/')) {
      const filename = report.media[url.pathname.slice(7)]; if (!filename) throw new Error('Not found');
      body = await safeFile(root, filename); type = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' })[path.extname(filename)] || 'application/octet-stream';
    } else if (url.pathname === '/reader.js') { body = await readFile(path.join(app, 'public/reader.js')); type = 'text/javascript'; }
    else if (url.pathname.startsWith('/vendor/')) {
      const match = url.pathname.match(/^\/vendor\/(katex|mermaid)\/(.+)$/); if (!match) throw new Error('Not found');
      const base = await realpath(path.join(app, 'node_modules', match[1], 'dist'));
      body = await safeFile(base, decodeURIComponent(match[2]));
      type = ({ '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' })[path.extname(match[2])] || 'application/octet-stream';
    } else throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
});
server.listen(Number(values.port), '127.0.0.1', () => console.log(`Conversion preview: http://127.0.0.1:${values.port}`));
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
