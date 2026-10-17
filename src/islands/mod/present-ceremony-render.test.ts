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
