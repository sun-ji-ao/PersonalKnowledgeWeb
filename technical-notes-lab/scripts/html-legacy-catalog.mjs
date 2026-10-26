// Read existing Astro cache and generated frontmatter only. Never import the
// legacy generator, whose top-level code deletes/rebuilds source directories.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '../../node_modules/devalue/index.js';
import { parseDocument } from 'yaml';
import { sha256 } from '../lib/source-archive.mjs';
const [workspace,output]=process.argv.slice(2);
try {
  if(!workspace||!output) throw new Error('Usage: node scripts/html-legacy-catalog.mjs WORKSPACE NEW_JSON');
  const root=await realpath(workspace),cache=await readFile(path.join(root,'.astro/data-store.json'));
  const docs=parse(cache.toString('utf8')).get('docs'); if(!(docs instanceof Map)) throw new Error('Missing cached docs collection');
  const catalog={format:'notes-legacy-catalog/1',provenance:{cache:'.astro/data-store.json',cacheSha256:sha256(cache),route:'src/lib/content.ts:getDocUrl; /docs/${doc.id}/',generatedMetadataRoot:'src/content/docs'},entries:{}};
  for(const [id,entry] of docs) {
    const prefix='src/content/docs/';const filePath=entry.filePath.replaceAll('\\','/');
    if(!filePath.startsWith(prefix)||filePath.includes('../')) throw new Error('Invalid cached source path');
    const relative=filePath.slice(prefix.length),bytes=await readFile(path.join(root,filePath)),text=bytes.toString('utf8');
    const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(!match) throw new Error(`Missing generated frontmatter: ${relative}`);
    const doc=parseDocument(match[1],{uniqueKeys:true});if(doc.errors.length) throw new Error(`Invalid frontmatter: ${relative}`);
    const metadata=doc.toJS({maxAliasCount:20});
    // Critical user-facing fields must agree with cached route data.
    for(const key of ['title','description','category','tags','draft','order','useRealDate']) if(JSON.stringify(metadata[key])!==JSON.stringify(entry.data[key])) throw new Error(`Stale cache metadata ${key}: ${relative}`);
    const original=await readFile(path.join(root,'bypassAV-study-main',relative));
    catalog.entries[relative]={oldUrl:`/docs/${id}/`,originalHash:sha256(original),metadata,headings:entry.rendered?.metadata?.headings||[],provenance:{filePath,sha256:sha256(bytes),cacheId:id}};
  }
  await writeFile(output,JSON.stringify(catalog,null,2),{flag:'wx'});console.log(JSON.stringify({entries:Object.keys(catalog.entries).length,output}));
}catch(e){console.error(e.message);process.exitCode=1;}
