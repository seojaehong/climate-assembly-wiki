import { describe, expect, it } from 'vitest';

import {
  SITE_LOCALE_CODES,
  SITE_LOCALES,
  STRUCTURAL_LOCALE_CODES,
  contentUiCopy,
  isSiteLocale,
  localeDirection,
  localeOgTag,
  replaceLocalePrefix,
  siteShellCopy,
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

  it('provides localized shell controls without treating structural locales as Korean', () => {
    expect(siteShellCopy('ar')).toMatchObject({
      siteName: 'ويكي جمعية المواطنين للمناخ في كوريا',
      skipToContent: 'الانتقال إلى المحتوى الرئيسي',
      openSearch: 'فتح البحث (/)',
      sectionNavigation: 'التنقل بين الأقسام',
      footerDisclaimer: 'هذا أرشيف مستقل وليس منشورًا حكوميًا رسميًا.',
    });
    expect(siteShellCopy('ja').openMenu).toBe('メニューを開く');
    expect(siteShellCopy('zh').searchClose).toBe('关闭');
    expect(siteShellCopy('es').license).toBe('Licencia');
    expect(siteShellCopy('unknown').siteName).toBe('Korea Climate Assembly Wiki');
  });

  it('provides localized agenda and trust labels for every public locale', () => {
    expect(contentUiCopy('ar')).toMatchObject({
      agendaCategory: { general: 'عام', meta: 'حول العملية', action: 'إجراء' },
      agendaCategoryLegend: 'دليل فئات جدول الأعمال',
      agendaCategoryPrefix: 'الفئة:',
      agendaStatus: { proposed: 'مقترح', discussed: 'نوقش', recommended: 'موصى به', final: 'نهائي' },
      internalDraft: 'مسودة داخلية',
      trust: {
        machine: { label: 'مسودة آلية' },
        native: { label: 'تحقق منها متحدث أصلي' },
      },
      translationStatus: {
        reviewed: { label: 'تمت المراجعة' },
        'author-verified': { label: 'تحقق منها المؤلف' },
      },
    });
    expect(contentUiCopy('ja').agendaStatus.recommended).toBe('勧告');
    expect(contentUiCopy('zh').trust.reviewed.label).toBe('LLM 已审核');
    expect(contentUiCopy('es').translationStatus.machine.label).toBe('Traducción automática');
    expect(contentUiCopy('unknown').agendaCategory.action).toBe('Action');
  });
});
