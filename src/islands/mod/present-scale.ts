import type { TeamColumn } from './hq-submission-board-logic';

/**
 * 발표 모드 글자 크기 — **내용이 어떻게 나오든 읽히게** 한다.
 *
 * 조가 몇 줄을 쓸지, 한 줄이 얼마나 길지 미리 알 수 없다. 30줄을 채운 조와 두 줄만
 * 쓴 조가 같은 화면에 뜨는데, 28px로 고정해 두면 앞의 조는 카드가 화면 밖으로
 * 흘러 정작 발표 중인 조의 글이 안 보인다.
 *
 * 그래서 분과 전체의 분량을 보고 **한 단계씩만** 줄인다.
 *
 * ── 24px 아래로는 내려가지 않는다 ────────────────────────────────────
 * 이 자리는 8~15m 떨어진 200명이 함께 보는 화면이다. 본문 24px가 그 거리에서
 * 읽히는 하한이고, 그 아래로 줄이면 「다 들어가긴 했는데 아무도 못 읽는」 화면이
 * 된다. 하한에 닿은 뒤로는 **카드가 세로로 길어지게 둔다** — 분과 공유는 조별
 * 발표 각 2분으로 한 조씩 차례로 보는 자리라, 긴 카드를 내려 보는 것이
 * 안 읽히는 글씨보다 낫다.
 */

/** 발표 모드 본문 크기 단계. 마지막 값이 하한이며 그 아래는 없다. */
export const PRESENT_BODY_STEPS = [28, 26, 24] as const;

export type PresentScale = {
  /** 카드 본문 px. */
  body: number;
  /** 조 이름 px. */
  teamName: number;
  /** 순번 뱃지 한 변 px. */
  badge: number;
  /** 열 하나의 최소 너비 px — 글이 작아지면 열을 좁혀 한 화면에 더 담는다. */
  columnMin: number;
};

const SCALES: PresentScale[] = [
  { body: 28, teamName: 30, badge: 36, columnMin: 460 },
  { body: 26, teamName: 28, badge: 34, columnMin: 420 },
  { body: 24, teamName: 26, badge: 32, columnMin: 380 },
];

/**
 * 한 단계 내리는 기준. 글자 수와 줄 수를 함께 본다 —
 * 짧은 줄이 많아도, 긴 줄이 적어도 화면은 똑같이 넘친다.
 */
const STEP_AT_CHARS = [1_200, 3_000];
const STEP_AT_NOTES = [40, 80];

/**
 * 분과의 분량으로 크기 단계를 고른다.
 *
 * 글자 수 기준과 줄 수 기준 중 **더 빡빡한 쪽**을 따른다. 둘 중 하나만 봐서
 * 넘치는 경우가 실제로 갈린다.
 */
export function presentScale(teams: readonly TeamColumn[]): PresentScale {
  let chars = 0;
  let notes = 0;
  for (const team of teams) {
    for (const note of team.notes) {
      notes += 1;
      chars += note.content.length;
    }
  }
  const byChars = STEP_AT_CHARS.filter((limit) => chars > limit).length;
  const byNotes = STEP_AT_NOTES.filter((limit) => notes > limit).length;
  const step = Math.min(Math.max(byChars, byNotes), SCALES.length - 1);
  return SCALES[step];
}
