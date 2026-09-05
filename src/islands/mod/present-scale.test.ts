import { describe, expect, it } from 'vitest';
import type { Note, TeamColumn } from './hq-submission-board-logic';
import { PRESENT_BODY_STEPS, presentScale } from './present-scale';

function team(name: string, contents: string[]): TeamColumn {
  const notes: Note[] = contents.map((content, index) => ({
    id: `${name}:${index + 1}`,
    teamId: name,
    teamName: name,
    tableNo: null,
    subgroup: '1분과',
    ordinal: index + 1,
    submissionId: null,
    submissionUpdatedAt: null,
    itemId: null,
    content,
    rationale: null,
  }));
  return {
    teamId: name,
    teamName: name,
    tableNo: null,
    subgroup: '1분과',
    status: null,
    submissionId: null,
    submissionVersion: null,
    updatedAt: null,
    finalizedAt: null,
    notes,
  };
}

const SHORT = '대중교통 요금을 낮춰 주세요';

describe('presentScale — 값이 어떻게 나오든 읽히게', () => {
  it('분량이 적으면 가장 큰 단계', () => {
    expect(presentScale([team('1조', [SHORT, SHORT])]).body).toBe(PRESENT_BODY_STEPS[0]);
  });

  it('빈 분과도 가장 큰 단계 — 나눗셈이 없어야 한다', () => {
    expect(presentScale([]).body).toBe(PRESENT_BODY_STEPS[0]);
    expect(presentScale([team('1조', [])]).body).toBe(PRESENT_BODY_STEPS[0]);
  });

  it('줄이 많아지면 한 단계 내려간다', () => {
    const many = presentScale([team('1조', Array.from({ length: 45 }, () => SHORT))]);
    expect(many.body).toBeLessThan(PRESENT_BODY_STEPS[0]);
  });

  it('줄 수가 적어도 글이 길면 내려간다 — 두 기준 중 빡빡한 쪽을 따른다', () => {
    const longOne = presentScale([team('1조', ['가'.repeat(4_000)])]);
    expect(longOne.body).toBeLessThan(PRESENT_BODY_STEPS[0]);
  });

  it('★ 24px 아래로는 절대 내려가지 않는다 — 8~15m에서 읽히는 하한', () => {
    const floor = PRESENT_BODY_STEPS[PRESENT_BODY_STEPS.length - 1];
    const monstrous = presentScale([
      team('1조', Array.from({ length: 30 }, () => '가'.repeat(2_000))),
      team('2조', Array.from({ length: 30 }, () => '나'.repeat(2_000))),
      team('3조', Array.from({ length: 30 }, () => '다'.repeat(2_000))),
    ]);
    expect(monstrous.body).toBe(floor);
    expect(monstrous.body).toBeGreaterThanOrEqual(24);
  });

  it('작아질수록 열도 좁아져 한 화면에 더 담긴다', () => {
    const big = presentScale([team('1조', [SHORT])]);
    const small = presentScale([
      team('1조', Array.from({ length: 30 }, () => '가'.repeat(2_000))),
      team('2조', Array.from({ length: 30 }, () => '나'.repeat(2_000))),
    ]);
    expect(small.columnMin).toBeLessThan(big.columnMin);
  });

  it('모든 단계가 조 이름 > 본문을 지킨다', () => {
    const cases = [
      presentScale([team('1조', [SHORT])]),
      presentScale([team('1조', Array.from({ length: 45 }, () => SHORT))]),
      presentScale([team('1조', Array.from({ length: 90 }, () => SHORT))]),
    ];
    for (const scale of cases) {
      expect(scale.teamName).toBeGreaterThan(scale.body);
      expect(scale.body).toBeGreaterThanOrEqual(24);
    }
  });
});
