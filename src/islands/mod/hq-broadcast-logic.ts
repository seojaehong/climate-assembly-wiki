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

export type BroadcastStatusStyle = { bg: string; text: string; dot: string; band: string };

/**
 * 송출 모드(대형 스크린) 전용 상태 색. 운영 노트북용 STATUS_STYLE(HqGrid.tsx)은 건드리지 않는다.
 * 파스텔 배경을 채도 높은 값으로 올리고, 카드 좌측 색 띠(band)를 함께 준다.
 * 값은 전부 인라인 `style`로 DOM에 들어가므로 Tailwind purge와 무관하다 —
 * 그래서 클래스 문자열과 달리 여기서 단위 테스트로 지킬 수 있다.
 */
export const BROADCAST_STATUS_STYLE: Record<TeamCellResult['label'], BroadcastStatusStyle> = {
  대기: { bg: '#E2E8EC', text: '#1F2933', dot: '#4A5560', band: '#6B7683' },
  투표중: { bg: '#0E7C8A', text: '#FFFFFF', dot: '#FFFFFF', band: '#0E7C8A' },
  마감: { bg: '#1F4E79', text: '#FFFFFF', dot: '#FFFFFF', band: '#1F4E79' },
};

/**
 * 송출 카드 테두리 색. 페이지 배경 #F5F8FB 대비 2.78:1, 흰 카드 대비 2.96:1.
 * (AC 예시값 #9CB7C8은 배경 대비 1.97:1로 AC가 요구한 2.5:1을 못 넘겨 임계값 쪽을 따랐다.)
 */
export const BROADCAST_BORDER_COLOR = '#7A9AAF';
