import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { REQUIRED_0912_CRITICAL_GATES } from './verify-0912-readiness.mjs';
import {
  parse0912ReleaseReportCliArgs,
  validate0912ReleaseReport,
} from './verify-0912-release-report.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validatorPath = resolve(projectRoot, 'scripts/verify-0912-release-report.mjs');
const SOURCE_COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const canonicalTemplate = JSON.parse(readFileSync(
  resolve(projectRoot, 'evaluation/0912-13-readiness-report.template.json'),
  'utf8',
));
const canonicalRolloutIds = canonicalTemplate.productionRollout.orderedSteps.map((step) => step.id);
const canonicalRequirementIds = canonicalTemplate.requirements.map((requirement) => requirement.id);
const canonicalArtifactKeys = Object.keys(canonicalTemplate.artifacts);
const canonicalBlockers = canonicalTemplate.blockers;
const readyArtifacts = {
  traceabilityReport: 'evaluation/0912-13-traceability-report.json',
  postgresVerificationReport: 'evaluation/0912-p1a-postgres-report.json',
  fieldRehearsalReport: 'evaluation/0912-13-field-rehearsal.json',
  hqFieldRehearsalReport: 'evaluation/0912-13-hq-rehearsal.json',
  accessibilityReport: 'evaluation/0912-hq-dashboard-accessibility.json',
  manualAccessibilityEvidence: 'evaluation/platform-accessibility-manual-evaluation.json',
  backupManifest: 'evaluation/0912-13-backup-manifest.json',
  restoreLog: 'evaluation/0912-13-restore-report.json',
  operatorLog: 'evaluation/0912-13-operator-log.md',
};

function items(ids, status, evidence) {
  return ids.map((id) => ({ id, status, evidence }));
}

function makeReadyReport() {
  return {
    schemaVersion: 1,
    reportId: '0912-13-readiness',
    generatedAt: '2026-09-05T12:00:00.000Z',
    sourceCommit: SOURCE_COMMIT,
    sourceTreeClean: true,
    targetRevision: { status: 'verified', sourceCommit: SOURCE_COMMIT },
    status: 'pass',
    releaseDecision: 'ready',
    safety: {
      fixtureClassification: 'synthetic-no-pii-no-secrets',
      liveDatabaseMutationCount: 0,
      capabilityValuesLeakedToDraftQueueOrEvidence: false,
    },
    criticalGates: items(
      REQUIRED_0912_CRITICAL_GATES,
      'pass',
      'evaluation/0912-13-implementation-verification.md',
    ),
    productionRollout: {
      status: 'pass',
      productionMutationRequiresExplicitApproval: true,
      orderedSteps: items(canonicalRolloutIds, 'pass', 'evaluation/0912-13-operator-log.md'),
    },
    requirements: items(
      canonicalRequirementIds,
      'pass',
      ['evaluation/0912-13-security-diff-review.md'],
    ),
    artifacts: { ...readyArtifacts },
    blockers: [...canonicalBlockers],
  };
}

function makeNeedsReviewReport() {
  const report = makeReadyReport();
  report.status = 'needs_review';
  report.releaseDecision = 'not_ready';
  report.targetRevision = null;
  report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = null;
  report.criticalGates = items(REQUIRED_0912_CRITICAL_GATES, 'not_run', null);
  report.productionRollout.status = 'not_run';
  report.productionRollout.orderedSteps = items(canonicalRolloutIds, 'not_run', null);
  report.requirements = items(canonicalRequirementIds, 'not_run', []);
  report.artifacts = structuredClone(canonicalTemplate.artifacts);
  return report;
}

function validate(report, overrides = {}) {
  return validate0912ReleaseReport({
    report,
    canonicalRolloutIds,
    canonicalRequirementIds,
    canonicalArtifactKeys,
    canonicalBlockers,
    evidencePathExists: () => true,
    artifactPayloadsVerified: report.releaseDecision === 'ready',
    ...overrides,
  });
}

describe('9/12 release report validator', () => {
  test('accepts a consistent not_ready execution report without promoting it', () => {
    const result = validate(makeNeedsReviewReport());

    expect(result).toMatchObject({
      valid: true,
      releaseReady: false,
      reportStatus: 'needs_review',
      releaseDecision: 'not_ready',
      targetRevisionVerified: false,
    });
  });

  test('accepts a failed not_ready report when an evidenced failure exists', () => {
    const report = makeNeedsReviewReport();
    report.status = 'fail';
    report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = false;
    report.criticalGates[0] = {
      ...report.criticalGates[0],
      status: 'fail',
      evidence: 'evaluation/0912-13-implementation-verification.md',
    };

    expect(validate(report).releaseReady).toBe(false);
  });

  test('accepts an evidenced stopped report without promoting it', () => {
    const report = makeNeedsReviewReport();
    report.status = 'stopped';
    report.releaseDecision = 'stopped';
    report.criticalGates[0] = {
      ...report.criticalGates[0],
      status: 'stopped',
      evidence: 'evaluation/0912-13-operator-log.md',
    };

    expect(validate(report).releaseReady).toBe(false);
  });

  test('accepts a fully bound ready report', () => {
    const result = validate(makeReadyReport(), {
      expectedCommit: SOURCE_COMMIT,
      expectedTargetRevision: SOURCE_COMMIT,
    });

    expect(result).toMatchObject({
      valid: true,
      releaseReady: true,
      reportStatus: 'pass',
      releaseDecision: 'ready',
      targetRevisionVerified: true,
    });
  });

  test.each([
    ['gate missing', (report) => { report.criticalGates.pop(); }],
    ['gate duplicate', (report) => { report.criticalGates.push({ ...report.criticalGates.at(-1) }); }],
    ['gate unknown', (report) => { report.criticalGates[0].id = 'unknown-gate'; }],
    ['gate reordered', (report) => { [report.criticalGates[0], report.criticalGates[1]] = [report.criticalGates[1], report.criticalGates[0]]; }],
    ['gate not passed', (report) => { report.criticalGates[0] = { ...report.criticalGates[0], status: 'fail' }; }],
    ['gate evidence missing', (report) => { report.criticalGates[0].evidence = null; }],
    ['gate evidence path arbitrary', (report) => { report.criticalGates[0].evidence = 'ok'; }],
    ['rollout not passed', (report) => { report.productionRollout.status = 'fail'; }],
    ['rollout step not passed', (report) => { report.productionRollout.orderedSteps[0] = { ...report.productionRollout.orderedSteps[0], status: 'fail' }; }],
    ['rollout step evidence missing', (report) => { report.productionRollout.orderedSteps[0].evidence = null; }],
    ['rollout reordered', (report) => { [report.productionRollout.orderedSteps[0], report.productionRollout.orderedSteps[1]] = [report.productionRollout.orderedSteps[1], report.productionRollout.orderedSteps[0]]; }],
    ['dirty source', (report) => { report.sourceTreeClean = false; }],
    ['invalid source commit', (report) => { report.sourceCommit = 'short'; }],
    ['target missing', (report) => { report.targetRevision = null; }],
    ['target mismatch', (report) => { report.targetRevision.sourceCommit = OTHER_COMMIT; }],
    ['capability leak true', (report) => { report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = true; }],
    ['capability leak unknown', (report) => { report.safety.capabilityValuesLeakedToDraftQueueOrEvidence = null; }],
    ['live mutation', (report) => { report.safety.liveDatabaseMutationCount = 1; }],
    ['approval boundary removed', (report) => { report.productionRollout.productionMutationRequiresExplicitApproval = false; }],
    ['requirement not passed', (report) => { report.requirements[0] = { ...report.requirements[0], status: 'not_run', evidence: [] }; }],
    ['requirement evidence missing', (report) => { report.requirements[0].evidence = []; }],
    ['artifact missing', (report) => { report.artifacts.traceabilityReport = null; }],
    ['artifact path arbitrary', (report) => { report.artifacts.traceabilityReport = 'missing/nope.json'; }],
    ['artifact schema extended', (report) => { report.artifacts.unreviewed = 'evaluation/unreviewed.json'; }],
    ['blocker guardrail removed', (report) => { report.blockers.pop(); }],
    ['top-level contract extended', (report) => { report.unreviewed = true; }],
    ['not ready pairing forged', (report) => { report.releaseDecision = 'not_ready'; }],
  ])('rejects forged ready state when %s', (_label, mutate) => {
    const report = makeReadyReport();
    mutate(report);
    expect(() => validate(report)).toThrow('0912 release report rejected');
  });

  test('rejects ready promotion unless artifact producers were verified', () => {
    expect(() => validate(makeReadyReport(), { artifactPayloadsVerified: false }))
      .toThrow('ready_artifact_payloads_unverified');
  });

  test.each([
    [[], 'report_required'],
    [['--root', projectRoot], 'report_required'],
    [['--unknown', 'value', '--report', 'report.json'], 'unsupported_option'],
    [['--report'], 'option_value_required'],
    [['--report', '--root', projectRoot], 'option_value_required'],
    [['--report', 'report.json'], 'expected_commit_required'],
    [['--report', 'one.json', '--report', 'two.json'], 'duplicate_option'],
    [['--expected-commit', 'not-a-commit', '--report', 'report.json'], 'commit_value_invalid'],
    [['--expected-target-revision', 'not-a-commit', '--report', 'report.json'], 'commit_value_invalid'],
  ])('strict CLI parsing rejects malformed args before report processing: %j', (args, code) => {
    expect(() => parse0912ReleaseReportCliArgs(args)).toThrow(code);
  });

  test('strict CLI parser accepts every supported option once', () => {
    expect(parse0912ReleaseReportCliArgs([
      '--report', 'report.json',
      '--root', projectRoot,
      '--expected-commit', SOURCE_COMMIT,
      '--expected-target-revision', SOURCE_COMMIT,
    ])).toEqual({
      reportPath: 'report.json',
      root: projectRoot,
      expectedCommit: SOURCE_COMMIT,
      expectedTargetRevision: SOURCE_COMMIT,
    });
  });

  test('CLI rejects malformed arguments before attempting to read a report', () => {
    const result = spawnSync(process.execPath, [
      validatorPath,
      '--report', 'does-not-exist.json',
      '--report', 'also-does-not-exist.json',
    ], { cwd: projectRoot, encoding: 'utf8', timeout: 10_000 });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('duplicate_option');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('report_unreadable');
  });

  test('validation and CLI errors never echo evidence or token values', () => {
    const secret = 'Bearer highly-sensitive-capability-token';
    const report = makeReadyReport();
    report.criticalGates[0].status = 'unknown';
    report.criticalGates[0].evidence = secret;
    report.targetRevision = {
      status: 'not_verified',
      sourceCommit: null,
      reason: secret,
    };

    let validationMessage = '';
    try {
      validate(report);
    } catch (error) {
      validationMessage = error instanceof Error ? error.message : String(error);
    }
    expect(validationMessage).not.toContain(secret);

    const directory = mkdtempSync(join(tmpdir(), '0912-release-report-'));
    try {
      const reportPath = join(directory, 'report.json');
      writeFileSync(reportPath, JSON.stringify(report), 'utf8');
      const result = spawnSync(process.execPath, [
        validatorPath,
        '--root', projectRoot,
        '--report', reportPath,
        '--expected-commit', SOURCE_COMMIT,
      ], { cwd: projectRoot, encoding: 'utf8', timeout: 10_000 });
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(output).not.toContain(secret);
      expect(output).toContain('0912 release report rejected');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
