import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.SITE_URL ?? 'https://sun-ji-ao.github.io',
  markdown: {
    shikiConfig: {
      theme: 'github-dark'
    }
  }
});
