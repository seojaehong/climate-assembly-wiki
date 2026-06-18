import { test, expect, vi } from 'vitest';
import { snapshotRound } from '../snapshot-db.mjs';

test('calls cv_snapshot_now with round_id and returns JSON', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { snapshot_id: 42, votes: 126 }, error: null });
  const client = { rpc };
  const out = await snapshotRound({ client, roundId: 2 });
  expect(rpc).toHaveBeenCalledWith('cv_snapshot_now', { p_round_id: 2 });
  expect(out.snapshot_id).toBe(42);
});

test('retries 5 times then alerts on persistent failure (warning by default)', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'token expired' } });
  const alert = vi.fn();
  await expect(snapshotRound({
    client: { rpc }, roundId: 2, maxRetries: 5, baseDelayMs: 1, alert
  })).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(5);
  expect(alert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
});

test('escalates to critical after 3 cumulative failures', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } });
  const alert = vi.fn();
  await expect(snapshotRound({
    client: { rpc }, roundId: 2, maxRetries: 1, baseDelayMs: 1, alert,
    cumulativeFailures: 3
  })).rejects.toThrow();
  expect(alert).toHaveBeenCalledWith(expect.objectContaining({ level: 'critical' }));
});

test('returns immediately on first try success (no retry, no alert)', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
  const alert = vi.fn();
  const out = await snapshotRound({ client: { rpc }, roundId: 5, alert, maxRetries: 5, baseDelayMs: 1 });
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(alert).not.toHaveBeenCalled();
  expect(out.ok).toBe(true);
});
