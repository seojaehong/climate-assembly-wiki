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
  expect(evidence.cases).toHaveLength(10);
  expect(new Set(evidence.cases.map((item) => item.surfaceId))).toEqual(new Set([
    'platform-login',
    'authenticated-platform',
    'accessibility-statement',
    'public-result-unpublished',
    'published-result',
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
    caseCount: 10,
    checkCount: 40,
    passCount: 0,
    failCount: 0,
    blockedCount: 0,
    notRunCount: 40,
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
    for (const check of item.checks) check.status = 'pass';
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
  expect(() => evaluateManualAccessibilityEvidence(undocumentedFailure)).toThrow('require notes');
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
    expect(JSON.parse(verified.stdout)).toMatchObject({ status: 'needs_review', caseCount: 10, notRunCount: 40 });

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

test('workflow watches every source path that can stale manual evidence', () => {
  const workflow = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'platform-accessibility.yml'), 'utf8');
  for (const path of MANUAL_ACCESSIBILITY_TARGET_PATHS) {
    expect(workflow).toContain(`- '${path}/**'`);
  }
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/components');
  expect(MANUAL_ACCESSIBILITY_TARGET_PATHS).toContain('src/lib');
});

test('CLI accepts an evidence-only commit and rejects a later shared dependency change', () => {
  const repo = mkdtempSync(join(tmpdir(), 'manual-a11y-git-'));
  const modulePath = join(process.cwd(), 'platform-accessibility-manual-evidence.mjs');
  const runGit = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    expect(runGit('init').status).toBe(0);
    expect(runGit('config', 'user.email', 'test@example.invalid').status).toBe(0);
    expect(runGit('config', 'user.name', 'Test Runner').status).toBe(0);
    mkdirSync(join(repo, 'src', 'components'), { recursive: true });
    writeFileSync(join(repo, 'src', 'components', 'HitlBadge.tsx'), 'export const badge = true;\n', 'utf8');
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
      for (const check of item.checks) check.status = 'pass';
    }
    evidence.status = 'pass';
    mkdirSync(join(repo, 'evaluation'));
    const evidencePath = join(repo, 'evaluation', 'manual.json');
    writeFileSync(evidencePath, JSON.stringify(evidence), 'utf8');
    expect(runGit('add', '.').status).toBe(0);
    expect(runGit('commit', '-m', 'docs: add evidence').status).toBe(0);

    const verified = spawnSync(process.execPath, [modulePath, '--verify', evidencePath,
      '--expected-base-url', 'https://climate-assembly.org', '--repo-root', repo], { encoding: 'utf8' });
    expect(verified.status).toBe(0);

    writeFileSync(join(repo, 'src', 'components', 'HitlBadge.tsx'), 'export const badge = false;\n', 'utf8');
    expect(runGit('add', '.').status).toBe(0);
    expect(runGit('commit', '-m', 'fix: change shared dependency').status).toBe(0);
    const stale = spawnSync(process.execPath, [modulePath, '--verify', evidencePath,
      '--expected-base-url', 'https://climate-assembly.org', '--repo-root', repo], { encoding: 'utf8' });
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('stale');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
