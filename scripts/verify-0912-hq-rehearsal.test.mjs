import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import {
  parseHqRehearsalCli,
  validateHqRehearsalFixture,
} from './verify-0912-hq-rehearsal.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const scriptPath = resolve(projectRoot, 'scripts/verify-0912-hq-rehearsal.mjs');
const fixturePath = resolve(projectRoot, 'automation/fixtures/0912-hq-rehearsal.json');
const templatePath = resolve(projectRoot, 'evaluation/0912-13-hq-rehearsal.template.json');

function fixture() {
  return JSON.parse(readFileSync(fixturePath, 'utf8'));
}

test('canonical HQ rehearsal fixture is synthetic and carries the exact v3 request contracts', () => {
  const value = validateHqRehearsalFixture(fixture());
  assert.equal(value.classification, 'synthetic-no-pii-no-secrets');
  assert.equal(value.evidence.databaseAuthorizationOrLifecycleEvidence, false);
  assert.deepEqual(value.rpcContracts.hq_submission_category_assign_v3.requestFields, [
    'p_token',
    'p_session_slug',
    'p_submission_id',
    'p_item_ordinal',
    'p_category',
    'p_expected_submission_updated_at',
    'p_expected_event_id',
    'p_idempotency_key',
  ]);
  assert.deepEqual(value.rpcContracts.hq_submission_kind_assign_v3.compareAndSetFields, [
    'p_expected_submission_updated_at',
    'p_expected_event_id',
  ]);
  assert.equal(value.rpcContracts.hq_clear_submissions_v3.exactSetField, 'p_expected_submissions');
  assert.deepEqual(value.rpcContracts.workshop_hq_logout_v2.requestFields, ['p_token']);
  assert.equal(value.storage.capabilitySource, 'runtime-generated');
  assert.equal(value.boardRows[0].item_id, value.categoryAssignments[0].source_item_id);
});

test('fixture-only CLI writes a byte-bound report without launching a browser', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hq-rehearsal-validation-'));
  try {
    const reportPath = join(directory, 'report.json');
    const result = spawnSync(process.execPath, [
      scriptPath,
      '--fixture', fixturePath,
      '--report', reportPath,
      '--validate-fixture-only',
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const fixtureText = readFileSync(fixturePath, 'utf8');
    assert.equal(report.fixtureSha256, createHash('sha256').update(fixtureText, 'utf8').digest('hex'));
    assert.equal(report.status, 'fixture_valid');
    assert.equal(report.validationOnly, true);
    assert.equal(report.evidenceBoundary.databaseAuthorizationOrLifecycleEvidence, false);
    assert.equal(report.fixtureIdentity.classification, 'synthetic-no-pii-no-secrets');
    assert.equal(/eyJ[A-Za-z0-9_-]{12,}\./.test(JSON.stringify(report)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('strict CLI rejects unsupported, duplicate, missing, and unsafe options before browser work', () => {
  assert.throws(() => parseHqRehearsalCli(['--unknown']), /Unsupported option/);
  assert.throws(() => parseHqRehearsalCli(['--headed', '--headed']), /Duplicate option/);
  assert.throws(() => parseHqRehearsalCli(['--base']), /requires a value/);
  assert.throws(() => parseHqRehearsalCli(['--base', 'file:///tmp']), /HTTP or HTTPS/);
  assert.throws(() => parseHqRehearsalCli(['--base', 'http://localhost:4331/hq']), /origin without path/);
  assert.throws(() => parseHqRehearsalCli(['--timeout-ms', '4999']), /5000 through 120000/);

  const directory = mkdtempSync(join(tmpdir(), 'hq-rehearsal-cli-'));
  try {
    const reportPath = join(directory, 'must-not-exist.json');
    const result = spawnSync(process.execPath, [scriptPath, '--unsupported', '--report', reportPath], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /Unsupported option/);
    assert.throws(() => readFileSync(reportPath, 'utf8'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('fixture validation fails closed on embedded capability material or drifted RPC fields', () => {
  const withCapability = fixture();
  withCapability.session.token = 'not-allowed';
  assert.throws(
    () => validateHqRehearsalFixture(withCapability),
    /must not store capability material/,
  );

  const driftedContract = fixture();
  driftedContract.rpcContracts.hq_submission_category_assign_v3.requestFields = driftedContract
    .rpcContracts.hq_submission_category_assign_v3.requestFields
    .filter((field) => field !== 'p_expected_event_id');
  assert.throws(
    () => validateHqRehearsalFixture(driftedContract),
    /requestFields must equal/,
  );

  const duplicateGeneration = fixture();
  duplicateGeneration.boardRows.push({ ...duplicateGeneration.boardRows[0] });
  assert.throws(
    () => validateHqRehearsalFixture(duplicateGeneration),
    /duplicate note generation/,
  );
});

test('report template starts not-run and preserves the UI-fixture evidence boundary', () => {
  const template = JSON.parse(readFileSync(templatePath, 'utf8'));
  assert.equal(template.status, 'not_run');
  assert.equal(template.target.route, '/hq?ops=1');
  assert.equal(template.evidenceBoundary.evidenceClass, 'ui-fixture-only');
  assert.equal(template.evidenceBoundary.databaseAuthorizationOrLifecycleEvidence, false);
  assert.equal(template.safety.productionDatabaseMutationCount, 0);
  assert.equal(template.safety.screenshotsWritten, 0);
});

test('script keeps browser loading behind validated CLI and writes only sanitized observations', () => {
  const source = readFileSync(scriptPath, 'utf8');
  assert.match(source, /const options = parseHqRehearsalCli\(argv\);[\s\S]*loadValidatedFixture\(options\.fixturePath\)/);
  assert.match(source, /await import\('\.\.\/automation\/node_modules\/playwright\/index\.mjs'\)/);
  assert.match(source, /await context\.route\('\*\*\/\*'/);
  assert.match(source, /window\.WebSocket = BlockedWebSocket/);
  assert.match(source, /productionDatabaseMutationCount: 0/);
  assert.match(source, /screenshotsWritten: 0/);
  assert.doesNotMatch(source, /page\.screenshot\(/);
  assert.match(source, /reportText = reportText\.replaceAll\(value, '\[redacted-runtime-capability\]'\)/);
});
