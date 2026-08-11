import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OntologyReviewConsole, { completeOntologyWorkspaceLoad } from './OntologyReviewConsole';
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
});
