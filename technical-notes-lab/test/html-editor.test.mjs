import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { htmlEditorView } from '../lib/views.mjs';
import { schema, parseSource, serializeSource, sourceEquivalent } from '../public/html-schema.js';
import { convertMarkdown, normalizeHtml } from '../lib/html-content.mjs';
import { EditorState } from 'prosemirror-state';

test('editor equivalence tolerates mark order but rejects semantic/attribute/source loss', () => {
  const { document } = new JSDOM('').window;
  assert.ok(sourceEquivalent('<p><em><strong>x</strong></em></p>', '<p><strong><em>x</em></strong></p>', document));
  for (const [a,b] of [
    ['<p><em>x</em></p>','<p>x</p>'],
    ['<h2 id="section-4">x</h2>','<h2>x</h2>'],
    ['<pre><code class="language-cpp"> x\n</code></pre>','<pre><code class="language-cpp">x\n</code></pre>'],
    ['<span data-note-kind="math-inline">x^2</span>','<span>x^2</span>'],
    ['<p><a href="https://example.com">x</a></p>','<p><a href="https://wrong.example">x</a></p>'],
  ]) assert.equal(sourceEquivalent(a,b,document),false);
  assert.throws(() => parseSource('<section>unknown</section>',document), /无法安全编辑/);
});

test('long-form model edits keep every heading ID, code source and language on reopen', async () => {
  const bytes = await readFile(new URL('../../doc/technical-notes-lab/batch-04/browser-fixtures/longform.md', import.meta.url));
  const converted = await convertMarkdown(bytes,{filename:'longform.md'}); assert.ok(converted.htmlSource);
  const { document } = new JSDOM('').window, started = performance.now();
  let doc = parseSource(converted.htmlSource,document), state = EditorState.create({schema,doc});
  const blocks = []; doc.descendants((node,pos) => { if(node.type.name==='paragraph' && !blocks.length) blocks.push(pos); });
  state = state.apply(state.tr.insertText('编辑器长文测试。',blocks[0]+1));
  const output = await normalizeHtml(serializeSource(state.doc,document));
  doc = parseSource(output.htmlSource,document);
  const collect = value => { const result=[]; value.descendants(node => { if (node.type.name==='heading') result.push(['heading',node.attrs.id,node.textContent]); if(node.type.name==='code_block') result.push(['code',node.attrs.language,node.textContent]); }); return result; };
  assert.deepEqual(collect(doc),collect(parseSource(converted.htmlSource,document)));
  assert.ok(doc.textContent.includes('编辑器长文测试。')); assert.equal(collect(doc).filter(x=>x[0]==='code').length,80);
  assert.ok(performance.now()-started < 10_000, 'model parse/edit/reopen budget is 10s, including normalization worker');
});

test('visual client serializes overlapping saves and retains local changes after conflict', async t => {
  const dom = new JSDOM(htmlEditorView(),{url:'http://127.0.0.1:4314/admin/html',pretendToBeVisual:true});
  const replacements = { window:dom.window,document:dom.window.document,navigator:dom.window.navigator,MutationObserver:dom.window.MutationObserver,getComputedStyle:dom.window.getComputedStyle,innerHeight:900,innerWidth:1200,requestAnimationFrame:dom.window.requestAnimationFrame,cancelAnimationFrame:dom.window.cancelAnimationFrame };
  const originals = new Map();
  for(const [key,value] of Object.entries(replacements)) { originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key)); Object.defineProperty(globalThis,key,{configurable:true,writable:true,value}); }
  let note = { id:'11111111-1111-1111-1111-111111111111',title:'Initial',description:'',tags:[],html_source:'<p>Original body</p><details><summary>Details title</summary><p>Editable folded body</p></details>',version:1,diagnostics:[],source_archive_id:null };
  const pending=[], sent=[]; let rejectNext = false;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (route,options={}) => {
    const input = options.body ? JSON.parse(options.body) : null;
    const response = (value,status=200) => ({ok:status>=200&&status<300,status,json:async()=>structuredClone(value)});
    if(route==='/api/html/normalize') return response({htmlSource:input.htmlSource});
    if(route.endsWith('/media')) return response({missing:[],references:[]});
    if(route==='/api/html/notes') return response([note]);
    if(options.method==='PUT') { sent.push(input); if(rejectNext) return response({error:'Draft conflict'},409); return new Promise(resolve=>pending.push(()=>{note={...note,...input,html_source:input.htmlSource,version:note.version+1};resolve(response(note));})); }
    return response(note);
  };
  t.after(()=>{globalThis.fetch=oldFetch;dom.window.close();for(const [key,descriptor] of originals) { if(descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; }});
  await import(`../public/html-editor.js?test=${Date.now()}`);
  const waitFor = async condition => { for(let i=0;i<100;i++) {if(condition())return;await new Promise(r=>setTimeout(r,20));} throw new Error('Client condition timed out'); };
  await waitFor(()=>dom.window.document.getElementById('html-status').textContent.includes('已打开'));
  const details = dom.window.document.querySelector('#html-editor details'), summary = details.querySelector('summary');
  assert.equal(details.open,true,'folded body is visible when editing starts');
  summary.click(); assert.equal(details.open,false,'summary click closes the editing view');
  summary.click(); assert.equal(details.open,true,'summary click reopens the editing view');
  await new Promise(r=>setTimeout(r,30)); assert.equal(sent.length,0,'folding is view state and does not trigger a draft write');
  const title=dom.window.document.getElementById('html-title');
  const edit = text => {title.value=text;title.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  const save = () => dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}));
  edit('First in flight');save();await waitFor(()=>pending.length===1);
  edit('Newer local title');save();pending.shift()();await waitFor(()=>pending.length===1);
  assert.equal(title.value,'Newer local title'); assert.equal(sent[1].version,2); assert.equal(sent[1].title,'Newer local title');
  assert.equal(sent[1].htmlSource,note.html_source); assert.doesNotMatch(sent[1].htmlSource,/<details[^>]*\bopen\b/,'open state never enters canonical HTML');
  pending.shift()();await waitFor(()=>dom.window.document.getElementById('html-status').textContent.includes('已保存'));
  rejectNext=true;edit('Local conflict copy');save();await waitFor(()=>dom.window.document.getElementById('html-status').textContent.includes('保存冲突'));
  assert.equal(title.value,'Local conflict copy'); assert.equal(note.title,'Newer local title');
  assert.equal(dom.window.document.querySelector('[role=textbox]').textContent,'Original bodyDetails titleEditable folded body');
  const before=sent.length;save();await new Promise(r=>setTimeout(r,30));assert.equal(sent.length,before,'conflict halts further writes until explicit reload');
});
