import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PublishConsole, { CopyAnnouncement } from './PublishConsole';

describe('PublishConsole', () => {
  it('선택한 스코프와 공개 입력·HITL 안내를 한 화면에 렌더한다', () => {
    const html = renderToStaticMarkup(createElement(PublishConsole, { scope: 'topic', scopeId: 'topic-1' }));

    expect(html).toContain('HQ 인증 토큰');
    expect(html).toContain('공개 결과 제목');
    expect(html).toContain('검수 결과 발행');
    expect(html).toContain('topic-1');
    expect(html).toContain('AI는 초안을 만들고');
  });

  it('공개 설정의 입력과 동작 컨트롤은 2px 고대비 경계를 사용한다', () => {
    const html = renderToStaticMarkup(createElement(PublishConsole, { scope: 'topic', scopeId: 'topic-1' }));
    const copiedHtml = renderToStaticMarkup(createElement(CopyAnnouncement, { copied: true }));

    expect(html).toContain('border:2px solid #6B7D88');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(copiedHtml).toContain('aria-atomic="true"');
    expect(copiedHtml).toContain('공개 결과 URL을 클립보드에 복사했습니다.');
  });

  it('발행과 공개 해제가 같은 동기 operation lock을 공유한다', () => {
    const source = readFileSync(new URL('./PublishConsole.tsx', import.meta.url), 'utf8');

    expect(source.match(/runExclusivePublicationOperation\(operationLock/g)).toHaveLength(2);
    expect(source.match(/operationLock\.current/g)).toHaveLength(2);
    expect(source).toContain('disabled={busy}');
  });
});
