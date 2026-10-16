import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DivisionBundleBoard from './DivisionBundleBoard';
import { importSimilarGroups, initPrepState, type SimilarGroup } from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { setBundleRecord } from './division-bundle';

const groups: SimilarGroup[] = [
  { id: '2A', division: 2, letter: 'A', name: '다회용기', level: '높음', common: '보급·회수', cards: ['2-1-1', '2-1-2'], recs: ['2-1-1-1'], teams: ['1조', '3조'], cardTeams: { '2-1-1': '1조', '2-1-2': '3조' } },
];

describe('헤쳐모여 묶음 판(화면)', () => {
  it('묶음 이름표·겹침·카드(조)·결론 세 단추·참여 조·합친 문구·소수의견', () => {
    let s = importSimilarGroups(initPrepState(DIVISION_VOTE_FIXTURE[0]), groups).state;
    s = setBundleRecord(s, '2A', { decision: 'move' });
    const html = renderToStaticMarkup(createElement(DivisionBundleBoard, { state: s, update: () => undefined }));
    expect(html).toContain('A 다회용기');
    expect(html).toContain('겹침 높음');
    expect(html).toContain('2-1-1 (1조) · 2-1-2 (3조)');
    expect(html).toContain('합친다(카드를 통째로 합치기)');
    expect(html).toMatch(/aria-pressed="true"[^>]*data-decision="move"/);
    expect(html).toContain('합친 문구');
    expect(html).toContain('소수의견');
    expect(html).toContain('결론 적은 묶음 1');
  });
  it('A–G 묶음이 없으면 아무것도 그리지 않는다', () => {
    const html = renderToStaticMarkup(createElement(DivisionBundleBoard, { state: initPrepState(DIVISION_VOTE_FIXTURE[0]), update: () => undefined }));
    expect(html).toBe('');
  });
});
