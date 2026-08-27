import type { Note } from './hq-submission-board-logic';

/**
 * L1 — 「유사한 것끼리 가까이 배치」의 순수 로직.
 *
 * 회의자료 260811 이 「조별 결과 임의 통합」을 금지하므로 이 파일의 모든 연산은
 * **배치만 바꾼다**. 카드를 지우거나 합치거나 문장을 고치지 않는다.
 *
 *   묶어도 카드 수는 줄지 않는다.
 *
 * 판정 방식도 일부러 투명한 것만 쓴다 — 임베딩·네트워크·모델을 쓰지 않고
 * 문장에서 낱말을 뽑아 자카드 유사도만 낸다. 점수와 함께 **어떤 낱말이 겹쳤는지**를
 * 반드시 같이 돌려주어, 사람이 「왜 비슷하다는 건가」를 되짚을 수 있게 한다.
 * (문자 n-gram 을 섞으면 점수는 올라가지만 겹친 조각을 사람이 읽을 수 없어 쓰지 않는다.)
 */

/**
 * 유사도에서 빼는 낱말. 한 글자 조사·지시어는 어느 두 문장에나 겹쳐서
 * 「비슷하다」는 착시를 만든다.
 */
export const SIMILARITY_STOPWORDS = new Set([
  '그', '및', '등', '이', '가', '을', '를', '은', '는',
]);

/** 낱말 끝에 붙은 조사. 떼고 나서도 두 글자가 남을 때만 뗀다(「제도」→「제」가 되면 안 된다). */
const TRAILING_JOSA = /(은|는|이|가|을|를|과|와|의|도|만|에|에서|으로|로|에게|부터|까지)$/u;

/**
 * 문장 → 낱말 집합. 조사를 떼고, 한 글자와 불용어를 버린다.
 *
 * 근거(`rationale`)는 일부러 섞지 않는다 — 설계상 근거는 본문과 별개의 문장이고,
 * 이어붙이면 시민이 쓴 두 문장이 하나로 뭉개진다.
 */
export function tokenize(text: string): Set<string> {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}a-z0-9\s]/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .map((word) => {
      const stripped = word.replace(TRAILING_JOSA, '');
      return stripped.length >= 2 ? stripped : word;
    })
    .filter((word) => word.length >= 2 && !SIMILARITY_STOPWORDS.has(word));
  return new Set(words);
}

/** 두 낱말 집합이 공유하는 낱말. 화면에 그대로 보여줄 것이므로 가나다순으로 고정한다. */
function intersect(a: Set<string>, b: Set<string>): string[] {
  const shared: string[] = [];
  for (const word of a) if (b.has(word)) shared.push(word);
  return shared.sort((x, y) => x.localeCompare(y, 'ko'));
}

function jaccardOfSets(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  const shared = intersect(a, b);
  const union = a.size + b.size - shared.length;
  // 두 문장 모두 셀 낱말이 없으면 「비슷하다」고 말할 근거가 없다 → 0.
  return { score: union === 0 ? 0 : shared.length / union, shared };
}

/** 두 카드의 유사도 — 점수만 내지 않고 **근거가 된 낱말**을 함께 돌려준다. */
export function similarity(a: Note, b: Note): { score: number; sharedTerms: string[] } {
  const { score, shared } = jaccardOfSets(tokenize(a.content), tokenize(b.content));
  return { score, sharedTerms: shared };
}

/** 두 카드가 공유하는 낱말. 「왜 비슷한가」를 사람이 읽는 자리. */
export function sharedTerms(a: Note, b: Note): string[] {
  return similarity(a, b).sharedTerms;
}

/**
 * 비슷한 카드가 서로 이웃하도록 **재배열만** 한다.
 *
 * 입력의 첫 카드에서 출발해 아직 안 놓은 카드 중 가장 비슷한 것을 이어 붙이는 탐욕적 사슬이다.
 * 동점이면 원래 순서가 앞선 카드를 먼저 놓아 결과가 항상 같게 만든다.
 *
 * ★ 불변식 — 출력은 입력의 순열이다. 개수가 줄지도 늘지도 않고, 같은 카드가 두 번 나오지도 않는다.
 */
export function orderNotesBySimilarity(notes: Note[]): Note[] {
  if (notes.length <= 2) return [...notes];

  const tokens = notes.map((note) => tokenize(note.content));
  const used = new Array<boolean>(notes.length).fill(false);
  const order: number[] = [0];
  used[0] = true;

  while (order.length < notes.length) {
    const last = order[order.length - 1];
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < notes.length; i += 1) {
      if (used[i]) continue;
      const { score } = jaccardOfSets(tokens[last], tokens[i]);
      // 엄격한 > 라서 동점은 원래 순서가 앞선 쪽이 이긴다.
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    used[best] = true;
    order.push(best);
  }

  return order.map((index) => notes[index]);
}
