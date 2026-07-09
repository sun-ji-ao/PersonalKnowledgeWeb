import { getDocUrl, getPublishedDocs, SITE_DESCRIPTION, SITE_NAME } from '../lib/content';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function GET({ site }: { site: URL }) {
  const docs = (await getPublishedDocs()).slice(-50).reverse();
  const baseUrl = site.toString();
  const items = docs
    .map((doc) => {
      const link = new URL(getDocUrl(doc.id), baseUrl).toString();
      const pubDate = (doc.data.updated ?? doc.data.date ?? new Date()).toUTCString();
      return `
        <item>
          <title>${escapeXml(doc.data.title)}</title>
          <link>${escapeXml(link)}</link>
          <guid>${escapeXml(link)}</guid>
          <description>${escapeXml(doc.data.description ?? '')}</description>
          <category>${escapeXml(doc.data.category)}</category>
          <pubDate>${pubDate}</pubDate>
        </item>`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>zh-CN</language>
    ${items}
  </channel>
</rss>`;
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8'
    }
  });
}
