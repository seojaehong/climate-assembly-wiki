/**
 * 되돌릴 수 없는 버튼의 두 번 누르기 — 첫 번째 누름은 「무장」, 5초 안의 두 번째 누름만 실행한다.
 * 5초가 지나면 원래 버튼으로 돌아간다. 시계는 주입(시험용).
 */
export const TWO_STEP_MS = 5000;

export type TwoStepArm = { key: string; at: number } | null;

/** 지금 이 key 가 무장 상태인가. */
export function isArmed(arm: TwoStepArm, key: string, now: number, windowMs = TWO_STEP_MS): boolean {
  return !!arm && arm.key === key && now >= arm.at && now - arm.at < windowMs;
}

/**
 * 누름 한 번. 같은 key 가 창 안에서 무장돼 있으면 'fire'(실행하고 무장 해제),
 * 아니면 'arm'(이 key 로 새로 무장 — 다른 버튼의 무장은 풀린다).
 */
export function twoStepPress(
  arm: TwoStepArm,
  key: string,
  now: number,
  windowMs = TWO_STEP_MS,
): { action: 'fire' | 'arm'; next: TwoStepArm } {
  if (isArmed(arm, key, now, windowMs)) return { action: 'fire', next: null };
  return { action: 'arm', next: { key, at: now } };
}
