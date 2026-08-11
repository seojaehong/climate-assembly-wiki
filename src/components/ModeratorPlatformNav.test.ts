import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ModeratorPlatformNav from './ModeratorPlatformNav';

describe('ModeratorPlatformNav', () => {
  it('connects the four M0 operator surfaces and marks the current page', () => {
    const html = renderToStaticMarkup(createElement(ModeratorPlatformNav, { current: 'live' }));

    expect(html).toContain('aria-label="숙의 모더레이션 플랫폼"');
    expect(html).toContain('href="/ko/moderator/live/" aria-current="page"');
    expect(html).toContain('href="/ko/moderator/canvas/"');
    expect(html).toContain('href="/workshop-graph/"');
    expect(html).toContain('href="/workshop-graph/guide/"');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('states that the platform supports deliberation without deciding for the assembly', () => {
    const html = renderToStaticMarkup(createElement(ModeratorPlatformNav, { current: 'canvas' }));

    expect(html).toContain('시민 발언과 논증 관계를 보존해 숙의·모더레이션을 지원합니다.');
    expect(html).toContain('회의의 결정을 대신하지 않습니다.');
    expect(html).toContain('href="/ko/moderator/canvas/" aria-current="page"');
  });
});
