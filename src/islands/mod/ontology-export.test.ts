import { describe, expect, it } from 'vitest';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import {
  buildBoards,
  filterBoardBySubgroup,
  flattenNotes,
  type TopicBoard,
} from './hq-submission-board-logic';
import {
  buildOntologyExport,
  ontologyExportFilename,
  ontologyExportPreservation,
  ontologyExportReadiness,
  ONTOLOGY_EXPORT_MIME,
  ONTOLOGY_EXPORT_NEXT_STEP,
} from './ontology-export';
import { boardToOntologySnapshot, contentNodeCount } from './ontology-snapshot';
import fixtureRaw from '../../../automation/fixtures/0829-submissions.json';

/**
 * 내보내기가 지키는 한 문장 — **내보내도 카드 수는 줄지 않는다.**
 * 화면이 몇 장을 보여주고 있든(분과 필터·검색), 파일에 실리는 것은 꼭지 전체이고 그 수는 원문 수와 같다.
 */

const rows = fixtureRaw as HqSubmissionRow[];
const boards = buildBoards(rows);
const AT = '2026-08-29T10:30:00.000Z';

function row(overrides: Partial<HqSubmissionRow>): HqSubmissionRow {
  return {
    topic_id: 'k1',
    topic_ordinal: 1,
    topic_prompt: '꼭지 1',
    topic_status: 'open',
    team_id: 't1',
    team_name: '1분과 1조',
    team_subgroup: '1분과',
    table_no: null,
    submission_id: 's1',
    submission_status: 'draft',
    submission_updated_at: null,
    submission_finalized_at: null,
    item_ordinal: 1,
    item_content: '내용',
    item_rationale: null,
    ...overrides,
  } as HqSubmissionRow;
}

function boardOf(partials: Partial<HqSubmissionRow>[]): TopicBoard {
  return buildBoards(partials.map(row))[0];
}

describe('ontologyExportFilename', () => {
  it('파일 이름에 꼭지와 시각이 들어간다', () => {
    const snapshot = boardToOntologySnapshot(boards[0], AT);
    const name = ontologyExportFilename(snapshot);
    expect(name).toContain('k1');
    // 시각의 자릿수가 남아 있어야 어느 순간의 스냅샷인지 파일 이름만 보고 안다.
    expect(name).toContain('2026');
    expect(name).toContain('10');
    expect(name.endsWith('.json')).toBe(true);
  });

  it('꼭지가 다르면 파일 이름이 다르다 — 셋을 같은 순간에 내보내도 안 덮어쓴다', () => {
    const names = boards.map((board) => ontologyExportFilename(boardToOntologySnapshot(board, AT)));
    expect(new Set(names).size).toBe(boards.length);
  });

  it('파일 이름에 파일 시스템이 거부하는 글자가 없다', () => {
    const name = ontologyExportFilename(boardToOntologySnapshot(boards[0], AT));
    // ISO 시각의 ':' 는 Windows 파일 이름에 못 쓴다.
    expect(name).not.toContain(':');
    expect(/^[A-Za-z0-9_-]+\.json$/.test(name)).toBe(true);
  });
});

describe('ontologyExportReadiness', () => {
  it('카드가 한 장도 없으면 못 내보내고 이유를 한 줄로 준다', () => {
    const readiness = ontologyExportReadiness([]);
    expect(readiness.exportable).toBe(false);
    expect(readiness.noteCount).toBe(0);
    expect(readiness.reason).toBeTruthy();
  });

  it('카드가 있으면 내보낼 수 있고 이유가 없다', () => {
    const readiness = ontologyExportReadiness(flattenNotes(boards[0]));
    expect(readiness.exportable).toBe(true);
    expect(readiness.noteCount).toBe(flattenNotes(boards[0]).length);
    expect(readiness.reason).toBeNull();
  });

  it('아무 조도 쓰지 않은 꼭지에서는 버튼이 잠긴다 — 생성기의 예외에 도달하지 않는다', () => {
    // 조 자리는 있으나 내용이 없는 보드(buildBoards 가 카드를 만들지 않는다).
    const board = boardOf([{ item_content: '   ', item_ordinal: null }]);
    expect(flattenNotes(board)).toHaveLength(0);
    expect(ontologyExportReadiness(flattenNotes(board)).exportable).toBe(false);
    expect(() => boardToOntologySnapshot(board, AT)).toThrow();
  });
});

describe('ontologyExportPreservation', () => {
  it('원문 수와 내보낼 수가 같고 삭제는 0이다', () => {
    for (const board of boards) {
      const report = ontologyExportPreservation(board);
      expect(report.submitted).toBe(flattenNotes(board).length);
      expect(report.nodes).toBe(report.submitted);
      expect(report.deleted).toBe(0);
      expect(report.ok).toBe(true);
    }
  });

  it('빈 보드에서도 던지지 않는다 — 화면이 카운터를 먼저 그린다', () => {
    const board = boardOf([{ item_content: '' }]);
    expect(ontologyExportPreservation(board)).toEqual({
      submitted: 0,
      nodes: 0,
      deleted: 0,
      ok: true,
    });
  });
});

describe('buildOntologyExport', () => {
  it('본문은 스냅샷 그대로다 — 파싱하면 같은 것이 나온다', () => {
    const file = buildOntologyExport(boards[0], AT);
    expect(JSON.parse(file.text)).toEqual(file.snapshot);
    expect(file.mimeType).toBe(ONTOLOGY_EXPORT_MIME);
    expect(file.filename).toBe(ontologyExportFilename(file.snapshot));
  });

  it('카드 한 장 = agenda 행 하나. 근거가 아닌 행 수가 원문 수와 같다', () => {
    for (const board of boards) {
      const file = buildOntologyExport(board, AT);
      expect(contentNodeCount(file.snapshot)).toBe(flattenNotes(board).length);
      expect(file.preservation.deleted).toBe(0);
      expect(file.preservation.ok).toBe(true);
    }
  });

  it('묶어 보내지 않는다 — group_id 가 전부 빈 값이다', () => {
    const file = buildOntologyExport(boards[0], AT);
    for (const agenda of file.snapshot.payload.agenda) {
      expect(agenda.group_id).toBeNull();
    }
  });

  it('보드를 바꾸지 않는다 — 내보내기는 읽기 전용이다', () => {
    const board = boards[0];
    const before = JSON.stringify(board);
    buildOntologyExport(board, AT);
    expect(JSON.stringify(board)).toBe(before);
  });

  it('시각을 인자로 받는다 — 같은 입력이면 같은 파일이 나온다', () => {
    expect(buildOntologyExport(boards[0], AT).text).toBe(buildOntologyExport(boards[0], AT).text);
    expect(buildOntologyExport(boards[0], AT).filename).not.toBe(
      buildOntologyExport(boards[0], '2026-08-29T11:00:00.000Z').filename
    );
  });

  it('★ 분과로 거른 보드를 넘기면 조 순번이 밀린다 — 화면 필터와 무관하게 전체 보드를 넘겨야 한다', () => {
    const board = boards[0];
    const whole = buildOntologyExport(board, AT);
    const filtered = buildOntologyExport(filterBoardBySubgroup(board, '2분과'), AT);
    // 거른 보드는 카드가 줄고(내보냄 < 원문), 남은 카드조차 t01 부터 다시 매겨져 id 가 어긋난다.
    expect(contentNodeCount(filtered.snapshot)).toBeLessThan(contentNodeCount(whole.snapshot));
    const wholeIds = new Set(whole.snapshot.payload.agenda.map((a) => a.id));
    const drifted = filtered.snapshot.payload.agenda.filter((a) => !wholeIds.has(a.id));
    expect(drifted.length).toBeGreaterThan(0);
  });
});

describe('ONTOLOGY_EXPORT_NEXT_STEP', () => {
  it('받은 파일로 검수 플랜을 만드는 명령을 그대로 담는다', () => {
    // 브라우저는 봉인(SHA-256)을 못 한다 — 다음 걸음이 화면에 있어야 파일이 미아가 되지 않는다.
    expect(ONTOLOGY_EXPORT_NEXT_STEP).toContain('canvas-ontology-bridge.mjs');
    expect(ONTOLOGY_EXPORT_NEXT_STEP).toContain('--snapshot');
    expect(ONTOLOGY_EXPORT_NEXT_STEP).toContain('--output-plan');
  });
});
