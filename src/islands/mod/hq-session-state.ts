/**
 * 본부 보드가 「무엇을 그릴지」를 정하는 판단 하나.
 *
 * ── 왜 파일로 뺐나 ──────────────────────────────────────────────────
 * 회차를 바꾸면(`CURRENT_SESSION_SLUG`) **개통 SQL 을 적용하기 전까지 그 세션에는 아무것도
 * 없다.** 예전 화면은 그때 「아직 열린 토론 주제가 없습니다」 한 줄만 냈다. 그 문장은
 * ① 세션이 아예 없는 것과 ② 세션은 있는데 꼭지가 안 열린 것을 구별하지 못하면서도
 * ②라고 **단정**한다. 행사 당일 본부가 그 화면을 보면 「우리가 뭘 안 한 거지」를 알 수 없다.
 *
 * `hq_submissions` 는 두 경우 모두 **행 0개**를 준다(세션이 없어도 예외가 아니다 —
 * 함수 본문이 slug 로 조인만 하기 때문이다, 20260827_s7:37). 그러니 화면이 둘을 가르는
 * 척하면 안 되고, **둘 다 적어 주고 어느 쪽인지는 사람이 확인하게** 해야 한다.
 *
 * `.tsx` 가 아니라 `.ts` 인 이유는 vitest include 가 `src/**\/*.test.ts` 라서다
 * (`src/islands/mod/AGENTS.md` — `.tsx` 테스트는 조용히 실행되지 않는다).
 */

/** 본부 보드의 최상위 표시 상태. 순서(우선순위)는 아래 hqBoardState 가 정한다. */
export type HqBoardState =
  /** 아직 첫 응답 전 — 실패도 아니다. */
  | { kind: 'loading' }
  /** RPC 가 죽었다. 원인 문구를 그대로 보여 주고 다시 시도를 준다. */
  | { kind: 'failed'; message: string }
  /** 응답은 왔는데 이 세션에 그릴 것이 하나도 없다. */
  | {
      kind: 'not-opened';
      sessionSlug: string;
      headline: string;
      detail: string;
      hint: string;
    }
  /** 그릴 꼭지가 있다. */
  | { kind: 'ready' };

/**
 * 개통 전 화면에 낼 문구.
 *
 * ★ 「세션이 없다」고 단정하지 않는다 — 화면은 그것을 알 수 없다. 두 원인을 다 적고
 *   무엇을 확인하면 되는지만 말한다. 그리고 **8.29 가 지워진 것이 아님**을 함께 적는다.
 *   본부가 이 화면에서 가장 먼저 하는 걱정이 그것이기 때문이다(세션이 하나 늘었을 뿐이다).
 */
export function notOpenedMessage(sessionSlug: string): {
  headline: string;
  detail: string;
  hint: string;
} {
  return {
    headline: '이 회차가 아직 개통되지 않았습니다',
    detail:
      `세션 「${sessionSlug}」에서 읽어 온 것이 하나도 없습니다. ` +
      '개통 SQL(세션·조 15개·접속코드)이 아직 적용되지 않았거나, 적용은 되었으나 ' +
      '논의 꼭지가 아직 열리지 않은 상태입니다. 둘 중 어느 쪽인지는 이 화면에서 구별되지 않습니다.',
    hint:
      '개통 SQL을 적용하고 꼭지를 열면 조가 쓰는 대로 여기에 모입니다. ' +
      '지난 회차 산출물은 지워지지 않았습니다 — 세션이 하나 늘었을 뿐입니다.',
  };
}

/**
 * 보드가 그릴 상태를 하나 고른다.
 *
 * @param rows       hq_submissions 응답. 아직 못 받았으면 null.
 * @param failed     실패 문구. 실패가 아니면 null.
 * @param boardCount buildBoards() 가 접은 꼭지 수.
 * @param sessionSlug 이 화면이 보고 있는 세션 — 화면에 그대로 나온다.
 */
export function hqBoardState({
  rows,
  failed,
  boardCount,
  sessionSlug,
}: {
  rows: unknown[] | null;
  failed: string | null;
  boardCount: number;
  sessionSlug: string;
}): HqBoardState {
  // 순서는 기존 화면과 같다 — 로딩 → 실패 → 빈 상태 → 정상.
  if (rows === null && failed === null) return { kind: 'loading' };
  if (failed !== null) return { kind: 'failed', message: failed };
  if (boardCount <= 0) return { kind: 'not-opened', sessionSlug, ...notOpenedMessage(sessionSlug) };
  return { kind: 'ready' };
}
