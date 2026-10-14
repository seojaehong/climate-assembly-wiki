import { describe, expect, it } from 'vitest';
import {
  divisionBallotTitle,
  isDivisionDecisionBallot,
  motionStatementOf,
  parseMotionStatement,
} from './division-ballot-format';
import { buildDivisionBallot, initPrepState, createMotion } from '../islands/mod/division-vote-logic';
import { DIVISION_VOTE_FIXTURE } from '../islands/mod/division-vote-fixture';

describe('분과 의결 투표 모양 — 오퍼레이터 화면과 투표자 화면이 같은 규칙', () => {
  it('문항 문장 ↔ 안 번호·안 제목', () => {
    expect(motionStatementOf('1-2-안3', '  합친 문구  ')).toBe('1-2-안3 합친 문구');
    expect(parseMotionStatement('1-2-안3 합친 문구\n둘째 줄')).toEqual({ id: '1-2-안3', title: '합친 문구\n둘째 줄' });
    expect(parseMotionStatement('일반 의제 문장입니다')).toBeNull();
    expect(parseMotionStatement('1-2-안3')).toBeNull();
  });

  it('분과 의결 투표만 알아본다 — 일반 분과 의견조사는 아니다', () => {
    expect(isDivisionDecisionBallot({ title: divisionBallotTitle('2분과', '2-1-안1'), subgroup: '2분과' })).toBe(true);
    expect(isDivisionDecisionBallot({ title: '2분과 의결', subgroup: '2분과' })).toBe(true);
    expect(isDivisionDecisionBallot({ title: '2분과 의결 2-1-안1 2차', subgroup: ' 2분과 ' })).toBe(true);
    expect(isDivisionDecisionBallot({ title: '2분과 의견조사', subgroup: '2분과' })).toBe(false);
    expect(isDivisionDecisionBallot({ title: '2분과 의결안 설명회', subgroup: '2분과' })).toBe(false);
    expect(isDivisionDecisionBallot({ title: '1분과 의결 1-1-안1', subgroup: '2분과' })).toBe(false);
    expect(isDivisionDecisionBallot({ title: '2분과 의결', subgroup: null })).toBe(false);
    expect(isDivisionDecisionBallot({ title: '오전 투표', subgroup: undefined })).toBe(false);
  });

  it('buildDivisionBallot 이 만든 투표를 투표자 화면이 분과 의결로 알아보고 문장을 가른다', () => {
    const div2 = DIVISION_VOTE_FIXTURE[0];
    const r = createMotion(initPrepState(div2), { cardNos: ['2-1-1', '2-4-1'], title: '합친 안 제목', text: '' });
    if (!r.ok) throw new Error(r.error);
    const plan = buildDivisionBallot(2, [r.motion], r.motion.id);
    expect(isDivisionDecisionBallot({ title: plan.payload.title, subgroup: plan.payload.subgroup })).toBe(true);
    expect(parseMotionStatement(plan.payload.items[0].statement)).toEqual({ id: '2-1-안1', title: '합친 안 제목' });
  });
});
