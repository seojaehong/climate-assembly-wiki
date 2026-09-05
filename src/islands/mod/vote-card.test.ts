import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  normalizeTextVoteChoice,
  parseVoteUrl,
  nextCastState,
  refreshStatusMessage,
  resolveLatestRoundSnapshot,
  resolveVoteScreen,
  TEXT_VOTE_MAX_LENGTH,
} from './vote-card-logic';
import {
  createResourceRequestCoordinator,
  type ResourceRequestPriority,
} from './resource-request-coordinator';
import { ActiveScreen, ClosedScreen, VotedScreen } from './VoteCard';
import type { Round } from '../../lib/mod-console';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

describe('resolveLatestRoundSnapshot', () => {
  it('keeps one slow background poll current instead of starving it on every interval tick', async () => {
    const coordinator = createResourceRequestCoordinator();
    const slow = deferred<Round>();
    let current: Round | null | undefined;
    let requestCount = 0;
    const run = async (promise: Promise<Round>, priority: ResourceRequestPriority): Promise<boolean> => {
      const ticket = coordinator.begin('round:r1', priority);
      if (!ticket) return false;
      requestCount += 1;
      try {
        const incoming = await promise;
        if (!coordinator.isCurrent(ticket)) return false;
        const resolution = resolveLatestRoundSnapshot(
          current,
          incoming,
          ticket.sequence,
          coordinator.currentSequence(),
        );
        if (resolution.applied) current = resolution.round;
        return resolution.applied;
      } finally {
        coordinator.finish(ticket);
      }
    };

    const firstTick = run(slow.promise, 'background');
    await expect(run(Promise.resolve(activeRound), 'background')).resolves.toBe(false);
    expect(requestCount).toBe(1);

    slow.resolve(activeRound);
    await expect(firstTick).resolves.toBe(true);
    expect(current?.status).toBe('active');
  });

  it('lets a manual refresh supersede a slow background poll without a late overwrite', async () => {
    const coordinator = createResourceRequestCoordinator();
    const background = deferred<Round>();
    const manual = deferred<Round>();
    let current: Round | null | undefined;
    const run = async (promise: Promise<Round>, priority: ResourceRequestPriority): Promise<void> => {
      const ticket = coordinator.begin('round:r1', priority);
      if (!ticket) return;
      try {
        const incoming = await promise;
        if (!coordinator.isCurrent(ticket)) return;
        const resolution = resolveLatestRoundSnapshot(
          current,
          incoming,
          ticket.sequence,
          coordinator.currentSequence(),
        );
        if (resolution.applied) current = resolution.round;
      } finally {
        coordinator.finish(ticket);
      }
    };

    const oldPoll = run(background.promise, 'background');
    const manualRefresh = run(manual.promise, 'manual');
    manual.resolve({ ...activeRound, status: 'closed' });
    await manualRefresh;
    background.resolve(activeRound);
    await oldPoll;

    expect(current?.status).toBe('closed');
  });

  it('ignores an older pending response that resolves after a newer active response', async () => {
    let releaseOlder: ((round: Round) => void) | undefined;
    let releaseNewer: ((round: Round) => void) | undefined;
    const older = new Promise<Round>((resolve) => { releaseOlder = resolve; });
    const newer = new Promise<Round>((resolve) => { releaseNewer = resolve; });
    let latestSequence = 0;
    let current: Round | null | undefined;
    const apply = async (promise: Promise<Round>): Promise<void> => {
      const requestSequence = latestSequence + 1;
      latestSequence = requestSequence;
      const incoming = await promise;
      const resolution = resolveLatestRoundSnapshot(current, incoming, requestSequence, latestSequence);
      if (resolution.applied) current = resolution.round;
    };

    const olderLoad = apply(older);
    const newerLoad = apply(newer);
    releaseNewer?.(activeRound);
    await newerLoad;
    releaseOlder?.({ ...activeRound, status: 'pending' });
    await olderLoad;

    expect(current?.status).toBe('active');
  });

  it('never downgrades a closed snapshot to active or pending', () => {
    const closed = { ...activeRound, status: 'closed' as const };
    const activeResult = resolveLatestRoundSnapshot(closed, activeRound, 2, 2);
    const pendingResult = resolveLatestRoundSnapshot(
      activeResult.round,
      { ...activeRound, status: 'pending' },
      3,
      3,
    );

    expect(activeResult.round?.status).toBe('closed');
    expect(pendingResult.round?.status).toBe('closed');
  });
});

describe('refreshStatusMessage', () => {
  it('진행 중이면 결과가 아직 공개되지 않았음을 안내한다', () => {
    expect(refreshStatusMessage(activeRound)).toBe('아직 투표가 진행 중입니다. 마감 후 다시 확인해 주세요.');
  });
  it('Canvas ?round=<id>도 파싱', () => {
    expect(parseVoteUrl('?round=AGV-abc-123')).toEqual({ roundId: 'AGV-abc-123' });
  });

  it('마감됐으면 별도 대기 안내를 표시하지 않는다', () => {
    expect(refreshStatusMessage({ ...activeRound, status: 'closed' })).toBeNull();
  });
  it('대기 중이면 자동 재확인 중임을 안내한다', () => {
    expect(refreshStatusMessage({ ...activeRound, status: 'pending' })).toContain('투표 시작 전');
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

describe('Canvas SCALE_MULTI participant UI', () => {
  const scaleRound: Round = {
    id: 'AGV-0123456789abcdef0123456789abcdef',
    title: '의제 평가 투표',
    description: '각 의제의 중요도를 평가해 주세요.',
    type: 'SCALE_MULTI',
    options: ['의제 A', '의제 B'],
    status: 'active',
    team_id: null,
    scale_low: 1,
    scale_high: 5,
    scale_low_label: '낮음',
    scale_high_label: '높음',
  };

  it('각 의제의 1-5점 입력과 전체 제출 버튼을 제공한다', () => {
    const html = renderToStaticMarkup(createElement(ActiveScreen, {
      round: scaleRound,
      onSubmit: () => undefined,
      submitting: false,
      error: null,
    }));
    expect(html).toContain('aria-label="의제 A 1점"');
    expect(html).toContain('aria-label="의제 B 5점"');
    expect(html).toContain('투표하기');
    expect(html).toContain('disabled=""');
  });

  it('개별 응답 대신 서버 집계 평균을 표시한다', () => {
    const html = renderToStaticMarkup(createElement(ClosedScreen, {
      round: { ...scaleRound, status: 'closed' },
      tally: {
        total: 3,
        byOption: { '의제 A': 3, '의제 B': 3 },
        averageByOption: { '의제 A': 4.33, '의제 B': 2.67 },
      },
      resultError: null,
      resultLoading: false,
      onRetry: () => undefined,
      lastSuccessAt: null,
    }));
    expect(html).toContain('응답 3명');
    expect(html).toContain('4.33점');
    expect(html).toContain('2.67점');
    expect(html.indexOf('의제 A')).toBeLessThan(html.indexOf('의제 B'));
    expect(html).toContain('비구속 현장 조사 결과');
  });

  it('첫 집계 성공 전에는 0표를 확정 결과처럼 렌더하지 않는다', () => {
    const html = renderToStaticMarkup(createElement(ClosedScreen, {
      round: { ...scaleRound, status: 'closed' },
      tally: null,
      resultError: null,
      resultLoading: true,
      onRetry: () => undefined,
      lastSuccessAt: null,
    }));
    expect(html).toContain('마감 집계를 불러오는 중');
    expect(html).not.toContain('응답 0명');
    expect(html).not.toContain('0.00점');
  });

  it('집계 재조회 실패 시 마지막 성공 시각과 재시도를 표시한다', () => {
    const html = renderToStaticMarkup(createElement(ClosedScreen, {
      round: { ...scaleRound, status: 'closed' },
      tally: { total: 2, byOption: {}, averageByOption: { '의제 A': 4, '의제 B': 4 } },
      resultError: '결과를 불러오지 못했습니다.',
      resultLoading: false,
      onRetry: () => undefined,
      lastSuccessAt: new Date('2026-09-05T01:02:03Z').getTime(),
    }));
    expect(html).toContain('마지막 집계');
    expect(html).toContain('결과 다시 불러오기');
    expect((html.match(/🏆/g) ?? []).length).toBe(2);
  });
});

describe('TEXT participant UI', () => {
  const textRound: Round = {
    id: 'text-round-1',
    title: '추가로 남기고 싶은 의견은?',
    description: '핵심 내용을 자유롭게 적어 주세요.',
    type: 'TEXT',
    options: null,
    status: 'active',
    team_id: null,
  };

  it('앞뒤 공백을 제거하고 공백뿐인 값과 2,000자 초과 값을 거부한다', () => {
    expect(normalizeTextVoteChoice('  현장 의견입니다.  ')).toBe('현장 의견입니다.');
    expect(normalizeTextVoteChoice(' \n\t ')).toBeNull();
    expect(normalizeTextVoteChoice('가'.repeat(TEXT_VOTE_MAX_LENGTH))).toHaveLength(TEXT_VOTE_MAX_LENGTH);
    expect(normalizeTextVoteChoice('가'.repeat(TEXT_VOTE_MAX_LENGTH + 1))).toBeNull();
  });

  it('접근 가능한 자유서술 입력과 비어 있을 때 비활성화된 명시 제출 버튼을 제공한다', () => {
    const html = renderToStaticMarkup(createElement(ActiveScreen, {
      round: textRound,
      onSubmit: () => undefined,
      submitting: false,
      error: null,
    }));

    expect(html).toContain('<textarea');
    expect(html).toContain('id="participant-text-choice-text-round-1"');
    expect(html).toContain('for="participant-text-choice-text-round-1"');
    expect(html).toContain(`maxLength="${TEXT_VOTE_MAX_LENGTH}"`);
    expect(html).toContain('required=""');
    expect(html).toContain('aria-describedby="participant-text-choice-text-round-1-help participant-text-choice-text-round-1-count"');
    expect(html).toContain('공백만 입력한 의견은 제출할 수 없습니다.');
    expect(html).toContain('의견 제출하기');
    expect(html).toContain('disabled=""');
  });

  it('마감 화면에는 자유서술 원문을 노출하지 않고 기기 응답 건수만 표시한다', () => {
    const privateResponse = '공개되면 안 되는 자유서술 원문';
    const html = renderToStaticMarkup(createElement(ClosedScreen, {
      round: { ...textRound, options: [privateResponse], status: 'closed' },
      tally: {
        total: 1,
        byOption: { [privateResponse]: 1 },
        averageByOption: {},
      },
      resultError: null,
      resultLoading: false,
      onRetry: () => undefined,
      lastSuccessAt: null,
    }));

    expect(html).toContain('기기 응답 1건');
    expect(html).toContain('자유서술 원문은 공개 결과 화면에 표시하지 않습니다.');
    expect(html).not.toContain(privateResponse);
  });
});
