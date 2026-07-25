import { describe, expect, test } from 'vitest';
import { TOP_NAV_ITEMS } from './navigation';

describe('field operations navigation', () => {
  test('exposes moderator, headquarters, and guide entry points', () => {
    const fieldOps = TOP_NAV_ITEMS.find((item) => item.section === 'field-ops');

    expect(fieldOps).toMatchObject({
      labelKo: '현장 운영',
      labelEn: 'Field Ops',
      href: '/mod/',
    });
    expect(fieldOps?.children).toEqual([
      { labelKo: '모더레이터 콘솔', labelEn: 'Moderator Console', href: '/mod/' },
      { labelKo: '본부 현황', labelEn: 'Headquarters', href: '/hq/' },
      { labelKo: '사용법', labelEn: 'Console Guide', href: '/mod-help/' },
    ]);
  });
});
