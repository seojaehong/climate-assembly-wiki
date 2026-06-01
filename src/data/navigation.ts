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
  items: SidebarItem[];
}

// ---------------------------------------------------------------------------
// Header: Top-level navigation (6 sections per Design §1.2)
// Search (/search/) is a utility page — rendered as an icon button, NOT listed here.
// ---------------------------------------------------------------------------

export const TOP_NAV_ITEMS: NavItem[] = [
  { section: 'agenda',    labelKo: '의제',    labelEn: 'Agenda' },
  { section: 'tools',     labelKo: '도구',    labelEn: 'Tools' },
  { section: 'sessions',  labelKo: '회차',    labelEn: 'Sessions' },
  { section: 'doc',       labelKo: '자료',    labelEn: 'Resources' },
  { section: 'glossary',  labelKo: '용어집',  labelEn: 'Glossary' },
  { section: 'downloads', labelKo: '다운로드', labelEn: 'Downloads' },
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

  // ─── Section 2: Tools ─────────────────────────────────────────────────────
  // En-ROADS is the only tool in M1–M3. Future tools added here (Design §1.2).
  {
    id: 'tools',
    labelKo: '도구',
    labelEn: 'Tools',
    items: [
      // En-ROADS sub-pages — static routes per Design D4 (not getCollection)
      // EnRoadsNavItem component hard-codes known sub-pages (Design §3.4)
      { labelKo: 'En-ROADS 허브',           labelEn: 'En-ROADS Hub',              path: 'tools/en-roads' },
      { labelKo: '종합 가이드 (v1.1)',      labelEn: 'Comprehensive Guide',       path: 'tools/en-roads/comprehensive-guide' },
      { labelKo: '18개 레버',               labelEn: '18 Levers',                 path: 'tools/en-roads/18-levers' },
      { labelKo: '시나리오',                labelEn: 'Scenarios',                 path: 'tools/en-roads/scenarios' },
      { labelKo: '용어 해설',               labelEn: 'Glossary',                  path: 'tools/en-roads/glossary' },
      { labelKo: '모더레이터 활용법',       labelEn: 'For Moderators',            path: 'tools/en-roads/for-moderators' },
    ],
  },

  // ─── Section 3: Sessions ──────────────────────────────────────────────────
  // Sessions 1–9 per Design §7 schedule. Paths use numeric ordinal per D2/§1.1.
  {
    id: 'sessions',
    labelKo: '회차',
    labelEn: 'Sessions',
    items: [
      { labelKo: '1차 (2026-05-16) 발대식',         labelEn: 'Session 1 — Kickoff',           path: 'sessions/1' },
      { labelKo: '2차 (2026-05-28) 박찬 교수',      labelEn: 'Session 2 — Lec. Park Chan',    path: 'sessions/2' },
      { labelKo: '3차',                             labelEn: 'Session 3',                     path: 'sessions/3' },
      { labelKo: '4차',                             labelEn: 'Session 4',                     path: 'sessions/4' },
      { labelKo: '5차 (2026-08-29)',                labelEn: 'Session 5',                     path: 'sessions/5' },
      { labelKo: '6차',                             labelEn: 'Session 6',                     path: 'sessions/6' },
      { labelKo: '7차',                             labelEn: 'Session 7',                     path: 'sessions/7' },
      { labelKo: '8차',                             labelEn: 'Session 8',                     path: 'sessions/8' },
      { labelKo: '9차 (2026-11-14)',                labelEn: 'Session 9',                     path: 'sessions/9' },
    ],
  },

  // ─── Section 4: Resources (doc) ───────────────────────────────────────────
  // Covers all doc_type values. Items added as content migration occurs (Groups H/J).
  {
    id: 'doc',
    labelKo: '자료',
    labelEn: 'Resources',
    items: [
      { labelKo: '사이트 소개',              labelEn: 'About',                     path: 'doc/about' },
      { labelKo: '모더레이터 가이드',        labelEn: 'Moderator Guide',           path: 'doc/moderator-brief' },
      { labelKo: '의제 매트릭스',            labelEn: 'Agenda Matrix',             path: 'doc/agenda-matrix' },
      { labelKo: '부처별 역할 매트릭스',     labelEn: 'Ministry Matrix',           path: 'doc/ministry-matrix' },
      { labelKo: 'OECD 평가 요약',           labelEn: 'OECD Evaluation',           path: 'doc/oecd-evaluation' },
      { labelKo: '경기도 기후도민총회 사례', labelEn: 'Gyeonggi Case Study',       path: 'doc/gyeonggi-case' },
      { labelKo: '시민 발의 트래커',         labelEn: 'Citizen Proposals Tracker', path: 'doc/citizen-proposals-tracker' },
    ],
  },
];
