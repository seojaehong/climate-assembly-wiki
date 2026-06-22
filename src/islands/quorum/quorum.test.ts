/**
 * quorum.test.ts — 정족수 로직 경계값 단위 테스트
 *
 * 모든 expected 값은 "재적과반 = N/2 초과" 규칙에서 수동 유도.
 * 절대 구현 공식에서 역산하지 말 것 (구현 버그 은폐 방지).
 */
import { describe, it, expect } from 'vitest';
import { computeQuorum } from './quorum';

// ──────────────────────────────────────────────────────────────────────────────
// 1. 성립 임계 (establishThreshold = floor(N/2)+1)
// ──────────────────────────────────────────────────────────────────────────────
describe('성립 임계 (establish threshold)', () => {
  it('N=9(홀수): 과반수=5 (4.5 초과 → 5)', () => {
    // 손 계산: 9/2=4.5, 초과하는 최솟값=5
    expect(computeQuorum({ enrolled: 9, present: 5 }).establishThreshold).toBe(5);
  });

  it('N=10(짝수): 과반수=6 (5 초과 → 6)', () => {
    // 손 계산: 10/2=5, 초과하는 최솟값=6
    expect(computeQuorum({ enrolled: 10, present: 6 }).establishThreshold).toBe(6);
  });

  it('N=1: 과반수=1', () => {
    expect(computeQuorum({ enrolled: 1, present: 1 }).establishThreshold).toBe(1);
  });

  it('N=200(전체회의 재적): 과반수=101', () => {
    // 200/2=100 초과 → 101
    expect(computeQuorum({ enrolled: 200, present: 101 }).establishThreshold).toBe(101);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. 성립 여부 — 특히 경계값(M = N/2 정확히)
// ──────────────────────────────────────────────────────────────────────────────
describe('성립 여부 (established)', () => {
  it('N=10, M=5 → 미성립 (5는 10의 과반 아님)', () => {
    // "과반수" = 절반 초과. M=5 = N/2 정확히 → 미성립.
    expect(computeQuorum({ enrolled: 10, present: 5 }).established).toBe(false);
  });

  it('N=10, M=6 → 성립', () => {
    expect(computeQuorum({ enrolled: 10, present: 6 }).established).toBe(true);
  });

  it('N=9, M=4 → 미성립 (4 < 4.5 초과 불가)', () => {
    expect(computeQuorum({ enrolled: 9, present: 4 }).established).toBe(false);
  });

  it('N=9, M=5 → 성립 (5 > 4.5)', () => {
    expect(computeQuorum({ enrolled: 9, present: 5 }).established).toBe(true);
  });

  it('N=200, M=100 → 미성립', () => {
    expect(computeQuorum({ enrolled: 200, present: 100 }).established).toBe(false);
  });

  it('N=200, M=101 → 성립', () => {
    expect(computeQuorum({ enrolled: 200, present: 101 }).established).toBe(true);
  });

  it('M=0 → 미성립', () => {
    expect(computeQuorum({ enrolled: 50, present: 0 }).established).toBe(false);
  });

  it('M=N(전원출석) → 항상 성립', () => {
    expect(computeQuorum({ enrolled: 7, present: 7 }).established).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. 부족 인원 (shortfall)
// ──────────────────────────────────────────────────────────────────────────────
describe('부족 인원 (shortfall)', () => {
  it('성립 시 shortfall=0', () => {
    expect(computeQuorum({ enrolled: 10, present: 6 }).shortfall).toBe(0);
  });

  it('N=10, M=4 → shortfall=2 (6-4)', () => {
    expect(computeQuorum({ enrolled: 10, present: 4 }).shortfall).toBe(2);
  });

  it('N=9, M=3 → shortfall=2 (5-3)', () => {
    expect(computeQuorum({ enrolled: 9, present: 3 }).shortfall).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. 의결 임계 (decisionThreshold = ⌈2M/3⌉)
// ──────────────────────────────────────────────────────────────────────────────
describe('의결 임계 ⌈2M/3⌉ (decision threshold)', () => {
  // 미성립 시 null
  it('미성립 시 decisionThreshold=null', () => {
    expect(computeQuorum({ enrolled: 10, present: 3 }).decisionThreshold).toBeNull();
  });

  // 성립 시 각 M 값별 손 계산
  it('M=3(성립): ⌈6/3⌉=2', () => {
    // 6/3=2 → ceil=2
    expect(computeQuorum({ enrolled: 3, present: 3 }).decisionThreshold).toBe(2);
  });

  it('M=4(성립): ⌈8/3⌉=3', () => {
    // 8/3=2.666… → ceil=3
    expect(computeQuorum({ enrolled: 4, present: 4 }).decisionThreshold).toBe(3);
  });

  it('M=5(성립): ⌈10/3⌉=4', () => {
    // 10/3=3.333… → ceil=4
    expect(computeQuorum({ enrolled: 5, present: 5 }).decisionThreshold).toBe(4);
  });

  it('M=6(성립): ⌈12/3⌉=4', () => {
    // 12/3=4 정확히 → ceil=4
    expect(computeQuorum({ enrolled: 6, present: 6 }).decisionThreshold).toBe(4);
  });

  it('M=9(성립): ⌈18/3⌉=6', () => {
    // 18/3=6 정확히 → ceil=6
    expect(computeQuorum({ enrolled: 9, present: 9 }).decisionThreshold).toBe(6);
  });

  it('M=10(성립): ⌈20/3⌉=7', () => {
    // 20/3=6.666… → ceil=7
    expect(computeQuorum({ enrolled: 10, present: 10 }).decisionThreshold).toBe(7);
  });

  it('M=101(기후시민회의 최소 성립 시): ⌈202/3⌉=68', () => {
    // 202/3=67.333… → ceil=68
    expect(computeQuorum({ enrolled: 200, present: 101 }).decisionThreshold).toBe(68);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. 가결 여부 (passed)
// ──────────────────────────────────────────────────────────────────────────────
describe('가결 여부 (passed)', () => {
  it('yeas 미입력 → passed=null', () => {
    expect(computeQuorum({ enrolled: 10, present: 8 }).passed).toBeNull();
  });

  it('미성립 → passed=null (yeas 있어도)', () => {
    expect(computeQuorum({ enrolled: 10, present: 3, yeas: 3 }).passed).toBeNull();
  });

  it('M=9, V=6 (임계=6) → 가결', () => {
    // ⌈18/3⌉=6, V=6 ≥ 6 → true
    expect(computeQuorum({ enrolled: 9, present: 9, yeas: 6 }).passed).toBe(true);
  });

  it('M=9, V=5 (임계=6) → 부결', () => {
    expect(computeQuorum({ enrolled: 9, present: 9, yeas: 5 }).passed).toBe(false);
  });

  it('M=10, V=7 (임계=7) → 가결 (경계 정확히)', () => {
    expect(computeQuorum({ enrolled: 10, present: 10, yeas: 7 }).passed).toBe(true);
  });

  it('M=10, V=6 (임계=7) → 부결', () => {
    expect(computeQuorum({ enrolled: 10, present: 10, yeas: 6 }).passed).toBe(false);
  });

  it('200명 회의, M=150, V=100 (임계=⌈300/3⌉=100) → 가결', () => {
    expect(computeQuorum({ enrolled: 200, present: 150, yeas: 100 }).passed).toBe(true);
  });

  it('200명 회의, M=150, V=99 → 부결', () => {
    expect(computeQuorum({ enrolled: 200, present: 150, yeas: 99 }).passed).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. 진행률 (progress)
// ──────────────────────────────────────────────────────────────────────────────
describe('진행률 (progress)', () => {
  it('M=0, N=10 → establishProgress=0', () => {
    expect(computeQuorum({ enrolled: 10, present: 0 }).establishProgress).toBe(0);
  });

  it('성립 정확히 → establishProgress=1', () => {
    const r = computeQuorum({ enrolled: 10, present: 6 });
    expect(r.establishProgress).toBe(1);
  });

  it('초과 출석 → establishProgress가 1 초과 불가', () => {
    const r = computeQuorum({ enrolled: 10, present: 10 });
    expect(r.establishProgress).toBeLessThanOrEqual(1);
  });

  it('미성립 → decisionProgress=null', () => {
    expect(computeQuorum({ enrolled: 10, present: 3, yeas: 3 }).decisionProgress).toBeNull();
  });

  it('성립, yeas 없음 → decisionProgress=null', () => {
    expect(computeQuorum({ enrolled: 10, present: 8 }).decisionProgress).toBeNull();
  });

  it('성립, yeas=threshold 정확히 → decisionProgress=1', () => {
    // M=9, threshold=6, V=6
    const r = computeQuorum({ enrolled: 9, present: 9, yeas: 6 });
    expect(r.decisionProgress).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. 입력 유효성
// ──────────────────────────────────────────────────────────────────────────────
describe('입력 유효성 (validation)', () => {
  it('enrolled=0 → RangeError', () => {
    expect(() => computeQuorum({ enrolled: 0, present: 0 })).toThrow(RangeError);
  });

  it('enrolled 음수 → RangeError', () => {
    expect(() => computeQuorum({ enrolled: -1, present: 0 })).toThrow(RangeError);
  });

  it('present 음수 → RangeError', () => {
    expect(() => computeQuorum({ enrolled: 10, present: -1 })).toThrow(RangeError);
  });

  it('present > enrolled → RangeError', () => {
    expect(() => computeQuorum({ enrolled: 10, present: 11 })).toThrow(RangeError);
  });

  it('yeas > present → RangeError', () => {
    expect(() => computeQuorum({ enrolled: 10, present: 5, yeas: 6 })).toThrow(RangeError);
  });

  it('yeas 음수 → RangeError', () => {
    expect(() => computeQuorum({ enrolled: 10, present: 5, yeas: -1 })).toThrow(RangeError);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. 실전 시나리오 — 2026 기후시민회의
// ──────────────────────────────────────────────────────────────────────────────
describe('실전 시나리오 (2026 기후시민회의)', () => {
  it('7/4 기획참여단(~30명), 18명 출석 → 성립 여부', () => {
    // N=30, M=18: 2*18=36 > 30 → 성립, threshold=16
    const r = computeQuorum({ enrolled: 30, present: 18 });
    expect(r.established).toBe(true);
    expect(r.establishThreshold).toBe(16);
  });

  it('9/13 분과회의(~50명), 24명 출석 → 미성립', () => {
    // N=50, M=24: 2*24=48 < 50 → 미성립, threshold=26
    const r = computeQuorum({ enrolled: 50, present: 24 });
    expect(r.established).toBe(false);
    expect(r.shortfall).toBe(2);
  });

  it('10/17 전체회의(200명), 120명 출석 → 성립, 의결 임계=80', () => {
    // N=200, M=120: 2*120=240 > 200 → 성립
    // ⌈240/3⌉=80
    const r = computeQuorum({ enrolled: 200, present: 120 });
    expect(r.established).toBe(true);
    expect(r.decisionThreshold).toBe(80);
  });

  it('10/17 전체회의, 120명 출석, 80명 찬성 → 가결 (경계)', () => {
    const r = computeQuorum({ enrolled: 200, present: 120, yeas: 80 });
    expect(r.passed).toBe(true);
  });

  it('10/17 전체회의, 120명 출석, 79명 찬성 → 부결', () => {
    const r = computeQuorum({ enrolled: 200, present: 120, yeas: 79 });
    expect(r.passed).toBe(false);
  });
});
