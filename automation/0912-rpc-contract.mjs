import { createHash } from 'node:crypto';

/**
 * RPC names declared by the 9/12 rollout contract. Presence here is inventory,
 * not proof that the local emulator implements or exercises the RPC.
 */
export const RPC_0912_DECLARED_CONTRACTS = Object.freeze([
  'mod_exchange_join_code',
  'mod_session_get',
  'workshop_team_logout_v2',
  'topic_list_v2',
  'submission_get_v2',
  'submission_save_v3',
  'submission_finalize_v2',
  'submission_reopen_by_team_v2',
  'mod_create_round_v3',
  'mod_set_round_status_v3',
  'mod_proxy_vote_v3',
  'mod_log_timer_v2',
  'mod_rounds_v2',
  'mod_session_teams_v2',
  'mod_vote_counts_v2',
  'mod_votes_v2',
  'public_round_get_v2',
  'public_round_votes_v2',
  'public_round_cast_v2',
  'platform_canvas_round_create_v2',
  'platform_canvas_round_current_v2',
  'platform_canvas_round_set_status_v2',
  'ballot_create_v3',
  'ballot_set_status_v2',
  'ballot_list_v2',
  'ballot_results_v2',
  'attendance_roster_v2',
  'attendance_hq_summary_v2',
  'attendance_set_v2',
  'attendance_bulk_present_v2',
  'attendance_finalize_absent_v2',
  'attendance_member_save_v2',
  'attendance_hq_audit_v2',
  'attendance_hq_set_team_pin_v2',
  'attendance_hq_set_table_no_v2',
  'hq_submissions_v3',
  'submission_reopen_v2',
  'hq_submission_history_v2',
  'hq_submission_category_assign_v3',
  'hq_submission_categories_v3',
  'hq_submission_kind_assign_v3',
  'hq_submission_kinds_v3',
  'hq_topic_deadlines_v2',
  'hq_clear_submissions_v3',
  'hq_teams_v2',
  'hq_rounds_v2',
  'hq_vote_counts_v2',
  'hq_votes_v2',
  'workshop_hq_logout_v2',
  'workshop_hq_status',
  'workshop_hq_open_next_topic',
  'workshop_hq_set_topic_status',
  'workshop_hq_devices',
  'workshop_hq_revoke_device',
  'workshop_hq_set_deadline',
  'workshop_hq_rotate_join_codes',
]);

/**
 * Exact UI-fixture state subset implemented by create0912RpcRehearsal(). This
 * exercises browser request/response shapes and visible recovery flows; it is
 * not authorization, lifecycle, concurrency, or database-security evidence.
 * A focused source-exhaustiveness test compares this list with every switch
 * case so metadata cannot overstate even that narrower fixture coverage.
 */
export const RPC_0912_EMULATOR_IMPLEMENTED = Object.freeze([
  'mod_exchange_join_code',
  'mod_session_get',
  'topic_list_v2',
  'submission_get_v2',
  'submission_save_v3',
  'submission_finalize_v2',
  'submission_reopen_by_team_v2',
  'mod_create_round_v3',
  'mod_set_round_status_v3',
  'mod_proxy_vote_v3',
  'mod_log_timer_v2',
  'ballot_create_v3',
  'ballot_set_status_v2',
  'ballot_list_v2',
  'ballot_results_v2',
  'workshop_hq_status',
  'workshop_hq_open_next_topic',
  'workshop_hq_set_topic_status',
  'workshop_hq_devices',
  'workshop_hq_revoke_device',
  'workshop_hq_set_deadline',
  'workshop_hq_rotate_join_codes',
]);

export class RehearsalRpcError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RehearsalRpcError';
    this.code = code;
  }
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RehearsalRpcError('invalid_argument', `${name} is required`);
  }
  return value;
}

function tokenFor(label, seed) {
  return createHash('sha256').update(`${label}:${seed}`).digest('hex');
}

function rotatedJoinCode(seed, previousCode) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const digest = tokenFor('join-code', `${seed}:${attempt}`);
    const code = String((Number.parseInt(digest.slice(0, 8), 16) % 900_000) + 100_000);
    if (code !== previousCode) return code;
  }
  throw new RehearsalRpcError('synthetic_rotation_failed', 'could not derive a new synthetic join code');
}

function clone(value) {
  return structuredClone(value);
}

function requireExactRpcList(value, expected, name) {
  if (!Array.isArray(value)
      || value.some((rpc) => typeof rpc !== 'string' || rpc.trim() === '')
      || new Set(value).size !== value.length
      || JSON.stringify(value) !== JSON.stringify(expected)) {
    throw new RehearsalRpcError(
      'invalid_fixture_rpc_coverage',
      `${name} must exactly match its audited RPC set and order`,
    );
  }
  return value;
}

function validateRpcCoverageMetadata(fixture) {
  if (fixture.rpcCoverage?.evidenceClass !== 'ui-fixture-only'
      || fixture.rpcCoverage?.securityOrLifecycleEvidence !== false
      || fixture.rpcCoverage?.canonicalSecurityVerifier !== 'scripts/verify-0912-postgres.sh') {
    throw new RehearsalRpcError(
      'invalid_fixture_rpc_coverage',
      'rpcCoverage must classify the emulator as UI-fixture-only and name the PostgreSQL verifier',
    );
  }
  const declaredRpcNames = requireExactRpcList(
    fixture.expectedRpcContracts,
    RPC_0912_DECLARED_CONTRACTS,
    'expectedRpcContracts (declared inventory)',
  );
  const implementedRpcNames = requireExactRpcList(
    fixture.rpcCoverage?.emulatorImplementedRpcNames,
    RPC_0912_EMULATOR_IMPLEMENTED,
    'rpcCoverage.emulatorImplementedRpcNames',
  );
  const declared = new Set(declaredRpcNames);
  if (implementedRpcNames.some((rpc) => !declared.has(rpc))) {
    throw new RehearsalRpcError(
      'invalid_fixture_rpc_coverage',
      'every emulator-implemented RPC must also be present in the declared inventory',
    );
  }
  const browserFixtureAllowedRpcNames = Object.keys(fixture.fieldRehearsal?.rpcBehaviors ?? {});
  if (browserFixtureAllowedRpcNames.some((rpc) => !declared.has(rpc))) {
    throw new RehearsalRpcError(
      'invalid_fixture_rpc_coverage',
      'every browser fixture allowed RPC must also be present in the declared inventory',
    );
  }
  return {
    declaredRpcNames,
    implementedRpcNames,
    browserFixtureAllowedRpcNames,
  };
}

function publicSession(fixture, token, device) {
  return {
    v: 1,
    accessToken: token,
    expiresAt: fixture.authorization.tokenExpiresAt,
    deviceId: device.id,
    deviceLabel: device.label,
    deviceStatus: 'active',
    sessionId: fixture.session.id,
    sessionSlug: fixture.session.slug,
    team: {
      id: fixture.team.id,
      name: fixture.team.name,
      subgroup: fixture.team.subgroup,
      capacity: fixture.team.capacity,
      table_no: fixture.team.tableNo,
    },
  };
}

function topicRow(topic, serverNow) {
  return {
    id: topic.id,
    ordinal: topic.ordinal,
    block: topic.block,
    prompt: topic.prompt,
    guidance: topic.guidance,
    status: topic.status,
    deadline_at: topic.deadlineAt,
    server_now: serverNow,
  };
}

/**
 * Stateful, network-free implementation of the explicitly listed 9/12 RPC
 * subset. The larger declared inventory is intentionally not shallow-mocked.
 * Capability values are injected/generated at runtime and never included in snapshots.
 */
export function create0912RpcRehearsal(fixture, {
  joinCode,
  hqToken,
  now = () => new Date('2026-09-12T01:00:00.000Z'),
} = {}) {
  const rpcCoverage = validateRpcCoverageMetadata(fixture);
  const expectedJoinCode = requiredString(joinCode, 'joinCode');
  if (!/^\d{6}$/.test(expectedJoinCode) || /^0912(?:0[1-9]|1[0-5])$/.test(expectedJoinCode)) {
    throw new RehearsalRpcError('invalid_fixture_join_code', 'joinCode must be a rotated synthetic six-digit code');
  }
  const expectedHqToken = requiredString(hqToken, 'hqToken');
  if (!/^[0-9a-f]{64}$/i.test(expectedHqToken)) {
    throw new RehearsalRpcError('invalid_fixture_hq_token', 'hqToken must be a synthetic 64-character token');
  }
  const maxDevices = fixture.authorization.maxActiveDevicesPerTeam;
  const topics = clone(fixture.topics);
  const devices = new Map();
  const tokens = new Map();
  const submissions = new Map();
  const rounds = new Map();
  const ballots = new Map();
  const idempotency = new Map();
  const calls = [];
  const successfulImplementedRpcNames = new Set();
  const failedRpcNames = new Set();
  let tokenSequence = 0;
  let rotationSequence = 0;
  let currentJoinCode = expectedJoinCode;

  const recordCall = (name, args) => {
    calls.push({
      name,
      argumentNames: Object.keys(args ?? {}).sort(),
      at: now().toISOString(),
    });
  };

  const authorizeTeam = (token) => {
    const deviceId = tokens.get(token);
    const device = deviceId ? devices.get(deviceId) : null;
    if (!device || device.revokedAt) {
      throw new RehearsalRpcError('invalid_team_token', 'team token is invalid or revoked');
    }
    return device;
  };

  const authorizeHq = (token, sessionSlug) => {
    if (token !== expectedHqToken) {
      throw new RehearsalRpcError('invalid_hq_token', 'HQ token is invalid');
    }
    if (sessionSlug !== fixture.session.slug) {
      throw new RehearsalRpcError('hq_session_mismatch', 'HQ token is not valid for this session');
    }
  };

  const submissionFor = (topicId) => {
    if (!submissions.has(topicId)) {
      submissions.set(topicId, { status: 'draft', version: 0, items: [], updated_at: null });
    }
    return submissions.get(topicId);
  };

  const invokeImplemented = async (name, args = {}) => {
    switch (name) {
      case 'mod_exchange_join_code': {
        if (args.p_join_code !== currentJoinCode) {
          throw new RehearsalRpcError('invalid_join_code', 'join code is invalid');
        }
        const deviceId = requiredString(args.p_device_id, 'p_device_id');
        const label = requiredString(args.p_device_label, 'p_device_label');
        let device = devices.get(deviceId);
        if (!device) {
          const activeCount = [...devices.values()].filter((item) => !item.revokedAt).length;
          if (activeCount >= maxDevices) {
            throw new RehearsalRpcError('team_device_limit', 'active device limit reached');
          }
          device = {
            id: deviceId,
            label,
            token: '',
            tokenHash: '',
            revokedAt: null,
          };
          devices.set(deviceId, device);
        } else if (device.token) {
          tokens.delete(device.token);
        }
        tokenSequence += 1;
        const token = tokenFor('team-rehearsal-token', `${deviceId}:${tokenSequence}`);
        device.label = label;
        device.token = token;
        device.tokenHash = tokenFor('stored-token-hash', token);
        device.revokedAt = null;
        tokens.set(token, deviceId);
        return publicSession(fixture, device.token, device);
      }
      case 'mod_session_get': {
        const device = authorizeTeam(args.p_token);
        return publicSession(fixture, args.p_token, device);
      }
      case 'topic_list_v2': {
        authorizeTeam(args.p_token);
        return topics
          .filter((topic) => topic.status === 'open' || topic.status === 'closed')
          .map((topic) => topicRow(topic, now().toISOString()));
      }
      case 'submission_get_v2': {
        authorizeTeam(args.p_token);
        return clone(submissionFor(requiredString(args.p_topic_id, 'p_topic_id')));
      }
      case 'submission_save_v3': {
        authorizeTeam(args.p_token);
        const topicId = requiredString(args.p_topic_id, 'p_topic_id');
        const key = requiredString(args.p_idempotency_key, 'p_idempotency_key');
        const replayKey = `${topicId}:${key}`;
        if (idempotency.has(replayKey)) return clone(idempotency.get(replayKey));
        const current = submissionFor(topicId);
        if (args.p_expected_version !== current.version) {
          const conflict = { ...clone(current), status: 'conflict' };
          idempotency.set(replayKey, conflict);
          return clone(conflict);
        }
        const saved = {
          status: current.status === 'reopened' ? 'reopened' : 'draft',
          version: current.version + 1,
          items: clone(Array.isArray(args.p_items) ? args.p_items : []),
          updated_at: now().toISOString(),
        };
        submissions.set(topicId, saved);
        idempotency.set(replayKey, saved);
        return clone(saved);
      }
      case 'submission_finalize_v2': {
        authorizeTeam(args.p_token);
        const topicId = requiredString(args.p_topic_id, 'p_topic_id');
        const current = submissionFor(topicId);
        if (args.p_expected_version !== current.version) {
          return { ...clone(current), status: 'conflict', submission_status: current.status };
        }
        const next = {
          ...clone(current),
          status: 'final',
          version: current.version + 1,
          updated_at: now().toISOString(),
        };
        submissions.set(topicId, next);
        return clone(next);
      }
      case 'submission_reopen_by_team_v2': {
        authorizeTeam(args.p_token);
        const topicId = requiredString(args.p_topic_id, 'p_topic_id');
        const current = submissionFor(topicId);
        if (current.status !== 'final') {
          throw new RehearsalRpcError('not_final', 'only finalized submission can be reopened');
        }
        const next = {
          ...clone(current),
          status: 'reopened',
          version: current.version + 1,
          updated_at: now().toISOString(),
        };
        submissions.set(topicId, next);
        return clone(next);
      }
      case 'mod_create_round_v3': {
        authorizeTeam(args.p_token);
        const title = requiredString(args.p_title, 'p_title');
        const type = requiredString(args.p_type, 'p_type');
        const idempotencyKey = requiredString(args.p_idempotency_key, 'p_idempotency_key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
          throw new RehearsalRpcError('invalid_argument', 'p_idempotency_key must be a UUID');
        }
        const requestKey = `round-create:${idempotencyKey}`;
        const fingerprint = JSON.stringify([title.trim(), type, args.p_options ?? null]);
        const prior = idempotency.get(requestKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            throw new RehearsalRpcError('idempotency_mismatch', 'idempotency key was reused for a different round');
          }
          return clone(prior.result);
        }
        const activeRound = [...rounds.values()].find((candidate) => candidate.status === 'active');
        if (activeRound) {
          const conflict = new RehearsalRpcError(
            'active_round_conflict',
            `active round conflict: existing round ${activeRound.id}`,
          );
          conflict.existingRoundId = activeRound.id;
          throw conflict;
        }
        const id = `round-${rounds.size + 1}`;
        const createdAt = now().toISOString();
        const round = {
          id,
          title,
          type,
          options: clone(args.p_options ?? null),
          status: 'active',
          proxy_votes: 0,
          created_at: createdAt,
          updated_at: createdAt,
        };
        rounds.set(id, round);
        idempotency.set(requestKey, { fingerprint, result: round });
        return clone(round);
      }
      case 'mod_set_round_status_v3': {
        authorizeTeam(args.p_token);
        const roundId = requiredString(args.p_round_id, 'p_round_id');
        const expectedStatus = requiredString(args.p_expected_status, 'p_expected_status');
        const nextStatus = requiredString(args.p_status, 'p_status');
        if (!['active', 'closed'].includes(expectedStatus)
            || !['active', 'closed'].includes(nextStatus)
            || expectedStatus === nextStatus) {
          throw new RehearsalRpcError(
            'invalid_round_status_transition',
            'round status transition must be active to closed or closed to active',
          );
        }
        const idempotencyKey = requiredString(args.p_idempotency_key, 'p_idempotency_key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
          throw new RehearsalRpcError('invalid_argument', 'p_idempotency_key must be a UUID');
        }
        const requestKey = `round-status:${idempotencyKey}`;
        const fingerprint = JSON.stringify([roundId, expectedStatus, nextStatus]);
        const prior = idempotency.get(requestKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            throw new RehearsalRpcError(
              'idempotency_mismatch',
              'idempotency key was reused for a different round status transition',
            );
          }
          return clone(prior.result);
        }
        const round = rounds.get(roundId);
        if (!round) throw new RehearsalRpcError('round_not_found', 'round is outside the team scope');
        if (round.status !== expectedStatus) {
          throw new RehearsalRpcError(
            'round_status_conflict',
            `round status conflict: expected ${expectedStatus}, current ${round.status}`,
          );
        }
        const serverNow = now();
        if (expectedStatus === 'closed' && nextStatus === 'active') {
          const closedAtMs = Date.parse(round.updated_at);
          if (!Number.isFinite(closedAtMs) || serverNow.getTime() > closedAtMs + 60_000) {
            throw new RehearsalRpcError(
              'round_reopen_window_expired',
              'closed round can only be reopened within 60 seconds of the server close time',
            );
          }
        }
        round.status = nextStatus;
        round.updated_at = serverNow.toISOString();
        const result = clone(round);
        idempotency.set(requestKey, { fingerprint, result });
        return clone(result);
      }
      case 'mod_proxy_vote_v3': {
        authorizeTeam(args.p_token);
        const round = rounds.get(args.p_round_id);
        if (!round || round.status !== 'active') {
          throw new RehearsalRpcError('round_not_active', 'round is outside the active team scope');
        }
        if (!Number.isInteger(args.p_n) || args.p_n < 1 || args.p_n > 5) {
          throw new RehearsalRpcError('invalid_proxy_count', 'proxy count must be 1..5');
        }
        const idempotencyKey = requiredString(args.p_idempotency_key, 'p_idempotency_key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
          throw new RehearsalRpcError('invalid_argument', 'p_idempotency_key must be a UUID');
        }
        const requestKey = `proxy:${round.id}:${idempotencyKey}`;
        if (idempotency.has(requestKey)) return clone(idempotency.get(requestKey));
        round.proxy_votes += args.p_n;
        idempotency.set(requestKey, args.p_n);
        return args.p_n;
      }
      case 'mod_log_timer_v2': {
        authorizeTeam(args.p_token);
        requiredString(args.p_kind, 'p_kind');
        if (!Number.isInteger(args.p_duration_s) || args.p_duration_s < 1) {
          throw new RehearsalRpcError('invalid_duration', 'timer duration is invalid');
        }
        return calls.length;
      }
      case 'ballot_create_v3': {
        authorizeTeam(args.p_token);
        const title = requiredString(args.p_title, 'p_title');
        const idempotencyKey = requiredString(args.p_idempotency_key, 'p_idempotency_key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
          throw new RehearsalRpcError('invalid_argument', 'p_idempotency_key must be a UUID');
        }
        const requestKey = `ballot-create:${idempotencyKey}`;
        const fingerprint = JSON.stringify([
          title.trim(),
          args.p_instructions ?? null,
          args.p_items ?? null,
          args.p_subgroup ?? null,
        ]);
        const prior = idempotency.get(requestKey);
        if (prior) {
          if (prior.fingerprint !== fingerprint) {
            throw new RehearsalRpcError('idempotency_mismatch', 'idempotency key was reused for a different ballot');
          }
          return clone(prior.result);
        }
        const id = `ballot-${ballots.size + 1}`;
        const ballotToken = tokenFor('ballot-token', id);
        const ballot = {
          id,
          token: ballotToken,
          title,
          instructions: args.p_instructions ?? null,
          subgroup: args.p_subgroup ?? null,
          status: 'draft',
          items: clone(Array.isArray(args.p_items) ? args.p_items : []),
          responses: 0,
        };
        ballots.set(id, ballot);
        const result = { id, token: ballotToken, status: 'draft', items: ballot.items.length, subgroup: ballot.subgroup };
        idempotency.set(requestKey, { fingerprint, result });
        return clone(result);
      }
      case 'ballot_set_status_v2': {
        authorizeTeam(args.p_token);
        const ballot = ballots.get(args.p_ballot_id);
        if (!ballot) throw new RehearsalRpcError('ballot_not_found', 'ballot is outside the session scope');
        ballot.status = requiredString(args.p_status, 'p_status');
        return { id: ballot.id, status: ballot.status };
      }
      case 'ballot_list_v2': {
        authorizeTeam(args.p_token);
        return [...ballots.values()].map((ballot) => ({
          id: ballot.id,
          title: ballot.title,
          status: ballot.status,
          token: ballot.token,
          subgroup: ballot.subgroup,
          item_count: ballot.items.length,
          response_count: ballot.responses,
          created_at: now().toISOString(),
        }));
      }
      case 'ballot_results_v2': {
        authorizeTeam(args.p_token);
        const ballot = [...ballots.values()].find((item) => item.token === args.p_ballot_token);
        if (!ballot) return null;
        return {
          id: ballot.id,
          title: ballot.title,
          status: ballot.status,
          subgroup: ballot.subgroup,
          responses: ballot.responses,
          items: ballot.items.map((item) => ({ ...clone(item), n: 0, avg: null, dist: {} })),
        };
      }
      case 'workshop_hq_status': {
        authorizeHq(args.p_token, args.p_session_slug);
        return {
          session_id: fixture.session.id,
          session_slug: fixture.session.slug,
          session_title: fixture.session.title,
          org_name: '합성 기관',
          topics: topics.map((topic) => topicRow(topic, now().toISOString())),
          topic_total: topics.length,
          topic_open: topics.filter((topic) => topic.status === 'open').length,
          topic_closed: topics.filter((topic) => topic.status === 'closed').length,
          next_topic_id: topics.find((topic) => topic.status === 'draft')?.id ?? null,
          next_topic_ordinal: topics.find((topic) => topic.status === 'draft')?.ordinal ?? null,
          next_topic_prompt: topics.find((topic) => topic.status === 'draft')?.prompt ?? null,
          teams_total: 1,
          active_devices: [...devices.values()].filter((device) => !device.revokedAt).length,
          teams_online: [...devices.values()].some((device) => !device.revokedAt) ? 1 : 0,
          submissions_draft: [...submissions.values()].filter((item) => item.status !== 'final').length,
          submissions_final: [...submissions.values()].filter((item) => item.status === 'final').length,
          last_activity_at: calls.at(-1)?.at ?? null,
        };
      }
      case 'workshop_hq_open_next_topic': {
        authorizeHq(args.p_token, args.p_session_slug);
        const requestKey = `hq-open:${requiredString(args.p_idempotency_key, 'p_idempotency_key')}`;
        if (idempotency.has(requestKey)) return clone(idempotency.get(requestKey));
        const next = topics.find((topic) => topic.status === 'draft');
        if (!next || next.ordinal !== args.p_expected_ordinal) {
          throw new RehearsalRpcError(
            'next_topic_ordinal_conflict',
            `next topic ordinal conflict: expected ${args.p_expected_ordinal}, current ${next?.ordinal ?? 'none'}`,
          );
        }
        next.status = 'open';
        const result = {
          status: 'opened',
          topic_id: next.id,
          ordinal: next.ordinal,
          prompt: next.prompt,
          audit_id: calls.length,
        };
        idempotency.set(requestKey, result);
        return clone(result);
      }
      case 'workshop_hq_set_topic_status': {
        authorizeHq(args.p_token, args.p_session_slug);
        const requestKey = `hq-status:${requiredString(args.p_idempotency_key, 'p_idempotency_key')}`;
        if (idempotency.has(requestKey)) return clone(idempotency.get(requestKey));
        const topic = topics.find((item) => item.id === args.p_topic_id);
        if (!topic) throw new RehearsalRpcError('topic_not_found', 'topic does not exist');
        if (topic.status !== args.p_expected_status) {
          const conflict = { status: 'conflict', current_status: topic.status };
          idempotency.set(requestKey, conflict);
          return clone(conflict);
        }
        topic.status = requiredString(args.p_status, 'p_status');
        const result = {
          status: 'updated',
          topic_id: topic.id,
          previous_status: args.p_expected_status,
          current_status: topic.status,
          audit_id: calls.length,
        };
        idempotency.set(requestKey, result);
        return clone(result);
      }
      case 'workshop_hq_devices': {
        authorizeHq(args.p_token, args.p_session_slug);
        return [...devices.values()].map((device) => ({
          token_hash: device.tokenHash,
          team_id: fixture.team.id,
          team_name: fixture.team.name,
          device_id: device.id,
          device_label: device.label,
          last_seen_at: now().toISOString(),
          expires_at: fixture.authorization.tokenExpiresAt,
        }));
      }
      case 'workshop_hq_revoke_device': {
        authorizeHq(args.p_token, args.p_session_slug);
        const requestKey = `hq-revoke:${requiredString(args.p_idempotency_key, 'p_idempotency_key')}`;
        if (idempotency.has(requestKey)) return clone(idempotency.get(requestKey));
        const device = [...devices.values()].find(
          (item) => item.tokenHash === args.p_token_hash,
        );
        if (!device) throw new RehearsalRpcError('device_not_found', 'device does not exist');
        device.revokedAt = now().toISOString();
        tokens.delete(device.token);
        const result = {
          status: 'revoked',
          token_hash: device.tokenHash,
          team_id: fixture.team.id,
          revoked_at: device.revokedAt,
          audit_id: calls.length,
        };
        idempotency.set(requestKey, result);
        return clone(result);
      }
      case 'workshop_hq_set_deadline': {
        authorizeHq(args.p_token, args.p_session_slug);
        const requestKey = `hq-deadline:${requiredString(args.p_idempotency_key, 'p_idempotency_key')}`;
        if (idempotency.has(requestKey)) return clone(idempotency.get(requestKey));
        const topic = topics.find((item) => item.id === args.p_topic_id);
        if (!topic) throw new RehearsalRpcError('topic_not_found', 'topic does not exist');
        const currentDeadline = topic.deadlineAt ?? null;
        if (currentDeadline !== (args.p_expected_deadline_at ?? null)) {
          const conflict = {
            status: 'conflict',
            topic_id: topic.id,
            deadline_at: currentDeadline,
            expected_deadline_at: args.p_expected_deadline_at ?? null,
          };
          idempotency.set(requestKey, conflict);
          return clone(conflict);
        }
        topic.deadlineAt = args.p_deadline_at ?? null;
        const result = {
          status: 'updated',
          topic_id: topic.id,
          previous_deadline_at: currentDeadline,
          deadline_at: topic.deadlineAt,
          audit_id: calls.length,
        };
        idempotency.set(requestKey, result);
        return clone(result);
      }
      case 'workshop_hq_rotate_join_codes': {
        authorizeHq(args.p_token, args.p_session_slug);
        if (args.p_confirmation !== `ROTATE ${fixture.session.slug}`) {
          throw new RehearsalRpcError('confirmation_mismatch', 'join-code rotation confirmation is invalid');
        }
        const idempotencyKey = requiredString(args.p_idempotency_key, 'p_idempotency_key');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
          throw new RehearsalRpcError('invalid_argument', 'p_idempotency_key must be a UUID');
        }
        const requestKey = `hq-rotate:${idempotencyKey}`;
        if (idempotency.has(requestKey)) return clone(idempotency.get(requestKey));
        rotationSequence += 1;
        currentJoinCode = rotatedJoinCode(`${idempotencyKey}:${rotationSequence}`, currentJoinCode);
        const result = {
          status: 'rotated',
          session_id: fixture.session.id,
          codes: [{
            team_id: fixture.team.id,
            team_name: fixture.team.name,
            table_no: fixture.team.tableNo,
            join_code: currentJoinCode,
          }],
          audit_id: calls.length,
        };
        idempotency.set(requestKey, result);
        return clone(result);
      }
      default:
        if (rpcCoverage.declaredRpcNames.includes(name)) {
          throw new RehearsalRpcError(
            'declared_rpc_not_implemented',
            `declared RPC is outside the stateful emulator subset: ${name}`,
          );
        }
        throw new RehearsalRpcError('unexpected_rpc', `RPC is absent from the declared inventory: ${name}`);
    }
  };

  const call = async (name, args = {}) => {
    recordCall(name, args);
    try {
      const result = await invokeImplemented(name, args);
      successfulImplementedRpcNames.add(name);
      return result;
    } catch (error) {
      failedRpcNames.add(name);
      throw error;
    }
  };

  return {
    call,
    snapshot() {
      return {
        rpcCalls: calls.map((item) => clone(item)),
        rpcCoverage: {
          evidenceClass: 'ui-fixture-only',
          securityOrLifecycleEvidence: false,
          canonicalSecurityVerifier: 'scripts/verify-0912-postgres.sh',
          declaredRpcCount: rpcCoverage.declaredRpcNames.length,
          emulatorImplementedRpcCount: rpcCoverage.implementedRpcNames.length,
          browserFixtureAllowedRpcCount: rpcCoverage.browserFixtureAllowedRpcNames.length,
          attemptedRpcNames: [...new Set(calls.map((item) => item.name))],
          successfullyExercisedEmulatorRpcNames: [...successfulImplementedRpcNames],
          failedRpcNames: [...failedRpcNames],
          unimplementedDeclaredRpcNames: rpcCoverage.declaredRpcNames.filter(
            (rpc) => !rpcCoverage.implementedRpcNames.includes(rpc),
          ),
        },
        activeDeviceCount: [...devices.values()].filter((device) => !device.revokedAt).length,
        revokedDeviceCount: [...devices.values()].filter((device) => device.revokedAt).length,
        openTopicOrdinals: topics.filter((topic) => topic.status === 'open').map((topic) => topic.ordinal),
        roundCount: rounds.size,
        ballotCount: ballots.size,
        submissionVersions: Object.fromEntries(
          [...submissions.entries()].map(([topicId, value]) => [topicId, value.version]),
        ),
        liveNetworkRequestCount: 0,
        liveDatabaseMutationCount: 0,
        capabilityValuesExposedInSnapshot: false,
      };
    },
  };
}
