import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildPlatformResultSourcePlan,
  buildPlatformResultSourcePublicationPlan,
  validatePlatformResultSourcePrivateInputPath,
  validatePlatformResultSourcePublicationOutputPath,
  verifyPlatformResultSourcePlan,
  verifyPlatformResultSourcePublicationPlan,
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
          review_status: 'reviewed',
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

function publicationReviews() {
  return {
    schema_version: 1,
    mode: 'replace_all',
    scope: 'session',
    scope_id: SCOPE_ID,
    observed_at: '2026-08-14T12:00:00.000Z',
    decisions: [
      {
        issue_id: ISSUE_ID,
        item_id: ITEM_1,
        publication_status: 'reviewed',
        excerpt: '대중교통 노선을 확대해야 합니다.',
        reviewed_by: 'auth-user:71111111-1111-4111-8111-111111111111',
        reviewer_role: 'hq',
        reviewed_at: '2026-08-14T10:00:00.000Z',
      },
      {
        issue_id: ISSUE_ID,
        item_id: ITEM_2,
        publication_status: 'withheld',
        excerpt: null,
        reviewed_by: 'auth-user:71111111-1111-4111-8111-111111111111',
        reviewer_role: 'hq',
        reviewed_at: '2026-08-14T10:05:00.000Z',
      },
    ],
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

test('builds a sealed replace-all publication plan with exact source bytes and an atomic body', () => {
  const { result, sourceSnapshot } = inputs();
  const reviews = publicationReviews();
  const plan = buildPlatformResultSourcePublicationPlan(result, sourceSnapshot, reviews);
  const expectedDigest = createHash('sha256')
    .update('대중교통 노선을 확대해야 합니다.')
    .digest('hex');

  expect(plan).toMatchObject({
    schemaVersion: 1,
    planKind: 'source_publication',
    mode: 'replace_all',
    dryRun: true,
    databaseMutationExecuted: false,
    publicPayloadWritten: false,
    requiresApproval: true,
    summary: {
      issueCount: 1,
      linkedReferenceCount: 2,
      reviewedReferenceCount: 1,
      withheldReferenceCount: 1,
    },
  });
  expect(plan.atomicResultBody.issues[0].source_references).toEqual([{
    reference_key: expect.stringMatching(/^source-[0-9a-f]{24}$/),
    team_name: '1분과 1조',
    ordinal: 1,
    kind: 'core',
    excerpt: '대중교통 노선을 확대해야 합니다.',
    content_sha256: expectedDigest,
    publication_status: 'reviewed',
    reviewed_at: '2026-08-14T10:00:00.000Z',
    reviewer_role: 'hq',
  }]);
  expect(plan.patches).toHaveLength(2);
  expect(plan.patches[0]).toMatchObject({
    issueId: ISSUE_ID,
    itemId: ITEM_1,
    publicationStatus: 'reviewed',
    contentSha256: expectedDigest,
    reviewer: 'auth-user:71111111-1111-4111-8111-111111111111',
  });
  expect(JSON.stringify(plan.atomicResultBody)).not.toContain('auth-user:');
  expect(plan.beforeBodySha256).not.toBe(plan.afterBodySha256);
  expect(verifyPlatformResultSourcePublicationPlan(plan, result, sourceSnapshot, reviews)).toBe(true);
});

test('requires an explicit decision for every linked source reference', () => {
  const missing = publicationReviews();
  missing.decisions.pop();
  expect(() => buildPlatformResultSourcePublicationPlan(inputs().result, inputs().sourceSnapshot, missing)).toThrow('decision set');

  const duplicate = publicationReviews();
  duplicate.decisions.push(structuredClone(duplicate.decisions[0]));
  expect(() => buildPlatformResultSourcePublicationPlan(inputs().result, inputs().sourceSnapshot, duplicate)).toThrow('Duplicate');

  const unknown = publicationReviews();
  unknown.decisions[0].item_id = ITEM_3;
  expect(() => buildPlatformResultSourcePublicationPlan(inputs().result, inputs().sourceSnapshot, unknown)).toThrow('decision set');
});

test('binds reviewed excerpts to exact canonical source content and enforces withheld semantics', () => {
  const changed = publicationReviews();
  changed.decisions[0].excerpt = '변경된 공개 원문';
  expect(() => buildPlatformResultSourcePublicationPlan(inputs().result, inputs().sourceSnapshot, changed)).toThrow('exact source content');

  const whitespace = inputs();
  whitespace.sourceSnapshot.topics[0].items[0].content = ' 대중교통 노선을 확대해야 합니다.';
  const matching = publicationReviews();
  matching.decisions[0].excerpt = whitespace.sourceSnapshot.topics[0].items[0].content;
  expect(() => buildPlatformResultSourcePublicationPlan(whitespace.result, whitespace.sourceSnapshot, matching)).toThrow('canonical source content');

  const leaked = publicationReviews();
  leaked.decisions[1].excerpt = '보류 결정에 포함되면 안 되는 원문';
  expect(() => buildPlatformResultSourcePublicationPlan(inputs().result, inputs().sourceSnapshot, leaked)).toThrow('withheld excerpt');
});

test('rejects public result aggregate drift before source publication', () => {
  const value = inputs();
  value.result.body.issues[0].teams = ['2분과 1조'];
  expect(() => buildPlatformResultSourcePublicationPlan(
    value.result,
    value.sourceSnapshot,
    publicationReviews(),
  )).toThrow('teams');
});

test.each([
  ['draft issue', (value) => { value.result.body.issues[0].review_status = 'draft'; }, 'reviewed'],
  ['invalid reviewer', (value) => { value.reviews.decisions[0].reviewed_by = 'platform-reviewer'; }, 'reviewer'],
  ['invalid role', (value) => { value.reviews.decisions[0].reviewer_role = 'operator'; }, 'role'],
  ['review predates result', (value) => { value.reviews.decisions[0].reviewed_at = '2026-08-12T10:00:00.000Z'; }, 'predates'],
  ['review follows observation', (value) => { value.reviews.decisions[0].reviewed_at = '2026-08-14T13:00:00.000Z'; }, 'observation'],
  ['invalid timestamp precision', (value) => { value.reviews.decisions[0].reviewed_at = '2026-08-14T10:00:00.12Z'; }, 'timestamp'],
  ['unexpected private field', (value) => { value.reviews.decisions[0].internal_note = '공개 금지'; }, 'Unexpected'],
])('rejects %s before producing a source publication plan', (_name, mutate, message) => {
  const { result, sourceSnapshot } = inputs();
  const value = { result, sourceSnapshot, reviews: publicationReviews() };
  mutate(value);
  expect(() => buildPlatformResultSourcePublicationPlan(value.result, value.sourceSnapshot, value.reviews)).toThrow(message);
});

test('publication verification rejects a re-checksummed plan that differs from the inputs', () => {
  const { result, sourceSnapshot } = inputs();
  const reviews = publicationReviews();
  const plan = buildPlatformResultSourcePublicationPlan(result, sourceSnapshot, reviews);
  const alteredReviews = structuredClone(reviews);
  alteredReviews.decisions[1].reviewer_role = 'org_admin';
  expect(() => verifyPlatformResultSourcePublicationPlan(plan, result, sourceSnapshot, alteredReviews)).toThrow();
});

test('requires publication plans to stay outside the repository', () => {
  const repositoryOutput = fileURLToPath(new URL('../../evaluation/.a7-source-publication-should-not-exist.json', import.meta.url));
  const externalOutput = join(tmpdir(), 'platform-result-source-publication-plan.json');
  expect(validatePlatformResultSourcePublicationOutputPath(externalOutput)).toBe(externalOutput);
  expect(() => validatePlatformResultSourcePublicationOutputPath(repositoryOutput))
    .toThrow('outside the repository');
});

test('requires raw source and review inputs to stay outside the repository', () => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-result-source-private-input-'));
  const externalInput = join(directory, 'private.json');
  const repositoryInput = fileURLToPath(new URL('../platform-result-source-plan.mjs', import.meta.url));
  const repositoryLink = join(directory, 'repository-link');
  try {
    writeFileSync(externalInput, '{}', 'utf8');
    symlinkSync(dirname(repositoryInput), repositoryLink, process.platform === 'win32' ? 'junction' : 'dir');
    expect(validatePlatformResultSourcePrivateInputPath(externalInput, 'review decisions'))
      .toBe(externalInput);
    expect(() => validatePlatformResultSourcePrivateInputPath(repositoryInput, 'issue-items'))
      .toThrow('outside the repository');
    expect(() => validatePlatformResultSourcePrivateInputPath(
      join(repositoryLink, 'platform-result-source-plan.mjs'),
      'review decisions',
    )).toThrow('outside the repository');
    expect(() => validatePlatformResultSourcePrivateInputPath(
      join(directory, 'missing.json'),
      'review decisions',
    )).toThrow('unavailable');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
