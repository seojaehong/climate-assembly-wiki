import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IMPLEMENTATION_STATUS_META, buildResultView, type ResultGetResponse } from './result-view-logic';
import {
  RESULT_CONTROL_BORDER,
  RESULT_MATRIX_NOT_RAISED,
  RESULT_MATRIX_RAISED,
  RESULT_STATUS_AMBER,
  RESULT_STATUS_GREEN,
  ResultContent,
  ResultStatusScreen,
} from './ResultView';

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function readyView(reviewStatus: 'reviewed' | 'draft' = 'reviewed') {
  const response: ResultGetResponse = {
    scope: 'session',
    scope_id: 'session-1',
    title: '제5차 회의 결과',
    published_at: '2026-08-10T00:00:00Z',
    body: {
      scope: 'session',
      scope_id: 'session-1',
      title: '제5차 회의 결과',
      reviewed_count: reviewStatus === 'reviewed' ? 1 : 0,
      unclassified_count: 0,
      generated_at: '2026-08-10T00:00:00Z',
      issues: [{
        id: 'issue-1',
        label: '대중교통 확대',
        frequency_class: 'consensus',
        stance: 'proposal',
        review_status: reviewStatus,
        consensus_denominator: 2,
        teams: ['1분과 1조', '1분과 2조'],
        implementation: {
          status: 'in_progress',
          responsible_body: '교통정책 담당기관',
          updated_at: '2026-08-12T00:00:00.000Z',
          summary: '대중교통 접근성 개선 계획에 따라 세부 이행을 진행 중입니다.',
          evidence_url: 'https://example.org/implementation-evidence',
        },
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
    expect(html).toContain('쟁점별 방향·빈도·제기 조 수·원문 군집·검수·이행 상태');
    expect(html).toContain('scope="col"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="sr-only">1분과 1조 제기</span>');
    expect(html).toContain('aria-hidden="true" class="inline-block h-3 w-3 rounded-full"');
    expect(html).not.toContain('>●</span>');
    expect(html).not.toContain('aria-label="1분과 1조 제기"');
  });

  it('모바일 가로 스크롤 표를 키보드로 탐색할 수 있다', () => {
    const html = renderToStaticMarkup(createElement(ResultContent, { view: readyView() }));

    expect(html).toContain('class="min-h-screen overflow-x-hidden');
    expect(html).toContain('role="region" aria-label="조별 쟁점 커버리지 표" tabindex="0"');
    expect(html).toContain('role="region" aria-label="쟁점 분석 데이터 표" tabindex="0"');
    expect(html).toContain('style="min-width:720px"');
  });

  it('표의 모든 데이터 셀이 불투명 배경과 명시적 전경색을 제공한다', () => {
    const html = renderToStaticMarkup(createElement(ResultContent, { view: readyView() }));
    const cells = html.match(/<(?:th|td)\b[^>]*>/g) ?? [];

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const background = cell.match(/background:(#[0-9A-F]{6})/)?.[1];
      const foreground = cell.match(/(?:^|;)color:(#[0-9A-F]{6})/)?.[1];

      expect(background).toBe('#FFFFFF');
      expect(foreground).toBeDefined();
      expect(contrastRatio(foreground ?? '#FFFFFF', background ?? '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    }
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
    expect(contrastRatio(RESULT_MATRIX_RAISED, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(RESULT_MATRIX_NOT_RAISED, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    for (const status of Object.values(IMPLEMENTATION_STATUS_META)) {
      expect(contrastRatio(status.foreground, status.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(status.border, status.background)).toBeGreaterThanOrEqual(3);
    }
  });

  it('이행 상태·책임기관·갱신일·공개 설명과 근거 링크를 같은 패널과 표에 제공한다', () => {
    const html = renderToStaticMarkup(createElement(ResultContent, { view: readyView() }));

    expect(html).toContain('Accountability · 이행추적');
    expect(html).toContain('권고 이행 현황');
    expect(html).toContain('이행 정보 등록 1 / 전체 1');
    expect(html).toContain('이행 중');
    expect(html).toContain('교통정책 담당기관');
    expect(html).toContain('대중교통 접근성 개선 계획에 따라 세부 이행을 진행 중입니다.');
    expect(html).toContain('href="https://example.org/implementation-evidence"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('근거 자료 열기 (새 창)');
  });

  it('미검수 쟁점의 배지와 표 대체본이 같은 HITL 상태 계약을 사용한다', () => {
    const html = renderToStaticMarkup(createElement(ResultContent, { view: readyView('draft') }));

    expect(html).toContain('검수 대기 · 초안');
    expect(html).toContain('class="sr-only">: 출처 정보가 없는 초안이며 운영진의 원문 대조와 확정이 필요합니다.</span>');
    expect(html).not.toContain('aria-label="검수 대기 · 초안');
    expect(html).not.toContain('>대기(AI 초안)<');
  });

  it('공개 결과의 산정·검수 과정을 수치 기반 XAI 설명 패널로 제공한다', () => {
    const html = renderToStaticMarkup(createElement(ResultContent, { view: readyView() }));

    expect(html).toContain('결과가 만들어진 과정');
    expect(html).toContain('공개 범위');
    expect(html).toContain('조 단위 집계');
    expect(html).toContain('합의 분류');
    expect(html).toContain('사람 검수');
    expect(html).toContain('쟁점 1개를 분석하고');
    expect(html).toContain('전체 쟁점 1개 중 1개가 검수 완료 상태');
  });
});
