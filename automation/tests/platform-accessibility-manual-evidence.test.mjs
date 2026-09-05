import { expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  createManualAccessibilityTemplate,
  evaluateManualAccessibilityEvidence,
  MANUAL_ACCESSIBILITY_TARGET_PATHS,
  validateManualAccessibilityTarget,
} from '../platform-accessibility-manual-evidence.mjs';

test('creates the complete manual accessibility evaluation matrix as not run', () => {
  const evidence = createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });

  expect(evidence.certificationClaimed).toBe(false);
  expect(evidence.status).toBe('needs_review');
  expect(evidence.profiles.map((profile) => profile.id)).toEqual([
    'desktop-screen-reader',
    'mobile-screen-reader',
  ]);
  expect(evidence.cases).toHaveLength(22);
  expect(new Set(evidence.cases.map((item) => item.surfaceId))).toEqual(new Set([
    'platform-login',
    'authenticated-platform',
    'accessibility-statement',
    'public-result-unpublished',
    'published-result',
    'ontology-review',
    'public-vote',
    'public-ballot',
    'moderator-console',
    'hq-console-gate',
    'kwcag-cross-surface',
  ]));
  expect(evidence.cases.every((item) => item.path && item.setup)).toBe(true);
  expect(evidence.cases.every((item) => item.checks.every((check) => check.procedure && check.expected))).toBe(true);
  expect(evidence.cases.every((item) => item.checks.every((check) => check.status === 'not_run'))).toBe(true);
});

test('keeps an untouched template in needs review with exact counts', () => {
  const evidence = createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });

  expect(evaluateManualAccessibilityEvidence(evidence)).toEqual({
    status: 'needs_review',
    caseCount: 22,
    checkCount: 118,
    passCount: 0,
    failCount: 0,
    blockedCount: 0,
    notRunCount: 118,
  });
});

test('passes only when every check has complete evaluator and environment evidence', () => {
  const evidence = createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });
  for (const profile of evidence.profiles) {
    profile.environment = {
      assistiveTechnology: { name: 'Test reader', version: '1' },
      browser: { name: 'Test browser', version: '1' },
      operatingSystem: { name: 'Test OS', version: '1' },
      device: profile.id === 'mobile-screen-reader' ? 'Test phone' : 'Desktop',
    };
  }
  for (const item of evidence.cases) {
    item.evaluator = 'Accessibility evaluator';
    item.testedAt = '2026-08-11T01:00:00.000Z';
    for (const check of item.checks) {
      check.status = 'pass';
      check.notes = 'Observed the expected result with the configured assistive technology.';
    }
  }
  evidence.status = 'pass';

  expect(evaluateManualAccessibilityEvidence(evidence).status).toBe('pass');
});

test('rejects an executed check without evaluator metadata', () => {
  const evidence = createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });
  evidence.cases[0].checks[0].status = 'pass';

  expect(() => evaluateManualAccessibilityEvidence(evidence)).toThrow('Executed cases require evaluator and testedAt');
});

test('rejects future evidence timestamps and evaluations that predate template generation', () => {
  const verifiedAt = new Date('2026-08-11T03:00:00.000Z');
  const evaluate = (evidence) => evaluateManualAccessibilityEvidence(evidence, { verifiedAt });
  const createEvidence = () => createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T02:00:00.000Z',
  });
  const prepareExecutedCheck = (evidence, testedAt) => {
    evidence.profiles[0].environment = {
      assistiveTechnology: { name: 'Test reader', version: '1' },
      browser: { name: 'Test browser', version: '1' },
      operatingSystem: { name: 'Test OS', version: '1' },
      device: 'Desktop',
    };
    evidence.cases[0].evaluator = 'evaluator-role-a';
    evidence.cases[0].testedAt = testedAt;
    evidence.cases[0].checks[0].status = 'pass';
    evidence.cases[0].checks[0].notes = 'Observed with the configured assistive technology.';
  };

  const futureGenerated = createEvidence();
  futureGenerated.generatedAt = '2026-08-11T03:00:00.001Z';
  expect(() => evaluate(futureGenerated)).toThrow('generatedAt must not be in the future');

  const predatingEvaluation = createEvidence();
  prepareExecutedCheck(predatingEvaluation, '2026-08-11T01:59:59.999Z');
  expect(() => evaluate(predatingEvaluation)).toThrow('testedAt must not predate generatedAt');

  const futureEvaluation = createEvidence();
  prepareExecutedCheck(futureEvaluation, '2026-08-11T03:00:00.001Z');
  expect(() => evaluate(futureEvaluation)).toThrow('testedAt must not be in the future');
});

test('requires observation notes for every executed check and rejects prefilled not-run notes', () => {
  const createEvidence = () => createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });
  const unobservedPass = createEvidence();
  unobservedPass.profiles[0].environment = {
    assistiveTechnology: { name: 'Test reader', version: '1' },
    browser: { name: 'Test browser', version: '1' },
    operatingSystem: { name: 'Test OS', version: '1' },
    device: 'Desktop',
  };
  unobservedPass.cases[0].evaluator = 'evaluator-role-a';
  unobservedPass.cases[0].testedAt = '2026-08-11T01:00:00.000Z';
  unobservedPass.cases[0].checks[0].status = 'pass';
  expect(() => evaluateManualAccessibilityEvidence(unobservedPass)).toThrow(
    'Executed checks require observation notes',
  );

  const prefilledNotRun = createEvidence();
  prefilledNotRun.cases[0].checks[0].notes = 'Expected result copied before evaluation.';
  expect(() => evaluateManualAccessibilityEvidence(prefilledNotRun)).toThrow(
    'Not-run checks must not contain observation notes',
  );
});

test('rejects incomplete matrix data and undocumented failures', () => {
  const createEvidence = () => createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });
  const missingCase = createEvidence();
  missingCase.cases.pop();
  expect(() => evaluateManualAccessibilityEvidence(missingCase)).toThrow('required matrix');

  const duplicateCheck = createEvidence();
  duplicateCheck.cases[0].checks[1].id = duplicateCheck.cases[0].checks[0].id;
  expect(() => evaluateManualAccessibilityEvidence(duplicateCheck)).toThrow('checks do not match');

  const undocumentedFailure = createEvidence();
  const profile = undocumentedFailure.profiles[0];
  profile.environment = {
    assistiveTechnology: { name: 'Test reader', version: '1' },
    browser: { name: 'Test browser', version: '1' },
    operatingSystem: { name: 'Test OS', version: '1' },
    device: 'Desktop',
  };
  undocumentedFailure.cases[0].evaluator = 'Accessibility evaluator';
  undocumentedFailure.cases[0].testedAt = '2026-08-11T01:00:00.000Z';
  undocumentedFailure.cases[0].checks[0].status = 'fail';
  undocumentedFailure.status = 'fail';
  expect(() => evaluateManualAccessibilityEvidence(undocumentedFailure)).toThrow(
    'Executed checks require observation notes',
  );
});

test('keeps blocked evidence under review and rejects a declared status mismatch', () => {
  const evidence = createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });
  evidence.profiles[0].environment = {
    assistiveTechnology: { name: 'Test reader', version: '1' },
    browser: { name: 'Test browser', version: '1' },
    operatingSystem: { name: 'Test OS', version: '1' },
    device: 'Desktop',
  };
  evidence.cases[0].evaluator = 'evaluator-role-a';
  evidence.cases[0].testedAt = '2026-08-11T01:00:00.000Z';
  evidence.cases[0].checks[0].status = 'blocked';
  evidence.cases[0].checks[0].notes = 'Approved test account is not available.';
  expect(evaluateManualAccessibilityEvidence(evidence)).toMatchObject({
    status: 'needs_review',
    blockedCount: 1,
  });

  evidence.status = 'pass';
  expect(() => evaluateManualAccessibilityEvidence(evidence)).toThrow('Evidence status must be needs_review');
});

test('CLI verifies valid evidence and does not echo malformed source data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'manual-a11y-'));
  const evidencePath = join(directory, 'evidence.json');
  const malformedPath = join(directory, 'malformed.json');
  try {
    writeFileSync(evidencePath, JSON.stringify(createManualAccessibilityTemplate({
      baseUrl: 'https://climate-assembly.org',
      commitSha: '9310d14',
      generatedAt: '2026-08-11T00:00:00.000Z',
    })), 'utf8');
    const verified = spawnSync(process.execPath, [
      join(process.cwd(), 'platform-accessibility-manual-evidence.mjs'),
      '--verify',
      evidencePath,
    ], { encoding: 'utf8' });
    expect(verified.status).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ status: 'needs_review', caseCount: 22, notRunCount: 118 });

    writeFileSync(malformedPath, '{"secret":"must-not-echo"', 'utf8');
    const malformed = spawnSync(process.execPath, [
      join(process.cwd(), 'platform-accessibility-manual-evidence.mjs'),
      '--verify',
      malformedPath,
    ], { encoding: 'utf8' });
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('Failed to parse manual accessibility evidence');
    expect(malformed.stderr).not.toContain('must-not-echo');
    expect(readFileSync(evidencePath, 'utf8')).not.toContain('Accessibility evaluator');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI exits with failure for documented failed evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'manual-a11y-fail-'));
  const evidencePath = join(directory, 'failed.json');
  try {
    const evidence = createManualAccessibilityTemplate({
      baseUrl: 'https://climate-assembly.org',
      commitSha: '9310d14',
      generatedAt: '2026-08-11T00:00:00.000Z',
    });
    evidence.profiles[0].environment = {
      assistiveTechnology: { name: 'Test reader', version: '1' },
      browser: { name: 'Test browser', version: '1' },
      operatingSystem: { name: 'Test OS', version: '1' },
      device: 'Desktop',
    };
    evidence.cases[0].evaluator = 'evaluator-role-a';
    evidence.cases[0].testedAt = '2026-08-11T01:00:00.000Z';
    evidence.cases[0].checks[0].status = 'fail';
    evidence.cases[0].checks[0].notes = 'The skip link did not move focus.';
    evidence.status = 'fail';
    writeFileSync(evidencePath, JSON.stringify(evidence), 'utf8');

    const failed = spawnSync(process.execPath, [
      join(process.cwd(), 'platform-accessibility-manual-evidence.mjs'),
      '--verify',
      evidencePath,
    ], { encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({ status: 'fail', failCount: 1 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('template CLI refuses to overwrite existing human evidence without force', () => {
  const directory = mkdtempSync(join(tmpdir(), 'manual-a11y-preserve-'));
  const evidencePath = join(directory, 'evidence.json');
  try {
    writeFileSync(evidencePath, 'preserve-human-evidence', 'utf8');
    const result = spawnSync(process.execPath, [
      join(process.cwd(), 'platform-accessibility-manual-evidence.mjs'),
      '--write-template',
      evidencePath,
      '--base-url',
      'https://climate-assembly.org',
      '--commit-sha',
      '9310d14',
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already exists');
    expect(readFileSync(evidencePath, 'utf8')).toBe('preserve-human-evidence');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects an unapproved origin and stale passed surface evidence', () => {
  const evidence = createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });
  expect(() => validateManualAccessibilityTarget(evidence, {
    expectedBaseUrl: 'https://example.invalid',
    isCommitAncestor: true,
    changedPaths: [],
  })).toThrow('approved origin');

  evidence.status = 'pass';
  expect(() => validateManualAccessibilityTarget(evidence, {
    expectedBaseUrl: 'https://climate-assembly.org',
    isCommitAncestor: true,
    changedPaths: ['src/islands/result/ResultView.tsx'],
  })).toThrow('stale');
});

test('rejects passed observations that predate the target commit', () => {
  const evidence = createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: '9310d14',
    generatedAt: '2026-08-11T00:00:00.000Z',
  });
  for (const profile of evidence.profiles) {
    profile.environment = {
      assistiveTechnology: { name: 'Test reader', version: '1' },
      browser: { name: 'Test browser', version: '1' },
      operatingSystem: { name: 'Test OS', version: '1' },
      device: 'Test device',
    };
  }
  for (const item of evidence.cases) {
    item.evaluator = 'evaluator-role-a';
    item.testedAt = '2026-08-11T01:00:00.000Z';
    for (const check of item.checks) {
      check.status = 'pass';
      check.notes = 'Observed the expected result with the configured assistive technology.';
    }
  }
  evidence.status = 'pass';

  expect(() => validateManualAccessibilityTarget(evidence, {
    expectedBaseUrl: 'https://climate-assembly.org',
    isCommitAncestor: true,
    changedPaths: [],
    commitCommittedAt: '2026-08-11T01:00:00.001Z',
  })).toThrow('predates its target commit');

  expect(() => validateManualAccessibilityTarget(evidence, {
    expectedBaseUrl: 'https://climate-assembly.org',
    isCommitAncestor: true,
    changedPaths: [],
    commitCommittedAt: null,
  })).toThrow('commit timestamp');

  expect(() => validateManualAccessibilityTarget(evidence, {
    expectedBaseUrl: 'https://climate-assembly.org',
    isCommitAncestor: true,
    changedPaths: [],
    commitCommittedAt: '2026-08-11T01:00:00.000Z',
  })).not.toThrow();
});

test('workflow watches every source path that can stale manual evidence', () => {
  const workflow = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'platform-accessibility.yml'), 'utf8');
  expect(workflow).toContain('fetch-depth: 0');
  expect(workflow).toContain('name: Install site dependencies\n        run: npm ci');
  expect(workflow).not.toContain('npm install --no-package-lock');
  for (const path of MANUAL_ACCESSIBILITY_TARGET_PATHS) {
    const workflowPath = /\.[a-z]+$/i.test(path) ? path : `${path}/**`;
    expect(workflow).toContain(`- '${workflowPath}'`);
  }
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/components');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('public/v');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/islands/OntologyReviewConsole.tsx');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/islands/ballot');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/islands/canvas');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/layouts');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/lib');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/pages');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/pages/b.astro');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/pages/v.astro');
});

test('CLI accepts an evidence-only commit and rejects committed or working-tree surface changes', () => {
  const repo = mkdtempSync(join(tmpdir(), 'manual-a11y-git-'));
  const modulePath = join(process.cwd(), 'platform-accessibility-manual-evidence.mjs');
  const runGit = (...args) => spawnSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-08-11T00:30:00.000Z',
      GIT_COMMITTER_DATE: '2026-08-11T00:30:00.000Z',
    },
  });
  try {
    expect(runGit('init').status).toBe(0);
    expect(runGit('config', 'user.email', 'test@example.invalid').status).toBe(0);
    expect(runGit('config', 'user.name', 'Test Runner').status).toBe(0);
    mkdirSync(join(repo, 'src', 'components'), { recursive: true });
    mkdirSync(join(repo, 'src', 'layouts'), { recursive: true });
    writeFileSync(join(repo, 'src', 'components', 'HitlBadge.tsx'), 'export const badge = true;\n', 'utf8');
    writeFileSync(join(repo, 'src', 'layouts', 'PlatformLayout.astro'), '<main><slot /></main>\n', 'utf8');
    expect(runGit('add', '.').status).toBe(0);
    expect(runGit('commit', '-m', 'feat: add surface').status).toBe(0);
    const surfaceSha = runGit('rev-parse', 'HEAD').stdout.trim();

    const evidence = createManualAccessibilityTemplate({
      baseUrl: 'https://climate-assembly.org',
      commitSha: surfaceSha,
      generatedAt: '2026-08-11T00:00:00.000Z',
    });
    for (const profile of evidence.profiles) {
      profile.environment = {
        assistiveTechnology: { name: 'Test reader', version: '1' },
        browser: { name: 'Test browser', version: '1' },
        operatingSystem: { name: 'Test OS', version: '1' },
        device: 'Test device',
      };
    }
    for (const item of evidence.cases) {
      item.evaluator = 'evaluator-role-a';
      item.testedAt = '2026-08-11T01:00:00.000Z';
      for (const check of item.checks) {
        check.status = 'pass';
        check.notes = 'Observed the expected result with the configured assistive technology.';
      }
    }
    evidence.status = 'pass';
    mkdirSync(join(repo, 'evaluation'));
    const evidencePath = join(repo, 'evaluation', 'manual.json');
    const backdatedEvidence = structuredClone(evidence);
    for (const item of backdatedEvidence.cases) item.testedAt = '2026-08-11T00:29:59.999Z';
    writeFileSync(evidencePath, JSON.stringify(backdatedEvidence), 'utf8');
    expect(runGit('add', '.').status).toBe(0);
    expect(runGit('commit', '-m', 'docs: add backdated evidence').status).toBe(0);
    const backdated = spawnSync(process.execPath, [modulePath, '--verify', evidencePath,
      '--expected-base-url', 'https://climate-assembly.org', '--repo-root', repo], { encoding: 'utf8' });
    expect(backdated.status).toBe(1);
    expect(backdated.stderr).toContain('predates its target commit');

    writeFileSync(evidencePath, JSON.stringify(evidence), 'utf8');
    expect(runGit('add', '.').status).toBe(0);
    expect(runGit('commit', '-m', 'docs: add evidence').status).toBe(0);

    const verified = spawnSync(process.execPath, [modulePath, '--verify', evidencePath,
      '--expected-base-url', 'https://climate-assembly.org', '--repo-root', repo], { encoding: 'utf8' });
    expect(verified.status).toBe(0);

    writeFileSync(join(repo, 'src', 'layouts', 'PlatformLayout.astro'), '<main aria-busy="true"><slot /></main>\n', 'utf8');
    const dirtyTracked = spawnSync(process.execPath, [modulePath, '--verify', evidencePath,
      '--expected-base-url', 'https://climate-assembly.org', '--repo-root', repo], { encoding: 'utf8' });
    expect(dirtyTracked.status).toBe(1);
    expect(dirtyTracked.stderr).toContain('stale');

    expect(runGit('add', 'src/layouts/PlatformLayout.astro').status).toBe(0);
    const stagedTracked = spawnSync(process.execPath, [modulePath, '--verify', evidencePath,
      '--expected-base-url', 'https://climate-assembly.org', '--repo-root', repo], { encoding: 'utf8' });
    expect(stagedTracked.status).toBe(1);
    expect(stagedTracked.stderr).toContain('stale');

    writeFileSync(join(repo, 'src', 'layouts', 'PlatformLayout.astro'), '<main><slot /></main>\n', 'utf8');
    expect(runGit('add', 'src/layouts/PlatformLayout.astro').status).toBe(0);
    const untrackedSurface = join(repo, 'src', 'components', 'UntrackedControl.tsx');
    writeFileSync(untrackedSurface, 'export const untrackedControl = true;\n', 'utf8');
    const dirtyUntracked = spawnSync(process.execPath, [modulePath, '--verify', evidencePath,
      '--expected-base-url', 'https://climate-assembly.org', '--repo-root', repo], { encoding: 'utf8' });
    expect(dirtyUntracked.status).toBe(1);
    expect(dirtyUntracked.stderr).toContain('stale');
    rmSync(untrackedSurface);

    writeFileSync(join(repo, 'src', 'layouts', 'PlatformLayout.astro'), '<main aria-busy="true"><slot /></main>\n', 'utf8');
    expect(runGit('add', '.').status).toBe(0);
    expect(runGit('commit', '-m', 'fix: change shared layout').status).toBe(0);
    const stale = spawnSync(process.execPath, [modulePath, '--verify', evidencePath,
      '--expected-base-url', 'https://climate-assembly.org', '--repo-root', repo], { encoding: 'utf8' });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('stale');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}, 30_000);
