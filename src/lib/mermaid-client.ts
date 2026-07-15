import mermaid from 'mermaid';

function resolveMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.dataset.theme === 'light' ? 'default' : 'dark';
}

function promoteMermaidCodeBlocks(root: ParentNode): void {
  const blocks = root.querySelectorAll<HTMLElement>('.markdown-body pre > code.language-mermaid');
  blocks.forEach((code) => {
    const pre = code.parentElement;
    if (!pre?.parentElement) {
      return;
    }
    const container = document.createElement('div');
    container.className = 'mermaid';
    container.textContent = code.textContent ?? '';
    pre.parentElement.replaceChild(container, pre);
  });
}

function storeMermaidSource(nodes: HTMLElement[]): void {
  nodes.forEach((node) => {
    if (!node.dataset.mermaidSource) {
      node.dataset.mermaidSource = node.textContent?.trim() ?? '';
    }
  });
}

function resetMermaidNodes(nodes: HTMLElement[]): void {
  nodes.forEach((node) => {
    node.removeAttribute('data-processed');
    node.textContent = node.dataset.mermaidSource ?? node.textContent ?? '';
  });
}

function configureMermaid(): void {
  mermaid.initialize({
    startOnLoad: false,
    theme: resolveMermaidTheme(),
    securityLevel: 'loose',
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif'
  });
}

export async function initMermaidDiagrams(): Promise<void> {
  promoteMermaidCodeBlocks(document);
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.markdown-body .mermaid'));
  if (nodes.length === 0) {
    return;
  }
  storeMermaidSource(nodes);
  const pendingNodes = nodes.filter((node) => !node.querySelector('svg'));
  if (pendingNodes.length === 0) {
    return;
  }
  configureMermaid();
  await mermaid.run({ nodes: pendingNodes });
}

function setupThemeObserver(): void {
  const observer = new MutationObserver(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.markdown-body .mermaid'));
    if (nodes.length === 0) {
      return;
    }
    resetMermaidNodes(nodes);
    configureMermaid();
    void mermaid.run({ nodes });
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

if (typeof document !== 'undefined') {
  setupThemeObserver();
}
