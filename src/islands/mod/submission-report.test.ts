import { describe, it, expect } from 'vitest';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import { buildBoards } from './hq-submission-board-logic';
import {
  buildSubmissionReport,
  reportToText,
  reportToCsv,
  reportFileName,
  formatStamp,
  CSV_HEADER,
  REPORT_NOTICE,
} from './submission-report';
import { buildSubmissionReportDoc } from './submission-report-docx';

function row(over: Partial<HqSubmissionRow> = {}): HqSubmissionRow {
  return {
    topic_id: 't1',
    topic_ordinal: 1,
    topic_prompt: '배경·문제 인식',
    topic_status: 'open',
    team_id: 'team-1',
    team_name: '1분과 1조',
    team_subgroup: '1분과',
    table_no: '3',
    submission_id: 'sub-1',
    submission_status: 'draft',
    submission_updated_at: '2026-08-29T05:00:00Z',
    submission_finalized_at: null,
    item_ordinal: 1,
    item_kind: 'core',
    item_content: '우리는 마을에서 버스 배차 간격이 두 시간이 넘는다는 것을 확인하였다',
    item_rationale: null,
    ...over,
  };
}

const boards = buildBoards([
  row(),
  row({ item_ordinal: 2, item_content: '우리는 요금이 비싸다는 것을 확인하였다', item_rationale: '7.4 기록' }),
  row({ team_id: 'team-2', team_name: '1분과 2조', table_no: null, submission_status: 'final', item_content: '우리는 정류장이 멀다는 것을 확인하였다' }),
  row({ team_id: 'team-9', team_name: '2분과 1조', team_subgroup: '2분과', submission_status: null, item_ordinal: null, item_content: null, item_rationale: null }),
  row({ topic_id: 't2', topic_ordinal: 2, topic_prompt: '바라는 변화(기대 효과)', item_content: '버스가 자주 오는 상태가 된다' }),
]);

const report = buildSubmissionReport(boards, {
  generatedAt: '2026-08-29 14:05',
  scopeLabel: '전체 15개 조',
});

describe('formatStamp', () => {
  // Intl·toLocale*을 쓰지 않는다는 저장소 관례 — 환경마다 결과가 갈린다.
  it('formats without Intl', () => {
    expect(formatStamp(new Date(2026, 7, 29, 9, 5))).toBe('2026-08-29 09:05');
  });
});

describe('buildSubmissionReport', () => {
  it('keeps 꼭지 order and counts', () => {
    expect(report.topics.map((t) => t.prompt)).toEqual(['배경·문제 인식', '바라는 변화(기대 효과)']);
    expect(report.topics[0].totalNotes).toBe(3);
    expect(report.totalNotes).toBe(4);
  });

  it('groups teams under 분과', () => {
    expect(report.topics[0].subgroups.map((b) => b.subgroup)).toEqual(['1분과', '2분과']);
  });

  // 회의자료의 소수의견 삭제 금지 — 안 낸 조도 이름이 문서에 남아야 한다.
  it('names the teams that submitted nothing', () => {
    expect(report.topics[0].silent).toContain('2분과 1조');
  });

  it('carries 최종 제출 status onto the team', () => {
    const one = report.topics[0].subgroups[0].teams.find((t) => t.teamName === '1분과 2조');
    expect(one?.statusLabel).toBe('최종 제출');
  });

  // 순서를 바꾸거나 합치지 않는다 — 조가 쓴 그대로.
  it('preserves each sentence verbatim and in order', () => {
    const first = report.topics[0].subgroups[0].teams[0];
    expect(first.notes.map((n) => n.content)).toEqual([
      '우리는 마을에서 버스 배차 간격이 두 시간이 넘는다는 것을 확인하였다',
      '우리는 요금이 비싸다는 것을 확인하였다',
    ]);
  });

  it('renumbers notes from 1 within a team', () => {
    expect(report.topics[0].subgroups[0].teams[0].notes.map((n) => n.ordinal)).toEqual([1, 2]);
  });
});

describe('reportToText', () => {
  const text = reportToText(report);

  it('writes the header with scope and total', () => {
    expect(text).toContain('2026-08-29 14:05 · 전체 15개 조 · 총 4건');
  });

  it('writes 꼭지 · 분과 · 조 · 문장 · 근거', () => {
    expect(text).toContain('■ 1. 배경·문제 인식');
    expect(text).toContain('[1분과]');
    expect(text).toContain('1분과 1조 (3번 테이블)');
    expect(text).toContain('1. 우리는 마을에서 버스 배차 간격이 두 시간이 넘는다는 것을 확인하였다');
    expect(text).toContain('(근거) 7.4 기록');
  });

  it('names the silent teams', () => {
    expect(text).toContain('※ 미제출 1개 조 — 2분과 1조');
  });

  it('ends with the notice', () => {
    expect(text.trim().endsWith(REPORT_NOTICE)).toBe(true);
  });
});

describe('reportToCsv', () => {
  const csv = reportToCsv(report);
  const lines = csv.split('\r\n').filter(Boolean);

  // BOM이 없으면 엑셀이 한글을 깨서 연다.
  it('starts with a BOM so Excel opens Korean correctly', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('writes the header row', () => {
    // 첫 줄 앞에는 BOM이 붙는다(엑셀 한글 깨짐 방지) — 비교 전에 떼어낸다.
    expect(lines[0].replace(/^﻿/, '')).toBe(CSV_HEADER.map((h) => `"${h}"`).join(','));
  });

  it('writes one row per sentence', () => {
    // 문장 4건 + 미제출 조 1행 = 5
    expect(lines.length - 1).toBe(5);
  });

  // 아무것도 안 쓴 조도 한 줄로 남는다 — 좌석 번호는 그대로 두고 상태만 「미제출」.
  it('keeps a row for the team that wrote nothing', () => {
    expect(csv).toContain('"2분과 1조","3","미제출","","",""');
  });

  it('escapes double quotes instead of breaking the row', () => {
    const quoted = buildSubmissionReport(buildBoards([row({ item_content: '그는 "안 된다"고 말했다' })]), {
      generatedAt: '2026-08-29 14:05',
      scopeLabel: '1분과 1조',
    });
    expect(reportToCsv(quoted)).toContain('"그는 ""안 된다""고 말했다"');
  });
});

describe('reportFileName', () => {
  it('builds a dated name per extension', () => {
    expect(reportFileName(report, 'docx')).toBe('기후시민회의_조별산출물_전체15개조_20260829-1405.docx');
    expect(reportFileName(report, 'csv')).toBe('기후시민회의_조별산출물_전체15개조_20260829-1405.csv');
  });

  it('strips characters a filename cannot hold', () => {
    const odd = buildSubmissionReport(boards, { generatedAt: '2026-08-29 14:05', scopeLabel: '1분과/2분과' });
    expect(reportFileName(odd, 'txt')).not.toContain('/');
  });
});

describe('buildSubmissionReportDoc', () => {
  it('builds a document without throwing', () => {
    expect(() => buildSubmissionReportDoc(report)).not.toThrow();
  });

  it('builds for an empty report too', () => {
    const empty = buildSubmissionReport([], { generatedAt: '2026-08-29 14:05', scopeLabel: '전체 15개 조' });
    expect(() => buildSubmissionReportDoc(empty)).not.toThrow();
    expect(empty.totalNotes).toBe(0);
  });
});
