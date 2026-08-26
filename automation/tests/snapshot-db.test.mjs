import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect, vi } from 'vitest';
import {
  buildSnapshotRestoreRehearsalSql,
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

const FIXTURE_UUIDS = new Map([
  ['org-1', '00000000-0000-0000-0000-000000000001'],
  ['org-2', '00000000-0000-0000-0000-000000000002'],
  ['topic-1', '00000000-0000-0000-0000-000000000011'],
  ['topic-2', '00000000-0000-0000-0000-000000000012'],
  ['team-1', '00000000-0000-0000-0000-000000000021'],
  ['submission-1', '00000000-0000-0000-0000-000000000031'],
  ['missing-submission', '00000000-0000-0000-0000-000000000039'],
  ['item-1', '00000000-0000-0000-0000-000000000041'],
  ['item-2', '00000000-0000-0000-0000-000000000042'],
  ['missing-item', '00000000-0000-0000-0000-000000000049'],
  ['issue-1', '00000000-0000-0000-0000-000000000051'],
  ['session-1', '00000000-0000-0000-0000-000000000061'],
  ['session-2', '00000000-0000-0000-0000-000000000062'],
  ['assembly-1', '00000000-0000-0000-0000-000000000071'],
  ['ballot-1', '00000000-0000-0000-0000-000000000081'],
  ['ballot-2', '00000000-0000-0000-0000-000000000082'],
  ['ballot-item-1', '00000000-0000-0000-0000-000000000091'],
  ['ballot-item-2', '00000000-0000-0000-0000-000000000092'],
  ['response-1', '00000000-0000-0000-0000-0000000000a1'],
  ['result-1', '00000000-0000-0000-0000-0000000000b1'],
  ['result-topic', '00000000-0000-0000-0000-0000000000b2'],
  ['result-session', '00000000-0000-0000-0000-0000000000b3'],
  ['result-assembly', '00000000-0000-0000-0000-0000000000b4'],
]);

function canonicalizeFixtureUuids(value) {
  if (typeof value === 'string') return FIXTURE_UUIDS.get(value) ?? value;
  if (Array.isArray(value)) return value.map(canonicalizeFixtureUuids);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    FIXTURE_UUIDS.get(key) ?? key,
    canonicalizeFixtureUuids(entry),
  ]));
}

function platformPayloadFixture(overrides = {}) {
  return {
    submission: [{
      id: 'submission-1', topic_id: 'topic-1', team_id: 'team-1',
      status: 'draft', org_id: 'org-1',
    }],
    submission_item: [{
      id: 'item-1', submission_id: 'submission-1', ordinal: 1,
      kind: 'core', content: 'Participant statement', rationale: null, provenance: {},
    }],
    issue: [{
      id: 'issue-1', topic_id: 'topic-1', label: 'Assembly issue', stance: null,
      frequency_class: null, origin: 'ai', review_status: 'draft', org_id: 'org-1',
    }],
    issue_link: [],
    result_page: [],
    ballot: [{
      id: 'ballot-1',
      session_id: 'session-1',
      title: 'Assembly ballot',
      status: 'open',
      token: 'ballot-token-1',
      subgroup: null,
      org_id: 'org-1',
    }],
    ballot_item: [{
      id: 'ballot-item-1',
      ballot_id: 'ballot-1',
      ordinal: 1,
      statement: 'Support this proposal',
      scale: 5,
      required: true,
    }],
    ballot_response: [{ id: 'response-1', ballot_id: 'ballot-1', client_id: 'client-0001', answers: { 'ballot-item-1': 3 } }],
    counts: { issue: 1, issue_link: 0, result_page: 0, submission: 1, ballot: 1 },
    ...overrides,
  };
}

async function signedArchiveFixture(payload = platformPayloadFixture()) {
  const canonicalPayload = canonicalizeFixtureUuids(payload);
  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { snapshot_id: 42 }, error: null })
    .mockResolvedValueOnce({ data: { id: 77 }, error: null });
  return snapshotArchive({
    client: makeClient(rpc, {
      data: {
        id: 77,
        label: 'platform-recovery-fixture',
        source: 'platform',
        taken_at: TEST_AUDIT_CONTEXT.exportedAt,
        votes_count: 0,
        rounds_count: 0,
        archive_log_count: 0,
        payload: canonicalPayload,
      },
      error: null,
    }),
    roundId: 8,
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
  });
}

function schemaV1Archive(archive) {
  const audit = {
    schemaVersion: 1,
    event: archive.audit.event,
    exportedAt: archive.audit.exportedAt,
    repository: archive.audit.repository,
    runId: archive.audit.runId,
    commitSha: archive.audit.commitSha,
    workflowRef: archive.audit.workflowRef,
    keyId: archive.audit.keyId,
    snapshotId: archive.audit.snapshotId,
  };
  const digest = createHmac('sha256', TEST_AUDIT_KEY).update(JSON.stringify({
    ...audit,
    platform: archive.platform,
  })).digest('hex');
  return {
    ...archive,
    audit: {
      ...audit,
      integrity: { algorithm: 'hmac-sha256', target: 'platform+provenance', digest },
    },
  };
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
      schemaVersion: 2,
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
        target: 'legacy+platform+provenance',
        digest: createHmac('sha256', TEST_AUDIT_KEY).update(JSON.stringify({
          schemaVersion: 2,
          event: 'platform_snapshot_export',
          exportedAt: TEST_AUDIT_CONTEXT.exportedAt,
          repository: TEST_AUDIT_CONTEXT.repository,
          runId: TEST_AUDIT_CONTEXT.runId,
          commitSha: TEST_AUDIT_CONTEXT.commitSha,
          workflowRef: TEST_AUDIT_CONTEXT.workflowRef,
          keyId: TEST_AUDIT_CONTEXT.keyId,
          snapshotId: 77,
          legacy: { snapshot_id: 42, source: 'cron' },
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

test('refuses to sign an empty legacy snapshot receipt before creating the platform snapshot', async () => {
  const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: null });
  await expect(snapshotArchive({
    client: makeClient(rpc),
    roundId: 8,
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
  })).rejects.toThrow('legacy snapshot receipt is invalid');
  expect(rpc).toHaveBeenCalledOnce();
  expect(rpc).not.toHaveBeenCalledWith('platform_snapshot_now', expect.any(Object));
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
    legacy: archive.legacy,
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

test('binds the legacy snapshot into schema v2 archive integrity', async () => {
  const archive = await signedArchiveFixture();
  expect(archive.audit.schemaVersion).toBe(2);
  expect(archive.audit.integrity.target).toBe('legacy+platform+provenance');
  expect(verifySnapshotArchiveIntegrity({
    ...archive,
    legacy: { ...archive.legacy, snapshot_id: 999 },
  }, TEST_AUDIT_KEY)).toBe(false);
});

test('reports schema v1 archives as platform-only integrity without overstating legacy verification', async () => {
  const archive = schemaV1Archive(await signedArchiveFixture());
  expect(verifySnapshotArchiveIntegrity(archive, TEST_AUDIT_KEY)).toBe(false);
  expect(verifySnapshotArchiveIntegrity(
    archive,
    TEST_AUDIT_KEY,
    { allowPlatformOnlyV1: true },
  )).toBe(true);
  expect(verifySnapshotArchiveIntegrity({
    ...archive,
    legacy: { ...archive.legacy, snapshot_id: 999 },
  }, TEST_AUDIT_KEY, { allowPlatformOnlyV1: true })).toBe(true);
  withSnapshotFile(archive, (filePath) => {
    expect(verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toEqual(expect.objectContaining({
        integrityTarget: 'platform+provenance',
        legacyIntegrityVerified: false,
      }));
  });
});

test('rejects signed snapshot archive envelope schema drift without exposing unknown values', async () => {
  const archive = await signedArchiveFixture();
  const privateValue = 'private-value-must-not-echo';

  const { legacy: _legacy, ...archiveWithoutLegacy } = archive;
  expect(verifySnapshotArchiveIntegrity(archiveWithoutLegacy, TEST_AUDIT_KEY)).toBe(false);
  expect(verifySnapshotArchiveIntegrity({ ...archive, internalNote: privateValue }, TEST_AUDIT_KEY)).toBe(false);
  expect(verifySnapshotArchiveIntegrity({
    ...archive,
    audit: { ...archive.audit, internalNote: privateValue },
  }, TEST_AUDIT_KEY)).toBe(false);
  expect(verifySnapshotArchiveIntegrity({
    ...archive,
    audit: {
      ...archive.audit,
      integrity: { ...archive.audit.integrity, internalNote: privateValue },
    },
  }, TEST_AUDIT_KEY)).toBe(false);

  const rpc = vi.fn()
    .mockResolvedValueOnce({ data: { snapshot_id: 42 }, error: null })
    .mockResolvedValueOnce({ data: { id: 77 }, error: null });
  const platformDriftArchive = await snapshotArchive({
    client: makeClient(rpc, {
      data: {
        id: 77,
        source: 'platform',
        payload: canonicalizeFixtureUuids(platformPayloadFixture()),
        internalNote: privateValue,
      },
      error: null,
    }),
    roundId: 8,
    includePlatformSnapshot: true,
    ...TEST_AUDIT_OPTIONS,
  });
  expect(verifySnapshotArchiveIntegrity(platformDriftArchive, TEST_AUDIT_KEY)).toBe(false);

  const payloadDriftArchive = await signedArchiveFixture({
    ...platformPayloadFixture(),
    internalCollection: [{ value: privateValue }],
  });
  withSnapshotFile(payloadDriftArchive, (filePath) => {
    let error;
    try {
      verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('snapshot archive payload fields are invalid');
    expect(error.message).not.toContain(privateValue);
  });

  const countDriftArchive = await signedArchiveFixture(platformPayloadFixture({
    counts: {
      issue: 1,
      issue_link: 0,
      result_page: 0,
      submission: 1,
      ballot: 1,
      internalCount: privateValue,
    },
  }));
  withSnapshotFile(countDriftArchive, (filePath) => {
    let error;
    try {
      verifySnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('snapshot archive declared count fields are invalid');
    expect(error.message).not.toContain(privateValue);
  });
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
      integrityTarget: 'legacy+platform+provenance',
      legacyIntegrityVerified: true,
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
      integrityTarget: 'legacy+platform+provenance',
      legacyIntegrityVerified: true,
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
      checkedTenantRelationships: 0,
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
      {
        id: 'item-1', submission_id: 'submission-1', ordinal: 1,
        kind: 'core', content: 'First statement', rationale: null, provenance: {},
      },
      {
        id: 'item-2', submission_id: 'submission-1', ordinal: 1,
        kind: 'extra', content: 'Second statement', rationale: null, provenance: {},
      },
    ],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive duplicate key: submission_item.submission_id+ordinal');
  });
});

test('rejects an orphaned internal reference before any database restore is attempted', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    submission_item: [{
      id: 'item-1', submission_id: 'missing-submission', ordinal: 1,
      kind: 'core', content: 'Participant statement', rationale: null, provenance: {},
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive broken reference: submission_item.submission_id');
  });
});

test('rejects a non-canonical UUID row id before restore validation continues', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    submission: [{
      id: 'not-a-uuid', topic_id: 'topic-1', team_id: 'team-1',
      status: 'draft', org_id: 'org-1',
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive UUID is invalid: submission.id');
  });
});

test('rejects a non-canonical UUID internal reference before checking parent presence', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    ballot_item: [{
      id: 'ballot-item-1', ballot_id: 'not-a-uuid', ordinal: 1,
      statement: 'Support this proposal', scale: 5, required: true,
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive UUID is invalid: ballot_item.ballot_id');
  });
});

test('rejects non-canonical UUIDs in external and nullable references', async () => {
  const cases = [
    {
      payload: platformPayloadFixture({
        submission: [{
          id: 'submission-1', topic_id: 'not-a-uuid', team_id: 'team-1',
          status: 'draft', org_id: 'org-1',
        }],
      }),
      message: 'snapshot archive UUID is invalid: submission_or_issue.topic_id',
    },
    {
      payload: platformPayloadFixture({
        issue_link: [{
          issue_id: 'issue-1', item_id: 'item-1', cluster_id: 'not-a-uuid', linked_by: 'human',
        }],
        counts: { issue: 1, issue_link: 1, result_page: 0, submission: 1, ballot: 1 },
      }),
      message: 'snapshot archive UUID is invalid: issue_link.cluster_id',
    },
    {
      payload: platformPayloadFixture({
        ballot_response: [{
          id: 'response-1', ballot_id: 'ballot-1', client_id: 'client-0001',
          answers: { 'ballot-item-1': 3 }, org_id: 'not-a-uuid',
        }],
      }),
      message: 'snapshot archive UUID is invalid: ballot_response.org_id',
    },
    {
      payload: platformPayloadFixture({
        result_page: [{
          id: 'result-1', scope: 'topic', scope_id: 'not-a-uuid', token: 'result-token',
          title: 'Topic result', body: {}, org_id: 'org-1',
        }],
        counts: { issue: 1, issue_link: 0, result_page: 1, submission: 1, ballot: 1 },
      }),
      message: 'snapshot archive UUID is invalid: result_page.scope_id',
    },
  ];

  for (const { payload, message } of cases) {
    const archive = await signedArchiveFixture(payload);
    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow(message);
    });
  }
});

test('rejects submission statuses outside the database enum', async () => {
  for (const status of [undefined, 'closed']) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      submission: [{
        id: 'submission-1', topic_id: 'topic-1', team_id: 'team-1', status, org_id: 'org-1',
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive submission status is invalid');
    });
  }
});

test('rejects submission item ordinals that are not PostgreSQL integers', async () => {
  for (const ordinal of [null, 1.5, -2_147_483_649]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      submission_item: [{
        id: 'item-1', submission_id: 'submission-1', ordinal,
        kind: 'core', content: 'Participant statement', rationale: null, provenance: {},
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive submission item ordinal is invalid');
    });
  }
});

test('rejects submission item kinds outside the database enum', async () => {
  for (const kind of [undefined, 'other']) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      submission_item: [{
        id: 'item-1', submission_id: 'submission-1', ordinal: 1,
        kind, content: 'Participant statement', rationale: null, provenance: {},
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive submission item kind is invalid');
    });
  }
});

test('rejects submission item content outside the database trimmed length bounds', async () => {
  for (const content of ['   ', 'x'.repeat(2_001)]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      submission_item: [{
        id: 'item-1', submission_id: 'submission-1', ordinal: 1,
        kind: 'core', content, rationale: null, provenance: {},
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive submission item content is invalid');
    });
  }
});

test('rejects submission item rationale outside the nullable database length bound', async () => {
  for (const rationale of [17, 'x'.repeat(2_001)]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      submission_item: [{
        id: 'item-1', submission_id: 'submission-1', ordinal: 1,
        kind: 'core', content: 'Participant statement', rationale, provenance: {},
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive submission item rationale is invalid');
    });
  }
});

test('accepts JSON null submission item provenance as a non-SQL-null jsonb value', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    submission_item: [{
      id: 'item-1', submission_id: 'submission-1', ordinal: 1,
      kind: 'core', content: 'Participant statement', rationale: null, provenance: null,
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }).status)
      .toBe('preflight_passed');
  });
});

test('accepts omitted nullable and defaulted submission item fields', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    submission_item: [{
      id: 'item-1', submission_id: 'submission-1', ordinal: 1,
      kind: 'core', content: 'Participant statement',
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }).status)
      .toBe('preflight_passed');
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
      {
        id: 'ballot-1', session_id: 'session-1', title: 'First ballot', status: 'open',
        token: 'ballot-token-1', org_id: 'org-1',
      },
      {
        id: 'ballot-2', session_id: 'session-1', title: 'Second ballot', status: 'open',
        token: 'ballot-token-2', org_id: 'org-1',
      },
    ],
    ballot_item: [
      {
        id: 'ballot-item-1', ballot_id: 'ballot-1', ordinal: 1,
        statement: 'First statement', scale: 5, required: true,
      },
      {
        id: 'ballot-item-2', ballot_id: 'ballot-2', ordinal: 1,
        statement: 'Second statement', scale: 5, required: false,
      },
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

test('rejects a ballot item whose required flag is not a database boolean', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    ballot_item: [{
      id: 'ballot-item-1',
      ballot_id: 'ballot-1',
      ordinal: 1,
      statement: 'Support this proposal',
      scale: 5,
      required: 'true',
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive ballot item required flag is invalid');
  });
});

test('rejects ballot response client ids outside the database length bounds', async () => {
  for (const clientId of ['short', 'x'.repeat(81)]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      ballot_response: [{
        id: 'response-1',
        ballot_id: 'ballot-1',
        client_id: clientId,
        answers: { 'ballot-item-1': 3 },
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive ballot response client id is invalid');
    });
  }
});

test('rejects an unsupported ballot scale even when the ballot has no responses', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    ballot_item: [{
      id: 'ballot-item-1',
      ballot_id: 'ballot-1',
      ordinal: 1,
      statement: 'Support this proposal',
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

test('rejects ballot titles outside the database trimmed length bounds', async () => {
  for (const title of ['   ', 'x'.repeat(201)]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      ballot: [{
        id: 'ballot-1', session_id: 'session-1', title, status: 'open',
        token: 'ballot-token-1', org_id: 'org-1',
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive ballot title is invalid');
    });
  }
});

test('rejects ballot statuses outside the database enum', async () => {
  for (const status of [undefined, 'scheduled']) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      ballot: [{
        id: 'ballot-1', session_id: 'session-1', title: 'Assembly ballot', status,
        token: 'ballot-token-1', org_id: 'org-1',
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive ballot status is invalid');
    });
  }
});

test('rejects ballot item statements outside the database trimmed length bounds', async () => {
  for (const statement of ['   ', 'x'.repeat(301)]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      ballot_item: [{
        id: 'ballot-item-1', ballot_id: 'ballot-1', ordinal: 1,
        statement, scale: 5, required: true,
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive ballot item statement is invalid');
    });
  }
});

test('rejects ballot item ordinals that are not PostgreSQL integers', async () => {
  for (const ordinal of [null, 1.5, 2_147_483_648]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      ballot_item: [{
        id: 'ballot-item-1', ballot_id: 'ballot-1', ordinal,
        statement: 'Support this proposal', scale: 5, required: true,
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive ballot item ordinal is invalid');
    });
  }
});

test('rejects issue labels outside the database trimmed length bounds', async () => {
  for (const label of ['   ', 'x'.repeat(201)]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      issue: [{
        id: 'issue-1', topic_id: 'topic-1', label, stance: null,
        frequency_class: null, origin: 'ai', review_status: 'draft', org_id: 'org-1',
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive issue label is invalid');
    });
  }
});

test('rejects issue stances outside the nullable database enum', async () => {
  for (const stance of [17, 'support']) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      issue: [{
        id: 'issue-1', topic_id: 'topic-1', label: 'Assembly issue', stance,
        frequency_class: null, origin: 'ai', review_status: 'draft', org_id: 'org-1',
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive issue stance is invalid');
    });
  }
});

test('rejects issue frequency classes outside the nullable database enum', async () => {
  for (const frequencyClass of [17, 'unanimous']) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      issue: [{
        id: 'issue-1', topic_id: 'topic-1', label: 'Assembly issue', stance: null,
        frequency_class: frequencyClass, origin: 'ai', review_status: 'draft', org_id: 'org-1',
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive issue frequency class is invalid');
    });
  }
});

test('rejects issue origins outside the database enum', async () => {
  for (const origin of [undefined, 'model']) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      issue: [{
        id: 'issue-1', topic_id: 'topic-1', label: 'Assembly issue', stance: null,
        frequency_class: null, origin, review_status: 'draft', org_id: 'org-1',
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive issue origin is invalid');
    });
  }
});

test('rejects issue review statuses outside the database enum', async () => {
  for (const reviewStatus of [undefined, 'approved']) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      issue: [{
        id: 'issue-1', topic_id: 'topic-1', label: 'Assembly issue', stance: null,
        frequency_class: null, origin: 'ai', review_status: reviewStatus, org_id: 'org-1',
      }],
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive issue review status is invalid');
    });
  }
});

test('rejects issue link authors outside the database enum', async () => {
  for (const linkedBy of [undefined, 'moderator']) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      issue_link: [{
        issue_id: 'issue-1', item_id: 'item-1', cluster_id: null, linked_by: linkedBy,
      }],
      counts: { issue: 1, issue_link: 1, result_page: 0, submission: 1, ballot: 1 },
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive issue link author is invalid');
    });
  }
});

test('rejects result page titles outside the database trimmed length bounds', async () => {
  for (const title of ['   ', 'x'.repeat(301)]) {
    const archive = await signedArchiveFixture(platformPayloadFixture({
      result_page: [{
        id: 'result-1', scope: 'topic', scope_id: 'topic-1', token: 'result-token',
        title, body: {}, org_id: 'org-1',
      }],
      counts: { issue: 1, issue_link: 0, result_page: 1, submission: 1, ballot: 1 },
    }));

    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow('snapshot archive result page title is invalid');
    });
  }
});

test('accepts JSON null as a non-SQL-null result page body value', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    result_page: [{
      id: 'result-1', scope: 'topic', scope_id: 'topic-1', token: 'result-token',
      title: 'Topic result', body: null, org_id: 'org-1',
    }],
    counts: { issue: 1, issue_link: 0, result_page: 1, submission: 1, ballot: 1 },
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }).status)
      .toBe('preflight_passed');
  });
});

test('rejects an issue link whose item belongs to another discussion topic', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    issue: [{
      id: 'issue-1', topic_id: 'topic-2', label: 'Assembly issue', stance: null,
      frequency_class: null, origin: 'ai', review_status: 'draft', org_id: 'org-1',
    }],
    issue_link: [{
      issue_id: 'issue-1', item_id: 'item-1', cluster_id: null, linked_by: 'human',
    }],
    counts: { issue: 1, issue_link: 1, result_page: 0, submission: 1, ballot: 1 },
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive issue link crosses discussion topics');
  });
});

test('rejects an issue link whose item belongs to another organization', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    issue: [{
      id: 'issue-1', topic_id: 'topic-1', label: 'Assembly issue', stance: null,
      frequency_class: null, origin: 'ai', review_status: 'draft', org_id: 'org-2',
    }],
    issue_link: [{
      issue_id: 'issue-1', item_id: 'item-1', cluster_id: null, linked_by: 'human',
    }],
    counts: { issue: 1, issue_link: 1, result_page: 0, submission: 1, ballot: 1 },
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive issue link crosses organizations');
  });
});

test('rejects a ballot response whose explicit organization differs from its ballot', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    ballot_response: [{
      id: 'response-1', ballot_id: 'ballot-1', client_id: 'client-0001',
      answers: { 'ballot-item-1': 3 }, org_id: 'org-2',
    }],
  }));

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive ballot response crosses organizations');
  });
});

test('reports organization and polymorphic result parents as distinct external dependencies', async () => {
  const archive = await signedArchiveFixture(platformPayloadFixture({
    result_page: [
      {
        id: 'result-topic', scope: 'topic', scope_id: 'topic-2', token: 'token-topic',
        title: 'Topic result', body: {}, org_id: 'org-1',
      },
      {
        id: 'result-session', scope: 'session', scope_id: 'session-2', token: 'token-session',
        title: 'Session result', body: {}, org_id: 'org-1',
      },
      {
        id: 'result-assembly', scope: 'assembly', scope_id: 'assembly-1', token: 'token-assembly',
        title: 'Assembly result', body: {}, org_id: 'org-2',
      },
    ],
    ballot_response: [{
      id: 'response-1',
      ballot_id: 'ballot-1',
      client_id: 'client-0001',
      answers: { 'ballot-item-1': 3 },
      org_id: 'org-1',
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

test('rejects unknown recovery row fields before restore SQL can silently discard them', async () => {
  const sensitiveFieldName = 'participant_private_note';
  const collections = [
    'submission',
    'submission_item',
    'issue',
    'issue_link',
    'result_page',
    'ballot',
    'ballot_item',
    'ballot_response',
  ];

  for (const collection of collections) {
    const payload = platformPayloadFixture();
    if (payload[collection].length === 0) {
      if (collection === 'issue_link') {
        payload.issue_link = [{
          issue_id: 'issue-1', item_id: 'item-1', cluster_id: null, linked_by: 'ai',
          [sensitiveFieldName]: 'must not appear in the error',
        }];
        payload.counts.issue_link = 1;
      } else {
        payload.result_page = [{
          id: 'result-1', scope: 'topic', scope_id: 'topic-1', token: 'result-token-1',
          title: 'Assembly result', body: {}, org_id: 'org-1',
          [sensitiveFieldName]: 'must not appear in the error',
        }];
        payload.counts.result_page = 1;
      }
    } else {
      payload[collection] = [{
        ...payload[collection][0],
        [sensitiveFieldName]: 'must not appear in the error',
      }];
    }

    const archive = await signedArchiveFixture(payload);
    withSnapshotFile(archive, (filePath) => {
      expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
        .toThrow(`snapshot archive row fields are invalid: ${collection}`);
      try {
        rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY });
      } catch (error) {
        expect(String(error)).not.toContain(sensitiveFieldName);
        expect(String(error)).not.toContain('must not appear in the error');
      }
    });
  }
});

test('rejects unknown recovery collections before restore can omit their rows', async () => {
  const sensitiveCollectionName = 'participant_private_events';
  const archive = await signedArchiveFixture({
    ...platformPayloadFixture(),
    [sensitiveCollectionName]: [{ value: 'must not appear in the error' }],
  });

  withSnapshotFile(archive, (filePath) => {
    expect(() => rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY }))
      .toThrow('snapshot archive payload fields are invalid');
    try {
      rehearseSnapshotArchiveFile({ filePath, auditKey: TEST_AUDIT_KEY });
    } catch (error) {
      expect(String(error)).not.toContain(sensitiveCollectionName);
      expect(String(error)).not.toContain('must not appear in the error');
    }
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
          legacy: archive.legacy,
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

test('keeps the isolated PostgreSQL restore fixture aligned with the exact archive envelope', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'snapshot-restore-fixture-'));
  const archivePath = join(tempDir, 'archive.json');
  try {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('fixtures/create-snapshot-restore-archive.mjs', import.meta.url)),
        archivePath,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, SNAPSHOT_AUDIT_HMAC_KEY: TEST_AUDIT_KEY },
      },
    );
    expect(verifySnapshotArchiveFile({ filePath: archivePath, auditKey: TEST_AUDIT_KEY }))
      .toEqual(expect.objectContaining({
        status: 'verified',
        snapshotId: 77,
        counts: expect.objectContaining({ submission: 1, issue: 1, ballot: 1 }),
      }));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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

test('builds a transaction-bound restore rehearsal for the isolated verify database', async () => {
  const archive = await signedArchiveFixture();
  withSnapshotFile(archive, (filePath) => {
    const result = buildSnapshotRestoreRehearsalSql({
      filePath,
      auditKey: TEST_AUDIT_KEY,
      databaseName: 'verify',
    });

    expect(result.report).toEqual(expect.objectContaining({
      status: 'restore_rehearsal_prepared',
      snapshotId: 77,
      integrityTarget: 'legacy+platform+provenance',
      legacyIntegrityVerified: true,
      databaseName: 'verify',
      databaseRestoreExecuted: false,
      counts: expect.objectContaining({ submission: 1, issue: 1, ballot: 1 }),
    }));
    expect(result.sql).toContain("current_database() <> 'verify'");
    expect(result.sql).toContain('snapshot restore rehearsal requires empty target tables');
    expect(result.sql).toContain("tgname = 'submission_item_lock_guard'");
    expect(result.sql).toContain('alter table climate_vote.submission_item disable trigger submission_item_lock_guard');
    expect(result.sql).toContain('alter table climate_vote.submission_item enable trigger submission_item_lock_guard');
    for (const collection of [
      'submission',
      'submission_item',
      'issue',
      'issue_link',
      'result_page',
      'ballot',
      'ballot_item',
      'ballot_response',
    ]) {
      expect(result.sql).toContain(`snapshot restore row mismatch: ${collection}`);
    }
    expect(result.sql).toContain('actual is distinct from expected');
    expect(result.sql).toContain("'archiveRowsVerified', true");
    expect(result.sql).toContain("'legacyIntegrityVerified', true");
    expect(result.sql).toContain('jsonb_populate_recordset(null::climate_vote.submission');
    expect(result.sql).toContain("'databaseRestoreExecuted', true");
    expect(result.sql).toContain('rollback;');
    expect(result.sql).not.toContain(TEST_AUDIT_KEY);
  });
});

test('refuses to prepare a restore rehearsal for a non-isolated database name', async () => {
  const archive = await signedArchiveFixture();
  withSnapshotFile(archive, (filePath) => {
    expect(() => buildSnapshotRestoreRehearsalSql({
      filePath,
      auditKey: TEST_AUDIT_KEY,
      databaseName: 'postgres',
    })).toThrow('snapshot restore rehearsal requires the verify database');
  });
});

test('prepares restore rehearsal SQL through the CLI without connecting to a database', async () => {
  const archive = await signedArchiveFixture();
  withSnapshotFile(archive, (filePath) => {
    const tempDir = mkdtempSync(join(tmpdir(), 'snapshot-restore-sql-'));
    const outputPath = join(tempDir, 'restore.sql');
    try {
      const output = execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL('../snapshot-db.mjs', import.meta.url)),
          '--prepare-restore-rehearsal',
          filePath,
          outputPath,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            SNAPSHOT_AUDIT_HMAC_KEY: TEST_AUDIT_KEY,
            SNAPSHOT_RESTORE_DATABASE: 'verify',
          },
        },
      );
      expect(JSON.parse(output)).toEqual(expect.objectContaining({
        status: 'restore_rehearsal_prepared',
        databaseRestoreExecuted: false,
      }));
      expect(readFileSync(outputPath, 'utf8')).toContain('begin;');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
