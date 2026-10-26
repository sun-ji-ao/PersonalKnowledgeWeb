import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { openHtmlStore } from '../lib/html-store.mjs';
import { normalizeHtml, renderHtml } from '../lib/html-content.mjs';

const app = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function directory() {
  const dir = await mkdtemp(path.join(tmpdir(), 'notes-public-'));
  return dir;
}
async function cleanup(dir) { assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(dir).startsWith('notes-public-')); await rm(dir, { recursive:true,force:true }); }

test('HTML publication CAS and extension failure roll back snapshot/version atomically', async t => {
  const dir = await directory(t); let fail = false;
  const store = openHtmlStore(path.join(dir,'notes.sqlite'), { hooks: { onPublishedChange: () => { if (fail) throw new Error('index failure'); } } });
  t.after(async () => { store.close(); await cleanup(dir); });
  const result = await renderHtml(await normalizeHtml('<h2>Public body</h2>'));
  let note = store.create({ title:'Public title', tags:['visible'], result, sourceMetadata:{ secret:'ARCHIVE_SECRET' } });
  const initialVersion = note.version;
  assert.equal(store.publicGet(note.id), null);
  assert.throws(() => store.publish(note.id,note.version,{sourceHash:'wrong'}), e=>e.code==='REVISION_CONFLICT');
  note = store.publish(note.id,note.version,{revisionId:note.revision_id,sourceHash:note.source_hash});
  assert.equal(note.version,initialVersion+1);
  const published = store.publicGet(note.id);
  assert.doesNotMatch(JSON.stringify(published), /ARCHIVE_SECRET|html_source|source_archive|source_metadata|draft_revision|versions/);
  assert.throws(() => store.unpublish(note.id,initialVersion),e=>e.code==='VERSION_CONFLICT');
  note = store.save(note.id,{version:note.version,title:'Private draft',result});
  fail=true;
  assert.throws(()=>store.publish(note.id,note.version),/index failure/);
  assert.deepEqual(store.publicGet(note.id),published); assert.equal(store.get(note.id).version,note.version);
  assert.throws(()=>store.unpublish(note.id,note.version),/index failure/);
  assert.deepEqual(store.publicGet(note.id),published); assert.equal(store.get(note.id).version,note.version);
  fail=false; note=store.unpublish(note.id,note.version);
  assert.equal(store.publicGet(note.id),null); assert.deepEqual(store.publicList(),[]);
  assert.throws(()=>store.publish(note.id,note.version-1),e=>e.code==='VERSION_CONFLICT');
});

test('HTML HTTP publish/edit/failed render/restart/republish/withdraw preserve public boundary', async t => {
  const dir=await directory(t), socket=createServer(); socket.listen(0,'127.0.0.1'); await once(socket,'listening'); const port=socket.address().port; await new Promise(resolve=>socket.close(resolve));
  const origin=`http://127.0.0.1:${port}`; let child,cookie='';
  async function stop() { if(child && child.exitCode===null) {const done=once(child,'exit');child.kill();await done;} }
  t.after(async () => { await stop(); await cleanup(dir); });
  async function start() {
    child=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...process.env,HTML_EDITOR:'1',DATA_DIR:dir,PORT:String(port),SEED_DEMO:'0',ADMIN_PASSWORD:'Publication-test-password'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    let logs=''; child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
    for(let i=0;i<100;i++) {if(child.exitCode!==null)throw new Error(logs);try {if((await fetch(origin)).ok)return;}catch{} await new Promise(r=>setTimeout(r,75));}throw new Error(logs);
  }
  const request=(route,method='GET',input,auth=true)=>fetch(origin+route,{method,headers:{...(auth&&cookie?{Cookie:cookie}:{}),...(input!==undefined?{'Content-Type':'application/json',Origin:origin}:{})},body:input===undefined?undefined:JSON.stringify(input)});
  async function login(){const response=await request('/api/login','POST',{password:'Publication-test-password'});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];}
  await start();await login();
  const html='<h2>Visible heading</h2><p>VISIBLE_BODY</p><pre><code class="language-javascript">const value = 1;\n</code></pre><span data-note-kind="math-inline">x^2</span><pre data-note-kind="mermaid"><code>flowchart LR\n A--&gt;B\n</code></pre>';
  let response=await request('/api/html/notes','POST',{title:'Visible title',description:'Visible description',tags:['visible'],htmlSource:html});assert.equal(response.status,201);let note=await response.json();
  const route=`/api/html/notes/${note.id}`, publicRoute=`/api/public/notes/${note.id}`;
  assert.equal((await request(`/notes/${note.id}`,'GET',undefined,false)).status,404);
  assert.equal((await request(route+'/publish','POST',{version:note.version},false)).status,401);
  assert.equal((await request(route+'/publish','POST',{version:note.version})).status,400);
  const publish=()=>request(route+'/publish','POST',{version:note.version,revisionId:note.revision_id,sourceHash:note.source_hash});
  response=await publish();assert.equal(response.status,200);note=await response.json();
  const dto=await (await request(publicRoute,'GET',undefined,false)).json();
  assert.equal(dto.revision_id,note.revision_id);assert.match(dto.html_rendered,/class="mermaid"/);assert.match(dto.html_rendered,/katex/);assert.match(dto.html_rendered,/shiki/);
  const page=await (await request(`/notes/${note.id}`,'GET',undefined,false)).text();assert.match(page,/Visible heading/);assert.match(page,/href="#section-1"/);
  response=await request(route,'PUT',{version:note.version,title:'DRAFT_SECRET',description:'DRAFT_DESC',tags:['DRAFT_TAG'],htmlSource:'<h2>SECRET_HEADING</h2><p>SECRET_BODY</p><pre data-note-kind="mermaid"><code>not a valid diagram</code></pre>'});assert.equal(response.status,200);note=await response.json();assert.equal(note.publishable,false);
  assert.equal((await publish()).status,422);
  assert.deepEqual(await (await request(publicRoute,'GET',undefined,false)).json(),dto);
  for(const path of ['/',`/notes/${note.id}`,publicRoute,publicRoute+'/export']) {
    const output=await(await request(path,'GET',undefined,false)).text();assert.doesNotMatch(output,/DRAFT_SECRET|DRAFT_DESC|DRAFT_TAG|SECRET_HEADING|SECRET_BODY|source_archive_id|html_source/);
  }
  assert.match(await(await request(route+'/export')).text(),/SECRET_BODY/);
  assert.equal((await request(route+'/export','GET',undefined,false)).status,401);
  assert.equal((await request(route+'/history','GET',undefined,false)).status,401);
  await stop();cookie='';await start();await login();
  assert.deepEqual(await(await request(publicRoute,'GET',undefined,false)).json(),dto);
  note=await(await request(route)).json();response=await request(route,'PUT',{version:note.version,title:'Next public',description:'Next',tags:['next'],htmlSource:'<p>NEXT_BODY</p>'});note=await response.json();response=await publish();assert.equal(response.status,200);note=await response.json();
  assert.match(await(await request(publicRoute+'/export','GET',undefined,false)).text(),/NEXT_BODY/);
  assert.equal((await request(route+'/unpublish','POST',{version:note.version-1})).status,409);
  response=await request(route+'/unpublish','POST',{version:note.version});assert.equal(response.status,200);
  for(const path of [`/notes/${note.id}`,publicRoute,publicRoute+'/export']) assert.equal((await request(path,'GET',undefined,false)).status,404);
  assert.deepEqual(await(await request('/api/public/notes','GET',undefined,false)).json(),[]);
  const readerSource=await readFile(path.join(app,'lib/html-public.mjs'),'utf8');assert.doesNotMatch(readerSource,/renderMarkdown|convertMarkdown/);
});
