import { parseFragment } from 'parse5';
import { writeSync } from 'node:fs';
import katex from 'katex';
import { normalizeHtmlCore, escapeText, languages, LIMITS, diagnostic, VERSIONS } from './html-core.mjs';

const attr = (n, key) => n.attrs?.find(a => a.name === key)?.value;
const text = n => n.nodeName === '#text' ? n.value : (n.childNodes || []).map(text).join('');
// Display markup is generated only by pinned local libraries; validate before returning it.
function verifyGenerated(markup) {
  const tree = parseFragment(markup);
  const walk = n => {
    if (['script', 'iframe', 'object', 'embed', 'form', 'input'].includes(n.tagName)) throw new Error(`Unexpected display element: ${n.tagName}`);
    if (n.namespaceURI === 'http://www.w3.org/2000/svg') {
      let ancestor = n.parentNode; let fromMath = false;
      while (ancestor) { if ((attr(ancestor, 'class') || '').split(/\s+/).includes('katex')) fromMath = true; ancestor = ancestor.parentNode; }
      if (!fromMath || !['svg','path','line','rect','circle','ellipse','polygon','polyline','g'].includes(n.tagName)) throw new Error('Unexpected SVG outside the inert KaTeX subset.');
      if ((n.attrs || []).some(a => !['xmlns','width','height','viewBox','preserveAspectRatio','d','fill','stroke','stroke-width','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','points','transform','class','style'].includes(a.name))) throw new Error('Unexpected SVG attribute.');
    }
    for (const a of n.attrs || []) {
      if (/^on/i.test(a.name)) throw new Error('Unexpected display event attribute.');
      if (['href','src','xlink:href'].includes(a.name) && !/^(https?:\/\/|mailto:|\/(?:media|notes)\/|#)/i.test(a.value)) throw new Error('Unexpected display URL.');
      if (a.name === 'style' && /url\s*\(|expression|@import|behavior|binding/i.test(a.value)) throw new Error('Unexpected display style.');
    }
    for (const c of n.childNodes || []) walk(c);
  };
  walk(tree);
}
export async function renderHtmlCore(input) {
  const trace = message => { if (process.env.NOTES_TRACE_RENDER === '1') writeSync(2, `render ${Date.now()}: ${message}\n`); };
  trace('start');
  if (!input || input.htmlSource === null || typeof input.htmlSource !== 'string') return { ...input, htmlRendered: null, renderStatus: 'failed', publishable: false };
  const normalized = normalizeHtmlCore(input.htmlSource, { generated: true });
  const result = { ...input, versions: VERSIONS, htmlRendered: null, renderStatus: 'failed', publishable: false, diagnostics: [...(input.diagnostics || [])] };
  try {
    if (normalized.status === 'rejected' || normalized.htmlSource !== input.htmlSource || input.sourceHash !== normalized.sourceHash) throw new Error('Source is not canonical or source hash does not match.');
    // Retain blocking diagnostics even if a caller has forged a ready flag.
    result.diagnostics.push(...normalized.diagnostics.filter(d => !result.diagnostics.some(existing => existing.code === d.code)));
    const tree = parseFragment(input.htmlSource);
    const codeLanguages = new Set();
    function collectCodeLanguages(n) {
      if (n.tagName === 'pre' && !attr(n, 'data-note-kind') && n.childNodes[0]?.tagName === 'code') {
        const lang = (attr(n.childNodes[0], 'class') || '').slice(9);
        if (lang !== 'text' && languages.includes(lang)) codeLanguages.add(lang);
      }
      for (const child of n.childNodes || []) collectCodeLanguages(child);
    }
    collectCodeLanguages(tree);
    // Each job uses a fresh worker: load only this article's grammars, and skip
    // Shiki entirely when there are no code blocks (including math-only jobs).
    let highlighterReady;
    const getHighlighter = () => highlighterReady ||= (async () => {
      const { createHighlighter } = await import('shiki');
      const highlighter = await createHighlighter({ themes: ['github-dark'], langs: [...codeLanguages] });
      trace('highlighter ready');
      return highlighter;
    })();
    let mermaidReady;
    const getMermaid = () => mermaidReady ||= (async () => {
      // DOMPurify needs a DOM for labelled diagrams. JSDOM does not execute scripts
      // or load resources; it exists only inside this disposable bounded worker.
      trace('import DOM'); const { JSDOM } = await import('jsdom'); trace('DOM imported');
      const dom = new JSDOM('');
      globalThis.window = dom.window; globalThis.document = dom.window.document;
      trace('import Mermaid'); const { default: mermaid } = await import('mermaid'); trace('Mermaid imported');
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, maxTextSize: LIMITS.diagramChars });
      return mermaid;
    })();
    async function render(n) {
      const kind = attr(n, 'data-note-kind');
      if (kind === 'math-inline' || kind === 'math-block') {
        const latex = text(n); if (latex.length > LIMITS.mathChars) throw new Error('Formula exceeds character budget.');
        return katex.renderToString(latex, { displayMode: kind === 'math-block', throwOnError: true, trust: false, strict: 'error', maxExpand: 1000 });
      }
      if (kind === 'mermaid') {
        const source = text(n); if (source.length > LIMITS.diagramChars) throw new Error('Diagram exceeds character budget.');
        // Per-document config/click actions are excluded; the reader owns the security config.
        if (/%%\{|^\s*---|^\s*click\s/im.test(source)) throw new Error('Diagram configuration and click actions are not supported.');
        const mermaid = await getMermaid(); trace('parse diagram'); await mermaid.parse(source); trace('diagram parsed');
        return `<pre class="mermaid">${escapeText(source)}</pre>`;
      }
      if (n.tagName === 'pre' && !kind && n.childNodes[0]?.tagName === 'code') {
        const code = n.childNodes[0]; const lang = attr(code, 'class').slice(9);
        return (await getHighlighter()).codeToHtml(text(code), { lang: languages.includes(lang) ? lang : 'text', theme: 'github-dark' });
      }
      if (!n.tagName) return n.nodeName === '#text' ? escapeText(n.value) : (await Promise.all((n.childNodes || []).map(render))).join('');
      // Keep the source's already-validated attributes; only replace children.
      const start = `<${n.tagName}${(n.attrs || []).map(a => ` ${a.name}="${escapeText(a.value).replaceAll('"', '&quot;')}"`).join('')}>`;
      if (['img','br','hr'].includes(n.tagName)) return start;
      return start + (await Promise.all(n.childNodes.map(render))).join('') + `</${n.tagName}>`;
    }
    try { result.htmlRendered = await render(tree); } finally { await highlighterReady?.then(highlighter => highlighter.dispose(), () => {}); }
    verifyGenerated(result.htmlRendered);
    result.renderStatus = 'ready';
    trace('complete');
    result.publishable = input.status === 'ready' && !result.diagnostics.some(d => d.blocksPublishing);
  } catch (error) {
    result.htmlRendered = null;
    result.diagnostics.push(diagnostic('RENDER_FAILED', error.message, null, true, 'error'));
  }
  return result;
}
