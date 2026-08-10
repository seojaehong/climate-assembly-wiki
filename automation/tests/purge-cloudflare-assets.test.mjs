import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  extractCloudflareAssetUrls,
  purgeBuiltCloudflareAssets,
  purgeCloudflareAssetUrls,
} from '../purge-cloudflare-assets.mjs';

test('extracts unique hashed assets referenced by audited entry pages', () => {
  const urls = extractCloudflareAssetUrls([
    '<astro-island component-url="/_astro/ResultView.abc123.js"></astro-island>',
    '<link rel="stylesheet" href="/_astro/platform.def456.css">',
    '<a href="/platform/">운영 화면</a>',
  ], 'https://climate-assembly.org');

  expect(urls).toEqual([
    'https://climate-assembly.org/_astro/ResultView.abc123.js',
    'https://climate-assembly.org/_astro/platform.def456.css',
  ]);
});

test('purges only the requested asset URLs from the matching Cloudflare zone', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (options.method === 'POST') {
      return { ok: true, json: async () => ({ success: true, result: { id: 'zone-1' } }) };
    }
    return { ok: true, json: async () => ({ success: true, result: [{ id: 'zone-1' }] }) };
  };
  const urls = ['https://climate-assembly.org/_astro/ResultView.abc123.js'];

  const result = await purgeCloudflareAssetUrls({
    apiToken: 'test-token',
    accountId: 'account-1',
    zoneName: 'climate-assembly.org',
    urls,
    fetchImpl,
  });

  expect(result).toEqual({ zoneId: 'zone-1', purgedUrls: urls });
  expect(requests).toHaveLength(2);
  expect(requests[0].url).toContain('/zones?');
  expect(requests[0].url).toContain('name=climate-assembly.org');
  expect(requests[0].url).toContain('account.id=account-1');
  expect(requests[1]).toMatchObject({
    url: 'https://api.cloudflare.com/client/v4/zones/zone-1/purge_cache',
    options: {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ files: urls }),
    },
  });
});

test('loads audited build entry pages and purges their referenced assets', async () => {
  const requestedPaths = [];
  const requests = [];
  const result = await purgeBuiltCloudflareAssets({
    env: {
      CLOUDFLARE_API_TOKEN: 'test-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-1',
      CLOUDFLARE_ZONE_NAME: 'climate-assembly.org',
      CLOUDFLARE_PUBLIC_ORIGIN: 'https://climate-assembly.org',
    },
    readFile: (path) => {
      requestedPaths.push(path.replaceAll('\\', '/'));
      return path.replaceAll('\\', '/') === 'dist/r/_/index.html'
        ? '<astro-island component-url="/_astro/ResultView.result123.js"></astro-island>'
        : '<script type="module" src="/_astro/shared.entry.js"></script>';
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      return options.method === 'POST'
        ? { ok: true, json: async () => ({ success: true, result: { id: 'zone-1' } }) }
        : { ok: true, json: async () => ({ success: true, result: [{ id: 'zone-1' }] }) };
    },
  });

  expect(requestedPaths).toEqual([
    'dist/platform/index.html',
    'dist/platform/accessibility/index.html',
    'dist/r/_/index.html',
  ]);
  expect(result.purgedUrls).toEqual([
    'https://climate-assembly.org/_astro/ResultView.result123.js',
    'https://climate-assembly.org/_astro/shared.entry.js',
  ]);
  expect(JSON.parse(requests[1].options.body)).toEqual({ files: result.purgedUrls });
});

test('rejects the build purge before API access when the result island asset is absent', async () => {
  let fetchCount = 0;

  await expect(purgeBuiltCloudflareAssets({
    env: {
      CLOUDFLARE_API_TOKEN: 'test-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-1',
      CLOUDFLARE_ZONE_NAME: 'climate-assembly.org',
    },
    readFile: () => '<script type="module" src="/_astro/shared.entry.js"></script>',
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error('API access was not expected.');
    },
  })).rejects.toThrow('does not reference a ResultView island asset');
  expect(fetchCount).toBe(0);
});

test('rejects the build purge when any audited entry has no built asset', async () => {
  await expect(purgeBuiltCloudflareAssets({
    env: {
      CLOUDFLARE_API_TOKEN: 'test-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-1',
      CLOUDFLARE_ZONE_NAME: 'climate-assembly.org',
    },
    readFile: (path) => path.replaceAll('\\', '/') === 'dist/platform/accessibility/index.html'
      ? '<main>Accessibility statement</main>'
      : '<astro-island component-url="/_astro/ResultView.result123.js"></astro-island>',
  })).rejects.toThrow('No built Cloudflare assets were found in dist/platform/accessibility/index.html');
});

test('rejects missing credentials and empty asset lists', async () => {
  await expect(purgeCloudflareAssetUrls({
    apiToken: '',
    accountId: 'account-1',
    zoneName: 'climate-assembly.org',
    urls: ['https://climate-assembly.org/_astro/entry.js'],
  })).rejects.toThrow('credentials and zone name are required');

  await expect(purgeCloudflareAssetUrls({
    apiToken: 'test-token',
    accountId: 'account-1',
    zoneName: 'climate-assembly.org',
    urls: [],
  })).rejects.toThrow('At least one Cloudflare asset URL is required');
});

test.each([[], [{ id: 'zone-1' }, { id: 'zone-2' }]])(
  'rejects an ambiguous Cloudflare zone lookup for %j',
  async (zones) => {
    await expect(purgeCloudflareAssetUrls({
      apiToken: 'test-token',
      accountId: 'account-1',
      zoneName: 'climate-assembly.org',
      urls: ['https://climate-assembly.org/_astro/entry.js'],
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ success: true, result: zones }),
      }),
    })).rejects.toThrow('Expected exactly one Cloudflare zone');
  },
);

test.each([
  { ok: false, success: false },
  { ok: true, success: false },
])('rejects a failed Cloudflare response for %j', async ({ ok, success }) => {
  await expect(purgeCloudflareAssetUrls({
    apiToken: 'test-token',
    accountId: 'account-1',
    zoneName: 'climate-assembly.org',
    urls: ['https://climate-assembly.org/_astro/entry.js'],
    fetchImpl: async () => ({
      ok,
      json: async () => ({ success, result: [] }),
    }),
  })).rejects.toThrow('Cloudflare request failed for /client/v4/zones');
});

test('manual deployment bypasses upload caching and purges audited entry assets', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/deploy.yml', import.meta.url),
    'utf8',
  );

  expect(workflow).toContain('pages deploy dist --project-name=climate-assembly-wiki --branch=main --skip-caching');
  expect(workflow).toContain('name: Purge audited entry assets from Cloudflare cache');
  expect(workflow).toContain('CLOUDFLARE_ZONE_NAME: climate-assembly.org');
  expect(workflow).toContain('run: node automation/purge-cloudflare-assets.mjs');
});
