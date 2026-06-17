import { describe, it, expect } from 'vitest';
import { joColor, BG_PRESETS } from './palette';

describe('joColor', () => {
  it('조마다 다른 색을 준다 (A조 ≠ B조)', () => {
    expect(joColor('A조').bg).not.toBe(joColor('B조').bg);
  });
  it('같은 조는 항상 같은 색 (결정적)', () => {
    expect(joColor('C조').bg).toBe(joColor('C조').bg);
  });
  it('공백/유사 표기를 정규화한다 (" A조 " === "A조")', () => {
    expect(joColor(' A조 ').bg).toBe(joColor('A조').bg);
  });
  it('null/빈값은 기본(미배정) 색', () => {
    expect(joColor(null).bg).toBe(joColor('').bg);
  });
  it('항상 어두운 잉크색을 동반한다 (대형스크린 대비)', () => {
    expect(joColor('A조').ink).toMatch(/^#/);
  });
});

describe('BG_PRESETS', () => {
  it('대시보드 배경 프리셋이 2개 이상', () => {
    expect(BG_PRESETS.length).toBeGreaterThanOrEqual(2);
  });
  it('각 프리셋은 라벨·배경·점색을 갖는다', () => {
    for (const p of BG_PRESETS) {
      expect(p.label).toBeTruthy();
      expect(p.bg).toMatch(/^#/);
      expect(p.dot).toMatch(/^#/);
    }
  });
});
