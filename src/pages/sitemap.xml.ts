import {
  getDocUrl,
  getPublishedDocs,
  groupDocsByCategory,
  groupDocsByTag
} from '../lib/content';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function createUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl).toString();
}

export async function GET({ site }: { site: URL }) {
  const docs = await getPublishedDocs();
  const categories = groupDocsByCategory(docs);
  const tags = groupDocsByTag(docs);
  const baseUrl = site.toString();
  const staticPaths = ['/', '/docs/', '/categories/', '/tags/', '/rss.xml'];
  const urls = [
    ...staticPaths.map((path) => createUrl(baseUrl, path)),
    ...categories.map((category) => createUrl(baseUrl, `/categories/${category.slug}/`)),
    ...tags.map((tag) => createUrl(baseUrl, `/tags/${tag.slug}/`)),
    ...docs.map((doc) => createUrl(baseUrl, getDocUrl(doc.id)))
  ];
  const body = urls
    .map((url) => {
      return `
  <url>
    <loc>${escapeXml(url)}</loc>
  </url>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}
</urlset>`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
}
