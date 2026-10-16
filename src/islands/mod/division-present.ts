/**
 * 발표 화면(10/15) — 분과 PC 의 두 번째 모니터(프로젝터)에 띄우는 창.
 * 운영 화면(노트북)이 BroadcastChannel 로 지금 준비판 상태·고른 안·제출 수를 보내면, 발표 창은 그대로 그린다.
 * 같은 PC 안 창끼리라 서버를 거치지 않고 글자를 치는 대로 바로 보인다. 발표 창은 아무것도 저장하지 않는다.
 * 순수 로직이라 vitest 로 검증한다.
 */
import { currentRound, handPending, roundThreshold, roundTotals } from './division-vote-flow';
import type { BallotRecord, Motion, MotionRound, PrepState } from './division-vote-logic';

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
    };

/**
 * 지금 큰 화면에 무엇을 띄우는가.
 * 1) 열린 투표가 있으면 그 QR.
 * 2) 고른 안이 마감·집계된 차수를 가졌고 2차를 준비 중이 아니면 그 결과.
 * 3) 고른 안이 있으면 그 안(제목·세부 권고).
 * 4) 아니면 대기.
 */
export function presentScene(msg: PresentStateMessage | null): PresentScene {
  if (!msg) return { kind: 'idle', division: null };
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
