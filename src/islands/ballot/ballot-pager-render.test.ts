import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BallotItem } from '../../lib/ballot';
import { PagerItemView, PagerSummaryView } from './BallotPager';

const items: BallotItem[] = Array.from({ length: 28 }, (_, i) => ({
  id: `item-${i + 1}`,
  ordinal: i + 1,
  statement: `2-${i + 1}-안1 가상 권고 제목 ${i + 1}`,
  description: i === 4 ? '세부권고 가상 문장' : null,
  scale: 2 as const,
  required: true,
}));

const noop = () => undefined;

describe('넘김식 — 한 건 화면', () => {
  const html = renderToStaticMarkup(
    createElement(PagerItemView, {
      title: '2분과 의결',
      subgroup: '2분과',
      items,
      pos: 4,
      answers: { 'item-1': 2, 'item-2': 1 },
      flashValue: null,
      disabled: false,
      onChoose: noop,
      onGo: noop,
      voterLine: '2분과 3조 가나다 님',
    }),
  );
  it('위치 「5 / 28」과 「권고안 2-5」, 제목', () => {
    expect(html).toContain('data-testid="pager-position"');
    expect(html).toMatch(/>5 \/ 28</);
    expect(html).toContain('권고안 2-5');
    expect(html).toContain('가상 권고 제목 5');
    expect(html).not.toContain('2-5-안1');
  });
  it('큰 [찬성]/[반대]와 이전 · 다음 · 요약', () => {
    expect(html).toContain('data-testid="pager-yes"');
    expect(html).toContain('data-testid="pager-no"');
    expect(html).toContain('data-testid="pager-prev"');
    expect(html).toContain('data-testid="pager-next"');
    expect(html).toContain('data-testid="pager-to-summary"');
  });
  it('세부권고는 접어 둔다', () => {
    expect(html).toContain('<details');
    expect(html).toContain('세부권고 가상 문장');
  });
  it('일괄 선택 단추가 없다', () => {
    expect(html).not.toMatch(/전부 찬성|모두 찬성|일괄/);
  });
  it('고른 값이 있으면 그 단추가 눌린 상태', () => {
    const h = renderToStaticMarkup(
      createElement(PagerItemView, {
        title: '2분과 의결', subgroup: '2분과', items, pos: 1, answers: { 'item-2': 1 },
        flashValue: null, disabled: false, onChoose: noop, onGo: noop, voterLine: null,
      }),
    );
    expect(h).toMatch(/data-testid="pager-no"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="pager-no"/);
  });
});

describe('넘김식 — 요약 화면', () => {
  const answers: Record<string, number> = {};
  items.forEach((it, i) => {
    if (i === 10 || i === 22) return; // 2-11 · 2-23 미응답
    answers[it.id] = i === 6 || i === 18 ? 1 : 2; // 2-7 · 2-19 반대
  });
  const html = renderToStaticMarkup(
    createElement(PagerSummaryView, {
      title: '2분과 의결',
      items,
      answers,
      submitting: false,
      error: null,
      onGo: noop,
      onSubmit: noop,
      voterLine: '2분과 3조 가나다 님',
    }),
  );
  it('「찬성 24 · 반대 2 · 미응답 2」', () => {
    expect(html).toContain('data-testid="pager-counts"');
    expect(html).toMatch(/찬성 24/);
    expect(html).toMatch(/반대 2/);
    expect(html).toMatch(/미응답 2/);
  });
  it('반대 번호와 미응답 번호가 단추로', () => {
    expect(html).toContain('data-goto="6"');
    expect(html).toContain('data-goto="10"');
    expect(html).toContain('>2-11<');
    expect(html).toContain('>2-19<');
  });
  it('전건 필수에서 빠진 건이 있으면 제출 단추가 꺼진다', () => {
    expect(html).toMatch(/data-testid="pager-submit"[^>]*disabled=""|disabled=""[^>]*data-testid="pager-submit"/);
  });
  it('다 고르면 제출 단추가 켜진다', () => {
    const all = { ...answers, 'item-11': 2, 'item-23': 2 };
    const h = renderToStaticMarkup(
      createElement(PagerSummaryView, {
        title: '2분과 의결', items, answers: all, submitting: false, error: null, onGo: noop, onSubmit: noop, voterLine: null,
      }),
    );
    expect(h).not.toMatch(/data-testid="pager-submit"[^>]*disabled=""|disabled=""[^>]*data-testid="pager-submit"/);
    expect(h).toContain('제출하면 바꿀 수 없습니다');
  });
});
