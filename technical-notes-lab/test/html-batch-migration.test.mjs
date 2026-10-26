import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { migrateMarkdownLibrary } from '../lib/html-batch-migration.mjs';
import { openHtmlStore } from '../lib/html-store.mjs';
import { normalizeHtml, renderHtml } from '../lib/html-content.mjs';
import { createJointBackup, restoreJointBackup } from '../lib/html-backup.mjs';

test('library inventory, two-phase links, old metadata, rejection archives, resume conflicts and joint recovery',async t=>{
  const temp=mkdtempSync(path.join(os.tmpdir(),'html-batch-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const source=path.join(temp,'source'),target=path.join(temp,'target');mkdirSync(source);
  writeFileSync(path.join(source,'a.md'),'# A\n\n[B](b.md#old-b)\n\n![missing](gone.png)');
  writeFileSync(path.join(source,'b.md'),'# B');writeFileSync(path.join(source,'bad.md'),Buffer.from([255,254]));
  const catalog={entries:{'a.md':{oldUrl:'/docs/a/',metadata:{title:'Old title',category:'Old category',tags:['kept'],draft:false,order:2}},'b.md':{oldUrl:'/docs/b/',metadata:{title:'B'},headings:[{text:'B',depth:1,slug:'old-b'}]}}};
  const first=await migrateMarkdownLibrary({sourceRoot:source,destination:target,catalog});
  assert.equal(first.totals.sourceFiles,3);assert.equal(first.totals.imported,2);assert.equal(first.totals.failed,1);assert.equal(first.publishedNotes,0);
  const a=first.items.find(i=>i.path==='a.md'), b=first.items.find(i=>i.path==='b.md'),bad=first.items.find(i=>i.path==='bad.md');
  assert.match(a.id,/^[a-f0-9-]+$/);assert.equal(first.totals.reviewRequired,2);
  assert.equal(a.links[0].target,`/notes/${b.id}#section-1`);assert.equal(a.resources[0].status,'unresolved');assert.equal(a.metadata.title,'Old title');assert.equal(a.metadata.category,'Old category');
  let store=openHtmlStore(path.join(target,'notes.sqlite'));assert.deepEqual(store.readArchive(bad.inventoryArchiveId).bytes,Buffer.from([255,254]));
  let note=store.get(a.id);assert.match(note.html_source,new RegExp(`/notes/${b.id}#section-1`));
  store.save(a.id,{version:note.version,result:await normalizeHtml('<p>Online edit preserved</p>')});store.close();
  writeFileSync(path.join(source,'a.md'),'# Changed source');
  const second=await migrateMarkdownLibrary({sourceRoot:source,destination:target,catalog,resume:true});
  assert.equal(second.totals.conflict,1);assert.equal(second.totals.unchanged,1);assert.equal(second.totals.failed,1);
  store=openHtmlStore(path.join(target,'notes.sqlite'));assert.equal(store.list().length,2);assert.match(store.get(a.id).html_source,/Online edit preserved/);store.close();
  await createJointBackup({dbPath:path.join(target,'notes.sqlite'),mediaDir:path.join(target,'media'),destination:path.join(temp,'backup')});
  const restored=restoreJointBackup({backupDir:path.join(temp,'backup'),destination:path.join(temp,'restored')});
  store=openHtmlStore(restored.dbPath);assert.equal(store.list().length,2);assert.deepEqual(store.readArchive(bad.inventoryArchiveId).bytes,Buffer.from([255,254]));assert.equal(store.db.prepare('SELECT count(*) AS n FROM legacy_urls').get().n,2);store.close();
  assert.deepEqual(readFileSync(path.join(source,'bad.md')),Buffer.from([255,254]));
});

test('migration refuses source overlap, existing unmanaged directory and default data',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'html-batch-boundary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  await assert.rejects(migrateMarkdownLibrary({sourceRoot:root,destination:path.join(root,'out')}),/separate/);
  const forbidden=fileURLToPath(new URL('../data/batch-forbidden',import.meta.url));
  await assert.rejects(migrateMarkdownLibrary({sourceRoot:root,destination:forbidden}),/default data/);assert.equal(existsSync(forbidden),false);
  const other=mkdtempSync(path.join(os.tmpdir(),'html-batch-unmanaged-'));t.after(()=>rmSync(other,{recursive:true,force:true}));
  await assert.rejects(migrateMarkdownLibrary({sourceRoot:root,destination:other,resume:true}),/ENOENT/);
});

test('catalog collisions and stale original hashes are rejected without discarding original bytes',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'html-batch-catalog-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source');mkdirSync(source);for(const p of ['a','b','c']) writeFileSync(path.join(source,`${p}.md`),`# ${p}`);
  const report=await migrateMarkdownLibrary({sourceRoot:source,destination:path.join(root,'target'),catalog:{entries:{'a.md':{oldUrl:'/docs/same/'},'b.md':{oldUrl:'/docs/same/'},'c.md':{originalHash:'wrong'}}}});
  assert.equal(report.totals.failed,3);assert.equal(report.htmlNotes,0);assert.equal(report.items.filter(i=>i.code==='LEGACY_URL_COLLISION').length,2);assert.equal(report.items.find(i=>i.path==='c.md').code,'CATALOG_SOURCE_HASH_MISMATCH');
  const store=openHtmlStore(path.join(root,'target','notes.sqlite'));for(const i of report.items) assert.ok(store.readArchive(i.inventoryArchiveId).bytes.length);store.close();
});

test('resume rejects directory junction escape before opening the database',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'html-batch-symlink-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const source=path.join(root,'source'),target=path.join(root,'target'),outside=path.join(root,'outside');for(const p of [source,target,outside]) mkdirSync(p);
  writeFileSync(path.join(target,'batch-source.json'),JSON.stringify({format:'notes-library/1',sourceRoot:source}));symlinkSync(outside,path.join(target,'redirect'),'junction');
  await assert.rejects(migrateMarkdownLibrary({sourceRoot:source,destination:target,resume:true}),/symbolic link/);assert.equal(existsSync(path.join(target,'notes.sqlite')),false);
});

test('target import failure creates a blocked new revision and consistent item report',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'html-batch-dangling-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const source=path.join(root,'source'),target=path.join(root,'target');mkdirSync(source);
  writeFileSync(path.join(source,'a.md'),'# A\n\n[B](b.md)');writeFileSync(path.join(source,'b.md'),'# B');
  const report=await migrateMarkdownLibrary({sourceRoot:source,destination:target,catalog:{entries:{'a.md':{metadata:{title:'A'}},'b.md':{metadata:{title:'x'.repeat(201)}}}}});
  const a=report.items.find(i=>i.path==='a.md');assert.equal(a.links[0].code,'LINK_TARGET_NOT_IMPORTED');assert.equal(a.publishable,false);
  assert.deepEqual(JSON.parse(readFileSync(path.join(target,`item-${a.id}.json`),'utf8')),a);
  let store=openHtmlStore(path.join(target,'notes.sqlite'));const note=store.get(a.id);assert.equal(note.publishable,false);assert.throws(()=>store.publish(note.id,note.version),e=>e.code==='NOT_PUBLISHABLE');
  const online=store.save(note.id,{version:note.version,result:await renderHtml(await normalizeHtml('<p>Author removed broken link</p>'))});store.close();
  await migrateMarkdownLibrary({sourceRoot:source,destination:target,resume:true,catalog:{entries:{'a.md':{metadata:{title:'A'}},'b.md':{metadata:{title:'x'.repeat(201)}}}}});
  store=openHtmlStore(path.join(target,'notes.sqlite'));assert.equal(store.get(a.id).draft_revision_id,online.draft_revision_id);assert.equal(store.get(a.id).publishable,true);store.close();
});
