import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, vi } from 'vitest';
import {
  snapshotArchive,
  snapshotRound,
  rehearseSnapshotArchiveFile,
  verifySnapshotArchiveFile,
  verifySnapshotArchiveIntegrity,
  workflowAuditContext,
} from '../snapshot-db.mjs';

/**
 * Factory that produces a mock supabase client with .schema() chain.
 * Closes over a single rpc instance so retries all hit the same mock.
 * No top-level .rpc — ensures client.schema(...).rpc(...) path is required.
 */
function makeClient(rpc, snapshotResponse = { data: null, error: null }) {
  const single = vi.fn().mockResolvedValue(snapshotResponse);
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const schema = vi.fn(() => ({ rpc, from }));
  return { schema, snapshotQuery: { from, select, eq, single } };
}

const TEST_AUDIT_KEY = 'test-only-audit-key-with-at-least-32-characters';
const TEST_AUDIT_CONTEXT = {
  exportedAt: '2026-08-11T05:30:00.000Z',
  repository: 'seojaehong/climate-assembly-wiki',
  runId: '31429231374',
  commitSha: 'bd84e27462e4eac7b7a96dbef40fca4c628e9740',
  workflowRef: 'seojaehong/climate-assembly-wiki/.github/workflows/snapshot.yml@refs/heads/main',
  keyId: 'snapshot-audit-2026-08-v1',
};
const TEST_AUDIT_OPTIONS = { auditKey: TEST_AUDIT_KEY, auditContext: TEST_AUDIT_CONTEXT };

function platformPayloadFixture(overrides = {}) {
  return {
    submission: [{ id: 'submission-1', topic_id: 'topic-1', team_id: 'team-1', org_id: 'org-1' }],
    submission_item: [{ id: 'item-1', submission_id: 'submission-1', ordinal: 1 }],
    issue: [{ id: 'issue-1', topic_id: 'topic-1', org_id: 'org-1' }],
    issue_link: [],
    result_page: [],
    ballot: [{ id: 'ballot-1', session_id: 'session-1', token: 'ballot-token-1', org_id: 'org-1' }],
    ballot_item: [{ id: 'ballot-item-1', ballot_id: 'ballot-1', ordinal: 1, scale: 5, required: true }],
    ballot_response: [{ id: 'response-1', ballot_id: 'ballot-1', client_id: 'client-0001', answers: { 'ballot-item-1': 3 } }],
    counts: { issue: 1, issue_link: 0, result_page: 0, submission: 1, ballot: 1 },
    ...overrides,
  };
}

async function signedArchiveFixture(payload = platformPayloadFixture()) {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { snapshot_id: 42 }, error: null })
    .mockResolvedValueOnce({ data: { id: 77 }, error: null });
  return snapshotArchive({
    client: makeClient(rpc, { data: { id: 77, source: 'platform', payload }, error: null }),
    roundId: 8,
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
  });
}

function withSnapshotFile(archive, callback) {
  const tempDir = mkdtempSync(join(tmpdir(), 'snapshot-verify-'));
  const filePath = join(tempDir, 'snapshot.json');
  writeFileSync(filePath, typeof archive === 'string' ? archive : JSON.stringify(archive), 'utf8');
  try {
    return callback(filePath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test('calls .schema("climate_vote").rpc("cv_snapshot_now", p_label+p_source) — regression guard', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { snapshot_id: 42, votes: 126 }, error: null });
  const client = makeClient(rpc);
  const out = await snapshotRound({ client, roundId: 2, label: '7월_행사-r2' });

  // Must route through schema('climate_vote') — catches public-schema revert
  expect(client.schema).toHaveBeenCalledWith('climate_vote');
  // Correct RPC signature: p_label + p_source — no p_round_id
  expect(rpc).toHaveBeenCalledWith('cv_snapshot_now', { p_label: '7월_행사-r2', p_source: 'cron' });
  // Regression: must NOT pass p_round_id (that caused PGRST202 / HTTP 404)
  expect(rpc).not.toHaveBeenCalledWith('cv_snapshot_now', expect.objectContaining({ p_round_id: expect.anything() }));
  expect(out.snapshot_id).toBe(42);
});

test('retries 5 times then alerts on persistent failure (warning by default)', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'token expired' } });
  const alert = vi.fn();
  await expect(snapshotRound({
    client: makeClient(rpc), roundId: 2, maxRetries: 5, baseDelayMs: 1, alert
  })).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(5);
  expect(alert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
});

test('escalates to critical after 3 cumulative failures', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } });
  const alert = vi.fn();
  await expect(snapshotRound({
    client: makeClient(rpc), roundId: 2, maxRetries: 1, baseDelayMs: 1, alert,
    cumulativeFailures: 3
  })).rejects.toThrow();
  expect(alert).toHaveBeenCalledWith(expect.objectContaining({ level: 'critical' }));
});

test('returns immediately on first try success (no retry, no alert)', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
  const alert = vi.fn();
  const out = await snapshotRound({ client: makeClient(rpc), roundId: 5, alert, maxRetries: 5, baseDelayMs: 1 });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
  expect(out.ok).toBe(true);
});

test('adds the platform snapshot after the legacy snapshot when platform export is enabled', async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { snapshot_id: 42, source: 'cron' }, error: null })
    .mockResolvedValueOnce({ data: { id: 77, source: 'platform' }, error: null });
  const platformRow = {
    id: 77,
    source: 'platform',
    payload: { issue: [{ id: 'issue-1' }], ballot: [] },
  };
  const client = makeClient(rpc, { data: platformRow, error: null });

  const out = await snapshotArchive({
    client,
    roundId: 8,
    label: '8차_전체법정의결-r8',
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
  });

  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenNthCalledWith(1, 'cv_snapshot_now', {
    p_label: '8차_전체법정의결-r8',
    p_source: 'cron',
  });
  expect(rpc).toHaveBeenNthCalledWith(2, 'platform_snapshot_now', {
    p_label: '8차_전체법정의결-r8',
  });
  expect(client.snapshotQuery.from).toHaveBeenCalledWith('snapshots');
  expect(client.snapshotQuery.select).toHaveBeenCalledWith('*');
  expect(client.snapshotQuery.eq).toHaveBeenCalledWith('id', 77);
  expect(client.snapshotQuery.single).toHaveBeenCalledOnce();
  expect(out).toEqual({
    legacy: { snapshot_id: 42, source: 'cron' },
    platform: platformRow,
    audit: {
      schemaVersion: 1,
      event: 'platform_snapshot_export',
      exportedAt: '2026-08-11T05:30:00.000Z',
      repository: 'seojaehong/climate-assembly-wiki',
      runId: '31429231374',
      commitSha: 'bd84e27462e4eac7b7a96dbef40fca4c628e9740',
      workflowRef: 'seojaehong/climate-assembly-wiki/.github/workflows/snapshot.yml@refs/heads/main',
      keyId: 'snapshot-audit-2026-08-v1',
      snapshotId: 77,
      integrity: {
        algorithm: 'hmac-sha256',
        target: 'platform+provenance',
        digest: createHmac('sha256', TEST_AUDIT_KEY).update(JSON.stringify({
          schemaVersion: 1,
          event: 'platform_snapshot_export',
          exportedAt: TEST_AUDIT_CONTEXT.exportedAt,
          repository: TEST_AUDIT_CONTEXT.repository,
          runId: TEST_AUDIT_CONTEXT.runId,
          commitSha: TEST_AUDIT_CONTEXT.commitSha,
          workflowRef: TEST_AUDIT_CONTEXT.workflowRef,
          keyId: TEST_AUDIT_CONTEXT.keyId,
          snapshotId: 77,
          platform: platformRow,
        })).digest('hex'),
      },
    },
  });
});

test('keeps the platform snapshot disabled by default without changing the legacy RPC', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { snapshot_id: 42 }, error: null });

  const out = await snapshotArchive({
    client: makeClient(rpc),
    roundId: 3,
    label: '2차_의제선정-r3',
  });

  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('cv_snapshot_now', {
    p_label: '2차_의제선정-r3',
    p_source: 'cron',
  });
  expect(out).toEqual({ snapshot_id: 42 });
});

test('fails visibly when the created platform snapshot payload cannot be exported', async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { snapshot_id: 42 }, error: null })
    .mockResolvedValueOnce({ data: { id: 77, source: 'platform' }, error: null });
  const alert = vi.fn();

  await expect(snapshotArchive({
    client: makeClient(rpc, { data: null, error: { message: 'snapshot read denied' } }),
    roundId: 8,
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
    maxRetries: 2,
    baseDelayMs: 1,
    alert,
  })).rejects.toThrow('platform snapshot export persistent failure');

  expect(alert).toHaveBeenCalledWith(expect.objectContaining({
    level: 'warning',
    message: 'platform snapshot export failed: snapshot read denied',
  }));
});

test('fails closed before querying when the platform receipt has no valid snapshot id', async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { snapshot_id: 42 }, error: null })
    .mockResolvedValueOnce({ data: { source: 'platform' }, error: null });
  const client = makeClient(rpc);
  const alert = vi.fn();

  await expect(snapshotArchive({
    client,
    roundId: 8,
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
    alert,
  })).rejects.toThrow('platform snapshot receipt did not include a valid id');

  expect(client.snapshotQuery.from).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(expect.objectContaining({
    message: 'platform snapshot export failed: platform snapshot receipt did not include a valid id',
  }));
});

test('fails visibly without falling back when the enabled platform snapshot cannot be created', async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { snapshot_id: 42 }, error: null })
    .mockResolvedValue({ data: null, error: { message: 'platform snapshot unavailable' } });
  const alert = vi.fn();

  await expect(snapshotArchive({
    client: makeClient(rpc),
    roundId: 8,
    label: '8차_전체법정의결-r8',
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
    maxRetries: 2,
    baseDelayMs: 1,
    alert,
  })).rejects.toThrow('platform snapshot persistent failure');

  expect(rpc).toHaveBeenCalledTimes(3);
  expect(rpc.mock.calls.slice(1)).toEqual([
    ['platform_snapshot_now', { p_label: '8차_전체법정의결-r8' }],
    ['platform_snapshot_now', { p_label: '8차_전체법정의결-r8' }],
  ]);
  expect(alert).toHaveBeenCalledWith(expect.objectContaining({
    level: 'warning',
    message: 'platform snapshot failed: platform snapshot unavailable',
  }));
});

test('snapshot workflow keeps platform export disabled until the repository variable is approved', () => {
  const workflow = readFileSync(
    new URL('../../.github/workflows/snapshot.yml', import.meta.url),
    'utf8',
  );
  const source = readFileSync(new URL('../snapshot-db.mjs', import.meta.url), 'utf8');

  expect(workflow).toContain("PLATFORM_SNAPSHOT_ENABLED: ${{ vars.PLATFORM_SNAPSHOT_ENABLED || 'false' }}");
  expect(workflow).toContain('SNAPSHOT_AUDIT_HMAC_KEY: ${{ secrets.SNAPSHOT_AUDIT_HMAC_KEY }}');
  expect(workflow).toContain('SNAPSHOT_AUDIT_KEY_ID: ${{ vars.SNAPSHOT_AUDIT_KEY_ID }}');
  expect(workflow.indexOf('PLATFORM_SNAPSHOT_ENABLED:')).toBeLessThan(
    workflow.indexOf('run: node snapshot-db.mjs > snapshot.out.json'),
  );
  expect(source).toContain('auditContext: workflowAuditContext(process.env)');
  expect(source).toContain('auditKey: process.env.SNAPSHOT_AUDIT_HMAC_KEY');
});

test('maps GitHub workflow provenance into the platform export audit context', () => {
  expect(workflowAuditContext({
    GITHUB_REPOSITORY: 'seojaehong/climate-assembly-wiki',
    GITHUB_RUN_ID: '31429231374',
    GITHUB_SHA: 'bd84e27462e4eac7b7a96dbef40fca4c628e9740',
    GITHUB_WORKFLOW_REF: 'seojaehong/climate-assembly-wiki/.github/workflows/snapshot.yml@refs/heads/main',
    SNAPSHOT_AUDIT_KEY_ID: 'snapshot-audit-2026-08-v1',
  }, '2026-08-11T05:30:00.000Z')).toEqual({
    exportedAt: '2026-08-11T05:30:00.000Z',
    repository: 'seojaehong/climate-assembly-wiki',
    runId: '31429231374',
    commitSha: 'bd84e27462e4eac7b7a96dbef40fca4c628e9740',
    workflowRef: 'seojaehong/climate-assembly-wiki/.github/workflows/snapshot.yml@refs/heads/main',
    keyId: 'snapshot-audit-2026-08-v1',
  });
});

test('verifies the exported platform row and rejects payload tampering', async () => {
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { snapshot_id: 42 }, error: null })
    .mockResolvedValueOnce({ data: { id: 77 }, error: null });
  const platformRow = { id: 77, source: 'platform', payload: { issue: [{ id: 'issue-1' }] } };
  const archive = await snapshotArchive({
    client: makeClient(rpc, { data: platformRow, error: null }),
    roundId: 8,
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
  });

  expect(verifySnapshotArchiveIntegrity(archive, TEST_AUDIT_KEY)).toBe(true);
  expect(verifySnapshotArchiveIntegrity({
    ...archive,
    platform: { ...archive.platform, payload: { issue: [] } },
  }, TEST_AUDIT_KEY)).toBe(false);
  expect(verifySnapshotArchiveIntegrity({
    ...archive,
    audit: { ...archive.audit, commitSha: 'attacker-controlled-sha' },
  }, TEST_AUDIT_KEY)).toBe(false);
  const attackerKey = 'attacker-key-with-at-least-32-characters';
  const forgedPlatform = { ...archive.platform, payload: { issue: [] } };
  const forgedAudit = { ...archive.audit, commitSha: 'attacker-controlled-sha' };
  const forgedRecord = {
    schemaVersion: forgedAudit.schemaVersion,
    event: forgedAudit.event,
    exportedAt: forgedAudit.exportedAt,
    repository: forgedAudit.repository,
    runId: forgedAudit.runId,
    commitSha: forgedAudit.commitSha,
    workflowRef: forgedAudit.workflowRef,
    keyId: forgedAudit.keyId,
    snapshotId: forgedAudit.snapshotId,
    platform: forgedPlatform,
  };
  const forgedArchive = {
    ...archive,
    platform: forgedPlatform,
    audit: {
      ...forgedAudit,
      integrity: {
        ...forgedAudit.integrity,
        digest: createHmac('sha256', attackerKey).update(JSON.stringify(forgedRecord)).digest('hex'),
      },
    },
  };
  expect(verifySnapshotArchiveIntegrity(forgedArchive, TEST_AUDIT_KEY)).toBe(false);
});

test('fails closed before the platform RPC when audit signing configuration is incomplete', async () => {
  for (const options of [
    { auditKey: '', auditContext: TEST_AUDIT_CONTEXT },
    { auditKey: TEST_AUDIT_KEY, auditContext: { ...TEST_AUDIT_CONTEXT, runId: null } },
    { auditKey: TEST_AUDIT_KEY, auditContext: { ...TEST_AUDIT_CONTEXT, keyId: null } },
  ]) {
    const rpc = vi.fn().mockResolvedValue({ data: { snapshot_id: 42 }, error: null });
    await expect(snapshotArchive({
      client: makeClient(rpc),
      roundId: 8,
      includePlatformSnapshot: true,
      ...options,
    })).rejects.toThrow('platform snapshot audit configuration is incomplete');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('cv_snapshot_now', expect.any(Object));
  }
});

test('verifies a signed archive file and returns a non-sensitive recovery summary', async () => {
  const archive = await signedArchiveFixture();
  withSnapshotFile(archive, (filePath) => {
    expect(verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY })).toEqual({
      status: 'verified',
      snapshotId: 77,
      source: 'platform',
      keyId: TEST_AUDIT_CONTEXT.keyId,
      exportedAt: TEST_AUDIT_CONTEXT.exportedAt,
      repository: TEST_AUDIT_CONTEXT.repository,
      runId: TEST_AUDIT_CONTEXT.runId,
      commitSha: TEST_AUDIT_CONTEXT.commitSha,
      workflowRef: TEST_AUDIT_CONTEXT.workflowRef,
      counts: {
        submission: 1,
        submission_item: 1,
        issue: 1,
        issue_link: 0,
        result_page: 0,
        ballot: 1,
        ballot_item: 1,
        ballot_response: 1,
      },
    });
  });
});

test('rehearses internal restore relationships and reports unavailable parent dependencies without exposing row data', async () => {
  const archive = await signedArchiveFixture();
  withSnapshotFile(archive, (filePath) => {
    expect(rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY })).toEqual({
      status: 'preflight_passed',
      snapshotId: 77,
      keyId: TEST_AUDIT_CONTEXT.keyId,
      databaseRestoreExecuted: false,
      archiveRestoreOrder: [
        'submission',
        'submission_item',
        'issue',
        'issue_link',
        'result_page',
        'ballot',
        'ballot_item',
        'ballot_response',
      ],
      checkedInternalReferences: 3,
      checkedBallotAnswers: 1,
      externalDependencies: {
        org: 1,
        discussion_topic: 1,
        team: 1,
        session: 1,
        assembly: 0,
      },
      counts: expect.objectContaining({
        submission: 1,
        submission_item: 1,
        issue: 1,
        ballot: 1,
        ballot_item: 1,
        ballot_response: 1,
      }),
    });
  });
});

test('rejects duplicate composite keys that would make an isolated restore fail', async () => {
  const duplicateLink = { issue_id: 'issue-1', item_id: 'item-1', cluster_id: null, linked_by: 'human' };
  const archive = await signedArchiveFixture(platformPayloadFixture({
    issue_link: [duplicateLink, { ...duplicateLink }],
    counts: { issue: 1, issue_link: 2, result_page: 0, submission: 1, ballot: 1 },
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive duplicate key: issue_link.issue_id+item_id');
  });
});

test('rejects duplicate child ordinals even when row ids are distinct', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    submission_item: [
      { id: 'item-1', submission_id: 'submission-1', ordinal: 1 },
      { id: 'item-2', submission_id: 'submission-1', ordinal: 1 },
    ],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive duplicate key: submission_item.submission_id+ordinal');
  });
});

test('rejects an orphaned internal reference before any database restore is attempted', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    submission_item: [{ id: 'item-1', submission_id: 'missing-submission', ordinal: 1 }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive broken reference: submission_item.submission_id');
  });
});

test('rejects a response that omits an answer required by the archived ballot item', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    ballot_response: [{
      id: 'response-1',
      ballot_id: 'ballot-1',
      client_id: 'client-0001',
      answers: {},
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive required ballot answer is missing');
  });
});

test('rejects a response that references an item missing from the archive', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    ballot_response: [{
      id: 'response-1',
      ballot_id: 'ballot-1',
      client_id: 'client-0001',
      answers: { 'ballot-item-1': 3, 'missing-item': 2 },
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive ballot answer references unknown item');
  });
});

test('rejects a response that references an item from another ballot', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    ballot: [
      { id: 'ballot-1', session_id: 'session-1', token: 'ballot-token-1', org_id: 'org-1' },
      { id: 'ballot-2', session_id: 'session-1', token: 'ballot-token-2', org_id: 'org-1' },
    ],
    ballot_item: [
      { id: 'ballot-item-1', ballot_id: 'ballot-1', ordinal: 1, scale: 5, required: true },
      { id: 'ballot-item-2', ballot_id: 'ballot-2', ordinal: 1, scale: 5, required: false },
    ],
    ballot_response: [{
      id: 'response-1',
      ballot_id: 'ballot-1',
      client_id: 'client-0001',
      answers: { 'ballot-item-1': 3, 'ballot-item-2': 2 },
    }],
    counts: { issue: 1, issue_link: 0, result_page: 0, submission: 1, ballot: 2 },
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive ballot answer belongs to another ballot');
  });
});

test('rejects an unsupported ballot scale even when the ballot has no responses', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    ballot_item: [{
      id: 'ballot-item-1',
      ballot_id: 'ballot-1',
      ordinal: 1,
      scale: 3,
      required: true,
    }],
    ballot_response: [],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive ballot item scale is invalid');
  });
});

test('reports organization and polymorphic result parents as distinct external dependencies', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    result_page: [
      { id: 'result-topic', scope: 'topic', scope_id: 'topic-2', token: 'token-topic', org_id: 'org-1' },
      { id: 'result-session', scope: 'session', scope_id: 'session-2', token: 'token-session', org_id: 'org-1' },
      { id: 'result-assembly', scope: 'assembly', scope_id: 'assembly-1', token: 'token-assembly', org_id: 'org-1' },
    ],
    ballot_response: [{
      id: 'response-1',
      ballot_id: 'ballot-1',
      client_id: 'client-0001',
      answers: { 'ballot-item-1': 3 },
      org_id: 'org-2',
    }],
    counts: { issue: 1, issue_link: 0, result_page: 3, submission: 1, ballot: 1 },
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }).externalDependencies).toEqual({
      org: 2,
      discussion_topic: 2,
      team: 1,
      session: 2,
      assembly: 1,
    });
  });
});

test('rejects a signed archive file whose platform payload was changed', async () => {
  const archive = await signedArchiveFixture();
  const tampered = {
    ...archive,
    platform: { ...archive.platform, payload: { ...archive.platform.payload, issue: [] } },
  };

  withSnapshotFile(tampered, (filePath) => {
    expect(() => verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive integrity verification failed');
  });
});

test('rejects a validly signed archive that is missing a required recovery collection', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({ ballot_response: undefined }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive collection is missing: ballot_response');
  });
});

test('rejects a validly signed archive whose declared counts disagree with its payload', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    counts: { issue: 9, issue_link: 0, result_page: 0, submission: 1, ballot: 1 },
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive count mismatch: issue');
  });
});

test('rejects a validly signed archive whose row is not a platform snapshot', async () => {
  const archive = await signedArchiveFixture();
  const platform = { ...archive.platform, source: 'legacy' };
  const audit = {
    ...archive.audit,
    integrity: {
      ...archive.audit.integrity,
      digest: createHmac('sha256', TEST_AUDIT_KEY)
        .update(JSON.stringify({
          schemaVersion: archive.audit.schemaVersion,
          event: archive.audit.event,
          exportedAt: archive.audit.exportedAt,
          repository: archive.audit.repository,
          runId: archive.audit.runId,
          commitSha: archive.audit.commitSha,
          workflowRef: archive.audit.workflowRef,
          keyId: archive.audit.keyId,
          snapshotId: archive.audit.snapshotId,
          platform,
        }))
        .digest('hex'),
    },
  };

  withSnapshotFile({ ...archive, platform, audit }, (filePath) => {
    expect(() => verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive platform source is invalid');
  });
});

test('rejects malformed archive JSON without echoing archive content', () => {
  const sensitiveFragment = 'citizen-name-sensitive';
  withSnapshotFile(`{"platform":"${sensitiveFragment}",`, (filePath) => {
    try {
      verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY });
      throw new Error('expected malformed archive rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('snapshot archive JSON is invalid');
      expect(error.message).not.toContain(sensitiveFragment);
    }
  });
});

test('verifies an archive through the read-only CLI without loading the snapshot schedule', async () => {
  const archive = await signedArchiveFixture();
  withSnapshotFile(archive, (filePath) => {
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../snapshot-db.mjs', import.meta.url)), '--verify', filePath],
      {
        encoding: 'utf8',
        env: { ...process.env, SNAPSHOT_AUDIT_HMAC_KEY: TEST_AUDIT_KEY },
      },
    );
    expect(JSON.parse(output)).toEqual(expect.objectContaining({
      status: 'verified',
      snapshotId: 77,
      keyId: TEST_AUDIT_CONTEXT.keyId,
      counts: expect.objectContaining({ issue: 1, submission: 1, ballot: 1 }),
    }));
  });
});

test('runs the read-only recovery preflight CLI without loading the snapshot schedule', async () => {
  const archive = await signedArchiveFixture();
  withSnapshotFile(archive, (filePath) => {
    const output = execFileSync(
      process.execPath,
      [fileURLToPath(new URL('../snapshot-db.mjs', import.meta.url)), '--rehearse', filePath],
      {
        encoding: 'utf8',
        env: { ...process.env, SNAPSHOT_AUDIT_HMAC_KEY: TEST_AUDIT_KEY },
      },
    );
    expect(JSON.parse(output)).toEqual(expect.objectContaining({
      status: 'preflight_passed',
      snapshotId: 77,
      databaseRestoreExecuted: false,
      checkedInternalReferences: 3,
      checkedBallotAnswers: 1,
    }));
  });
});
