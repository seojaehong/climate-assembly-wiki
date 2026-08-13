import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PlatformResult, ReadinessResult } from '../../../lib/platform';
import DesignConsole, {
  DesignBlueprintBuilder,
  BlueprintPreview,
  DesignResults,
  completeDesignBlueprintExport,
  completeReadinessLoad,
  downloadDesignBlueprint,
  loadScopedReadiness,
} from './DesignConsole';
import { buildDesignBlueprint, serializeDesignBlueprint, buildDesignView, type DesignView } from './design-console-logic';

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
  it('공론화 설계 청사진 입력과 승인 전 비저장 경계를 제공한다', () => {
    const html = renderToStaticMarkup(createElement(DesignBlueprintBuilder));

    expect(html).toContain('설계 청사진');
    expect(html).toContain('공론화 이름');
    expect(html).toContain('공론화 slug');
    expect(html).toContain('공론화 목적 (선택)');
    expect(html).toContain('운영 방식');
    expect(html).toContain('개회 전 필수 준비도');
    expect(html).toContain('공개 주제');
    expect(html).toContain('활성 조');
    expect(html).toContain('참여자 배정');
    expect(html.match(/type="checkbox" checked=""/g)).toHaveLength(3);
    expect(html).toContain('value="consensus"');
    expect(html).toContain('value="vote"');
    expect(html).toContain('회차 이름');
    expect(html).toContain('회차 slug');
    expect(html).toContain('회차 날짜');
    expect(html).toContain('주제 (한 줄에 하나)');
    expect(html).toContain('조 수');
    expect(html).toContain('예상 참여자 수');
    expect(html).toContain('회차 추가');
    expect(html).toContain('청사진 JSON 불러오기');
    expect(html).toContain('accept="application/json,.json"');
    expect(html).toContain('청사진 검증');
    expect(html).toContain('DB를 변경하지 않으며 실제 생성에는 별도 승인이 필요합니다.');
    expect(html).toContain('max="500"');
    expect(html).toContain('max="100000"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
  });

  it('검증된 청사진을 JSON Blob으로 내려받고 완료 상태를 알린다', () => {
    const result = buildDesignBlueprint({
      assemblyTitle: '기후 공론화',
      assemblySlug: 'climate-2026',
      assemblyPurpose: '지역 전환 조건 검토',
      assemblyMode: 'vote',
      readinessChecks: ['topics_open', 'teams_active'],
      sessions: [{ heldOn: '2026-08-29', topics: ['수송'], teamCount: 2, participantCount: 7 }],
    });
    if (!result.ok) throw new Error('Expected a valid blueprint');
    const downloader = vi.fn();
    const setState = vi.fn();

    const completed = completeDesignBlueprintExport(
      () => downloadDesignBlueprint(serializeDesignBlueprint(result.blueprint), downloader),
      setState,
    );

    expect(completed).toBe(true);
    expect(downloader).toHaveBeenCalledOnce();
    expect(downloader.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(downloader.mock.calls[0]?.[1]).toBe('climate-2026_design_blueprint.json');
    expect(setState).toHaveBeenCalledWith({ kind: 'status', text: '설계 청사진 JSON 파일을 내려받았습니다.' });
  });

  it('청사진 표를 이름 있는 키보드 가로 스크롤 영역으로 제공한다', () => {
    const result = buildDesignBlueprint({
      assemblyTitle: '기후 공론화',
      assemblySlug: 'climate-2026',
      assemblyPurpose: '지역 전환 조건 검토',
      assemblyMode: 'vote',
      readinessChecks: ['topics_open', 'teams_active'],
      sessions: [{ heldOn: '2026-08-29', topics: ['수송'], teamCount: 2, participantCount: 7 }],
    });
    if (!result.ok) throw new Error('Expected a valid blueprint');

    const html = renderToStaticMarkup(createElement(BlueprintPreview, { blueprint: result.blueprint }));

    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="설계 청사진 회차별 구성 표"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('overflow-x:auto');
    expect(html).toContain('min-width:620px');
    expect(html).toContain('운영 방식:');
    expect(html).toContain('투표형');
    expect(html).toContain('지역 전환 조건 검토');
    expect(html).toContain('개회 전 필수 준비도:');
    expect(html).toContain('공개 주제 · 활성 조');
  });

  it('청사진 다운로드 실패를 로그와 접근 가능한 오류 상태로 전환한다', () => {
    const failure = new Error('download failed');
    const setState = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const completed = completeDesignBlueprintExport(() => { throw failure; }, setState);

    expect(completed).toBe(false);
    expect(consoleError).toHaveBeenCalledWith('Failed to download design blueprint', failure);
    expect(setState).toHaveBeenCalledWith({ kind: 'error', text: '설계 청사진 파일을 만들지 못했습니다. 다시 시도해 주세요.' });
    consoleError.mockRestore();
  });

  it('회차가 없을 때 명시적 빈 상태를 제공한다', () => {
    const html = renderToStaticMarkup(createElement(DesignConsole, { scope: 'assembly', sessions: [] }));
    expect(html).toContain('이 공론화에 준비도를 확인할 회차가 없습니다.');
    expect(html).toContain('설계 청사진');
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
