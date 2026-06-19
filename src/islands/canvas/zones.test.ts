import { describe, it, expect } from 'vitest';
import { zoneForX, ZONE_FRAMES } from './zones';

describe('zoneForX', () => {
  it('각 프레임 범위 내 x는 해당 zone', () => {
    expect(zoneForX(100)).toBe('감축');   // [-40,560)
    expect(zoneForX(800)).toBe('적응');    // [600,1200)
    expect(zoneForX(1400)).toBe('미분류'); // [1240,1840)
  });
  it('범위 밖 x는 가장 가까운 프레임', () => {
    expect(zoneForX(99999)).toBe('미분류');
    expect(zoneForX(-99999)).toBe('감축');
  });
  it('프레임 3개(감축/적응/미분류)', () => {
    expect(ZONE_FRAMES.map((f) => f.zone)).toEqual(['감축', '적응', '미분류']);
  });
});
