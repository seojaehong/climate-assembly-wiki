import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  answeredCount,
  getLocalSubmit,
  isComplete,
  isLocalSubmitStoragePersistent,
  parseBallotUrl,
  recordLocalSubmit,
  refreshNoticeMessage,
  resolveBallotScreen,
  scaleLabels,
  subgroupVoteBadge,
} from './ballot-logic';
import type { Ballot, BallotItem } from '../../lib/ballot';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BALLOT_EVIDENCE_BOUNDARY,
  ballotResponseCountLabel,
  LoadErrorScreen,
} from './BallotCard';

function item(over: Partial<BallotItem> = {}): BallotItem {
  return {
    id: 'i1',
    ordinal: 1,
    statement: '재생에너지 확대에 동의하십니까?',
    description: null,
    scale: 5,
    required: true,
    ...over,
  };
}

const openBallot: Ballot = {
  id: 'b1',
  title: '8/29 폐회 일괄투표',
  instructions: null,
  status: 'open',
  items: [item()],
};

describe('subgroupVoteBadge — /b 헤더 분과 뱃지(S4)', () => {
  it('분과 한정 의견조사면 「N분과 의견조사」', () => {
    expect(subgroupVoteBadge('1분과')).toBe('1분과 의견조사');
    expect(subgroupVoteBadge(' 2분과 ')).toBe('2분과 의견조사');
  });

  it('전체 투표(null)·S4 미적용 DB(키 없음=undefined)는 null — 표시 없음', () => {
    expect(subgroupVoteBadge(null)).toBeNull();
    expect(subgroupVoteBadge(undefined)).toBeNull();
    expect(subgroupVoteBadge('')).toBeNull();
    // openBallot에는 subgroup 키가 없다 — 미적용 DB 응답 형태 그대로 안전해야 한다.
    expect(subgroupVoteBadge(openBallot.subgroup)).toBeNull();
  });
});

describe('parseBallotUrl', () => {
  it('?t=<token> 파싱', () => {
    expect(parseBallotUrl('?t=0123456789abcdef0123456789abcdef')).toEqual({
      token: '0123456789abcdef0123456789abcdef',
    });
  });
  it('t 파라미터 없으면 null', () => {
    expect(parseBallotUrl('')).toBeNull();
    expect(parseBallotUrl('?x=1')).toBeNull();
  });
  it('t가 공백뿐이면 null', () => {
    expect(parseBallotUrl('?t=%20%20')).toBeNull();
  });
  it('다른 파라미터와 함께 있어도 파싱 + 앞뒤 공백 제거', () => {
    expect(parseBallotUrl('?x=1&t=%20abc%20&y=2')).toEqual({ token: 'abc' });
  });
});

describe('scaleLabels', () => {
  it('scale 2 → 반대/찬성', () => {
    expect(scaleLabels(2)).toEqual(['반대', '찬성']);
  });
  it('scale 4 → 동의 4단계(보통 없음)', () => {
    const labels = scaleLabels(4);
    expect(labels).toHaveLength(4);
    expect(labels).not.toContain('보통입니다');
  });
  it('scale 5 → 5단계(보통 포함)', () => {
    const labels = scaleLabels(5);
    expect(labels).toHaveLength(5);
    expect(labels[2]).toBe('보통입니다');
  });
  it('scale 7 → 7단계(보통 포함, 중앙)', () => {
    const labels = scaleLabels(7);
    expect(labels).toHaveLength(7);
    expect(labels[3]).toBe('보통입니다');
  });
  it('라벨은 척도 안에서 중복이 없다', () => {
    for (const scale of [2, 4, 5, 7]) {
      const labels = scaleLabels(scale);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
  it('스키마 외 값은 숫자 라벨 폴백', () => {
    expect(scaleLabels(3)).toEqual(['1', '2', '3']);
  });
});

describe('answeredCount / isComplete — 답변 완결성', () => {
  const items = [
    item({ id: 'a', ordinal: 1, scale: 5, required: true }),
    item({ id: 'b', ordinal: 2, scale: 2, required: true }),
    item({ id: 'c', ordinal: 3, scale: 7, required: false }),
  ];

  it('빈 답변 → 0개, 미완결', () => {
    expect(answeredCount(items, {})).toBe(0);
    expect(isComplete(items, {})).toBe(false);
  });
  it('required 일부만 응답 → 미완결', () => {
    expect(isComplete(items, { a: 3 })).toBe(false);
    expect(answeredCount(items, { a: 3 })).toBe(1);
  });
  it('required 전부 응답 → 완결 (optional 미응답이어도)', () => {
    expect(isComplete(items, { a: 3, b: 1 })).toBe(true);
    expect(answeredCount(items, { a: 3, b: 1 })).toBe(2);
  });
  it('optional까지 응답 → 3개 응답', () => {
    expect(answeredCount(items, { a: 3, b: 1, c: 7 })).toBe(3);
  });
  it('척도 범위 밖 값은 답변으로 치지 않는다', () => {
    expect(isComplete(items, { a: 6, b: 1 })).toBe(false); // scale 5인데 6
    expect(isComplete(items, { a: 0, b: 1 })).toBe(false);
    expect(answeredCount(items, { a: 6, b: 3 })).toBe(0); // b도 scale 2인데 3
  });
  it('정수가 아닌 값은 답변으로 치지 않는다', () => {
    expect(isComplete(items, { a: 2.5, b: 1 })).toBe(false);
  });
  it('다른 문항 id의 답은 무시한다', () => {
    expect(answeredCount(items, { zzz: 1 })).toBe(0);
  });
});

describe('로컬 제출 기록 (localStorage cv_ballot_<id>)', () => {
  const store = new Map<string, string>();
  const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = originalLocalStorage;
  });

  it('기록 전에는 null', () => {
    expect(getLocalSubmit('b1')).toBeNull();
  });
  it('기록하면 ISO 시각이 저장되고 키는 ballot별로 분리된다', () => {
    const now = new Date('2026-08-29T15:00:00.000Z');
    recordLocalSubmit('b1', now);
    expect(getLocalSubmit('b1')).toBe('2026-08-29T15:00:00.000Z');
    expect(store.has('cv_ballot_b1')).toBe(true);
    expect(getLocalSubmit('b2')).toBeNull();
  });

  it('저장소 접근이 차단돼도 메모리 폴백으로 제출 흐름을 유지한다', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
      setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    };
    const now = new Date('2026-09-12T01:02:03.000Z');

    expect(() => recordLocalSubmit('blocked-storage-ballot', now)).not.toThrow();
    expect(getLocalSubmit('blocked-storage-ballot')).toBe(now.toISOString());
    expect(isLocalSubmitStoragePersistent()).toBe(false);
  });
});

describe('resolveBallotScreen — 화면 상태 전이', () => {
  it('토큰 없음 → invalid', () => {
    expect(resolveBallotScreen({ hasToken: false, ballot: undefined, submitted: false })).toBe('invalid');
  });
  it('로딩 중(undefined) → loading', () => {
    expect(resolveBallotScreen({ hasToken: true, ballot: undefined, submitted: false })).toBe('loading');
  });
  it('없거나 비공개(null) → invalid', () => {
    expect(resolveBallotScreen({ hasToken: true, ballot: null, submitted: false })).toBe('invalid');
  });
  it('open + 미제출 → active', () => {
    expect(resolveBallotScreen({ hasToken: true, ballot: openBallot, submitted: false })).toBe('active');
  });
  it('open + 제출됨 → done', () => {
    expect(resolveBallotScreen({ hasToken: true, ballot: openBallot, submitted: true })).toBe('done');
  });
  it('closed → closed (제출 여부 무관)', () => {
    const closed = { ...openBallot, status: 'closed' as const };
    expect(resolveBallotScreen({ hasToken: true, ballot: closed, submitted: false })).toBe('closed');
    expect(resolveBallotScreen({ hasToken: true, ballot: closed, submitted: true })).toBe('closed');
  });
  it('published → published (제출 여부 무관)', () => {
    const published = { ...openBallot, status: 'published' as const };
    expect(resolveBallotScreen({ hasToken: true, ballot: published, submitted: false })).toBe('published');
    expect(resolveBallotScreen({ hasToken: true, ballot: published, submitted: true })).toBe('published');
  });
});

describe('refreshNoticeMessage', () => {
  it('open이면 진행 중 안내', () => {
    expect(refreshNoticeMessage(openBallot)).toBe('아직 투표가 진행 중입니다. 마감 후 다시 확인해 주세요.');
  });
  it('closed/published면 null (화면 전환이 담당)', () => {
    expect(refreshNoticeMessage({ ...openBallot, status: 'closed' })).toBeNull();
    expect(refreshNoticeMessage({ ...openBallot, status: 'published' })).toBeNull();
  });
});

describe('BallotCard load failure UX', () => {
  it('shows a retry action instead of mislabelling a network failure as an invalid QR', () => {
    const html = renderToStaticMarkup(createElement(LoadErrorScreen, {
      title: '투표 화면에 연결하지 못했습니다',
      body: '네트워크를 확인하고 다시 시도해 주세요.',
      onRetry: () => undefined,
      retrying: false,
    }));

    expect(html).toContain('투표 화면에 연결하지 못했습니다');
    expect(html).toContain('다시 불러오기');
    expect(html).not.toContain('QR을 다시 스캔');
  });

  it('announces retry progress and disables duplicate retry clicks', () => {
    const html = renderToStaticMarkup(createElement(LoadErrorScreen, {
      title: '공개 결과에 연결하지 못했습니다',
      body: '네트워크를 확인하고 다시 시도해 주세요.',
      onRetry: () => undefined,
      retrying: true,
    }));

    expect(html).toContain('disabled=""');
    expect(html).toContain('다시 불러오는 중…');
  });
});

describe('공개 ballot 증거 경계', () => {
  it('기기 단위 비구속 의견조사임을 명시하고 사람 수로 오인시키지 않는다', () => {
    expect(BALLOT_EVIDENCE_BOUNDARY).toContain('기기 식별값');
    expect(BALLOT_EVIDENCE_BOUNDARY).toContain('비구속 현장 의견조사');
    expect(BALLOT_EVIDENCE_BOUNDARY).toContain('공식 의사결정');
    expect(ballotResponseCountLabel(3)).toBe('기기 응답 3건');
  });
});
