import { Schema, DOMParser, DOMSerializer } from 'prosemirror-model';

const plain = (tag, content, group = 'block') => ({ content, group, parseDOM: [{ tag }], toDOM: () => [tag, 0] });
const semantic = (tag, kind, inline = false) => ({
  group: inline ? 'inline' : 'block', inline, atom: true,
  attrs: { source: { default: '' }, ...(kind === 'missing-media' ? { path: { default: '' } } : {}) },
  parseDOM: [{ tag: `${tag}[data-note-kind="${kind}"]`, getAttrs: dom => ({ source: dom.textContent, ...(kind === 'missing-media' ? { path: dom.getAttribute('data-note-path') } : {}) }) }],
  toDOM: node => [tag, { 'data-note-kind': kind, ...(kind === 'missing-media' ? { 'data-note-path': node.attrs.path } : {}) }, ...(tag === 'pre' ? [['code', node.attrs.source]] : [node.attrs.source])],
});
export const schema = new Schema({ nodes: {
  doc: { content: 'block*' },
  paragraph: { content: 'inline*', group: 'block', attrs: { unwrap: { default: false } }, parseDOM: [{ tag: 'p', getAttrs: dom => ({ unwrap: dom.hasAttribute('data-editor-unwrap') }) }], toDOM: n => ['p', n.attrs.unwrap ? { 'data-editor-unwrap': 'true' } : {}, 0] },
  heading: { content: 'inline*', group: 'block', defining: true, attrs: { level: { default: 2 }, id: { default: null } }, parseDOM: [1,2,3,4,5,6].map(level => ({ tag: `h${level}`, getAttrs: dom => ({ level, id: dom.getAttribute('id') }) })), toDOM: n => [`h${n.attrs.level}`, n.attrs.id ? { id: n.attrs.id } : {}, 0] },
  blockquote: plain('blockquote', 'block*'),
  horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
  mermaid: semantic('pre', 'mermaid'),
  unsupported: semantic('pre', 'unsupported'),
  code_block: { content: 'text*', marks: '', group: 'block', code: true, defining: true, attrs: { language: { default: 'text' } }, parseDOM: [{ tag: 'pre:not([data-note-kind])', preserveWhitespace: 'full', getAttrs: dom => ({ language: dom.querySelector('code')?.className.replace(/^language-/, '') || 'text' }) }], toDOM: n => ['pre', ['code', { class: `language-${n.attrs.language}` }, 0]] },
  math_block: semantic('div', 'math-block'),
  math_inline: semantic('span', 'math-inline', true),
  missing_media: semantic('span', 'missing-media', true),
  bullet_list: plain('ul', 'list_item*'),
  ordered_list: { content: 'list_item*', group: 'block', attrs: { start: { default: null } }, parseDOM: [{ tag: 'ol', getAttrs: dom => ({ start: dom.getAttribute('start') }) }], toDOM: n => ['ol', n.attrs.start ? { start: n.attrs.start } : {}, 0] },
  // Imported tight lists contain inline text, loose lists contain paragraphs. Keep both
  // without adding paragraphs to the canonical HTML: dedicated DOM-aware item content.
  list_item: { content: 'block*', defining: true, attrs: { checked: { default: null }, tight: { default: false } }, parseDOM: [{ tag: 'li', getAttrs: dom => ({ checked: dom.getAttribute('data-note-checked'), tight: !dom.querySelector(':scope > p') }) }], toDOM: n => ['li', n.attrs.checked == null ? {} : { 'data-note-checked': n.attrs.checked }, 0] },
  table: plain('table', '(table_head | table_body | table_row)*'),
  table_head: { ...plain('thead', 'table_row*', undefined), group: undefined },
  table_body: { ...plain('tbody', 'table_row*', undefined), group: undefined },
  table_row: { ...plain('tr', '(table_header | table_cell)*', undefined), group: undefined },
  table_header: { content: 'block*', attrs: { align: { default: null } }, parseDOM: [{ tag: 'th', getAttrs: dom => ({ align: dom.getAttribute('data-note-align') }) }], toDOM: n => ['th', n.attrs.align ? { 'data-note-align': n.attrs.align } : {}, 0] },
  table_cell: { content: 'block*', attrs: { align: { default: null } }, parseDOM: [{ tag: 'td', getAttrs: dom => ({ align: dom.getAttribute('data-note-align') }) }], toDOM: n => ['td', n.attrs.align ? { 'data-note-align': n.attrs.align } : {}, 0] },
  figure: plain('figure', '(block | figcaption)*'),
  figcaption: { content: 'inline*', parseDOM: [{ tag: 'figcaption' }], toDOM: () => ['figcaption', 0] },
  details: plain('details', 'summary block*'),
  summary: { content: 'inline*', parseDOM: [{ tag: 'summary' }], toDOM: () => ['summary', 0] },
  image: { inline: true, group: 'inline', draggable: true, attrs: { src: {}, alt: { default: null }, title: { default: null } }, parseDOM: [{ tag: 'img', getAttrs: dom => ({ src: dom.getAttribute('src'), alt: dom.getAttribute('alt'), title: dom.getAttribute('title') }) }], toDOM: n => ['img', Object.fromEntries(Object.entries(n.attrs).filter(([,v]) => v !== null))] },
  text: { group: 'inline' },
  hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
}, marks: {
  strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
  em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
  del: { parseDOM: [{ tag: 'del' }, { tag: 's' }], toDOM: () => ['del', 0] },
  code: { code: true, parseDOM: [{ tag: 'code', getAttrs: dom => dom.parentElement?.tagName === 'PRE' ? false : null }], toDOM: () => ['code', 0] },
  link: { attrs: { href: { default: null }, title: { default: null } }, inclusive: false, parseDOM: [{ tag: 'a', getAttrs: dom => ({ href: dom.getAttribute('href'), title: dom.getAttribute('title') }) }], toDOM: n => ['a', Object.fromEntries(Object.entries(n.attrs).filter(([,v]) => v !== null)), 0] },
} });

export function parseSource(html, document) {
  const container = document.createElement('div'); container.innerHTML = html;
  // ProseMirror is a schema model, not a sanitizer. Unknown content fails closed;
  // server normalization is the trust boundary for every write.
  const allowed = new Set('p br hr strong em del blockquote h1 h2 h3 h4 h5 h6 ul ol li a pre code table thead tbody tr th td figure figcaption img details summary span div'.split(' '));
  for (const element of container.querySelectorAll('*')) {
    if (!allowed.has(element.localName) || (['span','div'].includes(element.localName) && !['math-inline','math-block','missing-media'].includes(element.getAttribute('data-note-kind')))) throw new Error(`无法安全编辑节点 ${element.localName}；请保留原稿并导出。`);
  }
  // Wrap direct list/figure inline runs for the editor model, then unwrap on export.
  for (const element of [container, ...container.querySelectorAll('li,figure,th,td,details,blockquote')]) {
    let paragraph = null;
    for (const child of [...element.childNodes]) {
      const inline = child.nodeType === 3 || ['BR','STRONG','EM','DEL','A','CODE','IMG','SPAN'].includes(child.nodeName);
      if (inline) { if (!paragraph) { paragraph = document.createElement('p'); paragraph.dataset.editorUnwrap = 'true'; element.insertBefore(paragraph, child); } paragraph.appendChild(child); }
      else paragraph = null;
    }
  }
  return DOMParser.fromSchema(schema).parse(container, { preserveWhitespace: 'full' });
}
export function serializeSource(doc, document) {
  const container = document.createElement('div'); container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document }));
  // Tight list semantics are tracked in the model, preserving nested list blocks.
  for (const p of container.querySelectorAll('p[data-editor-unwrap]')) p.replaceWith(...p.childNodes);
  return container.innerHTML;
}

// Inline mark order and adjacent equal marks are semantically interchangeable.
// Compare every text run, node boundary and attribute while tolerating only that
// equivalence; using parseSource on both sides would hide schema-dropped nodes.
export function sourceEquivalent(left, right, document) {
  function fingerprint(html) {
    const container = document.createElement('div'); container.innerHTML = html;
    const tokens = [];
    const attrs = node => [...node.attributes].map(a => [a.name,a.value]).sort((a,b) => a[0].localeCompare(b[0]));
    function visit(node, marks = []) {
      if (node.nodeType === 3) {
        if (!node.nodeValue) return;
        const key = JSON.stringify(marks.slice().sort()), previous = tokens.at(-1);
        if (previous?.[0] === 'text' && previous[1] === key) previous[2] += node.nodeValue; else tokens.push(['text', key, node.nodeValue]);
        return;
      }
      if (node.nodeType !== 1) { tokens.push(['other',node.nodeType,node.textContent]); return; }
      if (['strong','em','del','a'].includes(node.localName) || (node.localName === 'code' && node.parentElement?.localName !== 'pre')) {
        const mark = JSON.stringify([node.localName,attrs(node)]); for (const child of node.childNodes) visit(child, [...new Set([...marks,mark])]); return;
      }
      tokens.push(['open',node.localName,attrs(node),marks.slice().sort()]);
      for (const child of node.childNodes) visit(child, marks);
      tokens.push(['close',node.localName]);
    }
    for (const child of container.childNodes) visit(child); return JSON.stringify(tokens);
  }
  return fingerprint(left) === fingerprint(right);
}
