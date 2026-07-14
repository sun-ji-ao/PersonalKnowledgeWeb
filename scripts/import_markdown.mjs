import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, sep } from 'node:path';

const sourceRoot = process.env.CONTENT_SOURCE_DIR ?? join(process.cwd(), 'bypassAV-study-main');
const targetRoot = join(process.cwd(), 'src', 'content', 'docs');
const importedImagesRoot = join(process.cwd(), 'public', 'imported-images');
const contentRulesPath = join(process.cwd(), 'content_rules.json');
const contentDatesPath = join(process.cwd(), 'content_dates.json');
const today = new Date().toISOString().slice(0, 10);
const defaultContentDates = {
  realDateSince: '2026-05-01',
  legacyPlaceholderDate: '2021-01-01',
  articles: {}
};
const defaultContentRules = {
  draftPathPrefixes: [],
  draftPathIncludes: [],
  draftCategories: [],
  draftTitles: [],
  draftTags: []
};

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

function parseArticleFileName(fileName) {
  const name = basename(fileName, extname(fileName));
  if (name.toLowerCase() === 'readme') {
    return { order: 0, title: '知识库说明' };
  }
  const lessonMatch = name.match(/^课时(\d+)_?(.*)$/i);
  if (lessonMatch) {
    return {
      order: Number.parseInt(lessonMatch[1], 10),
      title: lessonMatch[2].replaceAll('_', ' ')
    };
  }
  const numericMatch = name.match(/^(\d+)_(.+)$/);
  if (numericMatch) {
    return {
      order: Number.parseInt(numericMatch[1], 10),
      title: numericMatch[2]
    };
  }
  return { order: 0, title: name.replaceAll('_', ' ') };
}

function getOrder(fileName) {
  return parseArticleFileName(fileName).order;
}

function getTitle(fileName) {
  return parseArticleFileName(fileName).title;
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

function loadContentRules() {
  if (!existsSync(contentRulesPath)) {
    return defaultContentRules;
  }
  const rawRules = JSON.parse(readFileSync(contentRulesPath, 'utf8'));
  return {
    ...defaultContentRules,
    ...rawRules
  };
}

function normalizePath(value) {
  return value.split(sep).join('/').replace(/\\/g, '/');
}

function normalizeComparable(value) {
  return value.trim().toLowerCase();
}

function normalizeRuleList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter((value) => typeof value === 'string').map((value) => normalizeComparable(value));
}

function shouldMarkDraft({ relativePath, category, title, tags }, rules) {
  const normalizedPath = normalizeComparable(normalizePath(relativePath));
  const normalizedCategory = normalizeComparable(category);
  const normalizedTitle = normalizeComparable(title);
  const normalizedTags = tags.map((tag) => normalizeComparable(tag));
  const draftPathPrefixes = normalizeRuleList(rules.draftPathPrefixes);
  const draftPathIncludes = normalizeRuleList(rules.draftPathIncludes);
  const draftCategories = normalizeRuleList(rules.draftCategories);
  const draftTitles = normalizeRuleList(rules.draftTitles);
  const draftTags = normalizeRuleList(rules.draftTags);
  return (
    draftPathPrefixes.some((prefix) => normalizedPath.startsWith(prefix)) ||
    draftPathIncludes.some((fragment) => normalizedPath.includes(fragment)) ||
    draftCategories.includes(normalizedCategory) ||
    draftTitles.includes(normalizedTitle) ||
    draftTags.some((tag) => normalizedTags.includes(tag))
  );
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

function isExternalAssetUrl(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function splitMarkdownImageTarget(value) {
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith('<')) {
    const closingIndex = trimmedValue.indexOf('>');
    if (closingIndex === -1) {
      return { url: trimmedValue, suffix: '' };
    }
    return {
      url: trimmedValue.slice(1, closingIndex),
      suffix: trimmedValue.slice(closingIndex + 1)
    };
  }
  const match = trimmedValue.match(/^(\S+)(.*)$/s);
  if (!match) {
    return { url: trimmedValue, suffix: '' };
  }
  return {
    url: match[1],
    suffix: match[2] ?? ''
  };
}

function createImagePublicPath(sourceImagePath, sourceMarkdownFile) {
  const markdownDirectory = dirname(sourceMarkdownFile);
  const markdownRelativeDirectory = normalizePath(relative(sourceRoot, markdownDirectory));
  const targetDirectory = join(importedImagesRoot, markdownRelativeDirectory);
  const targetImagePath = join(targetDirectory, basename(sourceImagePath));
  mkdirSync(targetDirectory, { recursive: true });
  cpSync(sourceImagePath, targetImagePath);
  const publicRelativePath = normalizePath(relative(join(process.cwd(), 'public'), targetImagePath));
  return `/${encodeURI(publicRelativePath).replace(/%2F/g, '/')}`;
}

function resolveImagePath(imageUrl, sourceMarkdownFile) {
  const decodedUrl = decodeURI(imageUrl);
  const candidatePaths = [
    join(dirname(sourceMarkdownFile), decodedUrl),
    join(sourceRoot, decodedUrl)
  ];
  return candidatePaths.find((candidatePath) => existsSync(candidatePath));
}

function rewriteImageUrl(imageUrl, sourceMarkdownFile) {
  if (!imageUrl || isExternalAssetUrl(imageUrl) || imageUrl.startsWith('/')) {
    return imageUrl;
  }
  const sourceImagePath = resolveImagePath(imageUrl, sourceMarkdownFile);
  if (!sourceImagePath) {
    return imageUrl;
  }
  return createImagePublicPath(sourceImagePath, sourceMarkdownFile);
}

function rewriteMarkdownImages(content, sourceMarkdownFile) {
  const markdownImagePattern = /!\[([^\]]*)\]\(([^)\r\n]+)\)/g;
  const htmlImagePattern = /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi;
  return content
    .replace(markdownImagePattern, (fullMatch, altText, rawTarget) => {
      const { url, suffix } = splitMarkdownImageTarget(rawTarget);
      const rewrittenUrl = rewriteImageUrl(url, sourceMarkdownFile);
      if (rewrittenUrl === url) {
        return fullMatch;
      }
      return `![${altText}](${rewrittenUrl}${suffix})`;
    })
    .replace(htmlImagePattern, (fullMatch, prefix, url, suffix) => {
      const rewrittenUrl = rewriteImageUrl(url, sourceMarkdownFile);
      if (rewrittenUrl === url) {
        return fullMatch;
      }
      return `${prefix}${rewrittenUrl}${suffix}`;
    });
}

function removeLeadingTitleHeading(content) {
  const headingPattern = /^\s*#\s+.+?(?:\r?\n|$)/;
  const match = content.match(headingPattern);
  if (!match) {
    return content;
  }
  return content.slice(match[0].length).replace(/^\r?\n/, '');
}

function hasHeadingNumber(text) {
  return /^\s*(?:\d+(?:\.\d+)*[、.．:：\s]|[一二三四五六七八九十百千万]+[、.．:：]|[（(][一二三四五六七八九十百千万\d]+[）)]|第[一二三四五六七八九十百千万\d]+[章节课时篇部分])/.test(text);
}

function getHeadingNumberParts(text) {
  const match = text.trim().match(/^(\d+(?:\.\d+)*)(?=[、.．:：\s])/);
  return match ? match[1].split('.').map((part) => Number.parseInt(part, 10)) : null;
}

function syncHeadingCounters(counters, level, numberParts) {
  if (numberParts) {
    for (let index = 0; index <= level; index += 1) {
      counters[index] = numberParts[index] ?? 1;
    }
  } else {
    for (let index = 0; index < level; index += 1) {
      counters[index] = counters[index] || 1;
    }
    counters[level] += 1;
  }
  for (let index = level + 1; index < counters.length; index += 1) {
    counters[index] = 0;
  }
}

function createHeadingPrefix(counters, level) {
  const prefixParts = counters.slice(0, level + 1);
  return level === 0 ? `${prefixParts[0]}、` : `${prefixParts.join('.')}、`;
}

function numberMarkdownHeadings(content) {
  const counters = [0, 0, 0];
  let isInsideCodeFence = false;
  return content
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
        isInsideCodeFence = !isInsideCodeFence;
        return line;
      }
      if (isInsideCodeFence) {
        return line;
      }
      const match = line.match(/^(#{2,4})\s+(.+?)(\s+#+\s*)?$/);
      if (!match) {
        return line;
      }
      const level = match[1].length - 2;
      const headingText = match[2].trim();
      const trailingHashes = match[3] ?? '';
      const numberParts = getHeadingNumberParts(headingText);
      if (hasHeadingNumber(headingText)) {
        syncHeadingCounters(counters, level, numberParts);
        return line;
      }
      for (let index = 0; index < level; index += 1) {
        counters[index] = counters[index] || 1;
      }
      counters[level] += 1;
      for (let index = level + 1; index < counters.length; index += 1) {
        counters[index] = 0;
      }
      return `${match[1]} ${createHeadingPrefix(counters, level)}${headingText}${trailingHashes}`;
    })
    .join('\n');
}

function normalizeMarkdown(content, sourceMarkdownFile, title) {
  const strippedContent = stripFrontmatter(content).replace(/\u0000/g, '');
  const contentWithoutDuplicateTitle = removeLeadingTitleHeading(strippedContent);
  const contentWithNumberedHeadings = numberMarkdownHeadings(contentWithoutDuplicateTitle);
  return normalizeCodeFenceLanguages(rewriteMarkdownImages(contentWithNumberedHeadings, sourceMarkdownFile));
}

function loadContentDates() {
  if (!existsSync(contentDatesPath)) {
    return structuredClone(defaultContentDates);
  }
  const rawDates = JSON.parse(readFileSync(contentDatesPath, 'utf8'));
  return {
    ...defaultContentDates,
    ...rawDates,
    articles: {
      ...defaultContentDates.articles,
      ...(rawDates.articles ?? {})
    }
  };
}

function saveContentDates(contentDates) {
  writeFileSync(contentDatesPath, `${JSON.stringify(contentDates, null, 2)}\n`, 'utf8');
}

function bootstrapLegacyArticles(contentDates, sourceFiles) {
  if (Object.keys(contentDates.articles).length > 0) {
    return;
  }
  const placeholderDate = contentDates.legacyPlaceholderDate;
  for (const sourceFile of sourceFiles) {
    const relativePath = normalizePath(relative(sourceRoot, sourceFile));
    contentDates.articles[relativePath] = {
      date: placeholderDate,
      updated: placeholderDate,
      useRealDate: false
    };
  }
}

function resolveArticleDates(relativePath, contentDates) {
  const normalizedPath = normalizePath(relativePath);
  const existingEntry = contentDates.articles[normalizedPath];
  if (existingEntry) {
    return existingEntry;
  }
  const useRealDate = today >= contentDates.realDateSince;
  const entry = {
    date: today,
    updated: today,
    useRealDate
  };
  contentDates.articles[normalizedPath] = entry;
  return entry;
}

function createFrontmatter({ title, category, tags, order, draft, date, updated, useRealDate }) {
  const tagsYaml = tags.map((tag) => `  - ${escapeYaml(tag)}`).join('\n');
  return [
    '---',
    `title: ${escapeYaml(title)}`,
    `description: ${escapeYaml(`${category} - ${title}`)}`,
    `category: ${escapeYaml(category)}`,
    'tags:',
    tagsYaml,
    `date: ${date}`,
    `updated: ${updated}`,
    `draft: ${draft ? 'true' : 'false'}`,
    `order: ${order}`,
    `useRealDate: ${useRealDate ? 'true' : 'false'}`,
    '---',
    ''
  ].join('\n');
}

function importMarkdownFiles() {
  if (!existsSync(sourceRoot)) {
    throw new Error(`源目录不存在：${sourceRoot}`);
  }
  const contentRules = loadContentRules();
  const contentDates = loadContentDates();
  rmSync(targetRoot, { recursive: true, force: true });
  rmSync(importedImagesRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });
  const files = listMarkdownFiles(sourceRoot);
  bootstrapLegacyArticles(contentDates, files);
  for (const sourceFile of files) {
    const relativePath = relative(sourceRoot, sourceFile);
    const targetFile = join(targetRoot, relativePath);
    const category = getCategory(relativePath);
    const title = getTitle(sourceFile);
    const order = getOrder(sourceFile);
    const tags = inferTags(category, title);
    const draft = shouldMarkDraft({ relativePath, category, title, tags }, contentRules);
    const articleDates = resolveArticleDates(relativePath, contentDates);
    const rawContent = readFileSync(sourceFile, 'utf8');
    const content = normalizeMarkdown(rawContent, sourceFile, title);
    const frontmatter = createFrontmatter({
      title,
      category,
      tags,
      order,
      draft,
      date: articleDates.date,
      updated: articleDates.updated,
      useRealDate: articleDates.useRealDate
    });
    mkdirSync(dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, `${frontmatter}${content.trim()}\n`, 'utf8');
  }
  saveContentDates(contentDates);
  const assetsSource = join(sourceRoot, 'images');
  const assetsTarget = join(process.cwd(), 'public', 'imported-images');
  if (existsSync(assetsSource)) {
    rmSync(assetsTarget, { recursive: true, force: true });
    cpSync(assetsSource, assetsTarget, { recursive: true });
  }
  console.log(`Imported ${files.length} Markdown files to ${targetRoot}`);
}

importMarkdownFiles();
