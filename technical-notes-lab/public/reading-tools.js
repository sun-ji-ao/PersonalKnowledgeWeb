const article = document.querySelector('.article-content');
if (article) {
  const legacyMap = document.getElementById('legacy-anchor-map');
  if (legacyMap && location.hash.length > 1) {
    try {
      const oldSlug = decodeURIComponent(location.hash.slice(1));
      const currentId = JSON.parse(legacyMap.textContent)[oldSlug];
      const target = currentId && document.getElementById(currentId);
      if (target) { history.replaceState(null, '', `#${encodeURIComponent(currentId)}`); target.scrollIntoView(); }
    } catch { /* Keep an unknown or malformed fragment unchanged. */ }
  }
  const progress = document.createElement('progress'); progress.className = 'reading-progress'; progress.max = 100; progress.value = 0; progress.setAttribute('aria-label','阅读进度'); document.body.append(progress);
  const update = () => { const top = article.getBoundingClientRect().top + window.scrollY, end = Math.max(1, article.scrollHeight - window.innerHeight); progress.value = Math.max(0,Math.min(100,(window.scrollY - top) / end * 100)); };
  window.addEventListener('scroll', update, { passive:true }); window.addEventListener('resize', update); update();
  for (const pre of article.querySelectorAll('pre:not(.mermaid)')) {
    const code = pre.querySelector('code'); if (!code) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'copy-code'; button.textContent = '复制代码';
    button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(code.textContent); button.textContent = '已复制'; } catch { button.textContent = '复制失败，请选择代码复制'; } });
    pre.insertAdjacentElement('beforebegin',button);
  }
  const dialog = document.createElement('dialog'); dialog.className = 'diagram-dialog';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = '关闭图表'; close.addEventListener('click',() => dialog.close());
  const zoom = document.createElement('input'); zoom.type = 'range'; zoom.min = '50'; zoom.max = '250'; zoom.value = '100'; zoom.setAttribute('aria-label','图表缩放');
  const canvas = document.createElement('div'); canvas.className = 'diagram-canvas'; zoom.addEventListener('input',() => { canvas.style.zoom = `${zoom.value}%`; }); dialog.append(close,zoom,canvas); document.body.append(dialog);
  for (const diagram of article.querySelectorAll('pre.mermaid')) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'view-diagram'; button.textContent = '放大查看图表';
    button.addEventListener('click',() => { canvas.replaceChildren(diagram.cloneNode(true)); zoom.value = '100'; canvas.style.zoom = '100%'; dialog.showModal(); }); diagram.insertAdjacentElement('afterend',button);
  }
  const links = [...document.querySelectorAll('.toc a[href^="#"]')];
  if ('IntersectionObserver' in window) { const observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting) { for (const link of links) { const current = link.hash === `#${entry.target.id}`; link.classList.toggle('toc-current',current); if (current) link.setAttribute('aria-current','location'); else link.removeAttribute('aria-current'); } } },{ rootMargin:'0px 0px -65% 0px' }); for (const h of article.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')) observer.observe(h); }
}
