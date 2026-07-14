import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://sunjiao.me',
  markdown: {
    shikiConfig: {
      theme: 'github-dark'
    }
  }
});
