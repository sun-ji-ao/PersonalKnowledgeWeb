import { escapeHtml as e } from './content.mjs';
import { shell, indexView } from './views.mjs';
import { parseFragment, serialize } from 'parse5';
import { discover, discoveryFacets } from './html-discovery.mjs';

function enhance(page) { return page.replaceAll('href="/write"','href="/admin/html"').replace('</head>','<link rel="stylesheet" href="/reading-tools.css"><link rel="alternate" type="application/rss+xml" title="知页 RSS" href="/rss.xml"></head>').replace('</nav>','<a href="/?q=">搜索与分类</a><a href="/rss.xml">RSS</a></nav>').replace('</body>','<script type="module" src="/reading-tools.js"></script></body>'); }

// These functions accept the public DTO only, never a private store.get() value.
export function htmlIndexView(notes, params = {}, results = discover(notes,params)) {
  const facets = discoveryFacets(notes);
  const select = (name,label,values) => `<label>${label}<select name="${name}" aria-label="${label}"><option value="">全部${label}</option>${values.map(value => `<option value="${e(value)}"${params[name] === value ? ' selected' : ''}>${e(value)}</option>`).join('')}</select></label>`;
  const form = `<form class="discovery-form" action="/" method="get"><input type="search" name="q" aria-label="搜索已发布正文" placeholder="搜索正文、代码、标题…" maxlength="200" value="${e(params.q || '')}">${select('category','分类',facets.categories)}${select('tag','标签',facets.tags)}<button class="primary" type="submit">搜索</button><a href="/">重置</a></form><p class="muted">${results.length} 篇结果 · 空格分隔的词需同时匹配</p>`;
  const shown = results.map(n => ({...n,description:params.q ? n.snippet : n.description,tags:n.category ? [`分类：${n.category}`,...n.tags] : n.tags}));
  return enhance(indexView(shown).replace('<div class="section-bar">',`${form}<div class="section-bar">`));
}

export function htmlArticleView(note, legacyAnchors = {}) {
  const anchors = Object.keys(legacyAnchors).length ? `<script type="application/json" id="legacy-anchor-map">${JSON.stringify(legacyAnchors).replaceAll('<', '\\u003c')}</script>` : '';
  return enhance(shell(note.title, `<main class="article-layout"><article class="article"><a class="back-link" href="/">← 全部笔记</a><div class="article-top"><div class="note-meta">${note.category ? `<a class="tag" href="/?category=${encodeURIComponent(note.category)}">${e(note.category)}</a>` : ''}${note.tags.map(t => `<a class="tag" href="/?tag=${encodeURIComponent(t)}">${e(t)}</a>`).join('')}</div><h1>${e(note.title)}</h1><p class="article-description">${e(note.description)}</p><div class="article-info"><time>${e(new Date(note.published_at).toLocaleDateString('zh-CN'))}</time><a href="/api/public/notes/${e(note.id)}/export">下载已发布 HTML ↓</a></div></div><div class="prose article-content">${note.html_rendered}</div><div class="article-end">· · ·</div></article><aside class="toc"><p class="eyebrow">本篇目录</p>${note.headings.map(h => `<a class="depth-${Number(h.level)}" href="#${e(h.id)}">${e(h.text)}</a>`).join('') || '<span class="muted">暂无章节标题</span>'}</aside></main>${anchors}`, { description: note.description }));
}

// A complete display document. This intentionally excludes source/archive metadata.
export function htmlPublicExport(note, origin) {
  const tree = parseFragment(note.html_rendered);
  function visit(node) {
    for (const attr of node.attrs || []) if (['src', 'href'].includes(attr.name) && attr.value.startsWith('/') && !attr.value.startsWith('//')) attr.value = new URL(attr.value, origin).href;
    for (const child of node.childNodes || []) visit(child);
  }
  visit(tree);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(note.title)}</title><style>body{max-width:860px;margin:3rem auto;padding:0 1.5rem;font:18px/1.8 system-ui,sans-serif;color:#242424}pre{overflow:auto;padding:1rem;background:#f5f5f5;white-space:pre-wrap}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.5rem}.katex-html{display:none}.katex-display{display:block;margin:1rem 0}aside{font-size:.85rem;color:#666}</style></head><body><article><h1>${e(note.title)}</h1><p>${e(note.description)}</p>${serialize(tree)}</article><aside>已发布 HTML 静态导出；公式使用 MathML，Mermaid 保留源码。图片和站内链接需要原站在线，撤回后私有资源不可访问。</aside></body></html>`;
}
