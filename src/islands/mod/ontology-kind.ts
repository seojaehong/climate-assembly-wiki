import type { Note } from './hq-submission-board-logic';

/**
 * 온톨로지 관점 보기 — 카드에 **종류 이름표** 하나를 얹는 순수 로직.
 *
 * 「쟁점·주장·제안·우려·조건·가치·근거」는 논증의 뼈대이지 카드의 등급이 아니다.
 * 종류를 붙이면 무엇이 주장이고 무엇이 그 주장의 근거인지가 드러나지만, **문장은 그대로 남는다** —
 * 회의자료 260811 이 금지한 「좋은 의견 선정」·「소수의견 삭제」·「문장 신작」에 걸리지 않으려면
 * 이 파일의 어떤 연산도 카드를 지우거나 합치거나 고쳐서는 안 된다.
 *
 *   묶어도 카드 수는 줄지 않는다.
 *
 * 자료구조는 `four-category.ts` 와 똑같이 **카드 id → 종류 맵**이다. 종류별로 카드 배열을 두고
 * 옮기는 모양을 쓰면 옮기는 과정에서 카드가 빠질 수 있고, 그때 보존 검사는 사후 탐지밖에 못 한다.
 * 맵으로 두면 한 카드의 종류가 늘 0개나 1개이고 **배정 함수가 카드 목록을 인자로 받지도 않는다.**
 *
 * 설계 근거: `10_작업산출물/2026-08-27_0829_조별입력_3꼭지/취합설계_모이되모으지않는다.md`.
 */

/**
 * 종류 7종. **이름·개수는 `automation/canvas-ontology-bridge.mjs` 의
 * `CANVAS_ONTOLOGY_NODE_KINDS` 와 반드시 같다** — 화면에서 붙인 종류가 나중에 온톨로지 검수 큐의
 * 종류와 다른 말을 쓰면 사람이 같은 카드를 두 번, 서로 다른 어휘로 판정하게 된다.
 * `ontology-kind.test.ts` 가 원본 배열과 대조해 못 박아 두었다 — 한쪽만 고치면 깨진다.
 *
 * 순서도 원본 그대로다. 화면(US-013)이 이 배열로 버튼을 그리므로 순서를 바꾸면 버튼 자리가 바뀐다.
 * 저장용 식별자는 ASCII 로 두고 한국어는 라벨로 뺐다(`four-category.ts` 와 같은 방식).
 */
export const ONTOLOGY_KINDS = [
  'Issue',
  'Claim',
  'Proposal',
  'Concern',
  'Condition',
  'Value',
  'Evidence',
] as const;

export type OntologyKind = (typeof ONTOLOGY_KINDS)[number];

/** 화면에 보이는 이름. 원본 브리지의 `KIND_KO` 와 같은 낱말이다(그쪽은 export 되지 않는다). */
export const ONTOLOGY_KIND_LABELS: Record<OntologyKind, string> = {
  Issue: '쟁점',
  Claim: '주장',
  Proposal: '제안',
  Concern: '우려',
  Condition: '조건',
  Value: '가치',
  Evidence: '근거',
};

/**
 * 종류가 뜻하는 바 한 줄. 버튼 `title` 로 쓴다.
 *
 * 일곱 개는 네 범주보다 많고 낱말만으로는 「조건」과 「우려」가 헷갈린다. 사람이 고르는 이름표라
 * 뜻이 화면에 있어야 하고, **뜻이 없으면 사람은 첫 번째 버튼을 누른다.**
 */
export const ONTOLOGY_KIND_HINTS: Record<OntologyKind, string> = {
  Issue: '무엇을 다툴 것인가 — 물음·논점',
  Claim: '이렇다고 보는 판단',
  Proposal: '이렇게 하자는 방안',
  Concern: '이래서 걱정된다는 것',
  Condition: '이것이 갖춰져야 한다는 전제',
  Value: '무엇이 중요한가 — 기준',
  Evidence: '그렇게 보는 까닭 — 사실·자료',
};

/**
 * 배정 상태 — **카드 id → 종류** 맵. 카드 목록과 따로 산다.
 *
 * 카드 id 는 `${topic_id}:${team_id}:${item_ordinal}` 이라 꼭지가 이미 들어 있다 —
 * 꼭지 탭을 넘나들어도 맵 하나로 충돌 없이 관리된다.
 */
export type KindState = ReadonlyMap<string, OntologyKind>;

/**
 * 처음에는 **전부 미지정**이다.
 *
 * ★ AI 가 종류를 미리 정하지 않는 것이 이 화면의 요건이다(US-013 AC). 미리 채워 두면 사람은
 * 확인 없이 넘기고, 그 순간 종류를 붙인 것은 사람이 아니라 도구가 된다. 온톨로지 검수 큐도
 * 노드마다 `kind: null` + 후보 7종으로 시작한다 — 파이프라인 전체가 같은 규칙이다.
 */
export function emptyKindState(): KindState {
  return new Map<string, OntologyKind>();
}

/**
 * 종류를 붙인다. **새 맵**을 돌려준다(제자리 수정은 React 리렌더가 안 걸린다).
 * 이미 붙은 카드에 다시 부르면 덮어쓴다 — 한 카드가 두 종류를 갖는 일이 없다.
 */
export function assignKind(state: KindState, noteId: string, kind: OntologyKind): KindState {
  const next = new Map(state);
  next.set(noteId, kind);
  return next;
}

/** 종류를 뗀다. 카드는 미지정으로 돌아갈 뿐 사라지지 않는다. */
export function unassignKind(state: KindState, noteId: string): KindState {
  if (!state.has(noteId)) return state;
  const next = new Map(state);
  next.delete(noteId);
  return next;
}

/** 이 카드에 붙은 종류. 아직 없으면 null. */
export function kindOf(state: KindState, noteId: string): OntologyKind | null {
  return state.get(noteId) ?? null;
}

/**
 * 한 카드의 종류를 누르는 동작. 같은 종류를 다시 누르면 **뗀다**.
 *
 * 「선택은 되돌릴 수 있다」(US-013 AC)를 해제 버튼을 따로 두지 않고 지키는 방법이다.
 * 되돌리는 길이 눈에 안 보이면 사람은 되돌리지 않고, 되돌릴 수 없는 이름표는 확정이 된다.
 * 다른 종류를 누르면 갈아탄다 — 한 카드가 두 종류에 겹치는 일은 여전히 없다.
 */
export function toggleKind(state: KindState, noteId: string, kind: OntologyKind): KindState {
  return state.get(noteId) === kind ? unassignKind(state, noteId) : assignKind(state, noteId, kind);
}

/**
 * 아직 종류가 안 붙은 카드 수.
 *
 * 이 수를 화면 상단에 상시 표시하는 것이 「소수의견 삭제 금지」의 실질이다 —
 * 아무 종류도 못 받은 카드가 조용히 사라지지 않는다.
 */
export function unspecifiedCount(notes: readonly Pick<Note, 'id'>[], state: KindState): number {
  return notes.filter((note) => !state.has(note.id)).length;
}

export type KindPreservationReport = {
  /** 원문 카드 수. */
  originalCount: number;
  /** 그중 종류가 붙은 수. */
  specifiedCount: number;
  /** 그중 아직 미지정인 수. */
  unspecifiedCount: number;
  /** 종류를 붙이다 잃어버린 카드 수. 이 설계에서는 항상 0 이어야 한다. */
  deletedCount: number;
  /** `deletedCount === 0` 인가. */
  ok: boolean;
};

/**
 * 「원문 N장 · 종류 M장 · **미지정 K장** · 삭제 0장」을 낸다.
 *
 * 자료구조상 `deletedCount` 는 0 이 아닐 수가 없고, 그게 요점이다 — 이름표가 카드를 지울 수 없게
 * 만들어 놓고 화면이 그 사실을 매번 보여준다(`four-category.ts` 의 `preservationInvariant` 와 같은 규칙).
 *
 * ★ 목록에 없는 카드 id 의 배정은 **세지 않고 무시**한다. 맵 하나가 꼭지 세 개를 함께 담으므로
 * 무시하지 않으면 다른 꼭지의 배정이 「사라진 카드」로 오탐된다.
 */
export function kindPreservation(
  notes: readonly Pick<Note, 'id'>[],
  state: KindState,
): KindPreservationReport {
  const originalCount = notes.length;
  const specifiedCount = notes.filter((note) => state.has(note.id)).length;
  const unspecified = originalCount - specifiedCount;
  return {
    originalCount,
    specifiedCount,
    unspecifiedCount: unspecified,
    deletedCount: originalCount - (specifiedCount + unspecified),
    ok: originalCount - (specifiedCount + unspecified) === 0,
  };
}

/**
 * 종류마다 카드가 몇 장인가. 일곱 종류가 **항상 다 나온다**(0장인 종류도 키가 있다) —
 * 화면에서 빈 종류가 사라지면 「그 종류는 안 봐도 된다」로 읽힌다.
 *
 * `kindPreservation` 과 같은 규칙으로 목록 밖 카드 id 는 세지 않는다.
 * 그래서 일곱 종류 합 + 미지정 = 원문 수가 항상 성립한다.
 */
export function countsByKind(
  notes: readonly Pick<Note, 'id'>[],
  state: KindState,
): Record<OntologyKind, number> {
  const counts = {
    Issue: 0,
    Claim: 0,
    Proposal: 0,
    Concern: 0,
    Condition: 0,
    Value: 0,
    Evidence: 0,
  } as Record<OntologyKind, number>;
  for (const note of notes) {
    const kind = state.get(note.id);
    if (kind) counts[kind] += 1;
  }
  return counts;
}
