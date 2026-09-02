import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildLicenseBoundaryPlan,
  runLicenseBoundaryPlanCli,
} from '../platform-license-boundary-plan.mjs';

const reviewedAt = '2026-09-03T03:00:00.000Z';
const generatedAt = '2026-09-03T04:00:00.000Z';
const templatePath = fileURLToPath(new URL(
  '../../docs/platform/license-boundary-decision.template.json',
  import.meta.url,
));

function review(status = 'approved') {
  return {
    status,
    reviewerRole: status === 'approved' ? '권리 검토 책임 역할' : null,
    reviewedAt: status === 'approved' ? reviewedAt : null,
  };
}

function readyProfile(overrides = {}) {
  return {
    schemaVersion: 1,
    strategy: 'open_source_agpl',
    softwareLicense: 'AGPL-3.0-only',
    contentLicense: 'CC-BY-SA-4.0',
    commercialLicenseOwnerRole: null,
    copyrightOwnershipReview: review(),
    contributorRightsReview: review(),
    thirdPartyNoticeReview: review(),
    decisionReview: review(),
    ...overrides,
  };
}

function writeFixtureFile(root, path, content) {
  const absolutePath = join(root, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function fixtureRepository({ dependencyLicense = 'MIT' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'platform-license-repo-'));
  const packageJson = {
    name: 'fixture',
    version: '1.0.0',
    dependencies: { example: '1.2.3', linked: 'file:./vendor/linked' },
    devDependencies: { devexample: '2.0.0' },
  };
  const packageLock = {
    lockfileVersion: 3,
    packages: {
      '': packageJson,
      'node_modules/example': { version: '1.2.3', license: dependencyLicense || undefined },
      'node_modules/devexample': { version: '2.0.0', license: 'Apache-2.0' },
      'node_modules/linked': { resolved: 'vendor/linked', link: true },
    },
  };
  writeFixtureFile(root, 'package.json', `${JSON.stringify(packageJson)}\n`);
  writeFixtureFile(root, 'package-lock.json', `${JSON.stringify(packageLock)}\n`);
  writeFixtureFile(root, 'LICENSE', 'Creative Commons Attribution-ShareAlike 4.0 International\n');
  writeFixtureFile(root, 'README.md', 'License: CC BY-SA 4.0\n');
  writeFixtureFile(root, 'src/content/config.ts', "license: z.literal('CC-BY-SA-4.0')\n");
  writeFixtureFile(root, 'tools/en-roads/LICENSE.md', 'CC BY 4.0\n');
  writeFixtureFile(root, 'vendor/rhwp-core-0.8.4/LICENSE', 'MIT\n');
  writeFixtureFile(root, 'vendor/rhwp-core-0.8.4/package.json', '{"name":"@rhwp/core","version":"0.8.4","license":"MIT"}\n');
  writeFixtureFile(root, 'vendor/kordoc-4.12.0/LICENSE', 'MIT\n');
  writeFixtureFile(root, 'vendor/kordoc-4.12.0/NOTICE', 'notice\n');
  writeFixtureFile(root, 'vendor/kordoc-4.12.0/THIRD_PARTY', 'third party\n');
  writeFixtureFile(root, 'vendor/kordoc-4.12.0/package.json', '{"name":"kordoc","version":"4.12.0","license":"MIT"}\n');
  writeFixtureFile(root, 'vendor/UPSTREAM.md', 'upstream\n');
  writeFixtureFile(root, 'vendor/linked/package.json', '{"name":"linked","version":"3.0.0","license":"BSD-3-Clause"}\n');
  return root;
}

test('inventories current boundaries and prepares an approved change review without granting rights', () => {
  const root = fixtureRepository();
  try {
    const result = buildLicenseBoundaryPlan({ repoRoot: root, profile: readyProfile(), generatedAt });
    expect(result.status).toBe('ready_for_license_change_review');
    expect(result.readyForLicenseChangeReview).toBe(true);
    expect(result.rightsGranted).toBe(false);
    expect(result.licenseFilesChanged).toBe(false);
    expect(result.packageMetadataChanged).toBe(false);
    expect(result.databaseMutationExecuted).toBe(false);
    expect(result.currentRepositoryState).toMatchObject({
      rootLicenseDetected: 'CC-BY-SA-4.0',
      readmeDeclaresCcBySa: true,
      packageLicenseField: null,
      contentSchemaDeclaresCcBySa: true,
      enRoadsBoundaryDeclaresCcBy: true,
      missingDependencyLicenses: [],
    });
    expect(result.currentRepositoryState.directDependencies).toEqual([
      expect.objectContaining({ name: 'devexample', scope: 'development', license: 'Apache-2.0' }),
      expect.objectContaining({ name: 'example', scope: 'runtime', license: 'MIT' }),
      expect.objectContaining({ name: 'linked', scope: 'runtime', license: 'BSD-3-Clause' }),
    ]);
    expect(result.currentRepositoryState.repositoryEvidence).toHaveLength(13);
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('keeps every rights-holder decision visible in the template plan', () => {
  const root = fixtureRepository();
  try {
    const result = buildLicenseBoundaryPlan({
      repoRoot: root,
      profile: JSON.parse(readFileSync(templatePath, 'utf8')),
      generatedAt,
    });
    expect(result.status).toBe('needs_rights_holder_decisions');
    expect(result.readyForLicenseChangeReview).toBe(false);
    expect(result.blockers).toEqual([
      'contributor_rights_review',
      'copyright_ownership_review',
      'license_decision_review',
      'software_license',
      'strategy',
      'third_party_notice_review',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('blocks incomplete direct dependency license metadata', () => {
  const root = fixtureRepository({ dependencyLicense: null });
  try {
    const result = buildLicenseBoundaryPlan({ repoRoot: root, profile: readyProfile(), generatedAt });
    expect(result.readyForLicenseChangeReview).toBe(false);
    expect(result.currentRepositoryState.missingDependencyLicenses).toEqual(['example']);
    expect(result.blockers).toContain('direct_dependency_license_metadata');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects linked dependency metadata outside the repository', () => {
  const root = fixtureRepository();
  try {
    const packageLockPath = join(root, 'package-lock.json');
    const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
    packageLock.packages['node_modules/linked'].resolved = '..';
    writeFileSync(packageLockPath, `${JSON.stringify(packageLock)}\n`, 'utf8');
    expect(() => buildLicenseBoundaryPlan({
      repoRoot: root,
      profile: readyProfile(),
      generatedAt,
    })).toThrow('Unsafe linked dependency path');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('requires a commercial owner for dual licensing and rejects mismatched choices', () => {
  const root = fixtureRepository();
  try {
    expect(() => buildLicenseBoundaryPlan({
      repoRoot: root,
      profile: readyProfile({ strategy: 'dual_license' }),
      generatedAt,
    })).toThrow('Dual license strategy requires a commercial license owner role');
    expect(() => buildLicenseBoundaryPlan({
      repoRoot: root,
      profile: readyProfile({ strategy: 'pending' }),
      generatedAt,
    })).toThrow('Pending strategy cannot select a software license');
    expect(() => buildLicenseBoundaryPlan({
      repoRoot: root,
      profile: readyProfile({ contentLicense: 'CC-BY-4.0' }),
      generatedAt,
    })).toThrow('Content license must preserve CC-BY-SA-4.0');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects incomplete approvals and future review evidence', () => {
  const root = fixtureRepository();
  try {
    expect(() => buildLicenseBoundaryPlan({
      repoRoot: root,
      profile: readyProfile({ copyrightOwnershipReview: { ...review(), reviewerRole: null } }),
      generatedAt,
    })).toThrow('Approved copyright ownership review is incomplete');
    expect(() => buildLicenseBoundaryPlan({
      repoRoot: root,
      profile: readyProfile({ decisionReview: { ...review(), reviewedAt: '2026-09-03T05:00:00.000Z' } }),
      generatedAt,
    })).toThrow('Review timestamp follows plan generation');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI writes a private immutable plan and refuses repository paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-license-private-'));
  const privateProfilePath = join(directory, 'profile.json');
  const outputPath = join(directory, 'plan.json');
  const repositoryOutputPath = fileURLToPath(new URL(
    '../../docs/platform/forbidden-license-plan.json',
    import.meta.url,
  ));
  copyFileSync(templatePath, privateProfilePath);
  try {
    const receipt = await runLicenseBoundaryPlanCli({
      argv: ['--profile', privateProfilePath, '--output', outputPath],
      generatedAt,
    });
    expect(receipt).toMatchObject({
      status: 'needs_rights_holder_decisions',
      rightsGranted: false,
      licenseFilesChanged: false,
      packageMetadataChanged: false,
      databaseMutationExecuted: false,
    });
    expect(receipt.directDependencyCount).toBeGreaterThan(20);
    expect(existsSync(outputPath)).toBe(true);
    await expect(runLicenseBoundaryPlanCli({
      argv: ['--profile', privateProfilePath, '--output', outputPath],
    })).rejects.toThrow('Output already exists');
    await expect(runLicenseBoundaryPlanCli({
      argv: ['--profile', templatePath, '--output', join(directory, 'second.json')],
    })).rejects.toThrow('License decision profile must remain outside the repository');
    await expect(runLicenseBoundaryPlanCli({
      argv: ['--profile', privateProfilePath, '--output', repositoryOutputPath],
    })).rejects.toThrow('License boundary plan output must remain outside the repository');
    expect(existsSync(repositoryOutputPath)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
