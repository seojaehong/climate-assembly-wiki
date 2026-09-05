/**
 * 조 콘솔 상단 탭 정의 — 순수 로직. React·DOM 의존이 없어 vitest로 그대로 검증한다.
 *
 * 8.29 제5차 회의의 위계를 그대로 화면에 옮긴 것이다. 그날 조가 하는 일은 조별 산출물
 * 작성이고 투표·타이머는 쓰지 않는다. 6개 패널을 한 화면에 세로로 늘어놓으면 정작
 * 메인인 산출물이 스크롤 아래로 밀리므로, 산출물을 첫 탭으로 세우고 나머지를 뒤에 둔다.
 */

export type ModTabId = 'submission' | 'attendance' | 'vote' | 'timer';

export type ModTab = {
  id: ModTabId;
  /** 탭 버튼에 찍히는 이름. */
  label: string;
  /** 탭 아래에 한 줄로 붙는 설명 — 조 모더레이터가 무엇을 하는 자리인지 알게 한다. */
  hint: string;
};

/**
 * 표시 순서 = 8.29 사용 순서. submission이 맨 앞이고 기본값이다.
 * 순서를 바꾸면 조가 여는 첫 화면이 바뀐다 — 회차 운영과 함께 판단할 것.
 */
export const MOD_TABS: readonly ModTab[] = [
  { id: 'submission', label: '조별 산출물', hint: '세 꼭지를 줄글로 적습니다 — 8.29의 본 과업' },
  { id: 'attendance', label: '출석 체크', hint: '조원 출석·지각·조퇴를 기록합니다' },
  { id: 'vote', label: '투표', hint: '조 안에서 표를 물을 때만 씁니다' },
  { id: 'timer', label: '타이머', hint: '발언·세션 시간을 겁니다' },
] as const;

/** 아무 것도 고르지 않았을 때 열리는 탭. */
export const DEFAULT_MOD_TAB: ModTabId = 'submission';

/** 탭 선택 보관 키 — 새로고침해도 보던 탭에 그대로 머문다. */
export const MOD_TAB_KEY = 'climate_vote_mod_tab';

/**
 * 저장값·URL 등 바깥에서 들어온 값을 탭 id로 좁힌다.
 * 모르는 값이면 기본 탭으로 떨어뜨린다(탭이 하나도 선택되지 않은 빈 화면을 만들지 않는다).
 */
export function normalizeTabId(value: unknown): ModTabId {
  if (typeof value !== 'string') return DEFAULT_MOD_TAB;
  const found = MOD_TABS.find((tab) => tab.id === value);
  return found ? found.id : DEFAULT_MOD_TAB;
}

/** 탭 id로 정의를 찾는다. 모르는 값이면 기본 탭의 정의를 돌려준다. */
export function tabById(id: ModTabId): ModTab {
  return MOD_TABS.find((tab) => tab.id === id) ?? MOD_TABS[0];
}

/** WAI-ARIA tabs pattern: arrows wrap, Home/End jump, other keys stay untouched. */
export function tabAfterKey(active: ModTabId, key: string): ModTabId | null {
  if (key === 'Home') return MOD_TABS[0].id;
  if (key === 'End') return MOD_TABS[MOD_TABS.length - 1].id;

  const direction =
    key === 'ArrowRight' || key === 'ArrowDown'
      ? 1
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? -1
        : 0;
  if (direction === 0) return null;

  const index = MOD_TABS.findIndex((tab) => tab.id === active);
  const next = (index + direction + MOD_TABS.length) % MOD_TABS.length;
  return MOD_TABS[next].id;
}
