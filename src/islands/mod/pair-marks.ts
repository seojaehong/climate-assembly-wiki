import type { SimilarPair } from './note-similarity';

/**
 * L2 — 「닮은 짝」에 사람이 붙이는 표시(체크)의 순수 로직.
 *
 * ★ 이 파일의 어떤 연산도 카드를 지우거나 합치거나 문장을 고치지 않는다.
 * 체크는 **두 카드에 같은 번호표를 붙이는 것**일 뿐이고, 카드는 제자리에 그대로 남는다.
 *
 *   묶어도 카드 수는 줄지 않는다.
 *
 * `similarPairs()` 가 제안한 짝을 사람이 보고 ✓ 하면 그 짝의 번호가 두 카드에 나타난다.
 * 다시 누르면 사라진다 — 되돌릴 수 있어야 책임이 남는다(설계문서 §4 「누가·언제 묶었는지」).
 */

/**
 * 짝 식별자. 두 카드 id 를 **정렬해서** 잇는다 — (a,b) 와 (b,a) 가 같은 짝이어야
 * 화면 어디서 눌러도 같은 체크가 토글된다.
 *
 * 카드 id 는 `${topic_id}:${team_id}:${item_ordinal}` 이라 꼭지가 이미 들어 있다.
 * 그래서 꼭지 탭을 넘나들어도 한 Set 으로 충돌 없이 관리된다.
 */
export function pairKey(aId: string, bId: string): string {
  return aId <= bId ? `${aId}|${bId}` : `${bId}|${aId}`;
}

/**
 * 체크를 켜고 끈다. 입력 Set 을 건드리지 않고 **새 Set** 을 돌려준다
 * (React 상태로 그대로 쓰기 위해서다 — 제자리 수정은 리렌더가 안 걸린다).
 */
export function togglePair(checked: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(checked);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * 체크된 짝 → 카드별 번호표.
 *
 * 번호는 **누른 순서가 아니라 `similarPairs()` 결과에서의 자리(1부터)** 다.
 * 누른 순서로 매기면 하나를 풀 때 나머지 번호가 통째로 밀려, 화면의 「짝 3」이 가리키는
 * 대상이 조작 중에 바뀐다. 자리로 매기면 토글과 무관하게 고정이고, 패널의 짝 번호와
 * 카드의 번호표가 항상 같은 것을 가리킨다.
 *
 * 한 카드가 여러 짝에 들 수 있으므로 번호는 **배열**이다(오름차순).
 */
export function marksByNote(
  pairs: readonly SimilarPair[],
  checked: ReadonlySet<string>,
): Map<string, number[]> {
  const marks = new Map<string, number[]>();
  pairs.forEach((pair, index) => {
    if (!checked.has(pairKey(pair.aId, pair.bId))) return;
    const number = index + 1;
    for (const id of [pair.aId, pair.bId]) {
      const list = marks.get(id);
      if (list) list.push(number);
      else marks.set(id, [number]);
    }
  });
  for (const list of marks.values()) list.sort((a, b) => a - b);
  return marks;
}

/** 체크된 짝의 수. 화면이 「N쌍 표시함」을 낼 때 쓴다(카드 수와 헷갈리지 않게 단위를 「쌍」으로 둔다). */
export function checkedPairCount(pairs: readonly SimilarPair[], checked: ReadonlySet<string>): number {
  return pairs.filter((pair) => checked.has(pairKey(pair.aId, pair.bId))).length;
}
