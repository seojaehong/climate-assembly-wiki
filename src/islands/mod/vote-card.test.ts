import { describe, it, expect } from 'vitest';
import { parseVoteUrl, nextCastState, resolveVoteScreen } from './vote-card-logic';
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

describe('nextCastState — idle → voted → duplicate 전이', () => {
  it('ok 결과 → voted', () => {
    expect(nextCastState('ok')).toBe('voted');
  });
  it('duplicate 결과 → duplicate', () => {
    expect(nextCastState('duplicate')).toBe('duplicate');
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
});
