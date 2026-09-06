import { describe, it, expect } from 'vitest';
import { MOD_TABS, DEFAULT_MOD_TAB, normalizeTabId, tabAfterKey, tabById } from './mod-tabs';

describe('MOD_TABS', () => {
  it('opens on 조별 산출물 — the current workshop task', () => {
    expect(DEFAULT_MOD_TAB).toBe('submission');
    expect(MOD_TABS[0].id).toBe('submission');
  });

  it('keeps 투표·타이머 behind the main tab', () => {
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

  it('does not expose the old 8.29 three-topic instruction', () => {
    const copy = MOD_TABS.map((tab) => `${tab.label} ${tab.hint}`).join(' ');
    expect(copy).toContain('현재 열린 단계');
    expect(copy).not.toContain('8.29');
    expect(copy).not.toContain('세 꼭지');
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

describe('tabAfterKey — roving keyboard navigation', () => {
  it('wraps with horizontal and vertical arrow keys', () => {
    expect(tabAfterKey('submission', 'ArrowLeft')).toBe('timer');
    expect(tabAfterKey('timer', 'ArrowRight')).toBe('submission');
    expect(tabAfterKey('submission', 'ArrowUp')).toBe('timer');
    expect(tabAfterKey('timer', 'ArrowDown')).toBe('submission');
  });

  it('supports Home and End and ignores unrelated keys', () => {
    expect(tabAfterKey('vote', 'Home')).toBe('submission');
    expect(tabAfterKey('attendance', 'End')).toBe('timer');
    expect(tabAfterKey('attendance', 'Enter')).toBeNull();
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
