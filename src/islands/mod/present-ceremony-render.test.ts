import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DivisionCeremony from './DivisionCeremony';
import { ResultView } from './DivisionPresentScreen';
import { BallotQrFullscreen } from './BallotPanel';
import { presentVerdict } from './division-present';
import type { CeremonyItem, MotionRound } from './division-vote-logic';

// 재적 60 · 참석 45 → 가결선 30.
const items: CeremonyItem[] = [
  { key: 'a', label: '2-1-안2', title: '가결된 안', yeas: 40, nays: 5 },
  { key: 'b', label: '2-1-안1', title: '부결된 안', yeas: 10, nays: 35 },
  { key: 'd', label: '문구 작성 위임 의결', title: '위임', yeas: 44, nays: 1, kind: 'delegation' },
];
const render = (props: Partial<Parameters<typeof DivisionCeremony>[0]>) =>
  renderToStaticMarkup(
    createElement(DivisionCeremony, { division: 2, enrolled: 60, present: 45, items, sourceLabel: '투표 결과', onExit: () => undefined, ...props }),
  );

describe('세리머니 — 발표 창이 노트북 단계를 그린다', () => {
  it('발표 창(displayOnly)은 단추가 없고 받은 단계를 그린다', () => {
    const html = render({ controlledStep: { phase: 'summary', index: 0 }, displayOnly: true });
    expect(html).toContain('data-phase="summary"');
    expect(html).not.toContain('나가기');
    expect(html).not.toContain('마치기');
    expect(html).not.toContain('이전');
  });
  it('「상정 N건」은 정책 권고안만(위임 제외), 요약에 부결 칸과 위임 의결 따로', () => {
    const intro = render({ controlledStep: { phase: 'intro', index: 0 } });
    expect(intro).toContain('상정 2건');
    const html = render({ controlledStep: { phase: 'summary', index: 0 } });
    expect(html).toMatch(/의결 <span[^>]*>1<\/span>건/);
    expect(html).toContain('data-testid="ceremony-summary-failed"');
    expect(html).toContain('부결된 안');
    expect(html).toContain('문구 작성 위임 의결');
    expect(html).toContain('data-testid="ceremony-summary-delegation"');
  });
  it('노트북 쪽 세리머니는 단계를 알리는 자리가 있다', () => {
    const src = readFileSync(new URL('./DivisionVotePanel.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/onStepChange=\{\(step\) =>\s*presentCtx\.ceremony/);
    expect(src).toContain('presentCtx.ceremony?.(null)');
    expect(src).toContain('ceremony: presentCeremony');
  });
});

describe('발표 창 결과 화면', () => {
  const round = {
    round: 1, requestId: 'a', title: 't', onlineYes: 40, onlineNo: 5, handYes: 0, handNo: 0, enrolled: 60, present: 45, verdict: 'passed', closedAt: 'x',
  } as MotionRound;
  it('가결선 옆 참석·재적, 「투표결과 보기」는 머리줄(가결선과 겹치지 않음)', () => {
    const html = renderToStaticMarkup(
      createElement(ResultView, {
        division: 2, motion: { id: '2-1-안1' } as never, title: 't', yes: 40, no: 5, threshold: 30,
        verdict: presentVerdict(round, false), roundNo: 1, enrolled: 60, present: 45, onShowNames: () => undefined,
      }),
    );
    expect(html).toContain('참석 45 · 재적 60');
    expect(html).toContain('가결선 찬성 30표 이상');
    const btn = html.slice(html.indexOf('data-testid="present-show-names"') - 200, html.indexOf('data-testid="present-show-names"'));
    expect(btn).not.toContain('absolute');
    expect(html.indexOf('present-show-names')).toBeLessThan(html.indexOf('가결선'));
  });
  it('투표 중 QR 화면(발표 창)에는 「투표결과 보기」가 없다', () => {
    const row = { id: 'b', title: 't', status: 'open' as const, token: 'c'.repeat(32), subgroup: '2분과', item_count: 1, response_count: 3, created_at: '' };
    const html = renderToStaticMarkup(
      createElement(BallotQrFullscreen, { ballot: row, onExit: () => undefined, access: { accessToken: 'a'.repeat(64) }, hideExit: true, hideNames: true }),
    );
    expect(html).not.toContain('투표결과 보기');
    const src = readFileSync(new URL('./DivisionPresentScreen.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/access=\{access\} hideExit hideNames/);
  });
});

describe('10/17 v2 — 세리머니 요약·번호, 발표 창 집계 중', () => {
  const long = (k: number) => `${'아주 긴 합친 문구 '.repeat(20)}${k}`;
  const many = (n: number): CeremonyItem[] => [
    ...Array.from({ length: n }, (_, i) => ({ key: `p${i}`, label: `2-${i + 1}-안1`, title: long(i), yeas: 40, nays: 5 })),
    ...Array.from({ length: n }, (_, i) => ({ key: `f${i}`, label: `2-${i + 1}-안2`, title: long(i), yeas: 10, nays: 35 })),
    { key: 'd', label: '문구 작성 위임 의결', title: '위임', yeas: 44, nays: 1, kind: 'delegation' as const },
  ];
  it('가결은 빠짐없이 — 그린 가결 줄 수 == 머리 「의결 N건」, 부결도 전부, 위임 줄 하나', async () => {
    for (const n of [3, 7, 15]) {
      const html = renderToStaticMarkup(
        createElement(DivisionCeremony, { division: 2, enrolled: 60, present: 45, items: many(n), sourceLabel: 's', onExit: () => undefined, controlledStep: { phase: 'summary', index: 0 }, displayOnly: true }),
      );
      const passedBlock = html.slice(html.indexOf('data-testid="ceremony-summary-passed"'), html.indexOf('data-testid="ceremony-summary-failed"'));
      const failedBlock = html.slice(html.indexOf('data-testid="ceremony-summary-failed"'), html.indexOf('data-testid="ceremony-summary-delegation"'));
      expect((passedBlock.match(/data-testid="ceremony-summary-item"/g) ?? []).length).toBe(n);
      expect(html).toContain(`data-passed-count="${n}"`);
      expect((failedBlock.match(/data-testid="ceremony-summary-item"/g) ?? []).length).toBe(n);
      expect((html.match(/data-testid="ceremony-summary-delegation"/g) ?? []).length).toBe(1);
      // 줄마다 한 줄(말줄임) — 긴 제목이 줄을 늘려 겹치지 않게
      expect(passedBlock).toContain('whitespace-nowrap');
    }
  });
  it('요약 배치 — 줄 수 × 줄 높이가 예산 안(15+15까지 22px 이상)', async () => {
    const { summaryLayout, SUMMARY_LIST_BUDGET } = await import('./ceremony-layout');
    for (const [p, f] of [[0, 0], [7, 3], [10, 10], [15, 15]]) {
      const l = summaryLayout(p, f);
      const rows = Math.ceil(p / l.columns) + Math.ceil(f / l.columns);
      expect(rows * l.lineH).toBeLessThanOrEqual(SUMMARY_LIST_BUDGET);
      expect(l.fontPx).toBeGreaterThanOrEqual(22);
    }
    expect(summaryLayout(3, 3).columns).toBe(1);
  });
  it('머리줄 번호는 정책 권고안만 「안 k / N」, 위임 단계는 이름만', async () => {
    const { ceremonyCounter } = await import('./ceremony-layout');
    const its = [{}, { kind: 'delegation' as const }, {}, {}];
    expect(ceremonyCounter(its, 0)).toBe('안 1 / 3');
    expect(ceremonyCounter(its, 1)).toBe('문구 작성 위임 의결');
    expect(ceremonyCounter(its, 3)).toBe('안 3 / 3');
    expect(ceremonyCounter(its, 9)).toBeNull();
    const html = renderToStaticMarkup(
      createElement(DivisionCeremony, { division: 2, enrolled: 60, present: 45, items: many(1), sourceLabel: 's', onExit: () => undefined, controlledStep: { phase: 'title', index: 2 }, displayOnly: true }),
    );
    expect(html).toContain('data-testid="ceremony-counter"');
    expect(html).toContain('문구 작성 위임 의결');
    expect(html).not.toMatch(/안 3 \/ 3/);
  });
  it('발표 창 — 거수 확인 전(집계 중)에는 찬반 숫자를 띄우지 않는다', () => {
    const r = { round: 1, requestId: 'a', title: 't', onlineYes: 40, onlineNo: 5, handYes: 0, handNo: 0, enrolled: 60, present: 45, verdict: 'passed', closedAt: 'x' } as MotionRound;
    const props = { division: 2, motion: { id: '2-1-안1' } as never, title: 't', yes: 40, no: 5, threshold: 30, roundNo: 1 };
    const pending = renderToStaticMarkup(createElement(ResultView, { ...props, verdict: presentVerdict(r, true) }));
    expect(pending).toContain('집계 중');
    expect(pending).not.toContain('data-testid="present-yes"');
    expect(pending).not.toContain('data-testid="present-no"');
    const final = renderToStaticMarkup(createElement(ResultView, { ...props, verdict: presentVerdict(r, false) }));
    expect(final).toContain('data-testid="present-yes"');
  });
  it('결과 머리줄은 오른쪽 위 「전체 화면」 단추 자리를 비운다', () => {
    const src = readFileSync(new URL('./DivisionPresentScreen.tsx', import.meta.url), 'utf8');
    expect(src).toContain('pr-[min(520px,30vw)]');
  });
});
