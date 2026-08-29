import type { TeamColumn } from './hq-submission-board-logic';

/**
 * 발표 모드 「조 하나씩」 — 세부실행계획 6-1 조별 공유가 한 조씩 차례로 발표하는
 * 자리라서, 다섯 조를 한 화면에 늘어놓으면 정작 발표 중인 조가 눈에 안 들어온다.
 *
 * ★ 선택은 **teamId로 잡는다.** 보드는 폴링으로 갱신되므로 인덱스로 잡으면
 * 다른 조가 저장하는 순간 보고 있던 조가 바뀐다.
 */

/** 지금 볼 조. 못 찾으면(조가 사라졌거나 선택이 없으면) null. */
export function focusedTeam(
  teams: readonly TeamColumn[],
  teamId: string | null,
): TeamColumn | null {
  if (!teamId) return null;
  return teams.find((t) => t.teamId === teamId) ?? null;
}

/**
 * 이전·다음 조. 끝에서 멈추지 않고 돌아간다 — 발표 순서가 한 바퀴 돌고
 * 다시 물어보는 일이 실제로 생긴다.
 *
 * 선택이 없거나 목록에서 사라졌으면 방향에 맞는 끝에서 시작한다.
 */
export function stepTeam(
  teams: readonly TeamColumn[],
  teamId: string | null,
  delta: 1 | -1,
): string | null {
  if (teams.length === 0) return null;
  const at = teams.findIndex((t) => t.teamId === teamId);
  if (at === -1) return (delta === 1 ? teams[0] : teams[teams.length - 1]).teamId;
  const next = (at + delta + teams.length) % teams.length;
  return teams[next].teamId;
}

/**
 * 「조 하나씩」으로 들어갈 때 처음 보여줄 조.
 *
 * 아직 한 줄도 없는 조를 먼저 띄우면 빈 화면으로 시작한다 — **쓴 조가 있으면
 * 그 중 첫 조**부터. 아무 조도 안 썼으면 그냥 첫 조.
 */
export function firstFocusTeamId(teams: readonly TeamColumn[]): string | null {
  if (teams.length === 0) return null;
  const written = teams.find((t) => t.notes.length > 0);
  return (written ?? teams[0]).teamId;
}

/** 「3 / 5」 표시용. 선택이 없으면 null. */
export function focusPosition(
  teams: readonly TeamColumn[],
  teamId: string | null,
): { at: number; total: number } | null {
  const at = teams.findIndex((t) => t.teamId === teamId);
  if (at === -1) return null;
  return { at: at + 1, total: teams.length };
}
