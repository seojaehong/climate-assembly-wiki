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
 *
 * label은 보지 않으므로 참여 표기만 있으면 받는다 — 회차별 보기의 카드 값(label에 '미실시'가
 * 들어갈 수 있다)도 그대로 넘길 수 있게 하기 위한 것이다.
 */
export function participationParts(cell: Pick<TeamCellResult, 'participation'>): ParticipationParts {
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
  // 세 상태를 하나의 색 여정으로 잇는다: 옅은 청록(대기) → 진한 청록(투표중) → 네이비(마감).
  // 대기를 무채색 회색으로 두면 행사 시작 전 15개 카드가 전부 회색이라 화면이 죽어 보이고,
  // 투표중과 계열이 끊겨 "곧 저 상태가 된다"는 연속성도 사라진다.
  // 조용함(낮은 채도·명도차)은 유지하되 계열은 같게 가져간다.
  대기: { bg: '#DCE9EB', text: '#1F2933', dot: '#4A6B70', band: '#6E969E' },
  투표중: { bg: '#0E7C8A', text: '#FFFFFF', dot: '#FFFFFF', band: '#0E7C8A' },
  마감: { bg: '#1F4E79', text: '#FFFFFF', dot: '#FFFFFF', band: '#1F4E79' },
};

/**
 * 송출 카드 테두리 색. 페이지 배경 #F5F8FB 대비 2.78:1, 흰 카드 대비 2.96:1.
 * (AC 예시값 #9CB7C8은 배경 대비 1.97:1로 AC가 요구한 2.5:1을 못 넘겨 임계값 쪽을 따랐다.)
 */
export const BROADCAST_BORDER_COLOR = '#7A9AAF';

// ─────────────────────────────────────────────────────────────────────────────
// 송출 타이포 스케일 (US-019)
//
// 고정 px로는 1080p에서 조 이름·테이블 번호·상태 배지·득표·출석을 5x3 그리드에 넣는 것이
// 산술적으로 불가능하다(evaluation/2026-07-26-hq-broadcast-mod-blockers.md §4).
// 그래서 크기를 뷰포트 비례로 바꾼다. 두 축을 모두 본다 —
//   높이(vh): 카드가 세로로 잘리지 않게. 폭(vw): 줄바꿈 없는 숫자가 가로로 잘리지 않게.
// 실제 렌더는 CSS `clamp(min, min(Xvh, Yvw), max)`가 하고(브라우저가 리사이즈를 처리),
// 여기 있는 함수는 **같은 규칙을 그대로 다시 쓴 모델**이라 예산을 단위테스트로 지킬 수 있다.
// 둘이 어긋나면 "예산은 맞는데 화면은 잘리는" 상태가 되므로 일치 자체를 테스트로 고정한다.
// ─────────────────────────────────────────────────────────────────────────────

export type BroadcastTypeKey =
  | 'teamName'
  | 'tableNo'
  | 'statusBadge'
  | 'blockLabel'
  | 'votes'
  | 'votesTotal'
  | 'attendanceValue';

export type BroadcastTypeToken = { min: number; max: number };

/**
 * max는 US-004·US-006·US-017이 정한 지금의 크기다 — 큰 화면에서는 그 값에 도달한다.
 * min은 US-019 AC #5의 하한(득표 56 · 조 이름 32 · 출석 숫자 40)이고,
 * AC가 하한을 정하지 않은 라벨류는 유일한 조절 여지라 20~24로 둔다.
 */
export const BROADCAST_TYPE_TOKENS: Record<BroadcastTypeKey, BroadcastTypeToken> = {
  teamName: { min: 32, max: 40 },
  tableNo: { min: 24, max: 28 },
  statusBadge: { min: 24, max: 32 },
  blockLabel: { min: 20, max: 28 },
  votes: { min: 56, max: 88 },
  votesTotal: { min: 20, max: 32 },
  attendanceValue: { min: 40, max: 64 },
};

/** 이 높이·폭에서 모든 토큰이 max에 도달한다(그 위로는 상한에 머문다). */
export const BROADCAST_TYPE_FULL_HEIGHT = 1320;
export const BROADCAST_TYPE_FULL_WIDTH = 2256;

/**
 * 뷰포트 대비 계수(vh·vw). **소수 3자리로 자른 이 값이 유일한 원본이다** —
 * CSS 문자열과 아래 모델이 같은 계수를 쓰지 않으면 화면과 예산이 조금씩 어긋난다.
 * 두 축 중 작은 쪽을 따른다: 한쪽만 보면 다른 축에서 잘린다.
 */
function coefficients(key: BroadcastTypeKey): { vh: number; vw: number } {
  const { max } = BROADCAST_TYPE_TOKENS[key];
  return {
    vh: round3((max / BROADCAST_TYPE_FULL_HEIGHT) * 100),
    vw: round3((max / BROADCAST_TYPE_FULL_WIDTH) * 100),
  };
}

export function broadcastFontSize(key: BroadcastTypeKey, viewportWidth: number, viewportHeight: number): number {
  const { min, max } = BROADCAST_TYPE_TOKENS[key];
  const { vh, vw } = coefficients(key);
  const fluid = Math.min((vh * Math.max(0, viewportHeight)) / 100, (vw * Math.max(0, viewportWidth)) / 100);
  return Math.min(max, Math.max(min, fluid));
}

/** 인라인 style의 fontSize로 그대로 넣는 CSS 값. Tailwind 임의값(쉼표·괄호)으로는 못 쓴다. */
export function broadcastFontCss(key: BroadcastTypeKey): string {
  const { min, max } = BROADCAST_TYPE_TOKENS[key];
  const { vh, vw } = coefficients(key);
  return `clamp(${min}px, min(${vh}vh, ${vw}vw), ${max}px)`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── 레이아웃 상수 (HqGrid.tsx 송출 분기의 클래스와 1:1로 대응한다) ──
/** 그리드 높이 `h-[calc(100vh-160px)]`의 160. 페이지 헤더·푸터 실측(≈133px)보다 여유가 있다. */
export const BROADCAST_GRID_CHROME_PX = 160;
export const BROADCAST_GRID_ROWS = 3;
export const BROADCAST_GRID_COLS = 5;
/** gap-3 · 페이지 px-6(sm 이상) */
export const BROADCAST_GRID_GAP_PX = 12;
export const BROADCAST_PAGE_PADDING_X = 48;
/** 카드가 내용 밖에서 먹는 세로: border-2 위아래 4 + p-4 위아래 32 */
export const BROADCAST_CARD_BOX_Y = 36;
/** 카드가 내용 밖에서 먹는 가로: border-2 오른쪽 2 + border-l-12 + p-4 좌우 32 */
export const BROADCAST_CARD_BOX_X = 46;

const CARD_GAP = 8; // 카드 gap-2 (헤더 ↔ 하단 행)
const HEADER_GAP = 8; // 헤더 내부 gap-2 (이름 블록 ↔ 상태 배지)
const TABLE_NO_MT = 4; // 테이블 번호 줄 mt-1
const BADGE_PY = 8; // 배지 py-1
const STATUS_DOT_PX = 20; // w-5 h-5 — US-005가 정한 하한이라 줄이지 않는다
const BADGE_PX = 24; // 배지 px-3
const BADGE_GAP = 8; // 배지 gap-2 (도트 ↔ 글자)
const BOTTOM_SEPARATOR = 5; // 하단 행 border-t 1 + pt-1 4
const BOTTOM_COL_GAP = 12; // 하단 행 gap-3 (참여 ↔ 출석)
const NUMBER_GAP = 4; // 큰 숫자 ↔ '/전체' gap-1 (두 열에 각각 있다)
const TIGHT = 1.25; // leading-tight
const NUMBER_LINE = 1.1; // 숫자 줄 (leading-none은 한글에서 위험해 쓰지 않는다)

/** 가로로 가장 긴 상태 라벨. '대기'·'마감'보다 넓다. */
const WIDEST_STATUS = '투표중';

/**
 * 글자 폭 추정(em). 한글·전각 1.0, ASCII 0.55.
 * 숫자에는 `tr-num`(tabular-nums + letter-spacing -.03em)이 걸려 있어 실제로는 더 좁으므로
 * 이 추정은 안전한 쪽으로 치우쳐 있다. 유니코드 범위를 적지 않으려고 ASCII 여부로만 가른다.
 */
function textEm(text: string): number {
  let em = 0;
  for (const ch of text) em += ch.codePointAt(0)! < 0x80 ? 0.55 : 1;
  return em;
}

/**
 * 송출 카드가 실제로 쓰는 세로 높이. `shrink-0` 자식만 있으므로 이 값이 트랙을 넘으면
 * `overflow-hidden`이 무성 클리핑을 낸다 — 그래서 이 함수가 유일한 판정식이다.
 * 테이블 번호·출석은 없을 수도 있지만 **둘 다 있는 최악을 모델로 삼는다.**
 */
export function broadcastCardContentHeight(viewportWidth: number, viewportHeight: number): number {
  const size = (k: BroadcastTypeKey) => broadcastFontSize(k, viewportWidth, viewportHeight);
  const header =
    size('teamName') * TIGHT +
    (TABLE_NO_MT + size('tableNo') * TIGHT) +
    HEADER_GAP +
    (BADGE_PY + Math.max(STATUS_DOT_PX, size('statusBadge') * TIGHT));
  // 참여와 출석은 **같은 행**에 나란히 놓는다(각각 라벨 위 / 숫자 아래).
  // 세로로 쌓으면 1080p에서 산술적으로 들어가지 않는다 — §4가 증명한 그 지점이다.
  const bottom = size('blockLabel') * TIGHT + Math.max(size('votes'), size('attendanceValue')) * NUMBER_LINE;
  return header + CARD_GAP + BOTTOM_SEPARATOR + bottom;
}

/** 하한 조합에서의 행 높이. 뷰포트가 이보다 짧으면 잘리는 대신 세로 스크롤이 생긴다. */
export const BROADCAST_ROW_MIN_HEIGHT = Math.ceil(broadcastCardContentHeight(0, 0) + BROADCAST_CARD_BOX_Y);
export const BROADCAST_GRID_MIN_HEIGHT =
  BROADCAST_ROW_MIN_HEIGHT * BROADCAST_GRID_ROWS + BROADCAST_GRID_GAP_PX * (BROADCAST_GRID_ROWS - 1);

/** 카드 안에 실제로 쓸 수 있는 세로. min-h가 걸린 뒤의 값이라 "안 잘린다"가 성립한다. */
export function broadcastCardAvailableHeight(viewportHeight: number): number {
  const grid = Math.max(
    viewportHeight - BROADCAST_GRID_CHROME_PX,
    BROADCAST_GRID_MIN_HEIGHT,
  );
  const track = (grid - BROADCAST_GRID_GAP_PX * (BROADCAST_GRID_ROWS - 1)) / BROADCAST_GRID_ROWS;
  return track - BROADCAST_CARD_BOX_Y;
}

/**
 * 줄바꿈이 허용되지 않는 요소들이 요구하는 가로 폭.
 * 조 이름·테이블 번호는 `truncate`(말줄임표 = 눈에 보이는 열화)라 여기서 제외하고,
 * 말줄임 없이 잘리면 조용히 틀린 숫자가 되는 **하단 숫자 행과 상태 배지**만 센다.
 */
export function broadcastCardRequiredWidth(viewportWidth: number, viewportHeight: number): number {
  const size = (k: BroadcastTypeKey) => broadcastFontSize(k, viewportWidth, viewportHeight);
  const badge = BADGE_PX + STATUS_DOT_PX + BADGE_GAP + textEm(WIDEST_STATUS) * size('statusBadge');
  // '12'(두 자리) + gap-1 + '/12' — 조 정원이 두 자리라 이보다 길어지지 않는다.
  const participation = Math.max(
    textEm('12') * size('votes') + NUMBER_GAP + textEm('/12') * size('votesTotal'),
    textEm('참여') * size('blockLabel'),
  );
  const attendance = Math.max(
    textEm('12') * size('attendanceValue') + NUMBER_GAP + textEm('/12') * size('votesTotal'),
    textEm('현재/전체') * size('blockLabel'),
  );
  return Math.max(badge, participation + BOTTOM_COL_GAP + attendance);
}

/**
 * 하한 조합에서 5칸이 필요로 하는 그리드 폭. 이보다 좁으면 가로 스크롤로 바뀐다.
 * **칸 하나를 먼저 올림**한다 — 합계를 올리면 5로 나눠 되돌릴 때 부동소수점 한 자리가 모자라
 * "필요 폭 > 가용 폭"이 되는 경계가 생긴다(실제로 밟았다).
 */
export const BROADCAST_GRID_MIN_WIDTH =
  Math.ceil(broadcastCardRequiredWidth(0, 0) + BROADCAST_CARD_BOX_X) * BROADCAST_GRID_COLS +
  BROADCAST_GRID_GAP_PX * (BROADCAST_GRID_COLS - 1);

export function broadcastCardAvailableWidth(viewportWidth: number): number {
  const grid = Math.max(viewportWidth - BROADCAST_PAGE_PADDING_X, BROADCAST_GRID_MIN_WIDTH);
  const card = (grid - BROADCAST_GRID_GAP_PX * (BROADCAST_GRID_COLS - 1)) / BROADCAST_GRID_COLS;
  return card - BROADCAST_CARD_BOX_X;
}

/**
 * 송출 모드가 15조를 한 화면에 넣으려면 필요한 최소 뷰포트 높이.
 * 그리드 바닥값(BROADCAST_GRID_MIN_HEIGHT) + 헤더·푸터(BROADCAST_GRID_CHROME_PX).
 */
export const BROADCAST_REQUIRED_VIEWPORT_HEIGHT = BROADCAST_GRID_MIN_HEIGHT + BROADCAST_GRID_CHROME_PX;

/**
 * 화면이 낮아 아래 조가 잘리는 픽셀 수. 충분하면 0이다.
 *
 * 바닥값을 없애 글자를 더 줄이는 대신 **부족하다는 사실을 드러내는** 쪽을 택했다.
 * 무인 송출 화면에는 스크롤할 사람이 없어서, 조용히 잘리면 3분과가 행사 내내 안 보인다.
 * 측정 전(0)·음수에서는 0을 돌려준다 — SSR과 첫 렌더에서 오경보를 내지 않기 위함이다.
 */
export function broadcastViewportShortfall(viewportHeight: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0;
  return Math.max(0, Math.ceil(BROADCAST_REQUIRED_VIEWPORT_HEIGHT - viewportHeight));
}
