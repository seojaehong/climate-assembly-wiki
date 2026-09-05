import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { IssueListResult, PlatformResult } from '../../../lib/platform';
import type { SessionTopicGroup } from '../platform-nav-logic';
import AssemblyAnalyzeConsole, { loadAssemblyAnalysis } from './AssemblyAnalyzeConsole';

const groups: SessionTopicGroup[] = [
  {
    id: 'session-1',
    label: '제1차 회의',
    topics: [{ id: 'topic-1', label: '에너지 전환' }],
  },
  {
    id: 'session-2',
    label: '제2차 회의',
    topics: [{ id: 'topic-2', label: '수송 부문' }],
  },
];

function result(topicId: string): IssueListResult {
  return {
    topic_id: topicId,
    issues: [{
      id: `issue-${topicId}`,
      label: `${topicId} 쟁점`,
      stance: 'pro',
      frequency_class: 'consensus',
      summary: null,
      origin: 'ai',
      review_status: 'draft',
      reviewed_by: null,
      reviewed_at: null,
      archived_at: null,
      linked_item_count: 1,
      consensus_denominator: 1,
    }],
    reviewed_count: 0,
    unclassified_count: 0,
  };
}

describe('loadAssemblyAnalysis', () => {
  it('각 회차 id로 포함 주제를 병렬 조회하고 출처를 보존한다', async () => {
    const loader = vi.fn(async (_sessionId: string, topicId: string): Promise<PlatformResult<IssueListResult>> => ({
      data: result(topicId),
      notice: null,
    }));

    const loaded = await loadAssemblyAnalysis(groups, loader);

    expect(loader.mock.calls).toEqual([
      ['session-1', 'topic-1'],
      ['session-2', 'topic-2'],
    ]);
    expect(loaded.notice).toBeNull();
    expect(loaded.data?.scope).toBe('assembly');
    expect(loaded.data?.issues.map((issue) => ({
      id: issue.id,
      sessionId: issue.sessionId,
      sessionLabel: issue.sessionLabel,
      topicId: issue.topicId,
      topicLabel: issue.topicLabel,
    }))).toEqual([
      {
        id: 'issue-topic-1',
        sessionId: 'session-1',
        sessionLabel: '제1차 회의',
        topicId: 'topic-1',
        topicLabel: '에너지 전환',
      },
      {
        id: 'issue-topic-2',
        sessionId: 'session-2',
        sessionLabel: '제2차 회의',
        topicId: 'topic-2',
        topicLabel: '수송 부문',
      },
    ]);
  });

  it('주제가 없는 회차는 RPC를 호출하지 않는다', async () => {
    const loader = vi.fn(async (): Promise<PlatformResult<IssueListResult>> => ({
      data: result('topic-1'),
      notice: null,
    }));

    const loaded = await loadAssemblyAnalysis([
      { id: 'session-empty', label: '빈 회차', topics: [] },
    ], loader);

    expect(loaded.data?.stats.issueCount).toBe(0);
    expect(loaded.notice).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('한 주제라도 실패하면 불완전한 공론화 집계를 노출하지 않는다', async () => {
    const loader = vi.fn(async (_sessionId: string, topicId: string): Promise<PlatformResult<IssueListResult>> =>
      topicId === 'topic-2'
        ? { data: null, notice: '운영자 권한 범위를 확인하세요.' }
        : { data: result(topicId), notice: null });

    const loaded = await loadAssemblyAnalysis(groups, loader);

    expect(loaded).toEqual({
      data: null,
      notice: '제2차 회의 · 수송 부문: 운영자 권한 범위를 확인하세요.',
    });
  });

  it('data와 notice가 모두 없는 실패를 로그하고 출처가 있는 notice로 바꾼다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const loaded = await loadAssemblyAnalysis(
        [groups[0]],
        async () => ({ data: null, notice: null }),
      );

      expect(log).toHaveBeenCalledWith(
        'Assembly analysis request returned no data or notice',
        'session-1',
        'topic-1',
      );
      expect(loaded).toEqual({
        data: null,
        notice: '제1차 회의 · 에너지 전환: 분석 데이터를 불러오지 못했습니다.',
      });
    } finally {
      log.mockRestore();
    }
  });
});

describe('AssemblyAnalyzeConsole', () => {
  it('로그인된 회차별 자동 동기화와 로드 전 상태를 제공한다', () => {
    const html = renderToStaticMarkup(createElement(AssemblyAnalyzeConsole, { groups }));

    expect(html).toContain('이 공론화의 쟁점 분석');
    expect(html).toContain('2개 회차 · 2개 주제');
    expect(html).toContain('aria-label="공론화 분석 동기화"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('공론화 분석 새로고침');
    expect(html).toContain('운영자 권한');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('참여 코드');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
  });

  it('스코프 변경 시 자동 재조회하고 stale 응답을 차단한다', () => {
    const source = readFileSync(new URL('./AssemblyAnalyzeConsole.tsx', import.meta.url), 'utf8');

    expect(source).toContain('void load();');
    expect(source).toContain('const generation = requestGeneration.current + 1;');
    expect(source).toContain('requestGeneration.current = generation;');
    expect(source).toContain('() => requestGeneration.current === generation');
    expect(source).toContain('return () => { requestGeneration.current += 1; };');
    expect(source).not.toContain('type="password"');
    expect(source).not.toContain('join_code');
  });

  it('회차 또는 주제가 없으면 구분된 빈 상태를 제공한다', () => {
    const noSession = renderToStaticMarkup(createElement(AssemblyAnalyzeConsole, { groups: [] }));
    const noTopic = renderToStaticMarkup(createElement(AssemblyAnalyzeConsole, {
      groups: [{ id: 'session-1', label: '제1차 회의', topics: [] }],
    }));

    expect(noSession).toContain('이 공론화에 분석할 회차가 등록되지 않았습니다.');
    expect(noTopic).toContain('이 공론화의 회차에 분석할 주제가 등록되지 않았습니다.');
    expect(noSession).toContain('role="status"');
    expect(noTopic).toContain('role="status"');
  });
});
