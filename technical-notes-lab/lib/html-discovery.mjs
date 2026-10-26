import { parseFragment } from 'parse5';

const xml = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
export function bodyText(html) {
  function text(node) { if (['script','style','annotation'].includes(node.tagName)) return ''; if (node.nodeName === '#text') return node.value; const value = (node.childNodes || []).map(text).join(''); return ['p','div','pre','li','table','tr','th','td','blockquote','figure','figcaption','details','summary','h1','h2','h3','h4','h5','h6','br','hr'].includes(node.tagName) ? ` ${value} ` : value; }
  return text(parseFragment(html || '')).replace(/\s+/g,' ').trim();
}
// Literal Unicode substring AND matching deliberately avoids SQLite MATCH grammar.
// This supports Chinese phrases, punctuation and source identifiers without a tokenizer.
export function discover(notes, { q = '', tag = '', category = '' } = {}, textFor) {
  if (typeof q !== 'string' || [...q].length > 200 || typeof tag !== 'string' || [...tag].length > 80 || typeof category !== 'string' || [...category].length > 80) throw Object.assign(new Error('搜索或筛选参数过长'), { status:400 });
  const terms = q.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return notes.filter(n => (!tag || n.tags.includes(tag)) && (!category || n.category === category)).flatMap(n => {
    const text = textFor ? textFor(n) : bodyText(n.html_rendered), searchable = `${n.title} ${n.description} ${n.category || ''} ${n.tags.join(' ')} ${text}`.toLocaleLowerCase();
    if (!terms.every(term => searchable.includes(term))) return [];
    const first = terms.length ? text.toLocaleLowerCase().indexOf(terms[0]) : 0, start = Math.max(0, first - 55);
    return [{ id:n.id, revision_id:n.revision_id, title:n.title, description:n.description, category:n.category || '', tags:n.tags, published_at:n.published_at, snippet:text.slice(start,start + 220) }];
  });
}
export function createDiscoveryIndex() {
  let db;
  const extractorVersion = 2;
  const initialize = connection => {
    db = connection;
    db.exec('CREATE TABLE IF NOT EXISTS revision_search (revision_id TEXT PRIMARY KEY REFERENCES content_revisions(id), plain_text TEXT NOT NULL, extractor_version INTEGER NOT NULL DEFAULT 0)');
    if (!db.prepare('PRAGMA table_info(revision_search)').all().some(column => column.name === 'extractor_version')) db.exec('ALTER TABLE revision_search ADD COLUMN extractor_version INTEGER NOT NULL DEFAULT 0');
  };
  const record = ({ db:connection, revision }) => { if (!db) initialize(connection); db.prepare('INSERT INTO revision_search (revision_id,plain_text,extractor_version) VALUES (?,?,?) ON CONFLICT(revision_id) DO UPDATE SET plain_text=excluded.plain_text,extractor_version=excluded.extractor_version').run(revision.id,bodyText(revision.html_source),extractorVersion); };
  return {
    hooks:{onRevision:record},
    attach(connection) {
      db = connection; db.exec('SAVEPOINT discovery_rebuild');
      try {
        initialize(connection);
        for (const revision of db.prepare('SELECT r.id,r.html_source FROM content_revisions r LEFT JOIN revision_search s ON s.revision_id=r.id WHERE s.revision_id IS NULL OR s.extractor_version != ?').all(extractorVersion)) record({db,revision});
        db.exec('RELEASE discovery_rebuild');
      } catch (error) { db.exec('ROLLBACK TO discovery_rebuild; RELEASE discovery_rebuild'); db = undefined; throw error; }
    },
    search(notes,params) {
      const texts = new Map(db.prepare('SELECT n.id,s.plain_text FROM html_notes n JOIN revision_search s ON s.revision_id=n.published_revision_id').all().map(row => [row.id,row.plain_text]));
      return discover(notes,params,n => texts.get(n.id) || '');
    },
  };
}
export function discoveryFacets(notes) { return { categories:[...new Set(notes.map(n => n.category).filter(Boolean))].sort(), tags:[...new Set(notes.flatMap(n => n.tags))].sort() }; }
function baseURL(origin) { const url = new URL(origin); if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid public site URL'); return url.origin; }
export function rssFeed(notes, origin) {
  const base = baseURL(origin);
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>知页 · 技术笔记</title><link>${xml(base)}</link><description>公开发布的技术笔记</description>${notes.map(n => `<item><title>${xml(n.title)}</title><link>${xml(`${base}/notes/${n.id}`)}</link><guid isPermaLink="true">${xml(`${base}/notes/${n.id}`)}</guid><description>${xml(n.description)}</description><pubDate>${xml(new Date(n.published_at).toUTCString())}</pubDate>${[n.category,...n.tags].filter(Boolean).map(c => `<category>${xml(c)}</category>`).join('')}</item>`).join('')}</channel></rss>`;
}
export function sitemap(notes, origin) { const base = baseURL(origin); return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${xml(base + '/')}</loc></url>${notes.map(n => `<url><loc>${xml(`${base}/notes/${n.id}`)}</loc><lastmod>${xml(n.published_at)}</lastmod></url>`).join('')}</urlset>`; }
