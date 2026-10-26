import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { baseKeymap, toggleMark, setBlockType, wrapIn } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import katex from 'katex';
import { schema, parseSource, serializeSource, sourceEquivalent } from './html-schema.js';
import { mountMediaEditor } from './html-media-editor.js';

const $ = id => document.getElementById(id);
let current = null, view = null, dirty = false, generation = 0, timer, saving = null, conflict = false, busy = false, dialogEdit = null;
const status = text => { $('html-status').textContent = text; };
function showError(error) { $('html-error').textContent = error.message; if (error.result?.diagnostics) diagnostics(error.result); status(error.status === 409 ? '保存冲突 · 本地修改已保留' : '尚未保存 · 请检查提示'); }
async function api(route, method = 'GET', input) {
  const response = await fetch(route, { method, headers: input === undefined ? {} : { 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input) });
  const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || '请求失败'), { status: response.status, result }); return result;
}
function changed() { if (!current) return; dirty = true; generation++; status('有未保存的修改'); clearTimeout(timer); if (!conflict) timer = setTimeout(() => save().catch(showError), 1000); }
function values() { return { title: $('html-title').value.trim() || '未命名笔记', description: $('html-description').value, category:$('html-category').value, tags: $('html-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean), htmlSource: serializeSource(view.state.doc, document), version: current.version }; }
function diagnostics(note) { $('html-diagnostics').replaceChildren(...(note.diagnostics || []).map(d => { const p = document.createElement('p'); p.textContent = `${d.code}：${d.message}`; return p; })); }
function publicationControls() {
  $('html-publish').disabled = !current || !view || conflict;
  $('html-unpublish').hidden = !current?.published_revision_id;
  $('html-read').hidden = !current?.published_revision_id;
  $('html-read').href = current ? `/notes/${current.id}` : '#';
  $('html-publish').textContent = current?.published_revision_id ? '更新发布 ↗' : '发布笔记 ↗';
}
function download() {
  const html = view ? serializeSource(view.state.doc, document) : current?.html_source || '';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `note-${current?.id || 'local'}.html`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function save() {
  clearTimeout(timer);
  if (saving) { await saving; if (dirty) return save(); return; }
  if (!dirty || !current || !view) return;
  if (conflict) throw new Error('另一页面已更新此稿。请下载当前 HTML 保留本地修改，再重新打开服务器稿。');
  const id = current.id, captured = generation, input = values(); status('正在保存…');
  saving = (async () => {
    try {
      const result = await api(`/api/html/notes/${id}`, 'PUT', input);
      if (current?.id !== id) return; current = result;
      if (generation === captured) {
        dirty = false;
        // Incorporate canonical IDs/cleaning without disturbing newer typing.
        if (serializeSource(view.state.doc, document) !== result.html_source) {
          const doc = parseSource(result.html_source, document), position = Math.min(view.state.selection.from, doc.content.size);
          let tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta('addToHistory', false).setMeta('canonical', true);
          tr = tr.setSelection(TextSelection.near(tr.doc.resolve(position))); view.dispatch(tr);
        }
        status(`已保存 · 修订 ${result.version}`);
      } else { status('正在保存后续修改…'); timer = setTimeout(() => save().catch(showError), 100); }
      diagnostics(result); publicationControls(); $('html-error').textContent = ''; await refreshList(); await mediaEditor.refresh(current);
    } catch (error) { if (error.status === 409) conflict = true; throw error; }
    finally { saving = null; }
  })();
  return saving;
}
async function guard(work) {
  if (busy) return; busy = true; clearTimeout(timer);
  document.querySelector('.html-workspace').inert = true;
  try { $('html-error').textContent = ''; await work(); }
  catch (error) { showError(error); }
  finally { busy = false; document.querySelector('.html-workspace').inert = false; }
}
function editNode(node, getPos) {
  const kind = node.type.name; dialogEdit = { node, position: getPos() };
  $('html-node-title').textContent = ({ math_inline: '编辑行内公式', math_block: '编辑块公式', mermaid: '编辑 Mermaid 图表', unsupported: '兼容内容源码', missing_media: '缺失资源', code_block: '编辑代码' })[kind];
  $('html-node-source').value = kind === 'code_block' ? node.textContent : node.attrs.source;
  $('html-node-language-label').textContent = kind === 'missing_media' ? '原始路径' : '代码语言';
  $('html-node-language-label').hidden = $('html-node-language').hidden = !['code_block','missing_media'].includes(kind);
  $('html-node-language').value = kind === 'code_block' ? node.attrs.language : node.attrs.path || '';
  $('html-node-dialog').showModal(); $('html-node-source').focus();
}
function semanticView(node, editor, getPos) {
  const inline = node.isInline, dom = document.createElement(inline ? 'span' : 'div'); dom.className = `semantic-node semantic-${node.type.name}`; dom.contentEditable = 'false';
  const label = document.createElement('span'); label.className = 'semantic-label'; label.textContent = ({ math_inline: '公式', math_block: '公式', mermaid: 'Mermaid', unsupported: '兼容源码 · 待处理', missing_media: '缺失图片' })[node.type.name];
  const source = document.createElement(inline ? 'span' : 'pre'); source.className = 'semantic-source';
  if (node.type.name.startsWith('math_')) { try { katex.render(node.attrs.source, source, { displayMode: !inline, throwOnError: true, trust: false }); } catch { source.textContent = node.attrs.source; } }
  else source.textContent = node.attrs.source;
  const button = document.createElement('button'); button.type = 'button'; button.textContent = '编辑'; button.setAttribute('aria-label', `编辑 ${label.textContent}`); button.addEventListener('click', () => editNode(node, getPos));
  dom.append(label, source, button); return { dom, stopEvent: () => true, ignoreMutation: () => true };
}
function codeView(node, editor, getPos) {
  const dom = document.createElement('div'); dom.className = 'editor-code'; const button = document.createElement('button'); button.type = 'button'; button.contentEditable = 'false'; button.textContent = `代码 · ${node.attrs.language} · 编辑源码/语言`; button.addEventListener('click', () => editNode(editor.state.doc.nodeAt(getPos()), getPos));
  const pre = document.createElement('pre'), code = document.createElement('code'); pre.append(code); dom.append(button, pre); return { dom, contentDOM: code, stopEvent: event => button.contains(event.target) };
}
function detailsView() {
  const dom = document.createElement('details'); dom.open = true;
  const isSummaryClick = event => event.type === 'click' && event.target.closest?.('summary')?.parentElement === dom;
  // ProseMirror handles clicks before native summary activation completes.
  // Toggle explicitly and keep this reading state outside the document model.
  dom.addEventListener('click', event => { if (isSummaryClick(event)) { event.preventDefault(); dom.open = !dom.open; } });
  return { dom, contentDOM: dom, stopEvent: isSummaryClick, ignoreMutation: mutation => mutation.type === 'attributes' && mutation.target === dom && mutation.attributeName === 'open' };
}
function makeView(doc) {
  view?.destroy();
  view = new EditorView($('html-editor'), {
    state: EditorState.create({ schema, doc, plugins: [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo, 'Mod-b': toggleMark(schema.marks.strong), 'Mod-i': toggleMark(schema.marks.em), Enter: splitListItem(schema.nodes.list_item), Tab: sinkListItem(schema.nodes.list_item), 'Shift-Tab': liftListItem(schema.nodes.list_item) }), keymap(baseKeymap)] }),
    attributes: { role: 'textbox', 'aria-label': 'HTML 正文编辑区', 'aria-multiline': 'true', spellcheck: 'false' },
    nodeViews: { math_inline: semanticView, math_block: semanticView, mermaid: semanticView, unsupported: semanticView, missing_media: semanticView, code_block: codeView, details: detailsView },
    dispatchTransaction(tr) { view.updateState(view.state.apply(tr)); if (tr.docChanged && !tr.getMeta('canonical')) changed(); },
    handlePaste(editor, event) {
      // Pasting arbitrary rich DOM through a schema parser can drop hidden semantic nodes.
      // Text-only paste is explicit and preserves the document around the insertion.
      const text = event.clipboardData?.getData('text/plain'); if (text === undefined) return false;
      event.preventDefault(); editor.dispatch(editor.state.tr.insertText(text)); if (event.clipboardData?.getData('text/html')) status('已按纯文本粘贴 · 格式请使用工具栏设置'); return true;
    },
    handleDOMEvents: { drop(editor, event) { event.preventDefault(); showError(new Error('请使用图片或上传按钮插入资源；拖入内容未修改当前稿。')); return true; } },
  });
}
async function openNote(note) {
  let doc;
  try {
    doc = parseSource(note.html_source, document);
    const roundtrip = await api('/api/html/normalize', 'POST', { htmlSource: serializeSource(doc, document) });
    if (!sourceEquivalent(roundtrip.htmlSource, note.html_source, document)) throw new Error('编辑器无法无损加载此稿，已阻止替换。请下载当前 HTML 或从历史恢复。');
  } catch (error) {
    // Keep the blocked article available for exact download/history recovery;
    // never leave the download button pointing to a previously opened article.
    current = note; dirty = false; view?.destroy(); view = null; $('html-editor').replaceChildren();
    for (const id of ['html-title','html-description','html-tags','html-category']) $(id).disabled = true;
    $('html-title').value = note.title; $('html-description').value = note.description; $('html-tags').value = note.tags.join(', '); $('html-category').value = note.category || '';
    $('html-original').hidden = !note.source_archive_id; $('html-original').href = `/api/html/archives/${note.source_archive_id}`;
    $('html-history-list').replaceChildren(); diagnostics(note); publicationControls(); throw error;
  }
  current = note; dirty = false; conflict = false; generation++; makeView(doc);
  for (const id of ['html-title','html-description','html-tags','html-category']) $(id).disabled = false;
  $('html-title').value = note.title; $('html-description').value = note.description; $('html-tags').value = note.tags.join(', '); $('html-category').value = note.category || '';
  $('html-original').hidden = !note.source_archive_id; $('html-original').href = `/api/html/archives/${note.source_archive_id}`;
  diagnostics(note); publicationControls(); status(`已打开 · 修订 ${note.version}`); $('html-history-list').replaceChildren(); await refreshList(); await mediaEditor.refresh(note);
}
async function refreshList() {
  const notes = await api('/api/html/notes'); $('html-list').replaceChildren(...notes.map(note => { const button = document.createElement('button'); button.className = `draft-item${current?.id === note.id ? ' active' : ''}`; button.textContent = note.title; button.onclick = () => guard(async () => { await save(); await openNote(await api(`/api/html/notes/${note.id}`)); }); return button; }));
}
async function loadHistory() {
  if (!current) return; const revisions = await api(`/api/html/notes/${current.id}/history`);
  $('html-history-list').replaceChildren(...revisions.map(revision => {
    const item = document.createElement('div'), text = document.createElement('span'), button = document.createElement('button');
    text.textContent = `${new Date(revision.created_at).toLocaleString()} · ${revision.title} · ${revision.id.slice(0,8)}`; button.textContent = '恢复为新草稿';
    button.onclick = () => guard(async () => { await save(); const result = await api(`/api/html/notes/${current.id}/restore`, 'POST', { revisionId: revision.id, version: current.version }); await openNote(result); status(`已恢复为新修订 ${result.version}`); await loadHistory(); }); item.append(text, button); return item;
  }));
}
function command(name) {
  if (!view || !current) return;
  const run = fn => { fn(view.state, view.dispatch, view); view.focus(); };
  if (['strong','em','del'].includes(name)) return run(toggleMark(schema.marks[name]));
  if (name === 'paragraph') return run(setBlockType(schema.nodes.paragraph));
  if (name === 'heading') return run(setBlockType(schema.nodes.heading, { level: 2 }));
  if (name === 'bullet') return run(wrapInList(schema.nodes.bullet_list));
  if (name === 'quote') return run(wrapIn(schema.nodes.blockquote));
  if (name === 'undo' || name === 'redo') return run(name === 'undo' ? undo : redo);
  const insert = node => { view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView()); view.focus(); };
  if (['math_inline','math_block','mermaid'].includes(name)) {
    const node = schema.nodes[name].create({ source: name === 'mermaid' ? 'flowchart LR\n A-->B\n' : 'x^2' }); insert(node); return;
  }
  if (name === 'code') return insert(schema.nodes.code_block.create({ language: 'text' }, schema.text('代码\n')));
  if (name === 'table') { const cell = () => schema.nodes.table_cell.create(null, schema.nodes.paragraph.create({ unwrap: true }, schema.text('单元格'))); return insert(schema.nodes.table.create(null, schema.nodes.table_body.create(null, [schema.nodes.table_row.create(null, [cell(),cell()]),schema.nodes.table_row.create(null,[cell(),cell()])]))); }
  if (name === 'details') return insert(schema.nodes.details.create(null, [schema.nodes.summary.create(null, schema.text('展开详情')),schema.nodes.paragraph.create(null, schema.text('补充内容'))]));
  if (name === 'link') { const href = prompt('链接地址（https://、站内路径或 #锚点）'); if (href) run(toggleMark(schema.marks.link, { href })); return; }
  if (name === 'image') { const src = prompt('图片地址（HTTPS 或 /media/资源编号）'); if (src) insert(schema.nodes.image.create({ src, alt: prompt('图片说明') || '' })); }
}
$('html-toolbar').addEventListener('mousedown', event => event.preventDefault());
$('html-toolbar').addEventListener('click', event => { const button = event.target.closest('[data-command]'); if (button) command(button.dataset.command); });
$('html-node-apply').onclick = () => {
  if (!dialogEdit || !view) return; const { node, position } = dialogEdit, attrs = { ...node.attrs }, source = $('html-node-source').value;
  if (!Number.isInteger(position) || !view.state.doc.nodeAt(position)?.eq(node)) { $('html-node-dialog').close(); showError(new Error('节点已变化，请重新打开该节点后编辑；本次修改未覆盖原稿。')); return; }
  if (node.type.name === 'code_block') attrs.language = $('html-node-language').value || 'text'; else attrs.source = source;
  if (node.type.name === 'missing_media') attrs.path = $('html-node-language').value;
  const replacement = node.type.create(attrs, node.type.name === 'code_block' && source ? schema.text(source) : null);
  view.dispatch(view.state.tr.replaceWith(position, position + view.state.doc.nodeAt(position).nodeSize, replacement)); $('html-node-dialog').close(); view.focus();
};
for (const id of ['html-title','html-description','html-tags','html-category']) $(id).addEventListener('input', changed);
$('html-new').onclick = () => guard(async () => { await save(); await openNote(await api('/api/html/notes','POST',{ title:'未命名笔记', description:'', tags:[], htmlSource:'<p></p>' })); view.focus(); });
$('html-save').onclick = () => guard(save);
$('html-publish').onclick = () => guard(async () => {
  if (!current || !view) return; await save();
  if (conflict) throw new Error('请先处理保存冲突，再发布。');
  try {
    current = await api(`/api/html/notes/${current.id}/publish`, 'POST', { version: current.version, revisionId: current.revision_id, sourceHash: current.source_hash });
    publicationControls(); status(`已发布 · 修订 ${current.version}`); await refreshList();
  } catch (error) { if (error.status === 409) conflict = true; publicationControls(); throw error; }
});
$('html-unpublish').onclick = () => guard(async () => {
  if (!current) return; await save();
  if (conflict) throw new Error('请先处理保存冲突，再撤回。');
  try { current = await api(`/api/html/notes/${current.id}/unpublish`, 'POST', { version: current.version }); publicationControls(); status(`已撤回 · 修订 ${current.version}`); }
  catch (error) { if (error.status === 409) conflict = true; publicationControls(); throw error; }
});
$('html-download').onclick = download;
$('html-reload').onclick = () => guard(async () => { if (!current) return; if ((dirty || conflict) && !confirm('本地尚有未保存的修改。建议先下载当前 HTML。确定丢弃本地修改并读取服务器稿吗？')) return; if (saving) { try { await saving; } catch {} } await openNote(await api(`/api/html/notes/${current.id}`)); });
$('html-import').onclick = () => $('html-file').click();
$('html-file').onchange = event => guard(async () => {
  const file = event.target.files[0]; if (!file) return;
  try {
    await save();
    const response = await fetch(`/api/html/import?filename=${encodeURIComponent(file.name)}`, { method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:await file.arrayBuffer() });
    const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error),{status:response.status,result}); await openNote(result.note); status(result.unchanged ? '相同原件已导入，保留现有稿' : '原字节已归档 · HTML 草稿已建立');
  } finally { event.target.value=''; }
});
$('html-history-refresh').onclick = () => guard(loadHistory);
$('html-logout').onclick = () => guard(async () => { await save(); await api('/api/logout','POST',{}); location.reload(); });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save().catch(showError); } });
window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
const mediaEditor = mountMediaEditor({getCurrent:() => current,save,openNote,guard,api,insertMedia(media) {
  if (!view) throw new Error('请先打开可编辑的笔记');
  const node = media.kind === 'image' ? schema.nodes.image.create({src:media.url,alt:media.filename}) : schema.text(media.filename,[schema.marks.link.create({href:media.url})]);
  view.dispatch(view.state.tr.replaceSelectionWith(node,false).scrollIntoView()); view.focus();
}});
guard(async () => { await refreshList(); const notes = await api('/api/html/notes'); if (notes.length) await openNote(await api(`/api/html/notes/${notes[0].id}`)); });
