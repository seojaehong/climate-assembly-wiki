/**
 * 10/17 분과 의결 — 투표 진행 순수 로직(2단계).
 *
 * 안 하나 = 투표 하나가 기본이다. [투표 시작] 한 번에 만들기 → 열기 → QR,
 * [마감하고 결과 보기] 한 번에 마감 → 결과 → 판정 저장. 거수 표는 온라인 표에 더한다.
 * 부결 안은 문구를 고쳐 2차 투표를 하거나 소수 의견으로 기록한다.
 *
 * 네트워크는 VoteApi 로 주입받는다 — 시험은 목으로, 미리보기는 가짜 서버로, /mod 는 실제 RPC 로.
 * 진행 사실(만들었다·열었다·마감했다)은 네트워크 호출 **전후마다** commit 으로 공유 상태에 적는다.
 * 그래서 중간에 끊겨도 다시 누르면 같은 멱등키로 같은 투표를 이어 간다(두 번째 투표가 생기지 않는다).
 */

import type {
  BallotCreateInput,
  BallotCreateResult,
  BallotListRow,
  BallotResults,
  BallotStatus,
} from '../../lib/deliberation';
import { MAX_BALLOT_ITEMS, MAX_STATEMENT_LENGTH } from './ballot-panel-logic';
import {
  CRITERIA,
  CRITERION_LABELS,
  CRITERION_RESULT_LABELS,
  attendanceCheck,
  attendanceReady,
  batchLabel,
  batchMotions,
  buildDivisionBallot,
  decideVote,
  divisionLabel,
  finalCriterion,
  motionExcluded,
  type BallotRecord,
  type CeremonyItem,
  type Motion,
  type MotionRound,
  type PrepState,
  type Verdict,
} from './division-vote-logic';

export const MAX_ROUNDS = 2;

// ── 안의 단계 ─────────────────────────────────────────────────

export type MotionPhase =
  | 'excluded' // 원 카드가 전부 시행중-제외
  | 'ready' // 아직 투표 안 함
  | 'revote' // 부결 뒤 2차 준비 중
  | 'starting' // 투표를 만드는 중(만들기·열기 사이)
  | 'open' // 투표 중
  | 'counting' // 마감했지만 결과를 아직 못 읽음
  | 'passed'
  | 'failed'
  | 'undecided' // 판정 불가(참석 인원 문제 등)
  | 'minority'; // 부결 → 소수 의견으로 기록하고 닫음

export const PHASE_LABELS: Record<MotionPhase, string> = {
  excluded: '제외',
  ready: '투표 전',
  revote: '2차 준비',
  starting: '시작 중',
  open: '투표 중',
  counting: '집계 전',
  passed: '가결',
  failed: '부결',
  undecided: '판정 불가',
  minority: '소수 의견',
};

export function currentRound(motion: Pick<Motion, 'rounds'>): MotionRound | null {
  return motion.rounds.length > 0 ? motion.rounds[motion.rounds.length - 1] : null;
}

export function motionPhase(state: Pick<PrepState, 'cards' | 'ballots'>, motion: Motion): MotionPhase {
  if (motionExcluded(state, motion)) return 'excluded';
  if (motion.resolution === 'minority') return 'minority';
  if (motion.revote) return 'revote';
  const round = currentRound(motion);
  if (!round) return 'ready';
  const ballot = state.ballots[round.requestId];
  if (!ballot || ballot.stage === 'creating' || ballot.stage === 'draft') return 'starting';
  if (ballot.stage === 'open') return 'open';
  if (round.onlineYes === null || round.onlineNo === null) return 'counting';
  if (round.verdict === 'passed') return 'passed';
  if (round.verdict === 'failed') return 'failed';
  return 'undecided';
}

/** 화면·투표 제목에 쓰는 차수 표기. 1차는 안 번호만. */
export function roundLabel(motionId: string, round: number): string {
  return round > 1 ? `${motionId} ${round}차` : motionId;
}

// ── 판정 ──────────────────────────────────────────────────────

export type RoundTotals = { yes: number; no: number };

export function roundTotals(round: Pick<MotionRound, 'onlineYes' | 'onlineNo' | 'handYes' | 'handNo'>): RoundTotals | null {
  if (round.onlineYes === null || round.onlineNo === null) return null;
  return { yes: round.onlineYes + round.handYes, no: round.onlineNo + round.handNo };
}

/** 저장된 차수의 판정 — 마감 때 박은 재적·참석으로 온라인 + 거수 합계를 본다. */
export function roundVerdict(round: MotionRound): Verdict | null {
  const totals = roundTotals(round);
  if (!totals) return null;
  if (round.enrolled === null || round.present === null) {
    return { kind: 'invalid', message: '마감 때 재적·참석 인원이 비어 있었습니다. 참석 인원을 넣고 「지금 참석 인원으로 다시 판정」을 누르십시오.' };
  }
  return decideVote(round.enrolled, round.present, totals.yes, totals.no);
}

function verdictKind(v: Verdict | null): MotionRound['verdict'] {
  if (!v) return null;
  if (v.kind !== 'decided') return 'invalid';
  return v.passed ? 'passed' : 'failed';
}

function withVerdict(round: MotionRound): MotionRound {
  return { ...round, verdict: verdictKind(roundVerdict(round)) };
}

/** 가결선(찬성 몇 표 이상). 재적·참석이 판정 가능한 값일 때만. */
export function roundThreshold(round: Pick<MotionRound, 'enrolled' | 'present'>): number | null {
  if (round.enrolled === null || round.present === null) return null;
  const c = attendanceCheck(round.enrolled, round.present);
  return c.kind === 'ok' && c.established ? c.decisionThreshold : null;
}

function mapMotion(state: PrepState, id: string, fn: (m: Motion) => Motion): PrepState {
  let changed = false;
  const motions = state.motions.map((m) => {
    if (m.id !== id) return m;
    const next = fn(m);
    if (next !== m) changed = true;
    return next;
  });
  return changed ? { ...state, motions } : state;
}

function mapRound(state: PrepState, motionId: string, roundNo: number, fn: (r: MotionRound) => MotionRound): PrepState {
  return mapMotion(state, motionId, (m) => {
    const idx = m.rounds.findIndex((r) => r.round === roundNo);
    if (idx < 0) return m;
    const rounds = [...m.rounds];
    rounds[idx] = fn(rounds[idx]);
    return { ...m, rounds };
  });
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** 거수 찬성·반대 입력. 0 이상 정수만 받는다. 마감된 차수면 판정을 다시 계산한다. */
export function setHandCount(
  state: PrepState,
  motionId: string,
  roundNo: number,
  patch: { handYes?: number; handNo?: number },
): PrepState {
  if (patch.handYes !== undefined && !isCount(patch.handYes)) return state;
  if (patch.handNo !== undefined && !isCount(patch.handNo)) return state;
  return mapRound(state, motionId, roundNo, (r) => withVerdict({ ...r, ...patch }));
}

/** 마감 뒤 참석 인원을 고쳤을 때 — 지금 참석 인원을 그 차수에 다시 박고 판정을 다시 한다. */
export function reapplyAttendance(state: PrepState, motionId: string, roundNo: number): PrepState {
  return mapRound(state, motionId, roundNo, (r) =>
    withVerdict({ ...r, enrolled: state.attendance.enrolled, present: state.attendance.present }),
  );
}

// ── 투표 시작 ─────────────────────────────────────────────────

export type BeginVoteResult = { ok: true; state: PrepState; requestId: string; resumed: boolean } | { ok: false; error: string };

/**
 * [투표 시작] 앞부분 — 투표 기록(stage 'creating')과 안별 차수를 공유 상태에 먼저 적는다.
 * 이미 시작 중인 같은 투표면 새로 만들지 않고 그 멱등키를 돌려준다(이어 가기).
 * requestId 는 바깥에서 받는다(uuid) — 순수 함수로 두고 재시도에도 같은 값을 쓰게.
 */
export function beginVote(state: PrepState, motionIds: readonly string[], requestId: string): BeginVoteResult {
  if (motionIds.length === 0) return { ok: false, error: '투표할 안을 고르십시오.' };
  const motions: Motion[] = [];
  for (const id of motionIds) {
    const m = state.motions.find((x) => x.id === id);
    if (!m) return { ok: false, error: `없는 안입니다(${id}).` };
    motions.push(m);
  }
  const phases = motions.map((m) => motionPhase(state, m));

  // 이어 가기 — 고른 안이 전부 같은 「시작 중/투표 중」 투표에 걸려 있으면 그 투표.
  if (phases.every((p) => p === 'starting' || p === 'open')) {
    const keys = new Set(motions.map((m) => currentRound(m)?.requestId));
    const [key] = [...keys];
    const ballot = key ? state.ballots[key] : undefined;
    if (keys.size === 1 && ballot && ballot.motionIds.length === motions.length) {
      return { ok: true, state, requestId: ballot.requestId, resumed: true };
    }
    return { ok: false, error: '이미 다른 투표에 들어간 안이 섞여 있습니다.' };
  }

  if (!attendanceReady(state.attendance)) {
    return { ok: false, error: '재적·참석 인원을 먼저 넣으십시오(재적 과반수가 참석해야 투표를 시작합니다).' };
  }
  for (let i = 0; i < motions.length; i += 1) {
    const p = phases[i];
    if (p === 'excluded') return { ok: false, error: `${motions[i].id}은 시행중-제외 안이라 투표하지 않습니다.` };
    if (p !== 'ready' && p !== 'revote') return { ok: false, error: `${motions[i].id}은 이미 투표했습니다(${PHASE_LABELS[p]}).` };
  }
  const revoting = phases.some((p) => p === 'revote');
  if (revoting && motions.length > 1) return { ok: false, error: '2차 투표는 안 하나씩 엽니다.' };
  if (motions.length > MAX_BALLOT_ITEMS) return { ok: false, error: `한 투표에 담을 수 있는 안은 ${MAX_BALLOT_ITEMS}개입니다.` };
  const round = revoting ? motions[0].rounds.length + 1 : 1;
  if (round > MAX_ROUNDS) return { ok: false, error: `투표는 ${MAX_ROUNDS}차까지입니다.` };
  if (motions.some((m) => !m.title.trim())) return { ok: false, error: '제목이 빈 안이 있습니다. 제목을 넣으십시오.' };

  const label = motions.length === 1 ? roundLabel(motions[0].id, round) : batchLabel(motions);
  const plan = buildDivisionBallot(state.division, motions, label);
  if (plan.problems.length > 0) return { ok: false, error: plan.problems[0] };
  if (plan.payload.items.some((it) => it.statement.length > MAX_STATEMENT_LENGTH)) {
    return { ok: false, error: `안 제목이 너무 깁니다(${MAX_STATEMENT_LENGTH}자 이하).` };
  }
  if (state.ballots[requestId]) return { ok: false, error: '같은 요청 번호가 이미 있습니다. 다시 누르십시오.' };

  const record: BallotRecord = {
    requestId,
    title: plan.payload.title,
    instructions: plan.payload.instructions ?? '',
    subgroup: plan.payload.subgroup,
    statements: plan.payload.items.map((it) => it.statement),
    motionIds: motions.map((m) => m.id),
    round,
    stage: 'creating',
    ballotId: null,
    token: null,
    openedAt: null,
    closedAt: null,
  };
  const ids = new Set(record.motionIds);
  const next: PrepState = {
    ...state,
    ballots: { ...state.ballots, [requestId]: record },
    motions: state.motions.map((m) =>
      ids.has(m.id)
        ? {
            ...m,
            revote: false,
            rounds: [
              ...m.rounds,
              {
                round,
                requestId,
                title: m.title.trim(),
                onlineYes: null,
                onlineNo: null,
                handYes: 0,
                handNo: 0,
                enrolled: null,
                present: null,
                verdict: null,
                closedAt: null,
              },
            ],
          }
        : m,
    ),
  };
  return { ok: true, state: next, requestId, resumed: false };
}

/** 재시도해도 서버가 같은 투표를 돌려주도록, 저장해 둔 내용 그대로 다시 만든 페이로드. */
export function createInputOf(record: BallotRecord): BallotCreateInput {
  return {
    title: record.title,
    instructions: record.instructions,
    subgroup: record.subgroup,
    items: record.statements.map((statement, i) => ({ ordinal: i + 1, statement, scale: 2, required: true })),
  };
}

function mapBallot(state: PrepState, requestId: string, fn: (b: BallotRecord) => BallotRecord): PrepState {
  const b = state.ballots[requestId];
  if (!b) return state;
  const next = fn(b);
  return next === b ? state : { ...state, ballots: { ...state.ballots, [requestId]: next } };
}

export function markBallotCreated(state: PrepState, requestId: string, res: Pick<BallotCreateResult, 'id' | 'token'>): PrepState {
  return mapBallot(state, requestId, (b) => {
    if (b.ballotId && b.token) return b;
    return { ...b, ballotId: res.id, token: res.token, stage: b.stage === 'creating' ? 'draft' : b.stage };
  });
}

export function markBallotOpened(state: PrepState, requestId: string, nowIso: string): PrepState {
  return mapBallot(state, requestId, (b) =>
    b.stage === 'creating' || b.stage === 'draft' ? { ...b, stage: 'open', openedAt: b.openedAt ?? nowIso } : b,
  );
}

export function markBallotClosed(state: PrepState, requestId: string, nowIso: string): PrepState {
  return mapBallot(state, requestId, (b) => (b.stage === 'closed' ? b : { ...b, stage: 'closed', closedAt: b.closedAt ?? nowIso }));
}

export type ApplyResultsOutcome = { ok: true; state: PrepState } | { ok: false; error: string };

/**
 * 마감한 투표 결과를 안마다 적는다. 2점 척도: dist['2']=찬성, dist['1']=반대.
 * 문항 번호(자리)와 문장이 둘 다 맞아야 적는다 — 어긋나면 엉뚱한 안에 표가 붙는다.
 * 재적·참석은 지금 값을 박는다.
 */
export function applyBallotResults(state: PrepState, requestId: string, results: BallotResults, nowIso: string): ApplyResultsOutcome {
  const record = state.ballots[requestId];
  if (!record) return { ok: false, error: '투표 기록을 찾지 못했습니다.' };
  if (record.ballotId && results.id !== record.ballotId) return { ok: false, error: '다른 투표의 결과입니다.' };
  const counts = new Map<string, { yes: number; no: number }>();
  for (let i = 0; i < record.motionIds.length; i += 1) {
    const item = results.items.find((it) => it.ordinal === i + 1);
    if (!item || item.statement !== record.statements[i]) {
      return { ok: false, error: `${i + 1}번 문항이 투표 기록과 맞지 않습니다. 결과를 적지 않았습니다.` };
    }
    const yes = Number(item.dist?.['2'] ?? 0);
    const no = Number(item.dist?.['1'] ?? 0);
    if (!isCount(yes) || !isCount(no)) return { ok: false, error: `${i + 1}번 문항 집계를 읽지 못했습니다.` };
    counts.set(record.motionIds[i], { yes, no });
  }
  let next = markBallotClosed(state, requestId, nowIso);
  for (const [motionId, c] of counts) {
    next = mapMotion(next, motionId, (m) => {
      const idx = m.rounds.findIndex((r) => r.requestId === requestId);
      if (idx < 0) return m;
      const rounds = [...m.rounds];
      rounds[idx] = withVerdict({
        ...rounds[idx],
        onlineYes: c.yes,
        onlineNo: c.no,
        enrolled: state.attendance.enrolled,
        present: state.attendance.present,
        closedAt: rounds[idx].closedAt ?? nowIso,
      });
      return { ...m, rounds };
    });
  }
  return { ok: true, state: next };
}

// ── 부결 뒤 ───────────────────────────────────────────────────

export function canRevote(state: PrepState, motion: Motion): boolean {
  return motionPhase(state, motion) === 'failed' && motion.rounds.length < MAX_ROUNDS;
}

/** [문구 고쳐 2차 투표] — 부결 안만. 제목 고치기는 updateMotion 으로 하고 시작은 beginVote. */
export function requestRevote(state: PrepState, motionId: string): PrepState {
  const m = state.motions.find((x) => x.id === motionId);
  if (!m || !canRevote(state, m)) return state;
  return mapMotion(state, motionId, (x) => ({ ...x, revote: true }));
}

export function cancelRevote(state: PrepState, motionId: string): PrepState {
  return mapMotion(state, motionId, (x) => (x.revote ? { ...x, revote: false } : x));
}

export type MinorityResult = { ok: true; state: PrepState } | { ok: false; needsConfirm: true } | { ok: false; error: string };

/**
 * [소수 의견으로 기록] — 부결 안을 닫는다. 소수 의견 칸이 비었으면 확인을 받아야 한다(force).
 */
export function markMinority(state: PrepState, motionId: string, force = false): MinorityResult {
  const m = state.motions.find((x) => x.id === motionId);
  if (!m) return { ok: false, error: '없는 안입니다.' };
  const phase = motionPhase(state, m);
  if (phase !== 'failed' && phase !== 'revote') return { ok: false, error: '부결된 안만 소수 의견으로 기록합니다.' };
  if (!m.minorityOpinion.trim() && !force) return { ok: false, needsConfirm: true };
  return { ok: true, state: mapMotion(state, motionId, (x) => ({ ...x, resolution: 'minority', revote: false })) };
}

export function unmarkMinority(state: PrepState, motionId: string): PrepState {
  return mapMotion(state, motionId, (x) => (x.resolution === 'minority' ? { ...x, resolution: null } : x));
}

// ── 투표 단위(화면의 [투표 시작] 묶음) ───────────────────────

export type VoteUnit = { key: string; motionIds: string[]; requestId: string | null };

/**
 * 투표 진행 화면의 묶음. 이미 시작한 안은 그 투표끼리, 아직 안 한 안은 batchSize 로 묶는다
 * (기본 1 = 하나씩). 2차 준비 안은 늘 혼자. 제외 안은 넣지 않는다. 순서 = 안 순서.
 */
export function voteUnits(state: PrepState, batchSize: number): VoteUnit[] {
  const order = new Map(state.motions.map((m, i) => [m.id, i]));
  const units: VoteUnit[] = [];
  const started = new Map<string, VoteUnit>();
  const ready: Motion[] = [];
  for (const m of state.motions) {
    const phase = motionPhase(state, m);
    if (phase === 'excluded') continue;
    if (phase === 'ready') {
      ready.push(m);
      continue;
    }
    if (phase === 'revote') {
      units.push({ key: `revote:${m.id}`, motionIds: [m.id], requestId: null });
      continue;
    }
    const key = currentRound(m)?.requestId ?? m.id;
    const unit = started.get(key);
    if (unit) unit.motionIds.push(m.id);
    else {
      const u: VoteUnit = { key, motionIds: [m.id], requestId: currentRound(m)?.requestId ?? null };
      started.set(key, u);
      units.push(u);
    }
  }
  for (const batch of batchMotions(ready, batchSize)) {
    units.push({ key: `new:${batch.map((m) => m.id).join(',')}`, motionIds: batch.map((m) => m.id), requestId: null });
  }
  const first = (u: VoteUnit) => Math.min(...u.motionIds.map((id) => order.get(id) ?? 0));
  return units.sort((a, b) => first(a) - first(b));
}

// ── 네트워크 연결부 ───────────────────────────────────────────

export type VoteApi = {
  create(input: BallotCreateInput, idempotencyKey: string): Promise<Pick<BallotCreateResult, 'id' | 'token'>>;
  setStatus(ballotId: string, status: 'open' | 'closed'): Promise<unknown>;
  /** 지금 서버 상태(목록에서). 모르면 null. */
  statusOf(ballotId: string): Promise<BallotStatus | null>;
  results(token: string): Promise<BallotResults | null>;
};

/** fn 을 최신 공유 상태에 적용하고 저장까지 기다린다. 저장된(또는 이 기기에 남긴) 상태를 돌려준다. */
export type CommitFact = (fn: (s: PrepState) => PrepState) => Promise<PrepState>;

const ACCEPT_AFTER_FAIL: Record<'open' | 'closed', readonly BallotStatus[]> = {
  open: ['open', 'closed', 'published'],
  closed: ['closed', 'published'],
};

/** 상태 바꾸기가 실패해도 서버가 이미 그 상태(또는 그 뒤)면 성공으로 본다 — 응답만 잃은 경우. */
async function setStatusSafely(api: VoteApi, ballotId: string, status: 'open' | 'closed'): Promise<void> {
  try {
    await api.setStatus(ballotId, status);
  } catch (error) {
    let now: BallotStatus | null = null;
    try {
      now = await api.statusOf(ballotId);
    } catch {
      now = null;
    }
    if (now && ACCEPT_AFTER_FAIL[status].includes(now)) return;
    throw error;
  }
}

/**
 * [투표 시작] 뒷부분. 단계마다 적고 넘어간다:
 *   creating → create(같은 멱등키·같은 내용) → draft(id·token 적음) → open → open 적음.
 * 만들기는 됐는데 열기가 실패하면, 다시 눌렀을 때 만들기를 건너뛰고 열기만 한다.
 */
export async function runVoteStart(api: VoteApi, commit: CommitFact, getState: () => PrepState, requestId: string, now: () => string): Promise<BallotRecord> {
  let record = getState().ballots[requestId];
  if (!record) throw new Error('투표 기록이 없습니다.');
  if (record.stage === 'creating' || !record.ballotId || !record.token) {
    const res = await api.create(createInputOf(record), requestId);
    if (!res?.id || !res?.token) throw new Error('투표를 만들었지만 번호를 받지 못했습니다.');
    const saved = await commit((s) => markBallotCreated(s, requestId, res));
    record = saved.ballots[requestId] ?? { ...record, ballotId: res.id, token: res.token, stage: 'draft' };
  }
  if (record.stage === 'draft') {
    await setStatusSafely(api, record.ballotId as string, 'open');
    const saved = await commit((s) => markBallotOpened(s, requestId, now()));
    record = saved.ballots[requestId] ?? { ...record, stage: 'open' };
  }
  return record;
}

export type CloseOutcome = { ok: true; state: PrepState } | { ok: false; error: string };

/**
 * [마감하고 결과 보기]. 마감(이미 마감이면 건너뜀) → 마감 사실 적기 → 결과 읽기 → 안별 결과 적기.
 * 결과를 못 읽어도 마감 사실은 남는다 — 다시 누르면 결과만 다시 읽는다.
 */
export async function runVoteClose(api: VoteApi, commit: CommitFact, getState: () => PrepState, requestId: string, now: () => string): Promise<CloseOutcome> {
  const record = getState().ballots[requestId];
  if (!record || !record.ballotId || !record.token) return { ok: false, error: '아직 열리지 않은 투표입니다.' };
  if (record.stage !== 'closed') {
    await setStatusSafely(api, record.ballotId, 'closed');
    await commit((s) => markBallotClosed(s, requestId, now()));
  }
  const results = await api.results(record.token);
  if (!results) return { ok: false, error: '결과를 읽지 못했습니다. 다시 누르십시오.' };
  let error: string | null = null;
  const saved = await commit((s) => {
    const r = applyBallotResults(s, requestId, results, now());
    if (!r.ok) {
      error = r.error;
      return s;
    }
    return r.state;
  });
  return error ? { ok: false, error } : { ok: true, state: saved };
}

/** QR 화면(BallotQrFullscreen)에 넘길 목록 행. 제출 수는 목록 폴링 값으로 채운다. */
export function qrRowOf(record: BallotRecord, responseCount: number): BallotListRow | null {
  if (!record.ballotId || !record.token) return null;
  return {
    id: record.ballotId,
    title: record.title,
    status: record.stage === 'closed' ? 'closed' : record.stage === 'open' ? 'open' : 'draft',
    token: record.token,
    subgroup: record.subgroup,
    item_count: record.statements.length,
    response_count: responseCount,
    created_at: record.openedAt ?? '',
  };
}

// ── 세리머니 — 저장된 결과 ───────────────────────────────────

/** 안마다 결과가 있는 마지막 차수로 세리머니 항목을 만든다(제외 안 빼고). 2차는 라벨에 표시한다. */
export function storedCeremonyItems(state: PrepState): CeremonyItem[] {
  const out: CeremonyItem[] = [];
  for (const m of state.motions) {
    if (motionExcluded(state, m)) continue;
    const rounds = m.rounds.filter((r) => roundTotals(r) !== null);
    const r = rounds[rounds.length - 1];
    if (!r) continue;
    const t = roundTotals(r) as RoundTotals;
    out.push({
      key: `${m.id}:r${r.round}`,
      label: r.round > 1 ? `${m.id} · ${r.round}차 투표` : m.id,
      title: r.title,
      yeas: t.yes,
      nays: t.no,
      ...(r.enrolled !== null ? { enrolled: r.enrolled } : {}),
      ...(r.present !== null ? { present: r.present } : {}),
      round: r.round,
    });
  }
  return out;
}

// ── 결과 CSV ──────────────────────────────────────────────────

export const CSV_COLUMNS = [
  '분과', '안번호', '제목', '원카드번호', '차수', '재적', '참석',
  '온라인찬성', '온라인반대', '거수찬성', '거수반대', '찬성합계', '반대합계', '가결선', '판정',
  '효과성', '형평성', '사회적수용성', '지속가능성', '실행가능성',
  '기타의견', '소수의견', '투표ID', '마감시각',
] as const;

/** 서울 시각 「2026-10-17 14:05:09」. 읽을 수 없으면 빈칸. */
export function formatKst(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function verdictText(state: PrepState, m: Motion, r: MotionRound, isLast: boolean): string {
  const b = state.ballots[r.requestId];
  if (r.verdict === 'passed') return '가결';
  if (r.verdict === 'failed') return isLast && m.resolution === 'minority' ? '부결(소수의견)' : '부결';
  if (r.verdict === 'invalid') return '판정불가';
  if (!b || b.stage === 'creating' || b.stage === 'draft') return '시작 중';
  if (b.stage === 'open') return '투표중';
  return '집계 전';
}

const n = (v: number | null | undefined): string => (v === null || v === undefined ? '' : String(v));

/** 한 분과의 결과 표(머리줄 제외). 안 × 차수마다 한 줄, 투표 안 한 안도 한 줄. */
export function resultCsvRows(state: PrepState): string[][] {
  const rows: string[][] = [];
  const division = divisionLabel(state.division);
  for (const m of state.motions) {
    const criteria = CRITERIA.map((c) => {
      const f = finalCriterion(m, c);
      return f.direct ? `${CRITERION_RESULT_LABELS[f.value]}(직접)` : CRITERION_RESULT_LABELS[f.value];
    });
    const tail = (r: MotionRound | null): string[] => [
      ...criteria,
      m.otherOpinion,
      m.minorityOpinion,
      r ? state.ballots[r.requestId]?.ballotId ?? '' : '',
      r ? formatKst(r.closedAt) : '',
    ];
    if (m.rounds.length === 0) {
      const excluded = motionExcluded(state, m);
      rows.push([division, m.id, m.title, m.cardNos.join(' '), '', '', '', '', '', '', '', '', '', '', excluded ? '제외' : '미투표', ...tail(null)]);
      continue;
    }
    m.rounds.forEach((r, i) => {
      const t = roundTotals(r);
      rows.push([
        division,
        m.id,
        r.title,
        m.cardNos.join(' '),
        `${r.round}차`,
        n(r.enrolled),
        n(r.present),
        n(r.onlineYes),
        n(r.onlineNo),
        t ? String(r.handYes) : '',
        t ? String(r.handNo) : '',
        t ? String(t.yes) : '',
        t ? String(t.no) : '',
        n(roundThreshold(r)),
        verdictText(state, m, r, i === m.rounds.length - 1),
        ...tail(r),
      ]);
    });
  }
  return rows;
}

/**
 * 셀 하나. 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 따옴표는 두 번 쓴다(RFC 4180).
 * 엑셀이 수식으로 읽지 않게 =, +, -, @ 로 시작하는 글(숫자 아님)은 앞에 ' 를 붙인다.
 */
export function csvCell(value: string): string {
  let v = value ?? '';
  if (/^[=+\-@]/.test(v) && !/^[+-]?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 엑셀용 CSV — UTF-8 BOM + CRLF. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return `﻿${[CSV_COLUMNS as readonly string[], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function resultsFileName(scope: number | 'all', at: Date): string {
  const p = (x: number) => String(x).padStart(2, '0');
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}_${p(at.getHours())}${p(at.getMinutes())}`;
  return `1017_의결결과_${scope === 'all' ? '전체' : `${scope}분과`}_${stamp}.csv`;
}

// ── 운영팀 현황판 ─────────────────────────────────────────────

export type BoardSummary = {
  division: number;
  hasState: boolean;
  motionCount: number;
  excludedCount: number;
  open: { label: string; openedAt: string | null }[];
  passed: number;
  failed: number;
  minority: number;
  pending: number;
  attendanceMissing: boolean;
  enrolled: number | null;
  present: number | null;
};

export function boardSummary(division: number, state: PrepState | null): BoardSummary {
  const out: BoardSummary = {
    division,
    hasState: !!state,
    motionCount: 0,
    excludedCount: 0,
    open: [],
    passed: 0,
    failed: 0,
    minority: 0,
    pending: 0,
    attendanceMissing: true,
    enrolled: state?.attendance.enrolled ?? null,
    present: state?.attendance.present ?? null,
  };
  if (!state) return out;
  out.attendanceMissing = state.attendance.enrolled === null || state.attendance.present === null;
  for (const m of state.motions) {
    const phase = motionPhase(state, m);
    if (phase === 'excluded') {
      out.excludedCount += 1;
      continue;
    }
    out.motionCount += 1;
    if (phase === 'passed') out.passed += 1;
    else if (phase === 'failed' || phase === 'revote') out.failed += 1;
    else if (phase === 'minority') out.minority += 1;
    else if (phase === 'open' || phase === 'starting') {
      const r = currentRound(m);
      out.open.push({ label: roundLabel(m.id, r?.round ?? 1), openedAt: r ? state.ballots[r.requestId]?.openedAt ?? null : null });
    } else out.pending += 1;
  }
  return out;
}

/** 「3분 07초」. 시작 시각이 없거나 미래면 「방금」. now 는 서버 시각 보정한 값. */
export function elapsedText(openedAt: string | null, nowMs: number): string {
  if (!openedAt) return '방금';
  const t = Date.parse(openedAt);
  if (Number.isNaN(t) || nowMs - t < 1000) return '방금';
  const s = Math.floor((nowMs - t) / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}분 ${String(s % 60).padStart(2, '0')}초` : `${s}초`;
}

/** 기준 이름 — CSV 머리줄과 화면이 같은 순서를 쓰는지 시험에서 확인한다. */
export const CRITERIA_COLUMN_LABELS = CRITERIA.map((c) => CRITERION_LABELS[c].replace(/\s/g, ''));
