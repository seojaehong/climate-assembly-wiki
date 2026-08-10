import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Extracts the exact ResultView island URL referenced by the public result entry. */
export function extractResultViewAssetUrl(html, publicOrigin) {
  const match = html.match(/component-url=["'](\/_astro\/ResultView\.[^"'?#]+\.js)["']/);
  if (!match) {
    throw new Error('The public result entry does not reference a ResultView island asset.');
  }
  return new URL(match[1], publicOrigin).toString();
}

/** Verifies that repeated custom-domain requests return executable ResultView assets. */
export async function verifyCloudflareDeployment({
  origin,
  probeCount = 12,
  timeoutMs = 20_000,
  fetchImpl = fetch,
}) {
  if (!origin || !Number.isInteger(probeCount) || probeCount < 1 || timeoutMs < 1) {
    throw new Error('A public origin, positive probe count, and timeout are required.');
  }

  const entryUrl = new URL('/r/_/', origin);
  entryUrl.searchParams.set('deployment_probe', `${Date.now()}`);
  const entryResponse = await fetchImpl(entryUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!entryResponse.ok) {
    throw new Error(`Public result entry probe failed with status ${entryResponse.status ?? 'unknown'}.`);
  }
  const assetUrl = extractResultViewAssetUrl(await entryResponse.text(), origin);

  for (let index = 0; index < probeCount; index += 1) {
    const response = await fetchImpl(assetUrl, { signal: AbortSignal.timeout(timeoutMs) });
    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();
    const isJavaScript = contentType.includes('javascript');
    const isExactAsset = response.url === assetUrl;
    const isHtml = /^\s*<!doctype html|^\s*<html/i.test(body);
    if (!response.ok || !isJavaScript || !isExactAsset || isHtml) {
      throw new Error(`ResultView asset probe failed at attempt ${index + 1}.`);
    }
  }

  return { assetUrl, probeCount };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const parsedProbeCount = Number.parseInt(process.env.CLOUDFLARE_ASSET_PROBE_COUNT ?? '12', 10);
  verifyCloudflareDeployment({
    origin: process.env.CLOUDFLARE_PUBLIC_ORIGIN,
    probeCount: parsedProbeCount,
  })
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.error('Cloudflare deployment verification failed.', error);
      process.exitCode = 1;
    });
}
