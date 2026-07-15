import { defineConfig } from 'astro/config';
import { remarkMermaid } from './src/lib/remark-mermaid.mjs';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://sunjiao.me',
  markdown: {
    remarkPlugins: [remarkMermaid],
    shikiConfig: {
      theme: 'github-dark'
    }
  }
});
