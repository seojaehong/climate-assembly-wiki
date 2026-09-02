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

export type TrustStatus = 'machine' | 'reviewed' | 'native' | 'author-verified';
export type TranslationStatus = TrustStatus;

interface BadgeCopy {
  label: string;
  ariaLabel: string;
}

export interface ContentUiCopy {
  agendaCategory: Record<'general' | 'meta' | 'action', string>;
  agendaCategoryLegend: string;
  agendaCategoryPrefix: string;
  agendaStatus: Record<'proposed' | 'discussed' | 'recommended' | 'final', string>;
  internalDraft: string;
  internalBriefDraft: string;
  internalBriefDescription: string;
  englishAvailable: string;
  englishTranslationAvailable: string;
  trust: Record<TrustStatus, BadgeCopy>;
  translationStatus: Record<TranslationStatus, BadgeCopy>;
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

const CONTENT_UI_COPY: Record<SiteLocale, ContentUiCopy> = {
  ko: {
    agendaCategory: { general: '일반', meta: '메타', action: '실행' },
    agendaCategoryLegend: '의제 분류 범례',
    agendaCategoryPrefix: '분류:',
    agendaStatus: { proposed: '제안', discussed: '논의됨', recommended: '권고', final: '최종' },
    internalDraft: '내부 가안',
    internalBriefDraft: '내부 해설 초안',
    internalBriefDescription: '공식 원천 DB가 아닌 내부 해설 초안',
    englishAvailable: '영문 번역 있음',
    englishTranslationAvailable: '영문 번역 있음',
    trust: {
      machine: { label: '기계 초안', ariaLabel: '기계 번역 초안' },
      reviewed: { label: 'LLM 검토', ariaLabel: 'LLM 검토 완료' },
      native: { label: '원어민 검증', ariaLabel: '원어민 검증' },
      'author-verified': { label: '저자 검증', ariaLabel: '저자 직접 검증' },
    },
    translationStatus: {
      machine: { label: '기계 번역', ariaLabel: '기계 번역 초안 — 검토 전' },
      reviewed: { label: '검토됨', ariaLabel: 'LLM 또는 사람이 검토한 번역' },
      native: { label: '원어민 검증', ariaLabel: '원어민이 검증한 번역' },
      'author-verified': { label: '저자 검증', ariaLabel: '저자가 직접 검증한 번역 — 최고 등급' },
    },
  },
  en: {
    agendaCategory: { general: 'General', meta: 'Meta', action: 'Action' },
    agendaCategoryLegend: 'Agenda category legend',
    agendaCategoryPrefix: 'Category:',
    agendaStatus: { proposed: 'Proposed', discussed: 'Discussed', recommended: 'Recommended', final: 'Final' },
    internalDraft: 'Internal draft',
    internalBriefDraft: 'Internal brief draft',
    internalBriefDescription: 'Internal brief draft, not an official source record',
    englishAvailable: 'English available',
    englishTranslationAvailable: 'English translation available',
    trust: {
      machine: { label: 'Machine draft', ariaLabel: 'Machine-generated draft, unreviewed' },
      reviewed: { label: 'LLM-reviewed', ariaLabel: 'LLM-assisted, moderator reviewed' },
      native: { label: 'Native-verified', ariaLabel: 'Reviewed by native speaker' },
      'author-verified': { label: 'Author-verified', ariaLabel: 'Author-verified — highest grade' },
    },
    translationStatus: {
      machine: { label: 'Machine translation', ariaLabel: 'Machine translation — unreviewed draft' },
      reviewed: { label: 'Human-reviewed', ariaLabel: 'LLM-assisted, human-reviewed translation' },
      native: { label: 'Native-verified', ariaLabel: 'Reviewed and verified by a native speaker' },
      'author-verified': { label: 'Author-verified', ariaLabel: 'Author-verified translation — highest grade' },
    },
  },
  ja: {
    agendaCategory: { general: '一般', meta: 'メタ', action: '実行' },
    agendaCategoryLegend: '議題分類の凡例',
    agendaCategoryPrefix: '分類:',
    agendaStatus: { proposed: '提案', discussed: '審議済み', recommended: '勧告', final: '最終' },
    internalDraft: '内部草案',
    internalBriefDraft: '内部解説草案',
    internalBriefDescription: '公式ソース記録ではない内部解説草案',
    englishAvailable: '英訳あり',
    englishTranslationAvailable: '英語版あり',
    trust: {
      machine: { label: '機械生成草案', ariaLabel: '未確認の機械生成草案' },
      reviewed: { label: 'LLM 確認済み', ariaLabel: 'LLM 支援、モデレーター確認済み' },
      native: { label: '母語話者確認済み', ariaLabel: '母語話者による確認済み' },
      'author-verified': { label: '著者確認済み', ariaLabel: '著者が直接確認済み' },
    },
    translationStatus: {
      machine: { label: '機械翻訳', ariaLabel: '未確認の機械翻訳草案' },
      reviewed: { label: '確認済み', ariaLabel: 'LLM または人が確認した翻訳' },
      native: { label: '母語話者確認済み', ariaLabel: '母語話者が確認した翻訳' },
      'author-verified': { label: '著者確認済み', ariaLabel: '著者が直接確認した翻訳' },
    },
  },
  zh: {
    agendaCategory: { general: '一般', meta: '元议题', action: '行动' },
    agendaCategoryLegend: '议题分类图例',
    agendaCategoryPrefix: '分类：',
    agendaStatus: { proposed: '已提议', discussed: '已讨论', recommended: '已建议', final: '最终' },
    internalDraft: '内部草案',
    internalBriefDraft: '内部解读草案',
    internalBriefDescription: '非官方来源记录的内部解读草案',
    englishAvailable: '有英文版',
    englishTranslationAvailable: '有英文译文',
    trust: {
      machine: { label: '机器草稿', ariaLabel: '未经审核的机器生成草稿' },
      reviewed: { label: 'LLM 已审核', ariaLabel: '由 LLM 辅助并经主持人审核' },
      native: { label: '母语者已审核', ariaLabel: '经母语者审核' },
      'author-verified': { label: '作者已确认', ariaLabel: '作者直接确认' },
    },
    translationStatus: {
      machine: { label: '机器翻译', ariaLabel: '未经审核的机器翻译草稿' },
      reviewed: { label: '已审核', ariaLabel: '经 LLM 或人工审核的翻译' },
      native: { label: '母语者已审核', ariaLabel: '经母语者审核的翻译' },
      'author-verified': { label: '作者已确认', ariaLabel: '作者直接确认的翻译' },
    },
  },
  es: {
    agendaCategory: { general: 'General', meta: 'Meta', action: 'Acción' },
    agendaCategoryLegend: 'Leyenda de categorías de agenda',
    agendaCategoryPrefix: 'Categoría:',
    agendaStatus: { proposed: 'Propuesto', discussed: 'Debatido', recommended: 'Recomendado', final: 'Final' },
    internalDraft: 'Borrador interno',
    internalBriefDraft: 'Borrador explicativo interno',
    internalBriefDescription: 'Borrador explicativo interno, no un registro de una fuente oficial',
    englishAvailable: 'Disponible en inglés',
    englishTranslationAvailable: 'Traducción al inglés disponible',
    trust: {
      machine: { label: 'Borrador automático', ariaLabel: 'Borrador generado automáticamente, sin revisar' },
      reviewed: { label: 'Revisado con LLM', ariaLabel: 'Asistido por LLM y revisado por moderación' },
      native: { label: 'Revisado por hablante nativo', ariaLabel: 'Revisado por una persona hablante nativa' },
      'author-verified': { label: 'Verificado por la autoría', ariaLabel: 'Verificado directamente por la autoría' },
    },
    translationStatus: {
      machine: { label: 'Traducción automática', ariaLabel: 'Borrador de traducción automática sin revisar' },
      reviewed: { label: 'Revisado', ariaLabel: 'Traducción revisada mediante LLM o por una persona' },
      native: { label: 'Revisado por hablante nativo', ariaLabel: 'Traducción revisada por una persona hablante nativa' },
      'author-verified': { label: 'Verificado por la autoría', ariaLabel: 'Traducción verificada directamente por la autoría' },
    },
  },
  ar: {
    agendaCategory: { general: 'عام', meta: 'حول العملية', action: 'إجراء' },
    agendaCategoryLegend: 'دليل فئات جدول الأعمال',
    agendaCategoryPrefix: 'الفئة:',
    agendaStatus: { proposed: 'مقترح', discussed: 'نوقش', recommended: 'موصى به', final: 'نهائي' },
    internalDraft: 'مسودة داخلية',
    internalBriefDraft: 'مسودة شرح داخلية',
    internalBriefDescription: 'مسودة شرح داخلية وليست سجلًا من مصدر رسمي',
    englishAvailable: 'متوفر بالإنجليزية',
    englishTranslationAvailable: 'تتوفر ترجمة إنجليزية',
    trust: {
      machine: { label: 'مسودة آلية', ariaLabel: 'مسودة مولدة آليًا لم تراجع' },
      reviewed: { label: 'راجعه نموذج لغوي', ariaLabel: 'بمساعدة نموذج لغوي ومراجعة الميسّر' },
      native: { label: 'تحقق منها متحدث أصلي', ariaLabel: 'راجعها متحدث أصلي' },
      'author-verified': { label: 'تحقق منها المؤلف', ariaLabel: 'تحقق منها المؤلف مباشرة' },
    },
    translationStatus: {
      machine: { label: 'ترجمة آلية', ariaLabel: 'مسودة ترجمة آلية لم تراجع' },
      reviewed: { label: 'تمت المراجعة', ariaLabel: 'ترجمة راجعها نموذج لغوي أو شخص' },
      native: { label: 'تحقق منها متحدث أصلي', ariaLabel: 'ترجمة راجعها متحدث أصلي' },
      'author-verified': { label: 'تحقق منها المؤلف', ariaLabel: 'ترجمة تحقق منها المؤلف مباشرة' },
    },
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

export function contentUiCopy(value: string | undefined): ContentUiCopy {
  return isSiteLocale(value) ? CONTENT_UI_COPY[value] : CONTENT_UI_COPY.en;
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
