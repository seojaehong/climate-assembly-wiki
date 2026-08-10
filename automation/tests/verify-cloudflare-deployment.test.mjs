import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  extractResultViewAssetUrl,
  verifyCloudflareDeployment,
} from '../verify-cloudflare-deployment.mjs';

test('extracts the ResultView island asset from the public result entry', () => {
  expect(extractResultViewAssetUrl(
    '<astro-island component-url="/_astro/ResultView.abc123.js"></astro-island>',
    'https://climate-assembly.org',
  )).toBe('https://climate-assembly.org/_astro/ResultView.abc123.js');
});

test('verifies repeated exact asset responses after deployment', async () => {
  const requests = [];
  const result = await verifyCloudflareDeployment({
    origin: 'https://climate-assembly.org',
    probeCount: 3,
    fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).includes('/r/_/')) {
        return {
          ok: true,
          url: String(url),
          headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
          text: async () => '<astro-island component-url="/_astro/ResultView.abc123.js"></astro-island>',
        };
      }
      return {
        ok: true,
        url: String(url),
        headers: new Headers({ 'content-type': 'application/javascript' }),
        text: async () => 'const hydrated = true;',
      };
    },
  });

  expect(result).toEqual({
    assetUrl: 'https://climate-assembly.org/_astro/ResultView.abc123.js',
    probeCount: 3,
  });
  expect(requests).toHaveLength(4);
  expect(requests.slice(1)).toEqual(Array(3).fill(result.assetUrl));
});

test.each([
  {
    label: 'redirected final URL',
    response: {
      ok: true,
      url: 'https://climate-assembly.org/ko/',
      headers: new Headers({ 'content-type': 'application/javascript' }),
      text: async () => 'const hydrated = true;',
    },
  },
  {
    label: 'non-JavaScript MIME',
    response: {
      ok: true,
      url: 'https://climate-assembly.org/_astro/ResultView.abc123.js',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'const hydrated = true;',
    },
  },
  {
    label: 'HTML body',
    response: {
      ok: true,
      url: 'https://climate-assembly.org/_astro/ResultView.abc123.js',
      headers: new Headers({ 'content-type': 'application/javascript' }),
      text: async () => '<!doctype html><html></html>',
    },
  },
  {
    label: 'failed status',
    response: {
      ok: false,
      url: 'https://climate-assembly.org/_astro/ResultView.abc123.js',
      headers: new Headers({ 'content-type': 'application/javascript' }),
      text: async () => 'not found',
    },
  },
])('rejects a poisoned asset response: $label', async ({ response }) => {
  let requestCount = 0;
  await expect(verifyCloudflareDeployment({
    origin: 'https://climate-assembly.org',
    probeCount: 2,
    fetchImpl: async (url) => {
      requestCount += 1;
      return requestCount === 1
        ? {
            ok: true,
            url: String(url),
            headers: new Headers({ 'content-type': 'text/html' }),
            text: async () => '<astro-island component-url="/_astro/ResultView.abc123.js"></astro-island>',
          }
        : response;
    },
  })).rejects.toThrow('ResultView asset probe failed');
});

test('manual deployment forces asset upload and verifies the custom domain', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/deploy.yml', import.meta.url),
    'utf8',
  );

  expect(workflow).toContain('pages deploy dist --project-name=climate-assembly-wiki --branch=main --skip-caching');
  expect(workflow).toContain('name: Verify custom-domain ResultView asset');
  expect(workflow).toContain('run: node automation/verify-cloudflare-deployment.mjs');
  expect(workflow.indexOf('pages deploy dist')).toBeLessThan(
    workflow.indexOf('node automation/verify-cloudflare-deployment.mjs'),
  );
});
