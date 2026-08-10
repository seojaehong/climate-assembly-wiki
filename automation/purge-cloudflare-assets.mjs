import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDITED_ENTRY_PATHS = [
  'dist/platform/index.html',
  'dist/platform/accessibility/index.html',
  'dist/r/_/index.html',
];

/** Returns the unique built assets directly referenced by product entry pages. */
export function extractCloudflareAssetUrls(htmlDocuments, publicOrigin) {
  const origin = new URL(publicOrigin);
  const assetUrls = new Set();
  const assetReference = /["'](\/_astro\/[^"'?#]+)["']/g;

  for (const html of htmlDocuments) {
    for (const match of html.matchAll(assetReference)) {
      assetUrls.add(new URL(match[1], origin).toString());
    }
  }

  return [...assetUrls].sort();
}

async function cloudflareJson(fetchImpl, url, apiToken, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(`Cloudflare request failed for ${new URL(url).pathname}.`);
  }
  return payload;
}

/** Purges exact asset URLs without invalidating unrelated zone content. */
export async function purgeCloudflareAssetUrls({
  apiToken,
  accountId,
  zoneName,
  urls,
  fetchImpl = fetch,
}) {
  if (!apiToken || !accountId || !zoneName) {
    throw new Error('Cloudflare credentials and zone name are required.');
  }
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error('At least one Cloudflare asset URL is required.');
  }

  const zonesUrl = new URL('https://api.cloudflare.com/client/v4/zones');
  zonesUrl.searchParams.set('name', zoneName);
  zonesUrl.searchParams.set('account.id', accountId);
  const zones = await cloudflareJson(fetchImpl, zonesUrl, apiToken);
  if (!Array.isArray(zones.result) || zones.result.length !== 1 || !zones.result[0]?.id) {
    throw new Error(`Expected exactly one Cloudflare zone for ${zoneName}.`);
  }

  const zoneId = zones.result[0].id;
  const purgeUrl = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
  await cloudflareJson(fetchImpl, purgeUrl, apiToken, {
    method: 'POST',
    body: JSON.stringify({ files: urls }),
  });
  return { zoneId, purgedUrls: urls };
}

/** Loads audited entry pages and purges only their directly referenced assets. */
export async function purgeBuiltCloudflareAssets({
  env = process.env,
  readFile = readFileSync,
  fetchImpl = fetch,
} = {}) {
  const publicOrigin = env.CLOUDFLARE_PUBLIC_ORIGIN ?? 'https://climate-assembly.org';
  const entryAssets = AUDITED_ENTRY_PATHS.map((path) => {
    const urls = extractCloudflareAssetUrls([readFile(path, 'utf8')], publicOrigin);
    if (urls.length === 0) {
      throw new Error(`No built Cloudflare assets were found in ${path}.`);
    }
    return { path, urls };
  });
  const resultEntry = entryAssets.find(({ path }) => path === 'dist/r/_/index.html');
  if (!resultEntry?.urls.some((url) => /\/_astro\/ResultView\.[^/]+\.js$/.test(url))) {
    throw new Error('The public result entry does not reference a ResultView island asset.');
  }
  const urls = [...new Set(entryAssets.flatMap((entry) => entry.urls))].sort();
  return purgeCloudflareAssetUrls({
    apiToken: env.CLOUDFLARE_API_TOKEN,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    zoneName: env.CLOUDFLARE_ZONE_NAME,
    urls,
    fetchImpl,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  purgeBuiltCloudflareAssets()
    .then((result) => {
      console.log(JSON.stringify({ purgedAssetCount: result.purgedUrls.length }));
    })
    .catch((error) => {
      console.error('Cloudflare asset purge failed.', error);
      process.exitCode = 1;
    });
}
