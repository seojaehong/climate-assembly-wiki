import { describe, expect, it } from 'vitest';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { initPrepState, migratePrep, serializePrep, type SimilarGroup } from './division-vote-logic';
import {
  REC_EDIT_CSV_COLUMNS,
  cardRecList,
  checkRecEdits,
  compactRecLines,
  emptiedCards,
  readRecEditTable,
  recDescription,
  recLine,
  remainingRecs,
  motionRecViews,
  fitRecViews,
  recPlainLine,
  planRecEdits,
  type RecEdit,
} from './division-rec-edits';
import { parseCsv } from './division-sheet-import';
import { cardMotionsState, UNTITLED_CARD_TITLE } from './division-card-seed';
import { beginVote, createInputOf, motionRecCsv, resultCsvRows } from './division-vote-flow';

const src = DIVISION_VOTE_FIXTURE[0]; // 2분과: 2-1-1(3) 2-1-2(2) 2-1-3(4) 2-4-1(2) 2-4-6(1, 제목 없음) 2-14-1(1)
const E = (no: string | null, card: string, action: RecEdit['action'], text = '', target = ''): RecEdit => ({ no, card, action, text, target, note: '' });

describe('카드별 남은 세부권고', () => {
  const edits: RecEdit[] = [
    E('2-1-1-1', '2-1-1', '수정', '고친 문구'),
    E('2-1-1-2', '2-1-1', '삭제'),
    E('2-1-1-3', '2-1-1', '이관', '', '2-1-2'),
    E('2-1-3-1', '2-1-3', '흡수', '흡수하며 다듬은 문구', '2-1-2-1'),
    E(null, '2-1-2', '추가', '새로 넣은 세부권고'),
  ];
  it('자기 세부권고에 처리 표시, 옮겨 온 것·추가가 뒤에', () => {
    const a = cardRecList(src, edits, '2-1-1');
    expect(a.map((d) => [d.no, d.mark])).toEqual([['2-1-1-1', 'edited'], ['2-1-1-2', 'deleted'], ['2-1-1-3', 'moved-out']]);
    expect(a[0].text).toBe('고친 문구');
    expect(recLine(a[2])).toBe('2-1-1-3 → 2-1-2(으)로 이동');
    const b = cardRecList(src, edits, '2-1-2');
    expect(b.map((d) => [d.no, d.mark])).toEqual([
      ['2-1-2-1', 'keep'],
      ['2-1-2-2', 'keep'],
      ['2-1-1-3', 'incoming'],
      ['2-1-3-1', 'incoming'],
      ['2-1-2-3', 'added'],
    ]);
    // 옮겨 온 것: 수정 문구가 있으면 그 글, 없으면 원문
    expect(b[2].text).toBe('예시 권고 문장 2-1-1-3입니다.');
    expect(b[3].text).toBe('흡수하며 다듬은 문구');
    expect(recLine(b[3])).toBe('← 2-1-3-1에서 옮겨 옴: 흡수하며 다듬은 문구');
    expect(recLine(b[4])).toBe('2-1-2-3 (추가) 새로 넣은 세부권고');
    expect(remainingRecs(a).map((d) => d.no)).toEqual(['2-1-1-1']);
  });
  it('자기 세부권고가 모두 빠지고 들어온 것도 없으면 「투표 제외 후보」', () => {
    const gone = [E('2-4-1-1', '2-4-1', '삭제'), E('2-4-1-2', '2-4-1', '흡수', '', '2-1-1')];
    expect(emptiedCards(src, gone)).toEqual(['2-4-1']);
    // 다른 카드에서 하나 들어오면 제외 후보가 아니다
    expect(emptiedCards(src, [...gone, E('2-1-2-2', '2-1-2', '이관', '', '2-4-1')])).toEqual([]);
    expect(emptiedCards(src, [])).toEqual([]);
  });
  it('큰 화면은 남은 것만, 최대 줄 수 넘으면 「외 N개」 · 휴대폰 설명은 전부', () => {
    const list = cardRecList(src, [], '2-1-3');
    expect(compactRecLines(list, 2)).toEqual([recLine(list[0]), recLine(list[1]), '외 2개']);
    expect(recDescription(list).split('\n')).toHaveLength(4);
  });
});

describe('검토표 CSV 점검', () => {
  const header = REC_EDIT_CSV_COLUMNS.join(',');
  const table = (lines: string[]) => parseCsv(`﻿${[header, ...lines].join('\r\n')}\r\n`);
  it('머리행이 다르면 거절, 빈 처리는 유지(저장 안 함)', () => {
    expect(readRecEditTable(parseCsv('분과,묶음\r\n')).ok).toBe(false);
    const t = readRecEditTable(table(['2분과,2A,2-1-1,2-1-1-1,,,,']));
    if (!t.ok) throw new Error();
    const c = checkRecEdits(src, t.rows);
    expect(c.errors).toEqual([]);
    expect(c.edits).toEqual([]);
  });
  it('오류 — 없는 번호·카드 불일치·수정/추가 문구 없음·대상 없음·없는 대상·다른 분과·자기 자신·중복·모르는 처리', () => {
    const t = readRecEditTable(
      table([
        '2분과,2A,2-1-1,2-1-1-9,수정,x,,',
        '2분과,2A,2-1-2,2-1-1-1,수정,x,,',
        '2분과,2A,2-1-1,2-1-1-2,수정,,,',
        '2분과,2A,2-1-1,,추가,,,',
        '2분과,2A,2-1-1,2-1-1-3,이관,,,',
        '2분과,2A,2-1-3,2-1-3-1,흡수,,2-9-9-9,',
        '2분과,2A,2-1-3,2-1-3-2,이관,,3-1-1,',
        '2분과,2A,2-1-3,2-1-3-3,흡수,,2-1-3-3,',
        '2분과,2A,2-1-3,2-1-3-3,삭제,,,',
        '2분과,2A,2-1-3,2-1-3-4,보류,,,',
        '2분과,2A,2-9-9,,추가,문구,,',
      ]),
    );
    if (!t.ok) throw new Error();
    const all = checkRecEdits(src, t.rows).errors.join('\n');
    for (const want of [
      '2-1-1-9 가 2분과에 없습니다',
      '2-1-1-1 는 권고카드 2-1-2 의 것이 아닙니다',
      '수정인데 수정 문구가 없습니다',
      '추가인데 수정 문구',
      '이관인데 대상 번호가 없습니다',
      '대상 2-9-9-9 가 2분과에 없습니다',
      '다른 분과',
      '자기 자신',
      '처리 「보류」',
      '권고카드 2-9-9 가 2분과에 없습니다',
    ]) {
      expect(all).toContain(want);
    }
  });
  it('맞바꾸기는 경고, 정상 줄은 처리만 저장', () => {
    const t = readRecEditTable(table(['2분과,2A,2-1-1,2-1-1-1,이관,,2-1-2,', '2분과,2A,2-1-2,2-1-2-1,이관,,2-1-1,', '2분과,2A,2-1-2,,추가,새 문구,,']));
    if (!t.ok) throw new Error();
    const c = checkRecEdits(src, t.rows);
    expect(c.errors).toEqual([]);
    expect(c.warnings.join()).toContain('맞바꾸기');
    expect(c.edits).toHaveLength(3);
  });
});

describe('카드별 안 깔기', () => {
  const groups: SimilarGroup[] = [
    { id: '2B', division: 2, letter: 'B', name: 'b', recs: [], cards: ['2-1-2', '2-1-1'], teams: [], cardTeams: { '2-1-1': '1조', '2-1-2': '3조' } },
    { id: '2A', division: 2, letter: 'A', name: 'a', recs: [], cards: ['2-4-1', '2-4-6'], teams: [] },
  ];
  it('카드 하나 = 안 하나, 제목 = 카드 제목(빈 것은 「(제목 미정)」), 순서 = 묶음 A..G → 카드 번호, 묶음 밖 카드는 뒤', () => {
    const r = cardMotionsState(src, groups);
    expect(r.failed).toEqual([]);
    expect(r.created).toBe(6);
    expect(r.state.motions.map((m) => m.cardNos[0])).toEqual(['2-4-1', '2-4-6', '2-1-1', '2-1-2', '2-1-3', '2-14-1']);
    expect(r.state.motions[1].title).toBe(UNTITLED_CARD_TITLE);
    expect(r.state.motions[0].title).toBe('예시 제목 나-1 지역 순환센터 설치');
    expect(r.state.motions[2].group?.cardTeams).toEqual({ '2-1-1': '1조' });
    expect(r.state.motions.every((m) => m.title.trim())).toBe(true);
  });
  it('판 번호 6 — 순서·세부권고 처리 왕복, 투표 문항 설명은 남은 세부권고', () => {
    const r = cardMotionsState(src, groups);
    const edits = [E('2-1-1-2', '2-1-1', '삭제'), E(null, '2-1-1', '추가', '새 문구')];
    const s = { ...r.state, attendance: { enrolled: 60, present: 45 }, recEdits: edits };
    expect(migratePrep(JSON.parse(serializePrep(s)))).toEqual(s);
    const m = s.motions.find((x) => x.cardNos[0] === '2-1-1')!;
    const b = beginVote(s, [m.id], 'k1');
    if (!b.ok) throw new Error(b.error);
    const rec = b.state.ballots.k1;
    expect(rec.descriptions?.[0].split('\n')).toEqual(['2-1-1-1 예시 권고 문장 2-1-1-1입니다.', '[삭제] 2-1-1-2 예시 권고 문장 2-1-1-2입니다.', '2-1-1-3 예시 권고 문장 2-1-1-3입니다.','[추가] 2-1-1-4 새 문구']);
    expect(createInputOf(rec).items[0].description).toBe(rec.descriptions?.[0]);
    expect(migratePrep(JSON.parse(serializePrep(b.state)))?.ballots.k1.descriptions).toEqual(rec.descriptions);
    // 결과 CSV 맨 끝 칸 = 최종 세부권고
    expect(motionRecCsv(s, m)).toContain('2-1-1-4 (추가) 새 문구');
    const row = resultCsvRows(s).find((x) => x[1] === m.id)!;
    expect(row[25]).toContain('2-1-1-4 (추가) 새 문구');
  });
  it('세부권고 처리가 없는 판은 지금과 같다(설명 없음)', () => {
    const s = { ...initPrepState(src), attendance: { enrolled: 60, present: 45 } };
    const r = cardMotionsState(src, groups);
    const st = { ...r.state, attendance: s.attendance };
    const b = beginVote(st, [st.motions[0].id], 'k1');
    if (!b.ok) throw new Error(b.error);
    expect(b.state.ballots.k1.descriptions).toBeUndefined();
    expect(createInputOf(b.state.ballots.k1).items[0].description).toBeUndefined();
  });
});

describe('세부권고 표시(큰 화면·휴대폰·운영)', () => {
  const edits: RecEdit[] = [
    E('2-1-1-1', '2-1-1', '수정', '고친 문구'),
    E('2-1-1-2', '2-1-1', '삭제'),
    E('2-1-1-3', '2-1-1', '이관', '', '2-1-2'),
    E('2-1-3-1', '2-1-3', '흡수', '', '2-1-2-1'),
    E(null, '2-1-2', '추가', '새로 넣은 세부권고'),
  ];
  it('표시 = 수정·삭제(줄 그음)·→ 대상(줄 그음)·← 원번호·추가', () => {
    const a = motionRecViews(src, edits, ['2-1-1']);
    expect(a.map((v) => [v.tag, v.struck])).toEqual([['수정', false], ['삭제', true], ['→ 2-1-2', true]]);
    const b = motionRecViews(src, edits, ['2-1-2']);
    expect(b.map((v) => v.tag)).toEqual(['', '', '← 2-1-1-3', '← 2-1-3-1', '추가']);
    expect(b.map(recPlainLine).slice(2)).toEqual(['[← 2-1-1-3] 예시 권고 문장 2-1-1-3입니다.', '[← 2-1-3-1] 예시 권고 문장 2-1-3-1입니다.', '[추가] 2-1-2-3 새로 넣은 세부권고']);
    expect(new Set([...a, ...b].map((v) => v.key)).size).toBe(a.length + b.length);
  });
  it('처리 기록이 없는 판은 아무것도 그리지 않는다', () => {
    expect(motionRecViews(src, undefined, ['2-1-1'])).toEqual([]);
  });
  it('줄이 많으면 글자를 줄이고, 그래도 넘으면 「외 N개」', () => {
    const one = motionRecViews(src, [], ['2-1-1'])[0];
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...one, key: `k${i}` }));
    expect(fitRecViews(many(3)).fontPx).toBe(28);
    expect(fitRecViews(many(7)).fontPx).toBeLessThan(28);
    const f = fitRecViews(many(15));
    expect(f.items.length + 1).toBe(10);
    expect(f.more).toBe(6);
    expect(f.items.length + f.more).toBe(15);
    expect(fitRecViews(many(10)).more).toBe(0);
  });
});

describe('검토표 가져오기(planRecEdits)', () => {
  const header = REC_EDIT_CSV_COLUMNS.join(',');
  const rows = (lines: string[]) => {
    const t = readRecEditTable(parseCsv(`${[header, ...lines].join('\r\n')}\r\n`));
    if (!t.ok) throw new Error(t.message);
    return t.rows;
  };
  const base = () => initPrepState(src);
  const file = ['2분과,2A,2-1-1,2-1-1-1,수정,고친 문구,,', '2분과,2A,2-1-1,2-1-1-2,삭제,,,', '2분과,2A,2-4-1,2-4-1-1,흡수,,2-1-3,', '2분과,2A,2-4-1,2-4-1-2,이관,,2-1-2-1,', '2분과,2A,2-1-2,,추가,새 문구,,', '2분과,2A,2-1-3,2-1-3-1,,,,'];
  it('카드별 이전→이후 수·바뀐 줄·빈 카드', () => {
    const p = planRecEdits(base(), rows(file));
    expect(p.errors).toEqual([]);
    expect(p.state.recEdits).toHaveLength(5);
    const d = Object.fromEntries(p.cardDiff.map((c) => [c.card, [c.before, c.after]]));
    expect(d['2-1-1']).toEqual([3, 2]);
    expect(d['2-4-1']).toEqual([2, 0]);
    expect(d['2-1-3']).toEqual([4, 5]);
    expect(d['2-1-2']).toEqual([2, 4]);
    expect(p.emptied).toEqual(['2-4-1']);
    expect(p.changes.filter((c) => c.startsWith('새로'))).toHaveLength(5);
  });
  it('같은 파일을 다시 넣으면 바뀌는 것이 없다(멱등)', () => {
    const once = planRecEdits(base(), rows(file)).state;
    const again = planRecEdits(migratePrep(JSON.parse(serializePrep(once)))!, rows(file));
    expect(again.errors).toEqual([]);
    expect(again.changes).toEqual([]);
    expect(again.cardDiff).toEqual([]);
    expect(JSON.stringify(again.state.recEdits)).toBe(JSON.stringify(once.recEdits));
  });
  it('서버에 있던 처리를 바꾸거나 없애면 줄로 나온다', () => {
    const once = planRecEdits(base(), rows(file)).state;
    const p = planRecEdits(once, rows(['2분과,2A,2-1-1,2-1-1-1,수정,다른 문구,,']));
    expect(p.changes.some((c) => c.startsWith('바뀜'))).toBe(true);
    expect(p.changes.filter((c) => c.startsWith('없어짐'))).toHaveLength(4);
  });
  it('오류가 하나라도 있으면 판을 바꾸지 않는다(전부 아니면 전무)', () => {
    const cur = base();
    const p = planRecEdits(cur, rows([...file, '2분과,2A,2-1-1,2-1-1-3,이관,,3-1-1,']));
    expect(p.errors.length).toBeGreaterThan(0);
    expect(p.state).toBe(cur);
  });
  it('투표 기록이 있는 판은 바꾸지 않는다', () => {
    const r = cardMotionsState(src, []);
    const s = { ...r.state, attendance: { enrolled: 60, present: 45 } };
    const b = beginVote(s, [s.motions[0].id], 'k1');
    if (!b.ok) throw new Error(b.error);
    const p = planRecEdits(b.state, rows(file));
    expect(p.errors[0]).toContain('투표 기록');
    expect(p.state).toBe(b.state);
  });
});
