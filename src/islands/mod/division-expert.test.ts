import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { attachExpertOpinions, expertTally, parseExpert, parseExpertFile } from './division-expert';
import ExpertNotes from './ExpertNotes';
import { groupRecTexts, initPrepState, migratePrep, serializePrep } from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';

// 가상 의견(실제 전문가 문장 아님).
const OPS = {
  '2-1-1-1': ['②[추가·보완이 꼭 필요한 제안] 예시 보완 의견입니다.', '③[이미 시행 중] 예시 정책이 있습니다.'],
  '2-1-1-2': ['①[기술적으로 불가능] 예시입니다.', '(참고) 분류 없는 예시'],
  '9-9-9-9': ['②[x] 다른 분과'],
  '2-99-1-1': ['④ 원천에 없는 번호'],
};

describe('전문가 의견', () => {
  it('맨 앞 ①~④로 분류하고 꼬리표를 떼어 낸다', () => {
    expect(parseExpert(OPS['2-1-1-1'][0])).toEqual({ cat: 2, tag: '추가·보완이 꼭 필요한 제안', body: '예시 보완 의견입니다.' });
    expect(parseExpert(OPS['2-1-1-2'][1]).cat).toBe(0);
    expect(expertTally([...OPS['2-1-1-1'], ...OPS['2-1-1-2']])).toEqual({ 2: 1, 3: 1, 1: 1, 0: 1 });
  });
  it('파일 판독 — 모양이 틀리면 null', () => {
    expect(parseExpertFile(JSON.stringify(OPS))?.['2-1-1-1']).toHaveLength(2);
    expect(parseExpertFile('[]')).toBeNull();
    expect(parseExpertFile(JSON.stringify({ a: [1] }))).toBeNull();
  });
  it('원천 세부권고에 붙이고(분과 밖 번호는 세지 않음), 두 번 돌려도 같다', () => {
    const s0 = initPrepState(DIVISION_VOTE_FIXTURE[0]);
    const r = attachExpertOpinions(s0, OPS);
    expect(r.attached).toBe(2);
    expect(r.unknown).toEqual(['2-99-1-1']);
    expect(groupRecTexts(r.state.source, ['2-1-1-1'])[0].expert).toHaveLength(2);
    expect(attachExpertOpinions(r.state, OPS).state).toEqual(r.state);
    // 원래 판은 그대로(새 판을 돌려준다)
    expect(s0.source.topics[0].cards[0].recs[0].expert).toBeUndefined();
  });
  it('판 번호 5로 저장·읽기에서 의견이 남는다, 모양이 틀리면 판째 거절', () => {
    const s = attachExpertOpinions(initPrepState(DIVISION_VOTE_FIXTURE[0]), OPS).state;
    const j = JSON.parse(serializePrep(s));
    expect(migratePrep(j)).toEqual(s);
    j.source.topics[0].cards[0].recs[0].expert = [3];
    expect(migratePrep(j)).toBeNull();
  });
  it('화면 — 접혀 있고 분류별 수, 의견 없으면 아무것도 없다', () => {
    const html = renderToStaticMarkup(createElement(ExpertNotes, { opinions: OPS['2-1-1-1'] }));
    expect(html).toContain('<details');
    expect(html).toContain('전문가 의견 2');
    expect(html).toContain('② 추가·보완 필요');
    expect(html).toContain('data-expert-cat="3"');
    expect(renderToStaticMarkup(createElement(ExpertNotes, {}))).toBe('');
  });
});
