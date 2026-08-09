import { describe, it, expect } from 'vitest';
import {
  buildResultView,
  buildMatrix,
  rankIssues,
  sortTeams,
  toViewIssue,
  tokenFromPath,
  ratioToPercent,
  HITL_NOTICE_FALLBACK,
  CONSENSUS_RULE_FALLBACK,
  type ResultGetResponse,
  type ResultIssueRaw,
} from './result-view-logic';

function issue(over: Partial<ResultIssueRaw> = {}): ResultIssueRaw {
  return {
    id: over.id ?? 'i1',
    label: over.label ?? '쟁점',
    stance: over.stance ?? null,
    frequency_class: over.frequency_class ?? null,
    summary: over.summary ?? null,
    review_status: over.review_status ?? 'reviewed',
    topic_id: over.topic_id ?? 't1',
    consensus_denominator: over.consensus_denominator ?? 0,
    teams: over.teams ?? [],
  };
}

function response(issues: ResultIssueRaw[], over: Record<string, unknown> = {}): ResultGetResponse {
  return {
    scope: 'session',
    scope_id: 's1',
    title: '제5차 회의 결과',
    published_at: '2026-08-09T01:00:00Z',
    hitl_notice: HITL_NOTICE_FALLBACK,
    body: {
      scope: 'session',
      scope_id: 's1',
      title: '제5차 회의 결과',
      hitl_notice: HITL_NOTICE_FALLBACK,
      consensus_rule: CONSENSUS_RULE_FALLBACK,
      issues,
      reviewed_count: issues.filter((i) => i.review_status === 'reviewed').length,
      unclassified_count: 3,
      generated_at: '2026-08-09T00:59:00Z',
      ...over,
    },
  };
}

describe('tokenFromPath', () => {
  it('/r/<token> 에서 토큰을 뽑는다', () => {
    expect(tokenFromPath('/r/deadbeef00112233')).toBe('deadbeef00112233');
  });
  it('후행 슬래시가 있어도 뽑는다', () => {
    expect(tokenFromPath('/r/abc/')).toBe('abc');
  });
  it('토큰이 없는 /r/ · /r 은 null', () => {
    expect(tokenFromPath('/r/')).toBeNull();
    expect(tokenFromPath('/r')).toBeNull();
  });
  it('빈 값·무관 경로는 null', () => {
    expect(tokenFromPath('')).toBeNull();
    expect(tokenFromPath(null)).toBeNull();
    expect(tokenFromPath('/mod')).toBeNull();
  });
});

describe('buildResultView — 미공개/빈 결과', () => {
  it('null 입력(미공개/미존재)이면 null', () => {
    expect(buildResultView(null)).toBeNull();
  });
  it('body가 없어도 빈 뷰를 만든다(통계 0)', () => {
    const view = buildResultView({ scope: 'topic', title: 'X' } as ResultGetResponse);
    expect(view).not.toBeNull();
    expect(view!.stats.issueCount).toBe(0);
    expect(view!.stats.consensusRatio).toBe(0);
    expect(view!.hitlNotice).toBe(HITL_NOTICE_FALLBACK);
    expect(view!.consensusRule).toBe(CONSENSUS_RULE_FALLBACK);
  });
  it('issues 빈 배열이면 매트릭스도 빈다', () => {
    const view = buildResultView(response([]));
    expect(view!.matrix.teams).toEqual([]);
    expect(view!.matrix.rows).toEqual([]);
    expect(view!.stats.participatingTeams).toBe(0);
  });
});

describe('buildResultView — 합의 비율(분모=전체 쟁점 수)', () => {
  it('합의 1 / 전체 4 = 25%', () => {
    const view = buildResultView(
      response([
        issue({ id: 'a', frequency_class: 'consensus' }),
        issue({ id: 'b', frequency_class: 'majority' }),
        issue({ id: 'c', frequency_class: 'minority' }),
        issue({ id: 'd', frequency_class: 'mixed' }),
      ]),
    )!;
    expect(view.stats.issueCount).toBe(4);
    expect(view.stats.consensusCount).toBe(1);
    expect(view.stats.furtherCount).toBe(3);
    expect(ratioToPercent(view.stats.consensusRatio)).toBe(25);
  });
  it('frequency_class 없는 쟁점은 합의가 아니라 추가숙의로 센다', () => {
    const view = buildResultView(
      response([issue({ id: 'a', frequency_class: 'consensus' }), issue({ id: 'b', frequency_class: null })]),
    )!;
    expect(view.stats.consensusCount).toBe(1);
    expect(view.stats.furtherCount).toBe(1);
  });
});

describe('buildResultView — 검수 상태(draft 섞임)', () => {
  it('draft 2 + reviewed 1 → reviewedCount=1, issueCount=3, isReviewed 정확', () => {
    const view = buildResultView(
      response(
        [
          issue({ id: 'a', review_status: 'draft', frequency_class: 'consensus' }),
          issue({ id: 'b', review_status: 'draft', frequency_class: 'majority' }),
          issue({ id: 'c', review_status: 'reviewed', frequency_class: 'minority' }),
        ],
        { reviewed_count: 1 },
      ),
    )!;
    expect(view.stats.issueCount).toBe(3);
    expect(view.stats.reviewedCount).toBe(1);
    expect(view.issues.map((i) => i.isReviewed)).toEqual([false, false, true]);
    // 검수 대기가 다수여도 합의 비율 분모는 전체 쟁점(3) — reviewed-only로 좁히지 않는다.
    expect(view.stats.issueCount).toBe(3);
  });
});

describe('조×쟁점 매트릭스', () => {
  it('세로=쟁점, 가로=조 합집합(표준순), cell=제기 여부', () => {
    const matrix = buildMatrix([
      toViewIssue(issue({ id: 'a', teams: ['1분과 2조', '1분과 1조'] })),
      toViewIssue(issue({ id: 'b', teams: ['2분과 1조'] })),
    ]);
    expect(matrix.teams).toEqual(['1분과 1조', '1분과 2조', '2분과 1조']);
    expect(matrix.rows[0].cells).toEqual([true, true, false]);
    expect(matrix.rows[1].cells).toEqual([false, false, true]);
  });
});

describe('sortTeams', () => {
  it('분과·조를 사전순이 아니라 숫자로 정렬한다', () => {
    expect(sortTeams(['1분과 10조', '1분과 2조', '2분과 1조', '1분과 1조'])).toEqual([
      '1분과 1조',
      '1분과 2조',
      '1분과 10조',
      '2분과 1조',
    ]);
  });
  it('파싱 불가 이름은 뒤로 붙인다', () => {
    expect(sortTeams(['기타조', '1분과 1조'])).toEqual(['1분과 1조', '기타조']);
  });
});

describe('rankIssues', () => {
  it('제기 조 수 내림차순, 동수면 분모 큰 것 우선', () => {
    const ranked = rankIssues([
      toViewIssue(issue({ id: 'a', label: 'A', teams: ['1분과 1조'], consensus_denominator: 1 })),
      toViewIssue(issue({ id: 'b', label: 'B', teams: ['1분과 1조', '1분과 2조'], consensus_denominator: 2 })),
      toViewIssue(issue({ id: 'c', label: 'C', teams: ['1분과 1조'], consensus_denominator: 5 })),
    ]);
    expect(ranked.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('toViewIssue — 라벨 매핑·폴백', () => {
  it('stance/frequency 한국어 라벨을 붙인다', () => {
    const v = toViewIssue(issue({ stance: 'conditional', frequency_class: 'consensus' }));
    expect(v.stanceLabel).toBe('조건부');
    expect(v.frequencyLabel).toBe('합의');
    expect(v.isConsensus).toBe(true);
  });
  it('label 없으면 (제목 없음), teams 결측이면 빈 배열', () => {
    const v = toViewIssue({ id: 'x' });
    expect(v.label).toBe('(제목 없음)');
    expect(v.teams).toEqual([]);
    expect(v.teamCount).toBe(0);
    expect(v.stanceLabel).toBeNull();
  });
  it('teams 안의 비문자/빈문자를 걸러낸다', () => {
    const v = toViewIssue({ id: 'x', teams: ['1분과 1조', '', ' ', null as unknown as string] });
    expect(v.teams).toEqual(['1분과 1조']);
  });
});
