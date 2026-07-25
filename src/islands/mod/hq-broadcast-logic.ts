import type { TeamCellResult } from './hq-grid-logic';

export type ParticipationParts = { votes: string; total: string };

/**
 * /hq 운영 모드 판정. 기본값은 **송출 모드**(무인 대형 스크린)이고,
 * `?ops=1`이 정확히 붙었을 때만 조작용 UI를 켠다.
 * 오타('?ops=true' 등)로 대형 스크린에 조작 UI가 뜨지 않도록 값은 '1'만 허용한다.
 */
export function isOpsMode(search: string): boolean {
  // URLSearchParams는 앞의 '?'를 알아서 떼고, 값 없는 키('?ops')는 ''로 준다.
  return new URLSearchParams(search).get('ops') === '1';
}

/**
 * 카드의 참여 표기('9/12')를 득표수와 전체로 분해한다.
 * 송출 카드에서 득표수만 88px로 키우고 '/12'는 보조 크기로 내리기 위한 분해다.
 * 슬래시가 없으면 원문 전체가 votes이고 total은 빈 문자열이다.
 */
export function participationParts(cell: TeamCellResult): ParticipationParts {
  const raw = cell.participation ?? '';
  const slash = raw.indexOf('/');
  if (slash === -1) return { votes: raw.trim(), total: '' };
  return { votes: raw.slice(0, slash).trim(), total: raw.slice(slash + 1).trim() };
}
