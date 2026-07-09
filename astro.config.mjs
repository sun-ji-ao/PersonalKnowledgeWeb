import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://example.com',
  markdown: {
    shikiConfig: {
      theme: 'github-dark'
    }
  }
});
