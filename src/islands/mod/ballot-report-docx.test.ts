import { describe, expect, it } from 'vitest';
import {
  REPORT_HOLD_NOTICE,
  REPORT_TITLE,
  ballotReportFileName,
  buildBallotReportDoc,
  buildBallotReportModel,
  formatGeneratedAt,
} from './ballot-report-docx';
import type { BallotResults, SubmissionGetResult, Topic } from '../../lib/deliberation';

function results(overrides: Partial<BallotResults> = {}): BallotResults {
  return {
    id: 'b-1',
    title: '폐회 일괄 투표 — 권고안 지지도',
    status: 'closed',
    responses: 12,
    items: [
      {
        id: 'i-1',
        ordinal: 1,
        statement: '석탄 발전을 2035년까지 단계적으로 감축한다',
        scale: 5,
        n: 12,
        avg: 4.25,
        dist: { '1': 0, '2': 1, '3': 2, '4': 3, '5': 6 },
      },
      {
        id: 'i-2',
        ordinal: 2,
        statement: '신규 도로 건설을 중단한다',
        scale: 2,
        n: 0,
        avg: null,
        dist: {},
      },
    ],
    ...overrides,
  };
}

function topic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: 't-1',
    ordinal: 1,
    block: 'am',
    prompt: '우리 지역 에너지 전환의 우선 과제는?',
    guidance: null,
    status: 'open',
    ...overrides,
  };
}

function submission(overrides: Partial<SubmissionGetResult> = {}): SubmissionGetResult {
  return {
    id: 's-1',
    status: 'final',
    items: [
      { ordinal: 1, kind: 'core', content: '태양광 보급 확대', rationale: '설치 여력이 크다' },
      { ordinal: 2, kind: 'extra', content: '단열 개보수', rationale: null },
    ],
    ...overrides,
  };
}

describe('formatGeneratedAt — 로컬 getter 기반(YYYY-MM-DD HH:mm)', () => {
  it('자릿수를 0으로 채운다', () => {
    expect(formatGeneratedAt(new Date(2026, 7, 8, 9, 5))).toBe('2026-08-08 09:05');
    expect(formatGeneratedAt(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31 23:59');
  });
});

describe('ballotReportFileName', () => {
  it('투표결과보고서_<제목>_<YYYYMMDD>.docx 꼴로 만든다 (공백→밑줄)', () => {
    expect(ballotReportFileName({ title: '폐회 일괄 투표', at: new Date(2026, 7, 29, 14, 32) })).toBe(
      '투표결과보고서_폐회_일괄_투표_20260829.docx',
    );
  });

  it('경로 분리자·Windows 금지 문자를 걸러낸다', () => {
    const name = ballotReportFileName({ title: 'A/B: "안"?', at: new Date(2026, 7, 29) });
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name.endsWith('_20260829.docx')).toBe(true);
  });

  it('제목이 전부 걸러지면 폴백을 쓴다', () => {
    expect(ballotReportFileName({ title: '///', at: new Date(2026, 7, 29) })).toBe(
      '투표결과보고서_투표_20260829.docx',
    );
  });

  it('아주 긴 제목은 60자에서 자른다 (Windows 260자 경로 방지)', () => {
    const name = ballotReportFileName({ title: '가'.repeat(200), at: new Date(2026, 7, 29) });
    expect(name.length).toBeLessThan(100);
    expect(name).toContain('가'.repeat(60));
    expect(name).not.toContain('가'.repeat(61));
  });
});

describe('buildBallotReportModel', () => {
  it('§1 개요 — 투표 제목·대상·의제 수·제출 수·상태를 담는다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: '2026-08-08 14:00' });
    expect(model.title).toBe(REPORT_TITLE);
    expect(model.ballotTitle).toBe('폐회 일괄 투표 — 권고안 지지도');
    expect(model.generatedAtLabel).toBe('2026-08-08 14:00');
    expect(model.overview).toEqual([
      { label: '투표 제목', value: '폐회 일괄 투표 — 권고안 지지도' },
      { label: '대상', value: '세션 전체' },
      { label: '의제 수', value: '2개' },
      { label: '제출 수', value: '12명' },
      { label: '상태', value: '마감됨' },
    ]);
  });

  it('§1 대상 — 분과 한정 투표는 분과명을 적고, 표지 부제에도 병기한다', () => {
    const model = buildBallotReportModel({
      results: results({ subgroup: '1분과' }),
      generatedAtLabel: 'x',
    });
    expect(model.overview.find((row) => row.label === '대상')?.value).toBe('1분과');
    expect(model.ballotTitle).toBe('폐회 일괄 투표 — 권고안 지지도 — 1분과');
  });

  it('§1 대상 — subgroup null(전체)·키 없음(S4 미적용 DB) 모두 세션 전체로 적는다', () => {
    const explicitNull = buildBallotReportModel({
      results: results({ subgroup: null }),
      generatedAtLabel: 'x',
    });
    expect(explicitNull.overview.find((row) => row.label === '대상')?.value).toBe('세션 전체');
    expect(explicitNull.ballotTitle).toBe('폐회 일괄 투표 — 권고안 지지도');

    // results() 기본값은 subgroup 키 자체가 없다 — S4 미적용 DB 응답과 동일한 형태.
    const missingKey = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    expect('subgroup' in results()).toBe(false);
    expect(missingKey.overview.find((row) => row.label === '대상')?.value).toBe('세션 전체');
  });

  it('§2 문항 — ballot-logic 척도 라벨 · 표 · 비율 · 계 행을 만든다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    const first = model.items[0];
    expect(first.heading).toBe('의제 1. 석탄 발전을 2035년까지 단계적으로 감축한다');
    expect(first.meta).toBe('5점 척도 · 응답 12건 · 평균 4.25');
    expect(first.rows).toHaveLength(6); // 값 5 + 계
    expect(first.rows[0]).toEqual({ label: '1 (전혀 동의하지 않습니다)', count: '0', pct: '0%' });
    expect(first.rows[4]).toEqual({ label: '5 (매우 동의합니다)', count: '6', pct: '50%' });
    expect(first.rows[5]).toEqual({ label: '계', count: '12', pct: '100%', emphasis: true });
  });

  it('응답 0건 문항 — 평균 — · 계 비율 —로 적고 NaN을 흘리지 않는다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    const second = model.items[1];
    expect(second.meta).toBe('2점 척도 · 응답 0건 · 평균 —');
    expect(second.rows[0]).toEqual({ label: '1 (반대)', count: '0', pct: '0%' });
    expect(second.rows[1]).toEqual({ label: '2 (찬성)', count: '0', pct: '0%' });
    expect(second.rows[2]).toEqual({ label: '계', count: '0', pct: '—', emphasis: true });
    expect(JSON.stringify(model)).not.toContain('NaN');
  });

  it('§3 — 산출물이 있으면 주제별 항목(구분·내용·근거)을 담는다', () => {
    const model = buildBallotReportModel({
      results: results(),
      generatedAtLabel: 'x',
      topics: [{ topic: topic(), submission: submission() }],
    });
    expect(model.topics).not.toBeNull();
    expect(model.topics![0].heading).toBe('우리 지역 에너지 전환의 우선 과제는?');
    expect(model.topics![0].statusLabel).toBe('최종 제출');
    expect(model.topics![0].rows).toEqual([
      { kindLabel: '핵심', content: '태양광 보급 확대', rationale: '설치 여력이 크다' },
      { kindLabel: '보충', content: '단열 개보수', rationale: '—' },
    ]);
  });

  it('§3 — 산출물이 없거나(topics 미제공) 전부 빈 제출이면 섹션 자체를 만들지 않는다', () => {
    const withoutTopics = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    expect(withoutTopics.topics).toBeNull();

    const emptySubmission = buildBallotReportModel({
      results: results(),
      generatedAtLabel: 'x',
      topics: [{ topic: topic(), submission: { status: null, items: [] } }],
    });
    expect(emptySubmission.topics).toBeNull();
  });

  it('하단 고정 문구(HITL)를 항상 담는다', () => {
    const model = buildBallotReportModel({ results: results(), generatedAtLabel: 'x' });
    expect(model.footer).toBe(REPORT_HOLD_NOTICE);
    expect(model.footer).toBe('본 자료는 잠정 집계이며, 최종 수치는 운영진 검수 후 확정됩니다.');
  });

  it('상태 라벨은 ballot-panel-logic과 같은 문구를 쓴다 (published=결과 공개됨)', () => {
    const model = buildBallotReportModel({
      results: results({ status: 'published' }),
      generatedAtLabel: 'x',
    });
    expect(model.overview.find((row) => row.label === '상태')?.value).toBe('결과 공개됨');
  });
});

describe('buildBallotReportDoc — docx 스모크(브라우저 없이 생성 가능해야 한다)', () => {
  it('§3 포함/미포함 모델 모두 Document를 던지지 않고 만든다', () => {
    const base = buildBallotReportModel({ results: results(), generatedAtLabel: '2026-08-08 14:00' });
    expect(() => buildBallotReportDoc(base)).not.toThrow();
    const withTopics = buildBallotReportModel({
      results: results(),
      generatedAtLabel: '2026-08-08 14:00',
      topics: [{ topic: topic(), submission: submission() }],
    });
    expect(() => buildBallotReportDoc(withTopics)).not.toThrow();
  });
});
