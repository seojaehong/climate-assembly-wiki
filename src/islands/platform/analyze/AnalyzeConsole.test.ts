import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { IssueListResult, PlatformResult } from '../../../lib/platform';
import AnalyzeConsole, { AnalysisResults, completeAnalysisLoad, loadScopedAnalysis } from './AnalyzeConsole';
import { buildAnalysisView, buildScopedAnalysisView } from './analyze-console-logic';
import type { AnalysisView } from './analyze-console-logic';

const result: IssueListResult = {
  topic_id: 'topic-1',
  reviewed_count: 1,
  unclassified_count: 2,
  issues: [{
    id: 'issue-1',
    label: '재생에너지 확대',
    stance: 'pro',
    frequency_class: 'consensus',
    summary: '전환 속도를 높이자는 의견입니다.',
    origin: 'human',
    review_status: 'reviewed',
    reviewed_by: 'operator',
    reviewed_at: '2026-08-11T00:00:00Z',
    archived_at: null,
    linked_item_count: 3,
    consensus_denominator: 2,
  }],
};

describe('AnalysisResults', () => {
  it('요약·4×6 분포·쟁점별 근거를 같은 렌더 경로에 제공한다', () => {
    const html = renderToStaticMarkup(createElement(AnalysisResults, {
      view: buildAnalysisView(result),
    }));

    expect(html).toContain('쟁점 1건');
    expect(html).toContain('검수 완료 1건');
    expect(html).toContain('미분류 원문 2건');
    expect(html).toContain('원문 연결 관계 3건');
    expect(html).toContain('분석 결과를 불러왔습니다. 쟁점 1건, 검수 완료 1건입니다.');
    expect(html).toContain('빈도 분포');
    expect(html).toContain('방향 분포');
    expect(html).toContain('aria-labelledby="analysis-frequency-distribution"');
    expect(html).toContain('aria-labelledby="analysis-stance-distribution"');
    expect(html).toContain('합의');
    expect(html).toContain('찬성');
    expect(html).toContain('<caption');
    expect(html).toContain('쟁점별 빈도·방향·검수·원문 연결 분석');
    expect(html).toContain('재생에너지 확대');
    expect(html).toContain('검수 완료');
    expect(html).toContain('원문 연결 3건 · 군집 분모 2건');
  });

  it('쟁점이 없어도 미분류 원문 요약을 숨기지 않는다', () => {
    const html = renderToStaticMarkup(createElement(AnalysisResults, {
      view: buildAnalysisView({ ...result, issues: [], reviewed_count: 0, unclassified_count: 5 }),
    }));

    expect(html).toContain('aria-label="쟁점 0건"');
    expect(html).toContain('aria-label="미분류 원문 5건"');
    expect(html).toContain('분석할 쟁점이 없습니다.');
    expect(html).not.toContain('<table');
  });

  it('회차 분석 표에서 각 쟁점의 출처 주제를 함께 보여준다', () => {
    const view = buildScopedAnalysisView('session', [
      { target: { id: 'topic-1', label: '에너지 전환' }, result },
    ]);
    const html = renderToStaticMarkup(createElement(AnalysisResults, { view }));

    expect(html).toContain('<th scope="col"');
    expect(html).toContain('출처 주제');
    expect(html).toContain('에너지 전환');
    expect(html).toContain('회차 쟁점별 빈도·방향·검수·원문 연결 분석');
  });
});

describe('AnalyzeConsole', () => {
  it('주제 미선택과 로드 전 입력 상태를 명확히 구분한다', () => {
    const noTopicHtml = renderToStaticMarkup(createElement(AnalyzeConsole, { scope: null, topics: [] }));
    const formHtml = renderToStaticMarkup(createElement(AnalyzeConsole, {
      scope: 'topic',
      topics: [{ id: 'topic-1', label: '에너지 전환' }],
    }));

    expect(noTopicHtml).toContain('주제(topic) 또는 회차(session) 스코프를 먼저 선택하세요.');
    expect(noTopicHtml).toContain('role="status"');
    expect(formHtml).toContain('<form');
    expect(formHtml).toContain('aria-label="주제 분석 불러오기"');
    expect(formHtml).toContain('aria-busy="false"');
    expect(formHtml).toContain('for="analysis-join-code"');
    expect(formHtml).toContain('id="analysis-join-code"');
    expect(formHtml).toContain('type="password"');
    expect(formHtml).toContain('분석 불러오기');
    expect(formHtml).toContain('쟁점 목록을 불러오면');
  });

  it('회차 스코프는 포함된 주제 수와 회차 분석 입력을 표시한다', () => {
    const html = renderToStaticMarkup(createElement(AnalyzeConsole, {
      scope: 'session',
      topics: [
        { id: 'topic-1', label: '에너지 전환' },
        { id: 'topic-2', label: '수송 부문' },
      ],
    }));

    expect(html).toContain('이 회차의 쟁점 분석');
    expect(html).toContain('2개 주제');
    expect(html).toContain('aria-label="회차 분석 불러오기"');
    expect(html).not.toContain('주제(topic) 스코프를 먼저 선택하세요.');
  });
});

describe('loadScopedAnalysis', () => {
  it('회차의 모든 주제를 같은 참여 코드로 조회해 집계한다', async () => {
    const loader = vi.fn(async (_code: string, topicId: string): Promise<PlatformResult<IssueListResult>> => ({
      data: {
        ...result,
        topic_id: topicId,
        issues: result.issues.map((item) => ({ ...item, id: `issue-${topicId}` })),
      },
      notice: null,
    }));

    const loaded = await loadScopedAnalysis('team-code', 'session', [
      { id: 'topic-1', label: '에너지 전환' },
      { id: 'topic-2', label: '수송 부문' },
    ], loader);

    expect(loader.mock.calls).toEqual([
      ['team-code', 'topic-1'],
      ['team-code', 'topic-2'],
    ]);
    expect(loaded.notice).toBeNull();
    expect(loaded.data?.scope).toBe('session');
    expect(loaded.data?.stats.issueCount).toBe(2);
    expect(loaded.data?.issues.map((item) => item.topicLabel)).toEqual(['에너지 전환', '수송 부문']);
  });

  it('일부 주제 조회 실패를 불완전한 회차 분석으로 표시하지 않는다', async () => {
    const loader = vi.fn(async (_code: string, topicId: string): Promise<PlatformResult<IssueListResult>> =>
      topicId === 'topic-2'
        ? { data: null, notice: '참여 코드 범위를 확인하세요.' }
        : { data: result, notice: null });

    const loaded = await loadScopedAnalysis('team-code', 'session', [
      { id: 'topic-1', label: '에너지 전환' },
      { id: 'topic-2', label: '수송 부문' },
    ], loader);

    expect(loaded.data).toBeNull();
    expect(loaded.notice).toBe('수송 부문: 참여 코드 범위를 확인하세요.');
  });
});

describe('completeAnalysisLoad', () => {
  it('성공 결과를 뷰모델로 바꾸고 busy를 항상 해제한다', async () => {
    const busy: boolean[] = [];
    const views: Array<ReturnType<typeof buildAnalysisView> | null> = [];
    const notices: Array<string | null> = [];
    const action = vi.fn<() => Promise<PlatformResult<AnalysisView>>>().mockResolvedValue({
      data: buildAnalysisView(result),
      notice: null,
    });

    await completeAnalysisLoad(action, (value) => busy.push(value), (value) => views.push(value), (value) => notices.push(value));

    expect(action).toHaveBeenCalledOnce();
    expect(busy).toEqual([true, false]);
    expect(views[0]).toBeNull();
    expect(views.at(-1)?.stats.issueCount).toBe(1);
    expect(notices).toEqual([null]);
  });

  it('데이터 계층 notice를 화면 상태로 전달한다', async () => {
    const busy: boolean[] = [];
    const views: Array<ReturnType<typeof buildAnalysisView> | null> = [];
    const notices: Array<string | null> = [];

    await completeAnalysisLoad(
      async () => ({ data: null, notice: '참여 코드를 확인하세요.' }),
      (value) => busy.push(value),
      (value) => views.push(value),
      (value) => notices.push(value),
    );

    expect(busy).toEqual([true, false]);
    expect(views).toEqual([null]);
    expect(notices).toEqual([null, '참여 코드를 확인하세요.']);
  });

  it('예상하지 못한 예외를 로그하고 사용자 notice로 바꾼다', async () => {
    const error = new Error('network down');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const busy: boolean[] = [];
    const notices: Array<string | null> = [];

    await completeAnalysisLoad(
      async () => { throw error; },
      (value) => busy.push(value),
      () => undefined,
      (value) => notices.push(value),
    );

    expect(log).toHaveBeenCalledWith('Failed to load scoped analysis', error);
    expect(busy).toEqual([true, false]);
    expect(notices.at(-1)).toContain('예상하지 못한 오류');
    log.mockRestore();
  });

  it('data와 notice가 모두 없는 응답을 로그하고 실패로 표시한다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const notices: Array<string | null> = [];

    const loaded = await completeAnalysisLoad(
      async () => ({ data: null, notice: null }),
      () => undefined,
      () => undefined,
      (value) => notices.push(value),
    );

    expect(loaded).toBe(false);
    expect(log).toHaveBeenCalledWith('Analysis request returned no data or notice');
    expect(notices.at(-1)).toBe('분석 데이터를 불러오지 못했습니다.');
    log.mockRestore();
  });

  it('더 이상 현재 요청이 아니면 늦은 응답을 화면 상태에 반영하지 않는다', async () => {
    let current = true;
    let resolveResult!: (value: PlatformResult<AnalysisView>) => void;
    const action = () => new Promise<PlatformResult<AnalysisView>>((resolve) => { resolveResult = resolve; });
    const busy: boolean[] = [];
    const views: Array<ReturnType<typeof buildAnalysisView> | null> = [];
    const notices: Array<string | null> = [];

    const pending = completeAnalysisLoad(
      action,
      (value) => busy.push(value),
      (value) => views.push(value),
      (value) => notices.push(value),
      () => current,
    );
    current = false;
    resolveResult({ data: buildAnalysisView(result), notice: null });
    const loaded = await pending;

    expect(loaded).toBe(false);
    expect(busy).toEqual([true]);
    expect(views).toEqual([null]);
    expect(notices).toEqual([null]);
  });
});
