import { describe, it, expect } from 'vitest';
import { MOD_TABS, DEFAULT_MOD_TAB, normalizeTabId, tabById } from './mod-tabs';

describe('MOD_TABS', () => {
  it('opens on 조별 산출물 — the actual work of 8.29', () => {
    expect(DEFAULT_MOD_TAB).toBe('submission');
    expect(MOD_TABS[0].id).toBe('submission');
  });

  it('keeps 투표·타이머 behind the main tab, since 8.29 does not use them', () => {
    const order = MOD_TABS.map((tab) => tab.id);
    expect(order.indexOf('vote')).toBeGreaterThan(order.indexOf('submission'));
    expect(order.indexOf('timer')).toBeGreaterThan(order.indexOf('submission'));
  });

  it('gives every tab a label and a hint', () => {
    for (const tab of MOD_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.hint.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate ids', () => {
    const ids = MOD_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizeTabId', () => {
  it('passes a known id through', () => {
    expect(normalizeTabId('attendance')).toBe('attendance');
  });

  // 저장값이 낡거나 깨졌을 때 빈 화면이 되지 않게 기본 탭으로 떨어뜨린다.
  it.each([undefined, null, '', 'canvas', 42, {}])('falls back to the default for %p', (value) => {
    expect(normalizeTabId(value)).toBe(DEFAULT_MOD_TAB);
  });
});

describe('tabById', () => {
  it('finds the definition for an id', () => {
    expect(tabById('timer').label).toBe('타이머');
  });

  it('never returns undefined', () => {
    expect(tabById('submission')).toBeDefined();
  });
});
