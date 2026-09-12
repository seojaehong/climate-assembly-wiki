import { describe, expect, it } from 'vitest';
import { AGENDA_CATALOG_0912, AGENDA_SOURCE_HASHES } from './0912-agenda-catalog';

describe('9/12 agenda catalog', () => {
  it('contains the canonical 9·8·8 agenda counts', () => {
    const counts = new Map<string, number>();
    for (const item of AGENDA_CATALOG_0912) {
      counts.set(item.subgroup, (counts.get(item.subgroup) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({ '1분과': 9, '2분과': 8, '3분과': 8 });
  });

  it('uses unique stable ids and ordinals inside each division', () => {
    expect(new Set(AGENDA_CATALOG_0912.map((item) => item.id)).size).toBe(25);
    for (const subgroup of ['1분과', '2분과', '3분과']) {
      const ordinals = AGENDA_CATALOG_0912
        .filter((item) => item.subgroup === subgroup)
        .map((item) => item.ordinal);
      expect(ordinals).toEqual(Array.from({ length: ordinals.length }, (_, index) => index + 1));
    }
  });

  it('keeps screen sources anonymous and tied to the three received HWP hashes', () => {
    expect(Object.keys(AGENDA_SOURCE_HASHES)).toEqual(['1분과', '2분과', '3분과']);
    for (const item of AGENDA_CATALOG_0912) {
      expect(item.sourceUtterances.length).toBeGreaterThan(0);
      expect(item.sourceUtterances.join(' ')).not.toMatch(/\d조\s+[가-힣]{2,4}/);
    }
  });
});
