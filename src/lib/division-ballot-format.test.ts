import { describe, expect, it } from 'vitest';
import {
  decisionBallotKind,
  divisionBallotTitle,
  isDecisionBallot,
  isDivisionDecisionBallot,
  plenaryAgendaNo,
  plenaryBallotTitle,
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

  it('(11/14) 전체회의 의결 투표지 — 분과 지정 없이 제목 「전체회의 의결 의제N …」로 알아본다', () => {
    const t1 = plenaryBallotTitle(1, '기업 온실가스 감축 촉진');
    expect(t1).toBe('전체회의 의결 의제1 기업 온실가스 감축 촉진');
    expect(plenaryBallotTitle(2)).toBe('전체회의 의결 의제2');
    for (const subgroup of [null, undefined, '', '  ']) {
      expect(decisionBallotKind({ title: t1, subgroup })).toBe('plenary');
      expect(isDecisionBallot({ title: t1, subgroup })).toBe(true);
    }
    expect(decisionBallotKind({ title: '전체회의 의결 의제3', subgroup: null })).toBe('plenary');
    expect(plenaryAgendaNo(t1)).toBe(1);
    expect(plenaryAgendaNo('전체회의 의결 의제3')).toBe(3);
    expect(plenaryAgendaNo('2분과 의결')).toBeNull();
    // 분과 지정이 남아 있으면 전원 투표가 아니다 — 의결 화면으로 켜지 않는다(운영자 실수를 화면에서 드러낸다).
    expect(decisionBallotKind({ title: t1, subgroup: '1분과' })).toBeNull();
    // 모양이 다르면 아니다.
    expect(decisionBallotKind({ title: '전체회의 의결안 설명', subgroup: null })).toBeNull();
    expect(decisionBallotKind({ title: '전체회의 의결 의제10', subgroup: null })).toBeNull();
    expect(decisionBallotKind({ title: '전체회의 의결 의제', subgroup: null })).toBeNull();
    // 분과 의결이라는 옛 판정은 그대로다.
    expect(isDivisionDecisionBallot({ title: t1, subgroup: null })).toBe(false);
    expect(decisionBallotKind({ title: '2분과 의결', subgroup: '2분과' })).toBe('division');
    expect(decisionBallotKind({ title: '2분과 의결', subgroup: null })).toBeNull();
    expect(isDecisionBallot({ title: '오전 투표', subgroup: null })).toBe(false);
  });
});
