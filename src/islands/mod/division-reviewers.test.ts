import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAgendaMotion, initPrepState, migratePrep, serializePrep } from './division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from './division-vote-fixture';
import { isDelegationMotion, reviewerRows, rosterNamesFor, setReviewer } from './division-reviewers';
import { bundleCsvRows } from './division-bundle';
import ReviewerSlots from './ReviewerSlots';

// 가상 명단.
const roster = [
  { team: '2분과 1조', no: 2, name: '나다라' },
  { team: '2분과 1조', no: 1, name: '가나다' },
  { team: '2분과 3조', no: 1, name: '마바사' },
  { team: '1분과 1조', no: 1, name: '아자차' },
];

describe('위임 안건 검토위원', () => {
  it('위임 안 판정 — 로더 열쇠 또는 카드 없는 안건 제목에 「위임」', () => {
    expect(isDelegationMotion({ key: 'baseline-delegate', cardNos: [], title: '' })).toBe(true);
    expect(isDelegationMotion({ cardNos: [], title: '2분과 최종 권고안 문구 작성 위임 의결' })).toBe(true);
    expect(isDelegationMotion({ cardNos: ['2-1-1'], title: '위임' })).toBe(false);
    expect(isDelegationMotion({ key: 'baseline-final', cardNos: [], title: '2분과 최종 권고안 의결' })).toBe(false);
  });
  it('그 분과·그 조 이름만 번호순', () => {
    expect(rosterNamesFor(roster, 2, '1')).toEqual(['가나다', '나다라']);
    expect(rosterNamesFor(roster, 2, '2')).toEqual([]);
    expect(rosterNamesFor(roster, 1, '1')).toEqual(['아자차']);
  });
  it('정하기·지우기, 저장·읽기 왕복, 모양이 틀리면 판째 거절', () => {
    let s = initPrepState(DIVISION_VOTE_FIXTURE[0]);
    s = setReviewer(s, '3', '마바사');
    s = setReviewer(s, '1', '가나 ');
    expect(s.reviewers).toEqual({ '3': '마바사', '1': '가나 ' });
    s = setReviewer(s, '1', '  ');
    expect(s.reviewers).toEqual({ '3': '마바사' });
    const j = JSON.parse(serializePrep(s));
    expect(migratePrep(j)).toEqual(s);
    expect(migratePrep({ ...j, reviewers: { '9': 'x' } })).toBeNull();
    expect(migratePrep({ ...j, reviewers: { '1': 3 } })).toBeNull();
  });
  it('CSV 는 다섯 조 모두(빈 조도 줄), 묶음 기록 CSV 아래 「검토위원」 줄', () => {
    let s = initPrepState(DIVISION_VOTE_FIXTURE[0]);
    s = setReviewer(s, '2', '가나다 ');
    expect(reviewerRows(s)).toEqual([
      ['2분과', '1조', ''],
      ['2분과', '2조', '가나다'],
      ['2분과', '3조', ''],
      ['2분과', '4조', ''],
      ['2분과', '5조', ''],
    ]);
    const rows = bundleCsvRows(s).filter((r) => r[1] === '검토위원');
    expect(rows).toHaveLength(5);
    expect(rows[1][2]).toBe('2조');
    expect(rows[1][8]).toBe('가나다');
  });
  it('화면 — 1조~5조 칸, 위임 안건이 있어도 명단은 서버에서(미리보기는 빈 목록)', () => {
    const made = createAgendaMotion(initPrepState(DIVISION_VOTE_FIXTURE[0]), { title: '최종 권고안 문구 작성 위임 의결', text: '', key: 'baseline-delegate' });
    if (!made.ok) throw new Error();
    const html = renderToStaticMarkup(createElement(ReviewerSlots, { state: setReviewer(made.state, '4', '마바사'), update: () => undefined }));
    expect(html).toContain('검토위원(시민대표)');
    for (const t of ['1조', '2조', '3조', '4조', '5조']) expect(html).toContain(`>${t}<`);
    expect(html).toContain('value="마바사"');
    expect(html).toContain('(1/5)');
    expect(html).not.toMatch(/전화|연락처/);
  });
});

describe('s29 마이그레이션 불변식', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261017_s29_session_roster_read.sql', import.meta.url), 'utf8');
  it('조 토큰 인증·분과 범위·grant/revoke 짝, 쓰기 없음', () => {
    expect(sql).toContain('climate_vote.attendance_token_row(p_token)');
    expect(sql).toContain('climate_vote.team_token_row(p_token)');
    expect(sql).toContain("(nullif(btrim(v_team.subgroup),'') is null or r.subgroup=btrim(v_team.subgroup))");
    expect(sql).toContain('r.session_id=v_team.session_id');
    expect(sql).toContain('grant execute on function climate_vote.ballot_session_roster_v2(text) to anon, authenticated;');
    expect(sql).toContain('revoke execute on function climate_vote.ballot_session_roster_v2(text) from public;');
    expect(sql).not.toMatch(/\b(insert|update|delete)\s/i);
  });
});
