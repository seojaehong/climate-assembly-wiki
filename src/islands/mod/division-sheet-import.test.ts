import { describe, expect, it } from 'vitest';
import { importSimilarGroups, initPrepState, updateMotion, type PrepState, type SimilarGroup } from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { BUNDLE_CSV_COLUMNS, bundleCsvRows, bundleCsvText, bundleViews, setBundleRecord } from './division-bundle';
import { setReviewer } from './division-reviewers';
import { applySheet, parseCsv, readDecision, readSheet, readTeams, sheetFileErrors } from './division-sheet-import';

// 가상 데이터(실명 아님).
const G = (id: string, cards: string[], cardTeams: Record<string, string>): SimilarGroup => ({
  id, division: 2, letter: id.slice(-1), name: `묶음${id}`, level: '높음', common: '', recs: [], cards, teams: [], cardTeams,
});
function seeded(): PrepState {
  return importSimilarGroups(initPrepState(DIVISION_VOTE_FIXTURE[0]), [
    G('2A', ['2-1-1', '2-1-2'], { '2-1-1': '1조', '2-1-2': '3조' }),
    G('2B', ['2-4-1'], { '2-4-1': '2조' }),
  ]).state;
}
const HEADER = BUNDLE_CSV_COLUMNS.join(',');
const ids = (s: PrepState) => Object.fromEntries(bundleViews(s).map((v) => [v.id, v.motions.map((m) => m.id)]));

function csv(lines: string[]): string {
  return `﻿${[HEADER, ...lines].join('\r\n')}\r\n`;
}

describe('CSV 읽기', () => {
  it('따옴표 안 쉼표·줄바꿈·"" 와 BOM·CRLF', () => {
    expect(parseCsv('﻿a,"b,c","d\r\ne","f""g"\r\n\r\nx,y\r\n')).toEqual([['a', 'b,c', 'd\r\ne', 'f"g'], ['x', 'y']]);
  });
  it('머리행이 글자까지 같아야 한다', () => {
    expect(readSheet('분과,묶음\r\n').ok).toBe(false);
    expect(readSheet(csv([])).ok).toBe(true);
  });
  it('결론·참여 조 판독', () => {
    expect(readDecision('합친다(카드를 통째로 합치기)')).toBe('merge');
    expect(readDecision('옮긴다')).toBe('move');
    expect(readDecision('따로 둔다')).toBe('separate');
    expect(readDecision('')).toBeNull();
    expect(readDecision('보류')).toBeUndefined();
    expect(readTeams('3조 1조')).toEqual(['1', '3']);
    expect(readTeams('1,2')).toEqual(['1', '2']);
    expect(readTeams('6조')).toBeUndefined();
  });
});

describe('왕복 — 내보낸 묶음 기록 CSV 를 그대로 넣으면 판이 그대로', () => {
  it('기록·제목·검토위원이 있는 판', () => {
    let s = seeded();
    const a1 = bundleViews(s)[0].motions[0].id;
    s = updateMotion(s, a1, { title: '다회용기, "보급"과 회수' });
    s = setBundleRecord(s, '2A', { decision: 'merge', movedRecs: '2-1-2-1 → 통합1', minority: '보증금은\n따로' });
    s = setReviewer(s, '2', '가나다');
    const sheet = readSheet(bundleCsvText(bundleCsvRows(s)));
    if (!sheet.ok) throw new Error(sheet.message);
    const r = applySheet(s, sheet.rows);
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([]);
    expect(r.overwrites).toEqual([]);
    expect(r.state).toEqual(s);
  });
  it('막 깐 판(미리 채운 참여 조만)', () => {
    const s = seeded();
    const sheet = readSheet(bundleCsvText(bundleCsvRows(s)));
    if (!sheet.ok) throw new Error(sheet.message);
    const r = applySheet(s, sheet.rows);
    expect(r.errors).toEqual([]);
    expect(r.state).toEqual(s);
  });
});

describe('시트 적용', () => {
  it('기록·제목·검토위원을 바꾸고, 안번호를 비우면 그 묶음에 안을 더한다', () => {
    const s = seeded();
    const a1 = bundleViews(s)[0].motions[0].id;
    const sheet = readSheet(
      csv([
        `2분과,2A,묶음2A,높음,,합친다,1조 3조,${a1},다회용기 보급과 회수 체계,2-1-2-1,`,
        `2분과,2A,묶음2A,높음,,합친다,1조 3조,,보증금 제도는 따로,2-1-2-1,`,
        `2분과,2B,묶음2B,높음,,따로 둔다,2조,,,,소수 의견`,
        `2분과,검토위원,,,,,4조,,,,,라마바`,
      ]),
    );
    if (!sheet.ok) throw new Error(sheet.message);
    const r = applySheet(s, sheet.rows, new Map([['2분과 4조', ['라마바']]]));
    expect(r.errors).toEqual([]);
    expect(r.overwrites).toEqual([]);
    const v = bundleViews(r.state);
    expect(v[0].motions.map((m) => m.title)).toEqual(['다회용기 보급과 회수 체계', '보증금 제도는 따로']);
    expect(r.state.bundles?.['2A']).toEqual({ decision: 'merge', teams: ['1', '3'], movedRecs: '2-1-2-1', minority: '' });
    expect(r.state.bundles?.['2B']?.decision).toBe('separate');
    expect(r.state.reviewers).toEqual({ '4': '라마바' });
    expect(r.warnings).toEqual([]);
    // 더한 안은 「이 묶음에서 안 하나 더」와 같은 번호 규칙
    expect(ids(r.state)['2A']).toHaveLength(2);
  });
  it('없는 안번호는 다음 번호일 때만 만든다', () => {
    const s = seeded();
    const next = '2-1-안2';
    const ok = readSheet(csv([`2분과,2A,묶음2A,높음,,합친다,1조,${next},둘째 안,,`]));
    if (!ok.ok) throw new Error();
    expect(applySheet(s, ok.rows).errors).toEqual([]);
    const bad = readSheet(csv([`2분과,2A,묶음2A,높음,,합친다,1조,2-1-안9,엉뚱한 번호,,`]));
    if (!bad.ok) throw new Error();
    expect(applySheet(s, bad.rows).errors[0]).toContain('2-1-안9');
  });
  it('오류는 분과 전체를 막는다 — 모르는 묶음·결론·조·세부권고·남의 안·중복·긴 제목', () => {
    const s = seeded();
    const a1 = bundleViews(s)[0].motions[0].id;
    const b1 = bundleViews(s)[1].motions[0].id;
    const sheet = readSheet(
      csv([
        `2분과,2Z,없는묶음,,,합친다,1조,,,,`,
        `2분과,2A,묶음2A,높음,,보류,1조,${a1},제목,,`,
        `2분과,2B,묶음2B,높음,,합친다,7조,${b1},제목,,`,
        `2분과,2B,묶음2B,높음,,합친다,7조,,,9-9-9-9,`,
        `2분과,2A,묶음2A,높음,,합친다,1조,${b1},남의 안,,`,
        `2분과,2A,묶음2A,높음,,합친다,1조,${a1},${'가'.repeat(300)},,`,
      ]),
    );
    if (!sheet.ok) throw new Error();
    const r = applySheet(s, sheet.rows);
    const all = r.errors.join('\n');
    for (const want of ['2Z', '보류', '7조', '9-9-9-9', '묶음 2A의 안이 아닙니다', '너무 깁니다', `${a1} 가`]) expect(all).toContain(want);
    expect(r.state).toBe(s);
  });
  it('서버에 사람이 넣은 값을 바꾸면 「덮어씀」으로 센다', () => {
    let s = seeded();
    const a1 = bundleViews(s)[0].motions[0].id;
    s = updateMotion(s, a1, { title: '현장 문구' });
    s = setBundleRecord(s, '2A', { minority: '현장 소수의견' });
    s = setReviewer(s, '1', '가나다');
    const sheet = readSheet(
      csv([`2분과,2A,묶음2A,높음,,합친다,1조 3조,${a1},시트 문구,,시트 소수의견`, `2분과,검토위원,,,,,1조,,,,,라마바`]),
    );
    if (!sheet.ok) throw new Error();
    const r = applySheet(s, sheet.rows, new Map([['2분과 1조', ['가나다']]]));
    expect(r.overwrites).toEqual([`${a1} 제목`, '묶음 2A minority', '검토위원 1조']);
    expect(r.warnings.join()).toContain('라마바');
    expect(r.changes.some((c) => c.includes('현장 문구') && c.includes('시트 문구'))).toBe(true);
  });
  it('따로 둔다인데 제목이 있으면 경고', () => {
    const s = seeded();
    const b1 = bundleViews(s)[1].motions[0].id;
    const sheet = readSheet(csv([`2분과,2B,묶음2B,높음,,따로 둔다,2조,${b1},제목 있음,,`]));
    if (!sheet.ok) throw new Error();
    expect(applySheet(s, sheet.rows).warnings.join()).toContain('따로 둔다인데 안 제목');
  });
  it('투표 기록이 있는 분과는 건드리지 않는다, 모르는 분과 줄은 파일 오류', () => {
    const s = { ...seeded(), ballots: { x: {} as never } };
    const sheet = readSheet(csv([`2분과,2A,묶음2A,높음,,합친다,1조,,,,`, `9분과,9A,,,,,,,,,`]));
    if (!sheet.ok) throw new Error();
    expect(applySheet(s, sheet.rows).errors[0]).toContain('투표 기록');
    expect(sheetFileErrors(sheet.rows, [1, 2, 3])).toHaveLength(1);
  });
});

describe('다시 넣기 — 안번호 빈 줄은 같은 제목의 안을 다시 만들지 않는다', () => {
  it('같은 CSV 를 두 번 적용해도 안 수가 그대로, 둘째에는 「그대로」', () => {
    const s0 = seeded();
    const a1 = bundleViews(s0)[0].motions[0].id;
    const text = csv([
      `2분과,2A,묶음2A,높음,,합친다,1조 3조,${a1},첫 안,,`,
      `2분과,2A,묶음2A,높음,,합친다,1조 3조,,보증금 제도는 따로,,`,
    ]);
    const sheet = readSheet(text);
    if (!sheet.ok) throw new Error();
    const once = applySheet(s0, sheet.rows);
    expect(once.errors).toEqual([]);
    const twice = applySheet(once.state, sheet.rows);
    expect(twice.errors).toEqual([]);
    expect(twice.changes).toEqual([]);
    expect(twice.unchanged).toHaveLength(1);
    expect(twice.state).toEqual(once.state);
    expect(ids(twice.state)['2A']).toHaveLength(2);
  });
  it('앞뒤 공백만 다른 제목도 같은 안으로 본다', () => {
    const s0 = seeded();
    const first = readSheet(csv([`2분과,2B,묶음2B,높음,,합친다,2조,,순환센터 설치,,`]));
    const again = readSheet(csv([`2분과,2B,묶음2B,높음,,합친다,2조,,  순환센터 설치 ,,`]));
    if (!first.ok || !again.ok) throw new Error();
    const a = applySheet(s0, first.rows);
    const b = applySheet(a.state, again.rows);
    expect(ids(b.state)['2B']).toEqual(ids(a.state)['2B']);
  });
});
