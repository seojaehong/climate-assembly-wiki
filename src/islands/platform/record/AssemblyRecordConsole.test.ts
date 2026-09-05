import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { IssueItemsResult, PlatformResult } from '../../../lib/platform';
import type { SessionTopicGroup } from '../platform-nav-logic';
import AssemblyRecordConsole, { loadAssemblyRecords } from './AssemblyRecordConsole';

const groups: SessionTopicGroup[] = [
  { id: 'session-1', label: '제1차 회의', topics: [{ id: 'topic-1', label: '에너지 전환' }] },
  { id: 'session-2', label: '제2차 회의', topics: [{ id: 'topic-2', label: '수송 부문' }] },
];

function result(topicId: string): IssueItemsResult {
  return {
    topic_id: topicId,
    items: [{
      id: `item-${topicId}`,
      submission_id: `submission-${topicId}`,
      ordinal: 1,
      team_id: `team-${topicId}`,
      team_name: `${topicId} 조`,
      kind: 'core',
      content: `${topicId} 시민 원문`,
      rationale: null,
      links: [],
      unclassified: true,
    }],
  };
}

describe('loadAssemblyRecords', () => {
  it('각 회차 id로 기록을 병렬 조회하고 원문 출처를 보존한다', async () => {
    const loader = vi.fn(async (_sessionId: string, topicId: string): Promise<PlatformResult<IssueItemsResult>> => ({
      data: result(topicId),
      notice: null,
    }));

    const loaded = await loadAssemblyRecords(
      groups,
      {
        org: { id: 'org-1', label: '한국갈등해결센터' },
        assembly: { id: 'assembly-1', label: '2026 기후시민회의' },
      },
      loader,
    );

    expect(loader.mock.calls).toEqual([['session-1', 'topic-1'], ['session-2', 'topic-2']]);
    expect(loaded.notice).toBeNull();
    expect(loaded.data?.context).toEqual({
      org: { id: 'org-1', label: '한국갈등해결센터' },
      assembly: { id: 'assembly-1', label: '2026 기후시민회의' },
    });
    expect(loaded.data?.items.map((item) => ({
      sessionId: item.sessionId,
      sessionLabel: item.sessionLabel,
      topicId: item.topicId,
      topicLabel: item.topicLabel,
      content: item.content,
    }))).toEqual([
      {
        sessionId: 'session-1',
        sessionLabel: '제1차 회의',
        topicId: 'topic-1',
        topicLabel: '에너지 전환',
        content: 'topic-1 시민 원문',
      },
      {
        sessionId: 'session-2',
        sessionLabel: '제2차 회의',
        topicId: 'topic-2',
        topicLabel: '수송 부문',
        content: 'topic-2 시민 원문',
      },
    ]);
  });

  it('주제가 없는 회차는 조회를 시작하지 않는다', async () => {
    const loader = vi.fn(async (): Promise<PlatformResult<IssueItemsResult>> => ({
      data: result('topic-1'),
      notice: null,
    }));

    const loaded = await loadAssemblyRecords([
      { id: 'session-empty', label: '빈 회차', topics: [] },
    ], {}, loader);

    expect(loaded.data?.stats.itemCount).toBe(0);
    expect(loaded.notice).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('한 주제라도 실패하면 불완전한 공론화 기록을 노출하지 않는다', async () => {
    const loader = vi.fn(async (_sessionId: string, topicId: string): Promise<PlatformResult<IssueItemsResult>> =>
      topicId === 'topic-2'
        ? { data: null, notice: '운영자 권한 범위를 확인하세요.' }
        : { data: result(topicId), notice: null });

    const loaded = await loadAssemblyRecords(
      groups,
      {},
      loader,
    );

    expect(loaded).toEqual({
      data: null,
      notice: '제2차 회의 · 수송 부문: 운영자 권한 범위를 확인하세요.',
    });
  });

  it('data와 notice가 모두 없는 실패를 로그하고 출처가 있는 notice로 바꾼다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const loaded = await loadAssemblyRecords(
        [groups[0]],
        {},
        async () => ({ data: null, notice: null }),
      );

      expect(log).toHaveBeenCalledWith(
        'Assembly record request returned no data or notice',
        'session-1',
        'topic-1',
      );
      expect(loaded).toEqual({
        data: null,
        notice: '제1차 회의 · 에너지 전환: 기록 데이터를 불러오지 못했습니다.',
      });
    } finally {
      log.mockRestore();
    }
  });
});

describe('AssemblyRecordConsole', () => {
  it('로그인된 회차별 자동 동기화와 공론화 기록 로드 전 상태를 제공한다', () => {
    const html = renderToStaticMarkup(createElement(AssemblyRecordConsole, { groups }));

    expect(html).toContain('이 공론화의 조별 기록');
    expect(html).toContain('2개 회차 · 2개 주제');
    expect(html).toContain('aria-label="공론화 기록 동기화"');
    expect(html).toContain('공론화 기록 새로고침');
    expect(html).toContain('운영자 권한');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('참여 코드');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
  });

  it('스코프 변경 시 자동 재조회하고 stale 응답을 차단한다', () => {
    const source = readFileSync(new URL('./AssemblyRecordConsole.tsx', import.meta.url), 'utf8');

    expect(source).toContain('void load();');
    expect(source).toContain('const generation = requestGeneration.current + 1;');
    expect(source).toContain('requestGeneration.current = generation;');
    expect(source).toContain('() => requestGeneration.current === generation');
    expect(source).toContain('return () => { requestGeneration.current += 1; };');
    expect(source).not.toContain('type="password"');
    expect(source).not.toContain('join_code');
  });

  it('회차 또는 주제가 없으면 구분된 빈 상태를 제공한다', () => {
    const noSession = renderToStaticMarkup(createElement(AssemblyRecordConsole, { groups: [] }));
    const noTopic = renderToStaticMarkup(createElement(AssemblyRecordConsole, {
      groups: [{ id: 'session-1', label: '제1차 회의', topics: [] }],
    }));

    expect(noSession).toContain('이 공론화에 기록을 확인할 회차가 등록되지 않았습니다.');
    expect(noTopic).toContain('이 공론화의 회차에 기록을 확인할 주제가 등록되지 않았습니다.');
    expect(noSession).toContain('role="status"');
    expect(noTopic).toContain('role="status"');
  });
});
