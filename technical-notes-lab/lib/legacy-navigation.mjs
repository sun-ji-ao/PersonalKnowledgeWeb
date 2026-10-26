import { escapeHtml as e } from './content.mjs';
import { shell } from './views.mjs';
import { discoveryFacets } from './html-discovery.mjs';

// Keep the slug contract of the original Astro site's src/lib/content.ts.
export function legacySlug(value) {
  return value.trim().toLowerCase().replaceAll('&', 'and').replaceAll('+', 'plus')
    .replace(/[\\/]/g, '-').replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function legacyFacetName(notes, type, slug) {
  const values = discoveryFacets(notes)[type === 'category' ? 'categories' : 'tags'];
  const matches = values.filter(value => legacySlug(value) === slug);
  return matches.length === 1 ? matches[0] : null;
}

export function legacyFacetIndex(notes, type) {
  const isCategory = type === 'category', title = isCategory ? '文章分类' : '文章标签';
  const values = discoveryFacets(notes)[isCategory ? 'categories' : 'tags'];
  const cards = values.map(value => {
    const count = notes.filter(note => isCategory ? note.category === value : note.tags.includes(value)).length;
    return `<li><a href="/${isCategory ? 'categories' : 'tags'}/${encodeURIComponent(legacySlug(value))}/">${e(value)}</a> <span>${count} 篇</span></li>`;
  }).join('');
  return shell(title, `<main class="index-main"><h1>${title}</h1><p><a href="/docs/">返回知识库</a></p><ul>${cards}</ul></main>`);
}

export function legacyArchive(notes) {
  const groups = new Map();
  for (const note of notes) {
    const date = new Date(note.published_at);
    if (Number.isNaN(date.getTime())) continue;
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(note);
  }
  const html = [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([month, entries]) =>
    `<section><h2>${e(month)}</h2><ul>${entries.sort((a,b) => new Date(b.published_at) - new Date(a.published_at)).map(note => `<li><a href="/notes/${e(note.id)}">${e(note.title)}</a></li>`).join('')}</ul></section>`).join('');
  return shell('文章归档', `<main class="index-main"><h1>文章归档</h1><p><a href="/docs/">返回知识库</a></p>${html}</main>`);
}
