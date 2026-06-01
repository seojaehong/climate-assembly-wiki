import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';
import tailwindcss from '@tailwindcss/vite';
import yaml from '@rollup/plugin-yaml';

export default defineConfig({
  site: 'https://climate-assembly-wiki.pages.dev',
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'ko',
        // GAP-4 (2026-05-31): sync with i18n.locales below (ko/en only for M1–M3).
        // M4 복귀 시 ja/zh/es를 아래 주석에서 복사해 재추가.
        locales: {
          ko: 'ko-KR',
          en: 'en-US',
          // M4 restore:
          // ja: 'ja-JP',
          // zh: 'zh-CN',
          // es: 'es-ES',
        },
      },
    }),
    pagefind(),
  ],
  vite: {
    plugins: [tailwindcss(), yaml()],
  },
  i18n: {
    // M1–M3: ko and en only. ja/zh/es excluded per Decision ② (Design §1.1).
    // M4: restore by adding 'ja', 'zh', 'es' to the array below and updating LanguageToggle.astro.
    locales: ['ko', 'en'],
    defaultLocale: 'ko',
    routing: {
      prefixDefaultLocale: true,      // /ko/ prefix always present
      fallbackType: 'rewrite',        // Blocker 2 fix: missing EN page serves KO content at /en/ URL (no redirect)
    },
  },
});
