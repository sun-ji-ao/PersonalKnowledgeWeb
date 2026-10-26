import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { openHtmlStore } from '../lib/html-store.mjs';
import { sha256 } from '../lib/source-archive.mjs';
import { createJointBackup, restoreJointBackup } from '../lib/html-backup.mjs';
import { assertIsolatedDestination } from '../lib/html-migration.mjs';
const [sourceRoot,libraryDir,mvpDir,catalogFile,output]=process.argv.slice(2);
try {
  if(!output) throw new Error('Usage: node scripts/verify-batch-migration.mjs SOURCE LIBRARY_DIR MVP_DIR CATALOG_JSON NEW_REPORT');
  const catalog=JSON.parse(await readFile(catalogFile,'utf8')),report={format:'notes-batch-verification/1',library:{},mvp:{}};
  for(const [name,dir] of [['library',libraryDir],['mvp',mvpDir]]) {
    assertIsolatedDestination(path.join(dir,'.verification-guard'));
    const store=openHtmlStore(path.join(dir,'notes.sqlite'));
    const before=store.db.prepare('SELECT count(*) AS n FROM content_revisions').get().n;
    const ids=store.list().map(n=>n.id).sort();
    report[name].notes=ids.length; report[name].revisions=before;
    if(name==='library') {
      let unchanged=0,archives=0,metadata=0;
      for(const source of store.db.prepare('SELECT * FROM html_import_sources').all()) {
        const relative=source.source_key.slice('legacy-file:'.length),bytes=await readFile(path.join(sourceRoot,relative));
        assert.equal(sha256(bytes),source.original_hash);assert.equal(sha256(bytes),catalog.entries[relative].originalHash);
        const current=store.get(source.note_id);assert.match(current.id,/^[a-f0-9-]+$/);assert.deepEqual(store.readArchive(current.source_archive_id).bytes,bytes);archives++;
        const old=catalog.entries[relative].metadata;
        assert.equal(current.title,old.title);assert.equal(current.description,old.description||'');assert.equal(current.category,old.category||'');assert.deepEqual(current.tags,old.tags||[]);assert.deepEqual(current.source_metadata.legacySite,old);metadata++;
        assert.equal(store.importSource({sourceKey:source.source_key,bytes}).unchanged,true);unchanged++;
      }
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM content_revisions').get().n,before);
      report.library={...report.library,unchangedImports:unchanged,archivesVerified:archives,metadataVerified:metadata,published:store.publicList().length,legacyUrls:store.db.prepare('SELECT count(*) AS n FROM legacy_urls').get().n,registeredArchives:store.db.prepare('SELECT count(*) AS n FROM source_archives').get().n,allIdsRouteCompatible:true};
    } else {
      report.mvp.items=[];
      for(const row of store.db.prepare('SELECT * FROM notes').all()) {
        const note=store.get(row.id);assert.ok(note);assert.equal(note.title,row.title);assert.deepEqual(store.readArchive(note.source_archive_id).bytes,Buffer.from(row.markdown));
        assert.equal(!!note.published,!!row.published_at);
        if(note.published) {assert.notEqual(note.draft_revision_id,note.published_revision_id);assert.equal(note.published.title,row.published_title);assert.deepEqual(store.readArchive(note.published.source_archive_id).bytes,Buffer.from(row.published_markdown));}
        report.mvp.items.push({id:row.id,draftRevision:note.draft_revision_id,publishedRevision:note.published_revision_id,draftTextHash:sha256(row.markdown),publishedTextHash:row.published_markdown==null?null:sha256(row.published_markdown),separateSnapshots:true,archiveProvenance:'UTF-8 encoding of database text, not original upload bytes'});
      }
    }
    store.close();
    const backupDir=assertIsolatedDestination(`${dir}-backup`),restoredDir=assertIsolatedDestination(`${dir}-restored`);
    await createJointBackup({dbPath:path.join(dir,'notes.sqlite'),archiveDir:path.join(dir,'source-archives'),mediaDir:path.join(dir,'media'),destination:backupDir});
    const restored=restoreJointBackup({backupDir,destination:restoredDir});
    const db=new DatabaseSync(restored.dbPath,{readOnly:true});assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('SELECT id FROM html_notes ORDER BY id').all().map(x=>x.id),ids);assert.equal(db.prepare('SELECT count(*) AS n FROM content_revisions').get().n,before);db.close();
    report[name].jointRecovery={backupDir,restoredDir,integrity:'ok',notes:ids.length,revisions:before};
  }
  await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2));
}catch(e){console.error(e.stack);process.exitCode=1;}
