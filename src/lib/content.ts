import { getCollection } from 'astro:content';

export const SITE_NAME = '孙计奥 Notes';
export const SITE_DESCRIPTION = '个人技术知识库，沉淀 Windows、C/C++、逆向、安全研究和博客文章。';

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

export async function getPublishedDocs() {
  const docs = await getCollection('docs');
  return docs
    .filter((doc) => !doc.data.draft)
    .sort((a, b) => {
      const categoryCompare = a.data.category.localeCompare(b.data.category, 'zh-CN');
      if (categoryCompare !== 0) {
        return categoryCompare;
      }
      return a.data.order - b.data.order || a.data.title.localeCompare(b.data.title, 'zh-CN');
    });
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
    items
  }));
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
