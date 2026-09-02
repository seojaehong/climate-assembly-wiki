/**
 * navigation.ts — Static navigation data for SiteSidebar.astro and SiteHeader.astro
 *
 * Design §3.5: Sidebar items are built from static arrays (not getCollection() calls)
 * to avoid re-fetching on every page render.
 *
 * Structure:
 *   - TOP_NAV_ITEMS: 6 sections shown in SiteHeader main nav
 *   - SIDEBAR_SECTIONS: 4 sections with sub-items shown in SiteSidebar
 *
 * Usage:
 *   import { TOP_NAV_ITEMS, SIDEBAR_SECTIONS } from '@/data/navigation';
 */

import { isSiteLocale, type SiteLocale } from '../lib/site-locales';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NavItem {
  /** URL path segment, e.g. 'agenda' → href becomes /{lang}/agenda/ */
  section: string;
  /** Korean label */
  labelKo: string;
  /** English label */
  labelEn: string;
  /** Shared-navigation labels for structural locales; native review is tracked separately. */
  labels?: Partial<Record<Exclude<SiteLocale, 'ko' | 'en'>, string>>;
  /** Optional absolute href override (skips /{lang}/ prefix). Used for static demo pages. */
  href?: string;
  /** Open in new tab (for static demo pages outside the wiki app) */
  external?: boolean;
  /** Optional dropdown items for a top-level section */
  children?: {
    labelKo: string;
    labelEn: string;
    labels?: Partial<Record<Exclude<SiteLocale, 'ko' | 'en'>, string>>;
    href: string;
    external?: boolean;
  }[];
}

export interface SidebarItem {
  /** Human-readable label (Korean) */
  labelKo: string;
  /** Human-readable label (English) */
  labelEn: string;
  /** URL path relative to /{lang}/, e.g. 'agenda/01-nuclear-vs-renewable' */
  path: string;
  /** Optional sub-group tag for visual grouping (does not affect routing) */
  group?: string;
}

export interface SidebarSection {
  /** Section identifier — matches URL section segment */
  id: string;
  /** Korean section heading */
  labelKo: string;
  /** English section heading */
  labelEn: string;
  /** Section-heading labels for structural locales; native review is tracked separately. */
  labels?: Partial<Record<Exclude<SiteLocale, 'ko' | 'en'>, string>>;
  items: SidebarItem[];
}

// ---------------------------------------------------------------------------
// Header: Top-level navigation (6 sections per Design §1.2)
// Search (/search/) is a utility page — rendered as an icon button, NOT listed here.
// ---------------------------------------------------------------------------

export const TOP_NAV_ITEMS: NavItem[] = [
  {
    section: 'agenda',
    labelKo: '의제',
    labelEn: 'Agenda',
    labels: { ja: '議題', zh: '议题', es: 'Agenda', ar: 'جدول الأعمال' },
  },
  // 2026-06-13: '리서치' (research) temporarily hidden for 6/13 workshop demo —
  // research/* pages still build, but link removed from public nav.
  // { section: 'research',  labelKo: '리서치',  labelEn: 'Research' },
  // 2026-06-13: '이벤트' demo link.
  // 2026-06-15 정리: /event/는 더미 데이터(감축1~5/적응1~5)라 사용자 혼선 유발 → 실제 198 의제 3D 버블인 /race-bubble/로 재지정.
  // /event/는 noindex + 데모/템플릿 폴더로 격리 예정.
  // 2026-06-22: 탭 숨김 — race-bubble 겹침 이슈 후속 정비 중. 직접 URL(/race-bubble/, /event/) 접근은 보존
  // { section: 'event', labelKo: '이벤트', labelEn: 'Event', href: '/race-bubble/', external: true },
  // 2026-07-04: 탭 숨김 — public top nav는 의제 + 숙의 온톨로지만 유지. 직접 URL(/global/) 접근은 보존.
  // { section: 'global', labelKo: '해외사례', labelEn: 'Global', href: '/global/', external: true },
  // 2026-06-22: '숙의 온톨로지' — 6/13-14 워크숍 하버마스 기반 온톨로지 그래프.
  // 2026-08-29: 탭 숨김. 8.29 제5차 회의 당일, 공개 상단 탭에 6월 워크숍 기록이 남아
  //   있으면 오늘의 숙의 결과로 읽힌다. 직접 URL(/workshop-graph/) 접근은 보존한다
  //   — 페이지를 지우는 것이 아니라 안내 동선에서만 뺀다.
  // {
  //   section: 'workshop-graph',
  //   labelKo: '숙의 온톨로지',
  //   labelEn: 'Deliberation Map',
  //   href: '/workshop-graph/',
  //   external: true,
  // },
  {
    section: 'field-ops',
    labelKo: '현장 운영',
    labelEn: 'Field Ops',
    labels: { ja: '現場運営', zh: '现场运营', es: 'Operaciones de campo', ar: 'العمليات الميدانية' },
    href: '/mod/',
    children: [
      {
        labelKo: '모더레이터 콘솔',
        labelEn: 'Moderator Console',
        labels: { ja: 'モデレーターコンソール', zh: '主持人控制台', es: 'Consola de moderación', ar: 'وحدة تحكم الميسّر' },
        href: '/mod/',
      },
      {
        labelKo: '본부 현황',
        labelEn: 'Headquarters',
        labels: { ja: '本部状況', zh: '总部状态', es: 'Estado de la sede', ar: 'حالة المقر' },
        href: '/hq/',
      },
      {
        labelKo: '사용법',
        labelEn: 'Console Guide',
        labels: { ja: '利用ガイド', zh: '使用指南', es: 'Guía de la consola', ar: 'دليل وحدة التحكم' },
        href: '/mod-help/',
      },
    ],
  },
  // 2026-06-13: '운영규정 의견' — 3교시 A조/B조 시민 포스트잇 의견 시각화
  // 2026-06-22: 탭 숨김 — 6/13 일회성 시각화라 일반 탐색에 노출 불필요. 직접 URL(/ko/regulation-feedback/) 보존
  // { section: 'regulation-feedback', labelKo: '운영규정 의견', labelEn: 'Regulation Feedback' },
  // <!-- temporarily hidden, content private as of 2026-06-02 -->
  // { section: 'tools',     labelKo: '도구',    labelEn: 'Tools' },
  // { section: 'sessions',  labelKo: '회차',    labelEn: 'Sessions' },
  // { section: 'doc',       labelKo: '자료',    labelEn: 'Resources' },
  // { section: 'glossary',  labelKo: '용어집',  labelEn: 'Glossary' },
  // { section: 'downloads', labelKo: '다운로드', labelEn: 'Downloads' },
];

// ---------------------------------------------------------------------------
// Sidebar: 4 sections with sub-items (Design §3.5)
// Agenda section: items grouped by category per the sidebar structure in §3.5.
// ---------------------------------------------------------------------------

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  // ─── Section 1: Agenda ────────────────────────────────────────────────────
  // Categories: 감축1 / 감축2 / 적응 / 메타 (per Design §3.5)
  {
    id: 'agenda',
    labelKo: '의제',
    labelEn: 'Agenda',
    labels: { ja: '議題', zh: '议题', es: 'Agenda', ar: 'جدول الأعمال' },
    items: [
      // [감축1] — Direct GHG reduction (domestic energy mix)
      { group: '감축1', labelKo: '01 핵발전 vs 재생에너지',  labelEn: '01 Nuclear vs Renewable',         path: 'agenda/01-nuclear-vs-renewable' },
      { group: '감축1', labelKo: '02 전기요금',              labelEn: '02 Electricity Price',             path: 'agenda/02-electricity-price' },
      { group: '감축1', labelKo: '03 지자체 온실가스 감축',  labelEn: '03 Metro Gov. GHG',               path: 'agenda/03-seoul-metro-gap' },
      { group: '감축1', labelKo: '04 내연기관 퇴출',         labelEn: '04 ICE Vehicle Phase-out',         path: 'agenda/04-ice-vehicle-phaseout' },
      // [감축2] — Emerging / systemic reduction
      { group: '감축2', labelKo: '11 AI 데이터센터',         labelEn: '11 AI Data Centers',              path: 'agenda/11-ai-datacenter' },
      { group: '감축2', labelKo: '12 개도국 9변수',          labelEn: '12 Developing 9 Variables',       path: 'agenda/12-developing-9vars' },
      { group: '감축2', labelKo: '13 재생에너지 제로섬',     labelEn: '13 Renewable Zero-sum',           path: 'agenda/13-renewable-zerosum' },
      // [적응] — Climate adaptation and justice
      { group: '적응',  labelKo: '05 기후불평등',            labelEn: '05 Climate Injustice',            path: 'agenda/05-climate-injustice' },
      { group: '적응',  labelKo: '06 생활규제',              labelEn: '06 Lifestyle Regulation',         path: 'agenda/06-lifestyle-regulation' },
      { group: '적응',  labelKo: '07 개도국 지원',           labelEn: '07 Developing Country Support',   path: 'agenda/07-developing-country-support' },
      { group: '적응',  labelKo: '08 ESG/RE100',             labelEn: '08 ESG / RE100',                  path: 'agenda/08-esg-re100' },
      // [메타] — Governance, meta-process
      { group: '메타',  labelKo: '09 이행 점검권',           labelEn: '09 Implementation Monitoring',    path: 'agenda/09-implementation-monitoring' },
      { group: '메타',  labelKo: '10 광역→기초 다층 확산',   labelEn: '10 National to Local Cascade',    path: 'agenda/10-national-to-local' },
      { group: '메타',  labelKo: '14 기후배당',              labelEn: '14 Climate Dividend',             path: 'agenda/14-climate-dividend' },
      { group: '메타',  labelKo: '15 복합취약성',            labelEn: '15 Compound Vulnerability',       path: 'agenda/15-compound-vulnerability' },
    ],
  },

  // 2026-06-02: temporarily hidden, content private as of 2026-06-02
  // Tools / Sessions / Resources sidebar sections suppressed while public
  // surface is restricted to homepage + agenda pages. Restore from git history
  // when content is republished.
];

type LocalizedNavigationItem = Pick<NavItem, 'labelKo' | 'labelEn' | 'labels'>;

const NAVIGATION_GROUP_LABELS: Record<string, Record<SiteLocale, string>> = {
  '감축1': { ko: '감축1', en: 'Mitigation 1', ja: '緩和 1', zh: '减排 1', es: 'Mitigación 1', ar: 'التخفيف 1' },
  '감축2': { ko: '감축2', en: 'Mitigation 2', ja: '緩和 2', zh: '减排 2', es: 'Mitigación 2', ar: 'التخفيف 2' },
  '적응': { ko: '적응', en: 'Adaptation', ja: '適応', zh: '适应', es: 'Adaptación', ar: 'التكيف' },
  '메타': { ko: '메타', en: 'Meta', ja: 'メタ', zh: '元议题', es: 'Meta', ar: 'ما وراء العملية' },
};

export function navigationLabel(item: LocalizedNavigationItem, locale: string | undefined): string {
  if (locale === 'ko') return item.labelKo;
  if (locale === 'en' || !isSiteLocale(locale)) return item.labelEn;
  if (locale === 'ja' || locale === 'zh' || locale === 'es' || locale === 'ar') {
    return item.labels?.[locale] ?? item.labelEn;
  }
  return item.labelEn;
}

export function navigationGroupLabel(group: string, locale: string | undefined): string {
  const labels = NAVIGATION_GROUP_LABELS[group];
  if (!labels) return group;
  return labels[isSiteLocale(locale) ? locale : 'en'];
}
