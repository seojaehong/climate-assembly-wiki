import { describe, it, expect } from 'vitest';
import { sortTeamsStandard, subgroupFilterOptions } from './team-order';

type Row = { id: string; name: string; subgroup: string | null };

function rows(...names: string[]): Row[] {
  return names.map((name, i) => ({
    id: `t${i}`,
    name,
    subgroup: /^(\d+)분과/.exec(name)?.[0] ?? null,
  }));
}

const STANDARD = [
  '1분과 1조', '1분과 2조', '1분과 3조', '1분과 4조', '1분과 5조',
  '2분과 1조', '2분과 2조', '2분과 3조', '2분과 4조', '2분과 5조',
  '3분과 1조', '3분과 2조', '3분과 3조', '3분과 4조', '3분과 5조',
];

describe('sortTeamsStandard', () => {
  it('비정렬 입력을 분과·조 표준 순서로 바꾼다', () => {
    const shuffled = rows('2분과 5조', '1분과 3조', '3분과 1조', '1분과 1조', '2분과 2조');
    expect(sortTeamsStandard(shuffled).map((t) => t.name)).toEqual([
      '1분과 1조',
      '1분과 3조',
      '2분과 2조',
      '2분과 5조',
      '3분과 1조',
    ]);
  });

  it('15개 조 전체를 1분과 1~5조 → 2분과 1~5조 → 3분과 1~5조 순으로 정렬한다', () => {
    const reversed = rows(...[...STANDARD].reverse());
    expect(sortTeamsStandard(reversed).map((t) => t.name)).toEqual(STANDARD);
  });

  it('두 자리 조 번호를 사전순이 아니라 숫자로 비교한다', () => {
    const input = rows('1분과 10조', '1분과 2조', '1분과 1조');
    expect(sortTeamsStandard(input).map((t) => t.name)).toEqual([
      '1분과 1조',
      '1분과 2조',
      '1분과 10조',
    ]);
  });

  it('표준 이름 규칙에 맞지 않는 조는 뒤로 보내고 한국어 사전순으로 정렬한다', () => {
    const input = rows('외부자문단', '2분과 1조', '기획 A조', '1분과 1조');
    expect(sortTeamsStandard(input).map((t) => t.name)).toEqual([
      '1분과 1조',
      '2분과 1조',
      '기획 A조',
      '외부자문단',
    ]);
  });

  it('이름이 같으면 id로 안정적인 전순서를 유지한다', () => {
    const input: Row[] = [
      { id: 'b', name: '1분과 1조', subgroup: '1분과' },
      { id: 'a', name: '1분과 1조', subgroup: '1분과' },
    ];
    expect(sortTeamsStandard(input).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const input = rows('2분과 1조', '1분과 1조');
    const before = input.map((t) => t.name);
    sortTeamsStandard(input);
    expect(input.map((t) => t.name)).toEqual(before);
  });

  it('빈 배열을 허용한다', () => {
    expect(sortTeamsStandard([])).toEqual([]);
  });
});

describe('subgroupFilterOptions', () => {
  it('전체를 맨 앞에 두고 분과를 번호 순으로 나열한다', () => {
    const shuffled = rows('3분과 1조', '1분과 2조', '2분과 4조', '1분과 1조');
    expect(subgroupFilterOptions(shuffled)).toEqual(['전체', '1분과', '2분과', '3분과']);
  });

  it('분과가 없는 조는 옵션에 넣지 않는다', () => {
    const input: Row[] = [
      { id: 'a', name: '1분과 1조', subgroup: '1분과' },
      { id: 'b', name: '외부자문단', subgroup: null },
    ];
    expect(subgroupFilterOptions(input)).toEqual(['전체', '1분과']);
  });

  it('조가 없으면 전체만 반환한다', () => {
    expect(subgroupFilterOptions([])).toEqual(['전체']);
  });
});
