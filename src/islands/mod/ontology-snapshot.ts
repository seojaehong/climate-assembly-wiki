import type { Note, TopicBoard } from './hq-submission-board-logic';

/**
 * 취합 보드 → 온톨로지 검수 스냅샷 어댑터 (브라우저에서 도는 판).
 *
 * `automation/submission-ontology-bridge.mjs` 의 규칙을 그대로 옮긴 것이다. 원본은 node 스크립트라
 * 화면에서 못 쓴다 — 여기서는 `node:crypto`·`node:fs` 같은 노드 전용 모듈을 **하나도** 쓰지 않는다
 * (봉인 SHA-256 은 검수 큐 쪽 `canvas-ontology-bridge.mjs` 가 나중에 찍는다. 여기는 입구일 뿐이다).
 *
 * 온톨로지 로직을 새로 만들지 않는다. 이미 있는 검수 큐(`/ko/moderator/ontology-review`)가 먹는
 * 스냅샷 모양으로 바꿔 넘기기만 한다.
 *
 * ── 지키는 것 (회의자료 260811 · 설계문서 §3) ──
 *   1. 조가 쓴 **한 줄 = agenda 행 하나**. 합치지 않는다. 근거가 아닌 행 수 = 카드 수, 언제나.
 *   2. `text` 에 원문을 그대로 싣는다(검수 큐가 이 값을 `sourceText` 로 따로 보관한다).
 *   3. **묶음을 만들지 않는다** — `group_id` 를 비운다. AI가 미리 묶어 보내면 그 묶음이 기정사실이 된다.
 *   4. 근거는 본문에 이어붙이지 않고 **별도 행 + `agenda_link`** 로 둔다. 이어붙이면 시민이 쓴
 *      두 문장이 하나로 뭉개진다.
 *   5. 관계 이름도 비워 보낸다 — 「이건 근거다」라고 단정하는 것도 판단이고, 그 판단은 사람이 한다.
 *   6. 조·꼭지·순번을 노드 id 에 실어 되짚게 한다(`0829/t01/k1/i01`).
 *
 * 설계 근거: `10_작업산출물/2026-08-27_0829_조별입력_3꼭지/취합설계_모이되모으지않는다.md` §2-1·§3.
 */

/** 노드 id 규격 — `0829/t{조순번 2자리}/k{꼭지순번}/i{항목순번 2자리}` (+ 근거는 `/r`). */
const NODE_ID_PATTERN = /^0829\/t(\d{2})\/k(\d)\/i(\d{2})(\/r)?$/;

export type SubmissionNodeRef = {
  teamOrdinal: number;
  topicOrdinal: number;
  itemOrdinal: number;
  isRationale: boolean;
};

/** 노드 id 에서 출처를 되짚는다. 「몇 개 조가 든 묶음인가」를 세려면 이게 필요하다. */
export function parseSubmissionNodeId(id: string): SubmissionNodeRef | null {
  const match = NODE_ID_PATTERN.exec(String(id));
  if (!match) return null;
  return {
    teamOrdinal: Number(match[1]),
    topicOrdinal: Number(match[2]),
    itemOrdinal: Number(match[3]),
    isRationale: Boolean(match[4]),
  };
}

export function submissionNodeId({
  teamOrdinal,
  topicOrdinal,
  itemOrdinal,
  isRationale = false,
}: Omit<SubmissionNodeRef, 'isRationale'> & { isRationale?: boolean }): string {
  const id = `0829/t${String(teamOrdinal).padStart(2, '0')}/k${topicOrdinal}/i${String(itemOrdinal).padStart(2, '0')}`;
  return isRationale ? `${id}/r` : id;
}

/**
 * 검수 큐가 먹는 agenda 행.
 *
 * ⚠️ `group_id`·`parent_id` 의 「빈 값」은 반드시 **`null`** 이다. 빈 문자열을 넣으면
 * `canvas-ontology-bridge.mjs` 의 `optionalString()` 이 `nonemptyString()` 으로 넘겨 **예외를 던진다.**
 */
export type OntologyAgendaRow = {
  id: string;
  session_id: string;
  text: string;
  status: 'active';
  kind: 'agenda';
  group_id: null;
  parent_id: null;
};

/** 근거 → 본문 링크. `relation` 을 아예 두지 않는다(브리지가 후보 전체를 달아준다). */
export type OntologyAgendaLinkRow = {
  id: string;
  session_id: string;
  source_id: string;
  target_id: string;
};

export type OntologySnapshot = {
  id: string;
  source: string;
  taken_at: string;
  payload: {
    agenda: OntologyAgendaRow[];
    agenda_link: OntologyAgendaLinkRow[];
  };
};

/** 스냅샷 출처 — 원문이 실제로 사는 표 이름. 검수 플랜에 그대로 기록된다. */
export const ONTOLOGY_SNAPSHOT_SOURCE = 'climate_vote.submission_item';

export const DEFAULT_SESSION_SLUG = '0829-deliberation';

/**
 * 꼭지 보드 하나 → 온톨로지 스냅샷.
 *
 * ★ **거르지 않은 `TopicBoard` 를 넘길 것.** 조 순번은 `board.teams` 에서의 자리로 매긴다
 * (`buildBoards()` 가 이미 분과·조 번호 순으로 정렬해 두었고, 한 장도 안 낸 조도 자리를 차지한다 —
 * `submission-ontology-bridge.mjs` 가 빈 행을 버리기 **전에** 조 순번을 매기는 것과 같다).
 * `filterBoardBySubgroup()` 으로 거른 보드를 넘기면 같은 카드가 다른 순번을 받아 다른 분과의
 * 스냅샷과 id 가 충돌한다.
 *
 * @param board 꼭지 하나의 보드(거르지 않은 것)
 * @param takenAt ISO 시각 — **호출부가 정한다.** 함수 안에서 시계를 읽지 않아야 같은 입력이면 같은 출력이다.
 */
export function boardToOntologySnapshot(
  board: TopicBoard,
  takenAt: string,
  { sessionSlug = DEFAULT_SESSION_SLUG }: { sessionSlug?: string } = {}
): OntologySnapshot {
  if (!takenAt) throw new Error('takenAt is required — 스냅샷 시각은 호출부가 정한다');

  const agenda: OntologyAgendaRow[] = [];
  const agenda_link: OntologyAgendaLinkRow[] = [];

  board.teams.forEach((team, index) => {
    const base = { teamOrdinal: index + 1, topicOrdinal: board.ordinal };
    for (const note of team.notes) {
      const content = note.content.trim();
      if (!content) continue; // 아직 아무것도 안 쓴 자리 — 노드로 만들지 않는다
      const id = submissionNodeId({ ...base, itemOrdinal: note.ordinal });
      agenda.push({
        id,
        session_id: sessionSlug,
        text: content,
        status: 'active',
        kind: 'agenda',
        // ⚠️ group_id 를 채우지 않는다. 미리 묶어 보내면 그 묶음이 기정사실이 된다.
        group_id: null,
        parent_id: null,
      });

      const rationale = note.rationale?.trim();
      if (!rationale) continue;
      const rid = submissionNodeId({ ...base, itemOrdinal: note.ordinal, isRationale: true });
      agenda.push({
        id: rid,
        session_id: sessionSlug,
        text: rationale,
        status: 'active',
        kind: 'agenda',
        group_id: null,
        parent_id: null,
      });
      agenda_link.push({
        id: `${id}~r`,
        session_id: sessionSlug,
        source_id: rid,
        target_id: id,
      });
    }
  });

  if (agenda.length === 0) throw new Error('조가 쓴 항목이 하나도 없다 — 스냅샷을 만들 수 없다');

  return {
    // 꼭지를 id 에 넣는다 — 꼭지 셋을 같은 순간에 내보내도 스냅샷이 서로 덮어쓰지 않는다.
    id: `0829-submissions-k${board.ordinal}-${takenAt}`,
    source: ONTOLOGY_SNAPSHOT_SOURCE,
    taken_at: takenAt,
    payload: { agenda, agenda_link },
  };
}

/** 스냅샷에서 근거가 아닌 행(= 카드에 대응하는 행)만 센다. */
export function contentNodeCount(snapshot: OntologySnapshot): number {
  return snapshot.payload.agenda.filter((row) => !row.id.endsWith('/r')).length;
}

export type OntologyPreservation = {
  submitted: number;
  nodes: number;
  deleted: number;
  ok: boolean;
};

/**
 * 보존 불변식 — 「모이되 모으지 않는다」를 숫자로 증명한다.
 * 카드 수와 근거가 아닌 노드 수가 같아야 하고, 삭제는 언제나 0이어야 한다.
 */
export function ontologyPreservation(notes: Note[], snapshot: OntologySnapshot): OntologyPreservation {
  const submitted = notes.length;
  const nodes = contentNodeCount(snapshot);
  return { submitted, nodes, deleted: submitted - nodes, ok: nodes === submitted };
}
