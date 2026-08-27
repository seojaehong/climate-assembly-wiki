import { describe, expect, it } from 'vitest';
import type { HqSubmissionRow } from '../../lib/hq-submissions';
import { buildBoards, flattenNotes, type TopicBoard } from './hq-submission-board-logic';
import {
  boardToOntologySnapshot,
  contentNodeCount,
  ontologyPreservation,
  ONTOLOGY_SNAPSHOT_SOURCE,
  parseSubmissionNodeId,
  submissionNodeId,
} from './ontology-snapshot';
import { submissionsToCanvasSnapshot as bridgeSnapshotRaw } from '../../../automation/submission-ontology-bridge.mjs';
import fixtureRaw from '../../../automation/fixtures/0829-submissions.json';

/**
 * 원본 브리지는 순수 JS 라 `takenAt` 이 시그니처에서 안 읽힌다(기본값이 없는 인자는 추론이 못 잡는다).
 * 원본을 손대지 않으려고 여기서만 모양을 붙인다.
 */
const submissionsToCanvasSnapshot = bridgeSnapshotRaw as unknown as (
  rows: HqSubmissionRow[],
  opts: { takenAt: string; sessionSlug?: string }
) => {
  payload: {
    agenda: { id: string; text: string; group_id: unknown; parent_id: unknown }[];
    agenda_link: { id: string; source_id: string; target_id: string }[];
  };
};

/**
 * 이 파일이 지키는 한 문장 — **묶어도 카드 수는 줄지 않는다.**
 * 스냅샷은 카드를 온톨로지 검수 큐로 넘기는 입구일 뿐이고, 입구에서 카드가 줄거나
 * 두 문장이 하나로 뭉개지면 그 뒤 어느 단계도 그것을 되살리지 못한다.
 */

const rows = fixtureRaw as HqSubmissionRow[];
const boards = buildBoards(rows);
const AT = '2026-08-29T10:00:00.000Z';

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

describe('submissionNodeId / parseSubmissionNodeId', () => {
  it('id 규격은 0829/t{조2자리}/k{꼭지}/i{항목2자리}(+근거 /r)', () => {
    expect(submissionNodeId({ teamOrdinal: 1, topicOrdinal: 1, itemOrdinal: 1 })).toBe('0829/t01/k1/i01');
    expect(submissionNodeId({ teamOrdinal: 15, topicOrdinal: 3, itemOrdinal: 12 })).toBe('0829/t15/k3/i12');
    expect(submissionNodeId({ teamOrdinal: 2, topicOrdinal: 1, itemOrdinal: 3, isRationale: true })).toBe(
      '0829/t02/k1/i03/r'
    );
  });

  it('id 는 왕복한다 — 노드 하나만 보고도 어느 조 어느 꼭지 몇 번째인지 되짚는다', () => {
    const id = submissionNodeId({ teamOrdinal: 7, topicOrdinal: 2, itemOrdinal: 3 });
    expect(parseSubmissionNodeId(id)).toEqual({
      teamOrdinal: 7,
      topicOrdinal: 2,
      itemOrdinal: 3,
      isRationale: false,
    });
    expect(parseSubmissionNodeId(`${id}/r`)?.isRationale).toBe(true);
  });

  it('규격에 안 맞는 id 는 null 이다', () => {
    expect(parseSubmissionNodeId('canvas-agenda:0829/t01/k1/i01')).toBeNull();
    expect(parseSubmissionNodeId('0829/t1/k1/i01')).toBeNull();
    expect(parseSubmissionNodeId('k1:t1:1')).toBeNull();
  });
});

describe('boardToOntologySnapshot — 모양', () => {
  it('검수 큐가 먹는 { id, source, taken_at, payload } 를 돌려준다', () => {
    const snapshot = boardToOntologySnapshot(boards[0], AT);
    expect(Object.keys(snapshot).sort()).toEqual(['id', 'payload', 'source', 'taken_at']);
    expect(snapshot.source).toBe(ONTOLOGY_SNAPSHOT_SOURCE);
    expect(snapshot.taken_at).toBe(AT);
    expect(snapshot.id).toContain(AT);
    expect(Array.isArray(snapshot.payload.agenda)).toBe(true);
    expect(Array.isArray(snapshot.payload.agenda_link)).toBe(true);
  });

  it('꼭지가 스냅샷 id 에 들어간다 — 같은 시각에 꼭지 셋을 내보내도 안 덮어쓴다', () => {
    const ids = boards.map((board) => boardToOntologySnapshot(board, AT).id);
    expect(new Set(ids).size).toBe(3);
  });

  it('agenda 행은 전부 active·agenda 이고 session_id 가 채워져 있다', () => {
    const snapshot = boardToOntologySnapshot(boards[0], AT, { sessionSlug: '0829-테스트' });
    for (const node of snapshot.payload.agenda) {
      expect(node.status).toBe('active');
      expect(node.kind).toBe('agenda');
      expect(node.session_id).toBe('0829-테스트');
      expect(node.text.length).toBeGreaterThan(0);
    }
  });

  it('takenAt 이 없으면 던진다 — 함수 안에서 시계를 읽지 않는다', () => {
    expect(() => boardToOntologySnapshot(boards[0], '')).toThrow(/takenAt/);
  });

  it('같은 보드·같은 시각이면 같은 결과다(재현 가능)', () => {
    expect(boardToOntologySnapshot(boards[0], AT)).toEqual(boardToOntologySnapshot(boards[0], AT));
  });

  it('보드를 건드리지 않는다', () => {
    const before = JSON.stringify(boards[0]);
    boardToOntologySnapshot(boards[0], AT);
    expect(JSON.stringify(boards[0])).toBe(before);
  });
});

describe('boardToOntologySnapshot — 카드 수 보존', () => {
  it('카드 수 == 근거가 아닌 agenda 행 수 (꼭지 셋 모두)', () => {
    for (const board of boards) {
      const snapshot = boardToOntologySnapshot(board, AT);
      expect(contentNodeCount(snapshot)).toBe(board.totalNotes);
    }
  });

  it('카드 한 장이 정확히 행 하나가 된다 — 합치지 않는다', () => {
    const board = boardOf([
      { team_id: 't1', team_name: '1분과 1조', item_ordinal: 1, item_content: '버스 배차 간격을 줄여야 한다' },
      { team_id: 't2', team_name: '1분과 2조', item_ordinal: 1, item_content: '버스 배차 간격을 줄여야 한다' },
    ]);
    const snapshot = boardToOntologySnapshot(board, AT);
    // 문장이 똑같아도 두 조의 카드는 두 행으로 남는다.
    expect(contentNodeCount(snapshot)).toBe(2);
    expect(snapshot.payload.agenda.map((node) => node.id)).toEqual(['0829/t01/k1/i01', '0829/t02/k1/i01']);
  });

  it('ontologyPreservation 은 삭제 0장을 보고한다', () => {
    const board = boards[0];
    const snapshot = boardToOntologySnapshot(board, AT);
    expect(ontologyPreservation(flattenNotes(board), snapshot)).toEqual({
      submitted: board.totalNotes,
      nodes: board.totalNotes,
      deleted: 0,
      ok: true,
    });
  });

  it('한 장도 안 낸 조가 있어도 카드 수만 세고, 그 조도 순번은 차지한다', () => {
    const board = boardOf([
      { team_id: 't1', team_name: '1분과 1조', item_content: null, item_ordinal: null, submission_id: null },
      { team_id: 't2', team_name: '1분과 2조', item_ordinal: 1, item_content: '두 번째 조가 쓴 줄' },
    ]);
    const snapshot = boardToOntologySnapshot(board, AT);
    expect(contentNodeCount(snapshot)).toBe(1);
    // 빈 조가 t01 을 차지하므로 실제로 쓴 조는 t02 다 — 브리지(.mjs)의 순번 매기기와 같다.
    expect(snapshot.payload.agenda[0].id).toBe('0829/t02/k1/i01');
  });
});

describe('boardToOntologySnapshot — 묶지 않는다', () => {
  it('group_id 와 parent_id 가 모든 행에서 null 이다 (빈 문자열이 아니다)', () => {
    for (const board of boards) {
      for (const node of boardToOntologySnapshot(board, AT).payload.agenda) {
        expect(node.group_id).toBeNull();
        expect(node.parent_id).toBeNull();
      }
    }
  });
});

describe('boardToOntologySnapshot — 근거는 별도 행 + 링크', () => {
  it('근거를 본문에 이어붙이지 않고 /r 행과 링크로 낸다', () => {
    const board = boardOf([
      { item_ordinal: 1, item_content: '무더위쉼터를 늘려야 한다', item_rationale: '올여름 폭염일수가 늘었다' },
    ]);
    const snapshot = boardToOntologySnapshot(board, AT);
    expect(snapshot.payload.agenda.map((node) => [node.id, node.text])).toEqual([
      ['0829/t01/k1/i01', '무더위쉼터를 늘려야 한다'],
      ['0829/t01/k1/i01/r', '올여름 폭염일수가 늘었다'],
    ]);
    expect(snapshot.payload.agenda_link).toEqual([
      {
        id: '0829/t01/k1/i01~r',
        session_id: '0829-deliberation',
        source_id: '0829/t01/k1/i01/r',
        target_id: '0829/t01/k1/i01',
      },
    ]);
    // 관계 이름을 단정하지 않는다 — 「이건 근거다」도 판단이고, 그 판단은 사람이 한다.
    expect(snapshot.payload.agenda_link[0]).not.toHaveProperty('relation');
  });

  it('근거가 없으면 링크도 없다', () => {
    const board = boardOf([{ item_ordinal: 1, item_content: '근거 없이 낸 줄', item_rationale: null }]);
    const snapshot = boardToOntologySnapshot(board, AT);
    expect(snapshot.payload.agenda).toHaveLength(1);
    expect(snapshot.payload.agenda_link).toHaveLength(0);
  });

  it('링크는 언제나 스냅샷 안의 행만 가리킨다', () => {
    for (const board of boards) {
      const snapshot = boardToOntologySnapshot(board, AT);
      const ids = new Set(snapshot.payload.agenda.map((node) => node.id));
      for (const link of snapshot.payload.agenda_link) {
        expect(ids.has(link.source_id)).toBe(true);
        expect(ids.has(link.target_id)).toBe(true);
      }
    }
  });
});

describe('boardToOntologySnapshot — 빈 보드', () => {
  it('카드가 한 장도 없으면 던진다 (빈 스냅샷을 만들지 않는다)', () => {
    const board = boardOf([
      { team_id: 't1', team_name: '1분과 1조', item_content: null, item_ordinal: null, submission_id: null },
    ]);
    expect(board.totalNotes).toBe(0);
    expect(() => boardToOntologySnapshot(board, AT)).toThrow(/항목이 하나도 없다/);
  });

  it('조가 하나도 없는 보드도 던진다', () => {
    const empty: TopicBoard = {
      topicId: 'k9',
      ordinal: 9,
      prompt: '',
      status: 'open',
      teams: [],
      teamsWithNotes: 0,
      totalNotes: 0,
    };
    expect(() => boardToOntologySnapshot(empty, AT)).toThrow(/항목이 하나도 없다/);
  });
});

describe('automation/submission-ontology-bridge.mjs 와 규칙이 같다', () => {
  it('꼭지 셋을 합치면 원본 브리지의 스냅샷과 노드·링크가 정확히 일치한다', () => {
    const expected = submissionsToCanvasSnapshot(rows, { takenAt: AT });

    const agenda = boards.flatMap((board) => boardToOntologySnapshot(board, AT).payload.agenda);
    const links = boards.flatMap((board) => boardToOntologySnapshot(board, AT).payload.agenda_link);

    const key = (node: { id: string; text: string; group_id: unknown; parent_id: unknown }) =>
      JSON.stringify([node.id, node.text, node.group_id, node.parent_id]);
    const linkKey = (link: { id: string; source_id: string; target_id: string }) =>
      JSON.stringify([link.id, link.source_id, link.target_id]);

    expect(agenda.map(key).sort()).toEqual(expected.payload.agenda.map(key).sort());
    expect(links.map(linkKey).sort()).toEqual(expected.payload.agenda_link.map(linkKey).sort());
  });
});
