import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveDeploymentRevision,
  writeDeploymentRevisionManifest,
} from './write-deployment-revision.mjs';

const CLOUDFLARE_REVISION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GITHUB_REVISION = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CHECKOUT_REVISION = 'cccccccccccccccccccccccccccccccccccccccc';
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('deployment revision manifest', () => {
  it('prefers Cloudflare and otherwise uses the workflow or checkout commit', () => {
    expect(resolveDeploymentRevision({
      environment: {
        CF_PAGES_COMMIT_SHA: CLOUDFLARE_REVISION.toUpperCase(),
        GITHUB_SHA: GITHUB_REVISION,
      },
      readCheckoutRevision: () => CHECKOUT_REVISION,
    })).toBe(CLOUDFLARE_REVISION);
    expect(resolveDeploymentRevision({
      environment: { GITHUB_SHA: GITHUB_REVISION },
      readCheckoutRevision: () => CHECKOUT_REVISION,
    })).toBe(GITHUB_REVISION);
    expect(resolveDeploymentRevision({
      environment: {},
      readCheckoutRevision: () => CHECKOUT_REVISION,
    })).toBe(CHECKOUT_REVISION);
  });

  it('fails closed on invalid authoritative and checkout revisions', () => {
    expect(() => resolveDeploymentRevision({
      environment: { CF_PAGES_COMMIT_SHA: 'short' },
      readCheckoutRevision: () => CHECKOUT_REVISION,
    })).toThrow('deployment revision');
    expect(() => resolveDeploymentRevision({
      environment: {},
      readCheckoutRevision: () => 'not-a-commit',
    })).toThrow('deployment revision');
  });

  it('refuses to write outside the fixed deployment artifact path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'deployment-revision-'));
    temporaryDirectories.push(directory);
    const unexpectedPath = join(directory, 'deployment-revision.json');

    expect(() => writeDeploymentRevisionManifest({
      outputPath: unexpectedPath,
      sourceCommit: CHECKOUT_REVISION,
    })).toThrow('output path is invalid');
    expect(existsSync(unexpectedPath)).toBe(false);
  });

  it('keeps the postbuild command and public cache policy bound to the exact manifest path', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

    expect(packageJson.scripts.postbuild).toBe('node scripts/write-deployment-revision.mjs');
    expect(headers).toContain('/deployment-revision.json\n  Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
  });
});
