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

export interface SiteShellCopy {
  siteName: string;
  defaultDescription: string;
  skipToContent: string;
  mainNavigation: string;
  mobileNavigation: string;
  sectionNavigation: string;
  openSearch: string;
  openMenu: string;
  themeToggle: string;
  searchPlaceholder: string;
  searchClose: string;
  searchLabel: string;
  searchNavigate: string;
  searchOpen: string;
  searchShortcut: string;
  searchIndexUnavailable: string;
  footerModerator: string;
  footerDisclaimer: string;
  githubNewTab: string;
  license: string;
  licenseNewTab: string;
  contact: string;
  contactNewTab: string;
}

const SITE_SHELL_COPY: Record<SiteLocale, SiteShellCopy> = {
  ko: {
    siteName: '기후시민회의 Wiki',
    defaultDescription: '2026 기후시민회의 모더레이터 아카이브 및 다국어 위키',
    skipToContent: '본문으로 건너뛰기',
    mainNavigation: '주요 탐색',
    mobileNavigation: '모바일 탐색',
    sectionNavigation: '섹션 탐색',
    openSearch: '검색 열기 (/)',
    openMenu: '메뉴 열기',
    themeToggle: '다크 모드 전환',
    searchPlaceholder: '용어, 의제, 회차 검색…',
    searchClose: '닫기',
    searchLabel: '위키 전체 검색',
    searchNavigate: '탐색',
    searchOpen: '열기',
    searchShortcut: '검색 단축키',
    searchIndexUnavailable: '검색 인덱스는 빌드 후 사용 가능합니다.',
    footerModerator: ' 모더레이터: 서재홍.',
    footerDisclaimer: '이 사이트는 독립 아카이브로 정부 공식 발간물이 아닙니다.',
    githubNewTab: 'GitHub (새 탭)',
    license: '라이선스',
    licenseNewTab: 'CC BY-SA 4.0 라이선스 (새 탭)',
    contact: '문의',
    contactNewTab: '문의 (GitHub 이슈, 새 탭)',
  },
  en: {
    siteName: 'Korea Climate Assembly Wiki',
    defaultDescription: '2026 Korea Climate Citizens’ Assembly — Moderator Archive & Multilingual Wiki',
    skipToContent: 'Skip to main content',
    mainNavigation: 'Main navigation',
    mobileNavigation: 'Mobile navigation',
    sectionNavigation: 'Section navigation',
    openSearch: 'Open search (/)',
    openMenu: 'Open menu',
    themeToggle: 'Toggle dark mode',
    searchPlaceholder: 'Search agendas, sessions, tools…',
    searchClose: 'Close',
    searchLabel: 'Search the wiki',
    searchNavigate: 'navigate',
    searchOpen: 'open',
    searchShortcut: 'shortcut',
    searchIndexUnavailable: 'Search index is available after build.',
    footerModerator: ' Moderator: Jaehong Seo.',
    footerDisclaimer: 'This is an independent archive, not an official government publication.',
    githubNewTab: 'GitHub (new tab)',
    license: 'License',
    licenseNewTab: 'CC BY-SA 4.0 License (new tab)',
    contact: 'Contact',
    contactNewTab: 'Contact via GitHub issue (new tab)',
  },
  ja: {
    siteName: '韓国気候市民会議 Wiki',
    defaultDescription: '2026 韓国気候市民会議のモデレーター・アーカイブと多言語 Wiki',
    skipToContent: 'メインコンテンツへ移動',
    mainNavigation: 'メインナビゲーション',
    mobileNavigation: 'モバイルナビゲーション',
    sectionNavigation: 'セクションナビゲーション',
    openSearch: '検索を開く (/)',
    openMenu: 'メニューを開く',
    themeToggle: 'ダークモードを切り替え',
    searchPlaceholder: '用語、議題、会合を検索…',
    searchClose: '閉じる',
    searchLabel: 'Wiki を検索',
    searchNavigate: '移動',
    searchOpen: '開く',
    searchShortcut: 'ショートカット',
    searchIndexUnavailable: '検索インデックスはビルド後に利用できます。',
    footerModerator: ' モデレーター: Jaehong Seo.',
    footerDisclaimer: 'これは独立アーカイブであり、政府の公式刊行物ではありません。',
    githubNewTab: 'GitHub (新しいタブ)',
    license: 'ライセンス',
    licenseNewTab: 'CC BY-SA 4.0 ライセンス (新しいタブ)',
    contact: 'お問い合わせ',
    contactNewTab: 'GitHub Issue で問い合わせ (新しいタブ)',
  },
  zh: {
    siteName: '韩国气候公民大会 Wiki',
    defaultDescription: '2026 韩国气候公民大会主持人档案与多语言 Wiki',
    skipToContent: '跳转到主要内容',
    mainNavigation: '主导航',
    mobileNavigation: '移动端导航',
    sectionNavigation: '章节导航',
    openSearch: '打开搜索 (/)',
    openMenu: '打开菜单',
    themeToggle: '切换深色模式',
    searchPlaceholder: '搜索术语、议题和场次…',
    searchClose: '关闭',
    searchLabel: '搜索 Wiki',
    searchNavigate: '导航',
    searchOpen: '打开',
    searchShortcut: '快捷键',
    searchIndexUnavailable: '搜索索引将在构建后可用。',
    footerModerator: ' 主持人：Jaehong Seo。',
    footerDisclaimer: '这是一个独立档案，并非政府官方出版物。',
    githubNewTab: 'GitHub（新标签页）',
    license: '许可证',
    licenseNewTab: 'CC BY-SA 4.0 许可证（新标签页）',
    contact: '联系',
    contactNewTab: '通过 GitHub Issue 联系（新标签页）',
  },
  es: {
    siteName: 'Wiki de la Asamblea Ciudadana por el Clima de Corea',
    defaultDescription: 'Archivo de moderación y wiki multilingüe de la Asamblea Ciudadana por el Clima de Corea 2026',
    skipToContent: 'Saltar al contenido principal',
    mainNavigation: 'Navegación principal',
    mobileNavigation: 'Navegación móvil',
    sectionNavigation: 'Navegación de secciones',
    openSearch: 'Abrir búsqueda (/)',
    openMenu: 'Abrir menú',
    themeToggle: 'Cambiar modo oscuro',
    searchPlaceholder: 'Buscar términos, agendas y sesiones…',
    searchClose: 'Cerrar',
    searchLabel: 'Buscar en la wiki',
    searchNavigate: 'navegar',
    searchOpen: 'abrir',
    searchShortcut: 'atajo',
    searchIndexUnavailable: 'El índice de búsqueda estará disponible después de compilar.',
    footerModerator: ' Moderador: Jaehong Seo.',
    footerDisclaimer: 'Este es un archivo independiente, no una publicación oficial del Gobierno.',
    githubNewTab: 'GitHub (nueva pestaña)',
    license: 'Licencia',
    licenseNewTab: 'Licencia CC BY-SA 4.0 (nueva pestaña)',
    contact: 'Contacto',
    contactNewTab: 'Contacto mediante un issue de GitHub (nueva pestaña)',
  },
  ar: {
    siteName: 'ويكي جمعية المواطنين للمناخ في كوريا',
    defaultDescription: 'أرشيف التيسير والويكي متعدد اللغات لجمعية المواطنين للمناخ في كوريا 2026',
    skipToContent: 'الانتقال إلى المحتوى الرئيسي',
    mainNavigation: 'التنقل الرئيسي',
    mobileNavigation: 'التنقل عبر الهاتف',
    sectionNavigation: 'التنقل بين الأقسام',
    openSearch: 'فتح البحث (/)',
    openMenu: 'فتح القائمة',
    themeToggle: 'تبديل الوضع الداكن',
    searchPlaceholder: 'البحث في المصطلحات والموضوعات والجلسات…',
    searchClose: 'إغلاق',
    searchLabel: 'البحث في الويكي',
    searchNavigate: 'تنقل',
    searchOpen: 'فتح',
    searchShortcut: 'اختصار',
    searchIndexUnavailable: 'سيتاح فهرس البحث بعد البناء.',
    footerModerator: ' الميسّر: Jaehong Seo.',
    footerDisclaimer: 'هذا أرشيف مستقل وليس منشورًا حكوميًا رسميًا.',
    githubNewTab: 'GitHub (علامة تبويب جديدة)',
    license: 'الترخيص',
    licenseNewTab: 'ترخيص CC BY-SA 4.0 (علامة تبويب جديدة)',
    contact: 'تواصل',
    contactNewTab: 'التواصل عبر GitHub Issue (علامة تبويب جديدة)',
  },
};

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

export function siteShellCopy(value: string | undefined): SiteShellCopy {
  return isSiteLocale(value) ? SITE_SHELL_COPY[value] : SITE_SHELL_COPY.en;
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
