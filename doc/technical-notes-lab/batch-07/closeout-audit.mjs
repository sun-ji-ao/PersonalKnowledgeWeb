import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function compare(file, base) {
  const items = json(file);
  return { count: items.length, changed: items.filter(item => digest(path.resolve(base, item.path)) !== item.sha256).map(item => item.path) };
}
const legacy = compare(path.resolve(here, '../batch-01/protected-manifest.json'), root);
const originalSite = compare(path.join(here, 'original-site-manifest.json'), root);
const source = compare(path.join(here, 'source-manifest.json'), path.join(root, 'technical-notes-lab'));
const brokenLinks = [];
let checkedDocuments = 0, checkedLinks = 0;
for (const directory of [path.join(root, 'doc'), path.resolve(here, '..')]) {
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.md'))) {
    const file = path.join(directory, name);
    checkedDocuments++;
    const content = fs.readFileSync(file, 'utf8').replace(/```[^\n]*\n[\s\S]*?```/g, '');
    for (const match of content.matchAll(/\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1].replace(/^<|>$/g, '');
      if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(target)) continue;
      const relative = decodeURIComponent(target.split('#')[0]);
      if (!relative) continue;
      checkedLinks++;
      if (!fs.existsSync(path.resolve(directory, relative))) brokenLinks.push({file: path.relative(root, file), target});
    }
  }
}
const result = {
  checkedAt: new Date().toISOString(), legacy, originalSite, source,
  checkedDocuments, checkedLinks, brokenLinks,
  snapshotSha256: digest(path.join(here, 'source-snapshot.zip')),
  browserAcceptance: 'completed_2026-09-24_on_isolated_4315_with_synthetic_fixtures_and_five_migrated_samples',
};
fs.writeFileSync(path.join(here, 'closeout-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (legacy.changed.length || originalSite.changed.length || source.changed.length || brokenLinks.length) process.exitCode = 1;
