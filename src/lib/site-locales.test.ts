import { describe, expect, it } from 'vitest';

import {
  SITE_LOCALE_CODES,
  SITE_LOCALES,
  STRUCTURAL_LOCALE_CODES,
  isSiteLocale,
  localeDirection,
  localeOgTag,
  replaceLocalePrefix,
} from './site-locales';

describe('site locale registry', () => {
  it('defines every public locale in navigation order', () => {
    expect(SITE_LOCALE_CODES).toEqual(['ko', 'en', 'ja', 'zh', 'es', 'ar']);
    expect(SITE_LOCALES.map(({ label }) => label)).toEqual([
      '한국어',
      'English',
      '日本語',
      '中文',
      'Español',
      'العربية',
    ]);
    expect(STRUCTURAL_LOCALE_CODES).toEqual(['ja', 'zh', 'es', 'ar']);
  });

  it('uses RTL only for Arabic and exposes Open Graph locale tags', () => {
    expect(localeDirection('ar')).toBe('rtl');
    expect(localeDirection('ko')).toBe('ltr');
    expect(localeDirection('unknown')).toBe('ltr');
    expect(localeOgTag('ar')).toBe('ar');
    expect(localeOgTag('zh')).toBe('zh_CN');
    expect(localeOgTag('unknown')).toBe('en_US');
  });

  it('recognizes locales and replaces or inserts the path locale safely', () => {
    expect(isSiteLocale('ar')).toBe(true);
    expect(isSiteLocale('fr')).toBe(false);
    expect(replaceLocalePrefix('/ko/agenda/topic/', 'ar')).toBe('/ar/agenda/topic/');
    expect(replaceLocalePrefix('/agenda/topic/', 'ar')).toBe('/ar/agenda/topic/');
    expect(replaceLocalePrefix('/', 'ar')).toBe('/ar/');
  });
});
