import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { IssueItemsResult, PlatformResult } from '../../../lib/platform';
import RecordConsole, { RecordResults, completeRecordLoad, loadScopedRecords } from './RecordConsole';
import { buildRecordView } from './record-console-logic';
import type { RecordView } from './record-console-logic';

function result(topicId: string, itemId: string): IssueItemsResult {
  return {
    topic_id: topicId,
    items: [{
      id: itemId,
      submission_id: `submission-${topicId}`,
      ordinal: 1,
      team_id: 'team-1',
      team_name: '1분과 1조',
      kind: 'core',
      content: `${topicId} 시민 원문`,
      rationale: '제안 근거',
      links: [],
      unclassified: true,
    }],
  };
}

describe('loadScopedRecords', () => {
  it('회차의 모든 주제 기록을 같은 참여 코드로 조회해 합친다', async () => {
    const loader = vi.fn(async (_code: string, topicId: string): Promise<PlatformResult<IssueItemsResult>> => ({
      data: result(topicId, `item-${topicId}`),
      notice: null,
    }));

    const loaded = await loadScopedRecords('team-code', 'session', [
      { id: 'topic-1', label: '에너지 전환' },
      { id: 'topic-2', label: '수송 부문' },
    ], loader);

    expect(loader.mock.calls).toEqual([
      ['team-code', 'topic-1'],
      ['team-code', 'topic-2'],
    ]);
    expect(loaded.notice).toBeNull();
    expect(loaded.data?.stats).toMatchObject({ topicCount: 2, submissionCount: 2, itemCount: 2 });
    expect(loaded.data?.items.map((item) => item.topicLabel)).toEqual(['에너지 전환', '수송 부문']);
  });

  it('일부 주제 실패를 불완전한 회차 기록으로 표시하지 않는다', async () => {
    const loader = vi.fn(async (_code: string, topicId: string): Promise<PlatformResult<IssueItemsResult>> =>
      topicId === 'topic-2'
        ? { data: null, notice: '참여 코드 범위를 확인하세요.' }
        : { data: result(topicId, `item-${topicId}`), notice: null });

    const loaded = await loadScopedRecords('team-code', 'session', [
      { id: 'topic-1', label: '에너지 전환' },
      { id: 'topic-2', label: '수송 부문' },
    ], loader);

    expect(loaded.data).toBeNull();
    expect(loaded.notice).toBe('수송 부문: 참여 코드 범위를 확인하세요.');
  });
});

describe('RecordResults', () => {
  it('회차 기록을 요약하고 출처·원문·분류 상태를 표로 제공한다', () => {
    const linked = result('topic-1', 'item-topic-1');
    linked.items[0].links = [
      { issue_id: 'issue-1', cluster_id: 'cluster-1', linked_by: 'operator' },
      { issue_id: 'issue-2', cluster_id: null, linked_by: 'assistant' },
    ];
    linked.items[0].unclassified = false;
    const view = buildRecordView('session', [
      { target: { id: 'topic-1', label: '에너지 전환' }, result: linked },
      { target: { id: 'topic-2', label: '수송 부문' }, result: result('topic-2', 'item-topic-2') },
    ]);
    const html = renderToStaticMarkup(createElement(RecordResults, { view }));

    expect(html).toContain('기록 원문 2건');
    expect(html).toContain('제출 2건');
    expect(html).toContain('미분류 1건');
    expect(html).toContain('회차 조별 기록 원문과 쟁점 연결 상태');
    expect(html).toContain('출처 주제');
    expect(html).toContain('에너지 전환');
    expect(html).toContain('1분과 1조');
    expect(html).toContain('topic-1 시민 원문');
    expect(html).toContain('근거: 제안 근거');
    expect(html).toContain('쟁점 2건 연결');
    expect(html).toContain('aria-label="쟁점 연결 상세"');
    expect(html).toContain('쟁점 issue-1 · 군집 cluster-1 · 연결자 operator');
    expect(html).toContain('쟁점 issue-2 · 군집 없음 · 연결자 assistant');
    expect(html).toContain('미분류');
    expect(html).toContain('submission-topic-1');
    expect(html).not.toContain('title="submission-topic-1"');
    expect(html).toContain('id="source-item-item-topic-1"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('<caption');
  });

  it('공론화 기록 표에서 출처 회차와 주제를 분리해 제공한다', () => {
    const view = buildRecordView('assembly', [{
      target: {
        id: 'topic-1',
        label: '에너지 전환',
        sessionId: 'session-1',
        sessionLabel: '제1차 회의',
      },
      result: result('topic-1', 'item-topic-1'),
    }]);
    const html = renderToStaticMarkup(createElement(RecordResults, { view }));

    expect(html).toContain('공론화 조별 기록 원문과 쟁점 연결 상태');
    expect(html).toContain('출처 회차');
    expect(html).toContain('출처 주제');
    expect(html).toContain('제1차 회의');
    expect(html).toContain('에너지 전환');
  });

  it('원문이 없어도 0건 요약과 빈 상태를 함께 제공한다', () => {
    const view = buildRecordView('topic', [{
      target: { id: 'topic-1', label: '에너지 전환' },
      result: { topic_id: 'topic-1', items: [] },
    }]);
    const html = renderToStaticMarkup(createElement(RecordResults, { view }));

    expect(html).toContain('aria-label="기록 원문 0건"');
    expect(html).toContain('등록된 조별 기록이 없습니다.');
    expect(html).not.toContain('<table');
  });
});

describe('RecordConsole', () => {
  it('주제와 회차 스코프에 맞는 비영구 참여 코드 입력을 제공한다', () => {
    const topicHtml = renderToStaticMarkup(createElement(RecordConsole, {
      scope: 'topic',
      topics: [{ id: 'topic-1', label: '에너지 전환' }],
    }));
    const sessionHtml = renderToStaticMarkup(createElement(RecordConsole, {
      scope: 'session',
      topics: [
        { id: 'topic-1', label: '에너지 전환' },
        { id: 'topic-2', label: '수송 부문' },
      ],
    }));

    expect(topicHtml).toContain('이 주제의 조별 기록');
    expect(topicHtml).toContain('aria-label="주제 기록 불러오기"');
    expect(topicHtml).toContain('type="password"');
    expect(topicHtml).toContain('autoComplete="off"');
    expect(topicHtml).toContain('브라우저 저장소에 보관하지 않습니다.');
    expect(topicHtml).toContain('border:2px solid #6B7D88');
    expect(topicHtml).not.toMatch(/border:(?:1|1\.5)px/);
    expect(sessionHtml).toContain('이 회차의 조별 기록');
    expect(sessionHtml).toContain('2개 주제');
    expect(sessionHtml).toContain('aria-label="회차 기록 불러오기"');
  });
});

describe('completeRecordLoad', () => {
  it('예상하지 못한 예외를 로그하고 busy를 항상 해제한다', async () => {
    const error = new Error('network down');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const busy: boolean[] = [];
    const notices: Array<string | null> = [];

    await completeRecordLoad(
      async () => { throw error; },
      (value) => busy.push(value),
      () => undefined,
      (value) => notices.push(value),
    );

    expect(log).toHaveBeenCalledWith('Failed to load scoped records', error);
    expect(busy).toEqual([true, false]);
    expect(notices.at(-1)).toContain('예상하지 못한 오류');
    log.mockRestore();
  });

  it('스코프가 바뀐 뒤 도착한 응답은 화면 상태를 바꾸지 않는다', async () => {
    let current = true;
    let resolveResult!: (value: PlatformResult<RecordView>) => void;
    const action = () => new Promise<PlatformResult<RecordView>>((resolve) => { resolveResult = resolve; });
    const busy: boolean[] = [];
    const views: Array<RecordView | null> = [];
    const notices: Array<string | null> = [];
    const view = buildRecordView('topic', [{
      target: { id: 'topic-1', label: '에너지 전환' },
      result: result('topic-1', 'item-1'),
    }]);

    const pending = completeRecordLoad(
      action,
      (value) => busy.push(value),
      (value) => views.push(value),
      (value) => notices.push(value),
      () => current,
    );
    current = false;
    resolveResult({ data: view, notice: null });
    const loaded = await pending;

    expect(loaded).toBe(false);
    expect(busy).toEqual([true]);
    expect(views).toEqual([null]);
    expect(notices).toEqual([null]);
  });
});
