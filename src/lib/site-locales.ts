export const SITE_LOCALES = [
  { code: 'ko', label: '한국어', direction: 'ltr', ogLocale: 'ko_KR', contentMode: 'native' },
  { code: 'en', label: 'English', direction: 'ltr', ogLocale: 'en_US', contentMode: 'translated' },
  { code: 'ja', label: '日本語', direction: 'ltr', ogLocale: 'ja_JP', contentMode: 'structural' },
  { code: 'zh', label: '中文', direction: 'ltr', ogLocale: 'zh_CN', contentMode: 'structural' },
  { code: 'es', label: 'Español', direction: 'ltr', ogLocale: 'es_ES', contentMode: 'structural' },
  { code: 'ar', label: 'العربية', direction: 'rtl', ogLocale: 'ar', contentMode: 'structural' },
] as const;

export type SiteLocale = (typeof SITE_LOCALES)[number]['code'];
export type TextDirection = (typeof SITE_LOCALES)[number]['direction'];

export const SITE_LOCALE_CODES: SiteLocale[] = SITE_LOCALES.map(({ code }) => code);
export const STRUCTURAL_LOCALE_CODES: SiteLocale[] = SITE_LOCALES
  .filter(({ contentMode }) => contentMode === 'structural')
  .map(({ code }) => code);

export function isSiteLocale(value: string | undefined): value is SiteLocale {
  return SITE_LOCALE_CODES.some((code) => code === value);
}

export function localeDirection(value: string | undefined): TextDirection {
  return SITE_LOCALES.find(({ code }) => code === value)?.direction ?? 'ltr';
}

export function localeOgTag(value: string | undefined): string {
  return SITE_LOCALES.find(({ code }) => code === value)?.ogLocale ?? 'en_US';
}

export function replaceLocalePrefix(pathname: string, targetLocale: SiteLocale): string {
  const segments = pathname.split('/').filter(Boolean);
  if (isSiteLocale(segments[0])) {
    segments[0] = targetLocale;
  } else {
    segments.unshift(targetLocale);
  }

  const trailingSlash = pathname.endsWith('/') || pathname === '/' ? '/' : '';
  return `/${segments.join('/')}${trailingSlash}`;
}
