import { readdir, realpath, readFile, writeFile, mkdir, stat, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { sha256, writeArchive } from './source-archive.mjs';
import { assertIsolatedDestination } from './html-migration.mjs';
import { openHtmlStore } from './html-store.mjs';
import { createMediaManager } from './html-media.mjs';
import { convertMarkdown, renderHtml, runContentJob } from './html-content.mjs';
import { resolveResource } from './precheck.mjs';

const portable = p => p.split(path.sep).join('/');
const within = (a,b) => { const r=path.relative(a,b); return !r || (!r.startsWith('..'+path.sep) && r !== '..' && !path.isAbsolute(r)); };
const diagnostic = (code,message) => ({code,message,severity:'warning',blocksPublishing:true,location:null});
async function pool(items, work) { let next=0; await Promise.all(Array.from({length:3},async()=>{ while(next<items.length) { const i=next++; await work(items[i]); } })); }

// Catalog entries are data, never executable configuration. Old URL and metadata
// provenance must be collected separately from the immutable Markdown originals.
export async function migrateMarkdownLibrary({ sourceRoot, destination, catalog = {}, resume = false, onProgress = () => {} }) {
  const root=await realpath(sourceRoot), target=path.resolve(destination);
  // Resolve existing ancestors, including junctions, before applying the default-data guard.
  let ancestor=target; while(!existsSync(ancestor)) ancestor=path.dirname(ancestor);
  const actual=path.resolve(await realpath(ancestor),path.relative(ancestor,target));
  if(within(root,actual)||within(actual,root)) throw new Error('Destination must be separate from source');
  if(resume) {
    assertIsolatedDestination(path.join(actual,`.guard-${Date.now()}`));
    async function checkTree(dir) {for(const name of await readdir(dir)) {const file=path.join(dir,name),info=await lstat(file);if(info.isSymbolicLink()||(!info.isFile()&&!info.isDirectory())) throw new Error('Resume tree contains a symbolic link or special file');if(info.isDirectory()) await checkTree(file);}}
    await checkTree(actual);
    const marker=JSON.parse(await readFile(path.join(actual,'batch-source.json'),'utf8'));
    if(marker.sourceRoot!==root || marker.format!=='notes-library/1') throw new Error('Resume source does not match managed migration');
  } else { assertIsolatedDestination(actual); await mkdir(actual,{recursive:true}); await writeFile(path.join(actual,'batch-source.json'),JSON.stringify({format:'notes-library/1',sourceRoot:root}),{flag:'wx'}); }
  const files=[], skipped=[];
  async function scan(dir) { for(const ent of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const full=path.join(dir,ent.name); if(ent.isSymbolicLink()) { skipped.push({path:portable(path.relative(root,full)),code:'SYMLINK_SKIPPED'}); continue; }
    if(ent.isDirectory()) await scan(full); else if(/\.md$/i.test(ent.name)) files.push(full);
    if(files.length>10000) throw new Error('Inventory limit exceeded');
  } }
  await scan(root);
  const media=createMediaManager(path.join(actual,'media'));
  const store=openHtmlStore(path.join(actual,'notes.sqlite'),{hooks:media.hooks}); media.attach(store.db);
  store.db.exec('CREATE TABLE IF NOT EXISTS legacy_urls (url TEXT PRIMARY KEY,note_id TEXT NOT NULL,source_path TEXT NOT NULL);');
  const items=files.map(file=>{const relative=portable(path.relative(root,file));const sourceKey=`legacy-file:${relative}`; const prior=store.db.prepare('SELECT note_id FROM html_import_sources WHERE source_key=?').get(sourceKey);return {file,path:relative,sourceKey,id:prior?.note_id||sha256(relative).slice(0,32),resources:[],links:[]};});
  const byFile=new Map(items.map(i=>[i.file,i])), byUrl=new Map();
  const report={format:'notes-library-migration/1',sourceRoot:root,destination:actual,catalogProvenance:catalog.provenance||null,items:[],skipped};
  try {
    await pool(items,async item=>{try {
      if((await stat(item.file)).size>1900000) throw new Error('INPUT_TOO_LARGE');
      item.bytes=await readFile(item.file); item.originalHash=sha256(item.bytes);
      const archive=writeArchive(store.archiveDir,item.bytes);item.inventoryArchiveId=`inventory-${sha256(item.sourceKey+item.originalHash)}`;
      store.db.prepare('INSERT OR IGNORE INTO source_archives VALUES (?,?,?,?,?,?)').run(item.inventoryArchiveId,archive.sha256,archive.byte_length,item.path,'legacy-original-inventory',new Date().toISOString());
      item.preliminary=await convertMarkdown(item.bytes,{filename:path.basename(item.file)});
      item.catalog=catalog.entries?.[item.path];
      if(item.catalog?.originalHash && item.catalog.originalHash!==item.originalHash) throw new Error('CATALOG_SOURCE_HASH_MISMATCH');
      item.oldUrl=item.catalog?.oldUrl||null;
      item.anchorMap={}; const old=item.catalog?.headings||[], fresh=item.preliminary.headings||[];
      for(let i=0;i<old.length;i++) if(fresh[i] && old[i].text===fresh[i].text && old[i].depth===fresh[i].level) item.anchorMap[old[i].slug]=fresh[i].id;
    } catch(e) {item.failure=e.message;} });
    for(const item of items) if(item.oldUrl) {
      const duplicates=items.filter(i=>i.oldUrl===item.oldUrl);
      const prior=store.db.prepare('SELECT source_path FROM legacy_urls WHERE url=?').get(item.oldUrl);
      if(duplicates.length>1 || (prior&&prior.source_path!==item.path)) {for(const entry of duplicates) entry.failure='LEGACY_URL_COLLISION';}
      else if(!item.failure) byUrl.set(item.oldUrl,item);
    }
    await pool(items,async item=>{
      const diagnostics=[];
      try {
        if(item.failure) throw new Error(item.failure);
        const mediaMap={},articleMap={};
        const refs=await runContentJob('references',item.bytes); diagnostics.push(...(refs.diagnostics||[]));
        for(const ref of refs.references||[]) {
          const record={kind:ref.kind,url:ref.url}; (ref.kind==='image'?item.resources:item.links).push(record);
          if(ref.url.startsWith('#')) {
            let anchor;try {anchor=item.anchorMap[decodeURIComponent(ref.url.slice(1))]||(item.preliminary.headings||[]).find(h=>h.id===ref.url.slice(1))?.id;}catch{}
            if(anchor) {articleMap[ref.url]=`#${anchor}`;Object.assign(record,{status:'mapped',target:`#${anchor}`,targetSource:item.path});}
            else {record.status='unresolved';record.code='OLD_ANCHOR_UNRESOLVED';diagnostics.push(diagnostic(record.code,`Missing local anchor: ${ref.url}`));}
            continue;
          }
          let local=ref.url;
          if(/^https?:/i.test(local)) { const url=new URL(local); if(url.hostname==='sunjiao.me') local=url.pathname+url.hash; else {record.status='external-not-fetched';continue;} }
          else if(/^mailto:/i.test(local)) {record.status='external-not-fetched';continue;}
          try {
            const [pathname,fragment]=local.split('#'); let linked=byUrl.get(decodeURIComponent(pathname)), resource;
            if(!linked) {resource=await resolveResource(root,item.file,pathname);linked=byFile.get(resource);}
            if(ref.kind==='link' && linked) {
              if(linked.failure || linked.preliminary?.status==='rejected') throw new Error('LINK_TARGET_NOT_IMPORTED');
              let suffix=''; if(fragment) {const anchor=linked.anchorMap[decodeURIComponent(fragment)]; if(!anchor) throw new Error('OLD_ANCHOR_UNRESOLVED'); suffix=`#${anchor}`;}
              articleMap[ref.url]=`/notes/${linked.id}${suffix}`; Object.assign(record,{status:'mapped',target:articleMap[ref.url],targetSource:linked.path});
            } else {
              if(!resource) throw new Error('RESOURCE_KIND_MISMATCH');
              if((await stat(resource)).size>10*1024*1024) throw new Error('MEDIA_LIMIT');
              const saved=media.upload(await readFile(resource),path.basename(resource));
              if(ref.kind==='image' && saved.kind!=='image') throw new Error('RESOURCE_KIND_MISMATCH');
              (ref.kind==='image'?mediaMap:articleMap)[ref.url]=saved.url; Object.assign(record,{status:'mapped',target:saved.url,sha256:saved.id,bytes:saved.byte_length});
            }
          } catch(e) {record.status='unresolved';record.code=e.code||e.message;diagnostics.push(diagnostic(record.code,`Resource unresolved: ${ref.url}`));}
        }
        let result=await convertMarkdown(item.bytes,{filename:path.basename(item.file),mediaMap,articleMap});
        if(!item.catalog) diagnostics.push(diagnostic('LEGACY_METADATA_UNAVAILABLE','No verified old-site metadata and URL catalog entry'));
        result.diagnostics.push(...diagnostics);if(diagnostics.length && result.status!=='rejected') result.status='review_required';
        if(result.status==='rejected') throw Object.assign(new Error('CONVERSION_REJECTED'),{diagnostics:result.diagnostics});
        result=await renderHtml(result);
        if(sha256(await readFile(item.file))!==item.originalHash) throw new Error('SOURCE_CHANGED_DURING_MIGRATION');
        const metadata=item.catalog?.metadata||result.metadata;
        const imported=store.importSource({id:item.id,sourceKey:item.sourceKey,bytes:item.bytes,filename:item.path,sourceKind:'legacy-markdown-original',result,title:metadata.title,description:metadata.description||'',category:metadata.category||'',tags:metadata.tags||[],sourceMetadata:{...result.metadata.sourceMetadata,legacySite:metadata,legacyUrl:item.oldUrl,relativePath:item.path,metadataProvenance:item.catalog?.provenance||null}});
        const note=imported.note;
        if(sha256(store.readArchive(note.source_archive_id).bytes)!==item.originalHash) throw new Error('ARCHIVE_RECONCILIATION_FAILED');
        if(item.oldUrl) store.db.prepare('INSERT INTO legacy_urls VALUES (?,?,?) ON CONFLICT(url) DO UPDATE SET note_id=excluded.note_id,source_path=excluded.source_path').run(item.oldUrl,note.id,item.path);
        Object.assign(item,{status:imported.unchanged?'unchanged':'imported',noteId:note.id,revisionId:note.draft_revision_id,archiveId:note.source_archive_id,conversionStatus:note.status,renderStatus:note.render_status,publishable:note.publishable,diagnostics:note.diagnostics,metadata:{title:note.title,description:note.description,category:note.category,tags:note.tags,legacySite:note.source_metadata.legacySite},archiveVerified:true});
      } catch(e) {Object.assign(item,{status:e.code==='SOURCE_CONFLICT'?'conflict':'failed',code:e.code||e.message,diagnostics:e.diagnostics||diagnostics,message:e.message});}
      onProgress({path:item.path,status:item.status});
      const {bytes,preliminary,catalog:entry,file,...safe}=item;
      report.items.push(safe);
      await writeFile(path.join(actual,`item-${item.id}.json`),JSON.stringify(safe,null,2));
    });
    report.items.sort((a,b)=>a.path.localeCompare(b.path));
    for(const item of report.items) for(const link of item.links) if(link.targetSource) {
      const targetItem=items.find(i=>i.path===link.targetSource);
      if(!targetItem||!store.get(targetItem.id)) {link.status='unresolved';link.code='LINK_TARGET_NOT_IMPORTED';item.diagnostics.push(diagnostic(link.code,`Target unavailable: ${link.targetSource}`));}
    }
    for(const item of report.items) {
      if(item.noteId && item.links.some(link=>link.code==='LINK_TARGET_NOT_IMPORTED')) {
        const note=store.get(item.noteId);
        if(item.status==='imported' && note.draft_revision_id===item.revisionId && note.publishable) {
          const guarded=store.save(note.id,{version:note.version,result:{schemaVersion:note.schema_version,versions:note.versions,htmlSource:note.html_source,htmlRendered:note.html_rendered,sourceHash:note.source_hash,status:'review_required',renderStatus:note.render_status,publishable:false,diagnostics:item.diagnostics,headings:note.headings}});
          Object.assign(item,{revisionId:guarded.draft_revision_id,conversionStatus:guarded.status,publishable:false,diagnostics:guarded.diagnostics});
          // A crash before this CAS remains conservative (future changed sources
          // conflict); it can never authorize overwriting an online revision.
          store.db.prepare('UPDATE html_import_sources SET imported_revision_id=? WHERE source_key=? AND imported_revision_id=?').run(guarded.draft_revision_id,item.sourceKey,note.draft_revision_id);
        }
      }
      await writeFile(path.join(actual,`item-${item.id}.json`),JSON.stringify(item,null,2));
    }
    report.totals={sourceFiles:items.length,imported:0,unchanged:0,failed:0,conflict:0,reviewRequired:0,resources:0,unresolvedResources:0,links:0,unresolvedLinks:0};
    for(const i of report.items) {report.totals[i.status]++; if(i.conversionStatus!=='ready'||i.renderStatus!=='ready'||!i.publishable||i.diagnostics?.some(d=>d.blocksPublishing)) report.totals.reviewRequired++;report.totals.resources+=i.resources.length;report.totals.unresolvedResources+=i.resources.filter(r=>r.status==='unresolved').length;report.totals.links+=i.links.length;report.totals.unresolvedLinks+=i.links.filter(r=>r.status==='unresolved').length;}
    report.htmlNotes=store.list().length; report.publishedNotes=store.publicList().length;
    await writeFile(path.join(actual,`migration-report-${Date.now()}.json`),JSON.stringify(report,null,2),{flag:'wx'});
    return report;
  } finally {store.close();}
}
