import { renderDiagrams } from './reader.js';
const $ = id => document.getElementById(id);
async function api(url, method = 'GET', data) {
  const response = await fetch(url, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败');
  return result;
}
if ($('login-form')) {
  $('login-form').addEventListener('submit', async event => {
    event.preventDefault(); $('login-error').textContent = '';
    const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try { await api('/api/login', 'POST', { password: $('password').value }); location.reload(); }
    catch (error) { $('login-error').textContent = error.message; button.disabled = false; }
  });
} else {
  let current = null, dirty = false, generation = 0, previewGeneration = 0, saveTimer, previewTimer, saving = null, busy = false;
  const showError = error => { $('editor-error').textContent = error.message; $('save-status').textContent = '未保存 · 请检查提示'; };
  const guard = fn => async event => {
    if (busy) return;
    busy = true; document.querySelector('.editor-shell').inert = true;
    try { $('editor-error').textContent = ''; await fn(event); }
    catch (error) { showError(error); }
    finally { busy = false; document.querySelector('.editor-shell').inert = false; }
  };
  const values = () => ({ title: $('note-title').value.trim() || '未命名笔记', description: $('note-description').value, tags: $('note-tags').value.split(/[,，]/).map(t => t.trim()).filter(Boolean), markdown: $('markdown').value });
  function status() {
    $('unpublish-note').hidden = !current?.published_at;
    $('read-note').hidden = !current?.published_at;
    $('read-note').href = current ? `/notes/${current.id}` : '#';
    $('publish-note').textContent = current?.published_at ? '更新发布 ↗' : '发布笔记 ↗';
  }
  async function refreshList() {
    const notes = await api('/api/notes');
    $('draft-list').replaceChildren(...notes.map(note => {
      const button = document.createElement('button'); button.className = `draft-item ${note.id === current?.id ? 'selected' : ''}`;
      const title = document.createElement('strong'); title.textContent = note.title;
      const meta = document.createElement('span'); meta.textContent = `${note.published_at ? note.published_version === note.version ? '已发布' : '有未发布修改' : '草稿'} · ${new Date(note.updated_at).toLocaleDateString('zh-CN')}`;
      button.append(title, meta); button.addEventListener('click', guard(() => openNote(note.id))); return button;
    }));
    return notes;
  }
  async function preview() {
    const request = ++previewGeneration, markdown = $('markdown').value;
    $('word-count').textContent = `${[...markdown].length.toLocaleString()} 字`;
    const result = await api('/api/preview', 'POST', { markdown });
    if (request !== previewGeneration) return;
    $('preview').innerHTML = result.html;
    await renderDiagrams($('preview'));
  }
  async function save() {
    clearTimeout(saveTimer);
    if (saving) { await saving; if (dirty) return save(); return; }
    if (!current || !dirty) return;
    const id = current.id, captured = generation, input = { ...values(), version: current.version };
    $('save-status').textContent = '正在保存…';
    saving = api(`/api/notes/${id}`, 'PUT', input).then(async saved => {
      current = saved; dirty = generation !== captured;
      $('save-status').textContent = dirty ? '有待保存修改' : '已保存到本地';
      status(); await refreshList();
    });
    try { await saving; } finally { saving = null; }
    // Flush any keystrokes entered while an automatic save was in flight.
    if (dirty) await save();
  }
  async function openNote(id) {
    await save(); current = await api(`/api/notes/${id}`); dirty = false; generation++;
    $('note-title').value = current.title; $('note-description').value = current.description;
    $('note-tags').value = current.tags.join(', '); $('markdown').value = current.markdown;
    $('save-status').textContent = '已保存到本地'; $('editor-error').textContent = ''; status();
    await Promise.all([refreshList(), preview()]);
  }
  function changed() {
    dirty = true; generation++; $('save-status').textContent = '有待保存修改';
    clearTimeout(saveTimer); clearTimeout(previewTimer);
    saveTimer = setTimeout(() => save().catch(showError), 1400);
    previewTimer = setTimeout(() => preview().catch(showError), 450);
  }
  for (const id of ['note-title', 'note-description', 'note-tags', 'markdown']) $(id).addEventListener('input', changed);
  $('save-note').addEventListener('click', guard(save));
  $('new-note').addEventListener('click', guard(async () => {
    await save(); const note = await api('/api/notes', 'POST', { title: '未命名笔记', description: '', tags: [], markdown: '' }); await openNote(note.id); $('note-title').focus(); $('note-title').select();
  }));
  $('import-note').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', guard(async event => {
    const file = event.target.files[0]; if (!file) return;
    try { if (file.size > 1_900_000) throw new Error('Markdown 文件请控制在 1.9 MB 以内'); await save(); const note = await api('/api/import', 'POST', { filename: file.name, markdown: await file.text() }); await openNote(note.id); }
    finally { event.target.value = ''; }
  }));
  $('publish-note').addEventListener('click', guard(async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await save(); if (dirty) await save(); current = await api(`/api/notes/${current.id}/publish`, 'POST', { version: current.version }); status(); await refreshList(); $('save-status').textContent = '已发布 · 读者现在可以阅读'; }
    finally { button.disabled = false; }
  }));
  $('unpublish-note').addEventListener('click', guard(async () => { await save(); current = await api(`/api/notes/${current.id}/unpublish`, 'POST', {}); status(); await refreshList(); $('save-status').textContent = '已撤回 · 笔记保留为草稿'; }));
  $('logout').addEventListener('click', guard(async () => { await save(); await api('/api/logout', 'POST', {}); location.reload(); }));
  $('export-note').addEventListener('click', event => {
    event.preventDefault(); const input = values();
    const metadata = { ...current?.source_metadata, title: input.title, description: input.description, tags: input.tags };
    const file = new Blob([`---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${input.markdown}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(file), link = document.createElement('a'); link.href = url; link.download = `${input.title.replace(/[\\/:*?"<>|]/g, '-')}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const insertions = { heading: ['\n## ', '\n'], bold: ['**', '**'], code: ['\n```javascript\n', '\n```\n'], math: ['\n$$\n', '\n$$\n'], diagram: ['\n```mermaid\nflowchart LR\n  A[开始] --> B[完成]', '\n```\n'] };
  document.querySelectorAll('[data-insert]').forEach(button => button.addEventListener('click', () => {
    const field = $('markdown'), [before, after] = insertions[button.dataset.insert], start = field.selectionStart, end = field.selectionEnd;
    field.setRangeText(before + field.value.slice(start, end) + after, start, end, 'end'); field.focus(); changed();
  }));
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); save().catch(showError); } });
  window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
  (async () => { const notes = await refreshList(); if (notes.length) await openNote(notes[0].id); else { const note = await api('/api/notes', 'POST', { title: '我的第一篇笔记', description: '', tags: [], markdown: '' }); await openNote(note.id); } })().catch(showError);
}
