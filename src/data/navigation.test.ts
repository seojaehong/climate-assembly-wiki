import { describe, expect, test } from 'vitest';
import { navigationGroupLabel, navigationLabel, TOP_NAV_ITEMS } from './navigation';

describe('field operations navigation', () => {
  test('exposes moderator, headquarters, and guide entry points', () => {
    const fieldOps = TOP_NAV_ITEMS.find((item) => item.section === 'field-ops');

    expect(fieldOps).toMatchObject({
      labelKo: '현장 운영',
      labelEn: 'Field Ops',
      href: '/mod/',
    });
    expect(fieldOps?.children).toMatchObject([
      { labelKo: '모더레이터 콘솔', labelEn: 'Moderator Console', href: '/mod/' },
      { labelKo: '본부 현황', labelEn: 'Headquarters', href: '/hq/' },
      { labelKo: '사용법', labelEn: 'Console Guide', href: '/mod-help/' },
    ]);
  });

  test('localizes shared navigation chrome while preserving an English fallback', () => {
    const agenda = TOP_NAV_ITEMS.find((item) => item.section === 'agenda');
    const fieldOps = TOP_NAV_ITEMS.find((item) => item.section === 'field-ops');

    expect(agenda && navigationLabel(agenda, 'ja')).toBe('議題');
    expect(fieldOps && navigationLabel(fieldOps, 'ar')).toBe('العمليات الميدانية');
    expect(fieldOps?.children?.[0] && navigationLabel(fieldOps.children[0], 'es')).toBe('Consola de moderación');
    expect(agenda && navigationLabel(agenda, 'unknown')).toBe('Agenda');
    expect(navigationGroupLabel('감축1', 'zh')).toBe('减排 1');
    expect(navigationGroupLabel('적응', 'ar')).toBe('التكيف');
    expect(navigationGroupLabel('unmapped', 'ar')).toBe('unmapped');
  });
});
