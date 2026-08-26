import { expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createManualAccessibilityTemplate } from '../platform-accessibility-manual-evidence.mjs';
import {
  AUTOMATED_ACCESSIBILITY_EVIDENCE,
  KWCAG_22_CRITERIA,
  buildKwcagCoverageReport,
  validateKwcagCoverageContract,
} from '../platform-accessibility-kwcag-coverage.mjs';

function passingAutomatedReport() {
  return {
    schemaVersion: 4,
    sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceTreeClean: true,
    targetRevision: {
      status: 'verified',
      sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    status: 'needs_review',
    standard: 'WCAG 2.2 AA automated subset + skip-link focus + keyboard focus order + responsive overflow',
    summary: {
      auditCaseCount: 2,
      passedCases: 2,
      violationCount: 0,
      incompleteCount: 0,
    },
    routes: [{
      passed: true,
      skipLink: { focusMoved: true },
      keyboardFocusOrder: { required: true, passed: true },
      requiredScrollRegions: [{ found: true, scrollable: true, focused: true, keyboardScrolled: true }],
      layout: { horizontalOverflow: false, contentWidthSufficient: true, clippedOutsideScrollRegions: [] },
    }],
  };
}

function manualTemplate() {
  return createManualAccessibilityTemplate({
    baseUrl: 'https://climate-assembly.org',
    commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    generatedAt: '2026-08-26T00:00:00.000Z',
  });
}

function passManualEvidence(evidence) {
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
    item.testedAt = '2026-08-26T01:00:00.000Z';
    for (const check of item.checks) {
      check.status = 'pass';
      check.notes = 'Observed the expected result with the configured assistive technology.';
    }
  }
  evidence.status = 'pass';
}

test('keeps all 33 KWCAG 2.2 requirements mapped to real evidence contracts', () => {
  expect(KWCAG_22_CRITERIA).toHaveLength(33);
  expect(new Set(KWCAG_22_CRITERIA.map(({ id }) => id)).size).toBe(33);
  expect(KWCAG_22_CRITERIA[0]).toMatchObject({ id: '5.1.1', name: '적절한 대체 텍스트 제공' });
  expect(KWCAG_22_CRITERIA.at(-1)).toMatchObject({ id: '8.2.1', name: '웹 애플리케이션 접근성 준수' });
  expect(() => validateKwcagCoverageContract()).not.toThrow();
  expect(new Set(AUTOMATED_ACCESSIBILITY_EVIDENCE.map(({ id }) => id))).toEqual(new Set([
    'axe-wcag22-aa',
    'skip-link-focus',
    'responsive-overflow',
    'keyboard-scroll-regions',
    'keyboard-focus-order',
  ]));
});

test('runs the KWCAG coverage gate in the accessibility workflow and uploads its artifact', () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const workflow = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'platform-accessibility.yml'), 'utf8');
  expect(packageJson.scripts['audit:platform-accessibility-kwcag']).toBe('node platform-accessibility-kwcag-coverage.mjs');
  expect(workflow).toContain('automation/platform-accessibility-kwcag-coverage.mjs');
  expect(workflow).toContain('automation/tests/platform-accessibility-kwcag-coverage.test.mjs');
  expect(workflow).toContain('Map automated and manual evidence to KWCAG 2.2');
  expect(workflow).toContain('npm run audit:platform-accessibility-kwcag --');
  expect(workflow).toContain('.artifacts/platform-accessibility-kwcag-coverage.json');
});

test('rejects missing criteria and unknown evidence references', () => {
  expect(() => validateKwcagCoverageContract({ criteria: KWCAG_22_CRITERIA.slice(1) }))
    .toThrow('exactly 33');
  const invalid = structuredClone(KWCAG_22_CRITERIA);
  invalid[0].id = '5.9.9';
  expect(() => validateKwcagCoverageContract({ criteria: invalid }))
    .toThrow('canonical 33-requirement sequence');
  invalid[0].id = KWCAG_22_CRITERIA[0].id;
  invalid[0].automatedEvidence = ['unknown-automation'];
  expect(() => validateKwcagCoverageContract({ criteria: invalid }))
    .toThrow('unknown automated evidence');
  invalid[0].automatedEvidence = [];
  invalid[0].manualEvidence = ['unknown-surface:unknown-check'];
  expect(() => validateKwcagCoverageContract({ criteria: invalid }))
    .toThrow('unknown manual evidence');

  const dirtyAutomated = passingAutomatedReport();
  dirtyAutomated.sourceTreeClean = false;
  expect(() => buildKwcagCoverageReport({
    automatedReport: dirtyAutomated,
    manualEvidence: manualTemplate(),
  })).toThrow('clean committed source');

  const mismatchedRevision = passingAutomatedReport();
  mismatchedRevision.targetRevision.sourceCommit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  expect(() => buildKwcagCoverageReport({
    automatedReport: mismatchedRevision,
    manualEvidence: manualTemplate(),
  })).toThrow('clean committed source');
});

test('reports complete planned coverage without treating not-run manual checks as conformance', () => {
  const report = buildKwcagCoverageReport({
    automatedReport: passingAutomatedReport(),
    manualEvidence: manualTemplate(),
    generatedAt: new Date('2026-08-26T02:00:00.000Z'),
  });

  expect(report).toMatchObject({
    schemaVersion: 1,
    status: 'needs_review',
    certificationClaimed: false,
    standard: {
      id: 'KS X OT0003:2022',
      requirementCount: 33,
      sourceSha256: 'c5a139dc548bf018115d142847b69b7017953f5987fc50534c81e6b175402f13',
    },
    summary: {
      requirementCount: 33,
      passedCount: 0,
      failedCount: 0,
      needsReviewCount: 33,
      unmappedCount: 0,
    },
  });
  expect(report.automatedEvidence.every(({ status }) => status === 'pass')).toBe(true);
  expect(report.criteria.every(({ status }) => status === 'needs_review')).toBe(true);
});

test('passes the coverage gate only after every mapped manual and automated check passes', () => {
  const manualEvidence = manualTemplate();
  passManualEvidence(manualEvidence);
  const report = buildKwcagCoverageReport({
    automatedReport: passingAutomatedReport(),
    manualEvidence,
    generatedAt: new Date('2026-08-26T02:00:00.000Z'),
  });

  expect(report.status).toBe('pass');
  expect(report.certificationClaimed).toBe(false);
  expect(report.summary).toMatchObject({ passedCount: 33, failedCount: 0, needsReviewCount: 0, unmappedCount: 0 });
});

test('fails affected requirements when an automated evidence contract fails', () => {
  const manualEvidence = manualTemplate();
  passManualEvidence(manualEvidence);
  const automatedReport = passingAutomatedReport();
  automatedReport.summary.violationCount = 1;
  automatedReport.routes[0].passed = false;
  const report = buildKwcagCoverageReport({
    automatedReport,
    manualEvidence,
    generatedAt: new Date('2026-08-26T02:00:00.000Z'),
  });

  expect(report.status).toBe('fail');
  expect(report.summary.failedCount).toBeGreaterThan(0);
  expect(report.criteria.find(({ id }) => id === '5.1.1')).toMatchObject({ status: 'fail' });
});

test('fails keyboard requirements when bidirectional focus evidence fails', () => {
  const manualEvidence = manualTemplate();
  passManualEvidence(manualEvidence);
  const automatedReport = passingAutomatedReport();
  automatedReport.routes[0].keyboardFocusOrder.passed = false;
  const report = buildKwcagCoverageReport({
    automatedReport,
    manualEvidence,
    generatedAt: new Date('2026-08-26T02:00:00.000Z'),
  });

  expect(report.status).toBe('fail');
  expect(report.criteria.find(({ id }) => id === '6.1.1')).toMatchObject({ status: 'fail' });
  expect(report.criteria.find(({ id }) => id === '6.1.2')).toMatchObject({ status: 'fail' });
});

test('CLI writes a non-certification coverage report and never echoes malformed evidence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kwcag-coverage-'));
  const automatedPath = join(directory, 'automated.json');
  const manualPath = join(directory, 'manual.json');
  const malformedPath = join(directory, 'malformed.json');
  const outputPath = join(directory, 'coverage.json');
  try {
    writeFileSync(automatedPath, JSON.stringify(passingAutomatedReport()), 'utf8');
    writeFileSync(manualPath, JSON.stringify(manualTemplate()), 'utf8');
    const result = spawnSync(process.execPath, [
      join(process.cwd(), 'platform-accessibility-kwcag-coverage.mjs'),
      '--automated-report', automatedPath,
      '--manual-evidence', manualPath,
      '--output', outputPath,
      '--generated-at', '2026-08-26T02:00:00.000Z',
    ], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'needs_review', requirementCount: 33 });
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toMatchObject({ certificationClaimed: false });

    writeFileSync(malformedPath, '{"secret":"must-not-echo"', 'utf8');
    const malformed = spawnSync(process.execPath, [
      join(process.cwd(), 'platform-accessibility-kwcag-coverage.mjs'),
      '--automated-report', malformedPath,
      '--manual-evidence', manualPath,
      '--output', outputPath,
    ], { encoding: 'utf8' });
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('Failed to parse KWCAG coverage input');
    expect(malformed.stderr).not.toContain('must-not-echo');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
