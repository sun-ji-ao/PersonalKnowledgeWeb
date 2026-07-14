import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.string().default('未分类'),
    tags: z.array(z.string()).default([]),
    date: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    order: z.number().default(0),
    useRealDate: z.boolean().default(false)
  })
});

export const collections = {
  docs
};
