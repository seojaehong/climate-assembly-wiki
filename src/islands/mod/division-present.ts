/**
 * 발표 화면(10/15) — 분과 PC 의 두 번째 모니터(프로젝터)에 띄우는 창.
 * 운영 화면(노트북)이 BroadcastChannel 로 지금 준비판 상태·고른 안·제출 수를 보내면, 발표 창은 그대로 그린다.
 * 같은 PC 안 창끼리라 서버를 거치지 않고 글자를 치는 대로 바로 보인다. 발표 창은 아무것도 저장하지 않는다.
 * 순수 로직이라 vitest 로 검증한다.
 */
import { currentRound, handPending, roundThreshold, roundTotals, roundVerdict } from './division-vote-flow';
import type { BallotRecord, CeremonyItem, CeremonyStep, Motion, MotionRound, PrepState } from './division-vote-logic';
import type { BallotListRow } from '../../lib/deliberation';

/** 세리머니(10/17) — 노트북이 진행하는 세리머니를 발표 창이 그대로 그린다. 단계(step)는 노트북이 정한다. */
export type PresentCeremony = {
  division: number;
  enrolled: number;
  present: number;
  items: CeremonyItem[];
  motionCount?: number;
  sourceLabel: string;
  step: CeremonyStep;
};

export const PRESENT_QUERY = 'present';

/** 운영 화면 → 발표 창. */
export type PresentStateMessage = {
  kind: 'state';
  v: 1;
  state: PrepState;
  /** 운영자가 마지막으로 고른 안(제목 칸을 누르거나 [큰 화면에]·[투표 시작]). */
  focus: string | null;
  /** ballotId → 제출 수(운영 화면이 폴링한 값). */
  counts: Record<string, number>;
  /** 실명 투표(10/17) — 이 투표(ballotId)의 「투표결과 보기」(조·이름)를 큰 화면에 띄운다. 옛 운영 화면은 보내지 않는다(없음 = 띄우지 않음). */
  names?: string | null;
  /** 세리머니 진행 중이면 그 내용·단계(10/17). 없거나 null 이면 평소 화면. */
  ceremony?: PresentCeremony | null;
  /** 10/17 연습 투표 — 있으면 다른 장면보다 먼저 그 투표의 QR·실시간 수를 띄운다(준비판과 무관). */
  practice?: BallotListRow | null;
};
/** 발표 창 → 운영 화면: 살아 있음. 운영 화면은 이것이 오면 QR 전체 화면을 노트북에 띄우지 않는다. */
export type PresentAliveMessage = { kind: 'alive'; v: 1 };
export type PresentMessage = PresentStateMessage | PresentAliveMessage;

export const PRESENT_ALIVE_MS = 4000;

export function presentChannelName(scope: string): string {
  return `division-present:${scope}`;
}

export function isPresentMessage(x: unknown): x is PresentMessage {
  if (typeof x !== 'object' || x === null) return false;
  const m = x as { kind?: unknown; v?: unknown };
  return m.v === 1 && (m.kind === 'state' || m.kind === 'alive');
}

export type PresentScene =
  | { kind: 'idle'; division: number | null }
  | { kind: 'motion'; division: number; motion: Motion }
  | { kind: 'vote'; division: number; record: BallotRecord; motion: Motion | null; count: number | null }
  | {
      kind: 'result';
      division: number;
      motion: Motion;
      round: MotionRound;
      yes: number;
      no: number;
      threshold: number | null;
      /** 거수 확인 전 = 잠정. */
      provisional: boolean;
    }
  | { kind: 'counting'; division: number; motion: Motion; round: MotionRound }
  | { kind: 'ceremony'; ceremony: PresentCeremony };

/**
 * 지금 큰 화면에 무엇을 띄우는가.
 * 1) 열린 투표가 있으면 그 QR.
 * 2) 고른 안이 마감·집계된 차수를 가졌고 2차를 준비 중이 아니면 그 결과.
 * 3) 고른 안이 있으면 그 안(제목·세부 권고).
 * 4) 아니면 대기.
 */
export function presentScene(msg: PresentStateMessage | null): PresentScene {
  if (!msg) return { kind: 'idle', division: null };
  if (msg.ceremony) return { kind: 'ceremony', ceremony: msg.ceremony };
  const { state, focus, counts } = msg;
  const division = state.division;
  const open = Object.values(state.ballots).find((b) => b.stage === 'open' && !b.voidedAt);
  if (open) {
    const motion = state.motions.find((m) => open.motionIds.includes(m.id)) ?? null;
    const count = open.ballotId && counts[open.ballotId] !== undefined ? counts[open.ballotId] : null;
    return { kind: 'vote', division, record: open, motion, count };
  }
  const motion = focus ? state.motions.find((m) => m.id === focus || m.key === focus) ?? null : null;
  if (!motion) return { kind: 'idle', division };
  const round = currentRound(motion);
  const totals = round ? roundTotals(round) : null;
  if (round && totals && !motion.revote && round.closedAt) {
    return {
      kind: 'result',
      division,
      motion,
      round,
      yes: totals.yes,
      no: totals.no,
      threshold: roundThreshold(round),
      provisional: handPending(round),
    };
  }
  // 마감했는데 결과를 아직 받는 중(마감 → 결과 읽기 사이) — 안 제목 화면으로 돌아가지 않고 「집계 중」(10/17 시뮬레이션: 첫 안).
  const rec = round ? state.ballots[round.requestId] : undefined;
  if (round && !totals && !motion.revote && rec && rec.stage === 'closed' && !rec.voidedAt) {
    return { kind: 'counting', division, motion, round };
  }
  return { kind: 'motion', division, motion };
}

/** 큰 화면 제목 글자 크기 — 길수록 줄인다(1920×1080 기준, 가장 작아도 44px). */
export function presentTitleSize(text: string): number {
  const n = [...text.trim()].length;
  if (n <= 30) return 96;
  if (n <= 60) return 80;
  if (n <= 110) return 64;
  if (n <= 180) return 54;
  return 44;
}

/** 발표 창에서 직접 누른 「투표결과 보기」·「결과로 돌아가기」 — 그때 노트북이 보낸 값(msgNames)에 묶는다. */
export type PresentNamesLocal = { msgNames: string | null; show: string | null };

/**
 * 발표 창에 이름 화면을 띄울 투표(10/17). 노트북이 보낸 값이 기준이다 — 노트북 값이 바뀌면 발표 창에서 누른 것은 잊는다.
 * 노트북 값이 그대로인 동안에는 발표 창에서 누른 것(보기·돌아가기)이 이긴다. 지금 결과 장면의 투표가 아니면 띄우지 않는다.
 */
export function presentNamesBallot(
  msgNames: string | null | undefined,
  local: PresentNamesLocal | null,
  sceneBallotId: string | null | undefined,
): string | null {
  const m = msgNames ?? null;
  const eff = local && local.msgNames === m ? local.show : m;
  return eff && sceneBallotId && eff === sceneBallotId ? eff : null;
}

/**
 * 큰 화면 판정 글자(10/17 점검 HIGH) — 판정 불가(참석 인원 비었음·찬반 합계가 참석보다 많음·의사정족수 미달)를
 * 「부결」로 보이지 않는다. 거수 확인 전이면 「집계 중」.
 */
export function presentVerdict(round: MotionRound, provisional: boolean): { word: '가결' | '부결' | '판정불가' | '집계 중'; tone: 'pass' | 'fail' | 'warn'; reason: string | null } {
  if (provisional) return { word: '집계 중', tone: 'warn', reason: null };
  const v = roundVerdict(round);
  if (v && v.kind === 'decided') return v.passed ? { word: '가결', tone: 'pass', reason: null } : { word: '부결', tone: 'fail', reason: null };
  let reason = '판정 조건 확인 필요';
  if (round.enrolled === null || round.present === null) reason = '참석 인원 확인 중';
  else if (v?.kind === 'no-quorum') reason = '의사정족수 미달';
  else if (v?.kind === 'invalid' && /참석 인원\(/.test(v.message)) reason = '찬반 합계가 참석 인원보다 많음';
  return { word: '판정불가', tone: 'warn', reason };
}

/**
 * 제출자 대조 상자가 볼 차수 — 지금 차수(투표 중 포함)에 투표 번호가 있으면 그것, 아니면 마지막 결과 차수.
 * 무효로 한 투표는 보지 않는다.
 */
export function reconcileRoundOf(
  cur: Pick<MotionRound, 'requestId' | 'round'> | null | undefined,
  last: Pick<MotionRound, 'requestId' | 'round'> | null | undefined,
  ballots: Readonly<Record<string, Pick<BallotRecord, 'ballotId' | 'voidedAt'>>>,
): { ballotId: string; round: number } | null {
  for (const r of [cur, last]) {
    if (!r) continue;
    const b = ballots[r.requestId];
    if (b?.ballotId && !b.voidedAt) return { ballotId: b.ballotId, round: r.round };
  }
  return null;
}
