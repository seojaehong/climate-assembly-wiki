import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OntologyReviewConsole, {
  completeOntologyWorkspaceLoad,
  completeTranscriptOntologyExport,
  FacilitationPromptPanel,
} from './OntologyReviewConsole';
import type { CanvasOntologyReviewWorkspace } from './canvas/ontology-review-workspace';

describe('OntologyReviewConsole', () => {
  it('starts as a local-only review import surface with explicit safety boundaries', () => {
    const html = renderToStaticMarkup(createElement(OntologyReviewConsole));

    expect(html).toContain('Canvas 온톨로지 검수 큐');
    expect(html).toContain('type="file"');
    expect(html).toContain('검수 계획 JSON');
    expect(html).toContain('Canvas snapshot JSON');
    expect(html).toContain('검수자 역할 ID');
    expect(html).toContain('type="submit" disabled=""');
    expect(html).toContain('DB에 저장하지 않습니다.');
    expect(html).toContain('공개 그래프에 반영하지 않습니다.');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('합성 전사 후보 검수');
    expect(html).toContain('전사 ontology fixture JSON');
    expect(html).toContain('candidate node와 relation을 브라우저 메모리에서만 검수합니다.');
    expect(html).toContain('실제 시민 발언 파일은 이 prototype에 넣지 마세요.');
    expect(html).toContain('R4 로컬 음성·전사 검수');
    expect(html).toContain('MediaRecorder proof of concept');
    expect(html).toContain('브라우저 세션 메모리에만');
    expect(html).toContain('전사 chunk 검수 완료 전에는 extraction handoff를 만들 수 없습니다.');
  });

  it('renders every upload and reviewer input on an explicit opaque high-contrast surface', () => {
    const html = renderToStaticMarkup(createElement(OntologyReviewConsole));
    const inputTags = html.match(/<input\b[^>]*>/g) ?? [];

    expect(inputTags).toHaveLength(7);
    for (const input of inputTags.filter((input) => !input.includes('type="checkbox"'))) {
      expect(input).toContain('background:#FFFFFF');
      expect(input).toContain('color:#102A43');
    }
  });

  it('renders advisory facilitation questions with provenance and a live count', () => {
    const html = renderToStaticMarkup(createElement(FacilitationPromptPanel, { prompts: [{
      id: 'missing-condition:node-1',
      nodeId: 'node-1',
      sourceAgendaId: 'agenda-1',
      sourceSessionId: 'session-1',
      sourceText: '원래 제안 문구',
      kind: 'missing-condition',
      question: '이 제안을 실행하려면 어떤 조건이 필요한가요?',
      reason: '검수된 Proposal에 연결된 Condition이 없습니다.',
    }] }));

    expect(html).toContain('진행 질문');
    expect(html).toContain('현재 규칙으로 확인된 진행 질문 1개');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('출처 세션 session-1 · 원 agenda agenda-1 · 노드 node-1');
    expect(html).toContain('원문: 원래 제안 문구');
    expect(html).toContain('회의의 결정이나 진실 판정을 대신하지 않습니다.');
  });

  it('discards a stale asynchronous workspace load without changing visible state', async () => {
    const workspaceChanges: unknown[] = [];
    const notices: string[] = [];
    const errors: Array<string | null> = [];
    const busyChanges: boolean[] = [];
    let current = true;
    let resolveLoad: () => void = () => { throw new Error('Deferred load was not initialized'); };
    const load = new Promise<CanvasOntologyReviewWorkspace>((resolve) => {
      resolveLoad = () => resolve({} as CanvasOntologyReviewWorkspace);
    });
    const completion = completeOntologyWorkspaceLoad({
      load: () => load,
      isCurrent: () => current,
      setWorkspace: (workspace) => workspaceChanges.push(workspace),
      setNotice: (notice) => notices.push(notice),
      setError: (error) => errors.push(error),
      setBusy: (busy) => busyChanges.push(busy),
    });

    current = false;
    resolveLoad();
    await completion;

    expect(workspaceChanges).toEqual([]);
    expect(notices).toEqual([]);
    expect(errors).toEqual([]);
    expect(busyChanges).toEqual([]);
  });

  it('discards a transcript export when the reviewed workspace changes while rebuilding', async () => {
    const downloads: string[] = [];
    const notices: string[] = [];
    const errors: Array<string | null> = [];
    const busyChanges: boolean[] = [];
    let current = true;
    let resolveBuild: () => void = () => { throw new Error('Deferred export was not initialized'); };
    const build = new Promise<string>((resolve) => {
      resolveBuild = () => resolve('{"schemaVersion":2}');
    });
    const completion = completeTranscriptOntologyExport({
      build: () => build,
      isCurrent: () => current,
      download: (content) => downloads.push(content),
      setNotice: (notice) => notices.push(notice),
      setError: (error) => errors.push(error),
      setBusy: (busy) => busyChanges.push(busy),
    });

    current = false;
    resolveBuild();
    await completion;

    expect(downloads).toEqual([]);
    expect(notices).toEqual(['검수 입력이 바뀌어 이전 plan 다운로드를 취소했습니다.']);
    expect(errors).toEqual([]);
    expect(busyChanges).toEqual([false]);
  });
});
