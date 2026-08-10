import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { BallotListRow, BallotResults } from '../../../lib/deliberation';
import type { PlatformResult } from '../../../lib/platform';
import {
  default as VoteConsole,
  VoteResults,
  completeVoteLoad,
  loadSessionVotes,
  type VoteDataAdapter,
} from './VoteConsole';
import { buildVoteView } from './vote-console-logic';

const row: BallotListRow = {
  id: 'ballot-1',
  title: '에너지 정책 우선순위',
  status: 'published',
  token: 'token-1',
  subgroup: '2분과',
  item_count: 1,
  response_count: 12,
  created_at: '2026-08-11T00:00:00Z',
};

const result: BallotResults = {
  id: 'ballot-1',
  title: '에너지 정책 우선순위',
  status: 'published',
  subgroup: '2분과',
  responses: 12,
  items: [
    {
      id: 'item-1',
      ordinal: 1,
      statement: '재생에너지 투자를 확대한다.',
      scale: 5,
      n: 10,
      avg: 4.25,
      dist: { '2': 1, '3': 2, '5': 7 },
    },
  ],
};

function adapter(overrides: Partial<VoteDataAdapter> = {}): VoteDataAdapter {
  return {
    validateTopic: vi.fn(async (): Promise<PlatformResult<unknown>> => ({ data: {}, notice: null })),
    listBallots: vi.fn(async (): Promise<PlatformResult<BallotListRow[]>> => ({ data: [row], notice: null })),
    loadResults: vi.fn(async (): Promise<PlatformResult<BallotResults | null>> => ({ data: result, notice: null })),
    ...overrides,
  };
}

describe('loadSessionVotes', () => {
  it('선택 회차의 주제로 코드를 검증한 뒤 목록과 전체 집계를 불러온다', async () => {
    const data = adapter();
    const loaded = await loadSessionVotes('team-code', [{ id: 'topic-1', label: '에너지 전환' }], data);

    expect(data.validateTopic).toHaveBeenCalledWith('team-code', 'topic-1');
    expect(data.listBallots).toHaveBeenCalledWith('team-code');
    expect(data.loadResults).toHaveBeenCalledWith('token-1', 'team-code');
    expect(loaded.notice).toBeNull();
    expect(loaded.data?.stats).toEqual({ ballotCount: 1, openCount: 0, itemCount: 1, responseCount: 12 });
  });

  it('다른 회차 코드면 투표 목록을 노출하지 않는다', async () => {
    const data = adapter({
      validateTopic: vi.fn(async () => ({ data: null, notice: 'topic does not belong to team session' })),
    });
    const loaded = await loadSessionVotes('wrong-code', [{ id: 'topic-1', label: '에너지 전환' }], data);

    expect(loaded).toEqual({ data: null, notice: '선택 회차 검증 실패: topic does not belong to team session' });
    expect(data.listBallots).not.toHaveBeenCalled();
  });

  it('한 투표의 집계라도 실패하면 불완전한 회차 집계를 노출하지 않는다', async () => {
    const data = adapter({
      loadResults: vi.fn(async () => ({ data: null, notice: '집계 조회 실패' })),
    });
    const loaded = await loadSessionVotes('team-code', [{ id: 'topic-1', label: '에너지 전환' }], data);

    expect(loaded).toEqual({ data: null, notice: '에너지 정책 우선순위: 집계 조회 실패' });
  });
});

describe('VoteResults', () => {
  it('회차 요약과 문항별 표 대체본을 접근 가능한 표로 제공한다', () => {
    const html = renderToStaticMarkup(createElement(VoteResults, { view: buildVoteView([row], [result]) }));

    expect(html).toContain('투표 1건');
    expect(html).toContain('제출 합계 12건');
    expect(html).toContain('에너지 정책 우선순위');
    expect(html).toContain('결과 공개됨');
    expect(html).toContain('2분과 한정');
    expect(html).toContain('재생에너지 투자를 확대한다.');
    expect(html).toContain('평균 4.25');
    expect(html).toContain('1점 0명');
    expect(html).toContain('4점 0명');
    expect(html).toContain('5점 7명');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');

    const overallHtml = renderToStaticMarkup(createElement(VoteResults, {
      view: buildVoteView([{ ...row, subgroup: null }], [{ ...result, subgroup: null }]),
    }));
    expect(overallHtml).toContain('>전체<');
  });

  it('등록 투표가 없어도 0건 요약과 빈 상태를 함께 제공한다', () => {
    const html = renderToStaticMarkup(createElement(VoteResults, { view: buildVoteView([], []) }));

    expect(html).toContain('aria-label="투표 0건"');
    expect(html).toContain('이 회차에 등록된 투표가 없습니다.');
    expect(html).not.toContain('<table');
  });
});

describe('VoteConsole', () => {
  it('회차 검증용 비영구 참여 코드 입력을 제공한다', () => {
    const html = renderToStaticMarkup(createElement(VoteConsole, {
      topics: [{ id: 'topic-1', label: '에너지 전환' }],
    }));

    expect(html).toContain('aria-label="회차 투표 불러오기"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('브라우저 저장소에 보관하지 않습니다.');
    expect(html).toContain('border:2px solid #6B7D88');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
  });
});

describe('completeVoteLoad', () => {
  it('stale 응답은 화면 상태와 busy를 바꾸지 않는다', async () => {
    const setBusy = vi.fn();
    const setView = vi.fn();
    const setNotice = vi.fn();

    await completeVoteLoad(
      async () => ({ data: buildVoteView([row], [result]), notice: null }),
      () => false,
      setBusy,
      setView,
      setNotice,
    );

    expect(setBusy).toHaveBeenCalledTimes(1);
    expect(setBusy).toHaveBeenCalledWith(true);
    expect(setView).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
  });

  it('예상하지 못한 예외를 로그하고 busy를 해제한다', async () => {
    const error = new Error('network down');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const busy: boolean[] = [];
    const notices: Array<string | null> = [];

    try {
      await completeVoteLoad(
        async () => { throw error; },
        () => true,
        (value) => busy.push(value),
        () => undefined,
        (notice) => notices.push(notice),
      );
      expect(log).toHaveBeenCalledWith('Failed to load session votes', error);
    } finally {
      log.mockRestore();
    }

    expect(busy).toEqual([true, false]);
    expect(notices.at(-1)).toBe('투표 집계를 불러오는 중 예상하지 못한 오류가 발생했습니다.');
  });
});
