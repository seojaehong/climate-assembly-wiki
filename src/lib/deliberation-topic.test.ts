import { describe, expect, it } from 'vitest';
import type { Topic } from './deliberation';
import {
  clockOffsetMs,
  countdownTier,
  pickBannerTopic,
  remainingMs,
} from '../islands/mod/topic-countdown';

/**
 * US-009 — **s17이 아직 안 걸린 DB에서도 화면이 죽지 않는다**는 것 하나만 못 박는다.
 *
 * 배포와 DB 적용은 순서가 어긋난다. 옛 `topic_list` 는 컬럼 6개짜리 행을 주므로
 * `deadline_at`·`server_now` 가 둘 다 `undefined` 다. 그때 카운트다운이 예외를 던지거나
 * (더 나쁘게) 「마감되었습니다」로 둔갑하면 조는 존재하지도 않는 마감에 쫓긴다.
 *
 * 구간 판정 자체는 `topic-countdown.test.ts`(40개)가 이미 갖고 있다. 여기서는
 * **`Topic` 이라는 응답 모양**이 그 로직에 그대로 들어맞는지만 본다. 그래서
 * 아래 두 리터럴은 반드시 `Topic` 으로 타입을 박는다 — 선택 필드가 아니게 되는 순간
 * 옛 응답 쪽이 **컴파일에서** 걸린다(이 파일의 절반은 타입 검사가 하는 일이다).
 *
 * 시계는 전부 인자로 넣는다(`Date.now()` 를 부르지 않는다).
 */

const NOW = Date.parse('2026-09-12T06:00:00+00:00');

/** s17 미적용 DB의 응답 행 — 컬럼 6개. 두 필드는 키 자체가 없다. */
const LEGACY_ROW: Topic = {
  id: '11111111-1111-4111-8111-111111111111',
  ordinal: 2,
  block: 'am',
  prompt: '우리 지역에서 가장 시급한 기후 문제는 무엇인가',
  guidance: null,
  status: 'open',
};

/** s17 적용 후의 응답 행 — 컬럼 8개. 마감까지 6분 남았다. */
const S17_ROW: Topic = {
  id: '22222222-2222-4222-8222-222222222222',
  ordinal: 3,
  block: 'am',
  prompt: '우리 조가 먼저 하겠다고 정한 일은 무엇인가',
  guidance: null,
  status: 'open',
  deadline_at: '2026-09-12T06:06:00+00:00',
  server_now: '2026-09-12T06:00:00+00:00',
};

describe('s17 미적용 DB (옛 topic_list 응답)', () => {
  it('두 필드가 undefined 다 — 정규화로 채워 넣지 않는다', () => {
    expect(LEGACY_ROW.deadline_at).toBeUndefined();
    expect(LEGACY_ROW.server_now).toBeUndefined();
  });

  it('잔여 시간이 null 이고 구간이 none 이다 — 배너를 아예 안 그린다', () => {
    const remaining = remainingMs(LEGACY_ROW.deadline_at, NOW, 0);
    expect(remaining).toBeNull();
    expect(countdownTier(remaining)).toBe('none');
  });

  it('배너가 고를 꼭지가 없다', () => {
    expect(pickBannerTopic([LEGACY_ROW], NOW, 0)).toBeNull();
  });

  it('server_now 가 없으면 오프셋은 0 이다 — 카운트다운을 죽이지 않고 기기 시계로 센다', () => {
    expect(clockOffsetMs(LEGACY_ROW.server_now, NOW)).toBe(0);
  });

  it('옛 행이 섞여 있어도 s17 행을 정상적으로 고른다 — 배포 중간 상태', () => {
    expect(pickBannerTopic([LEGACY_ROW, S17_ROW], NOW, 0)).toBe(S17_ROW);
  });
});

describe('s17 적용 DB', () => {
  it('마감 6분 전이면 calm 구간이다 — 같은 Topic 타입이 그대로 흘러간다', () => {
    const offset = clockOffsetMs(S17_ROW.server_now, NOW);
    expect(offset).toBe(0);
    expect(countdownTier(remainingMs(S17_ROW.deadline_at, NOW, offset))).toBe('calm');
  });
});
