import { readFile } from 'node:fs/promises';

const [originArg, catalogArg, hostHeader] = process.argv.slice(2);
if (!originArg || !catalogArg) throw new Error('Usage: node scripts/html-check-legacy-http.mjs ORIGIN CATALOG_JSON');
const origin = new URL(originArg);
if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/') throw new Error('An HTTP(S) origin is required');
const catalog = JSON.parse(await readFile(catalogArg, 'utf8'));
const urls = Object.values(catalog.entries).map(entry => entry.oldUrl);
const headers = hostHeader ? { host: hostHeader } : {};
let redirects = 0, targets = 0;
for (let index = 0; index < urls.length; index += 8) {
  await Promise.all(urls.slice(index, index + 8).map(async url => {
    const old = await fetch(new URL(encodeURI(url), origin), { redirect: 'manual', headers });
    if (old.status !== 302) throw new Error(`${url}: expected 302, got ${old.status}`);
    const location = old.headers.get('location');
    if (!location?.startsWith('/notes/')) throw new Error(`${url}: unexpected target ${location}`);
    redirects++;
    const page = await fetch(new URL(location, origin), { headers });
    if (page.status !== 200) throw new Error(`${url}: target returned ${page.status}`);
    targets++;
  }));
}
const missing = await fetch(new URL('/docs/unknown-batch-08/', origin), { redirect: 'manual', headers });
if (missing.status !== 404) throw new Error(`Unknown old URL should be 404, got ${missing.status}`);
console.log(JSON.stringify({ origin: origin.origin, hostHeader: hostHeader || origin.host, oldUrls: urls.length, redirects, targets, unknownStatus: missing.status }));
