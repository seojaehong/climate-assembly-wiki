import { describe, it, expect } from 'vitest';
import { joColor, BG_PRESETS, readableInk, groupColor } from './palette';

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

describe('joColor 20색 유동', () => {
  it('20개 조(A조~T조)가 거의 다 고유색', () => {
    const labels = Array.from({ length: 20 }, (_, i) => String.fromCharCode(65 + i) + '조');
    const bgs = new Set(labels.map((l) => joColor(l).bg));
    expect(bgs.size).toBeGreaterThanOrEqual(18);
  });
  it('숫자 조(1조,2조)도 서로 다른 색', () => {
    expect(joColor('1조').bg).not.toBe(joColor('2조').bg);
  });
});

describe('groupColor', () => {
  it('group_id마다 결정적', () => {
    expect(groupColor('g-abc')).toBe(groupColor('g-abc'));
  });
  it('다른 group_id는 (대개) 다른 색', () => {
    expect(groupColor('g-1')).not.toBe(groupColor('g-7'));
  });
  it('항상 hex', () => {
    expect(groupColor('any')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('readableInk', () => {
  it('밝은 배경엔 어두운 잉크', () => {
    expect(readableInk('#FACC15')).toBe('#1f2937');
    expect(readableInk('#ffffff')).toBe('#1f2937');
  });
  it('어두운 배경엔 밝은 잉크', () => {
    expect(readableInk('#0b1220')).toBe('#f8fafc');
    expect(readableInk('#111827')).toBe('#f8fafc');
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
