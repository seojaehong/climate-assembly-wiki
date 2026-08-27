import type { Note } from './hq-submission-board-logic';

/**
 * L3 — 4범주 **잠정** 구조화의 순수 로직.
 *
 * 회의자료 260811 이 분과 총괄모더레이터에게 맡긴 일은 「5개 조 결과를 공통·차이·갈등·질문으로
 * **잠정** 비교·구조화」다. 같은 표가 금지한 것은 「조별 결과 임의 통합」·「좋은 의견 선정」이다.
 * 그래서 이 파일의 어떤 연산도 카드를 지우거나 합치거나 문장을 고치지 않는다 —
 * 범주 배정은 **카드에 이름표 하나를 얹는 것**일 뿐이다.
 *
 *   묶어도 카드 수는 줄지 않는다.
 *
 * 설계 근거: `10_작업산출물/2026-08-27_0829_조별입력_3꼭지/취합설계_모이되모으지않는다.md` §4.
 */

/**
 * 네 범주. **순서는 설계문서 순서(공통·차이·갈등·질문)로 고정**한다 —
 * 화면(US-008)이 이 배열 그대로 버튼을 그리므로 순서를 바꾸면 버튼 자리가 바뀐다.
 *
 * 저장용 식별자는 ASCII 로 두고 한국어는 라벨로 뺐다
 * (`automation/canvas-ontology-bridge.mjs` 의 `CANVAS_ONTOLOGY_NODE_KINDS` 와 같은 방식).
 * ★ 이 네 문자열이 그대로 US-007 마이그레이션의 저장값이 된다. 임의로 바꾸지 말 것.
 */
export const FOUR_CATEGORIES = ['common', 'difference', 'conflict', 'question'] as const;

export type FourCategory = (typeof FOUR_CATEGORIES)[number];

/** 화면에 보이는 이름. 「갈등」은 설계문서의 「갈등·Trade-off」를 줄인 것이다. */
export const FOUR_CATEGORY_LABELS: Record<FourCategory, string> = {
  common: '공통',
  difference: '차이',
  conflict: '갈등',
  question: '질문',
};

/**
 * 배정 상태 — **카드 id → 범주** 맵. 카드 목록과 따로 산다.
 *
 * 맵으로 두는 이유가 곧 안전장치다. 카드를 범주 「안으로 옮기는」 자료구조(범주별 배열)를 쓰면
 * 옮기는 과정에서 카드가 빠지거나 두 범주에 겹칠 수 있다. 카드는 제자리에 두고 이름표만 얹으면
 * 한 카드에 범주는 언제나 0개나 1개이고, 배정이 카드 수를 건드릴 방법 자체가 없다.
 *
 * 카드 id 는 `${topic_id}:${team_id}:${item_ordinal}` 이라 꼭지가 이미 들어 있다 —
 * 꼭지 탭을 넘나들어도 맵 하나로 충돌 없이 관리된다.
 */
export type CategoryState = ReadonlyMap<string, FourCategory>;

export function emptyCategoryState(): CategoryState {
  return new Map<string, FourCategory>();
}

/**
 * 범주를 배정한다. **새 맵**을 돌려준다(제자리 수정은 React 리렌더가 안 걸린다).
 *
 * 이미 배정된 카드에 다시 부르면 덮어쓴다 — 한 카드가 두 범주에 겹치는 일이 없다.
 * 카드 목록은 인자로 받지도 않는다. 지울 대상이 없으니 지울 수가 없다.
 */
export function assignCategory(
  state: CategoryState,
  noteId: string,
  category: FourCategory,
): CategoryState {
  const next = new Map(state);
  next.set(noteId, category);
  return next;
}

/**
 * 배정을 되돌린다. 카드는 미배정으로 돌아갈 뿐 사라지지 않는다.
 * 되돌릴 수 있어야 「잠정」이고, 되돌릴 수 있어야 책임이 남는다(설계문서 §4).
 */
export function unassignCategory(state: CategoryState, noteId: string): CategoryState {
  if (!state.has(noteId)) return state;
  const next = new Map(state);
  next.delete(noteId);
  return next;
}

/** 이 카드가 어느 범주에 있나. 아직 없으면 null. */
export function categoryOf(state: CategoryState, noteId: string): FourCategory | null {
  return state.get(noteId) ?? null;
}

/**
 * 아직 어느 범주에도 안 들어간 카드 수.
 *
 * 이 수를 화면에 상시 표시하는 것이 「소수의견 삭제 금지」의 실질이다 —
 * 아무 데도 안 들어간 카드가 조용히 사라지지 않는다(설계문서 §4).
 */
export function unassignedCount(notes: readonly Pick<Note, 'id'>[], state: CategoryState): number {
  return notes.filter((note) => !state.has(note.id)).length;
}

export type PreservationReport = {
  /** 원문 카드 수. */
  originalCount: number;
  /** 그중 범주가 붙은 수. */
  assignedCount: number;
  /** 그중 아직 안 붙은 수. */
  unassignedCount: number;
  /** 배정하다 잃어버린 카드 수. 이 설계에서는 항상 0 이어야 한다. */
  deletedCount: number;
  /** `deletedCount === 0` 이고 배정+미배정이 원문 수와 맞는가. */
  ok: boolean;
};

/**
 * 「원문 N장 · 배정 M장 · 미배정 K장 · **삭제 0장**」을 낸다.
 *
 * 「모으지 않았다」를 숫자로 증명하는 자리다(설계문서 §4 — 이 설계의 핵심 장치).
 * 자료구조상 `deletedCount` 는 늘 0 이고, 그게 요점이다 — 배정이 카드를 지울 수 없게 만들어
 * 놓고 화면이 그 사실을 매번 보여준다.
 *
 * ★ 목록에 없는 카드 id 의 배정은 **세지 않고 무시**한다. 배정 맵은 꼭지 세 개를 함께 담는데
 * 꼭지 하나만 보고 판정하면 다른 꼭지의 배정이 「사라진 카드」로 잘못 잡힌다
 * (`pair-marks.ts` 의 「목록 밖 체크 무시」와 같은 규칙).
 */
export function preservationInvariant(
  notes: readonly Pick<Note, 'id'>[],
  state: CategoryState,
): PreservationReport {
  const originalCount = notes.length;
  const assignedCount = notes.filter((note) => state.has(note.id)).length;
  const unassigned = originalCount - assignedCount;
  const deletedCount = originalCount - (assignedCount + unassigned);
  return {
    originalCount,
    assignedCount,
    unassignedCount: unassigned,
    deletedCount,
    ok: deletedCount === 0,
  };
}

/**
 * 묶음에 든 조가 몇 개인가로 공통/차이를 가른다.
 *
 * **이것은 판단이 아니라 세기다.** 두 조 이상이 같은 말을 했으면 「공통」, 한 조뿐이면 「차이」다.
 * 내용이 좋은지 옳은지는 보지 않는다 — 그 판단은 「좋은 의견 선정」이라 금지돼 있다.
 * 갈등·질문은 세어서 나오지 않으므로 사람이 직접 배정한다.
 *
 * 조 식별자는 `Note.teamId` 를 그대로 넣으면 된다. 같은 조가 나눠 쓴 두 문장이 한 묶음에 들면
 * 카드는 2장이어도 조는 하나 → **차이**다(중복은 세지 않는다).
 *
 * 빈 묶음은 묶음이 아니므로 null.
 */
export function categoryOfCluster(memberTeamOrdinals: readonly string[]): FourCategory | null {
  const distinctTeams = new Set(memberTeamOrdinals);
  if (distinctTeams.size === 0) return null;
  return distinctTeams.size >= 2 ? 'common' : 'difference';
}
