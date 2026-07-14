import { getCollection } from 'astro:content';

export const SITE_NAME = '孙计奥 Notes';
export const SITE_DESCRIPTION = '个人技术知识库，沉淀 Windows、C/C++、逆向、安全研究和博客文章。';
export const SITE_IMAGE = '/og-image.svg';
export const SITE_AUTHOR = '孙计奥';
export const HOME_PAGE_SIZE = 10;

export function createSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll('&', 'and')
    .replaceAll('+', 'plus')
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getDocUrl(docId: string): string {
  return `/docs/${docId}/`;
}

export function getCategoryUrl(categoryName: string): string {
  return `/categories/${createSlug(categoryName)}/`;
}

export function formatDocListTitle(doc: PublishedDocs[number]): string {
  if (doc.data.order <= 0) {
    return doc.data.title;
  }
  return `${doc.data.order}、${doc.data.title}`;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

// 2026-05-01 及之后首次导入的文章使用真实上传日期展示
export const REAL_DATE_SINCE_MS = Date.UTC(2026, 4, 1);

export function getDocSourceDate(doc: PublishedDocs[number]): Date {
  return doc.data.date ?? doc.data.updated ?? new Date(0);
}

export function usesRealDisplayDate(doc: PublishedDocs[number]): boolean {
  if (doc.data.useRealDate) {
    return true;
  }
  return getDocSourceDate(doc).getTime() >= REAL_DATE_SINCE_MS;
}

// 历史文章展示日期固定范围：2021年11月1日 ～ 2025年10月31日
const DISPLAY_DATE_START_MS = Date.UTC(2021, 10, 1);
const DISPLAY_DATE_END_MS = Date.UTC(2025, 9, 31);
const MAX_ARTICLE_GAP_DAYS = 30;
const MAX_CATEGORY_SPAN_DAYS = 90;
const MAX_ARTICLES_PER_MONTH = 20;
const PREFERRED_YEAR_WEIGHT = 10;
const EDGE_YEAR_WEIGHT = 5;
const MS_PER_DAY = 86_400_000;

interface MonthBucket {
  year: number;
  month: number;
  weight: number;
}

interface QuarterSlot {
  id: string;
  startMs: number;
  endMs: number;
}

function getSeededDaysInRange(seed: string, minDays: number, maxDays: number): number {
  if (maxDays < minDays) {
    return minDays;
  }
  const span = maxDays - minDays + 1;
  return minDays + (hashString(seed) % span);
}

function clampMs(ms: number, minMs: number, maxMs: number): number {
  return Math.min(Math.max(ms, minMs), maxMs);
}

function getMonthKeyFromMs(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getMonthArticleCount(monthCounts: Map<string, number>, ms: number): number {
  return monthCounts.get(getMonthKeyFromMs(ms)) ?? 0;
}

function incrementMonthCount(monthCounts: Map<string, number>, ms: number): void {
  const key = getMonthKeyFromMs(ms);
  monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
}

function decrementMonthCount(monthCounts: Map<string, number>, ms: number): void {
  const key = getMonthKeyFromMs(ms);
  const count = monthCounts.get(key) ?? 0;
  if (count <= 1) {
    monthCounts.delete(key);
    return;
  }
  monthCounts.set(key, count - 1);
}

function getNextMonthStartMs(ms: number): number {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return Date.UTC(year, month + 1, 1);
}

function getPreviousMonthEndMs(ms: number): number {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return Date.UTC(year, month, 0);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pickValidDateMs(
  preferredMs: number,
  minMs: number,
  maxMs: number,
  monthCounts: Map<string, number>
): number {
  if (minMs > maxMs) {
    return clampMs(preferredMs, DISPLAY_DATE_START_MS, DISPLAY_DATE_END_MS);
  }
  let candidate = clampMs(preferredMs, minMs, maxMs);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    if (getMonthArticleCount(monthCounts, candidate) < MAX_ARTICLES_PER_MONTH) {
      return candidate;
    }
    const nextMonthStart = getNextMonthStartMs(candidate);
    if (nextMonthStart <= maxMs) {
      candidate = Math.max(nextMonthStart, minMs);
      continue;
    }
    break;
  }
  candidate = clampMs(preferredMs, minMs, maxMs);
  while (candidate >= minMs) {
    if (getMonthArticleCount(monthCounts, candidate) < MAX_ARTICLES_PER_MONTH) {
      return candidate;
    }
    const previousMonthEnd = getPreviousMonthEndMs(candidate);
    candidate = Math.min(previousMonthEnd, maxMs);
    if (candidate < minMs) {
      break;
    }
  }
  return clampMs(preferredMs, minMs, maxMs);
}

function setDocDateMs(
  docId: string,
  preferredMs: number,
  minMs: number,
  maxMs: number,
  dateMap: Map<string, Date>,
  monthCounts: Map<string, number>
): number {
  const oldMs = dateMap.get(docId)?.getTime();
  if (oldMs !== undefined) {
    decrementMonthCount(monthCounts, oldMs);
  }
  const assignedMs = pickValidDateMs(preferredMs, minMs, maxMs, monthCounts);
  incrementMonthCount(monthCounts, assignedMs);
  dateMap.set(docId, new Date(assignedMs));
  return assignedMs;
}

function buildMonthBuckets(): MonthBucket[] {
  const buckets: MonthBucket[] = [];
  for (let year = 2021; year <= 2025; year += 1) {
    const startMonth = year === 2021 ? 11 : 1;
    const endMonth = year === 2025 ? 10 : 12;
    for (let month = startMonth; month <= endMonth; month += 1) {
      const weight = year === 2022 || year === 2023 || year === 2024
        ? PREFERRED_YEAR_WEIGHT
        : EDGE_YEAR_WEIGHT;
      buckets.push({ year, month, weight });
    }
  }
  return buckets;
}

function buildQuarterSlots(): QuarterSlot[] {
  const slots: QuarterSlot[] = [
    { id: '2021-q4', startMs: Date.UTC(2021, 10, 1), endMs: Date.UTC(2021, 11, 31) }
  ];
  for (let year = 2022; year <= 2024; year += 1) {
    slots.push(
      { id: `${year}-q1`, startMs: Date.UTC(year, 0, 1), endMs: Date.UTC(year, 2, 31) },
      { id: `${year}-q2`, startMs: Date.UTC(year, 3, 1), endMs: Date.UTC(year, 5, 30) },
      { id: `${year}-q3`, startMs: Date.UTC(year, 6, 1), endMs: Date.UTC(year, 8, 30) },
      { id: `${year}-q4`, startMs: Date.UTC(year, 9, 1), endMs: Date.UTC(year, 11, 31) }
    );
  }
  slots.push(
    { id: '2025-q1', startMs: Date.UTC(2025, 0, 1), endMs: Date.UTC(2025, 2, 31) },
    { id: '2025-q2', startMs: Date.UTC(2025, 3, 1), endMs: Date.UTC(2025, 5, 30) },
    { id: '2025-q3', startMs: Date.UTC(2025, 6, 1), endMs: Date.UTC(2025, 8, 30) },
    { id: '2025-q4', startMs: Date.UTC(2025, 9, 1), endMs: Date.UTC(2025, 9, 31) }
  );
  return slots;
}

function pickDayInQuarter(slot: QuarterSlot, seed: string): number {
  const totalDays = Math.floor((slot.endMs - slot.startMs) / MS_PER_DAY) + 1;
  const offsetDays = hashString(`${seed}:quarter-day`) % totalDays;
  return slot.startMs + offsetDays * MS_PER_DAY;
}

function buildWeightedCdf(buckets: MonthBucket[]): number[] {
  const totalWeight = buckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  let cumulative = 0;
  return buckets.map((bucket) => {
    cumulative += bucket.weight / totalWeight;
    return cumulative;
  });
}

function resolveBucketIndex(percentile: number, cdf: number[]): number {
  for (let index = 0; index < cdf.length; index += 1) {
    if (percentile <= cdf[index]) {
      return index;
    }
  }
  return cdf.length - 1;
}

function percentileToDateMs(percentile: number, seed: string, buckets: MonthBucket[], cdf: number[]): number {
  const bucket = buckets[resolveBucketIndex(percentile, cdf)];
  const day = 1 + (hashString(`${seed}:day`) % getDaysInMonth(bucket.year, bucket.month));
  return Date.UTC(bucket.year, bucket.month - 1, day);
}

export function sortDocsInCategory(items: PublishedDocs): PublishedDocs {
  return items.slice().sort((a, b) => {
    const orderCompare = a.data.order - b.data.order;
    if (orderCompare !== 0) {
      return orderCompare;
    }
    return a.data.title.localeCompare(b.data.title, 'zh-CN');
  });
}

function getCategoryOrderFromDocs(items: PublishedDocs): number {
  const match = items[0]?.id.match(/^(\d+)_/);
  return match ? Number.parseInt(match[1], 10) : 9999;
}

export function getOrderedCategories(docs: PublishedDocs): ReturnType<typeof groupDocsByCategory> {
  return groupDocsByCategory(docs).sort((a, b) => {
    const orderCompare = getCategoryOrderFromDocs(a.items) - getCategoryOrderFromDocs(b.items);
    if (orderCompare !== 0) {
      return orderCompare;
    }
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

function reconcileCategoryDates(
  sortedItems: PublishedDocs,
  dateMap: Map<string, Date>,
  monthCounts: Map<string, number>
): void {
  if (sortedItems.length === 0) {
    return;
  }
  let previousMs = setDocDateMs(
    sortedItems[0].id,
    dateMap.get(sortedItems[0].id)!.getTime(),
    DISPLAY_DATE_START_MS,
    DISPLAY_DATE_END_MS,
    dateMap,
    monthCounts
  );
  for (let index = 1; index < sortedItems.length; index += 1) {
    const doc = sortedItems[index];
    const minMs = previousMs + MS_PER_DAY;
    const preferredMs = Math.max(dateMap.get(doc.id)!.getTime(), minMs);
    previousMs = setDocDateMs(doc.id, preferredMs, minMs, DISPLAY_DATE_END_MS, dateMap, monthCounts);
  }
  const firstMs = dateMap.get(sortedItems[0].id)!.getTime();
  const lastMs = dateMap.get(sortedItems[sortedItems.length - 1].id)!.getTime();
  const maxSpanMs = MAX_CATEGORY_SPAN_DAYS * MS_PER_DAY;
  if (lastMs - firstMs <= maxSpanMs) {
    return;
  }
  const spanMs = lastMs - firstMs;
  for (const doc of sortedItems) {
    const currentMs = dateMap.get(doc.id)!.getTime();
    const ratio = (currentMs - firstMs) / spanMs;
    const preferredMs = firstMs + Math.floor(ratio * maxSpanMs);
    setDocDateMs(doc.id, preferredMs, firstMs, firstMs + maxSpanMs, dateMap, monthCounts);
  }
  previousMs = dateMap.get(sortedItems[0].id)!.getTime();
  for (let index = 1; index < sortedItems.length; index += 1) {
    const doc = sortedItems[index];
    const minMs = previousMs + MS_PER_DAY;
    const preferredMs = Math.max(dateMap.get(doc.id)!.getTime(), minMs);
    previousMs = setDocDateMs(doc.id, preferredMs, minMs, DISPLAY_DATE_END_MS, dateMap, monthCounts);
  }
}

function assignQuarterAnchors(
  categories: ReturnType<typeof groupDocsByCategory>,
  dateMap: Map<string, Date>,
  monthCounts: Map<string, number>
): void {
  const slots = buildQuarterSlots();
  const orderedDocs = categories.flatMap((category) => sortDocsInCategory(category.items));
  const reserved = new Set<string>();
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    let docIndex = Math.min(
      Math.floor(((slotIndex + 0.5) * orderedDocs.length) / slots.length),
      orderedDocs.length - 1
    );
    while (docIndex < orderedDocs.length && reserved.has(orderedDocs[docIndex].id)) {
      docIndex += 1;
    }
    if (docIndex >= orderedDocs.length) {
      const fallbackIndex = orderedDocs.findIndex((doc) => !reserved.has(doc.id));
      if (fallbackIndex < 0) {
        break;
      }
      docIndex = fallbackIndex;
    }
    const doc = orderedDocs[docIndex];
    reserved.add(doc.id);
    const preferredMs = pickDayInQuarter(slot, `${doc.id}:${slot.id}`);
    setDocDateMs(doc.id, preferredMs, slot.startMs, slot.endMs, dateMap, monthCounts);
  }
}

function assignArticlesInCategory(
  sortedItems: PublishedDocs,
  categoryStartMs: number,
  categoryEndMs: number,
  dateMap: Map<string, Date>,
  monthCounts: Map<string, number>
): number {
  if (sortedItems.length === 0) {
    return categoryStartMs;
  }
  const spanDays = Math.max(Math.floor((categoryEndMs - categoryStartMs) / MS_PER_DAY), sortedItems.length - 1);
  let currentMs = setDocDateMs(
    sortedItems[0].id,
    categoryStartMs,
    categoryStartMs,
    categoryEndMs,
    dateMap,
    monthCounts
  );
  for (let index = 1; index < sortedItems.length; index += 1) {
    const doc = sortedItems[index];
    const usedDays = Math.floor((currentMs - categoryStartMs) / MS_PER_DAY);
    const remainingArticles = sortedItems.length - index;
    const remainingDays = spanDays - usedDays;
    const maxGap = Math.min(MAX_ARTICLE_GAP_DAYS, Math.max(remainingDays - remainingArticles, 1));
    const gapDays = getSeededDaysInRange(doc.id, 1, maxGap);
    const minNextMs = currentMs + MS_PER_DAY;
    const targetMs = currentMs + gapDays * MS_PER_DAY;
    const maxNextMs = index === sortedItems.length - 1
      ? categoryEndMs
      : categoryEndMs - remainingArticles * MS_PER_DAY;
    currentMs = setDocDateMs(
      doc.id,
      Math.min(targetMs, maxNextMs),
      minNextMs,
      Math.max(minNextMs, maxNextMs),
      dateMap,
      monthCounts
    );
  }
  return currentMs;
}

function buildLegacyDocDisplayDateMap(docs: PublishedDocs): Map<string, Date> {
  const dateMap = new Map<string, Date>();
  const monthCounts = new Map<string, number>();
  const categories = getOrderedCategories(docs);
  const buckets = buildMonthBuckets();
  const cdf = buildWeightedCdf(buckets);
  const categoryCount = categories.length;
  let previousCategoryEndMs = DISPLAY_DATE_START_MS - MS_PER_DAY;
  for (let index = 0; index < categoryCount; index += 1) {
    const category = categories[index];
    const sortedItems = sortDocsInCategory(category.items);
    const startPercentile = index / categoryCount;
    const endPercentile = (index + 1) / categoryCount;
    let categoryStartMs = percentileToDateMs(startPercentile, `${category.name}:start`, buckets, cdf);
    let categoryEndMs = percentileToDateMs(endPercentile, `${category.name}:end`, buckets, cdf);
    categoryStartMs = Math.max(categoryStartMs, previousCategoryEndMs + MS_PER_DAY);
    categoryEndMs = Math.max(categoryEndMs, categoryStartMs + Math.max(sortedItems.length - 1, 0) * MS_PER_DAY);
    categoryEndMs = Math.min(
      categoryEndMs,
      categoryStartMs + MAX_CATEGORY_SPAN_DAYS * MS_PER_DAY,
      DISPLAY_DATE_END_MS
    );
    categoryStartMs = Math.min(categoryStartMs, categoryEndMs);
    previousCategoryEndMs = assignArticlesInCategory(
      sortedItems,
      categoryStartMs,
      categoryEndMs,
      dateMap,
      monthCounts
    );
    reconcileCategoryDates(sortedItems, dateMap, monthCounts);
    previousCategoryEndMs = dateMap.get(sortedItems[sortedItems.length - 1].id)!.getTime();
  }
  assignQuarterAnchors(categories, dateMap, monthCounts);
  return dateMap;
}

export function buildDocDisplayDateMap(docs: PublishedDocs): Map<string, Date> {
  const legacyDocs = docs.filter((doc) => !usesRealDisplayDate(doc));
  const dateMap = buildLegacyDocDisplayDateMap(legacyDocs);
  for (const doc of docs) {
    if (usesRealDisplayDate(doc)) {
      dateMap.set(doc.id, getDocSourceDate(doc));
    }
  }
  return dateMap;
}

export function formatDisplayDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}年${month}月${day}日`;
}

export async function getPublishedDocs() {
  const docs = await getCollection('docs');
  return docs
    .filter((doc) => !doc.data.draft)
    .sort(compareDocsByCategory);
}

export type PublishedDocs = Awaited<ReturnType<typeof getPublishedDocs>>;

export function compareDocsByCategory(a: PublishedDocs[number], b: PublishedDocs[number]): number {
  const categoryCompare = a.data.category.localeCompare(b.data.category, 'zh-CN');
  if (categoryCompare !== 0) {
    return categoryCompare;
  }
  return a.data.order - b.data.order || a.data.title.localeCompare(b.data.title, 'zh-CN');
}

export function getDocTimestamp(doc: PublishedDocs[number]): number {
  return (doc.data.updated ?? doc.data.date ?? new Date(0)).getTime();
}

export function getRecentDocs(docs: PublishedDocs, limit = 6): PublishedDocs {
  return docs
    .slice()
    .sort((a, b) => getDocTimestamp(b) - getDocTimestamp(a) || a.data.title.localeCompare(b.data.title, 'zh-CN'))
    .slice(0, limit);
}

function stripMarkdownToPlainText(markdown: string): string {
  let text = markdown;
  text = text.replace(/```[\s\S]*?```/g, ' ');
  text = text.replace(/`[^`]+`/g, ' ');
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/^---+$/gm, ' ');
  text = text.replace(/^\|.+\|$/gm, ' ');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/[*_~]{1,2}([^*_~]+)[*_~]{1,2}/g, '$1');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export function extractDocExcerpt(doc: PublishedDocs[number], maxLength = 360): string {
  const plainText = stripMarkdownToPlainText(doc.body ?? '');
  if (plainText.length === 0) {
    return doc.data.description ?? '';
  }
  if (plainText.length <= maxLength) {
    return plainText;
  }
  const truncated = plainText.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  const cutPoint = lastSpace > maxLength * 0.6 ? lastSpace : maxLength;
  return `${truncated.slice(0, cutPoint).trim()}…`;
}

export interface DocWithDisplayDate {
  doc: PublishedDocs[number];
  displayDate: Date;
}

export function getRecentDocsByDisplayDate(docs: PublishedDocs, limit?: number): DocWithDisplayDate[] {
  const displayDateMap = buildDocDisplayDateMap(docs);
  const sortedDocs = docs
    .slice()
    .sort((docA, docB) => {
      const dateDiff = displayDateMap.get(docB.id)!.getTime() - displayDateMap.get(docA.id)!.getTime();
      if (dateDiff !== 0) {
        return dateDiff;
      }
      return docA.data.title.localeCompare(docB.data.title, 'zh-CN');
    });
  const limitedDocs = limit ? sortedDocs.slice(0, limit) : sortedDocs;
  return limitedDocs.map((doc) => ({
    doc,
    displayDate: displayDateMap.get(doc.id)!
  }));
}

export interface PaginatedDocFeed {
  items: DocWithDisplayDate[];
  totalPages: number;
  currentPage: number;
  totalItems: number;
}

export function getPaginatedDocsByDisplayDate(
  docs: PublishedDocs,
  page = 1,
  pageSize = HOME_PAGE_SIZE
): PaginatedDocFeed {
  const allItems = getRecentDocsByDisplayDate(docs);
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  return {
    items: allItems.slice(startIndex, startIndex + pageSize),
    totalPages,
    currentPage,
    totalItems
  };
}

export function getHomePageUrl(page: number): string {
  if (page <= 1) {
    return '/';
  }
  return `/page/${page}/`;
}

export function getFeaturedDocs(docs: PublishedDocs, preferredTitles: string[], limit = 3): PublishedDocs {
  const normalizedTitles = preferredTitles.map((title) => title.replaceAll(' ', ''));
  const preferredDocs = normalizedTitles
    .map((title) => docs.find((doc) => doc.data.title.replaceAll(' ', '') === title))
    .filter((doc): doc is PublishedDocs[number] => Boolean(doc));
  const fallbackDocs = docs.filter((doc) => !preferredDocs.includes(doc));
  return [...preferredDocs, ...fallbackDocs].slice(0, limit);
}

export function groupDocsByCategory(docs: Awaited<ReturnType<typeof getPublishedDocs>>) {
  const categoryMap = new Map<string, typeof docs>();
  for (const doc of docs) {
    const group = categoryMap.get(doc.data.category) ?? [];
    group.push(doc);
    categoryMap.set(doc.data.category, group);
  }
  return Array.from(categoryMap.entries()).map(([name, items]) => ({
    name,
    slug: createSlug(name),
    items: sortDocsInCategory(items)
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export function groupDocsByTag(docs: Awaited<ReturnType<typeof getPublishedDocs>>) {
  const tagMap = new Map<string, typeof docs>();
  for (const doc of docs) {
    for (const tag of doc.data.tags) {
      const group = tagMap.get(tag) ?? [];
      group.push(doc);
      tagMap.set(tag, group);
    }
  }
  return Array.from(tagMap.entries())
    .map(([name, items]) => ({
      name,
      slug: createSlug(name),
      items
    }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name, 'zh-CN'));
}
