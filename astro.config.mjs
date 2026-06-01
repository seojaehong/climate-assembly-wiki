import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';
import tailwindcss from '@tailwindcss/vite';
import yaml from '@rollup/plugin-yaml';

export default defineConfig({
  // MAJOR 6 fix: set to canonical domain so Astro.site is used in citation URLs.
  // Switch to https://climate-assembly.org once DNS is confirmed.
  // Until then, keep pages.dev so canonical/OG/sitemap remain consistent.
  site: process.env.PUBLIC_SITE_URL ?? 'https://climate-assembly-wiki.pages.dev',
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: 'ko',
        // M4 (2026-06-01): ja/zh/es restored as structural-only locales.
        // Body content remains KO/EN until translation lands; URLs ship for SEO + hreflang.
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
    plugins: [tailwindcss(), yaml()],
  },
  i18n: {
    // M4 (2026-06-01): ja/zh/es restored. Structural-only — body content remains KO/EN.
    // Each page's getStaticPaths emits routes for all 5 locales explicitly, so the
    // built-in `fallback` config is not needed (would chain to defaultLocale=ko anyway).
    locales: ['ko', 'en', 'ja', 'zh', 'es'],
    defaultLocale: 'ko',
    routing: {
      prefixDefaultLocale: true,      // /ko/ prefix always present
      fallbackType: 'rewrite',        // serves fallback content at requested URL (no redirect)
    },
  },
});
