/**
 * 11/14 의제별 의결 투표지 — 휴대폰 「넘김식」 화면의 순수 로직(React·DOM 의존 금지, vitest).
 *
 * 한 화면에 권고안 1건. [찬성]/[반대]를 누르면 고른 표시를 0.4초 보인 뒤 다음 건으로 넘어가고,
 * 넘어간 직후 0.5초는 누름을 받지 않는다(연달아 눌러 다음 건에 같은 값이 들어가는 일을 막는다).
 * 마지막 건 뒤에는 요약(찬성 · 반대 · 미응답 + 번호) → [제출] 한 번.
 *
 * 저장값은 지금과 같다: 1 = 반대, 2 = 찬성(집계 · 세리머니 · 결과 내보내기가 이 값에 기댄다).
 * 근거 = 20_투표_최종안 ④-1 · W04 · 00_고정조건 C-7.
 */
import type { Ballot, BallotItem } from '../../lib/ballot';
import { isDecisionBallot } from '../../lib/division-ballot-format';

/** 고른 표시를 보이는 시간. */
export const ADVANCE_DELAY_MS = 400;
/** 넘어간 직후 누름을 받지 않는 시간. */
export const INPUT_LOCK_MS = 500;

export const YES = 2;
export const NO = 1;

/** 건 위치(0부터) 또는 요약 화면. */
export type PagerPos = number | 'summary';

export type PagerState = {
  pos: PagerPos;
  answers: Record<string, number>;
  /** 이 시각(ms) 전에는 누름을 받지 않는다. */
  lockedUntil: number;
  /** 고른 표시 중이면 그 건 위치와 넘어갈 시각. */
  flash: { pos: number; until: number; next: PagerPos } | null;
};

/**
 * 넘김식 화면을 쓰는가. 의결 투표지이고 2건 이상일 때 — 분과 의결(「N분과 의결…」 + subgroup 「N분과」)
 * 또는 11/14 전체회의 의결(「전체회의 의결 의제N…」 + subgroup 비움, 세션 명단 전원).
 * 1건짜리(10/17 흐름)와 일반 다의제 투표는 지금 목록 화면 그대로. `?view=list` 는 비상용 목록 토글.
 */
export function shouldUsePager(ballot: Pick<Ballot, 'title' | 'subgroup' | 'items'>, search: string): boolean {
  if (new URLSearchParams(search).get('view') === 'list') return false;
  return isDecisionBallot(ballot) && ballot.items.length > 1;
}

/** 화면 번호 — 문항 문장 「2-5-안1 제목」에서 「2-5」. 모양이 다르면 순번. */
export function motionNumber(item: Pick<BallotItem, 'statement' | 'ordinal'>): string {
  const m = /^(\S+)-안\d+(?:\s|$)/.exec(item.statement.trim());
  return m ? m[1] : String(item.ordinal);
}

function validValue(item: BallotItem, v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= item.scale;
}

export function initialPagerState(answers: Record<string, number> = {}, pos: PagerPos = 0): PagerState {
  return { pos, answers, lockedUntil: 0, flash: null };
}

/** [찬성]/[반대]. 잠금 중 · 고른 표시 중 · 요약 화면이면 그대로 돌려준다. */
export function pagerPress(state: PagerState, items: readonly BallotItem[], value: number, now: number): PagerState {
  if (state.pos === 'summary' || state.flash || now < state.lockedUntil) return state;
  const item = items[state.pos];
  if (!item || !validValue(item, value)) return state;
  return {
    ...state,
    answers: { ...state.answers, [item.id]: value },
    flash: { pos: state.pos, until: now + ADVANCE_DELAY_MS, next: nextPos(state.pos, items.length) },
    lockedUntil: now + ADVANCE_DELAY_MS + INPUT_LOCK_MS,
  };
}

/** 시간이 지나면 고른 표시를 끝내고 다음 건(마지막이면 요약)으로. */
export function pagerTick(state: PagerState, now: number): PagerState {
  if (!state.flash || now < state.flash.until) return state;
  return { ...state, pos: state.flash.next, flash: null };
}

/** 다음 위치. 마지막 건 뒤는 요약. */
function nextPos(pos: number, total: number): PagerPos {
  return pos + 1 >= total ? 'summary' : pos + 1;
}

/** 이동(이전 · 다음 · 번호 · 요약). 고른 표시를 끊고, 범위를 맞춘다. */
export function pagerGo(state: PagerState, target: PagerPos, total: number, now: number): PagerState {
  const pos: PagerPos = target === 'summary' || target >= total ? 'summary' : Math.max(0, target);
  return { ...state, pos, flash: null, lockedUntil: now + INPUT_LOCK_MS };
}

export type SummaryEntry = { pos: number; number: string; id: string };
export type PagerSummary = {
  yes: number;
  no: number;
  unanswered: number;
  noItems: SummaryEntry[];
  unansweredItems: SummaryEntry[];
};

export function pagerSummary(items: readonly BallotItem[], answers: Record<string, number>): PagerSummary {
  const out: PagerSummary = { yes: 0, no: 0, unanswered: 0, noItems: [], unansweredItems: [] };
  items.forEach((item, pos) => {
    const v = answers[item.id];
    const entry = { pos, number: motionNumber(item), id: item.id };
    if (!validValue(item, v)) {
      out.unanswered += 1;
      out.unansweredItems.push(entry);
    } else if (v === YES) {
      out.yes += 1;
    } else if (v === NO) {
      out.no += 1;
      out.noItems.push(entry);
    }
  });
  return out;
}

/** 제출 완료 화면의 본인 선택 문구. 누르지 않은 건은 기권으로 기록되므로 「기권」으로 적는다. */
export function pagerChoiceText(items: readonly BallotItem[], answers: Record<string, number>): string {
  const s = pagerSummary(items, answers);
  return `찬성 ${s.yes}건 · 반대 ${s.no}건 · 기권 ${s.unanswered}건`;
}

/**
 * 요약 화면 [제출하기]의 상태.
 * - none-answered: 한 건도 고르지 않았다 → 제출 불가
 * - required-missing: 전건 필수(문항 required)인데 빠진 건이 있다 → 제출 불가, 번호로 돌아가게
 * - confirm-missing: 미표시 허용인데 빠진 건이 있다 → 「기권으로 두고 제출」 한 번 더 확인
 * - ready: 바로 제출
 */
export type PagerSubmitGate = 'none-answered' | 'required-missing' | 'confirm-missing' | 'ready';

export function pagerSubmitGate(items: readonly BallotItem[], answers: Record<string, number>): PagerSubmitGate {
  const answered = items.filter((it) => validValue(it, answers[it.id]));
  if (answered.length === 0) return 'none-answered';
  const missing = items.filter((it) => !validValue(it, answers[it.id]));
  if (missing.length === 0) return 'ready';
  return missing.some((it) => it.required) ? 'required-missing' : 'confirm-missing';
}

// ── 임시 저장 ────────────────────────────────────────────────────────
// 누를 때마다 고른 값 · 위치 · 고른 조와 이름을 투표지 id 별 키로 기기에 둔다. 제출이 끝나면 지운다.
// 투표지가 다르면 되살리지 않는다(최종안 K-M14). 저장소가 막힌 기기는 화면이 살아 있는 동안만 유지된다.

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PagerDraft = {
  answers: Record<string, number>;
  pos: PagerPos;
  voter: { team: string | null; name: string } | null;
};

export function pagerDraftKey(ballotId: string): string {
  return `cv_ballot_${ballotId}_pager_draft`;
}

export function savePagerDraft(storage: DraftStorage, ballotId: string, draft: PagerDraft): void {
  try {
    storage.setItem(pagerDraftKey(ballotId), JSON.stringify({ v: 1, ...draft }));
  } catch {
    // 저장소가 막힌 기기 — 화면 메모리로만 유지한다.
  }
}

export function clearPagerDraft(storage: DraftStorage, ballotId: string): void {
  try {
    storage.removeItem(pagerDraftKey(ballotId));
  } catch {
    // 무시
  }
}

export function loadPagerDraft(storage: DraftStorage, ballotId: string, items: readonly BallotItem[]): PagerDraft | null {
  let raw: string | null;
  try {
    raw = storage.getItem(pagerDraftKey(ballotId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as { answers?: unknown; pos?: unknown; voter?: unknown };
  const answers: Record<string, number> = {};
  if (p.answers && typeof p.answers === 'object') {
    for (const item of items) {
      const v = (p.answers as Record<string, unknown>)[item.id];
      if (validValue(item, v)) answers[item.id] = v;
    }
  }
  let pos: PagerPos = 0;
  if (p.pos === 'summary') pos = 'summary';
  else if (typeof p.pos === 'number' && Number.isInteger(p.pos) && p.pos >= 0 && p.pos < items.length) pos = p.pos;
  let voter: PagerDraft['voter'] = null;
  const v = p.voter as { team?: unknown; name?: unknown } | null | undefined;
  if (v && typeof v === 'object' && typeof v.name === 'string' && (typeof v.team === 'string' || v.team === null)) {
    voter = { team: v.team as string | null, name: v.name };
  }
  return { answers, pos, voter };
}
