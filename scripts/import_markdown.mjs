import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';

const sourceRoot = process.env.CONTENT_SOURCE_DIR ?? join(process.cwd(), 'bypassAV-study-main');
const targetRoot = join(process.cwd(), 'src', 'content', 'docs');
const today = new Date().toISOString().slice(0, 10);

function listMarkdownFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function getCategory(relativePath) {
  const firstSegment = relativePath.split(sep)[0] ?? '未分类';
  if (firstSegment.toLowerCase() === 'readme.md') {
    return '站点说明';
  }
  return firstSegment.replace(/^\d+_/, '').replaceAll('_', ' ');
}

function getOrder(fileName) {
  const match = fileName.match(/课时(\d+)/);
  if (!match) {
    return 0;
  }
  return Number.parseInt(match[1], 10);
}

function getTitle(fileName) {
  const name = basename(fileName, extname(fileName));
  if (name.toLowerCase() === 'readme') {
    return '知识库说明';
  }
  return name.replace(/^课时\d+_?/, '').replaceAll('_', ' ');
}

function inferTags(category, title) {
  const text = `${category} ${title}`;
  const tags = new Set();
  const rules = [
    ['C++', /C\+\+|C&C\+\+/i],
    ['Windows', /Windows|Win32|PE|内核|驱动|注册表|线程|进程/i],
    ['Win32', /Win32/i],
    ['Kernel', /内核|驱动|IRQL|SSDT/i],
    ['PE', /\bPE\b|导入表|导出表|重定位|资源表/i],
    ['x86', /x86/i],
    ['x64', /x64|x86_64/i],
    ['Reverse', /逆向|汇编|Hook|反调试/i],
    ['Network', /网络|TCP|UDP|HTTP|Socket|套接字/i],
    ['IPC', /进程通信|管道|邮槽|剪切板|文件映射|COPYDATA/i]
  ];
  for (const [tag, pattern] of rules) {
    if (pattern.test(text)) {
      tags.add(tag);
    }
  }
  if (tags.size === 0) {
    tags.add('Notes');
  }
  return Array.from(tags);
}

function escapeYaml(value) {
  return JSON.stringify(value);
}

function stripFrontmatter(content) {
  if (!content.startsWith('---')) {
    return content;
  }
  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return content;
  }
  return content.slice(endIndex + 5).replace(/^\r?\n/, '');
}

function normalizeCodeFenceLanguages(content) {
  const languageMap = new Map([
    ['c++', 'cpp'],
    ['c#', 'csharp'],
    ['gdb', 'plaintext'],
    ['def', 'plaintext'],
    ['nasm', 'plaintext'],
    ['vba', 'plaintext'],
    ['原始函数:', 'plaintext']
  ]);
  return content.replace(/^```([^\r\n]*)$/gm, (line, languageInfo) => {
    const trimmedLanguage = languageInfo.trim();
    if (trimmedLanguage.length === 0) {
      return line;
    }
    const firstToken = trimmedLanguage.split(/\s+/)[0].toLowerCase();
    const normalizedLanguage = languageMap.get(firstToken);
    if (!normalizedLanguage) {
      return line;
    }
    return `\`\`\`${normalizedLanguage}`;
  });
}

function normalizeMarkdown(content) {
  return normalizeCodeFenceLanguages(stripFrontmatter(content).replace(/\u0000/g, ''));
}

function createFrontmatter({ title, category, tags, order }) {
  const tagsYaml = tags.map((tag) => `  - ${escapeYaml(tag)}`).join('\n');
  return [
    '---',
    `title: ${escapeYaml(title)}`,
    `description: ${escapeYaml(`${category} - ${title}`)}`,
    `category: ${escapeYaml(category)}`,
    'tags:',
    tagsYaml,
    `date: ${today}`,
    `updated: ${today}`,
    'draft: false',
    `order: ${order}`,
    '---',
    ''
  ].join('\n');
}

function importMarkdownFiles() {
  if (!existsSync(sourceRoot)) {
    throw new Error(`源目录不存在：${sourceRoot}`);
  }
  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });
  const files = listMarkdownFiles(sourceRoot);
  for (const sourceFile of files) {
    const relativePath = relative(sourceRoot, sourceFile);
    const targetFile = join(targetRoot, relativePath);
    const category = getCategory(relativePath);
    const title = getTitle(sourceFile);
    const order = getOrder(sourceFile);
    const tags = inferTags(category, title);
    const rawContent = readFileSync(sourceFile, 'utf8');
    const content = normalizeMarkdown(rawContent);
    const frontmatter = createFrontmatter({ title, category, tags, order });
    mkdirSync(dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, `${frontmatter}${content.trim()}\n`, 'utf8');
  }
  const assetsSource = join(sourceRoot, 'images');
  const assetsTarget = join(process.cwd(), 'public', 'imported-images');
  if (existsSync(assetsSource)) {
    rmSync(assetsTarget, { recursive: true, force: true });
    cpSync(assetsSource, assetsTarget, { recursive: true });
  }
  console.log(`Imported ${files.length} Markdown files to ${targetRoot}`);
}

importMarkdownFiles();
