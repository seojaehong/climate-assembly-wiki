import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://climate-assembly-wiki.pages.dev',
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'ko',
        locales: {
          ko: 'ko-KR',
          en: 'en-US',
          ja: 'ja-JP',
          zh: 'zh-CN',
          es: 'es-ES',
        },
      },
    }),
    pagefind(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    locales: ['ko', 'en', 'ja', 'zh', 'es'],
    defaultLocale: 'ko',
    routing: {
      prefixDefaultLocale: true,
    },
  },
});
