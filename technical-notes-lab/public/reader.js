import mermaid from '/vendor/mermaid/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'system-ui, sans-serif', suppressErrorRendering: true });
let diagramQueue = Promise.resolve();
export function renderDiagrams(scope = document) {
  diagramQueue = diagramQueue.catch(() => {}).then(async () => {
    const nodes = [...scope.querySelectorAll('pre.mermaid:not([data-processed])')];
    for (const node of nodes) {
      try { await mermaid.run({ nodes: [node] }); }
      catch { node.removeAttribute('data-processed'); node.classList.add('diagram-error'); node.title = '图表语法不正确，请检查 Mermaid 内容'; }
    }
  });
  return diagramQueue;
}
if (!document.body.classList.contains('workspace')) renderDiagrams();
