import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openHtmlStore } from '../lib/html-store.mjs';
import { normalizeHtml, renderHtml, convertMarkdown } from '../lib/html-content.mjs';
import { createMediaManager, inspectMedia, MEDIA_LIMIT } from '../lib/html-media.mjs';
import { discover, discoveryFacets, rssFeed, sitemap, createDiscoveryIndex } from '../lib/html-discovery.mjs';
import { createJointBackup, restoreJointBackup } from '../lib/html-backup.mjs';
const png = readFileSync(new URL('../../doc/technical-notes-lab/batch-06/browser-fixtures/architecture.png',import.meta.url));
const converted = async html => renderHtml(await normalizeHtml(html));
function setup(t) { const root = mkdtempSync(path.join(os.tmpdir(),'notes-media-')), media = createMediaManager(path.join(root,'media')), store = openHtmlStore(path.join(root,'notes.sqlite'),{hooks:media.hooks}); media.attach(store.db); t.after(() => { store.close(); rmSync(root,{recursive:true,force:true}); }); return {root,media,store}; }

test('media detects real raster bytes, rejects spoofed/truncated files and limits', () => {
  assert.equal(inspectMedia(png,'diagram.png').mime,'image/png');
  assert.throws(() => inspectMedia(Buffer.from('<script>alert(1)</script>'),'fake.png'),/真实图片/);
  assert.throws(() => inspectMedia(png.subarray(0,png.length-2),'image.png'),/PNG/);
  assert.throws(() => inspectMedia(Buffer.from('474946383961010001000000003b','hex'),'fake.gif'),/帧/);
  const fakeWebp = Buffer.alloc(30); fakeWebp.write('RIFF'); fakeWebp.writeUInt32LE(22,4); fakeWebp.write('WEBPVP8X',8); fakeWebp.writeUInt32LE(10,16);
  assert.throws(() => inspectMedia(fakeWebp,'fake.webp'),/图像数据/);
  assert.throws(() => inspectMedia(Buffer.alloc(MEDIA_LIMIT+1),'large.bin'),e => e.status === 413);
  assert.equal(inspectMedia(Buffer.from('<html><script>alert(1)</script></html>'),'page.html').kind,'attachment');
});

test('content addressing, draft privacy, publish references, replacement CAS and immediate withdrawal', async t => {
  const {media,store} = setup(t), first = media.upload(png,'image.png'), file = media.upload(Buffer.from('<html>inert attachment</html>'),'page.html');
  assert.equal(media.upload(png,'same.png').id,first.id);
  assert.throws(() => media.upload(png,'../image.png'),/文件名/);
  assert.throws(() => media.publicRead(first.id),e => e.status === 404);
  let note = store.create({result:await converted(`<p>公开图片</p><img src="${first.url}" alt="图"><a href="${file.url}">附件</a>`)});
  assert.throws(() => media.publicRead(file.id),e => e.status === 404);
  note = store.publish(note.id,note.version); const publishedId = note.revision_id;
  assert.deepEqual(media.publicRead(first.id).bytes,png);
  const next = media.upload(Buffer.from('new private attachment'),'new.txt');
  note = await media.replace(store,note.id,{version:note.version,oldMediaId:file.id,mediaId:next.id});
  assert.equal(store.publicGet(note.id).revision_id,publishedId); assert.throws(() => media.publicRead(next.id),e => e.status === 404);
  assert.equal(media.publicRead(file.id).kind,'attachment');
  await assert.rejects(media.replace(store,note.id,{version:1,oldMediaId:file.id,mediaId:next.id}),e => e.status === 409);
  note = store.publish(note.id,note.version); assert.throws(() => media.publicRead(file.id),e => e.status === 404); assert.equal(media.publicRead(next.id).kind,'attachment');
  store.unpublish(note.id,note.version); assert.throws(() => media.publicRead(first.id),e => e.status === 404); assert.throws(() => media.publicRead(next.id),e => e.status === 404);
});

test('missing media repair creates new draft without reading a local path or mutating history', async t => {
  const {media,store} = setup(t), result = await renderHtml(await convertMarkdown(Buffer.from('# 缺图\n\n![示意图](../../private.png)')));
  let note = store.create({result}), previous = note.revision_id;
  assert.equal(media.listFor(note).missing[0].path,'../../private.png');
  assert.throws(() => store.publish(note.id,note.version),e => e.status === 422);
  const upload = media.upload(png,'repair.png'); note = await media.replace(store,note.id,{version:note.version,missingPath:'../../private.png',mediaId:upload.id});
  assert.equal(media.listFor(note).missing.length,0); assert.match(store.getRevision(note.id,previous).html_source,/missing-media/);
  assert.notEqual(note.revision_id,previous); store.publish(note.id,note.version); assert.equal(media.publicRead(upload.id).mime,'image/png');
  const bad = store.create({result:await converted('<img src="/media/does-not-exist" alt="missing">')});
  assert.throws(() => store.publish(bad.id,bad.version),e => e.status === 404);
});

test('joint backups require and verify every media blob on backup and restore', async t => {
  const {root,media,store} = setup(t), upload = media.upload(png,'image.png');
  store.create({result:await converted(`<img src="${upload.url}" alt="图">`)});
  await assert.rejects(createJointBackup({dbPath:path.join(root,'notes.sqlite'),archiveDir:store.archiveDir,destination:path.join(root,'no-media')}),/Media directory/);
  const backupDir = path.join(root,'backup'); await createJointBackup({dbPath:path.join(root,'notes.sqlite'),archiveDir:store.archiveDir,mediaDir:media.mediaDir,destination:backupDir});
  const restored = restoreJointBackup({backupDir,destination:path.join(root,'restore')}); assert.deepEqual(readFileSync(path.join(restored.mediaDir,`${upload.id}.bin`)),png);
  const manifestPath = path.join(backupDir,'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath)); manifest.files = manifest.files.filter(f => !f.path.startsWith('media/')); writeFileSync(manifestPath,JSON.stringify(manifest));
  assert.throws(() => restoreJointBackup({backupDir,destination:path.join(root,'missing')}),/referenced media/);
});

test('Unicode literal full-text search and XML feeds use only current published DTOs', async t => {
  const {store} = setup(t); let note = store.create({title:'事务<&"',tags:['SQLite','标签&'],result:await converted('<p>青竹事务：中文全文检索，std::vector&lt;T&gt;。</p>')});
  const secret = store.create({title:'机密草稿',result:await converted('<p>不可公开</p>')});
  assert.deepEqual(discover(store.publicList(),{q:'事务'}),[]);
  note = store.publish(note.id,note.version); const original = note.html_source;
  assert.equal(discover(store.publicList(),{q:'竹事务 SQLite'}).length,1); assert.equal(discover(store.publicList(),{q:'std::vector<T>'}).length,1);
  assert.equal(discover(store.publicList(),{q:"' OR 1=1 --"}).length,0); assert.equal(discover(store.publicList(),{q:'*'}).length,0);
  note = store.save(note.id,{version:note.version,title:'私有新标题',result:await converted('<p>私有新正文</p>')});
  assert.equal(discover(store.publicList(),{q:'私有'}).length,0); assert.equal(discover(store.publicList(),{tag:'SQLite'}).length,1);
  assert.ok(discoveryFacets(store.publicList()).tags.includes('SQLite'));
  const rss = rssFeed(store.publicList(),'http://127.0.0.1:4315'), map = sitemap(store.publicList(),'http://127.0.0.1:4315');
  assert.match(rss,/事务&lt;&amp;&quot;/); assert.doesNotMatch(rss,/机密|私有/); assert.ok(!map.includes(secret.id));
  assert.equal(store.getRevision(note.id,note.published_revision_id).html_source,original);
  store.unpublish(note.id,note.version); assert.equal(discover(store.publicList()).length,0); assert.ok(!sitemap(store.publicList(),'http://localhost').includes(note.id));
});

test('category snapshots and persistent source-text index preserve Chinese inline phrases and semantic source', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(),'notes-search-')), index = createDiscoveryIndex(), store = openHtmlStore(path.join(root,'notes.sqlite'),{hooks:index.hooks}); index.attach(store.db);
  t.after(() => { store.close(); rmSync(root,{recursive:true,force:true}); });
  let note = store.create({category:'数据库',tags:['SQLite'],result:await converted('<p>中文<strong>连续</strong>搜索</p><div data-note-kind="math-block">\\alpha + \\beta</div><pre data-note-kind="mermaid"><code>flowchart LR\n A--&gt;B\n</code></pre>')});
  const source = note.html_source; note = store.publish(note.id,note.version); const published = note.revision_id;
  assert.equal(index.search(store.publicList(),{q:'中文连续搜索',category:'数据库'}).length,1);
  assert.equal(index.search(store.publicList(),{q:'\\alpha'}).length,1); assert.equal(index.search(store.publicList(),{q:'flowchart LR'}).length,1);
  note = store.save(note.id,{version:note.version,category:'私密分类',result:await converted('<p>私有正文</p>')});
  assert.equal(index.search(store.publicList(),{category:'私密分类'}).length,0); assert.equal(store.publicGet(note.id).category,'数据库');
  assert.equal(store.getRevision(note.id,published).html_source,source);
  const restored = store.restore(note.id,published,note.version); assert.equal(restored.category,'数据库');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM revision_search').get().count,3);
});

test('search separates table and disclosure boundaries and rebuilds old indexes atomically', async t => {
  const {store} = setup(t);
  let note = store.create({result:await converted('<table><tbody><tr><td>中文</td><td>连续</td></tr></tbody></table><details><summary>概览</summary><p>正文<strong>连续</strong>搜索</p></details>')});
  note = store.publish(note.id,note.version);
  const before = store.get(note.id);
  store.db.exec('CREATE TABLE revision_search (revision_id TEXT PRIMARY KEY REFERENCES content_revisions(id), plain_text TEXT NOT NULL)');
  store.db.prepare('INSERT INTO revision_search VALUES (?,?)').run(note.revision_id,'中文连续概览正文连续搜索');
  store.db.exec("CREATE TRIGGER fail_search BEFORE UPDATE ON revision_search BEGIN SELECT RAISE(ABORT, 'injected-index-failure'); END");
  const index = createDiscoveryIndex();
  assert.throws(() => index.attach(store.db), /injected-index-failure/);
  assert.equal(store.db.prepare('PRAGMA table_info(revision_search)').all().length,2,'failed rebuild rolls back schema upgrade');
  assert.equal(store.db.prepare('SELECT plain_text FROM revision_search').get().plain_text,'中文连续概览正文连续搜索');
  assert.deepEqual(store.get(note.id),before);
  store.db.exec('DROP TRIGGER fail_search'); index.attach(store.db);
  assert.equal(index.search(store.publicList(),{q:'中文连续'}).length,0,'separate cells are not one phrase');
  assert.equal(index.search(store.publicList(),{q:'概览正文'}).length,0,'summary and body are separate');
  assert.equal(index.search(store.publicList(),{q:'正文连续搜索'}).length,1,'inline marks preserve continuous phrases');
  assert.equal(index.search(store.publicList(),{q:'中文 连续'}).length,1);
  assert.equal(store.db.prepare('SELECT extractor_version FROM revision_search').get().extractor_version,2);
  assert.deepEqual(store.get(note.id),before,'source, hash, revisions and publication remain byte-for-byte unchanged');
  index.attach(store.db); assert.deepEqual(store.get(note.id),before);
});
