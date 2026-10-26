export function mountMediaEditor({ getCurrent, save, openNote, guard, api, insertMedia }) {
  const panel = document.createElement('details'); panel.className = 'media-panel'; panel.open = true;
  const summary = document.createElement('summary'); summary.textContent = '图片与附件';
  const description = document.createElement('p'); description.textContent = '上传后默认私有；发布当前引用后读者才可读取。单文件最多 10 MiB。';
  const label = document.createElement('label'); label.textContent = '选择图片或附件并插入正文';
  const input = document.createElement('input'); input.type = 'file'; input.setAttribute('aria-label','选择图片或附件并插入正文'); label.append(input);
  const list = document.createElement('ul'); panel.append(summary,description,label,list); document.getElementById('html-editor').insertAdjacentElement('afterend',panel);
  async function upload(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MiB');
    const response = await fetch(`/api/html/media?filename=${encodeURIComponent(file.name)}`, { method:'POST',headers:{'Content-Type':'application/octet-stream'},body:await file.arrayBuffer() });
    const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error),{ status:response.status,result }); return result;
  }
  input.addEventListener('change',() => guard(async () => { const file = input.files[0]; if (!file) return; try { await save(); if (!getCurrent()) throw new Error('请先创建或打开笔记'); const media = await upload(file); insertMedia(media); await save(); await refresh(getCurrent()); } finally { input.value=''; } }));
  async function refresh(note) {
    if (!note) { list.replaceChildren(); return; }
    const data = await api(`/api/html/notes/${note.id}/media`); if (getCurrent()?.id !== note.id) return;
    list.replaceChildren();
    for (const item of [...data.missing.map(m => ({label:`缺失图片：${m.path}`,missingPath:m.path})),...data.references.map(r => ({label:`${r.available ? '已上传' : '文件缺失'}：${r.filename || r.url}`,oldMediaId:r.id}))]) {
      const li = document.createElement('li'), text = document.createElement('span'), replace = document.createElement('input'); text.textContent = item.label; replace.type = 'file'; replace.setAttribute('aria-label',`${item.missingPath !== undefined ? '补传' : '替换'} ${item.label}`);
      replace.addEventListener('change',() => guard(async () => { const file = replace.files[0]; if (!file) return; try { await save(); const current = getCurrent(); if (current.id !== note.id) throw new Error('当前笔记已变化'); const media = await upload(file); await openNote(await api(`/api/html/notes/${current.id}/media/replace`,'POST',{version:current.version,mediaId:media.id,...(item.missingPath !== undefined ? {missingPath:item.missingPath} : {oldMediaId:item.oldMediaId})})); } finally { replace.value=''; } }));
      li.append(text,replace); list.append(li);
    }
    if (!list.childNodes.length) { const li = document.createElement('li'); li.textContent = '正文没有受管理资源或缺失图片。'; list.append(li); }
  }
  return { refresh };
}
