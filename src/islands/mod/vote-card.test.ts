import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseVoteUrl, nextCastState, refreshStatusMessage, resolveVoteScreen } from './vote-card-logic';
import { VotedScreen } from './VoteCard';
import type { Round } from '../../lib/mod-console';

const activeRound: Round = {
  id: 'r1',
  title: '가장 중요한 의제는?',
  type: 'RADIO',
  options: ['A', 'B'],
  status: 'active',
  team_id: 't1',
};

describe('parseVoteUrl', () => {
  it('?r=<id> 파싱', () => {
    expect(parseVoteUrl('?r=abc-123')).toEqual({ roundId: 'abc-123' });
  });
  it('r 파라미터 없으면 null', () => {
    expect(parseVoteUrl('')).toBeNull();
    expect(parseVoteUrl('?x=1')).toBeNull();
  });
  it('r이 공백뿐이면 null', () => {
    expect(parseVoteUrl('?r=%20%20')).toBeNull();
  });
  it('다른 파라미터와 함께 있어도 파싱', () => {
    expect(parseVoteUrl('?x=1&r=abc&y=2')).toEqual({ roundId: 'abc' });
  });
});

describe('nextCastState — idle → voted → duplicate → closed 전이', () => {
  it('ok 결과 → voted', () => {
    expect(nextCastState('ok')).toBe('voted');
  });
  it('duplicate 결과 → duplicate', () => {
    expect(nextCastState('duplicate')).toBe('duplicate');
  });
  it('closed 결과 → closed', () => {
    expect(nextCastState('closed')).toBe('closed');
  });
});

describe('resolveVoteScreen', () => {
  it('roundId 없음 → invalid', () => {
    expect(resolveVoteScreen({ hasRoundId: false, round: undefined, castState: 'idle' })).toBe('invalid');
  });
  it('round 로딩 중(undefined) → loading', () => {
    expect(resolveVoteScreen({ hasRoundId: true, round: undefined, castState: 'idle' })).toBe('loading');
  });
  it('round 없음(null) → invalid', () => {
    expect(resolveVoteScreen({ hasRoundId: true, round: null, castState: 'idle' })).toBe('invalid');
  });
  it('round pending → pending', () => {
    const round = { ...activeRound, status: 'pending' as const };
    expect(resolveVoteScreen({ hasRoundId: true, round, castState: 'idle' })).toBe('pending');
  });
  it('round active + idle → active', () => {
    expect(resolveVoteScreen({ hasRoundId: true, round: activeRound, castState: 'idle' })).toBe('active');
  });
  it('round active + voted → voted', () => {
    expect(resolveVoteScreen({ hasRoundId: true, round: activeRound, castState: 'voted' })).toBe('voted');
  });
  it('round active + duplicate → duplicate', () => {
    expect(resolveVoteScreen({ hasRoundId: true, round: activeRound, castState: 'duplicate' })).toBe('duplicate');
  });
  it('round closed → closed (voted 상태여도 closed 우선)', () => {
    const round = { ...activeRound, status: 'closed' as const };
    expect(resolveVoteScreen({ hasRoundId: true, round, castState: 'voted' })).toBe('closed');
  });
  it('castState closed → closed (round가 아직 갱신 전 active여도)', () => {
    expect(resolveVoteScreen({ hasRoundId: true, round: activeRound, castState: 'closed' })).toBe('closed');
  });
});

describe('refreshStatusMessage', () => {
  it('진행 중이면 결과가 아직 공개되지 않았음을 안내한다', () => {
    expect(refreshStatusMessage(activeRound)).toBe('아직 투표가 진행 중입니다. 마감 후 다시 확인해 주세요.');
  });

  it('마감됐으면 별도 대기 안내를 표시하지 않는다', () => {
    expect(refreshStatusMessage({ ...activeRound, status: 'closed' })).toBeNull();
  });
});

describe('VotedScreen participant copy', () => {
  it('제출 완료와 마감 후 결과 공개를 서로 다른 단계로 안내한다', () => {
    const html = renderToStaticMarkup(
      createElement(VotedScreen, {
        onRefresh: () => undefined,
        refreshing: false,
        refreshNotice: null,
      }),
    );

    expect(html).toContain('투표가 제출되었습니다');
    expect(html).toContain('투표 제출 완료');
    expect(html).toContain('투표 마감 후 결과 공개');
    expect(html).toContain('투표 마감 여부 확인');
    expect(html).not.toContain('결과 보기');
    expect(html).toContain('aria-live="polite"');
  });

  it('마감 확인 중에는 버튼을 비활성화하고 진행 상태를 표시한다', () => {
    const html = renderToStaticMarkup(
      createElement(VotedScreen, {
        onRefresh: () => undefined,
        refreshing: true,
        refreshNotice: '아직 투표가 진행 중입니다. 마감 후 다시 확인해 주세요.',
      }),
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('마감 여부 확인 중…');
    expect(html).toContain('아직 투표가 진행 중입니다.');
  });
});
