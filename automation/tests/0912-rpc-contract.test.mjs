import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  RPC_0912_DECLARED_CONTRACTS,
  RPC_0912_EMULATOR_IMPLEMENTED,
  RehearsalRpcError,
  create0912RpcRehearsal,
} from '../0912-rpc-contract.mjs';

const fixturePath = fileURLToPath(new URL('../fixtures/0912-rehearsal.json', import.meta.url));
const emulatorPath = fileURLToPath(new URL('../0912-rpc-contract.mjs', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const JOIN_CODE = '734821';
const HQ_TOKEN = 'c'.repeat(64);

function createHarness() {
  return create0912RpcRehearsal(fixture, { joinCode: JOIN_CODE, hqToken: HQ_TOKEN });
}

async function join(harness, device) {
  return harness.call('mod_exchange_join_code', {
    p_join_code: JOIN_CODE,
    p_device_id: device.id,
    p_device_label: device.label,
  });
}

describe('9/12 UI-fixture RPC emulator subset', () => {
  test('separates declared inventory, emulator implementation, and browser fixture allowance', () => {
    expect(fixture.expectedRpcContracts).toEqual(RPC_0912_DECLARED_CONTRACTS);
    expect(fixture.rpcCoverage.emulatorImplementedRpcNames).toEqual(RPC_0912_EMULATOR_IMPLEMENTED);
    expect(RPC_0912_DECLARED_CONTRACTS).toHaveLength(56);
    expect(RPC_0912_EMULATOR_IMPLEMENTED).toHaveLength(22);
    expect(RPC_0912_DECLARED_CONTRACTS.length).toBeGreaterThan(RPC_0912_EMULATOR_IMPLEMENTED.length);
    expect(Object.keys(fixture.fieldRehearsal.rpcBehaviors).every(
      (rpc) => RPC_0912_DECLARED_CONTRACTS.includes(rpc),
    )).toBe(true);
    expect(RPC_0912_DECLARED_CONTRACTS).toContain('workshop_hq_logout_v2');
    expect(RPC_0912_DECLARED_CONTRACTS).toContain('mod_set_round_status_v3');
    expect(RPC_0912_DECLARED_CONTRACTS).not.toContain('mod_set_round_status_v2');
    expect(RPC_0912_EMULATOR_IMPLEMENTED).not.toContain('workshop_hq_logout_v2');
    expect(fixture.rpcCoverage).toMatchObject({
      evidenceClass: 'ui-fixture-only',
      securityOrLifecycleEvidence: false,
      canonicalSecurityVerifier: 'scripts/verify-0912-postgres.sh',
      declaredInventorySource: 'expectedRpcContracts',
      browserFixtureAllowlistSource: 'fieldRehearsal.rpcBehaviors',
      emulatorImplementedMeaning: expect.stringContaining('not authorization, lifecycle, concurrency, or database-security evidence'),
    });
    expect(fixture.classification).toBe('synthetic-no-pii-no-secrets');
    expect(fixture.authorization.capabilityValuesStoredInFixture).toBe(false);
    expect(fixture.fieldRehearsal.rpcBehaviors.mod_set_round_status_v3).toMatchObject({
      requiresTeamToken: true,
      requiresIdempotencyKey: true,
      requiresExpectedStatus: true,
      allowedTransitions: ['active->closed', 'closed->active'],
      closedToActiveWindowSeconds: 60,
      serverTimeAuthoritative: true,
    });
    expect(fixture.rolloutContract).toMatchObject({
      productionMutationRequiresExplicitApproval: true,
      approvalGates: [
        'p1-tenancy',
        'secure-session-team-seed',
        's20-draft-topics',
        'p1a-additive',
        'p2-analysis-org-selection',
        'p2a-token-only-cutover',
        'p3-design-provisioning',
        'p4-audit-log',
      ],
      orderedSteps: [
        'session-roster-review',
        'p1-tenancy',
        'secure-session-team-seed',
        's20-draft-topics',
        'p1a-additive-and-verify',
        'hq-rotate-join-codes',
        'p2-analysis',
        'p1b-p1c-org-selection',
        'maintenance-deploy-token-staff-client',
        'p2a-atomic-token-grant-legacy-revoke',
        'p2a-positive-legacy-negative-verify',
        'p3-design-provisioning',
        'p4-audit-log',
        'post-p4-legacy-negative-and-final-status',
      ],
      p1aTeamTokenRpcPubliclyExecutable: false,
      p2aAtomicTokenGrantAndLegacyRevoke: true,
    });
    const serialized = JSON.stringify(fixture).toLowerCase();
    expect(serialized).not.toMatch(/access[_-]?token\s*[:=]\s*["'][0-9a-f]{32,}/);
    expect(serialized).not.toMatch(/@|010[- ]?\d{3,4}[- ]?\d{4}/);
  });

  test('keeps the implementation metadata exhaustive with every switch case', () => {
    const source = readFileSync(emulatorPath, 'utf8');
    const switchCaseNames = [...source.matchAll(/^\s*case '([a-z0-9_]+)': \{$/gm)]
      .map((match) => match[1]);
    expect(switchCaseNames).toEqual(RPC_0912_EMULATOR_IMPLEMENTED);
    expect(new Set(switchCaseNames).size).toBe(switchCaseNames.length);
  });

  test('fails closed when fixture implementation metadata overstates or omits a switch case', () => {
    const overstatedEvidence = structuredClone(fixture);
    overstatedEvidence.rpcCoverage.securityOrLifecycleEvidence = true;
    expect(() => create0912RpcRehearsal(overstatedEvidence, {
      joinCode: JOIN_CODE,
      hqToken: HQ_TOKEN,
    })).toThrow('must classify the emulator as UI-fixture-only');

    const overstated = structuredClone(fixture);
    overstated.rpcCoverage.emulatorImplementedRpcNames.push('workshop_hq_logout_v2');
    expect(() => create0912RpcRehearsal(overstated, {
      joinCode: JOIN_CODE,
      hqToken: HQ_TOKEN,
    })).toThrow('rpcCoverage.emulatorImplementedRpcNames must exactly match');

    const omitted = structuredClone(fixture);
    omitted.rpcCoverage.emulatorImplementedRpcNames = omitted.rpcCoverage.emulatorImplementedRpcNames.slice(1);
    expect(() => create0912RpcRehearsal(omitted, {
      joinCode: JOIN_CODE,
      hqToken: HQ_TOKEN,
    })).toThrow('rpcCoverage.emulatorImplementedRpcNames must exactly match');
  });

  test('reports a declared but unimplemented RPC without pretending to emulate it', async () => {
    const harness = createHarness();
    await expect(harness.call('workshop_hq_logout_v2', {
      p_token: HQ_TOKEN,
    })).rejects.toMatchObject({ code: 'declared_rpc_not_implemented' });
    expect(harness.snapshot().rpcCoverage).toMatchObject({
      evidenceClass: 'ui-fixture-only',
      securityOrLifecycleEvidence: false,
      canonicalSecurityVerifier: 'scripts/verify-0912-postgres.sh',
      declaredRpcCount: RPC_0912_DECLARED_CONTRACTS.length,
      emulatorImplementedRpcCount: RPC_0912_EMULATOR_IMPLEMENTED.length,
      attemptedRpcNames: ['workshop_hq_logout_v2'],
      successfullyExercisedEmulatorRpcNames: [],
      failedRpcNames: ['workshop_hq_logout_v2'],
    });
    expect(harness.snapshot().rpcCoverage.unimplementedDeclaredRpcNames).toContain('workshop_hq_logout_v2');
  });

  test('accepts only a rotated six-digit synthetic join code', () => {
    expect(() => create0912RpcRehearsal(fixture, {
      joinCode: 'not-six-digits',
      hqToken: HQ_TOKEN,
    })).toThrow('rotated synthetic six-digit code');
    expect(() => create0912RpcRehearsal(fixture, {
      joinCode: '091201',
      hqToken: HQ_TOKEN,
    })).toThrow('rotated synthetic six-digit code');
  });

  test('allows two active devices, resumes them, and rejects a third device', async () => {
    const harness = createHarness();
    const first = await join(harness, fixture.devices[0]);
    const second = await join(harness, fixture.devices[1]);
    await expect(harness.call('mod_session_get', { p_token: first.accessToken })).resolves.toMatchObject({
      v: 1,
      team: { id: fixture.team.id },
      sessionId: fixture.session.id,
    });
    expect(second.accessToken).not.toBe(first.accessToken);
    await expect(join(harness, fixture.devices[2])).rejects.toMatchObject({
      name: 'RehearsalRpcError',
      code: 'team_device_limit',
    });
    expect(harness.snapshot().activeDeviceCount).toBe(2);
  });

  test('rotates a returning device token without consuming a third slot', async () => {
    const harness = createHarness();
    const first = await join(harness, fixture.devices[0]);
    const rotated = await join(harness, fixture.devices[0]);
    expect(rotated.accessToken).not.toBe(first.accessToken);
    await expect(harness.call('mod_session_get', { p_token: first.accessToken })).rejects.toMatchObject({
      code: 'invalid_team_token',
    });
    await expect(harness.call('mod_session_get', { p_token: rotated.accessToken })).resolves.toMatchObject({
      deviceId: fixture.devices[0].id,
    });
    await join(harness, fixture.devices[1]);
    expect(harness.snapshot().activeDeviceCount).toBe(2);
  });

  test('returns an OCC conflict without overwriting the newer submission', async () => {
    const harness = createHarness();
    const session = await join(harness, fixture.devices[0]);
    const topicId = fixture.topics[0].id;
    const first = await harness.call('submission_save_v3', {
      p_token: session.accessToken,
      p_topic_id: topicId,
      p_items: [{ ordinal: 1, content: '첫 저장' }],
      p_expected_version: 0,
      p_idempotency_key: 'save-a',
    });
    expect(first).toMatchObject({ status: 'draft', version: 1 });

    const conflict = await harness.call('submission_save_v3', {
      p_token: session.accessToken,
      p_topic_id: topicId,
      p_items: [{ ordinal: 1, content: '낡은 기기 저장' }],
      p_expected_version: 0,
      p_idempotency_key: 'save-b',
    });
    expect(conflict).toMatchObject({
      status: 'conflict',
      version: 1,
      items: [{ content: '첫 저장' }],
    });
    const forcedConflict = await harness.call('submission_save_v3', {
      p_token: session.accessToken,
      p_topic_id: topicId,
      p_items: [{ ordinal: 1, content: '보지 못한 새 버전을 덮으려는 글' }],
      p_expected_version: 0,
      p_idempotency_key: 'save-forced-stale',
      p_force: true,
    });
    expect(forcedConflict).toMatchObject({
      status: 'conflict',
      version: 1,
      items: [{ content: '첫 저장' }],
    });
    await expect(harness.call('submission_get_v2', {
      p_token: session.accessToken,
      p_topic_id: topicId,
    })).resolves.toMatchObject({ version: 1, items: [{ content: '첫 저장' }] });
  });

  test('finalizes with CAS and reopens without an expected-version argument', async () => {
    const harness = createHarness();
    const session = await join(harness, fixture.devices[0]);
    const topicId = fixture.topics[0].id;
    await harness.call('submission_save_v3', {
      p_token: session.accessToken,
      p_topic_id: topicId,
      p_items: [{ ordinal: 1, content: '최종 제출할 합성 글' }],
      p_expected_version: 0,
      p_idempotency_key: 'final-save',
    });
    await expect(harness.call('submission_finalize_v2', {
      p_token: session.accessToken,
      p_topic_id: topicId,
      p_expected_version: 0,
    })).resolves.toMatchObject({ status: 'conflict', version: 1 });
    await expect(harness.call('submission_finalize_v2', {
      p_token: session.accessToken,
      p_topic_id: topicId,
      p_expected_version: 1,
    })).resolves.toMatchObject({ status: 'final', version: 2 });
    await expect(harness.call('submission_reopen_by_team_v2', {
      p_token: session.accessToken,
      p_topic_id: topicId,
    })).resolves.toMatchObject({ status: 'reopened', version: 3 });
  });

  test('exercises the implemented token-only moderator and ballot emulator subset', async () => {
    const harness = createHarness();
    const session = await join(harness, fixture.devices[0]);
    const roundCreateArgs = {
      p_token: session.accessToken,
      p_title: '합성 투표',
      p_type: 'RADIO',
      p_options: ['가', '나'],
      p_idempotency_key: '09120000-0000-4000-8000-000000000601',
    };
    const round = await harness.call('mod_create_round_v3', roundCreateArgs);
    await expect(harness.call('mod_create_round_v3', roundCreateArgs)).resolves.toEqual(round);
    await expect(harness.call('mod_create_round_v3', {
      ...roundCreateArgs,
      p_title: '다른 합성 투표',
    })).rejects.toMatchObject({ code: 'idempotency_mismatch' });
    await expect(harness.call('mod_create_round_v3', {
      ...roundCreateArgs,
      p_idempotency_key: '09120000-0000-4000-8000-000000000602',
    })).rejects.toMatchObject({
      code: 'active_round_conflict',
      existingRoundId: round.id,
    });
    const firstProxyArgs = {
      p_token: session.accessToken,
      p_round_id: round.id,
      p_choice: '가',
      p_n: 2,
      p_idempotency_key: '09120000-0000-4000-8000-000000000701',
    };
    await expect(harness.call('mod_proxy_vote_v3', firstProxyArgs)).resolves.toBe(2);
    await expect(harness.call('mod_proxy_vote_v3', firstProxyArgs)).resolves.toBe(2);
    await expect(harness.call('mod_proxy_vote_v3', {
      ...firstProxyArgs,
      p_idempotency_key: '09120000-0000-4000-8000-000000000702',
    })).resolves.toBe(2);
    await expect(harness.call('mod_proxy_vote_v3', {
      ...firstProxyArgs,
      p_idempotency_key: 'not-a-uuid',
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(harness.call('mod_log_timer_v2', {
      p_token: session.accessToken,
      p_kind: 'session',
      p_duration_s: 600,
      p_started_at: '2026-09-12T01:00:00.000Z',
    })).resolves.toEqual(expect.any(Number));
    await expect(harness.call('mod_set_round_status_v3', {
      p_token: session.accessToken,
      p_round_id: round.id,
      p_expected_status: 'active',
      p_status: 'closed',
      p_idempotency_key: '09120000-0000-4000-8000-000000000603',
    })).resolves.toMatchObject({ status: 'closed', proxy_votes: 4 });

    const ballotCreateArgs = {
      p_token: session.accessToken,
      p_title: '합성 다의제 투표',
      p_instructions: null,
      p_items: [{ ordinal: 1, statement: '합성 문항', scale: 4 }],
      p_subgroup: null,
      p_idempotency_key: '09120000-0000-4000-8000-000000000801',
    };
    const ballot = await harness.call('ballot_create_v3', ballotCreateArgs);
    await expect(harness.call('ballot_create_v3', ballotCreateArgs)).resolves.toEqual(ballot);
    await expect(harness.call('ballot_create_v3', {
      ...ballotCreateArgs,
      p_title: '다른 합성 다의제 투표',
    })).rejects.toMatchObject({ code: 'idempotency_mismatch' });
    const secondBallot = await harness.call('ballot_create_v3', {
      ...ballotCreateArgs,
      p_idempotency_key: '09120000-0000-4000-8000-000000000802',
    });
    expect(secondBallot.id).not.toBe(ballot.id);
    await expect(harness.call('ballot_set_status_v2', {
      p_token: session.accessToken,
      p_ballot_id: ballot.id,
      p_status: 'open',
    })).resolves.toEqual({ id: ballot.id, status: 'open' });
    await expect(harness.call('ballot_list_v2', { p_token: session.accessToken })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ballot.id, status: 'open', item_count: 1 }),
        expect.objectContaining({ id: secondBallot.id, status: 'draft', item_count: 1 }),
      ]),
    );
    await expect(harness.call('ballot_results_v2', {
      p_token: session.accessToken,
      p_ballot_token: ballot.token,
    })).resolves.toMatchObject({ id: ballot.id, responses: 0, items: [{ n: 0 }] });
    expect(harness.snapshot()).toMatchObject({ roundCount: 1, ballotCount: 2 });
  });

  test('emulates v3 round-status CAS, exact replay, payload binding, and the server-time reopen window', async () => {
    let serverNow = new Date('2026-09-12T01:00:00.000Z');
    const harness = create0912RpcRehearsal(fixture, {
      joinCode: JOIN_CODE,
      hqToken: HQ_TOKEN,
      now: () => new Date(serverNow),
    });
    const session = await join(harness, fixture.devices[0]);
    const round = await harness.call('mod_create_round_v3', {
      p_token: session.accessToken,
      p_title: '상태 전환 합성 투표',
      p_type: 'RADIO',
      p_options: ['가', '나'],
      p_idempotency_key: '09120000-0000-4000-8000-000000000610',
    });
    await expect(harness.call('mod_set_round_status_v3', {
      p_token: session.accessToken,
      p_round_id: round.id,
      p_status: 'closed',
      p_idempotency_key: '09120000-0000-4000-8000-000000000609',
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(harness.call('mod_set_round_status_v3', {
      p_token: session.accessToken,
      p_round_id: round.id,
      p_expected_status: 'active',
      p_status: 'closed',
      p_idempotency_key: 'not-a-uuid',
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    const firstCloseArgs = {
      p_token: session.accessToken,
      p_round_id: round.id,
      p_expected_status: 'active',
      p_status: 'closed',
      p_idempotency_key: '09120000-0000-4000-8000-000000000611',
    };
    const firstClose = await harness.call('mod_set_round_status_v3', firstCloseArgs);
    expect(firstClose).toMatchObject({
      id: round.id,
      status: 'closed',
      updated_at: '2026-09-12T01:00:00.000Z',
    });
    await expect(harness.call('mod_set_round_status_v3', firstCloseArgs)).resolves.toEqual(firstClose);
    await expect(harness.call('mod_set_round_status_v3', {
      ...firstCloseArgs,
      p_expected_status: 'closed',
      p_status: 'active',
    })).rejects.toMatchObject({ code: 'idempotency_mismatch' });
    await expect(harness.call('mod_set_round_status_v3', {
      ...firstCloseArgs,
      p_idempotency_key: '09120000-0000-4000-8000-000000000612',
    })).rejects.toMatchObject({ code: 'round_status_conflict' });

    serverNow = new Date('2026-09-12T01:01:00.000Z');
    await expect(harness.call('mod_set_round_status_v3', {
      p_token: session.accessToken,
      p_round_id: round.id,
      p_expected_status: 'closed',
      p_status: 'active',
      p_idempotency_key: '09120000-0000-4000-8000-000000000613',
    })).resolves.toMatchObject({ status: 'active', updated_at: serverNow.toISOString() });

    serverNow = new Date('2026-09-12T01:01:01.000Z');
    const secondCloseArgs = {
      p_token: session.accessToken,
      p_round_id: round.id,
      p_expected_status: 'active',
      p_status: 'closed',
      p_idempotency_key: '09120000-0000-4000-8000-000000000614',
    };
    const secondClose = await harness.call('mod_set_round_status_v3', secondCloseArgs);
    serverNow = new Date('2026-09-12T01:02:01.001Z');
    await expect(harness.call('mod_set_round_status_v3', {
      p_token: session.accessToken,
      p_round_id: round.id,
      p_expected_status: 'closed',
      p_status: 'active',
      p_idempotency_key: '09120000-0000-4000-8000-000000000615',
    })).rejects.toMatchObject({ code: 'round_reopen_window_expired' });
    await expect(harness.call('mod_set_round_status_v3', secondCloseArgs)).resolves.toEqual(secondClose);
  });

  test('opens the next topic, reports conflict, and preserves idempotent saves', async () => {
    const harness = createHarness();
    const session = await join(harness, fixture.devices[0]);
    const opened = await harness.call('workshop_hq_open_next_topic', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_expected_ordinal: 2,
      p_idempotency_key: 'open-2',
    });
    expect(opened).toMatchObject({ status: 'opened', ordinal: 2, prompt: fixture.topics[1].prompt });
    await expect(harness.call('workshop_hq_open_next_topic', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_expected_ordinal: 2,
      p_idempotency_key: 'open-2',
    })).resolves.toEqual(opened);
    await expect(harness.call('topic_list_v2', { p_token: session.accessToken })).resolves.toHaveLength(2);
    await expect(harness.call('workshop_hq_open_next_topic', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_expected_ordinal: 2,
      p_idempotency_key: 'stale-open-2',
    })).rejects.toMatchObject({ code: 'next_topic_ordinal_conflict' });

    const args = {
      p_token: session.accessToken,
      p_topic_id: fixture.topics[0].id,
      p_items: [{ ordinal: 1, content: '같은 요청' }],
      p_expected_version: 0,
      p_idempotency_key: 'same-save',
    };
    const first = await harness.call('submission_save_v3', args);
    const replay = await harness.call('submission_save_v3', args);
    expect(replay).toEqual(first);
    expect(harness.snapshot().submissionVersions[fixture.topics[0].id]).toBe(1);
  });

  test('uses expected status to prevent stale HQ topic changes', async () => {
    const harness = createHarness();
    await expect(harness.call('workshop_hq_set_topic_status', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_topic_id: fixture.topics[0].id,
      p_expected_status: 'open',
      p_status: 'closed',
      p_idempotency_key: 'close-1',
    })).resolves.toMatchObject({ status: 'updated', previous_status: 'open', current_status: 'closed' });
    await expect(harness.call('workshop_hq_set_topic_status', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_topic_id: fixture.topics[0].id,
      p_expected_status: 'open',
      p_status: 'closed',
      p_idempotency_key: 'stale-close-1',
    })).resolves.toEqual({ status: 'conflict', current_status: 'closed' });
  });

  test('uses deadline CAS and leaves the server deadline intact after a stale update', async () => {
    const harness = createHarness();
    const firstDeadline = fixture.topics[0].deadlineAt;
    const nextDeadline = '2026-09-12T04:00:00.000Z';
    await expect(harness.call('workshop_hq_set_deadline', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_topic_id: fixture.topics[0].id,
      p_expected_deadline_at: firstDeadline,
      p_deadline_at: nextDeadline,
      p_idempotency_key: 'deadline-1',
    })).resolves.toMatchObject({ status: 'updated', deadline_at: nextDeadline });
    await expect(harness.call('workshop_hq_set_deadline', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_topic_id: fixture.topics[0].id,
      p_expected_deadline_at: firstDeadline,
      p_deadline_at: '2026-09-12T05:00:00.000Z',
      p_idempotency_key: 'deadline-stale',
    })).resolves.toEqual({
      status: 'conflict',
      topic_id: fixture.topics[0].id,
      deadline_at: nextDeadline,
      expected_deadline_at: firstDeadline,
    });
    const status = await harness.call('workshop_hq_status', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
    });
    expect(status.topics[0].deadline_at).toBe(nextDeadline);
  });

  test('rejects a session-slug mismatch for each implemented HQ management RPC', async () => {
    const harness = createHarness();
    const hqCalls = [
      ['workshop_hq_status', {}],
      ['workshop_hq_open_next_topic', {}],
      ['workshop_hq_set_topic_status', {}],
      ['workshop_hq_devices', {}],
      ['workshop_hq_revoke_device', {}],
      ['workshop_hq_set_deadline', {}],
      ['workshop_hq_rotate_join_codes', {}],
    ];
    for (const [name, extra] of hqCalls) {
      await expect(harness.call(name, {
        p_token: HQ_TOKEN,
        p_session_slug: 'different-session',
        ...extra,
      })).rejects.toMatchObject({ code: 'hq_session_mismatch' });
    }
  });

  test('lets HQ revoke one device and records zero live mutations', async () => {
    const harness = createHarness();
    const session = await join(harness, fixture.devices[0]);
    const devices = await harness.call('workshop_hq_devices', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
    });
    expect(devices).toHaveLength(1);
    await harness.call('workshop_hq_revoke_device', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_token_hash: devices[0].token_hash,
      p_reason: 'rehearsal rotation',
      p_idempotency_key: 'revoke-a',
    });
    await expect(harness.call('mod_session_get', { p_token: session.accessToken })).rejects.toBeInstanceOf(
      RehearsalRpcError,
    );
    await expect(harness.call('workshop_hq_rotate_join_codes', {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_confirmation: `ROTATE ${fixture.session.slug}`,
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    const firstRotationArgs = {
      p_token: HQ_TOKEN,
      p_session_slug: fixture.session.slug,
      p_confirmation: `ROTATE ${fixture.session.slug}`,
      p_idempotency_key: '09120000-0000-4000-8000-000000000901',
    };
    const firstRotation = await harness.call('workshop_hq_rotate_join_codes', firstRotationArgs);
    expect(firstRotation).toMatchObject({
      status: 'rotated',
      session_id: fixture.session.id,
      codes: [{ team_id: fixture.team.id, join_code: expect.stringMatching(/^\d{6}$/) }],
    });
    await expect(harness.call('workshop_hq_rotate_join_codes', firstRotationArgs)).resolves.toEqual(firstRotation);
    const secondRotation = await harness.call('workshop_hq_rotate_join_codes', {
      ...firstRotationArgs,
      p_idempotency_key: '09120000-0000-4000-8000-000000000902',
    });
    expect(secondRotation.codes[0].join_code).not.toBe(firstRotation.codes[0].join_code);
    await expect(join(harness, fixture.devices[1])).rejects.toMatchObject({ code: 'invalid_join_code' });

    const snapshot = harness.snapshot();
    expect(snapshot).toMatchObject({
      activeDeviceCount: 0,
      revokedDeviceCount: 1,
      liveNetworkRequestCount: 0,
      liveDatabaseMutationCount: 0,
      capabilityValuesExposedInSnapshot: false,
    });
    const serializedSnapshot = JSON.stringify(snapshot);
    expect(serializedSnapshot).not.toContain(HQ_TOKEN);
    expect(serializedSnapshot).not.toContain(JOIN_CODE);
    expect(serializedSnapshot).not.toContain(firstRotation.codes[0].join_code);
    expect(serializedSnapshot).not.toContain(secondRotation.codes[0].join_code);
  });
});
