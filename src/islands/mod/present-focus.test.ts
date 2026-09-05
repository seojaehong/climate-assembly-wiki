import { describe, expect, it } from 'vitest';
import type { TeamColumn } from './hq-submission-board-logic';
import { firstFocusTeamId, focusPosition, focusedTeam, stepTeam } from './present-focus';

function team(id: string, noteCount = 0): TeamColumn {
  return {
    teamId: id,
    submissionId: null,
    submissionVersion: null,
    teamName: id,
    tableNo: null,
    subgroup: '1분과',
    status: 'draft',
    updatedAt: null,
    finalizedAt: null,
    notes: Array.from({ length: noteCount }, (_, i) => ({
      id: `${id}-n${i}`,
      content: `${id} 문장 ${i}`,
      rationale: null,
      ordinal: i + 1,
    })) as TeamColumn['notes'],
  };
}

const FIVE = [team('1조'), team('2조'), team('3조'), team('4조'), team('5조')];

describe('focusedTeam', () => {
  it('선택한 조를 돌려준다', () => {
    expect(focusedTeam(FIVE, '3조')?.teamId).toBe('3조');
  });

  it('선택이 없으면 null', () => {
    expect(focusedTeam(FIVE, null)).toBeNull();
  });

  it('갱신으로 조가 사라지면 null — 엉뚱한 조를 대신 띄우지 않는다', () => {
    expect(focusedTeam(FIVE, '없는조')).toBeNull();
  });
});

describe('stepTeam', () => {
  it('다음 조로 간다', () => {
    expect(stepTeam(FIVE, '2조', 1)).toBe('3조');
  });

  it('이전 조로 간다', () => {
    expect(stepTeam(FIVE, '2조', -1)).toBe('1조');
  });

  it('마지막에서 다음을 누르면 처음으로 돌아간다', () => {
    expect(stepTeam(FIVE, '5조', 1)).toBe('1조');
  });

  it('처음에서 이전을 누르면 마지막으로 간다', () => {
    expect(stepTeam(FIVE, '1조', -1)).toBe('5조');
  });

  it('선택이 없으면 방향에 맞는 끝에서 시작한다', () => {
    expect(stepTeam(FIVE, null, 1)).toBe('1조');
    expect(stepTeam(FIVE, null, -1)).toBe('5조');
  });

  it('보던 조가 사라져도 죽지 않는다', () => {
    expect(stepTeam(FIVE, '없는조', 1)).toBe('1조');
  });

  it('조가 하나도 없으면 null', () => {
    expect(stepTeam([], null, 1)).toBeNull();
  });

  it('조가 하나뿐이면 제자리', () => {
    expect(stepTeam([team('1조')], '1조', 1)).toBe('1조');
  });
});

describe('firstFocusTeamId', () => {
  it('★ 쓴 조가 있으면 그 조부터 — 빈 화면으로 시작하지 않는다', () => {
    const teams = [team('1조', 0), team('2조', 0), team('3조', 4)];
    expect(firstFocusTeamId(teams)).toBe('3조');
  });

  it('아무도 안 썼으면 첫 조', () => {
    expect(firstFocusTeamId(FIVE)).toBe('1조');
  });

  it('조가 없으면 null', () => {
    expect(firstFocusTeamId([])).toBeNull();
  });

  it('쓴 조가 여럿이면 앞선 조', () => {
    const teams = [team('1조', 0), team('2조', 2), team('3조', 9)];
    expect(firstFocusTeamId(teams)).toBe('2조');
  });
});

describe('focusPosition', () => {
  it('1부터 세어 돌려준다', () => {
    expect(focusPosition(FIVE, '3조')).toEqual({ at: 3, total: 5 });
  });

  it('선택이 없으면 null', () => {
    expect(focusPosition(FIVE, null)).toBeNull();
  });
});
