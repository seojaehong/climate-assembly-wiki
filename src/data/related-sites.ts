/**
 * related-sites.ts — Curated external reference list for climate-assembly-wiki.
 * Category colour map lives in RelatedSites.astro.
 * Add entries here; the component handles rendering.
 */

export interface SiteEntry {
  /** Short ID used for filter matching (related_sites frontmatter field) */
  id: string;
  name: string;
  name_ko?: string;
  url: string;
  category: 'tool' | 'official' | 'methodology' | 'academic' | 'media' | 'precedent';
  description: string;
  license?: string;
  logo?: string;
  is_external: true;
  language?: string[];
}

export const RELATED_SITES: SiteEntry[] = [
  // ── 시뮬레이터·도구 ──────────────────────────────────────────────────────
  {
    id: 'en-roads',
    name: 'En-ROADS Climate Simulator',
    name_ko: 'En-ROADS 기후 시뮬레이터',
    url: 'https://en-roads.climateinteractive.org/',
    category: 'tool',
    description:
      'MIT Sloan + Climate Interactive 글로벌 기후정책 시뮬레이터. 18개 정책 레버 슬라이더, 실시간 2100년 기온 반영.',
    license: 'CC BY 4.0',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'en-roads-ref',
    name: 'En-ROADS Technical Reference',
    url: 'https://docs.climateinteractive.org/projects/en-roads-reference-guide/en/latest/',
    category: 'tool',
    description: '131p 모델 방정식·구조·가정 공개 문서.',
    license: 'CC BY 4.0',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'c-roads',
    name: 'C-ROADS Climate Negotiation Simulator',
    url: 'https://www.climateinteractive.org/c-roads/',
    category: 'tool',
    description: 'En-ROADS의 자매 시뮬레이터 — 지역별 배출 협상 모델.',
    license: 'CC BY 4.0',
    is_external: true,
    language: ['en'],
  },

  // ── 공식 정부 ────────────────────────────────────────────────────────────
  {
    id: 'climatevoice',
    name: 'climatevoice.kr',
    name_ko: '기후시민회의 공식 포털',
    url: 'https://climatevoice.kr',
    category: 'official',
    description:
      '국가기후위기대응위원회 운영. 시민 발의 의제 등록·조회 + 시민참여단 온라인 학습.',
    is_external: true,
    language: ['ko'],
  },
  {
    id: 'pcccr',
    name: '국가기후위기대응위원회 (PCCCR)',
    url: 'https://www.pcccr.go.kr/base/main/view',
    category: 'official',
    description: '대통령 직속 기구. 탄소중립·기후위기 정책 총괄.',
    is_external: true,
    language: ['ko'],
  },
  {
    id: 'me-go-kr',
    name: '환경부 (Ministry of Environment)',
    url: 'https://www.me.go.kr',
    category: 'official',
    description: '한국 정부 환경 정책 주관 부처.',
    is_external: true,
    language: ['ko', 'en'],
  },
  {
    id: '2050cnc',
    name: '탄소중립녹색성장위원회',
    url: 'https://www.2050cnc.go.kr',
    category: 'official',
    description: '국가 탄소중립 기본계획 수립.',
    is_external: true,
    language: ['ko'],
  },
  {
    id: 'gir',
    name: '온실가스종합정보센터 (GIR)',
    url: 'https://www.gir.go.kr',
    category: 'official',
    description: '한국 온실가스 배출량 통계.',
    is_external: true,
    language: ['ko', 'en'],
  },

  // ── 방법론·표준 ──────────────────────────────────────────────────────────
  {
    id: 'oecd-participation',
    name: 'OECD Innovative Citizen Participation',
    url: 'https://www.oecd.org/en/topics/policy-issue-focus/innovative-citizen-participation.html',
    category: 'methodology',
    description:
      'OECD 시민 숙의 평가 가이드라인(2021) + Good Practice Principles(2020).',
    license: 'CC BY-NC-SA 3.0 IGO',
    is_external: true,
    language: ['en', 'fr'],
  },
  {
    id: 'knoca',
    name: 'KNOCA — Knowledge Network on Climate Assemblies',
    url: 'https://knoca.eu',
    category: 'methodology',
    description: '유럽 기후 시민의회 지식 네트워크.',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'climas',
    name: 'CLIMAS (EU Horizon)',
    url: 'https://citizen-assembly.com',
    category: 'methodology',
    description: 'CLIMAS D4.1 기후총회 운영 매뉴얼.',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'lisode',
    name: 'Lisode Public Participation Guide',
    url: 'https://lisode.com',
    category: 'methodology',
    description: '프랑스 공공참여 컨설팅. CC BY-NC-ND 4.0 가이드.',
    license: 'CC BY-NC-ND 4.0',
    is_external: true,
    language: ['fr', 'en'],
  },
  {
    id: 'global-assembly-toolkit',
    name: 'Global Assembly DIY Toolkit',
    url: 'https://globalassembly.org',
    category: 'methodology',
    description: 'COP26 글로벌 시민의회 운영 도구.',
    license: 'CC BY-SA 4.0',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'peoples-climate-vote',
    name: "People's Climate Vote (UNDP)",
    url: 'https://www.undp.org/publications/peoples-climate-vote',
    category: 'methodology',
    description: '77개국 130만 명 기후정책 선호도 조사.',
    is_external: true,
    language: ['en'],
  },

  // ── 학술·과학 ────────────────────────────────────────────────────────────
  {
    id: 'ipcc-ar6',
    name: 'IPCC AR6 Sixth Assessment Report',
    url: 'https://www.ipcc.ch/assessment-report/ar6/',
    category: 'academic',
    description: '기후변화 정부간 협의체 6차 평가보고서.',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'iea-weo',
    name: 'IEA World Energy Outlook',
    url: 'https://www.iea.org/reports/world-energy-outlook',
    category: 'academic',
    description: '국제 에너지 기구 연간 전망.',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'climate-action-tracker',
    name: 'Climate Action Tracker',
    url: 'https://climateactiontracker.org',
    category: 'academic',
    description: '각국 기후정책 1.5°C 정합성 평가.',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'nature-climate-change',
    name: 'Nature Climate Change',
    url: 'https://www.nature.com/nclimate',
    category: 'academic',
    description: '기후 학술 저널.',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'global-carbon-project',
    name: 'Global Carbon Project',
    url: 'https://www.globalcarbonproject.org',
    category: 'academic',
    description: '글로벌 탄소 예산 연간 업데이트.',
    is_external: true,
    language: ['en'],
  },

  // ── 미디어·매체 ──────────────────────────────────────────────────────────
  {
    id: 'jtbc-climate',
    name: 'JTBC 박상욱 기후 다큐',
    url: 'https://news.jtbc.co.kr',
    category: 'media',
    description: '시민회의 2026 방송 파트너. 박상욱 기자 기후 다큐 2부작 예정.',
    is_external: true,
    language: ['ko'],
  },
  {
    id: 'carbon-brief',
    name: 'Carbon Brief',
    url: 'https://www.carbonbrief.org',
    category: 'media',
    description: '기후 정책·과학 영문 매체.',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'climate-home-news',
    name: 'Climate Home News',
    url: 'https://www.climatechangenews.com',
    category: 'media',
    description: '국제 기후 정책 전문 영문 매체.',
    is_external: true,
    language: ['en'],
  },

  // ── 선례 (국내외 시민의회) ───────────────────────────────────────────────
  {
    id: 'cauk',
    name: 'Climate Assembly UK',
    url: 'https://www.climateassembly.uk/',
    category: 'precedent',
    description: '2020년 영국 의회 위탁 기후 시민의회 (108명, 60일).',
    is_external: true,
    language: ['en'],
  },
  {
    id: 'ccc-france',
    name: 'Convention Citoyenne pour le Climat',
    url: 'https://www.conventioncitoyennepourleclimat.fr/',
    category: 'precedent',
    description: '2019~2020 프랑스 기후 시민의회 (150명, 149 권고).',
    is_external: true,
    language: ['fr'],
  },
  {
    id: 'brussels-cca',
    name: "Brussels Climate Citizens' Assembly",
    url: 'https://climate.brussels',
    category: 'precedent',
    description: '벨기에 브뤼셀 시 단위 기후 시민의회.',
    is_external: true,
    language: ['en', 'fr', 'nl'],
  },
  {
    id: 'gyeonggi-assembly',
    name: '경기도 기후도민총회',
    url: 'https://gg.go.kr',
    category: 'precedent',
    description:
      '국내 광역 단위 첫 기후 시민의회 (120 + 330명, 권고 수용률 90%).',
    is_external: true,
    language: ['ko'],
  },
  {
    id: 'ireland-cca',
    name: "Ireland's Citizens' Assembly on Biodiversity Loss",
    url: 'https://www.citizensassembly.ie',
    category: 'precedent',
    description: '아일랜드 시민의회 — 기후·생물다양성 권고.',
    is_external: true,
    language: ['en'],
  },
];
