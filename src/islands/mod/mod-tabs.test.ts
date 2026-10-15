import { describe, it, expect } from 'vitest';
import { MOD_TABS, DEFAULT_MOD_TAB, normalizeTabId, tabAfterKey, tabById, isDecisionOnlySession, visibleTabs } from './mod-tabs';

describe('MOD_TABS', () => {
  it('opens on 의제 진행 — the current workshop task', () => {
    expect(DEFAULT_MOD_TAB).toBe('progress');
    expect(MOD_TABS[0].id).toBe('progress');
  });

  it('keeps 투표·타이머 behind the main tab', () => {
    const order = MOD_TABS.map((tab) => tab.id);
    expect(order.indexOf('vote')).toBeGreaterThan(order.indexOf('progress'));
    expect(order.indexOf('timer')).toBeGreaterThan(order.indexOf('progress'));
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

  it('puts the 10/17 의결 tab last without changing the default', () => {
    expect(MOD_TABS[MOD_TABS.length - 1].id).toBe('decision');
    expect(tabById('decision').label).toBe('10/17 의결');
    expect(normalizeTabId('decision')).toBe('decision');
  });

  it('has no duplicate ids', () => {
    const ids = MOD_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('normalizeTabId', () => {
  it('passes a known id through', () => {
    expect(normalizeTabId('attendance')).toBe(DEFAULT_MOD_TAB);
  });

  // 저장값이 낡거나 깨졌을 때 빈 화면이 되지 않게 기본 탭으로 떨어뜨린다.
  it.each([undefined, null, '', 'canvas', 42, {}])('falls back to the default for %p', (value) => {
    expect(normalizeTabId(value)).toBe(DEFAULT_MOD_TAB);
  });
});

describe('tabAfterKey — roving keyboard navigation', () => {
  it('wraps with horizontal and vertical arrow keys', () => {
    expect(tabAfterKey('progress', 'ArrowLeft')).toBe('decision');
    expect(tabAfterKey('decision', 'ArrowRight')).toBe('progress');
    expect(tabAfterKey('timer', 'ArrowRight')).toBe('decision');
    expect(tabAfterKey('progress', 'ArrowUp')).toBe('decision');
    expect(tabAfterKey('decision', 'ArrowDown')).toBe('progress');
  });

  it('supports Home and End and ignores unrelated keys', () => {
    expect(tabAfterKey('vote', 'Home')).toBe('progress');
    expect(tabAfterKey('submission', 'End')).toBe('decision');
    expect(tabAfterKey('submission', 'Enter')).toBeNull();
  });
});

describe('tabById', () => {
  it('finds the definition for an id', () => {
    expect(tabById('timer').label).toBe('타이머');
  });

  it('never returns undefined', () => {
    expect(tabById('progress')).toBeDefined();
  });
});

describe('visibleTabs — 10/17 세션은 의결 탭만', () => {
  it('keeps only 10/17 의결 for 1017 sessions (real, rehearsal, dry-run)', () => {
    for (const slug of ['1017-division-vote', 'zz-rehearsal-1017', 'zz-rehearsal-1017-2', 'zz-dryrun-1017-20261015t0900']) {
      expect(isDecisionOnlySession(slug)).toBe(true);
      expect(visibleTabs(slug).map((t) => t.id)).toEqual(['decision']);
    }
  });
  it('keeps every tab for other sessions', () => {
    for (const slug of ['0912-deliberation', 'zz-x-10170', null, undefined]) {
      expect(isDecisionOnlySession(slug)).toBe(false);
      expect(visibleTabs(slug)).toBe(MOD_TABS);
    }
  });
  it('arrow keys stay inside the visible tabs', () => {
    const only = visibleTabs('1017-division-vote');
    expect(tabAfterKey('decision', 'ArrowRight', only)).toBe('decision');
    expect(tabAfterKey('decision', 'Home', only)).toBe('decision');
  });
});
