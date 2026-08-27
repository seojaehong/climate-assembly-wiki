import { flattenNotes, type Note, type TopicBoard } from './hq-submission-board-logic';
import {
  boardToOntologySnapshot,
  ontologyPreservation,
  type OntologyPreservation,
  type OntologySnapshot,
} from './ontology-snapshot';

/**
 * 「온톨로지 검수로 내보내기」의 순수 로직 — 파일 이름·본문·보존 카운트를 만든다.
 *
 * 내려받는 것은 **스냅샷**이지 봉인된 검수 플랜이 아니다. 플랜 봉인(SHA-256)은
 * `automation/canvas-ontology-bridge.mjs` 가 `node:crypto` 로 하는 일이라 브라우저에서 못 한다
 * (`ontology-snapshot.ts` 가 「여기는 입구일 뿐이다」라고 적은 것과 같은 선이다).
 * 받은 파일로 플랜을 만드는 다음 걸음은 `ONTOLOGY_EXPORT_NEXT_STEP` 에 명령 한 줄로 적어 두었다.
 *
 * ★ 언제나 **거르지 않은 꼭지 보드**를 넘긴다. 분과 필터가 걸린 보드를 넘기면 조 순번이 밀려
 * 같은 카드가 다른 분과의 스냅샷과 id 가 충돌한다(`ontology-snapshot.ts` 주석). 그래서 이 모듈의
 * 함수는 **보드 하나만** 받고 카드 목록을 따로 받지 않는다 — 화면이 거른 목록을 실수로 끼워 넣을 자리가 없다.
 */

/** 다운로드 MIME — 검수 큐(`OntologyReviewConsole`)가 파일 선택으로 먹는 것과 같은 형식이다. */
export const ONTOLOGY_EXPORT_MIME = 'application/json;charset=utf-8';

/** 받은 스냅샷으로 검수 플랜을 만드는 명령. 화면에 그대로 띄운다. */
export const ONTOLOGY_EXPORT_NEXT_STEP =
  'node automation/canvas-ontology-bridge.mjs --snapshot <받은파일> --output-plan <플랜파일>';

/**
 * 파일 이름 — 스냅샷 id 를 그대로 쓴다. id 가 `0829-submissions-k{꼭지}-{시각}` 이라
 * 꼭지와 시각이 자동으로 들어간다.
 *
 * ⚠️ ISO 시각의 `:` 는 Windows 파일 이름에 못 쓴다. 영숫자·`_`·`-` 만 남기고 나머지는 `_` 로 바꾼다
 * (`OntologyReviewConsole` 의 `downloadReviewedPlan` 과 같은 규칙).
 */
export function ontologyExportFilename(snapshot: OntologySnapshot): string {
  return `${String(snapshot.id).replaceAll(/[^a-zA-Z0-9_-]/g, '_')}.json`;
}

export type OntologyExportReadiness = {
  exportable: boolean;
  /** 실제로 노드가 되는 카드 수(내용이 빈 카드는 노드가 되지 않는다). */
  noteCount: number;
  /** 못 내보내는 이유 한 줄. 내보낼 수 있으면 null. */
  reason: string | null;
};

/**
 * 내보낼 수 있는가.
 *
 * `boardToOntologySnapshot` 은 카드가 하나도 없으면 **던진다.** 예외는 마지막 방어선이고,
 * 화면은 버튼을 비활성화해서 거기 도달하지 않게 한다 — 그 판정이 여기다.
 *
 * 세는 기준을 `notes.length` 가 아니라 **내용이 빈 카드를 뺀 수**로 둔 이유: 스냅샷 생성기가
 * 빈 내용을 건너뛰므로, 같은 규칙으로 세지 않으면 「버튼은 켜졌는데 스냅샷은 빈」 틈이 생긴다.
 * (`buildBoards` 가 이미 빈 내용을 카드로 만들지 않아 지금은 두 수가 같다. 규칙을 맞춰 둘 뿐이다.)
 */
export function ontologyExportReadiness(notes: Note[]): OntologyExportReadiness {
  const noteCount = notes.filter((note) => note.content.trim()).length;
  if (noteCount === 0) {
    return {
      exportable: false,
      noteCount: 0,
      reason: '아직 조가 쓴 카드가 없습니다 — 한 장이라도 들어오면 내보낼 수 있습니다',
    };
  }
  return { exportable: true, noteCount, reason: null };
}

/**
 * 카운터용 시각.
 *
 * 카운터는 **개수만** 보여주므로 시각이 필요 없다. 그런데 `boardToOntologySnapshot` 은 시각을
 * 요구하므로 고정값을 넣는다. 시각은 스냅샷의 `id`·`taken_at` 에만 실리고 행 수에는 영향이 없다.
 * ★ 화면이 미리 만든 스냅샷을 들고 있다가 그대로 내려받는 사고를 막으려고, 미리보기는 스냅샷을
 * 밖으로 내주지 않고 **개수만** 돌려준다. 내려받을 스냅샷은 누른 순간 실제 시각으로 다시 만든다.
 */
const PRESERVATION_PROBE_TAKEN_AT = '1970-01-01T00:00:00.000Z';

/**
 * 「원문 N장 · 내보냄 N장 · 삭제 0장」의 숫자.
 * 카드가 없으면 스냅샷을 만들지 않고 0을 돌려준다(생성기가 던지는 자리다).
 */
export function ontologyExportPreservation(board: TopicBoard): OntologyPreservation {
  const notes = flattenNotes(board);
  if (ontologyExportReadiness(notes).noteCount === 0) {
    return { submitted: notes.length, nodes: 0, deleted: notes.length, ok: notes.length === 0 };
  }
  const snapshot = boardToOntologySnapshot(board, PRESERVATION_PROBE_TAKEN_AT);
  return ontologyPreservation(notes, snapshot);
}

export type OntologyExportFile = {
  snapshot: OntologySnapshot;
  filename: string;
  mimeType: string;
  /** 내려받을 본문. 사람이 열어 볼 파일이라 들여쓰기를 준다. */
  text: string;
  preservation: OntologyPreservation;
};

/**
 * 내려받을 파일 한 개.
 *
 * @param board 꼭지 하나의 **거르지 않은** 보드
 * @param takenAt ISO 시각 — 호출부가 정한다(모듈이 시계를 읽지 않는다).
 */
export function buildOntologyExport(board: TopicBoard, takenAt: string): OntologyExportFile {
  const snapshot = boardToOntologySnapshot(board, takenAt);
  return {
    snapshot,
    filename: ontologyExportFilename(snapshot),
    mimeType: ONTOLOGY_EXPORT_MIME,
    text: `${JSON.stringify(snapshot, null, 2)}\n`,
    preservation: ontologyPreservation(flattenNotes(board), snapshot),
  };
}
