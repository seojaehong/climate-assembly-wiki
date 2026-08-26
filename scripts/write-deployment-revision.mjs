import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'dist', 'deployment-revision.json');

function normalizeCommit(value) {
  const normalized = value?.trim().toLowerCase() ?? '';
  return FULL_COMMIT_PATTERN.test(normalized) ? normalized : null;
}

/** Resolves the exact commit embedded in the current static deployment artifact. */
export function resolveDeploymentRevision({
  environment = process.env,
  readCheckoutRevision = () => execFileSync(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd: PROJECT_ROOT, encoding: 'utf8' },
  ),
} = {}) {
  for (const name of ['CF_PAGES_COMMIT_SHA', 'GITHUB_SHA']) {
    const configured = environment[name];
    if (configured !== undefined) {
      const revision = normalizeCommit(configured);
      if (!revision) throw new Error('Authoritative deployment revision is invalid');
      return revision;
    }
  }

  const checkoutRevision = normalizeCommit(readCheckoutRevision());
  if (!checkoutRevision) throw new Error('Checkout deployment revision is invalid');
  return checkoutRevision;
}

/** Writes the revision manifest into the already-built deployment directory. */
export function writeDeploymentRevisionManifest({
  outputPath,
  sourceCommit,
} = {}) {
  if (resolve(outputPath ?? '') !== OUTPUT_PATH) {
    throw new Error('Deployment revision output path is invalid');
  }
  const revision = normalizeCommit(sourceCommit);
  if (!revision) throw new Error('Deployment revision manifest source commit is invalid');
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(
    OUTPUT_PATH,
    `${JSON.stringify({ schemaVersion: 1, sourceCommit: revision })}\n`,
    { encoding: 'utf8', flag: 'w' },
  );
  return { outputPath: OUTPUT_PATH, sourceCommit: revision };
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const sourceCommit = resolveDeploymentRevision();
    writeDeploymentRevisionManifest({ outputPath: OUTPUT_PATH, sourceCommit });
    process.stdout.write(`${JSON.stringify({ status: 'written', sourceCommit })}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment revision manifest failed');
    process.exitCode = 1;
  }
}
