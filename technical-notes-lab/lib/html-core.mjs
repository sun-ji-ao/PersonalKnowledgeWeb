// Pure conversion implementation. Public callers use html-content.mjs's bounded worker.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { parseDocument } from 'yaml';
import { parseFragment, serializeOuter, Tokenizer, TokenizerMode } from 'parse5';
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({ bytes: 1_900_000, htmlBytes: 11_400_000, depth: 64, nodes: 50_000, timeoutMs: 10_000, mathChars: 10_000, diagramChars: 50_000 });
export const VERSIONS = Object.freeze({ schema: 'notes-html/1', converter: '2.0.0', sanitizer: '2.0.0', renderer: '2.0.1' });
export const escapeText = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttribute = text => escapeText(text).replaceAll('"', '&quot;');
const element = (tag, content = '', attrs = {}) => `<${tag}${Object.keys(attrs).sort().map(k => ` ${k}="${escapeAttribute(attrs[k])}"`).join('')}>${['br', 'hr', 'img'].includes(tag) ? '' : `${content}</${tag}>`}`;
const aliases = { 'c++': 'cpp', 'c#': 'csharp', js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', cmd: 'bat', batch: 'bat', assembly: 'asm', x86: 'asm', nasm: 'asm', ps1: 'powershell' };
export const languages = ['text', 'javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css', 'sql', 'yaml', 'markdown', 'java', 'c', 'cpp', 'csharp', 'asm', 'bat', 'xml', 'go', 'rust', 'powershell'];
const supported = new Set('p br hr strong em del blockquote h1 h2 h3 h4 h5 h6 ul ol li a pre code table thead tbody tr th td figure figcaption img details summary span div'.split(' '));
const dangerous = new Set('script style iframe object embed svg math form input button textarea select option link meta base template noscript'.split(' '));
const inline = new Set('p h1 h2 h3 h4 h5 h6 a strong em del code span summary figcaption th td li'.split(' '));
const nodeText = n => n.nodeName === '#text' ? n.value : (n.childNodes || []).map(nodeText).join('');
const hash = value => createHash('sha256').update(value).digest('hex');

export function diagnostic(code, message, node = null, blocksPublishing = true, severity = 'warning') {
  const pos = node?.position?.start || node?.sourceCodeLocation;
  return { code, severity, blocksPublishing, location: pos ? { line: pos.line ?? pos.startLine, column: pos.column ?? pos.startCol } : null, message };
}
export function rejected(code, message) {
  return { schemaVersion: VERSIONS.schema, versions: VERSIONS, status: 'rejected', htmlSource: null, metadata: {}, diagnostics: [diagnostic(code, message, null, true, 'error')] };
}
export function collectReferencesCore(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > LIMITS.bytes) return rejected('INPUT_TOO_LARGE', 'Invalid or oversized reference input.');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return rejected('INVALID_UTF8', 'Invalid UTF-8.'); }
  const tree = unified().use(remarkParse).parse(source); budget(tree, 'children');
  const refs = []; const definitions = new Map(); const stack = [tree];
  while (stack.length) {
    const n = stack.pop();
    if (n.type === 'definition') definitions.set(n.identifier, n.url);
    if (n.type === 'image' || n.type === 'link') refs.push({ kind: n.type, url: n.url });
    if (n.type === 'imageReference' || n.type === 'linkReference') refs.push({ kind: n.type === 'imageReference' ? 'image' : 'link', identifier: n.identifier });
    if (n.type === 'html') {
      const fragment = parseFragment(n.value); budget(fragment, 'childNodes');
      const nodes = [...fragment.childNodes];
      while (nodes.length) { const el = nodes.pop(); for (const a of el.attrs || []) { if (el.tagName === 'img' && a.name === 'src') refs.push({ kind: 'image', url: a.value }); if (el.tagName === 'a' && a.name === 'href') refs.push({ kind: 'link', url: a.value }); } nodes.push(...(el.childNodes || [])); }
    }
    stack.push(...(n.children || []));
  }
  return { references: refs.map(r => ({ ...r, url: r.url ?? definitions.get(r.identifier) })).filter(r => typeof r.url === 'string') };
}
function budget(root, childrenKey) {
  const pending = [[root, 0]]; let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (++count > LIMITS.nodes || depth > LIMITS.depth) throw new Error('AST_LIMIT');
    for (const child of node[childrenKey] || []) pending.push([child, depth + 1]);
  }
}
function language(value, diagnostics, node) {
  let lang = aliases[value?.toLowerCase()] || value?.toLowerCase() || 'text';
  if (!/^[a-z0-9_-]{1,40}$/.test(lang)) { diagnostics.push(diagnostic('INVALID_CODE_LANGUAGE', 'Invalid language identifier; retained as plain text.', node)); lang = 'text'; }
  else if (!languages.includes(lang)) diagnostics.push(diagnostic('UNKNOWN_CODE_LANGUAGE', `Plain-text display fallback: ${lang}`, node, false, 'info'));
  return lang;
}
function metadataFor(source, filename, tree, diagnostics) {
  const h1 = tree.children.find(n => n.type === 'heading' && n.depth === 1);
  const mdText = n => n.value || (n.children || []).map(mdText).join('');
  const title = String(source.title || (h1 && mdText(h1)) || filename.replace(/\.(md|markdown)$/i, ''));
  const description = String(source.description || '');
  const rawTags = source.tags ?? source.categories ?? source.category ?? [];
  const tags = (Array.isArray(rawTags) ? rawTags : String(rawTags).split(/[,，]/)).map(String).map(s => s.trim()).filter(Boolean);
  if ([...title].length > 200 || [...description].length > 500 || tags.length > 20) diagnostics.push(diagnostic('METADATA_LIMIT', 'Metadata exceeds title/description/tag limits.'));
  return { title, description, tags, sourceMetadata: source };
}

export function convertMarkdownCore(bytes, context = {}) {
  if (!(bytes instanceof Uint8Array)) return rejected('INVALID_INPUT', 'Markdown input must be bytes.');
  if (bytes.byteLength > LIMITS.bytes) return rejected('INPUT_TOO_LARGE', 'Input exceeds 1,900,000 bytes.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/g, '\n'); }
  catch { return rejected('INVALID_UTF8', 'Input is not valid UTF-8.'); }
  const originalHash = hash(bytes);
  const diagnostics = []; let sourceMetadata = {}; let lineOffset = 0;
  if (/^---(?:\n|$)/.test(text)) {
    const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    try {
      if (!match || match[1].length > 65_536) throw new Error('Missing closing delimiter or frontmatter too large.');
      const document = parseDocument(match[1], { uniqueKeys: true, schema: 'core' });
      if (document.errors.length) throw document.errors[0];
      sourceMetadata = document.toJS({ maxAliasCount: 20 });
      if (!sourceMetadata || typeof sourceMetadata !== 'object' || Array.isArray(sourceMetadata)) throw new Error('Frontmatter must be an object.');
      if (JSON.stringify(sourceMetadata).length > 65_536) throw new Error('Expanded frontmatter exceeds limit.');
      lineOffset = match[0].split('\n').length - 1;
      text = text.slice(match[0].length);
    } catch (error) {
      const result = rejected('INVALID_FRONTMATTER', String(error.message));
      result.diagnostics[0].location = { line: (error.linePos?.[0]?.line || 1) + 1, column: error.linePos?.[0]?.col || 1 };
      return result;
    }
  }
  try {
    const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(text);
    budget(tree, 'children');
    const definitions = new Map();
    const collect = n => { if (n.type === 'definition') definitions.set(n.identifier, n); for (const c of n.children || []) collect(c); };
    collect(tree);
    const children = n => (n.children || []).map(convert).join('');
    const unknown = n => { diagnostics.push(diagnostic('UNSUPPORTED_NODE', `Unsupported Markdown node: ${n.type}`, n)); return element('pre', element('code', escapeText(text.slice(n.position.start.offset, n.position.end.offset))), { 'data-note-kind': 'unsupported' }); };
    function convert(n) {
      switch (n.type) {
        case 'root': return children(n);
        case 'text': return escapeText(n.value);
        case 'paragraph': return element('p', children(n));
        case 'heading': return element(`h${n.depth}`, children(n));
        case 'strong': case 'emphasis': case 'delete': return element({ strong: 'strong', emphasis: 'em', delete: 'del' }[n.type], children(n));
        case 'inlineCode': return element('code', escapeText(n.value));
        case 'break': return '<br>';
        case 'thematicBreak': return '<hr>';
        case 'blockquote': return element('blockquote', children(n));
        case 'list': return element(n.ordered ? 'ol' : 'ul', n.children.map(item => element('li', item.children.map(c => !n.spread && !item.spread && c.type === 'paragraph' ? children(c) : convert(c)).join(''), typeof item.checked === 'boolean' ? { 'data-note-checked': String(item.checked) } : {})).join(''), n.ordered && n.start !== 1 ? { start: n.start } : {});
        case 'code': {
          if (n.lang?.toLowerCase() === 'mermaid') return element('pre', element('code', escapeText(n.value + '\n')), { 'data-note-kind': 'mermaid' });
          if (n.meta) diagnostics.push(diagnostic('CODE_META_UNSUPPORTED', 'Code fence metadata is not supported.', n));
          return element('pre', element('code', escapeText(n.value + '\n'), { class: `language-${language(n.lang, diagnostics, n)}` }));
        }
        case 'inlineMath': case 'math': return element(n.type === 'math' ? 'div' : 'span', escapeText(n.value), { 'data-note-kind': n.type === 'math' ? 'math-block' : 'math-inline' });
        case 'link': return element('a', children(n), { href: n.url, ...(n.title ? { title: n.title } : {}) });
        case 'image': return element('img', '', { src: n.url, alt: n.alt || '', ...(n.title ? { title: n.title } : {}) });
        case 'linkReference': case 'imageReference': {
          const d = definitions.get(n.identifier); if (!d) return unknown(n);
          return convert({ ...n, type: n.type === 'linkReference' ? 'link' : 'image', url: d.url, title: d.title });
        }
        case 'definition': return '';
        case 'table': return element('table', element('thead', row(n.children[0], 'th')) + (n.children.length > 1 ? element('tbody', n.children.slice(1).map(r => row(r, 'td')).join('')) : ''));
        case 'html': return n.value;
        default: return unknown(n);
      }
      function row(r, tag) { return element('tr', r.children.map((c, i) => element(tag, children(c), n.align[i] ? { 'data-note-align': n.align[i] } : {})).join('')); }
    }
    const html = children(tree);
    const metadata = metadataFor(sourceMetadata, context.filename || 'untitled.md', tree, diagnostics);
    for (const d of diagnostics) if (d.location) d.location.line += lineOffset;
    const result = normalizeHtmlCore(html, { ...context, generated: true });
    // HTML-stage offsets refer to generated markup, not to the original Markdown.
    for (const d of result.diagnostics) d.location = null;
    result.metadata = metadata;
    result.originalHash = originalHash;
    result.diagnostics = [...diagnostics, ...result.diagnostics].filter((d, i, list) => list.findIndex(x => x.code === d.code && x.message === d.message && JSON.stringify(x.location) === JSON.stringify(d.location)) === i);
    if (result.status !== 'rejected') result.status = result.diagnostics.some(d => d.blocksPublishing) ? 'review_required' : 'ready';
    return result;
  } catch (error) { return rejected(error.message === 'AST_LIMIT' ? 'AST_LIMIT' : 'CONVERSION_FAILED', error.message); }
}

export function normalizeHtmlCore(html, context = {}) {
  if (typeof html !== 'string') return rejected('INVALID_INPUT', 'HTML must be a string.');
  if (Buffer.byteLength(html) > LIMITS.htmlBytes) return rejected('INPUT_TOO_LARGE', 'HTML input exceeds 11,400,000 bytes.');
  html = html.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const diagnostics = [];
  const report = (code, message, n, block = true) => diagnostics.push(diagnostic(code, message, n, block));
  const tree = parseFragment(html, { sourceCodeLocationInfo: true, onParseError: error => report('HTML_REPAIRED', `HTML parser repair: ${error.code}`, { sourceCodeLocation: error }) });
  try { budget(tree, 'childNodes'); } catch { return rejected('AST_LIMIT', 'HTML exceeds depth/node budget.'); }
  const knownOffsets = new Set(); let lastOffset = -1;
  const trackLocations = n => {
    const loc = n.sourceCodeLocation;
    if (loc) {
      if (loc.startOffset < lastOffset) report('HTML_REPAIRED', 'HTML parser reordered content.', n);
      lastOffset = loc.startOffset;
      if (loc.startTag) knownOffsets.add(loc.startTag.startOffset);
      if (loc.endTag) knownOffsets.add(loc.endTag.startOffset);
    }
    for (const c of n.childNodes || []) trackLocations(c);
  };
  trackLocations(tree);
  let tokenizer;
  const checkToken = token => { if (!knownOffsets.has(token.location.startOffset)) report('HTML_REPAIRED', `HTML parser omitted tag: ${token.tagName}`, { sourceCodeLocation: token.location }); };
  tokenizer = new Tokenizer({ sourceCodeLocationInfo: true }, {
    onStartTag(token) { checkToken(token); if (['script','style','iframe','xmp','noembed','noframes'].includes(token.tagName)) tokenizer.state = token.tagName === 'script' ? TokenizerMode.SCRIPT_DATA : TokenizerMode.RAWTEXT; else if (['textarea','title'].includes(token.tagName)) tokenizer.state = TokenizerMode.RCDATA; },
    onEndTag: checkToken, onComment() {}, onDoctype(token) { report('HTML_REPAIRED', 'Document declaration removed from fragment.', { sourceCodeLocation: token.location }); }, onEof() {}, onCharacter() {}, onNullCharacter() {}, onWhitespaceCharacter() {}
  });
  tokenizer.write(html, true);
  const phrasingTags = new Set('a strong em del code span br img'.split(' '));
  const survivesAsPhrasing = n => {
    if (!n.tagName || dangerous.has(n.tagName)) return true;
    if (!phrasingTags.has(n.tagName)) return false;
    if (n.tagName === 'span') {
      const kind = n.attrs?.find(a => a.name === 'data-note-kind')?.value;
      return ['math-inline','missing-media'].includes(kind) && n.childNodes.every(c => c.nodeName === '#text');
    }
    if (n.tagName === 'code') return n.childNodes.every(c => c.nodeName === '#text');
    return n.childNodes.every(survivesAsPhrasing);
  };
  const invalidStructure = n => {
    const children = (n.childNodes || []).filter(c => c.nodeName !== '#text' || c.value.trim());
    const tag = n.tagName;
    if (['p','h1','h2','h3','h4','h5','h6','a','strong','em','del','summary','figcaption'].includes(tag)) return children.some(c => !survivesAsPhrasing(c));
    const models = { ul: ['li'], ol: ['li'], table: ['thead','tbody','tr'], thead: ['tr'], tbody: ['tr'], tr: ['th','td'] };
    return models[tag] && children.some(c => !models[tag].includes(c.tagName));
  };
  const ids = new Set(); const headingIds = new Map(); const headings = []; let nextId = 1;
  const validId = value => /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value || '');
  const attr = (n, name) => n.attrs?.find(a => a.name === name)?.value;
  const visitHeadings = n => {
    if (n.tagName && (!supported.has(n.tagName) || dangerous.has(n.tagName) || invalidStructure(n) || ['span','div','pre'].includes(n.tagName))) return;
    if (/^h[1-6]$/.test(n.tagName)) {
      const value = attr(n, 'id');
      if (validId(value) && !ids.has(value)) { ids.add(value); headingIds.set(n, value); }
      else if (value !== undefined) report('ANCHOR_REASSIGNED', 'Duplicate or invalid heading ID.', n);
    }
    for (const child of n.childNodes || []) visitHeadings(child);
  };
  visitHeadings(tree);
  const unsupported = n => { report('UNSUPPORTED_NODE', `Unsupported HTML structure: ${n.tagName || n.nodeName}`, n); return element('pre', element('code', escapeText(serializeOuter(n))), { 'data-note-kind': 'unsupported' }); };
  function url(value, image, node) {
    if (/[\u0000-\u0020\u007f]/.test(value) || /^(?:\/\/|\\|[a-z]:[\\/])/i.test(value)) { report('UNSAFE_URL_REMOVED', 'Unsafe URL removed.', node); return null; }
    const map = image ? context.mediaMap : context.articleMap;
    if (map && Object.hasOwn(map, value)) value = map[value];
    if (typeof value !== 'string') { report('UNSAFE_URL_REMOVED', 'Invalid resource mapping.', node); return null; }
    if (/^https:\/\//i.test(value) || (!image && /^(?:http:\/\/|mailto:)/i.test(value))) {
      try { const parsed = new URL(value); if (parsed.username || parsed.password) throw new Error(); return value; } catch { report('UNSAFE_URL_REMOVED', 'Invalid URL removed.', node); return null; }
    }
    if (image && /^\/media\/[A-Za-z0-9_-]+$/.test(value)) return value;
    if (!image && /^\/(?:notes|media)\/[A-Za-z0-9_-]+(?:#[A-Za-z][A-Za-z0-9_-]{0,79})?$/.test(value)) return value;
    if (!image && value.startsWith('#')) { if (ids.has(value.slice(1))) return value; report('LINK_UNRESOLVED', `Missing anchor: ${value}`, node); return null; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/')) { report('UNSAFE_URL_REMOVED', 'Unsupported URL protocol or absolute path.', node); return null; }
    report(image ? 'MISSING_MEDIA' : 'LINK_UNRESOLVED', `Unresolved resource: ${value}`, node);
    return null;
  }
  // Allocate heading IDs before resolving fragment links, including links before headings.
  const allocate = n => {
    if (n.tagName && (!supported.has(n.tagName) || dangerous.has(n.tagName) || invalidStructure(n) || ['span','div','pre'].includes(n.tagName))) return;
    if (/^h[1-6]$/.test(n.tagName) && !headingIds.has(n)) { while (ids.has(`section-${nextId}`)) nextId++; const id = `section-${nextId++}`; ids.add(id); headingIds.set(n, id); }
    for (const c of n.childNodes || []) allocate(c);
  };
  allocate(tree);
  function clean(n, parent = '') {
    if (n.nodeName === '#text') {
      if (!inline.has(parent) && parent !== 'pre' && /^\s+$/.test(n.value)) {
        const siblings = n.parentNode?.childNodes || []; const index = siblings.indexOf(n);
        const phrasing = child => child && (child.nodeName === '#text' || ['a','strong','em','del','code','span','img'].includes(child.tagName));
        if (!phrasing(siblings[index - 1]) || !phrasing(siblings[index + 1])) return '';
      }
      return escapeText(n.value);
    }
    if (n.nodeName === '#comment') { report('UNSUPPORTED_NODE', 'HTML comment removed.', n); return ''; }
    const tag = n.tagName;
    if (!tag) return (n.childNodes || []).map(c => clean(c)).join('');
    if (dangerous.has(tag)) { report('UNSAFE_ELEMENT_REMOVED', `Removed element: ${tag}`, n); return ''; }
    if (!supported.has(tag) || invalidStructure(n)) return unsupported(n);
    const original = Object.fromEntries((n.attrs || []).map(a => [a.name, a.value])); const attrs = {};
    const kind = original['data-note-kind'];
    const validKind = (tag === 'span' && ['math-inline', 'missing-media'].includes(kind)) || (tag === 'div' && kind === 'math-block') || (tag === 'pre' && ['mermaid', 'unsupported'].includes(kind));
    if (['span', 'div'].includes(tag) && !validKind) return unsupported(n);
    if (validKind) {
      attrs['data-note-kind'] = kind;
      if (kind === 'missing-media') { attrs['data-note-path'] = original['data-note-path'] || ''; report('MISSING_MEDIA', `Unresolved resource: ${attrs['data-note-path']}`, n); }
      if (kind === 'unsupported') report('UNSUPPORTED_NODE', 'Unresolved unsupported content.', n);
      const validChildren = ['mermaid', 'unsupported'].includes(kind) ? n.childNodes.length === 1 && n.childNodes[0].tagName === 'code' && (n.childNodes[0].childNodes || []).every(c => c.nodeName === '#text') : n.childNodes.every(c => c.nodeName === '#text');
      if (!validChildren) return unsupported(n);
    }
    if (tag === 'pre' && !validKind && !(n.childNodes.length === 1 && n.childNodes[0].tagName === 'code' && n.childNodes[0].childNodes.every(c => c.nodeName === '#text'))) return unsupported(n);
    if (tag === 'details' && n.childNodes.find(c => c.nodeName !== '#text' || c.value.trim())?.tagName !== 'summary') return unsupported(n);
    if (/^h[1-6]$/.test(tag)) { attrs.id = headingIds.get(n); headings.push({ id: attrs.id, level: Number(tag[1]), text: nodeText(n) }); }
    if (tag === 'ol' && /^[1-9]\d{0,8}$/.test(original.start || '')) attrs.start = original.start;
    if (tag === 'li' && ['true', 'false'].includes(original['data-note-checked'])) attrs['data-note-checked'] = original['data-note-checked'];
    if (['th', 'td'].includes(tag) && ['left', 'center', 'right'].includes(original['data-note-align'])) attrs['data-note-align'] = original['data-note-align'];
    if (['a', 'img'].includes(tag) && original.title !== undefined) attrs.title = original.title;
    if (tag === 'a' && original.href !== undefined) { const href = url(original.href, false, n); if (href !== null) attrs.href = href; }
    if (tag === 'img') {
      attrs.alt = original.alt || '';
      const src = url(original.src || '', true, n);
      if (src === null) return element('span', escapeText(attrs.alt), { 'data-note-kind': 'missing-media', 'data-note-path': original.src || '' });
      attrs.src = src;
    }
    if (tag === 'code' && parent === 'pre' && !['mermaid', 'unsupported'].includes(attr(n.parentNode, 'data-note-kind'))) {
      const cls = original.class || 'language-text';
      if (!cls.startsWith('language-')) report('INVALID_CODE_LANGUAGE', 'Invalid code class; retained as plain text.', n);
      attrs.class = `language-${language(cls.startsWith('language-') ? cls.slice(9) : '', diagnostics, n)}`;
    }
    for (const name of Object.keys(original)) {
      if (!Object.hasOwn(attrs, name) && !(name === 'href' && tag === 'a') && !(name === 'src' && tag === 'img') && !(name === 'id' && /^h[1-6]$/.test(tag))) report('UNSAFE_ATTRIBUTE_REMOVED', `Removed attribute: ${name}`, n);
    }
    if (n.sourceCodeLocation && !n.sourceCodeLocation.endTag && !['img', 'hr', 'br', 'p', 'li', 'td', 'th', 'tr', 'thead', 'tbody'].includes(tag)) report('HTML_REPAIRED', `Unclosed element: ${tag}`, n);
    return element(tag, validKind && ['math-inline', 'math-block', 'missing-media'].includes(kind) ? escapeText(nodeText(n)) : n.childNodes.map(c => clean(c, tag)).join(''), attrs);
  }
  let htmlSource = clean(tree);
  // A compatibility block replacing an inline node can force paragraph splitting.
  // Reparse that result before returning it, so the stored fragment is valid and stable.
  if (!context.canonicalPass) {
    const stable = normalizeHtmlCore(htmlSource, { ...context, canonicalPass: true });
    if (stable.status === 'rejected') return stable;
    if (stable.htmlSource !== htmlSource) { htmlSource = stable.htmlSource; report('HTML_REPAIRED', 'Normalized block/inline structure.', null); }
  }
  const finalHeadings = []; const readHeadings = n => { if (/^h[1-6]$/.test(n.tagName)) finalHeadings.push({ id: attr(n, 'id'), level: Number(n.tagName[1]), text: nodeText(n) }); for (const c of n.childNodes || []) readHeadings(c); };
  readHeadings(parseFragment(htmlSource));
  return { schemaVersion: VERSIONS.schema, versions: VERSIONS, status: diagnostics.some(d => d.blocksPublishing) ? 'review_required' : 'ready', htmlSource, sourceHash: hash(htmlSource), metadata: {}, headings: finalHeadings, diagnostics };
}
