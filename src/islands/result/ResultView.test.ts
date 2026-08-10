import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildResultView, type ResultGetResponse } from './result-view-logic';
import { RESULT_CONTROL_BORDER, RESULT_STATUS_AMBER, RESULT_STATUS_GREEN, ResultContent, ResultStatusScreen } from './ResultView';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function readyView() {
  const response: ResultGetResponse = {
    scope: 'session',
    scope_id: 'session-1',
    title: '제5차 회의 결과',
    published_at: '2026-08-10T00:00:00Z',
    body: {
      scope: 'session',
      scope_id: 'session-1',
      title: '제5차 회의 결과',
      reviewed_count: 1,
      unclassified_count: 0,
      generated_at: '2026-08-10T00:00:00Z',
      issues: [{
        id: 'issue-1',
        label: '대중교통 확대',
        frequency_class: 'consensus',
        stance: 'proposal',
        review_status: 'reviewed',
        consensus_denominator: 2,
        teams: ['1분과 1조', '1분과 2조'],
      }],
    },
  };
  const view = buildResultView(response);
  if (!view) throw new Error('Expected a ready result view');
  return view;
}

describe('ResultView accessibility', () => {
  it('로딩·오류·미공개 상태를 보조기기에 알린다', () => {
    const loading = renderToStaticMarkup(createElement(ResultStatusScreen, { kind: 'loading' }));
    const error = renderToStaticMarkup(createElement(ResultStatusScreen, { kind: 'error' }));
    const unpublished = renderToStaticMarkup(createElement(ResultStatusScreen, { kind: 'unpublished' }));

    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-live="polite"');
    expect(error).toContain('role="alert"');
    expect(unpublished).toContain('role="status"');
  });

  it('쟁점 시각화와 동일한 수치를 항상 DOM의 표 대체본으로 제공한다', () => {
    const html = renderToStaticMarkup(createElement(ResultContent, { view: readyView() }));

    expect(html).toContain('<details');
    expect(html).toContain('분석 데이터를 표로 보기');
    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain('<caption');
    expect(html).toContain('쟁점별 방향·빈도·제기 조 수·원문 군집·검수 상태');
    expect(html).toContain('scope="col"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('공개 결과에서 본문과 접근성 성명으로 이동할 수 있고 얇은 경계를 쓰지 않는다', () => {
    const html = renderToStaticMarkup(createElement(ResultContent, { view: readyView() }));

    expect(html).toContain('id="main-content"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('href="/platform/accessibility/"');
    expect(html).not.toMatch(/class="[^"]*\bborder\b(?!-)/);
  });

  it('검수·합의 상태 텍스트가 일반 텍스트 AA 명암비를 충족한다', () => {
    expect(contrastRatio(RESULT_STATUS_GREEN, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(RESULT_STATUS_AMBER, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(RESULT_STATUS_AMBER, '#FEF6E7')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(RESULT_CONTROL_BORDER, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });
});
