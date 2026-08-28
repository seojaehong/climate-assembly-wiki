import { describe, expect, it } from 'vitest';
import type { Note } from './hq-submission-board-logic';
import {
  TEAM_PAIR_TERM_LIMIT,
  teamPairOverlaps,
  uniqueCountByTeam,
  uniqueNoteIds,
} from './team-similarity';

function note(teamId: string, ordinal: number, content: string): Note {
  return {
    id: `${teamId}:${ordinal}`,
    teamId,
    teamName: `${teamId}조`,
    tableNo: null,
    subgroup: '1분과',
    ordinal,
    content,
    rationale: null,
  };
}

describe('teamPairOverlaps — 조와 조가 같은 말을 하는지', () => {
  it('겹치는 조 한 쌍을 찾고 겹친 낱말을 함께 돌려준다', () => {
    const notes = [
      note('a', 1, '대중교통 요금 인하가 필요합니다'),
      note('b', 1, '대중교통 요금 인하를 바랍니다'),
      note('c', 1, '학교 급식에 채식 선택지를 늘려 주세요'),
    ];
    const rows = teamPairOverlaps(notes);
    expect(rows).toHaveLength(1);
    expect([rows[0].aTeamId, rows[0].bTeamId].sort()).toEqual(['a', 'b']);
    expect(rows[0].pairCount).toBe(1);
    // 점수만 주면 행사장에서 따질 수가 없다 — 근거가 반드시 실려야 한다.
    expect(rows[0].sharedTerms.length).toBeGreaterThan(0);
    expect(rows[0].sharedTerms).toContain('대중교통');
  });

  it('같은 조 안의 카드끼리는 세지 않는다', () => {
    const notes = [
      note('a', 1, '대중교통 요금 인하가 필요합니다'),
      note('a', 2, '대중교통 요금 인하를 바랍니다'),
    ];
    expect(teamPairOverlaps(notes)).toEqual([]);
  });

  it('(1조,4조)와 (4조,1조)를 한 칸으로 모은다', () => {
    const notes = [
      note('z', 1, '대중교통 요금 인하가 필요합니다'),
      note('a', 1, '대중교통 요금 인하를 바랍니다'),
      note('a', 2, '대중교통 요금 인하 지원'),
    ];
    const rows = teamPairOverlaps(notes);
    expect(rows).toHaveLength(1);
    expect(rows[0].pairCount).toBe(2);
  });

  it('겹친 짝이 많은 조부터 앞에 놓는다', () => {
    const notes = [
      note('a', 1, '대중교통 요금 인하가 필요합니다'),
      note('a', 2, '대중교통 노선 확대가 필요합니다'),
      note('b', 1, '대중교통 요금 인하를 바랍니다'),
      note('b', 2, '대중교통 노선 확대를 바랍니다'),
      note('c', 1, '건물 단열 지원 확대가 필요합니다'),
      note('d', 1, '건물 단열 지원 확대를 바랍니다'),
    ];
    const rows = teamPairOverlaps(notes);
    expect(rows[0].pairCount).toBeGreaterThanOrEqual(rows[rows.length - 1].pairCount);
  });

  it('겹친 낱말은 상한을 넘기지 않는다 — 멀리서 읽을 수 있어야 한다', () => {
    const long = '대중교통 요금 인하 노선 확대 배차 간격 단축 심야 운행 확대 환승 할인';
    const rows = teamPairOverlaps([note('a', 1, long), note('b', 1, long)]);
    expect(rows[0].sharedTerms.length).toBeLessThanOrEqual(TEAM_PAIR_TERM_LIMIT);
  });

  it('카드가 없거나 하나뿐이면 빈 목록', () => {
    expect(teamPairOverlaps([])).toEqual([]);
    expect(teamPairOverlaps([note('a', 1, '대중교통 요금 인하')])).toEqual([]);
  });
});

describe('uniqueNoteIds — 이 조만 말한 것', () => {
  it('아무와도 겹치지 않은 카드만 고른다', () => {
    const notes = [
      note('a', 1, '대중교통 요금 인하가 필요합니다'),
      note('b', 1, '대중교통 요금 인하를 바랍니다'),
      note('c', 1, '학교 급식에 채식 선택지를 늘려 주세요'),
    ];
    const unique = uniqueNoteIds(notes);
    expect(unique.has('c:1')).toBe(true);
    expect(unique.has('a:1')).toBe(false);
    expect(unique.has('b:1')).toBe(false);
  });

  it('겹침의 여집합이다 — 둘을 합치면 전체가 된다', () => {
    const notes = [
      note('a', 1, '대중교통 요금 인하가 필요합니다'),
      note('b', 1, '대중교통 요금 인하를 바랍니다'),
      note('c', 1, '학교 급식 채식 선택지'),
      note('d', 1, '도시 녹지 확충 예산'),
    ];
    const unique = uniqueNoteIds(notes);
    const paired = notes.filter((n) => !unique.has(n.id));
    expect(unique.size + paired.length).toBe(notes.length);
  });

  it('조별 건수를 센다', () => {
    const notes = [
      note('a', 1, '대중교통 요금 인하가 필요합니다'),
      note('b', 1, '대중교통 요금 인하를 바랍니다'),
      note('c', 1, '학교 급식 채식 선택지'),
      note('c', 2, '도시 녹지 확충 예산'),
    ];
    const counts = uniqueCountByTeam(notes);
    expect(counts.get('c')).toBe(2);
    expect(counts.get('a')).toBeUndefined();
  });
});
