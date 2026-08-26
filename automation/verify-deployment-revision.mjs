import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEPLOYMENT_REVISION_PATH = '/deployment-revision.json';

function hasExactFields(value, fields) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === fields.length
    && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

/** Verifies the exact revision manifest served by a deployment artifact. */
export async function verifyDeploymentRevision({
  baseUrl,
  expectedSourceCommit,
  timeoutMs = 20_000,
  fetchImpl = fetch,
}) {
  if (!/^[0-9a-f]{40}$/.test(expectedSourceCommit ?? '') || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Deployment revision verification requires a full source commit and positive timeout');
  }
  let manifestUrl;
  try {
    manifestUrl = new URL(DEPLOYMENT_REVISION_PATH, baseUrl).toString();
  } catch {
    throw new Error('Deployment revision verification requires a valid base URL');
  }

  const response = await fetchImpl(manifestUrl, {
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = response.headers?.get('content-type') ?? '';
  if (!response.ok || response.url !== manifestUrl || !contentType.toLowerCase().includes('application/json')) {
    throw new Error('Deployment revision response is invalid');
  }

  let manifest;
  try {
    const source = await response.text();
    if (source.length > 256) throw new Error('oversized');
    manifest = JSON.parse(source);
  } catch {
    throw new Error('Deployment revision manifest is invalid');
  }
  if (!hasExactFields(manifest, ['schemaVersion', 'sourceCommit'])
    || manifest.schemaVersion !== 1
    || !/^[0-9a-f]{40}$/.test(manifest.sourceCommit)) {
    throw new Error('Deployment revision manifest is invalid');
  }
  if (manifest.sourceCommit !== expectedSourceCommit) {
    throw new Error('Deployment revision does not match the audited source commit');
  }
  return { status: 'verified', sourceCommit: manifest.sourceCommit };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  verifyDeploymentRevision({
    baseUrl: process.env.DEPLOYMENT_REVISION_BASE_URL,
    expectedSourceCommit: process.env.DEPLOYMENT_REVISION_EXPECTED_COMMIT,
  })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Deployment revision verification failed');
      process.exitCode = 1;
    });
}
