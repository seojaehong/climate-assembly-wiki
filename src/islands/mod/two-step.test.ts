import { describe, expect, it } from 'vitest';
import { TWO_STEP_MS, isArmed, twoStepPress } from './two-step';

describe('두 번 누르기(되돌릴 수 없는 버튼)', () => {
  it('첫 누름은 무장, 5초 안 두 번째 누름은 실행', () => {
    const a = twoStepPress(null, 'close:x', 1000);
    expect(a.action).toBe('arm');
    expect(isArmed(a.next, 'close:x', 1000)).toBe(true);
    const b = twoStepPress(a.next, 'close:x', 1000 + TWO_STEP_MS - 1);
    expect(b).toEqual({ action: 'fire', next: null });
  });

  it('5초가 지나면 원래대로 — 다시 무장부터', () => {
    const a = twoStepPress(null, 'k', 0);
    expect(isArmed(a.next, 'k', TWO_STEP_MS)).toBe(false);
    expect(twoStepPress(a.next, 'k', TWO_STEP_MS).action).toBe('arm');
  });

  it('다른 버튼의 무장으로는 실행되지 않는다(무장이 옮겨 간다)', () => {
    const a = twoStepPress(null, 'close:a', 0);
    const b = twoStepPress(a.next, 'close:b', 100);
    expect(b.action).toBe('arm');
    expect(isArmed(b.next, 'close:a', 100)).toBe(false);
    expect(isArmed(b.next, 'close:b', 100)).toBe(true);
  });

  it('시계가 거꾸로 가면(무장 시각보다 이전) 실행하지 않는다', () => {
    const a = twoStepPress(null, 'k', 5000);
    expect(twoStepPress(a.next, 'k', 4000).action).toBe('arm');
  });
});
