import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PublishConsole from './PublishConsole';

describe('PublishConsole', () => {
  it('선택한 스코프와 공개 입력·HITL 안내를 한 화면에 렌더한다', () => {
    const html = renderToStaticMarkup(createElement(PublishConsole, { scope: 'topic', scopeId: 'topic-1' }));

    expect(html).toContain('HQ 인증 토큰');
    expect(html).toContain('공개 결과 제목');
    expect(html).toContain('검수 결과 발행');
    expect(html).toContain('topic-1');
    expect(html).toContain('AI는 초안을 만들고');
  });
});
