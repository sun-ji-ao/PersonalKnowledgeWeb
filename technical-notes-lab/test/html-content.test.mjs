import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFragment } from 'parse5';
import { convertMarkdown, normalizeHtml, renderHtml } from '../lib/html-content.mjs';
const fixture = JSON.parse(await readFile(new URL('../../doc/technical-notes-lab/batch-01/cases.json', import.meta.url), 'utf8'));
const codes = r => [...new Set(r.diagnostics.map(d => d.code))].sort();
function subset(actual, expected) { for (const [key, value] of Object.entries(expected)) { if (value && typeof value === 'object' && !Array.isArray(value)) subset(actual[key], value); else assert.deepEqual(actual[key], value); } }
for (const sample of fixture.cases) test(`HTML contract ${sample.id}`, async () => {
  const input = sample.inputHex ? Buffer.from(sample.inputHex, 'hex') : Buffer.from(sample.input);
  const result = sample.entry === 'markdown' ? await convertMarkdown(input, { filename: sample.filename, ...sample.context }) : await normalizeHtml(sample.input);
  assert.equal(result.status, sample.expected.status, JSON.stringify(result.diagnostics));
  assert.equal(result.htmlSource, sample.expected.htmlSource);
  assert.deepEqual(codes(result), [...sample.expected.diagnosticCodes].sort());
  if (sample.expected.metadataSubset) subset(result.metadata, sample.expected.metadataSubset);
  if (result.htmlSource !== null) assert.equal((await normalizeHtml(result.htmlSource)).htmlSource, result.htmlSource, 'source normalization must be idempotent');
});

test('strict metadata, byte limits, AST budget and hard timeout', async () => {
  for (const value of ['---\ntitle: x', '---\n- x\n---\ntext', '---\ntitle: a\ntitle: b\n---\ntext', '---\nx: &a [1,2]\ny: &b [*a,*a,*a,*a,*a]\nz: [*b,*b,*b,*b,*b]\n---\nx']) {
    assert.equal((await convertMarkdown(Buffer.from(value))).status, 'rejected', value);
  }
  assert.ok(codes(await convertMarkdown(Buffer.alloc(1_900_001, 65))).includes('INPUT_TOO_LARGE'));
  assert.ok(codes(await normalizeHtml('<blockquote>'.repeat(70) + 'x' + '</blockquote>'.repeat(70))).includes('AST_LIMIT'));
  assert.ok(codes(await convertMarkdown(Buffer.from('hello'), {}, { timeoutMs: 1 })).includes('TIME_LIMIT'));
  const long = await convertMarkdown(Buffer.from('a'.repeat(1_899_999)));
  assert.equal(long.status, 'ready');
});

test('hostile attributes, parser repair, protocols and canonical source remain inert', async () => {
  for (const value of ['<svg><script>alert(1)</script></svg>', '<math href="javascript:x">a</math>', '<p><a href="java&#10;script:alert(1)" onclick="x">x</a></p>', '<img src="data:image/svg+xml,x" onerror="x">', '<span data-note-kind="math-inline"><img src=x onerror=x></span>', '<iframe srcdoc="<script>x</script>">x</iframe>']) {
    const result = await normalizeHtml(value);
    assert.equal(result.status, 'review_required');
    const tree = parseFragment(result.htmlSource);
    function safe(n) { assert.ok(!['script','svg','math','iframe','input'].includes(n.tagName)); for (const a of n.attrs || []) { assert.ok(!a.name.startsWith('on')); if (['href','src'].includes(a.name)) assert.ok(!/javascript:|data:/i.test(a.value)); } for (const c of n.childNodes || []) safe(c); }
    safe(tree);
  }
  assert.ok(codes(await normalizeHtml('<strong>unclosed')).includes('HTML_REPAIRED'));
  const anchors = await normalizeHtml('<h2 id="section-8">A</h2><h2 id="section-8">B</h2><h6>C</h6><p><a href="#section-8">go</a></p>');
  assert.match(anchors.htmlSource, /id="section-8"/);
  assert.equal(new Set(anchors.headings.map(h => h.id)).size, 3);
  assert.ok(codes(anchors).includes('ANCHOR_REASSIGNED'));
});

test('language aliases and complex source text survive normalization', async () => {
  for (const [alias, canonical] of [['c++','cpp'],['c#','csharp'],['cmd','bat'],['x86','asm'],['js','javascript']]) {
    const result = await convertMarkdown(Buffer.from('```' + alias + '\n  a < b && c;\n\n```'));
    assert.match(result.htmlSource, new RegExp(`language-${canonical}`));
    assert.ok(result.htmlSource.includes('  a &lt; b &amp;&amp; c;\n\n'));
    assert.equal((await normalizeHtml(result.htmlSource)).htmlSource, result.htmlSource);
  }
});

test('review regressions: meaningful spaces, compatibility blocks, cyclic metadata and expanded HTML', async () => {
  const list = await convertMarkdown(Buffer.from('- **A** *B*'));
  assert.ok(list.htmlSource.includes('<strong>A</strong> <em>B</em>'));
  const inline = await normalizeHtml('<p>A<u>B</u>C</p>');
  assert.equal((await normalizeHtml(inline.htmlSource)).htmlSource, inline.htmlSource);
  assert.equal(inline.status, 'review_required');
  assert.equal((await convertMarkdown(Buffer.from('---\na: &a [*a]\n---\nHi'))).status, 'rejected');
  assert.ok(codes(await convertMarkdown(Buffer.from('<strong>unclosed'))).includes('HTML_REPAIRED'));
  const expanded = await convertMarkdown(Buffer.from('```text\n' + '<'.repeat(500000) + '\n```'));
  assert.equal((await normalizeHtml(expanded.htmlSource)).htmlSource, expanded.htmlSource);
  const hidden = await normalizeHtml('<section><h1 id="hidden">Hidden</h1></section><a href="#hidden">Go</a>');
  assert.equal((await normalizeHtml(hidden.htmlSource)).htmlSource, hidden.htmlSource);
  assert.ok(codes(hidden).includes('LINK_UNRESOLVED'));
  assert.ok(codes(await normalizeHtml('<p src="x">x</p>')).includes('UNSAFE_ATTRIBUTE_REMOVED'));
});

test('display generation binds source hash, preserves source and blocks failures', async () => {
  const result = await convertMarkdown(Buffer.from('```js\nconst x = 1;\n```\n\n$x^2$\n\n```mermaid\nflowchart LR\n A-->B\n```'));
  const shown = await renderHtml(result);
  assert.equal(shown.renderStatus, 'ready', JSON.stringify(shown));
  assert.equal(shown.sourceHash, result.sourceHash);
  assert.match(shown.htmlRendered, /class="shiki/);
  assert.match(shown.htmlRendered, /class="katex"/);
  assert.match(shown.htmlRendered, /class="mermaid"/);
  assert.equal(shown.htmlSource, result.htmlSource);
  for (const text of ['$$\n\\notARealCommand{x}\n$$', '```mermaid\nnot-a-valid-diagram!\n```']) {
    const source = await convertMarkdown(Buffer.from(text));
    const display = await renderHtml(source);
    assert.equal(display.renderStatus, 'failed'); assert.equal(display.publishable, false); assert.equal(display.htmlSource, source.htmlSource);
  }
});

test('on-demand highlighting covers mixed languages and plain-text fallbacks', async () => {
  const source = await convertMarkdown(Buffer.from('```js\nconst x = 1;\n```\n\n```python\nprint(2)\n```\n\n```text\nplain <text>\n```\n\n```unknown-language\nfallback & source\n```'));
  const shown = await renderHtml(source);
  assert.equal(shown.renderStatus, 'ready', JSON.stringify(shown.diagnostics));
  assert.equal(shown.htmlSource, source.htmlSource);
  const tree = parseFragment(shown.htmlRendered);
  const blocks = tree.childNodes.filter(n => n.tagName === 'pre');
  assert.equal(blocks.length, 4);
  const content = n => n.nodeName === '#text' ? n.value : (n.childNodes || []).map(content).join('');
  assert.deepEqual(blocks.map(content), ['const x = 1;\n', 'print(2)\n', 'plain <text>\n', 'fallback & source\n']);
  for (const html of ['<p>plain article</p>', '<p><span data-note-kind="math-inline">x^2</span></p>']) {
    const rendered = await renderHtml(await normalizeHtml(html));
    assert.equal(rendered.renderStatus, 'ready', JSON.stringify(rendered.diagnostics));
  }
});

test('final review: valid content models, repair diagnostics, clean TOC and bounded rendering', async () => {
  for (const value of ['<h1>A<u>B</u>C</h1>', '<ul><p>Bad</p></ul>', '<strong><em><span>bad</span></em></strong>']) {
    const result = await normalizeHtml(value); assert.equal(result.status, 'review_required');
    assert.equal((await normalizeHtml(result.htmlSource)).htmlSource, result.htmlSource);
    assert.match(result.htmlSource, /^<pre data-note-kind="unsupported">/);
  }
  for (const value of ['</strong>hello','<table>before<tr><td>x</td></tr>after</table>']) assert.ok(codes(await normalizeHtml(value)).includes('HTML_REPAIRED'));
  const heading = await normalizeHtml('<h1>A<script>hidden</script>B</h1>'); assert.equal(heading.headings[0].text, 'AB');
  const source = await convertMarkdown(Buffer.from('$\\sqrt{x}$ and $\\overrightarrow{AB}$'));
  const rendered = await renderHtml(source); assert.equal(rendered.renderStatus, 'ready', JSON.stringify(rendered.diagnostics));
  const timed = await renderHtml(source, { timeoutMs: 1 }); assert.equal(timed.htmlSource, source.htmlSource); assert.equal(timed.renderStatus, 'failed'); assert.equal(timed.publishable, false);
});
