import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createResourceRequestCoordinator,
  type ResourceRequestPriority,
} from './resource-request-coordinator';
import {
  beginVoteRefresh,
  canUseFinalVoteSnapshot,
  completeVoteRefresh,
  EMPTY_VOTE_REFRESH_META,
  failVoteRefresh,
} from './mod-state';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ModConsole vote refresh coordination', () => {
  it('gives final verification priority over a slow background poll and later manual work', async () => {
    const coordinator = createResourceRequestCoordinator();
    const background = deferred<string>();
    const final = deferred<string>();
    const applied: string[] = [];
    const run = async (promise: Promise<string>, priority: ResourceRequestPriority): Promise<boolean> => {
      const ticket = coordinator.begin('round:r1', priority);
      if (!ticket) return false;
      try {
        const value = await promise;
        if (!coordinator.isCurrent(ticket)) return false;
        applied.push(value);
        return true;
      } finally {
        coordinator.finish(ticket);
      }
    };

    const oldPoll = run(background.promise, 'background');
    const finalVerification = run(final.promise, 'final');
    await expect(run(Promise.resolve('manual'), 'manual')).resolves.toBe(false);

    final.resolve('verified');
    await expect(finalVerification).resolves.toBe(true);
    background.resolve('stale live tally');
    await expect(oldPoll).resolves.toBe(false);

    expect(applied).toEqual(['verified']);
  });

  it('keeps the final verification state machine and routes each trigger with explicit priority', () => {
    const source = readFileSync(new URL('./ModConsole.tsx', import.meta.url), 'utf8');
    expect(source).toContain("refreshVoteSnapshot(roundId, 'background')");
    expect(source).toContain("refreshVoteSnapshot(state.round.id, 'final')");
    expect(source).toContain("refreshVoteSnapshot(state.round?.id ?? '', 'manual')");
    expect(source).toContain("refreshVoteSnapshot(state.round?.id ?? '', 'final')");
    expect(source).toContain("beginVoteRefresh(current, 'final')");
    expect(source).toContain('completeVoteRefresh(current, priority, Date.now())');
    expect(source).toContain('failVoteRefresh(current, priority)');
    expect(source).toContain('finalSnapshotVerified = canUseFinalVoteSnapshot(voteRefreshMeta)');
    expect(source).toContain('disabled={!finalSnapshotVerified}');
  });

  it('keeps export blocked from close through failure and unlocks only after a successful final retry', () => {
    const afterClose = beginVoteRefresh(EMPTY_VOTE_REFRESH_META, 'final');
    expect(afterClose).toMatchObject({
      failed: false,
      finalVerificationStatus: 'pending',
      busy: true,
    });
    expect(canUseFinalVoteSnapshot(afterClose)).toBe(false);

    const afterFailure = failVoteRefresh(afterClose, 'final');
    expect(afterFailure).toMatchObject({
      failed: true,
      finalVerificationStatus: 'failed',
      busy: false,
    });
    expect(canUseFinalVoteSnapshot(afterFailure)).toBe(false);

    const retrying = beginVoteRefresh(afterFailure, 'final');
    const verified = completeVoteRefresh(retrying, 'final', 123_456);
    expect(verified).toEqual({
      failed: false,
      finalVerificationStatus: 'verified',
      lastSuccessAt: 123_456,
      busy: false,
    });
    expect(canUseFinalVoteSnapshot(verified)).toBe(true);
  });

  it('does not let a successful background refresh certify a closed result', () => {
    const pending = beginVoteRefresh(EMPTY_VOTE_REFRESH_META, 'final');
    const liveOnly = completeVoteRefresh(pending, 'background', 9_000);

    expect(liveOnly.finalVerificationStatus).toBe('pending');
    expect(canUseFinalVoteSnapshot(liveOnly)).toBe(false);
  });

  it('uses the CAS status contract without a redundant active-to-active create transition', () => {
    const source = readFileSync(new URL('./ModConsole.tsx', import.meta.url), 'utf8');

    expect(source).toContain('roundStatusIntentRef');
    expect(source).toMatch(/getOrCreateRoundStatusIntent\(\s*roundStatusIntentRef\.current,\s*roundId,\s*'active',\s*'closed'/);
    expect(source).toMatch(/getOrCreateRoundStatusIntent\(\s*roundStatusIntentRef\.current,\s*roundId,\s*'closed',\s*'active'/);
    expect(source).toContain('intent.idempotencyKey');
    expect(source).not.toContain("setPollStatus(access, round.id, 'active'");
    expect(source).toContain('setClosedAt(roundUpdatedAtMs(closed))');
    expect(source).toContain('await fetchTeamRounds(access)');
  });
});
