import { readFileSync } from 'node:fs';
import { test, expect, vi } from 'vitest';
import { snapshotArchive, snapshotRound } from '../snapshot-db.mjs';

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

  expect(workflow).toContain("PLATFORM_SNAPSHOT_ENABLED: ${{ vars.PLATFORM_SNAPSHOT_ENABLED || 'false' }}");
  expect(workflow.indexOf('PLATFORM_SNAPSHOT_ENABLED:')).toBeLessThan(
    workflow.indexOf('run: node snapshot-db.mjs > snapshot.out.json'),
  );
});
