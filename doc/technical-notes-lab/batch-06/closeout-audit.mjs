import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const legacy = readJson(path.resolve(here, '../batch-01/protected-manifest.json'));
const source = readJson(path.join(here, 'source-manifest.json'));
const changed = (items, base) => items.filter(item => hash(path.resolve(base, item.path)) !== item.sha256).map(item => item.path);
const legacyChanged = changed(legacy, root);
const sourceChanged = changed(source, path.join(root, 'technical-notes-lab'));
const brokenLinks = [];
let checkedDocuments = 0, checkedLinks = 0;
// Check documentation pages, not deliberately invalid conversion fixtures.
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
  checkedAt: new Date().toISOString(), legacyFiles: legacy.length,
  legacyChanged: legacyChanged.length, sourceFiles: source.length,
  sourceChanged: sourceChanged.length, checkedDocuments, checkedLinks, brokenLinks,
  snapshotSha256: hash(path.join(here, 'source-snapshot.zip')),
  browserStatus: 'blocked_by_automatic_approval', browserOrigin: 'http://127.0.0.1:4315',
};
fs.writeFileSync(path.join(here, 'closeout-check.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({...result, changedLegacyPaths: legacyChanged, changedSourcePaths: sourceChanged}, null, 2));
if (legacyChanged.length || sourceChanged.length || brokenLinks.length) process.exitCode = 1;
