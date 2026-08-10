import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import HitlBadge from './HitlBadge';
import { resolveHitlStatus } from '../lib/hitl-status';

describe('HitlBadge', () => {
  it('보이는 상태와 보조기기 설명을 같은 HITL 계약에서 렌더한다', () => {
    const status = resolveHitlStatus({ reviewStatus: 'draft', origin: 'ai' });
    const html = renderToStaticMarkup(createElement(HitlBadge, { status }));

    expect(html).toContain('검수 대기 · AI 초안');
    expect(html).toContain(`aria-label="${status.label}: ${status.description}"`);
    expect(html).toContain('border:2px solid #F5A623');
    expect(html).toContain('color:#8A4F08');
  });
});
