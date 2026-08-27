import type { SimilarPair } from './note-similarity';
import { pairKey } from './pair-marks';
import type {
  RepresentativePickErrorReason,
  RepresentativeState,
} from './representative-pick';
import { RepresentativePickError, representativeOf } from './representative-pick';

/**
 * L4 화면이 쓰는 **묶음의 출처**.
 *
 * 이 저장소에 「묶음」이라는 것은 US-005 의 **사람이 ✓ 한 닮은 짝** 말고는 없다.
 * 그래서 묶음 하나 = 체크된 짝 하나 = **카드 두 장**이다.
 *
 * ★ **짝을 합쳐 큰 묶음을 만들지 않는다.** 카드 하나가 여러 짝에 드는 경우가 이미 있고
 * (US-005 스크린샷의 「닮은 짝 1」·「닮은 짝 11」 두 배지), 그것들을 이어 하나의 큰 묶음으로
 * 만드는 순간 그게 회의자료 260811 이 금지한 **「조별 결과 임의 통합」**이다.
 * 사람이 ✓ 한 것은 「이 둘이 닮았다」이지 「이 다섯이 한 덩어리다」가 아니다.
 *
 * ★ 묶음 번호는 **누른 순서가 아니라 `similarPairs()` 목록에서의 자리**다 —
 * `marksByNote()` 와 정확히 같은 규칙이라, 패널의 「짝 3」과 카드에 붙은 「닮은 짝 3」이
 * 언제나 같은 것을 가리킨다(`pair-marks.ts` 참조).
 *
 *   묶어도 카드 수는 줄지 않는다.
 */

/** 화면에 낼 묶음 하나. 카드 id 만 들고 있어서 문장을 고칠 방법이 없다. */
export type RepresentativeGroup = {
  /** `pairKey(a,b)` — 두 카드 id 를 정렬해 이은 값. 카드 id 에 꼭지가 들어 있어 꼭지 간 충돌이 없다. */
  groupId: string;
  /** 화면에 보이는 번호(1부터). `similarPairs()` 목록에서의 자리이며 체크를 풀어도 안 밀린다. */
  ordinal: number;
  /** 그 묶음에 든 카드 id 들. 짝이므로 언제나 두 장이다. */
  memberIds: readonly string[];
};

/**
 * 체크된 짝 → 묶음 목록. 체크 안 한 짝은 묶음이 아니다(AI 가 미리 묶어두지 않는다).
 *
 * 순서는 `pairs` 순서 그대로다 — 점수 내림차순이라 화면의 짝 패널과 같은 차례로 보인다.
 */
export function groupsFromCheckedPairs(
  pairs: readonly SimilarPair[],
  checked: ReadonlySet<string>,
): RepresentativeGroup[] {
  const groups: RepresentativeGroup[] = [];
  pairs.forEach((pair, index) => {
    const groupId = pairKey(pair.aId, pair.bId);
    if (!checked.has(groupId)) return;
    groups.push({ groupId, ordinal: index + 1, memberIds: [pair.aId, pair.bId] });
  });
  return groups;
}

/**
 * 묶음 목록 → `RepresentativeState.groups` 에 넣을 맵.
 *
 * 상태를 따로 들고 동기화하지 않기 위한 함수다. 화면은 `history` 만 `useState` 로 들고
 * 이 맵은 매번 파생한다 — 맞아야 하는 저장소가 하나뿐이라 어긋날 수가 없다
 * (`representative-pick.ts` 가 「현재 대표」를 안 들고 있는 것과 같은 이유).
 */
export function groupsMapOf(
  groups: readonly RepresentativeGroup[],
): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const group of groups) map.set(group.groupId, group.memberIds);
  return map;
}

/**
 * 지금 대표로 지목된 카드 id → 그 카드가 대표인 묶음 번호들(오름차순).
 *
 * 카드 하나가 여러 묶음에서 대표일 수 있으므로 값이 **배열**이다(`marksByNote` 와 같은 모양).
 * 대표가 아닌 카드는 이 맵에 없을 뿐이고 **화면에서 사라지지 않는다** —
 * 대표는 나머지를 대체하지 않는다.
 */
export function representativeNoteIds(
  state: RepresentativeState,
  groups: readonly RepresentativeGroup[],
): Map<string, number[]> {
  const marks = new Map<string, number[]>();
  for (const group of groups) {
    const noteId = representativeOf(state, group.groupId);
    if (!noteId) continue;
    const list = marks.get(noteId);
    if (list) list.push(group.ordinal);
    else marks.set(noteId, [group.ordinal]);
  }
  for (const list of marks.values()) list.sort((a, b) => a - b);
  return marks;
}

/** 대표가 정해진 묶음 수. 화면이 「N묶음 중 M묶음 지목됨」을 낼 때 쓴다. */
export function pickedGroupCount(
  state: RepresentativeState,
  groups: readonly RepresentativeGroup[],
): number {
  return groups.filter((group) => representativeOf(state, group.groupId) !== null).length;
}

/**
 * 지목이 성립하지 않았을 때 화면에 낼 **이유별 한국어 안내**.
 *
 * ★ 예외를 삼키고 「지정하지 못했습니다」 한 줄로 뭉개면 안 된다 — 특히 `moderator-alone` 은
 * **왜 안 되는지가 이 화면의 요점**이다. 모더레이터가 고르는 것이 회의자료 260811 의
 * 「좋은 의견 선정」 금지에 걸린다는 사실을, 걸린 그 자리에서 읽을 수 있어야 한다.
 *
 * `.tsx` 는 vitest include 에 안 잡히므로(`src/**\/*.test.ts` 만) 이 문구는 여기 `.ts` 에 둔다.
 */
export function pickFailureGuidance(reason: RepresentativePickErrorReason): string {
  switch (reason) {
    case 'actor-required':
    case 'actor-label-required':
      return '누가 골랐는지(이름)를 먼저 적으세요. 이름이 없으면 「누가·언제」가 이력에 남지 않습니다.';
    case 'moderator-alone':
      return '모더레이터 단독으로는 대표를 지정할 수 없습니다. 시민이 고른 것임을 아래 확인란에 체크하세요 — 모더레이터가 고르면 회의자료 260811 이 금지한 「좋은 의견 선정」이 됩니다.';
    case 'unknown-group':
      return '그 묶음이 화면에서 사라졌습니다. 「닮은 짝」 패널의 표시를 다시 확인하세요.';
    case 'outside-group':
      return '대표는 그 묶음에 든 카드 중에서만 고를 수 있습니다.';
    default:
      return '대표를 지정하지 못했습니다.';
  }
}

/** 지목 시도의 예외를 화면용 한 줄로 바꾼다. 알 수 없는 오류도 삼키지 않고 그대로 보여준다. */
export function describePickFailure(error: unknown): string {
  if (error instanceof RepresentativePickError) return pickFailureGuidance(error.reason);
  if (error instanceof Error && error.message) return error.message;
  return '대표를 지정하지 못했습니다.';
}
