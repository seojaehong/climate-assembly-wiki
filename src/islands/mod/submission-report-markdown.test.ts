import { describe, it, expect } from 'vitest';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import { buildBoards } from './hq-submission-board-logic';
import { buildSubmissionReport } from './submission-report';
import {
  reportToMarkdown,
  countMarkdownTableRows,
  MARKDOWN_TABLE_HEADER,
} from './submission-report-markdown';

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
    submission_version: 1,
    submission_updated_at: '2026-08-29T05:00:00Z',
    submission_finalized_at: null,
    item_ordinal: 1,
    item_kind: 'core',
    item_content: '우리는 마을에서 버스 배차 간격이 두 시간이 넘는다는 것을 확인하였다',
    item_rationale: null,
    ...over,
  };
}

const rows = [
  row(),
  row({ item_ordinal: 2, item_content: '우리는 요금이 비싸다는 것을 확인하였다', item_rationale: '7.4 기록' }),
  // 표 칸을 깨뜨릴 수 있는 글자 — 파이프와 줄바꿈이 한 칸 안에 들어 있다.
  row({
    item_ordinal: 3,
    item_content: '우리는 배차 | 요금\n두 가지를 함께 보아야 한다는 것을 확인하였다',
    item_rationale: '7.4 기록 | 현장 메모',
  }),
  row({
    team_id: 'team-2',
    team_name: '1분과 2조',
    table_no: null,
    submission_status: 'final',
    item_content: '우리는 정류장이 멀다는 것을 확인하였다',
  }),
  // 한 장도 안 낸 조 — 표에서 사라지면 안 되고, 「미제출」 줄로 남아야 한다.
  row({
    team_id: 'team-9',
    team_name: '2분과 1조',
    team_subgroup: '2분과',
    submission_status: null,
    item_ordinal: null,
    item_content: null,
    item_rationale: null,
  }),
  row({ topic_id: 't2', topic_ordinal: 2, topic_prompt: '바라는 변화(기대 효과)', item_content: '버스가 자주 오는 상태가 된다' }),
];

const report = buildSubmissionReport(buildBoards(rows), {
  generatedAt: '2026-08-29 14:05',
  scopeLabel: '전체 15개 조',
});
const md = reportToMarkdown(report);

/** 모델이 가진 항목(카드) 수 — 표 행 수와 대조할 기준. */
function modelNoteCount(): number {
  let n = 0;
  for (const topic of report.topics) {
    for (const block of topic.subgroups) {
      for (const team of block.teams) n += team.notes.length;
    }
  }
  return n;
}

describe('reportToMarkdown — 카드 수 보존', () => {
  it('표 데이터 행 수 = 입력 항목 수', () => {
    const items = modelNoteCount();
    expect(items).toBe(5);
    expect(items).toBe(report.totalNotes);
    expect(countMarkdownTableRows(md)).toBe(items);
  });

  it('파이프·줄바꿈이 든 항목도 한 줄을 넘지 않는다', () => {
    // 이스케이프가 깨지면 행이 쪼개져 카드 수가 늘거나(줄바꿈) 칸이 밀린다(파이프).
    expect(md).toContain('배차 \\| 요금 두 가지를');
    expect(countMarkdownTableRows(md)).toBe(report.totalNotes);
    for (const line of md.split('\n').filter((l) => l.startsWith('|'))) {
      // 앞뒤 파이프 포함 5개 = 칸 4개. 파서가 `.slice(1, -1)` 로 양끝을 버린다.
      expect(line.split(/(?<!\\)\|/).length).toBe(MARKDOWN_TABLE_HEADER.length + 2);
    }
  });

  it('모든 항목 내용이 그대로 들어 있다', () => {
    for (const topic of report.topics) {
      for (const block of topic.subgroups) {
        for (const team of block.teams) {
          for (const note of team.notes) {
            const cell = note.content.replace(/\|/g, '\\|').replace(/\n/g, ' ');
            expect(md).toContain(cell);
          }
        }
      }
    }
  });
});

describe('reportToMarkdown — 미제출 조', () => {
  it('개수와 이름을 남긴다 (boardToText 와 같은 정보)', () => {
    expect(report.topics[0].silent).toContain('2분과 1조');
    expect(md).toContain('※ 미제출 1개 조 — 2분과 1조');
  });

  it('미제출 조가 표 행으로 들어가지 않는다', () => {
    const dataRows = md.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && !l.includes('순번'));
    expect(dataRows.some((l) => l.includes('2분과 1조'))).toBe(false);
  });
});

describe('reportToMarkdown — 계층과 라벨', () => {
  it('제목·꼭지·분과 계층을 낸다', () => {
    expect(md.startsWith('# 기후시민회의 조별 산출물\n')).toBe(true);
    expect(md).toContain('## 1. 배경·문제 인식');
    expect(md).toContain('## 2. 바라는 변화(기대 효과)');
    expect(md).toContain('### 1분과');
  });

  it('꼭지 순서를 바꾸지 않는다', () => {
    expect(md.indexOf('## 1. 배경·문제 인식')).toBeLessThan(md.indexOf('## 2. 바라는 변화(기대 효과)'));
  });

  it('조 이름 칸에 테이블 번호·상태 라벨이 함께 온다', () => {
    expect(md).toContain('1분과 1조 (3번 테이블) — 작성 중');
    expect(md).toContain('1분과 2조 — 제출 완료');
  });

  it('표 머리와 구분줄이 꼭지마다 붙는다', () => {
    expect(md).toContain('| 순번 | 이름 | 내용 | 근거 |');
    expect(md).toContain('|---|---|---|---|');
  });

  it('근거가 없으면 빈 칸으로 둔다 — 문장을 만들지 않는다', () => {
    expect(md).toContain('| 1 | 1분과 1조 (3번 테이블) — 작성 중 | 우리는 마을에서 버스 배차 간격이 두 시간이 넘는다는 것을 확인하였다 |  |');
  });

  it('안내 문구로 끝난다', () => {
    expect(md.trimEnd().endsWith(report.notice)).toBe(true);
  });
});
