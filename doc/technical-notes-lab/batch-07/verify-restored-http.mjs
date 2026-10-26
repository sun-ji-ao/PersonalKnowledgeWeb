import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../../../technical-notes-lab');
const restored = path.join(app, '.test-data/batch-07-library-final-restored');
const report = JSON.parse(fs.readFileSync(path.join(here, 'migration-library-final.json'), 'utf8'));
const sample = report.items.find(item => item.publishable);
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const password = randomUUID();
const child = spawn(process.execPath, ['server.mjs'], {cwd:app, windowsHide:true, stdio:['ignore','pipe','pipe'], env:{...process.env, HTML_EDITOR:'1', SEED_DEMO:'0', PORT:String(port), ADMIN_PASSWORD:password,
  DATA_DIR:path.join(app, 'tmp/batch-07-http-runtime'), HTML_DB_PATH:path.join(restored, 'notes.sqlite'), HTML_ARCHIVE_DIR:path.join(restored, 'source-archives'), HTML_MEDIA_DIR:path.join(restored, 'media')}});
let logs = ''; child.stdout.on('data', data => {logs += data;}); child.stderr.on('data', data => {logs += data;});
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try {if ((await fetch(origin)).ok) {ready = true; break;}} catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'isolated restored server started');
  const route = `/api/html/notes/${sample.noteId}`;
  assert.equal((await fetch(origin + route)).status, 401);
  assert.equal((await fetch(origin + `/notes/${sample.noteId}`)).status, 404);
  const login = await fetch(origin + '/api/login', {method:'POST', headers:{'Content-Type':'application/json', Origin:origin}, body:JSON.stringify({password})});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(origin + route, {headers:{Cookie:cookie}});
  assert.equal(response.status, 200);
  const note = await response.json();
  assert.equal(note.id, sample.noteId); assert.equal(note.draft_revision_id, sample.revisionId); assert.ok(note.html_source.length);
  const list = await (await fetch(origin + '/api/html/notes', {headers:{Cookie:cookie}})).json();
  assert.equal(list.length, 253);
  assert.deepEqual(await (await fetch(origin + '/api/public/notes')).json(), []);
  const result = {checkedAt:new Date().toISOString(), mode:'HTTP-interface-only-not-browser', restoredLibrary:restored, authenticatedArticleStatus:200, privateListCount:253, anonymousPrivateStatus:401, anonymousArticleStatus:404, publicListCount:0};
  fs.writeFileSync(path.join(here, 'restored-http-check.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result, null, 2));
} finally {
  if (child.exitCode === null) {const exited = once(child, 'exit'); child.kill(); await exited;}
}
