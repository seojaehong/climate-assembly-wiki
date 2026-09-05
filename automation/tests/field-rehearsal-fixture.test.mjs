import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = resolve(projectRoot, 'scripts/verify-field-rehearsal.mjs');
const canonicalFixturePath = resolve(projectRoot, 'automation/fixtures/0912-rehearsal.json');

function runFixtureValidation(fixturePath, reportPath) {
  return spawnSync(process.execPath, [
    scriptPath,
    '--fixture', fixturePath,
    '--validate-fixture-only',
    '--report', reportPath,
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
}

describe('field rehearsal fixture loader', () => {
  test('loads the selected fixture and records exact bytes plus observed configuration', () => {
    const directory = mkdtempSync(join(tmpdir(), 'field-rehearsal-fixture-'));
    try {
      const canonicalReportPath = join(directory, 'canonical-report.json');
      const canonicalRun = runFixtureValidation(canonicalFixturePath, canonicalReportPath);
      expect(canonicalRun.status, `${canonicalRun.stdout}\n${canonicalRun.stderr}`).toBe(0);
      const canonicalReport = JSON.parse(readFileSync(canonicalReportPath, 'utf8'));

      const changedFixture = JSON.parse(readFileSync(canonicalFixturePath, 'utf8'));
      changedFixture.fixtureId = '0912-field-rehearsal-regression';
      changedFixture.session.title = 'fixture 변경이 보고서에 보이는 합성 세션';
      changedFixture.team.name = 'fixture 변경 합성 조';
      changedFixture.topics[0].prompt = 'fixture에서 바꾼 첫 꼭지';
      changedFixture.expectedRpcContracts.push('fixture_observer_v1');
      changedFixture.fieldRehearsal.rpcBehaviors.fixture_observer_v1 = {
        effect: 'read',
        response: 'empty-list',
        requiresTeamToken: true,
        requiresIdempotencyKey: false,
      };
      const changedFixtureText = `${JSON.stringify(changedFixture, null, 2)}\n`;
      const changedFixturePath = join(directory, 'changed-fixture.json');
      const changedReportPath = join(directory, 'changed-report.json');
      writeFileSync(changedFixturePath, changedFixtureText, 'utf8');

      const changedRun = runFixtureValidation(changedFixturePath, changedReportPath);
      expect(changedRun.status, `${changedRun.stdout}\n${changedRun.stderr}`).toBe(0);
      const changedReport = JSON.parse(readFileSync(changedReportPath, 'utf8'));
      const expectedHash = createHash('sha256').update(changedFixtureText, 'utf8').digest('hex');

      expect(changedReport).toMatchObject({
        validationOnly: true,
        status: 'fixture_valid',
        fixtureSha256: expectedHash,
        fixtureIdentity: { fixtureId: '0912-field-rehearsal-regression' },
        observedConfiguration: {
          fixtureId: '0912-field-rehearsal-regression',
          session: { title: 'fixture 변경이 보고서에 보이는 합성 세션' },
          team: { name: 'fixture 변경 합성 조' },
        },
      });
      expect(changedReport.observedConfiguration.topics[0]).toMatchObject({
        ordinal: 1,
        prompt: 'fixture에서 바꾼 첫 꼭지',
      });
      expect(changedReport.observedConfiguration.rpcAllowlist.read).toContain('fixture_observer_v1');
      expect(changedReport.fixtureSha256).not.toBe(canonicalReport.fixtureSha256);
      expect(changedReport.observedConfiguration).not.toEqual(canonicalReport.observedConfiguration);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    ['duplicate topic IDs', (fixture) => {
      fixture.topics[1].id = fixture.topics[0].id;
    }, 'topic IDs must be unique'],
    ['missing core RPC behavior', (fixture) => {
      delete fixture.fieldRehearsal.rpcBehaviors.submission_save_v3;
    }, 'required field RPC submission_save_v3 is missing'],
    ['overlapping legacy and allowed RPCs', (fixture) => {
      fixture.fieldRehearsal.legacyRejectedRpcNames.push('topic_list_v2');
    }, 'legacy rejected RPCs must not also be allowed'],
  ])('fails closed before browser launch for %s', (_label, mutate, expectedMessage) => {
    const directory = mkdtempSync(join(tmpdir(), 'field-rehearsal-invalid-'));
    try {
      const fixture = JSON.parse(readFileSync(canonicalFixturePath, 'utf8'));
      mutate(fixture);
      const fixturePath = join(directory, 'invalid-fixture.json');
      const reportPath = join(directory, 'must-not-exist.json');
      writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');

      const result = runFixtureValidation(fixturePath, reportPath);
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(expectedMessage);
      expect(() => readFileSync(reportPath, 'utf8')).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('derives session, topic, and RPC behavior from the validated fixture', () => {
    const source = readFileSync(scriptPath, 'utf8');
    expect(source).toContain("const FIXTURE_PATH = resolve(cliOptions['--fixture'] ?? DEFAULT_FIXTURE_PATH)");
    expect(source).toContain("createHash('sha256').update(FIXTURE_TEXT, 'utf8').digest('hex')");
    expect(source).toContain('const TOPIC1 = initialTopicFixture.id');
    expect(source).toContain('const TEAM_ID = FIXTURE.team.id');
    expect(source).toContain('const fixtureReadRpcNames = new Set([');
    expect(source).toContain("rpcBehaviorEntries.filter(([, behavior]) => behavior.effect === 'read')");
    expect(source).toContain('const legacyRpcNames = new Set(FIELD_CONFIG.legacyRejectedRpcNames)');
    expect(source).toContain('observedConfiguration: observedFixtureConfiguration()');
  });
});
