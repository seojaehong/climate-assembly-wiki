import { formatRemaining } from './timer-logic';

/**
 * 꼭지 마감 카운트다운 — 순수 함수만. 네트워크도 저장소도 DOM 도 여기 없다.
 *
 * 8.29 에 조가 산출물을 제 시간에 못 올린 첫 번째 이유가 「마감 시각을 조가 몰랐다」였다.
 * 타이머는 `timer` 탭 안에 있는데 조의 기본 탭은 `submission` 이라(`mod-tabs.ts:24-28`)
 * 아무도 보지 않는다. 그래서 마감은 탭 바깥 상단 배너로 낸다(B-D2).
 *
 * ★ **조 기기 시계를 믿지 않는다**(B-D3). `topic_list` 가 함께 실어 보내는
 *   `server_now` 로 오프셋을 잡고, 모든 잔여 계산에 그 오프셋을 태운다.
 *   오프라인이어도 마지막 오프셋으로 계속 tick 한다 — 카운트다운이 멈추면 안 된다.
 *
 * ★ **마감은 잠금이 아니다.** s17 은 꼭지 `status` 를 건드리지 않고 서버는 마감 후
 *   저장을 막지 않는다. 그래서 `over` 여도 문구는 「지금이라도 저장하세요」쪽으로 간다.
 *   마감을 잠금으로 다루면 8.29 에 실제로 일어난 일(다 정리했는데 못 올림)이 반복된다.
 *
 * 설계 정본: `docs/02-design/features/submission-resilience-0912.design.md` §2.3~2.5.
 * 렌더(1초 tick·색·마운트 위치)는 US-010 의 `DeadlineBanner.tsx` 몫이다.
 *
 * ★ 시계는 전부 인자로 받는다(이 디렉터리 관례). 모듈 안에서 `Date.now()` 를 부르지 않는다.
 */

/** 구간 경계. 잔여가 이 값 **이하**로 내려가면 다음 구간이다(`5:00` = notice, `3:00` = warn). */
export const NOTICE_THRESHOLD_MS = 5 * 60 * 1000;
export const WARN_THRESHOLD_MS = 3 * 60 * 1000;

/**
 * 타임스탬프 문자열 → epoch ms. 못 읽으면 `null`(예외를 던지지 않는다).
 *
 * ★ 여기 함정이 하나 있다. `timestamptz` 는 두 꼴로 온다 —
 *   psql 은 `2026-09-12 06:30:00+00`(공백 구분·2자리 오프셋), PostgREST JSON 은
 *   `2026-09-12T06:30:00+00:00`. 그런데 V8 은 **공백 꼴은 관대한 옛 파서로 읽고
 *   `T` 꼴은 엄격한 ISO 파서로 읽는다.** 그래서 공백을 `T` 로 바꾸기만 하면
 *   `2026-09-12T06:30:00+00` 이 되어 **NaN 이 된다**(실측). 오프셋 `+HH` 를
 *   `+HH:00` 으로 함께 늘려야 두 꼴이 같은 수가 된다.
 *   정규화가 실패하면 원문 그대로 한 번 더 읽어 본다.
 */
export function parseTimestampMs(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const normalized = trimmed.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) return parsed;

  const fallback = Date.parse(trimmed);
  return Number.isFinite(fallback) ? fallback : null;
}

/**
 * 서버 시각 − 내 시각. 이후 「지금」은 전부 `nowMs + offsetMs` 다.
 *
 * ★ 못 읽으면 **0** 이다 — 오프셋이 없다고 카운트다운을 통째로 죽이는 것보다
 *   기기 시계로라도 세는 편이 낫다. 옛 RPC 는 `server_now` 를 아예 안 보낸다(US-009).
 */
export function clockOffsetMs(serverNowIso: string | null | undefined, localNowMs: number): number {
  const serverMs = parseTimestampMs(serverNowIso);
  if (serverMs === null || !Number.isFinite(localNowMs)) return 0;
  return serverMs - localNowMs;
}

/** 마감까지 남은 ms. 마감이 없거나 못 읽으면 `null`(= 배너를 안 그린다). */
export function remainingMs(
  deadlineAtIso: string | null | undefined,
  nowMs: number,
  offsetMs: number,
): number | null {
  const deadlineMs = parseTimestampMs(deadlineAtIso);
  if (deadlineMs === null) return null;
  if (!Number.isFinite(nowMs) || !Number.isFinite(offsetMs)) return null;
  return deadlineMs - (nowMs + offsetMs);
}

export type CountdownTier = 'none' | 'calm' | 'notice' | 'warn' | 'over';

/**
 * 잔여 시간 → 구간.
 *
 * ★ `Number.isFinite` 가드가 핵심이다. NaN 은 모든 비교에 실패해 else 로 굴러떨어지므로
 *   가드가 없으면 **읽지 못한 시각이 빨간 「마감되었습니다」로 둔갑한다.**
 */
export function countdownTier(remaining: number | null | undefined): CountdownTier {
  if (remaining === null || remaining === undefined || !Number.isFinite(remaining)) return 'none';
  if (remaining <= 0) return 'over';
  if (remaining <= WARN_THRESHOLD_MS) return 'warn';
  if (remaining <= NOTICE_THRESHOLD_MS) return 'notice';
  return 'calm';
}

/** 배너가 고르는 데 필요한 최소 모양. `src/lib/deliberation.ts` 의 `Topic` 이 이걸 만족한다. */
export type CountdownTopic = {
  ordinal: number;
  status: 'open' | 'closed';
  deadline_at?: string | null;
};

/**
 * 배너에 띄울 꼭지 하나. 마감이 걸린 **열린** 꼭지 중에서 고른다. 없으면 `null`.
 *
 * ★ **확정한 판단 — 「가장 임박한」은 「가장 작은 잔여」가 아니다.**
 *   그냥 최솟값을 고르면 오전 10시에 지난 꼭지가 가장 음수라 오후 내내 배너가
 *   「마감되었습니다」에 붙박이고, 정작 15시에 마감되는 꼭지는 조용히 지나간다 —
 *   이 PRD 가 겨눈 8.29 사고 그 자체다. 그래서
 *   ① 아직 안 지난 것이 하나라도 있으면 그중 **가장 가까운 것**,
 *   ② 전부 지났을 때만 **가장 최근에 지난 것**을 고른다.
 *   같은 시각이면 `ordinal` 이 작은 쪽(화면 순서 앞)이다.
 *
 * 반환 타입이 제네릭인 이유는 US-010 배너가 `prompt`·`ordinal` 을 그대로 써야 하기 때문이다.
 */
export function pickBannerTopic<T extends CountdownTopic>(
  topics: readonly T[] | null | undefined,
  nowMs: number,
  offsetMs: number,
): T | null {
  if (!Array.isArray(topics)) return null;

  const candidates: { topic: T; remaining: number }[] = [];
  for (const topic of topics) {
    if (!topic || topic.status !== 'open') continue;
    const remaining = remainingMs(topic.deadline_at, nowMs, offsetMs);
    if (remaining === null || !Number.isFinite(remaining)) continue;
    candidates.push({ topic, remaining });
  }
  if (candidates.length === 0) return null;

  const future = candidates.filter((c) => c.remaining > 0);
  const pool = future.length > 0 ? future : candidates;
  // 미래는 오름차순(가장 가까운 것), 전부 지났으면 내림차순(가장 최근에 지난 것).
  const direction = future.length > 0 ? 1 : -1;
  pool.sort(
    (a, b) => direction * (a.remaining - b.remaining) || a.topic.ordinal - b.topic.ordinal,
  );
  return pool[0].topic;
}

/** 잔여 시간을 `MM:SS` 로. `timer-logic.ts` 의 포맷터를 그대로 쓴다(음수는 `00:00`). */
export function formatCountdown(ms: number): string {
  return formatRemaining(Number.isFinite(ms) ? ms : 0);
}

/**
 * 구간별 안내 문구. 잔여 시간 숫자는 배너가 따로 크게 내므로 여기엔 넣지 않는다.
 *
 * ★ **미저장 안내는 `warn`·`over` 에서만 붙인다.** US-008 의 AC 문구는 조건 없이
 *   읽히지만 설계 §2.4 는 「3분 이하 구간에서」라고 못 박았고 US-010 의 AC 도
 *   「warn 구간에서」다. 판단은 전부 이 모듈에 둔다는 것이 US-010 의 요건이라
 *   구간 가르기를 렌더 쪽으로 미루지 않았다. 여유 있을 때부터 매초 「저장 안 했다」를
 *   외치면 조는 곧 배너를 안 읽는다.
 *
 * ★ `over` 에도 붙이는 이유: 마감이 잠금이 아니라 **마감 뒤에도 저장이 된다.**
 *   여기서 「마감되었습니다」만 말하고 끝내면 8.29 의 사후 보고서가 그대로 반복된다.
 */
export function bannerMessage(tier: CountdownTier, hasUnsaved: boolean): string {
  switch (tier) {
    case 'none':
      return '';
    case 'calm':
      return '';
    case 'notice':
      return '곧 마감입니다.';
    case 'warn':
      return hasUnsaved
        ? '지금 저장하세요. 저장하지 않은 내용이 있습니다.'
        : '지금 저장하세요.';
    case 'over':
      return hasUnsaved
        ? '마감되었습니다. 저장하지 않은 내용이 있습니다 — 지금이라도 저장하세요.'
        : '마감되었습니다.';
  }
}
