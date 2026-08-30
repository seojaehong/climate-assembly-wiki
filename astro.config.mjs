import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import yaml from '@rollup/plugin-yaml';

import react from '@astrojs/react';
import { resolveDeploymentRevision } from './scripts/write-deployment-revision.mjs';

/**
 * 이 번들이 어느 커밋으로 빌드됐는지를 **번들 안에** 박는다.
 *
 * 조 콘솔이 「열어 둔 화면이 옛 코드인가」를 스스로 알아야 하기 때문이다(2026-08-29
 * 통짜 6건의 유력 원인). postbuild 가 쓰는 `/deployment-revision.json` 과 **같은 해석
 * 순서**(CF_PAGES_COMMIT_SHA → GITHUB_SHA → git rev-parse HEAD)를 쓰므로 정상 빌드에서
 * 둘은 반드시 같은 값이 된다 — 다르면 그건 진짜로 배포가 바뀐 것이다.
 *
 * 해석 실패(=git 도 env 도 없는 환경)는 빌드를 세우지 않는다. 빈 문자열이 들어가고
 * 화면은 감지를 접는다(`src/islands/mod/deploy-revision.ts`).
 */
let deployRevision = '';
try {
  deployRevision = resolveDeploymentRevision();
} catch {
  deployRevision = '';
}

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
const pagefindIntegrations = nodeMajor >= 23
  ? []
  : [(await import('astro-pagefind')).default()];

export default defineConfig({
  // MAJOR 6 fix: set to canonical domain so Astro.site is used in citation URLs.
  // Switch to https://climate-assembly.org once DNS is confirmed.
  // Until then, keep pages.dev so canonical/OG/sitemap remain consistent.
  site: process.env.PUBLIC_SITE_URL ?? 'https://climate-assembly-wiki.pages.dev',
  integrations: [sitemap({
    // 2026-06-02: public surface restricted to homepage + agenda pages only.
    // Whitelist filter — only emit locale home and /{lang}/agenda/... URLs.
    // Defence in depth: pages already absent from dist won't appear anyway,
    // but this guards against stray paths being added later.
    filter: (page) =>
      /\/(ko|en|ja|zh|es)\/(agenda(\/|$))/.test(page) ||
      /\/(ko|en|ja|zh|es)\/?$/.test(page),
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
  }), ...pagefindIntegrations, react()],
  vite: {
    plugins: [tailwindcss(), yaml()],
    define: {
      __DEPLOY_REVISION__: JSON.stringify(deployRevision),
    },
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
