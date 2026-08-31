import { describe, it, expect } from 'vitest';
import {
  NOTICE_THRESHOLD_MS,
  WARN_THRESHOLD_MS,
  bannerMessage,
  bannerView,
  clockOffsetMs,
  countdownTier,
  formatCountdown,
  parseTimestampMs,
  pickBannerTopic,
  remainingMs,
  type CountdownTopic,
} from './topic-countdown';

/** 2026-09-12T06:30:00Z — 경주 합숙 첫날 오전. 이 모듈은 Date.now() 를 부르지 않는다. */
const SERVER_NOW_ISO = '2026-09-12T06:30:00+00:00';
const SERVER_NOW_MS = Date.parse(SERVER_NOW_ISO);
const MIN = 60_000;

function topic(over: Partial<CountdownTopic> & { ordinal: number }): CountdownTopic & {
  prompt: string;
} {
  return { status: 'open', deadline_at: null, prompt: `꼭지 ${over.ordinal}`, ...over };
}

describe('parseTimestampMs', () => {
  it('PostgREST 꼴(T 구분·+HH:MM)을 읽는다', () => {
    expect(parseTimestampMs('2026-09-12T06:30:00+00:00')).toBe(SERVER_NOW_MS);
  });

  it('psql 꼴(공백 구분·+HH)도 같은 수로 읽는다', () => {
    expect(parseTimestampMs('2026-09-12 06:30:00+00')).toBe(SERVER_NOW_MS);
  });

  it('Z 꼴과 마이크로초가 붙은 꼴도 읽는다', () => {
    expect(parseTimestampMs('2026-09-12T06:30:00Z')).toBe(SERVER_NOW_MS);
    expect(parseTimestampMs('2026-09-12 06:30:00.000000+00')).toBe(SERVER_NOW_MS);
  });

  it('★ 오프셋 확장(+HH → +HH:00)이 없으면 못 읽는 꼴을 읽는다', () => {
    // Node 는 공백 꼴을 관대한 옛 파서로 읽어 주지만 `T` + 2자리 오프셋은 거부한다.
    // 이 꼴은 오직 정규화의 오프셋 확장으로만 살아난다 — Safari 에서는 공백 꼴도 같은 처지다.
    expect(Date.parse('2026-09-12T06:30:00+00')).toBeNaN();
    expect(parseTimestampMs('2026-09-12T06:30:00+00')).toBe(SERVER_NOW_MS);
  });

  it('못 읽는 값·빈 값·null·undefined 는 null 이다(예외를 던지지 않는다)', () => {
    expect(parseTimestampMs('언젠가')).toBeNull();
    expect(parseTimestampMs('')).toBeNull();
    expect(parseTimestampMs('   ')).toBeNull();
    expect(parseTimestampMs(null)).toBeNull();
    expect(parseTimestampMs(undefined)).toBeNull();
  });
});

describe('clockOffsetMs', () => {
  it('서버 시각 − 내 시각을 낸다', () => {
    expect(clockOffsetMs(SERVER_NOW_ISO, SERVER_NOW_MS)).toBe(0);
    // 내 기기가 10분 느리다 → 오프셋 +10분
    expect(clockOffsetMs(SERVER_NOW_ISO, SERVER_NOW_MS - 10 * MIN)).toBe(10 * MIN);
    // 내 기기가 10분 빠르다 → 오프셋 −10분
    expect(clockOffsetMs(SERVER_NOW_ISO, SERVER_NOW_MS + 10 * MIN)).toBe(-10 * MIN);
  });

  it('공백 꼴 server_now 도 같은 오프셋을 낸다', () => {
    expect(clockOffsetMs('2026-09-12 06:30:00+00', SERVER_NOW_MS - 5 * MIN)).toBe(5 * MIN);
  });

  it('server_now 가 없거나(옛 RPC) 못 읽으면 0 으로 접는다', () => {
    expect(clockOffsetMs(undefined, SERVER_NOW_MS)).toBe(0);
    expect(clockOffsetMs(null, SERVER_NOW_MS)).toBe(0);
    expect(clockOffsetMs('언젠가', SERVER_NOW_MS)).toBe(0);
  });
});

describe('remainingMs', () => {
  it('마감 − (내 시각 + 오프셋)', () => {
    const deadline = new Date(SERVER_NOW_MS + 6 * MIN).toISOString();
    expect(remainingMs(deadline, SERVER_NOW_MS, 0)).toBe(6 * MIN);
  });

  it('★ 기기 시계가 10분 틀려도 서버 기준 잔여는 그대로다 (V5b)', () => {
    const deadline = new Date(SERVER_NOW_MS + 6 * MIN).toISOString();
    for (const skewMs of [-10 * MIN, 0, 10 * MIN]) {
      const localNow = SERVER_NOW_MS + skewMs;
      const offset = clockOffsetMs(SERVER_NOW_ISO, localNow);
      expect(remainingMs(deadline, localNow, offset)).toBe(6 * MIN);
    }
  });

  it('마감이 없으면 null 이다', () => {
    expect(remainingMs(null, SERVER_NOW_MS, 0)).toBeNull();
    expect(remainingMs(undefined, SERVER_NOW_MS, 0)).toBeNull();
  });

  it('못 읽는 마감·못 읽는 시계는 null 이다 (NaN 을 밖으로 흘리지 않는다)', () => {
    expect(remainingMs('언젠가', SERVER_NOW_MS, 0)).toBeNull();
    expect(remainingMs(SERVER_NOW_ISO, Number.NaN, 0)).toBeNull();
    expect(remainingMs(SERVER_NOW_ISO, SERVER_NOW_MS, Number.NaN)).toBeNull();
  });

  it('마감이 지났으면 음수다', () => {
    const deadline = new Date(SERVER_NOW_MS - 90_000).toISOString();
    expect(remainingMs(deadline, SERVER_NOW_MS, 0)).toBe(-90_000);
  });
});

describe('countdownTier', () => {
  it('null·undefined 는 none 이다', () => {
    expect(countdownTier(null)).toBe('none');
    expect(countdownTier(undefined)).toBe('none');
  });

  it('5분 초과는 calm', () => {
    expect(countdownTier(NOTICE_THRESHOLD_MS + 1)).toBe('calm');
    expect(countdownTier(60 * MIN)).toBe('calm');
  });

  it('경계 — 정확히 5분은 notice(calm 이 아니다)', () => {
    expect(countdownTier(NOTICE_THRESHOLD_MS)).toBe('notice');
    expect(countdownTier(WARN_THRESHOLD_MS + 1)).toBe('notice');
  });

  it('경계 — 정확히 3분은 warn(notice 가 아니다)', () => {
    expect(countdownTier(WARN_THRESHOLD_MS)).toBe('warn');
    expect(countdownTier(1)).toBe('warn');
  });

  it('경계 — 정확히 0 은 over', () => {
    expect(countdownTier(0)).toBe('over');
    expect(countdownTier(-1)).toBe('over');
    expect(countdownTier(-60 * MIN)).toBe('over');
  });

  it('★ NaN·Infinity 는 over 가 아니라 none 이다', () => {
    // 가드가 없으면 NaN 이 모든 비교에 실패해 else 로 굴러 「마감되었습니다」가 뜬다.
    expect(countdownTier(Number.NaN)).toBe('none');
    expect(countdownTier(Number.POSITIVE_INFINITY)).toBe('none');
    expect(countdownTier(Number.NEGATIVE_INFINITY)).toBe('none');
  });
});

describe('pickBannerTopic', () => {
  const soon = new Date(SERVER_NOW_MS + 2 * MIN).toISOString();
  const later = new Date(SERVER_NOW_MS + 40 * MIN).toISOString();
  const past = new Date(SERVER_NOW_MS - 30 * MIN).toISOString();
  const longPast = new Date(SERVER_NOW_MS - 3 * 60 * MIN).toISOString();

  it('마감이 걸린 꼭지가 없으면 null 이다', () => {
    expect(pickBannerTopic([topic({ ordinal: 1 }), topic({ ordinal: 2 })], SERVER_NOW_MS, 0)).toBeNull();
    expect(pickBannerTopic([], SERVER_NOW_MS, 0)).toBeNull();
    expect(pickBannerTopic(null, SERVER_NOW_MS, 0)).toBeNull();
  });

  it('아직 안 지난 것 중 가장 가까운 것을 고른다', () => {
    const picked = pickBannerTopic(
      [
        topic({ ordinal: 1, deadline_at: later }),
        topic({ ordinal: 2, deadline_at: soon }),
        topic({ ordinal: 3 }),
      ],
      SERVER_NOW_MS,
      0,
    );
    expect(picked?.ordinal).toBe(2);
  });

  it('닫힌 꼭지는 마감이 걸려 있어도 고르지 않는다', () => {
    const picked = pickBannerTopic(
      [
        topic({ ordinal: 1, status: 'closed', deadline_at: soon }),
        topic({ ordinal: 2, deadline_at: later }),
      ],
      SERVER_NOW_MS,
      0,
    );
    expect(picked?.ordinal).toBe(2);
  });

  it('★ 이미 지난 꼭지가 아직 남은 꼭지를 이기지 않는다 (8.29 사고 방지)', () => {
    // 최솟값을 고르면 오전에 지난 꼭지①(−3시간)이 이겨 오후 내내 배너가 붙박인다.
    const picked = pickBannerTopic(
      [topic({ ordinal: 1, deadline_at: longPast }), topic({ ordinal: 2, deadline_at: later })],
      SERVER_NOW_MS,
      0,
    );
    expect(picked?.ordinal).toBe(2);
  });

  it('전부 지났으면 가장 최근에 지난 것을 고른다', () => {
    const picked = pickBannerTopic(
      [topic({ ordinal: 1, deadline_at: longPast }), topic({ ordinal: 2, deadline_at: past })],
      SERVER_NOW_MS,
      0,
    );
    expect(picked?.ordinal).toBe(2);
  });

  it('마감 시각이 같으면 ordinal 이 앞선 쪽이다', () => {
    const picked = pickBannerTopic(
      [topic({ ordinal: 3, deadline_at: soon }), topic({ ordinal: 2, deadline_at: soon })],
      SERVER_NOW_MS,
      0,
    );
    expect(picked?.ordinal).toBe(2);
  });

  it('정확히 마감 시각(잔여 0)은 「지난 것」으로 다룬다', () => {
    const exact = new Date(SERVER_NOW_MS).toISOString();
    const picked = pickBannerTopic(
      [topic({ ordinal: 1, deadline_at: exact }), topic({ ordinal: 2, deadline_at: soon })],
      SERVER_NOW_MS,
      0,
    );
    expect(picked?.ordinal).toBe(2);
  });

  it('오프셋을 태워 고른다 — 기기가 10분 빨라도 순서가 안 바뀐다', () => {
    const localNow = SERVER_NOW_MS + 10 * MIN;
    const offset = clockOffsetMs(SERVER_NOW_ISO, localNow);
    const picked = pickBannerTopic(
      [topic({ ordinal: 1, deadline_at: later }), topic({ ordinal: 2, deadline_at: soon })],
      localNow,
      offset,
    );
    expect(picked?.ordinal).toBe(2);
  });

  it('못 읽는 마감은 없는 것으로 본다', () => {
    const picked = pickBannerTopic(
      [topic({ ordinal: 1, deadline_at: '언젠가' }), topic({ ordinal: 2, deadline_at: later })],
      SERVER_NOW_MS,
      0,
    );
    expect(picked?.ordinal).toBe(2);
  });

  it('★ 인자로 받은 배열을 제자리에서 뒤섞지 않는다', () => {
    const topics = [
      topic({ ordinal: 1, deadline_at: later }),
      topic({ ordinal: 2, deadline_at: soon }),
    ];
    pickBannerTopic(topics, SERVER_NOW_MS, 0);
    expect(topics.map((t) => t.ordinal)).toEqual([1, 2]);
  });

  it('고른 꼭지를 통째로 돌려준다(배너가 제목을 써야 한다)', () => {
    const picked = pickBannerTopic([topic({ ordinal: 2, deadline_at: soon })], SERVER_NOW_MS, 0);
    expect(picked?.prompt).toBe('꼭지 2');
  });
});

describe('formatCountdown', () => {
  it('MM:SS 로 낸다', () => {
    expect(formatCountdown(6 * MIN + 12_000)).toBe('06:12');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(59 * MIN + 59_000)).toBe('59:59');
  });

  it('음수는 00:00 으로 clamp 한다(마감 뒤에는 문구를 낸다)', () => {
    expect(formatCountdown(-1)).toBe('00:00');
    expect(formatCountdown(-90_000)).toBe('00:00');
  });

  it('NaN 도 00:00 이다', () => {
    expect(formatCountdown(Number.NaN)).toBe('00:00');
  });
});

describe('bannerMessage', () => {
  it('none·calm 은 빈 문구다(배너가 잔여 시간만 낸다)', () => {
    expect(bannerMessage('none', false)).toBe('');
    expect(bannerMessage('none', true)).toBe('');
    expect(bannerMessage('calm', false)).toBe('');
    expect(bannerMessage('calm', true)).toBe('');
  });

  it('notice 는 순한 예고만 한다 — 미저장이어도 재촉하지 않는다', () => {
    expect(bannerMessage('notice', false)).toBe('곧 마감입니다.');
    expect(bannerMessage('notice', true)).toBe('곧 마감입니다.');
  });

  it('warn 은 「지금 저장하세요」를 낸다', () => {
    expect(bannerMessage('warn', false)).toContain('지금 저장하세요');
  });

  it('warn + 미저장이면 미저장 안내를 함께 낸다', () => {
    const msg = bannerMessage('warn', true);
    expect(msg).toContain('지금 저장하세요');
    expect(msg).toContain('저장하지 않은 내용이 있습니다');
  });

  it('over 는 「마감되었습니다」를 낸다', () => {
    expect(bannerMessage('over', false)).toBe('마감되었습니다.');
  });

  it('★ over + 미저장이면 그래도 저장을 권한다 — 마감은 잠금이 아니다', () => {
    const msg = bannerMessage('over', true);
    expect(msg).toContain('마감되었습니다');
    expect(msg).toContain('저장하지 않은 내용이 있습니다');
    expect(msg).toContain('지금이라도 저장하세요');
  });
});

describe('배선 시나리오 — 마감 1건이 calm→notice→warn→over 로 흐른다', () => {
  it('구간이 순서대로 바뀐다', () => {
    const deadline = new Date(SERVER_NOW_MS + 10 * MIN).toISOString();
    const at = (minutesLater: number) =>
      countdownTier(remainingMs(deadline, SERVER_NOW_MS + minutesLater * MIN, 0));

    expect(at(0)).toBe('calm'); // 10분 남음
    expect(at(4)).toBe('calm'); // 6분 남음
    expect(at(5)).toBe('notice'); // 정확히 5분
    expect(at(6)).toBe('notice'); // 4분
    expect(at(7)).toBe('warn'); // 정확히 3분
    expect(at(9.5)).toBe('warn'); // 30초
    expect(at(10)).toBe('over'); // 정확히 마감
    expect(at(12)).toBe('over');
  });
});

describe('bannerView — 배너 한 벌 조립 (US-010 이 그리는 값 그대로)', () => {
  /** `id` 가 붙은 꼭지. 미저장 결합이 id 로 이뤄지므로 여기서만 필요하다. */
  const withId = (id: string, ordinal: number, deadline_at: string | null, status: 'open' | 'closed' = 'open') => ({
    id,
    ordinal,
    status,
    deadline_at,
    prompt: `꼭지 ${ordinal}`,
  });

  const iso = (msFromServerNow: number) => new Date(SERVER_NOW_MS + msFromServerNow).toISOString();

  it('마감이 하나도 없으면 null — 빈 껍데기를 그리지 않는다', () => {
    const topics = [withId('a', 1, null), withId('b', 2, undefined as unknown as null)];
    expect(bannerView(topics, SERVER_NOW_MS, 0, [])).toBeNull();
  });

  it('꼭지 목록이 없거나 비어도 null 이다', () => {
    expect(bannerView(null, SERVER_NOW_MS, 0, [])).toBeNull();
    expect(bannerView([], SERVER_NOW_MS, 0, [])).toBeNull();
  });

  it('가장 임박한 열린 꼭지 하나를 고르고 구간·잔여·문구를 함께 낸다', () => {
    const topics = [withId('a', 1, iso(20 * MIN)), withId('b', 2, iso(4 * MIN))];
    const view = bannerView(topics, SERVER_NOW_MS, 0, []);
    expect(view?.topic.id).toBe('b');
    expect(view?.tier).toBe('notice');
    expect(view?.remainingMs).toBe(4 * MIN);
    expect(view?.countdown).toBe('04:00');
    expect(view?.message).toBe('곧 마감입니다.');
    expect(view?.hasUnsaved).toBe(false);
  });

  it('★ 미저장은 배너가 고른 그 꼭지만 본다 — 다른 꼭지의 미저장은 안 끌어온다', () => {
    const topics = [withId('a', 1, iso(20 * MIN)), withId('b', 2, iso(2 * MIN))];
    const view = bannerView(topics, SERVER_NOW_MS, 0, ['a']);
    expect(view?.topic.id).toBe('b');
    expect(view?.hasUnsaved).toBe(false);
    expect(view?.message).toBe('지금 저장하세요.');
  });

  it('그 꼭지가 미저장이면 warn 문구에 저장 안내가 붙는다', () => {
    const topics = [withId('b', 2, iso(2 * MIN))];
    const view = bannerView(topics, SERVER_NOW_MS, 0, ['b', 'c']);
    expect(view?.hasUnsaved).toBe(true);
    expect(view?.message).toContain('저장하지 않은 내용이 있습니다');
  });

  it('calm 구간은 미저장이어도 문구가 비어 있다 — 여유 있을 때 외치지 않는다', () => {
    const topics = [withId('b', 2, iso(30 * MIN))];
    const view = bannerView(topics, SERVER_NOW_MS, 0, ['b']);
    expect(view?.tier).toBe('calm');
    expect(view?.message).toBe('');
    expect(view?.hasUnsaved).toBe(true);
  });

  it('마감이 지나면 over · 잔여는 음수이지만 표시는 00:00 이다', () => {
    const topics = [withId('b', 2, iso(-90_000))];
    const view = bannerView(topics, SERVER_NOW_MS, 0, []);
    expect(view?.tier).toBe('over');
    expect(view?.remainingMs).toBeLessThan(0);
    expect(view?.countdown).toBe('00:00');
    expect(view?.message).toBe('마감되었습니다.');
  });

  it('닫힌 꼭지의 마감은 배너에 오르지 않는다', () => {
    const topics = [withId('a', 1, iso(2 * MIN), 'closed')];
    expect(bannerView(topics, SERVER_NOW_MS, 0, [])).toBeNull();
  });

  it('★ 서버 오프셋을 태운다 — 기기 시계가 10분 빨라도 잔여가 같다', () => {
    const deadline = iso(6 * MIN);
    const localNow = SERVER_NOW_MS + 10 * MIN; // 기기가 10분 빠름
    const offset = clockOffsetMs(SERVER_NOW_ISO, localNow); // = -10분
    const view = bannerView([withId('a', 1, deadline)], localNow, offset, []);
    expect(view?.remainingMs).toBe(6 * MIN);
    expect(view?.tier).toBe('calm');
  });

  it('★ 못 읽는 마감 시각은 배너를 안 그린다 — NaN 이 빨간 「마감되었습니다」로 둔갑하지 않는다', () => {
    expect(bannerView([withId('a', 1, '언젠가')], SERVER_NOW_MS, 0, [])).toBeNull();
  });

  it('미저장 목록을 안 주거나 null 이어도 죽지 않는다', () => {
    const topics = [withId('b', 2, iso(2 * MIN))];
    expect(bannerView(topics, SERVER_NOW_MS, 0)?.hasUnsaved).toBe(false);
    expect(bannerView(topics, SERVER_NOW_MS, 0, null)?.hasUnsaved).toBe(false);
  });
});
