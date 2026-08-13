import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildPlatformResultSourcePlan,
  verifyPlatformResultSourcePlan,
} from '../platform-result-source-plan.mjs';

const TOPIC_ID = '11111111-1111-4111-8111-111111111111';
const SCOPE_ID = '21111111-1111-4111-8111-111111111111';
const ISSUE_ID = '31111111-1111-4111-8111-111111111111';
const ITEM_1 = '41111111-1111-4111-8111-111111111111';
const ITEM_2 = '42111111-1111-4111-8111-111111111111';
const ITEM_3 = '43111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = '51111111-1111-4111-8111-111111111111';
const CLUSTER_ID = '61111111-1111-4111-8111-111111111111';

function inputs() {
  return {
    result: {
      scope: 'session',
      scope_id: SCOPE_ID,
      published_at: '2026-08-13T00:00:00.000Z',
      body: {
        scope: 'session',
        scope_id: SCOPE_ID,
        unclassified_count: 1,
        issues: [{
          id: ISSUE_ID,
          topic_id: TOPIC_ID,
          label: '대중교통 확대',
          teams: ['1분과 1조'],
          consensus_denominator: 1,
        }],
      },
    },
    sourceSnapshot: {
      topics: [{
        topic_id: TOPIC_ID,
        items: [
          {
            id: ITEM_1,
            submission_id: SUBMISSION_ID,
            ordinal: 1,
            team_name: '1분과 1조',
            kind: 'core',
            content: '대중교통 노선을 확대해야 합니다.',
            links: [{ issue_id: ISSUE_ID, cluster_id: CLUSTER_ID, linked_by: 'human' }],
          },
          {
            id: ITEM_2,
            submission_id: SUBMISSION_ID,
            ordinal: 2,
            team_name: '1분과 1조',
            kind: 'extra',
            content: '환승 편의도 함께 개선해야 합니다.',
            links: [{ issue_id: ISSUE_ID, cluster_id: CLUSTER_ID, linked_by: 'human' }],
          },
          {
            id: ITEM_3,
            submission_id: SUBMISSION_ID,
            ordinal: 3,
            team_name: '1분과 1조',
            kind: 'extra',
            content: '아직 분류하지 않은 의견입니다.',
            links: [],
          },
        ],
      }],
    },
  };
}

test('builds a sealed approval plan without raw source content', () => {
  const { result, sourceSnapshot } = inputs();
  const plan = buildPlatformResultSourcePlan(result, sourceSnapshot);

  expect(plan).toMatchObject({
    schemaVersion: 1,
    dryRun: true,
    databaseMutationExecuted: false,
    publicPayloadWritten: false,
    requiresApproval: true,
    summary: { issueCount: 1, sourceReferenceCount: 2, unclassifiedCount: 1 },
  });
  expect(plan.issues[0].sourceReferences).toHaveLength(2);
  expect(plan.issues[0].sourceReferences[0]).toMatchObject({
    itemId: ITEM_1,
    submissionId: SUBMISSION_ID,
    clusterId: CLUSTER_ID,
    linkedBy: 'human',
  });
  expect(plan.issues[0].sourceReferences[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(plan)).not.toContain('대중교통 노선을');
  expect(verifyPlatformResultSourcePlan(plan, result, sourceSnapshot)).toBe(true);
});

test.each([
  ['team drift', (value) => { value.result.body.issues[0].teams = ['2분과 1조']; }, 'teams'],
  ['denominator drift', (value) => { value.result.body.issues[0].consensus_denominator = 2; }, 'denominator'],
  ['unclassified drift', (value) => { value.result.body.unclassified_count = 0; }, 'unclassified'],
])('rejects %s between the public snapshot and source graph', (_name, mutate, message) => {
  const value = inputs();
  mutate(value);
  expect(() => buildPlatformResultSourcePlan(value.result, value.sourceSnapshot)).toThrow(message);
});

test('rejects missing or extra topic captures', () => {
  const value = inputs();
  value.sourceSnapshot.topics[0].topic_id = '71111111-1111-4111-8111-111111111111';
  expect(() => buildPlatformResultSourcePlan(value.result, value.sourceSnapshot)).toThrow('topic sets');
});

test('rejects duplicate item links before producing provenance', () => {
  const value = inputs();
  value.sourceSnapshot.topics[0].items[0].links.push(
    { issue_id: ISSUE_ID, cluster_id: '62111111-1111-4111-8111-111111111111', linked_by: 'human' },
  );
  expect(() => buildPlatformResultSourcePlan(value.result, value.sourceSnapshot)).toThrow('Duplicate source item link');
});

test('rejects a public issue linked from a different source topic', () => {
  const value = inputs();
  value.sourceSnapshot.topics.push({
    topic_id: '71111111-1111-4111-8111-111111111111',
    items: [{
      id: '81111111-1111-4111-8111-111111111111',
      submission_id: '91111111-1111-4111-8111-111111111111',
      ordinal: 1,
      team_name: '1분과 1조',
      kind: 'core',
      content: '다른 주제의 원문',
      links: [{ issue_id: ISSUE_ID, cluster_id: null, linked_by: 'human' }],
    }],
  });
  value.result.body.issues.push({
    id: '32111111-1111-4111-8111-111111111111',
    topic_id: '71111111-1111-4111-8111-111111111111',
    label: '다른 주제 쟁점',
    teams: [],
    consensus_denominator: 0,
  });
  expect(() => buildPlatformResultSourcePlan(value.result, value.sourceSnapshot)).toThrow('topic does not match');
});

test('rejects source values outside the persisted issue_items vocabulary', () => {
  const value = inputs();
  value.sourceSnapshot.topics[0].items[0].links[0].linked_by = 'moderator';
  expect(() => buildPlatformResultSourcePlan(value.result, value.sourceSnapshot)).toThrow('Invalid source link actor');
});

test('verification rejects a self-rechecksummed plan that differs from source inputs', () => {
  const { result, sourceSnapshot } = inputs();
  const plan = buildPlatformResultSourcePlan(result, sourceSnapshot);
  const alteredSource = structuredClone(sourceSnapshot);
  alteredSource.topics[0].items[0].content = '변경된 원문';
  expect(() => verifyPlatformResultSourcePlan(plan, result, alteredSource)).toThrow();
});

test('CLI creates and verifies a plan without overwriting an existing artifact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-result-source-'));
  try {
    const { result, sourceSnapshot } = inputs();
    const resultPath = join(directory, 'result.json');
    const sourcePath = join(directory, 'source.json');
    const outputPath = join(directory, 'plan.json');
    writeFileSync(resultPath, JSON.stringify(result));
    writeFileSync(sourcePath, JSON.stringify(sourceSnapshot));
    const script = fileURLToPath(new URL('../platform-result-source-plan.mjs', import.meta.url));
    const create = spawnSync(process.execPath, [script, '--result', resultPath, '--issue-items', sourcePath, '--output', outputPath], { encoding: 'utf8' });
    expect(create.status).toBe(0);
    expect(JSON.parse(create.stdout)).toMatchObject({ created: true, issueCount: 1, databaseMutationExecuted: false });
    const verify = spawnSync(process.execPath, [script, '--result', resultPath, '--issue-items', sourcePath, '--verify-plan', outputPath], { encoding: 'utf8' });
    expect(verify.status).toBe(0);
    expect(JSON.parse(verify.stdout)).toEqual({ verified: true, databaseMutationExecuted: false });
    const overwrite = spawnSync(process.execPath, [script, '--result', resultPath, '--issue-items', sourcePath, '--output', outputPath], { encoding: 'utf8' });
    expect(overwrite.status).toBe(1);
    expect(readFileSync(outputPath, 'utf8')).toContain('"schemaVersion": 1');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
