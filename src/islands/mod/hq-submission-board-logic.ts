import type { HqSubmissionRow } from '../../lib/hq-submissions';

/**
 * 본부 산출물 보드의 순수 로직 — 평면 행을 「꼭지 → 조 → 포스트잇」으로 접고,
 * 진척(몇 조가 몇 장 냈는가)을 센다. React·DOM 의존이 없어 vitest로 그대로 검증한다.
 *
 * 본부의 관심사는 두 가지다. ①무엇이 나왔는가 ②아직 안 낸 조가 어디인가.
 * 그래서 한 줄도 안 쓴 조를 목록에서 빼지 않고 빈 자리로 남긴다.
 */

export type Note = {
  /** 카드 식별자 — 조 + 항목 순번. 리스트 key와 묶기 선택에 쓴다. */
  id: string;
  teamId: string;
  teamName: string;
  /** 현장 좌석 번호. 당일 본부가 입력하며 없을 수 있다. */
  tableNo: string | null;
  subgroup: string | null;
  ordinal: number;
  content: string;
  rationale: string | null;
};

export type TeamColumn = {
  teamId: string;
  teamName: string;
  tableNo: string | null;
  subgroup: string | null;
  /** 최종 제출로 잠긴 조는 더 이상 안 바뀐다 — 본부가 한눈에 구분해야 한다. */
  status: 'draft' | 'final' | 'reopened' | 'archived' | null;
  updatedAt: string | null;
  notes: Note[];
};

export type TopicBoard = {
  topicId: string;
  ordinal: number;
  prompt: string;
  status: 'open' | 'closed';
  teams: TeamColumn[];
  /** 이 꼭지에 한 장이라도 낸 조 수. */
  teamsWithNotes: number;
  totalNotes: number;
};

/** 조 이름 「2분과 3조」를 (분과, 조)로 읽어 자연 정렬한다. 문자열 정렬은 10조가 1조 뒤에 온다. */
export function teamSortKey(name: string): [number, number, string] {
  const match = /^(\d+)분과\s*(\d+)조$/.exec(name.trim());
  if (!match) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, name];
  return [Number(match[1]), Number(match[2]), name];
}

function compareTeams(a: TeamColumn, b: TeamColumn): number {
  const [ax, ay, an] = teamSortKey(a.teamName);
  const [bx, by, bn] = teamSortKey(b.teamName);
  if (ax !== bx) return ax - bx;
  if (ay !== by) return ay - by;
  return an.localeCompare(bn);
}

/** 평면 행 → 꼭지별 보드. 꼭지는 ordinal 순, 조는 분과·조 번호 순으로 정렬한다. */
export function buildBoards(rows: HqSubmissionRow[]): TopicBoard[] {
  const byTopic = new Map<string, TopicBoard>();
  const teamIndex = new Map<string, TeamColumn>();

  for (const row of rows) {
    let board = byTopic.get(row.topic_id);
    if (!board) {
      board = {
        topicId: row.topic_id,
        ordinal: row.topic_ordinal,
        prompt: row.topic_prompt,
        status: row.topic_status,
        teams: [],
        teamsWithNotes: 0,
        totalNotes: 0,
      };
      byTopic.set(row.topic_id, board);
    }

    const key = `${row.topic_id}:${row.team_id}`;
    let team = teamIndex.get(key);
    if (!team) {
      team = {
        teamId: row.team_id,
        teamName: row.team_name,
        tableNo: row.table_no,
        subgroup: row.team_subgroup,
        status: row.submission_status,
        updatedAt: row.submission_updated_at,
        notes: [],
      };
      teamIndex.set(key, team);
      board.teams.push(team);
    }

    // 빈 행(아직 한 줄도 안 쓴 조)은 조 자리만 만들고 카드는 만들지 않는다.
    const content = row.item_content?.trim();
    if (!content) continue;
    team.notes.push({
      id: `${key}:${row.item_ordinal ?? team.notes.length + 1}`,
      teamId: row.team_id,
      teamName: row.team_name,
      tableNo: row.table_no,
      subgroup: row.team_subgroup,
      ordinal: row.item_ordinal ?? team.notes.length + 1,
      content,
      rationale: row.item_rationale?.trim() ? row.item_rationale.trim() : null,
    });
  }

  const boards = [...byTopic.values()];
  for (const board of boards) {
    board.teams.sort(compareTeams);
    for (const team of board.teams) team.notes.sort((a, b) => a.ordinal - b.ordinal);
    board.teamsWithNotes = board.teams.filter((t) => t.notes.length > 0).length;
    board.totalNotes = board.teams.reduce((sum, t) => sum + t.notes.length, 0);
  }
  boards.sort((a, b) => a.ordinal - b.ordinal);
  return boards;
}

/** 한 꼭지의 카드를 조 구분 없이 한 줄로 편다 — 「조별」이 아니라 「내용별」로 볼 때 쓴다. */
export function flattenNotes(board: TopicBoard): Note[] {
  return board.teams.flatMap((team) => team.notes);
}

/** 아직 한 장도 내지 않은 조 이름. 본부가 독려할 대상이다. */
export function silentTeams(board: TopicBoard): string[] {
  return board.teams.filter((team) => team.notes.length === 0).map((team) => team.teamName);
}

/**
 * 검색어로 카드를 거른다. 조 이름·좌석 번호·본문·근거를 모두 본다.
 * 빈 검색어는 거르지 않는다(전체 보기).
 */
export function filterNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((note) =>
    [note.teamName, note.tableNo ?? '', note.content, note.rationale ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q)
  );
}

/** 포스트잇 색 — 조마다 고정되도록 조 이름 해시로 고른다(새로고침해도 같은 색). */
export const NOTE_COLORS = ['#FDE047', '#FED7AA', '#BBF7D0', '#BFDBFE', '#E9D5FF', '#FBCFE8'] as const;

export function noteColor(teamName: string): string {
  let hash = 0;
  for (let i = 0; i < teamName.length; i += 1) {
    hash = (hash * 31 + teamName.charCodeAt(i)) >>> 0;
  }
  return NOTE_COLORS[hash % NOTE_COLORS.length];
}

/** 본부가 그대로 복사해 갈 수 있는 텍스트 — 꼭지 하나를 조별로 정리해 내보낸다. */
export function boardToText(board: TopicBoard): string {
  const lines: string[] = [`■ ${board.prompt}  (${board.teamsWithNotes}개 조 · ${board.totalNotes}건)`];
  for (const team of board.teams) {
    if (team.notes.length === 0) continue;
    lines.push('', `[${team.teamName}]`);
    team.notes.forEach((note, index) => {
      lines.push(`  ${index + 1}. ${note.content}`);
      if (note.rationale) lines.push(`     (근거) ${note.rationale}`);
    });
  }
  const silent = silentTeams(board);
  if (silent.length > 0) lines.push('', `※ 미제출 ${silent.length}개 조 — ${silent.join(', ')}`);
  return lines.join('\n');
}
