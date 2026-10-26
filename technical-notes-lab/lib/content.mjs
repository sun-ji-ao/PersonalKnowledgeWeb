import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import { createHighlighter } from 'shiki';
import { parse as parseYaml } from 'yaml';

export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function importMarkdown(source, filename = '未命名笔记.md') {
  let markdown = String(source).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  let metadata = {};
  const match = markdown.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (match) {
    metadata = parseYaml(match[1], { maxAliasCount: 20 }) || {};
    if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('frontmatter 必须是 YAML 对象');
    markdown = markdown.slice(match[0].length);
  }
  const tags = metadata.tags ?? metadata.categories ?? metadata.category ?? [];
  return {
    title: String(metadata.title || markdown.match(/^#\s+(.+)$/m)?.[1] || filename.replace(/\.(md|markdown)$/i, '')).slice(0, 200),
    description: String(metadata.description || '').slice(0, 500),
    tags: (Array.isArray(tags) ? tags : String(tags).split(/[,，]/)).map(String).map(t => t.trim()).filter(Boolean).slice(0, 20),
    markdown,
    // Original dates/flags are retained as provenance; imports always stay private drafts.
    sourceMetadata: metadata,
  };
}

const highlighter = createHighlighter({ themes: ['github-dark'], langs: ['javascript', 'typescript', 'python', 'bash', 'json', 'html', 'css', 'sql', 'yaml', 'markdown', 'java', 'c', 'cpp', 'csharp', 'asm', 'bat', 'xml', 'go', 'rust', 'powershell'] });
const aliases = { 'c++': 'cpp', 'c#': 'csharp', js: 'javascript', ts: 'typescript', shell: 'bash', sh: 'bash', cmd: 'bat', batch: 'bat', assembly: 'asm', x86: 'asm', nasm: 'asm', ps1: 'powershell' };
function walk(node, fn) { fn(node); for (const child of node.children || []) walk(child, fn); }
function nodeText(node) { return node.value || (node.children || []).map(nodeText).join(''); }
export async function renderMarkdown(markdown) {
  const shiki = await highlighter;
  const headings = [];
  let headingIndex = 0;
  const result = await unified().use(remarkParse).use(remarkGfm).use(remarkMath)
    .use(remarkRehype) // Raw author HTML is deliberately omitted.
    .use(() => tree => {
      walk(tree, node => {
        if (node.type !== 'element') return;
        if (/^h[1-4]$/.test(node.tagName)) {
          const id = `section-${++headingIndex}`;
          node.properties = { ...node.properties, id };
          headings.push({ id, level: Number(node.tagName[1]), text: nodeText(node) });
        }
        for (const attr of ['href', 'src']) {
          const value = node.properties?.[attr];
          if (value) {
            try { if (!['http:', 'https:', 'mailto:'].includes(new URL(String(value), 'http://localhost').protocol)) delete node.properties[attr]; }
            catch { delete node.properties[attr]; }
          }
        }
        if (node.tagName !== 'pre' || node.children?.[0]?.tagName !== 'code') return;
        const code = node.children[0];
        const requested = (code.properties?.className || []).find(c => c.startsWith('language-'))?.slice(9).toLowerCase() || 'text';
        const lang = aliases[requested] || requested;
        if (lang === 'mermaid') { node.properties = { className: ['mermaid'] }; node.children = [{ type: 'text', value: nodeText(code) }]; return; }
        if (lang === 'math') return;
        const resolved = shiki.getLoadedLanguages().includes(lang) ? lang : 'text';
        const highlighted = shiki.codeToHast(nodeText(code).replace(/\n$/, ''), { lang: resolved, theme: 'github-dark' }).children.find(n => n.type === 'element');
        Object.assign(node, highlighted);
      });
    }).use(rehypeKatex, { throwOnError: false, trust: false, strict: 'warn' }).use(rehypeStringify).process(markdown);
  return { html: String(result), headings };
}
