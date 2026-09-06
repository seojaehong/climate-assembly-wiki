import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  REQUIRED_0912_APPROVAL_GATES,
  REQUIRED_0912_CRITICAL_GATES,
  REQUIRED_0912_PLAN_STAGE_IDS,
  REQUIRED_0912_REQUIREMENTS,
  parse0912ReadinessCliArgs,
  verify0912Readiness,
} from '../../scripts/verify-0912-readiness.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('9/12 readiness traceability verifier', () => {
  test('links every requirement to existing implementation, test, and evidence files', () => {
    const report = verify0912Readiness({
      root: projectRoot,
      generatedAt: new Date('2026-09-05T00:00:00.000Z'),
    });
    expect(report.status, report.errors.join('\n')).toBe('pass');
    expect(report.summary.requirementCount).toBe(REQUIRED_0912_REQUIREMENTS.length);
    expect(report.summary.failCount).toBe(0);
    expect(report.safety).toEqual({ liveDatabaseMutationCount: 0, networkRequestCount: 0 });
    expect(REQUIRED_0912_REQUIREMENTS).toContain('PLAN-CANONICAL-ALIGNMENT');
    expect(report.checks.find((check) => check.id === 'canonical-plan-contract')?.evidence)
      .toMatchObject({
        contractId: '0912-13-adr-final-v1',
        canonicalSource: true,
        stageCount: REQUIRED_0912_PLAN_STAGE_IDS.length,
        productionTopicActivationBlocked: true,
      });
  });

  test('fails closed when the canonical HWPX identity is changed', () => {
    const contractPath = 'docs/operations/0912-13-plan-contract.json';
    const sourceCommit = 'a'.repeat(40);
    const report = verify0912Readiness({
      root: projectRoot,
      sourceReader: (relativePath) => {
        const source = readFileSync(resolve(projectRoot, relativePath));
        if (relativePath !== contractPath) return source;
        const contract = JSON.parse(source.toString('utf8'));
        contract.source.sha256 = '0'.repeat(64);
        return Buffer.from(JSON.stringify(contract), 'utf8');
      },
      sourceCommit,
      sourceTreeClean: true,
    });

    expect(report.status).toBe('fail');
    expect(report.errors.join('\n')).toContain('canonical-plan-contract');
    expect(report.errors.join('\n')).toContain('정본 HWPX');
  });

  test('fails closed when the rehearsal topics drift from the eight plan stages', () => {
    const fixturePath = 'automation/fixtures/0912-rehearsal.json';
    const report = verify0912Readiness({
      root: projectRoot,
      sourceReader: (relativePath) => {
        const source = readFileSync(resolve(projectRoot, relativePath));
        if (relativePath !== fixturePath) return source;
        const fixture = JSON.parse(source.toString('utf8'));
        fixture.topics[0].prompt = '다른 진행 단계';
        return Buffer.from(JSON.stringify(fixture), 'utf8');
      },
      sourceCommit: 'a'.repeat(40),
      sourceTreeClean: true,
    });

    expect(report.status).toBe('fail');
    expect(report.errors.join('\n')).toContain('canonical-plan-contract');
    expect(report.errors.join('\n')).toContain('리허설 꼭지');
  });

  test('recomputes traceability from an immutable source reader independently of evidence files', () => {
    const sourceCommit = 'a'.repeat(40);
    const report = verify0912Readiness({
      root: projectRoot,
      generatedAt: new Date('2026-09-05T00:00:00.000Z'),
      sourceReader: (relativePath) => readFileSync(resolve(projectRoot, relativePath)),
      sourceCommit,
      sourceTreeClean: true,
    });

    expect(report.status, report.errors.join('\n')).toBe('pass');
    expect(report.sourceCommit).toBe(sourceCommit);
    expect(report.sourceTreeClean).toBe(true);
  });

  test('does not require generated release outputs before the traceability run', () => {
    const manifest = JSON.parse(readFileSync(
      resolve(projectRoot, 'automation/fixtures/0912-traceability.json'),
      'utf8',
    ));
    const evidenceFiles = manifest.requirements.flatMap((requirement) => requirement.evidenceFiles);

    expect(evidenceFiles).not.toContain('evaluation/0912-p1a-postgres-report.json');
    expect(evidenceFiles).not.toContain('evaluation/0912-hq-dashboard-accessibility.json');
    expect(evidenceFiles).not.toContain('evaluation/0912-13-field-rehearsal.json');
    expect(evidenceFiles).not.toContain('evaluation/0912-13-hq-rehearsal.json');
  });

  test.each([
    ['empty', () => []],
    ['duplicate', (ids) => [...ids, ids.at(-1)]],
    ['reordered', (ids) => [ids[1], ids[0], ...ids.slice(2)]],
    ['unknown replacement', (ids) => [...ids.slice(0, -1), 'unexpected-gate']],
  ])('fails closed when the critical gate list is %s', (_label, mutate) => {
    const directory = mkdtempSync(join(tmpdir(), 'readiness-gates-'));
    try {
      const template = JSON.parse(readFileSync(
        resolve(projectRoot, 'evaluation/0912-13-readiness-report.template.json'),
        'utf8',
      ));
      template.criticalGates = mutate(template.criticalGates.map((gate) => gate.id))
        .map((id) => ({ id, status: 'not_run', evidence: null }));
      const templatePath = join(directory, 'readiness-template.json');
      writeFileSync(templatePath, JSON.stringify(template));
      const report = verify0912Readiness({ root: projectRoot, reportTemplatePath: templatePath });
      expect(report.status).toBe('fail');
      expect(report.errors.join('\n')).toContain('critical gate ID 집합·순서');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('fails closed when a distinct production approval gate is missing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'readiness-approvals-'));
    try {
      const fixture = JSON.parse(readFileSync(
        resolve(projectRoot, 'automation/fixtures/0912-rehearsal.json'),
        'utf8',
      ));
      fixture.rolloutContract.approvalGates = fixture.rolloutContract.approvalGates
        .filter((id) => id !== 'p4-audit-log');
      const fixturePath = join(directory, 'rehearsal.json');
      writeFileSync(fixturePath, JSON.stringify(fixture));
      const report = verify0912Readiness({ root: projectRoot, rehearsalFixturePath: fixturePath });
      expect(report.status).toBe('fail');
      expect(report.errors.join('\n')).toContain('production approval gate 집합·순서');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test.each([
    ['duplicate', (ids) => [...ids, ids.at(-1)]],
    ['reordered', (ids) => [ids[1], ids[0], ...ids.slice(2)]],
    ['unknown replacement', (ids) => [...ids.slice(0, -1), 'unexpected-approval']],
  ])('fails closed when production approval gates are %s', (_label, mutate) => {
    const directory = mkdtempSync(join(tmpdir(), 'readiness-approvals-exact-'));
    try {
      const fixture = JSON.parse(readFileSync(
        resolve(projectRoot, 'automation/fixtures/0912-rehearsal.json'),
        'utf8',
      ));
      fixture.rolloutContract.approvalGates = mutate(fixture.rolloutContract.approvalGates);
      const fixturePath = join(directory, 'rehearsal.json');
      writeFileSync(fixturePath, JSON.stringify(fixture));
      const report = verify0912Readiness({ root: projectRoot, rehearsalFixturePath: fixturePath });
      expect(report.status).toBe('fail');
      expect(report.errors.join('\n')).toContain('production approval gate 집합·순서');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('exports the exact critical and production approval gate contracts', () => {
    expect(REQUIRED_0912_CRITICAL_GATES).toHaveLength(35);
    expect(REQUIRED_0912_APPROVAL_GATES).toEqual([
      'p1-tenancy',
      'secure-session-team-seed',
      's20-draft-topics',
      'p1a-additive',
      'p2-analysis-org-selection',
      'p2a-token-only-cutover',
      'p3-design-provisioning',
      'p4-audit-log',
    ]);
  });

  test('cleans only the created PostgreSQL container and removes secret seed SQL on every exit path', () => {
    const runner = readFileSync(resolve(projectRoot, 'scripts/verify-0912-postgres.sh'), 'utf8');
    const initialized = runner.indexOf('seed_sql_path=""');
    const trapped = runner.indexOf('trap cleanup EXIT');
    const generated = runner.indexOf('seed_sql_path="$(mktemp)"');
    const permissioned = runner.indexOf('chmod 600 "$seed_sql_path"');
    const verifiedMode = runner.indexOf('test "$seed_sql_mode" = "0600"');
    const copied = runner.indexOf('docker cp "$seed_sql_path"');
    const removed = runner.indexOf('rm -f -- "$seed_sql_path"', copied);
    const cleared = runner.indexOf('seed_sql_path=""', removed);

    expect(initialized).toBeGreaterThanOrEqual(0);
    expect(trapped).toBeGreaterThan(initialized);
    expect(runner).toContain('[[ -n "$seed_sql_path" && -f "$seed_sql_path" ]]');
    expect(runner).toContain('docker rm -f "$container_id"');
    expect(runner).not.toContain('docker rm -f "$container"');
    expect(generated).toBeGreaterThan(trapped);
    expect(permissioned).toBeGreaterThan(generated);
    expect(verifiedMode).toBeGreaterThan(permissioned);
    expect(copied).toBeGreaterThan(verifiedMode);
    expect(removed).toBeGreaterThan(copied);
    expect(cleared).toBeGreaterThan(removed);
  });

  test('normalizes Git status when WSL inspects a Windows checkout', () => {
    const runner = readFileSync(resolve(projectRoot, 'scripts/verify-0912-postgres.sh'), 'utf8');

    expect(runner).toContain('git_autocrlf="${P1A_GIT_AUTOCRLF:-true}"');
    expect(runner).toContain('git -c "core.autocrlf=$git_autocrlf" "$@"');
    expect(runner).toContain('target_dirty="$(git_repo status --porcelain -- "${target_files[@]}")"');
    expect(runner).toContain('if [[ -z "$(git_repo status --porcelain)" ]]');
  });

  test.each([
    [['--no-write'], '지원하지 않는 옵션'],
    [['--output'], '값이 필요'],
    [['--root', '--output', 'report.json'], '값이 필요'],
    [['--output', 'one.json', '--output', 'two.json'], '중복 옵션'],
  ])('readiness CLI fails closed for malformed arguments: %j', (args, message) => {
    expect(() => parse0912ReadinessCliArgs(args)).toThrow(message);
  });

  test.each([
    [['--no-write'], 'Unsupported option'],
    [['--report'], 'requires a value'],
    [['--base', '--headed'], 'requires a value'],
    [['--headed', '--headed'], 'Duplicate option'],
  ])('field rehearsal CLI fails before browser launch for malformed arguments: %j', (args, message) => {
    const result = spawnSync(process.execPath, [
      resolve(projectRoot, 'scripts/verify-field-rehearsal.mjs'),
      ...args,
    ], { encoding: 'utf8', cwd: projectRoot, timeout: 10_000 });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(message);
  });

  test('field rehearsal installs a final catch-all route around the fixture handlers', () => {
    const source = readFileSync(resolve(projectRoot, 'scripts/verify-field-rehearsal.mjs'), 'utf8');
    const globalCss = readFileSync(resolve(projectRoot, 'src/styles/global.css'), 'utf8');
    const restFixture = source.indexOf("context.route('**/rest/v1/**'");
    const supabaseFixture = source.indexOf('context.route(`${FIXTURE_SUPABASE_ORIGIN}/**`');
    const catchAll = source.indexOf("context.route('**/*'");

    expect(restFixture).toBeGreaterThanOrEqual(0);
    expect(supabaseFixture).toBeGreaterThan(restFixture);
    // Playwright runs the most recently registered matching route first.
    expect(catchAll).toBeGreaterThan(supabaseFixture);
    expect(source).toContain('requestUrl.origin === BASE_ORIGIN');
    expect(source).toContain('requestUrl.origin === FIXTURE_SUPABASE_ORIGIN');
    expect(source).toContain('escapedExternalRequestCount: calls.escaped');
    expect(source).toContain('const fixtureReadRpcNames = new Set([');
    expect(source).toContain('const fixtureMutationRpcNames = new Set([');
    expect(source).toContain('calls.unexpected_rpc += 1');
    expect(source).toContain('unexpectedRpcRequestCount: calls.unexpected_rpc');
    expect(source).toContain('liveDatabaseMutationCount: calls.live_database_mutation');
    expect(source).toContain("serviceWorkers: 'block'");
    expect(source).toContain('context.routeWebSocket(/.*/');
    expect(source).toContain('blockedExternalConnectionAttemptCount: blockedExternalWebSocketAttemptCount');
    expect(source).toContain("return json(route, { message: `unexpected synthetic RPC:");
    expect(source).not.toContain('그 밖의 조회(rounds·attendance·ballot 등)는 빈 배열');
    expect(globalCss).not.toMatch(/@import\s+url\(["']?https?:\/\//i);
  });

  test('fails closed when an evidence link is missing', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'readiness-0912-'));
    try {
      for (const relativePath of [
        'automation/fixtures/0912-traceability.json',
        'automation/fixtures/0912-rehearsal.json',
        'evaluation/0912-13-readiness-report.template.json',
      ]) {
        const source = resolve(projectRoot, relativePath);
        const target = resolve(temporaryRoot, relativePath);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(source));
      }
      const manifestPath = resolve(temporaryRoot, 'automation/fixtures/0912-traceability.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      manifest.requirements[0].evidenceFiles = ['evaluation/missing.json'];
      writeFileSync(manifestPath, JSON.stringify(manifest));
      const report = verify0912Readiness({ root: temporaryRoot });
      expect(report.status).toBe('fail');
      expect(report.errors.join('\n')).toContain('없는 파일');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
