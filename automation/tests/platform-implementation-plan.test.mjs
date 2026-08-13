import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  IMPLEMENTATION_STATES,
  IMPLEMENTATION_STATUS_CONTRACT,
  buildPlatformImplementationPlan,
  verifyPlatformImplementationPlan,
} from '../platform-implementation-plan.mjs';

const SCOPE_ID = '21111111-1111-4111-8111-111111111111';
const ISSUE_1 = '31111111-1111-4111-8111-111111111111';
const ISSUE_2 = '32111111-1111-4111-8111-111111111111';

function inputs() {
  return {
    result: {
      scope: 'session',
      scope_id: SCOPE_ID,
      title: '기후시민회의 결과',
      published_at: '2026-08-13T00:00:00.000Z',
      body: {
        scope: 'session',
        scope_id: SCOPE_ID,
        reviewed_count: 2,
        unclassified_count: 0,
        issues: [
          { id: ISSUE_1, label: '대중교통 확대', review_status: 'reviewed' },
          {
            id: ISSUE_2,
            label: '건물 효율 개선',
            review_status: 'reviewed',
            implementation: {
              status: 'under_review',
              responsible_body: '건물정책 담당기관',
              updated_at: '2026-08-12T08:00:00.000Z',
              summary: '권고 내용을 검토하고 있습니다.',
              evidence_url: null,
            },
          },
        ],
      },
    },
    responses: {
      scope: 'session',
      scope_id: SCOPE_ID,
      observed_at: '2026-08-13T12:00:00.000Z',
      responses: [{
        issue_id: ISSUE_1,
        status: 'implemented',
        responsible_body: '교통정책 담당기관',
        updated_at: '2026-08-13T08:00:00.000Z',
        summary: '대중교통 접근성 개선 조치를 완료했습니다.',
        evidence_url: 'https://example.org/implementation-evidence',
        reviewed_by: 'platform-reviewer',
        reviewed_at: '2026-08-13T10:00:00.000Z',
      }],
    },
  };
}

test('builds a sealed atomic body plan while retaining untouched issues', () => {
  const { result, responses } = inputs();
  const plan = buildPlatformImplementationPlan(result, responses);

  expect(plan).toMatchObject({
    schemaVersion: 1,
    scope: 'session',
    scopeId: SCOPE_ID,
    dryRun: true,
    databaseMutationExecuted: false,
    publicPayloadWritten: false,
    requiresApproval: true,
    summary: { issueCount: 2, changedIssueCount: 1, retainedIssueCount: 1 },
  });
  expect(plan.atomicResultBody.issues[0].implementation).toEqual({
    status: 'implemented',
    responsible_body: '교통정책 담당기관',
    updated_at: '2026-08-13T08:00:00.000Z',
    summary: '대중교통 접근성 개선 조치를 완료했습니다.',
    evidence_url: 'https://example.org/implementation-evidence',
  });
  expect(plan.atomicResultBody.issues[1]).toEqual(result.body.issues[1]);
  expect(JSON.stringify(plan.atomicResultBody)).not.toContain('platform-reviewer');
  expect(plan.patches[0]).toMatchObject({ issueId: ISSUE_1, reviewer: 'platform-reviewer' });
  expect(plan.beforeBodySha256).not.toBe(plan.afterBodySha256);
  expect(verifyPlatformImplementationPlan(plan, result, responses)).toBe(true);
});

test('accepts every tracked state from the shared UI contract and rejects fallback states', () => {
  expect([...IMPLEMENTATION_STATES].sort()).toEqual([
    'implemented', 'in_progress', 'not_pursued', 'planned', 'under_review',
  ]);
  for (const state of IMPLEMENTATION_STATES) {
    const value = inputs();
    value.responses.responses[0].status = state;
    value.responses.responses[0].evidence_url = IMPLEMENTATION_STATUS_CONTRACT[state].evidenceRequired
      ? 'https://example.org/required-evidence'
      : null;
    expect(buildPlatformImplementationPlan(value.result, value.responses).atomicResultBody.issues[0].implementation.status).toBe(state);
  }
  for (const state of ['not_reported', 'invalid']) {
    const value = inputs();
    value.responses.responses[0].status = state;
    expect(() => buildPlatformImplementationPlan(value.result, value.responses)).toThrow('status');
  }
});

test.each([
  ['scope mismatch', (value) => { value.responses.scope_id = '41111111-1111-4111-8111-111111111111'; }, 'scope'],
  ['unknown issue', (value) => { value.responses.responses[0].issue_id = '41111111-1111-4111-8111-111111111111'; }, 'outside'],
  ['invalid status', (value) => { value.responses.responses[0].status = 'done'; }, 'status'],
  ['invalid reviewer', (value) => { value.responses.responses[0].reviewed_by = '홍길동'; }, 'reviewer'],
  ['missing final evidence', (value) => { value.responses.responses[0].evidence_url = null; }, 'evidence'],
  ['non-HTTPS evidence', (value) => { value.responses.responses[0].evidence_url = 'http://example.org/evidence'; }, 'evidence'],
])('rejects %s before producing an approval plan', (_name, mutate, message) => {
  const value = inputs();
  mutate(value);
  expect(() => buildPlatformImplementationPlan(value.result, value.responses)).toThrow(message);
});

test('rejects duplicate issue responses and invalid timestamp chronology', () => {
  const duplicate = inputs();
  duplicate.responses.responses.push(structuredClone(duplicate.responses.responses[0]));
  expect(() => buildPlatformImplementationPlan(duplicate.result, duplicate.responses)).toThrow('Duplicate');

  const chronology = inputs();
  chronology.responses.responses[0].reviewed_at = '2026-08-13T07:00:00.000Z';
  expect(() => buildPlatformImplementationPlan(chronology.result, chronology.responses)).toThrow('timestamp order');

  const stale = inputs();
  stale.responses.observed_at = '2026-08-12T12:00:00.000Z';
  expect(() => buildPlatformImplementationPlan(stale.result, stale.responses)).toThrow('predates');

  const invalidCalendar = inputs();
  invalidCalendar.responses.responses[0].updated_at = '2026-02-30T08:00:00.000Z';
  expect(() => buildPlatformImplementationPlan(invalidCalendar.result, invalidCalendar.responses)).toThrow('timestamp');
});

test('allows non-final states without evidence but rejects malformed optional evidence', () => {
  const planned = inputs();
  planned.responses.responses[0].status = 'planned';
  planned.responses.responses[0].evidence_url = null;
  expect(buildPlatformImplementationPlan(planned.result, planned.responses).atomicResultBody.issues[0].implementation.evidence_url).toBeNull();

  planned.responses.responses[0].evidence_url = 'not-a-url';
  expect(() => buildPlatformImplementationPlan(planned.result, planned.responses)).toThrow('evidence');
});

test('rejects an invalid retained implementation before forming the atomic body', () => {
  const value = inputs();
  value.result.body.issues[1].implementation.responsible_body = '';
  expect(() => buildPlatformImplementationPlan(value.result, value.responses)).toThrow('responsible body');
});

test('rejects unapproved response and public implementation fields', () => {
  const responseField = inputs();
  responseField.responses.responses[0].internal_note = '공개하면 안 되는 내부 메모';
  expect(() => buildPlatformImplementationPlan(responseField.result, responseField.responses)).toThrow('Unexpected');

  const publicField = inputs();
  publicField.result.body.issues[1].implementation.internal_note = '공개하면 안 되는 내부 메모';
  expect(() => buildPlatformImplementationPlan(publicField.result, publicField.responses)).toThrow('Unexpected');
});

test('rejects inconsistent result root and body scope metadata', () => {
  const value = inputs();
  value.result.body.scope_id = '41111111-1111-4111-8111-111111111111';
  expect(() => buildPlatformImplementationPlan(value.result, value.responses)).toThrow('root and body scope');
});

test('verification rejects a re-checksummed plan that no longer matches its inputs', () => {
  const { result, responses } = inputs();
  const plan = buildPlatformImplementationPlan(result, responses);
  const altered = structuredClone(plan);
  altered.atomicResultBody.issues[0].implementation.summary = '변조된 공개 설명';
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
  };
  const { checksumSha256: _checksum, ...unsigned } = altered;
  altered.checksumSha256 = createHash('sha256')
    .update(JSON.stringify(canonical(unsigned)))
    .digest('hex');
  expect(() => verifyPlatformImplementationPlan(altered, result, responses)).toThrow();
});

test('CLI creates and verifies a plan without overwriting an artifact or touching the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-implementation-'));
  try {
    const { result, responses } = inputs();
    const resultPath = join(directory, 'result.json');
    const responsesPath = join(directory, 'responses.json');
    const outputPath = join(directory, 'plan.json');
    writeFileSync(resultPath, JSON.stringify(result));
    writeFileSync(responsesPath, JSON.stringify(responses));
    const script = fileURLToPath(new URL('../platform-implementation-plan.mjs', import.meta.url));
    const create = spawnSync(process.execPath, [script, '--result', resultPath, '--responses', responsesPath, '--output', outputPath], { encoding: 'utf8' });
    expect(create.status).toBe(0);
    expect(JSON.parse(create.stdout)).toEqual({ created: true, changedIssueCount: 1, databaseMutationExecuted: false });
    const verify = spawnSync(process.execPath, [script, '--result', resultPath, '--responses', responsesPath, '--verify-plan', outputPath], { encoding: 'utf8' });
    expect(verify.status).toBe(0);
    expect(JSON.parse(verify.stdout)).toEqual({ verified: true, databaseMutationExecuted: false });
    const overwrite = spawnSync(process.execPath, [script, '--result', resultPath, '--responses', responsesPath, '--output', outputPath], { encoding: 'utf8' });
    expect(overwrite.status).toBe(1);
    expect(readFileSync(outputPath, 'utf8')).toContain('"schemaVersion": 1');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI rejects malformed semantic input without echoing its contents', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-implementation-malformed-'));
  try {
    const { result, responses } = inputs();
    const sensitiveValue = 'private-review-note-do-not-log';
    responses.responses[0].status = sensitiveValue;
    const resultPath = join(directory, 'result.json');
    const responsesPath = join(directory, 'responses.json');
    const outputPath = join(directory, 'plan.json');
    writeFileSync(resultPath, JSON.stringify(result));
    writeFileSync(responsesPath, JSON.stringify(responses));
    const script = fileURLToPath(new URL('../platform-implementation-plan.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--result', resultPath, '--responses', responsesPath, '--output', outputPath], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Invalid implementation status');
    expect(run.stderr).not.toContain(sensitiveValue);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
