import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformResult, ReadinessResult } from '../../../lib/platform';
import DesignConsole, { DesignResults, completeReadinessLoad, loadScopedReadiness } from './DesignConsole';
import { buildDesignView, type DesignView } from './design-console-logic';

const readiness: ReadinessResult = {
  ok: true,
  checks: [
    { key: 'topics_open', pass: true, detail: '2개 주제 open' },
    { key: 'teams_active', pass: true, detail: '3개 조 active' },
    { key: 'roster_loaded', pass: true, detail: '18명 배정' },
    { key: 'submissions', pass: true, detail: '5/6 최종 제출' },
  ],
};

describe('loadScopedReadiness', () => {
  it('공론화의 모든 회차를 병렬 조회해 하나의 준비도 모델로 만든다', async () => {
    const loader = vi.fn(async (sessionId: string): Promise<PlatformResult<ReadinessResult>> => ({
      data: { ...readiness, ok: sessionId === 'session-1' },
      notice: null,
    }));
    const result = await loadScopedReadiness('assembly', [
      { id: 'session-1', label: '제1차 회의' },
      { id: 'session-2', label: '제2차 회의' },
    ], loader);

    expect(loader.mock.calls).toEqual([['session-1'], ['session-2']]);
    expect(result.data?.stats).toMatchObject({ sessionCount: 2, readyCount: 1, blockedCount: 1 });
  });

  it('한 회차라도 실패하면 불완전한 공론화 준비도를 노출하지 않는다', async () => {
    const loader = vi.fn(async (sessionId: string): Promise<PlatformResult<ReadinessResult>> =>
      sessionId === 'session-2' ? { data: null, notice: '조회 실패' } : { data: readiness, notice: null });
    const result = await loadScopedReadiness('assembly', [
      { id: 'session-1', label: '제1차 회의' },
      { id: 'session-2', label: '제2차 회의' },
    ], loader);

    expect(result).toEqual({ data: null, notice: '제2차 회의: 조회 실패' });
  });
});

describe('DesignResults', () => {
  it('요약, 게이트 상태, 상세 근거를 색상 외 텍스트와 표로 제공한다', () => {
    const view = buildDesignView('session', [{ target: { id: 'session-1', label: '제1차 회의' }, result: readiness }]);
    const html = renderToStaticMarkup(createElement(DesignResults, { view }));

    expect(html).toContain('준비도 확인을 완료했습니다. 회차 1개 중 1개가 준비 완료입니다.');
    expect(html).toContain('제1차 회의');
    expect(html).toContain('준비 완료');
    expect(html).toContain('공개 주제');
    expect(html).toContain('최종 제출 현황');
    expect(html).toContain('운영 정보이며 준비 완료 판정에는 포함되지 않습니다.');
    expect(html).toContain('<caption');
    expect(html).toContain('scope="col"');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
  });
});

describe('DesignConsole', () => {
  it('회차가 없을 때 명시적 빈 상태를 제공한다', () => {
    const html = renderToStaticMarkup(createElement(DesignConsole, { scope: 'assembly', sessions: [] }));
    expect(html).toContain('이 공론화에 준비도를 확인할 회차가 없습니다.');
    expect(html).toContain('role="status"');
  });

  it('mount effect가 자동 조회를 시작하고 오류 재시도가 새 generation을 만든다', () => {
    const source = readFileSync(new URL('./DesignConsole.tsx', import.meta.url), 'utf8');

    expect(source).toContain('void completeReadinessLoad(');
    expect(source).toContain('() => loadScopedReadiness(scope, sessions)');
    expect(source).toContain('const generation = requestGeneration.current + 1;');
    expect(source).toContain('() => requestGeneration.current === generation');
    expect(source).toContain('return () => { requestGeneration.current += 1; };');
    expect(source).toContain('onClick={() => setRetry((value) => value + 1)}');
    expect(source).toContain('}, [scopeKey, retry]);');
  });
});

describe('completeReadinessLoad', () => {
  it('stale 응답은 화면 상태와 busy를 바꾸지 않는다', async () => {
    const view: DesignView = buildDesignView('session', [{ target: { id: 'session-1', label: '제1차 회의' }, result: readiness }]);
    const setBusy = vi.fn();
    const setView = vi.fn();
    const setNotice = vi.fn();

    await completeReadinessLoad(async () => ({ data: view, notice: null }), () => false, setBusy, setView, setNotice);

    expect(setBusy).toHaveBeenCalledTimes(1);
    expect(setBusy).toHaveBeenCalledWith(true);
    expect(setView).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
  });
});
