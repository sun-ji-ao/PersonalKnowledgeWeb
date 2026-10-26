import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { parseFragment } from 'parse5';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../../../technical-notes-lab');
const migrated = JSON.parse(fs.readFileSync(path.join(here, 'migration-library-final.json'), 'utf8'));
const sourcePaths = new Map(migrated.items.map(item => [item.noteId, item.path]));
const db = new DatabaseSync(path.join(app, '.test-data/batch-07-content-reviewed/notes.sqlite'), {readOnly:true});
const details = [];
try {
  for (const row of db.prepare('SELECT n.id,n.published_revision_id,r.id AS revision_id,r.title,r.category,r.tags,r.html_source,r.html_rendered,r.status,r.render_status,r.publishable,r.diagnostics FROM html_notes n JOIN content_revisions r ON r.id=n.draft_revision_id ORDER BY n.id').all()) {
    const counts = {headings:0,code:0,math:0,mermaid:0,tables:0,details:0,images:0,links:0};
    const headingIds = new Set();
    function walk(node) {
      if (/^h[1-6]$/.test(node.tagName || '')) {
        counts.headings++;
        const id = node.attrs?.find(attribute => attribute.name === 'id')?.value;
        if (id) {assert.ok(!headingIds.has(id), `Repeated heading ID in ${row.id}`);headingIds.add(id);}
      }
      if (node.tagName === 'pre') {
        if (node.attrs?.some(attribute => attribute.name === 'data-note-kind' && attribute.value === 'mermaid') || node.childNodes?.some(child => child.attrs?.some(attribute => attribute.name === 'class' && attribute.value.includes('mermaid')))) counts.mermaid++;
        else counts.code++;
      }
      if (node.attrs?.some(attribute => attribute.name === 'data-note-kind' && attribute.value.startsWith('math'))) counts.math++;
      if (node.tagName === 'table') counts.tables++;
      if (node.tagName === 'details') counts.details++;
      if (node.tagName === 'img') counts.images++;
      if (node.tagName === 'a') counts.links++;
      for (const child of node.childNodes || []) walk(child);
    }
    walk(parseFragment(row.html_source));
    assert.equal(row.status, 'ready', row.id);
    assert.equal(row.render_status, 'ready', row.id);
    assert.equal(row.publishable, 1, row.id);
    assert.equal(row.published_revision_id, null, row.id);
    assert.ok(row.html_rendered.length > 0, row.id);
    assert.ok(sourcePaths.has(row.id), row.id);
    details.push({id:row.id,path:sourcePaths.get(row.id),title:row.title,category:row.category,revisionId:row.revision_id,sourceBytes:Buffer.byteLength(row.html_source),renderedBytes:Buffer.byteLength(row.html_rendered),diagnostics:JSON.parse(row.diagnostics).map(item => item.code),counts});
  }
} finally {db.close();}
assert.equal(details.length,253);
const totals = {notes:details.length,published:0,publishable:details.length,sourceBytes:0,renderedBytes:0};
for (const detail of details) {totals.sourceBytes+=detail.sourceBytes;totals.renderedBytes+=detail.renderedBytes;for(const [key,value] of Object.entries(detail.counts)) totals[key]=(totals[key]||0)+value;}
const representatives = [...details].sort((a,b)=>b.sourceBytes-a.sourceBytes).slice(0,4);
for (const fragment of ['09_Windows 全架构 Hook','课时05_重写R3API']) representatives.push(details.find(item=>item.path.includes(fragment)));
for (const key of ['math','mermaid','tables','details']) {const found=details.find(item=>item.counts[key]>0&&!representatives.includes(item));if(found) representatives.push(found);}
const result = {checkedAt:new Date().toISOString(),method:'read-only HTML structure inspection; browser visual check pending',totals,representatives:representatives.map(({id,path,title,sourceBytes,counts})=>({id,path,title,sourceBytes,counts})),articles:details};
fs.writeFileSync(path.join(here,'reading-structure.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({totals,representatives:result.representatives},null,2));
