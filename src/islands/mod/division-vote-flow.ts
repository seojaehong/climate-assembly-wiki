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
import { parseMotionStatement } from '../../lib/division-ballot-format';
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
  liveRounds,
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

/** 지금 차수 = 무효로 하지 않은 마지막 차수. */
export function currentRound(motion: Pick<Motion, 'rounds'>): MotionRound | null {
  const live = liveRounds(motion.rounds);
  return live.length > 0 ? live[live.length - 1] : null;
}

/** 마감했지만 거수 확인(완료·없음)을 아직 안 한 차수인가. 옛 저장(칸 없음)은 확인한 것으로 본다. */
export function handPending(round: Pick<MotionRound, 'handConfirmed' | 'onlineYes' | 'onlineNo'> | null): boolean {
  return !!round && round.handConfirmed === false && round.onlineYes !== null && round.onlineNo !== null;
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

/** 제목 앞부분 — 무장 문구용. 글자 단위로 자르고 넘치면 「…」. */
export function titleHead(title: string, max = 18): string {
  const chars = [...title.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}

/**
 * 되돌릴 수 없는 버튼의 무장 문구(10/14) — 두 번째 누름 전에 어느 분과·어느 안인지 읽히게.
 * 예: 「2분과 2-1-안2 「예시 제목 가-3…」 투표를 시작합니까? (다시 누르면 시작)」
 */
export function armedText(kind: 'start' | 'close' | 'void', division: number, label: string, title: string): string {
  const head = `${divisionLabel(division)} ${label} 「${titleHead(title)}」`;
  if (kind === 'start') return `${head} 투표를 시작합니까? (다시 누르면 시작)`;
  if (kind === 'close') return `${head} 투표를 마감합니까? (다시 누르면 마감)`;
  return `${head} 투표를 무효로 합니까? (다시 누르면 무효)`;
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
    // 무효 차수와 번호가 겹칠 수 있다(잘못 연 1차를 무효로 하고 다시 연 1차) — 살아 있는 차수만.
    const idx = m.rounds.findIndex((r) => r.round === roundNo && !r.voidedAt);
    if (idx < 0) return m;
    const next = fn(m.rounds[idx]);
    if (next === m.rounds[idx]) return m;
    const rounds = [...m.rounds];
    rounds[idx] = next;
    return { ...m, rounds };
  });
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/**
 * 그 차수의 거수·참석을 고칠 수 있는가(10/14). 지금 차수만, 2차 준비·소수 의견으로 닫은 안은 안 된다 —
 * 2차가 열린 동안 1차 칸에 2차 거수를 넣어 1차 판정이 뒤집힌 사고를 막는다.
 * 1차 거수를 꼭 고쳐야 하면 [2차 투표 그만두기]·[기록 취소]로 먼저 되돌린다.
 */
export function canEditRoundCounts(motion: Motion, roundNo: number): boolean {
  if (motion.revote || motion.resolution === 'minority') return false;
  return currentRound(motion)?.round === roundNo;
}

function roundCountsGuard(state: PrepState, motionId: string, roundNo: number): boolean {
  const m = state.motions.find((x) => x.id === motionId);
  return !!m && canEditRoundCounts(m, roundNo);
}

/** 거수 찬성·반대 입력. 0 이상 정수만 받는다. 마감된 차수면 판정을 다시 계산한다. */
export function setHandCount(
  state: PrepState,
  motionId: string,
  roundNo: number,
  patch: { handYes?: number; handNo?: number },
): PrepState {
  if (patch.handYes !== undefined && !isCount(patch.handYes)) return state;
  if (patch.handNo !== undefined && !isCount(patch.handNo)) return state;
  if (!roundCountsGuard(state, motionId, roundNo)) return state;
  return mapRound(state, motionId, roundNo, (r) => withVerdict({ ...r, ...patch }));
}

/**
 * [거수 입력 완료]·[거수 없음](10/14). 확인 전에는 판정이 잠정이고 2차·소수 의견 버튼이 숨는다.
 * 'none' 은 「거수가 0 표였음」을 확인할 뿐 거수 칸을 비우지 않는다 — 거수가 이미 들어 있으면(다른 화면이 넣었고
 * 저장 충돌 뒤 다시 적용되는 경우 포함) 아무것도 바꾸지 않는다. 그러면 화면에 실제 거수가 다시 보인다.
 */
export function confirmHandCount(state: PrepState, motionId: string, roundNo: number, mode: 'entered' | 'none'): PrepState {
  if (!roundCountsGuard(state, motionId, roundNo)) return state;
  return mapRound(state, motionId, roundNo, (r) => {
    if (roundTotals(r) === null) return r;
    if (mode === 'none' && (r.handYes !== 0 || r.handNo !== 0)) return r;
    return r.handConfirmed === false ? { ...r, handConfirmed: true } : r;
  });
}

/** 마감 뒤 참석 인원을 고쳤을 때 — 지금 참석 인원을 그 차수에 다시 박고 판정을 다시 한다. */
export function reapplyAttendance(state: PrepState, motionId: string, roundNo: number): PrepState {
  if (!roundCountsGuard(state, motionId, roundNo)) return state;
  return mapRound(state, motionId, roundNo, (r) =>
    withVerdict({ ...r, enrolled: state.attendance.enrolled, present: state.attendance.present }),
  );
}

/**
 * 재적·참석 입력. 칸 글자 그대로 받는다 — 빈칸은 null(미입력), 0 이상 정수만 숫자로 받고
 * 그 밖(음수·소수·글자)은 무시한다(원래 값 유지).
 */
export function setAttendanceField(state: PrepState, field: 'enrolled' | 'present', raw: string): PrepState {
  const t = raw.trim();
  let value: number | null;
  if (t === '') value = null;
  else if (/^\d{1,5}$/.test(t)) value = Number(t);
  else return state;
  if (state.attendance[field] === value) return state;
  return { ...state, attendance: { ...state.attendance, [field]: value } };
}

/** 거수 칸 글자 → 수. 빈칸은 0, 0 이상 정수가 아니면 null(무시). */
export function parseHandInput(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return 0;
  return /^\d{1,5}$/.test(t) ? Number(t) : null;
}

// ── 투표 시작 ─────────────────────────────────────────────────

export type BeginVoteResult = { ok: true; state: PrepState; requestId: string; resumed: boolean } | { ok: false; error: string };

/**
 * [투표 시작] 앞부분 — 투표 기록(stage 'creating')과 안별 차수를 공유 상태에 먼저 적는다.
 * 이미 시작 중인 같은 투표면 새로 만들지 않고 그 멱등키를 돌려준다(이어 가기).
 * requestId 는 바깥에서 받는다(uuid) — 순수 함수로 두고 재시도에도 같은 값을 쓰게.
 */
/** 지금 열려 있거나 여는 중인 투표(무효·마감 제외). 화면 맨 위 띠와 시작 막기에 쓴다. */
export function liveBallots(state: Pick<PrepState, 'ballots'>): BallotRecord[] {
  // 무효로 한 투표라도 「투표 중」으로 남아 있으면(옛 화면이 무효와 열기가 엇갈려 적은 경우) 서버가 표를 받고 있으므로 센다 —
  // 화면 띠에 [서버 투표 닫기]가 뜬다(strayOpenBallot).
  return Object.values(state.ballots).filter(
    (b) => b.stage === 'open' || (!b.voidedAt && (b.stage === 'creating' || b.stage === 'draft')),
  );
}

/** 무효로 했는데 서버에서 아직 열려 있는 투표(옛 기록). 안 단위가 없으므로 띠에서 따로 닫는다. */
export function strayOpenBallot(b: Pick<BallotRecord, 'stage' | 'voidedAt'>): boolean {
  return b.stage === 'open' && !!b.voidedAt;
}

/** 투표 기록의 화면 이름 — 「2-1-안2」 · 「2-1-안2 2차」 · 묶음은 「2-1-안1 외 2건」. */
export function ballotLabel(b: Pick<BallotRecord, 'motionIds' | 'round'>): string {
  const head = roundLabel(b.motionIds[0] ?? '', b.round);
  return b.motionIds.length > 1 ? `${head} 외 ${b.motionIds.length - 1}건` : head;
}

export function beginVote(state: PrepState, motionIds: readonly string[], requestId: string, nowIso?: string): BeginVoteResult {
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

  // 한 분과에 열린 투표는 하나만(10/14) — 앞 안을 마감하지 않고 다음 안을 열면 앞 안이 계속 표를 받는다.
  const busy = liveBallots(state);
  if (busy.length > 0) {
    return { ok: false, error: `${ballotLabel(busy[0])} 투표가 열려 있습니다. 먼저 마감하십시오.` };
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
  const round = revoting ? liveRounds(motions[0].rounds).length + 1 : 1;
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
    ...(nowIso ? { createdAt: nowIso } : {}),
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
                handConfirmed: false,
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
    // 만드는 사이에 무효로 했으면(10/14) 받은 번호만 남기고 「마감」으로 둔다 — 열지 않는다.
    // 번호를 남겨야 CSV 투표ID 로 서버에 실제 만들어진 투표를 찾을 수 있다.
    if (b.voidedAt) return { ...b, ballotId: res.id, token: res.token, stage: 'closed', closedAt: b.closedAt ?? b.voidedAt };
    return { ...b, ballotId: res.id, token: res.token, stage: b.stage === 'creating' ? 'draft' : b.stage };
  });
}

export function markBallotOpened(state: PrepState, requestId: string, nowIso: string): PrepState {
  return mapBallot(state, requestId, (b) =>
    !b.voidedAt && (b.stage === 'creating' || b.stage === 'draft') ? { ...b, stage: 'open', openedAt: b.openedAt ?? nowIso } : b,
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
  return (
    motionPhase(state, motion) === 'failed' && liveRounds(motion.rounds).length < MAX_ROUNDS && !handPending(currentRound(motion))
  );
}

/** [문구 고쳐 2차 투표] — 부결 안만. 제목 고치기는 updateMotion 으로 하고 시작은 beginVote. */
export function requestRevote(state: PrepState, motionId: string): PrepState {
  const m = state.motions.find((x) => x.id === motionId);
  if (!m || !canRevote(state, m)) return state;
  return mapMotion(state, motionId, (x) => ({ ...x, revote: true }));
}

/** 2차 준비 그만두기 — 2차 제목 칸에 고쳐 둔 문구는 버리고 마지막으로 투표한 제목으로 돌린다. */
export function cancelRevote(state: PrepState, motionId: string): PrepState {
  return mapMotion(state, motionId, (x) => (x.revote ? { ...x, revote: false, title: currentRound(x)?.title ?? x.title } : x));
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
  if (handPending(currentRound(m))) return { ok: false, error: '거수 확인 전입니다. [거수 입력 완료] 또는 [거수 없음]을 먼저 누르십시오.' };
  if (!m.minorityOpinion.trim() && !force) return { ok: false, needsConfirm: true };
  return { ok: true, state: mapMotion(state, motionId, (x) => ({ ...x, resolution: 'minority', revote: false })) };
}

export function unmarkMinority(state: PrepState, motionId: string): PrepState {
  return mapMotion(state, motionId, (x) => (x.resolution === 'minority' ? { ...x, resolution: null } : x));
}

// ── 잘못 연 투표 무효(10/14) ──────────────────────────────────

/** 무효로 할 수 있는 단계. 투표 전·2차 준비·소수 의견은 무효로 할 투표가 없다(또는 먼저 되돌린다). */
const VOIDABLE: readonly MotionPhase[] = ['starting', 'open', 'counting', 'passed', 'failed', 'undecided'];
/** 결과가 이미 나온 단계 — 무효는 운영팀 화면에서만(결과를 보고 뒤집는 데 쓰이지 않게). */
const VOID_OPS_ONLY: readonly MotionPhase[] = ['passed', 'failed', 'undecided'];

export function canVoidRound(state: PrepState, motion: Motion, isOps: boolean): boolean {
  const phase = motionPhase(state, motion);
  if (!VOIDABLE.includes(phase)) return false;
  return isOps || !VOID_OPS_ONLY.includes(phase);
}

export type VoidOutcome = { ok: true; state: PrepState } | { ok: false; error: string };

/**
 * 투표 하나(멱등키)를 무효로 한다 — 그 투표에 걸린 안의 지금 차수에 voidedAt 을 적고 투표 기록은 마감으로 둔다.
 * 안은 그 앞 단계로 돌아간다: 1차였으면 「투표 전」, 2차였으면 「2차 준비」. 차수 번호를 쓰지 않는다.
 * 무효 차수는 CSV 에 「무효(잘못 열림)」로 남는다.
 */
export function voidBallot(state: PrepState, requestId: string, nowIso: string): VoidOutcome {
  const record = state.ballots[requestId];
  if (!record) return { ok: false, error: '투표 기록을 찾지 못했습니다.' };
  for (const id of record.motionIds) {
    const m = state.motions.find((x) => x.id === id);
    if (!m) return { ok: false, error: `없는 안입니다(${id}).` };
    if (currentRound(m)?.requestId !== requestId) return { ok: false, error: `${id}의 지금 차수가 아닌 투표입니다.` };
    if (!VOIDABLE.includes(motionPhase(state, m))) return { ok: false, error: `${id}은 무효로 할 수 없는 단계입니다.` };
  }
  const ids = new Set(record.motionIds);
  return {
    ok: true,
    state: {
      ...state,
      // 번호를 받은 투표만 「마감」으로 — 만들기 전(creating)에 무효로 하면 단계는 두고 voidedAt 으로 끝을 표시한다
      // (readBallot 은 번호 없는 closed 를 거절한다).
      ballots: {
        ...state.ballots,
        [requestId]: {
          ...record,
          stage: record.ballotId && record.token ? 'closed' : record.stage,
          closedAt: record.ballotId && record.token ? record.closedAt ?? nowIso : record.closedAt,
          voidedAt: nowIso,
        },
      },
      motions: state.motions.map((m) => {
        if (!ids.has(m.id)) return m;
        const rounds = m.rounds.map((r) => (r.requestId === requestId && !r.voidedAt ? { ...r, voidedAt: nowIso } : r));
        const left = liveRounds(rounds);
        // 2차를 무효로 하면 2차 준비로 — 제목은 그 2차에 보냈던 문구를 남겨 다시 고칠 수 있게.
        return { ...m, rounds, revote: left.length > 0, resolution: null };
      }),
    },
  };
}

/**
 * [잘못 연 투표 무효] 네트워크 부분 — 서버 투표를 먼저 닫는다(더 받지 않게). 닫기가 실패했는데 서버에서
 * 아직 열려 있으면(또는 확인 못 하면) 무효로 적지 않는다 — 표를 계속 받는 투표를 화면에서만 지우면 안 된다.
 * 만들기 전(creating)·열기 전(draft)이면 시민이 투표할 수 없으므로 서버 닫기 실패를 넘어간다.
 */
export async function runVoteVoid(api: VoteApi, commit: CommitFact, getState: () => PrepState, requestId: string, now: () => string): Promise<VoidOutcome> {
  const record = getState().ballots[requestId];
  if (!record) return { ok: false, error: '투표 기록을 찾지 못했습니다.' };
  if (record.ballotId && record.stage !== 'closed') {
    try {
      await api.setStatus(record.ballotId, 'closed');
    } catch (error) {
      let st: BallotStatus | null = null;
      try {
        st = await api.statusOf(record.ballotId);
      } catch {
        st = null;
      }
      if (st !== 'draft' && st !== 'closed' && st !== 'published' && st !== 'archived') throw error;
    }
  }
  const closedBefore = !!record.ballotId && record.stage !== 'closed';
  let failure: string | null = null;
  let saved = await commit((s) => {
    const r = voidBallot(s, requestId, now());
    if (!r.ok) {
      failure = r.error;
      return s;
    }
    return r.state;
  });
  if (failure) return { ok: false, error: failure };
  // 10/14 재검 — 이 화면이 본 기록은 번호 전(만드는 중)이었는데, 저장해 보니 다른 화면이 그새 투표를 만들어(열어) 두었다.
  // 무효는 적혔지만 서버 투표는 아직 열려 있을 수 있으니 여기서 닫는다. 닫지 못했고 서버가 열려 있으면(또는 모르면)
  // 기록을 「무효인데 열림」으로 되돌려 화면 띠에 [서버 투표 닫기]가 뜨게 한다.
  const after = saved.ballots[requestId];
  if (!closedBefore && after?.ballotId) {
    try {
      await setStatusSafely(api, after.ballotId, 'closed');
    } catch {
      let st: BallotStatus | null = null;
      try {
        st = await api.statusOf(after.ballotId);
      } catch {
        st = null;
      }
      if (st !== 'draft' && st !== 'closed' && st !== 'published' && st !== 'archived') {
        saved = await commit((s) => markBallotStrayOpen(s, requestId));
      }
    }
  }
  return { ok: true, state: saved };
}

/** 무효로 적었지만 서버 투표를 닫지 못한 기록 — 「열림」으로 되돌려 띠의 [서버 투표 닫기]가 닫게 한다(strayOpenBallot). */
export function markBallotStrayOpen(state: PrepState, requestId: string): PrepState {
  return mapBallot(state, requestId, (b) => (b.voidedAt && b.ballotId && b.token && b.stage !== 'open' ? { ...b, stage: 'open', closedAt: null } : b));
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
  if (record.voidedAt) return record;
  if (record.stage === 'creating' || !record.ballotId || !record.token) {
    const res = await api.create(createInputOf(record), requestId);
    if (!res?.id || !res?.token) throw new Error('투표를 만들었지만 번호를 받지 못했습니다.');
    const saved = await commit((s) => markBallotCreated(s, requestId, res));
    record = saved.ballots[requestId] ?? { ...record, ballotId: res.id, token: res.token, stage: 'draft' };
    // 만드는 사이에 무효로 했다(10/14) — 열지 않는다. 서버에는 열기 전 투표로 남으니 닫아 두기만 한다(실패해도 표를 받지 않는다).
    if (record.voidedAt) {
      await api.setStatus(res.id, 'closed').catch(() => undefined);
      return record;
    }
  }
  // 열기 직전에 최신 기록을 다시 본다 — 만든 뒤·열기 전에 다른 화면(운영팀)이 무효로 했을 수 있다.
  const fresh = getState().ballots[requestId];
  if (fresh?.voidedAt) {
    // 열기 전(draft)이라 표는 받지 않는다 — 닫아 두기만(실패해도 그만).
    if (fresh.ballotId) await api.setStatus(fresh.ballotId, 'closed').catch(() => undefined);
    return fresh;
  }
  if (record.stage === 'draft') {
    await setStatusSafely(api, record.ballotId as string, 'open');
    const saved = await commit((s) => markBallotOpened(s, requestId, now()));
    record = saved.ballots[requestId] ?? { ...record, stage: 'open' };
    // 여는 사이에 무효로 했다 — 무효 쪽이 서버를 닫았어도 이 열기가 뒤에 닿았을 수 있으니 한 번 더 닫는다.
    if (record.voidedAt && record.ballotId) await setStatusSafely(api, record.ballotId, 'closed');
  }
  return record;
}

/**
 * 무효로 했는데 서버에서 아직 열려 있는 투표(strayOpenBallot)를 닫는다 — 띠의 [서버 투표 닫기].
 * 결과는 읽지 않는다(무효 투표라 판정·세리머니에 쓰지 않는다).
 */
export async function runStrayClose(api: VoteApi, commit: CommitFact, getState: () => PrepState, requestId: string, now: () => string): Promise<void> {
  const record = getState().ballots[requestId];
  if (!record || !record.ballotId || record.stage === 'closed') return;
  await setStatusSafely(api, record.ballotId, 'closed');
  await commit((s) => markBallotClosed(s, requestId, now()));
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

/**
 * QR 화면 큰 제목(10/14 결정) — 오퍼레이터가 친 안 제목(합친 문구)을 크게, 안 번호·차수는 작게.
 * 투표 기록에 보낸 문장 그대로에서 가른다(그 뒤 준비판에서 제목을 고쳐도 투표 내용과 같게).
 * 옛 묶음 투표(문항 여럿)는 투표 제목을 크게 두고 안 수를 곁글로.
 */
export function qrHeadlineOf(record: Pick<BallotRecord, 'title' | 'statements' | 'motionIds' | 'round'>): { main: string; sub: string; eyebrow: string } {
  const eyebrow = '분과 의결';
  if (record.statements.length === 1) {
    const parsed = parseMotionStatement(record.statements[0]);
    const id = parsed?.id ?? record.motionIds[0] ?? '';
    return { main: parsed?.title ?? record.statements[0], sub: roundLabel(id, record.round), eyebrow };
  }
  return { main: record.title, sub: `안 ${record.statements.length}건 묶음 투표`, eyebrow };
}

// ── 세리머니 — 저장된 결과 ───────────────────────────────────

/** 안마다 결과가 있는 마지막 차수로 세리머니 항목을 만든다(제외 안 빼고). 2차는 라벨에 표시한다. */
export function storedCeremonyItems(state: PrepState): CeremonyItem[] {
  const out: CeremonyItem[] = [];
  for (const m of state.motions) {
    if (motionExcluded(state, m)) continue;
    // 결론이 아직 없는 안은 넣지 않는다 — 2차가 열려 있는데 1차 부결을 결과로 공개하면 안 된다(10/14).
    // 빠진 안은 ceremonyGaps 가 세리머니 설정 화면에 따로 띄운다.
    if (UNSETTLED.includes(motionPhase(state, m))) continue;
    const rounds = liveRounds(m.rounds).filter((r) => roundTotals(r) !== null);
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

const UNSETTLED: readonly MotionPhase[] = ['ready', 'revote', 'starting', 'open', 'counting'];
/** 세리머니를 시작하기 전에 멈춰 세워야 하는 단계 — 투표가 아직 돌아가는 중. */
const CEREMONY_BLOCKING: readonly MotionPhase[] = ['starting', 'open', 'counting'];

export type CeremonyGap = { id: string; status: string; blocking: boolean };

/**
 * 세리머니에서 빠지거나 잠정인 안(10/14) — 「상정 N건」이 조용히 줄지 않게 설정 화면에 빨간 띠로 띄운다.
 * blocking = 투표가 아직 돌아가는 중(시작 중·투표 중·집계 전) → [세리머니 시작]을 두 번 눌러야 한다.
 */
export function ceremonyGaps(state: PrepState): CeremonyGap[] {
  const out: CeremonyGap[] = [];
  for (const m of state.motions) {
    if (motionExcluded(state, m)) continue;
    const phase = motionPhase(state, m);
    if (UNSETTLED.includes(phase) || phase === 'undecided') {
      out.push({ id: m.id, status: PHASE_LABELS[phase], blocking: CEREMONY_BLOCKING.includes(phase) });
    } else if (handPending(currentRound(m))) {
      out.push({ id: m.id, status: '거수 확인 전', blocking: false });
    }
  }
  return out;
}

// ── 결과 CSV ──────────────────────────────────────────────────

export const CSV_COLUMNS = [
  '분과', '안번호', '제목', '원카드번호', '차수', '재적', '참석',
  '온라인찬성', '온라인반대', '거수찬성', '거수반대', '찬성합계', '반대합계', '가결선', '판정',
  '효과성', '형평성', '사회적수용성', '지속가능성', '실행가능성',
  '기타의견', '소수의견', '투표ID', '마감시각',
  // 10/15 — 14:45~16:00 문안 수정 시간에 고친 문안(안 카드 「수정 문안」 칸). 투표 제목(가결 기록)과 따로 남긴다.
  '수정문안',
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
  if (r.voidedAt) return '무효(잘못 열림)';
  const pending = handPending(r) ? '(거수 확인 전)' : '';
  if (r.verdict === 'passed') return `가결${pending}`;
  if (r.verdict === 'failed') return isLast && m.resolution === 'minority' ? '부결(소수의견)' : `부결${pending}`;
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
      m.text,
    ];
    const last = currentRound(m);
    m.rounds.forEach((r) => {
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
        verdictText(state, m, r, r === last),
        ...tail(r),
      ]);
    });
    // 투표하지 않은 안(무효만 있는 안 포함)도 한 줄 — 「미투표」/「제외」.
    if (!last) {
      const excluded = motionExcluded(state, m);
      rows.push([division, m.id, m.title, m.cardNos.join(' '), '', '', '', '', '', '', '', '', '', '', excluded ? '제외' : '미투표', ...tail(null)]);
    }
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
  /** 여는 중(만들기·열기 사이)에 멈춘 투표 — since = [투표 시작]을 누른 시각(옛 저장은 null). */
  starting: { label: string; since: string | null }[];
  /** 마감했지만 결과를 못 읽은 안(집계 전). */
  counting: string[];
  /** 판정 불가(참석 인원 문제 등). */
  undecided: string[];
  /** 마감 뒤 거수 확인을 아직 안 한 안. */
  handPending: string[];
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
    starting: [],
    counting: [],
    undecided: [],
    handPending: [],
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
    const r = currentRound(m);
    const label = roundLabel(m.id, r?.round ?? 1);
    if (handPending(r)) out.handPending.push(label);
    if (phase === 'passed') out.passed += 1;
    else if (phase === 'failed' || phase === 'revote') out.failed += 1;
    else if (phase === 'minority') out.minority += 1;
    else if (phase === 'open') out.open.push({ label, openedAt: r ? state.ballots[r.requestId]?.openedAt ?? null : null });
    // 10/14 — 시작 멈춤·집계 실패·판정 불가는 「투표 중」·「투표 전」에 섞지 않고 따로 센다.
    else if (phase === 'starting') out.starting.push({ label, since: r ? state.ballots[r.requestId]?.createdAt ?? null : null });
    else if (phase === 'counting') out.counting.push(label);
    else if (phase === 'undecided') out.undecided.push(label);
    else out.pending += 1;
  }
  return out;
}

/** 현황판 경과 경고 — 시작 멈춤 30초, 투표 중 5분을 넘으면 경고(10/14). 시각을 모르면 경고하지 않는다. */
export const STUCK_START_MS = 30_000;
export const LONG_OPEN_MS = 5 * 60_000;
/**
 * 화면 띠의 「여는 중」이 멈춘 것인가(10/14 재검) — 이 화면이 여는 중이면 아니다. 누른 지 30초가 지나야 멈춤으로 본다.
 * 그 전에는 「여는 중…」으로만 보이고 무효를 권하지 않는다. 누른 시각이 없는 옛 기록은 멈춘 것으로 본다.
 */
export function startStuck(b: Pick<BallotRecord, 'stage' | 'createdAt'>, busyHere: boolean, nowMs: number): boolean {
  if (b.stage === 'open' || b.stage === 'closed' || busyHere) return false;
  return b.createdAt ? overdue(b.createdAt, nowMs, STUCK_START_MS) : true;
}

/**
 * 분과 PC 화면 띠의 「다른 화면에서 연 투표입니다 … [QR 띄우기]」 안내를 보일까(10/14 ops-5).
 * 운영팀 화면은 큰 화면에 연결하지 않으므로 보이지 않는다. 이 화면이 연 투표이거나, 이 화면에서 한 번이라도 QR 을 띄운
 * 투표(새로고침 뒤 자동 QR · [QR 띄우기] · [QR 다시 띄우기])는 안내를 따른 것이라 다시 보이지 않는다(10/15 E2E h3b).
 */
export function elsewhereHint(isOps: boolean, stage: BallotRecord['stage'], shownHere: boolean, qrOpenNow: boolean): boolean {
  return !isOps && stage === 'open' && !shownHere && !qrOpenNow;
}

export function overdue(since: string | null, nowMs: number, limitMs: number): boolean {
  if (!since) return false;
  const t = Date.parse(since);
  return !Number.isNaN(t) && nowMs - t > limitMs;
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
