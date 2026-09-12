export type AgendaCatalogItem = {
  id: string;
  subgroup: '1분과' | '2분과' | '3분과';
  ordinal: number;
  title: string;
  suggestedTeamNumbers: readonly number[];
  sourceUtterances: readonly string[];
};

export const AGENDA_SOURCE_HASHES = {
  '1분과': '8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB',
  '2분과': 'BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0',
  '3분과': '158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3',
} as const;

export const AGENDA_CATALOG_0912: readonly AgendaCatalogItem[] = [
  {
    id: '91210000-0000-4000-8000-000000000001', subgroup: '1분과', ordinal: 1,
    title: '세제혜택·인센티브 등 기업 지원 제도', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '친환경적으로 노력하는 기업에게 비용을 지원해주는 접근이 어떨까 싶다.',
      '기업이 탄소배출 감소로 얻는 메리트나 탄소배출 증가로 얻는 리스크가 적은 게 문제다.',
      '인센티브와 브랜드 이미지 제고가 기업 경쟁력으로 이어질 수 있다.',
    ],
  },
  {
    id: '91210000-0000-4000-8000-000000000002', subgroup: '1분과', ordinal: 2,
    title: '중소기업 맞춤형 지원 체계', suggestedTeamNumbers: [1, 2, 3, 4],
    sourceUtterances: [
      '대기업보다 재정이 취약한 기업체를 대상으로 지원과 홍보가 필요하다.',
      '중소기업은 기술력이나 인프라가 없어 감축을 못하고 있다.',
    ],
  },
  {
    id: '91210000-0000-4000-8000-000000000003', subgroup: '1분과', ordinal: 3,
    title: '정책 일관성 확보·전담기구·중장기 로드맵', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '정권이 바뀌더라도 지속적으로 갈 수 있는 목표와 체계가 필요하다.',
      '정부 정책의 불확실성 때문에 기업의 설비투자가 어려워진다.',
    ],
  },
  {
    id: '91210000-0000-4000-8000-000000000004', subgroup: '1분과', ordinal: 4,
    title: '탄소정보 공개·인증제 강화', suggestedTeamNumbers: [1, 2, 3, 5],
    sourceUtterances: [
      '친환경 제품인지 확인할 수 있도록 사후 검증이 필요하다.',
      '소비자가 ESG를 준수하는 회사와 그렇지 않은 회사를 구분할 제도가 필요하다.',
    ],
  },
  {
    id: '91210000-0000-4000-8000-000000000005', subgroup: '1분과', ordinal: 5,
    title: '배출권거래제 개선', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '배출권을 구매하는 것에 그치지 않고 실제 배출량을 줄이도록 제도를 개선해야 한다.',
      '배출권 무상 할당과 기준·가이드라인을 다시 살펴볼 필요가 있다.',
    ],
  },
  {
    id: '91210000-0000-4000-8000-000000000006', subgroup: '1분과', ordinal: 6,
    title: '재생에너지·전력 인프라 투자', suggestedTeamNumbers: [1, 2, 3, 4],
    sourceUtterances: [
      '재생에너지와 친환경 설비의 초기 투자비용 부담을 줄여야 한다.',
      '지역별 전력 가용량을 고려한 전력 인프라와 요금 체계가 필요하다.',
    ],
  },
  {
    id: '91210000-0000-4000-8000-000000000007', subgroup: '1분과', ordinal: 7,
    title: '소비자 연계 유인책', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '텀블러 이용처럼 탄소를 줄이는 행동에 직접적인 혜택이 필요하다.',
      '저소득층도 친환경 제품을 선택할 수 있도록 형평성을 함께 고려해야 한다.',
    ],
  },
  {
    id: '91210000-0000-4000-8000-000000000008', subgroup: '1분과', ordinal: 8,
    title: '기업 내부 인식·교육 강화', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '기업 구성원이 탄소배출을 줄여야 한다는 인식을 갖도록 교육이 필요하다.',
      '각 기업과 사람에게 실제로 와닿는 맞춤형 교육과 홍보가 필요하다.',
    ],
  },
  {
    id: '91210000-0000-4000-8000-000000000009', subgroup: '1분과', ordinal: 9,
    title: '탄소포집 등 R&D·신소재 지원', suggestedTeamNumbers: [2, 3],
    sourceUtterances: [
      '효과적인 탄소포집 기술을 개발하고 안전하게 재사용할 방법을 연구해야 한다.',
      '공정 자체에서 탄소가 발생하는 산업에는 감축기술 개발이 필요하다.',
    ],
  },
  {
    id: '91220000-0000-4000-8000-000000000001', subgroup: '2분과', ordinal: 1,
    title: '다회용기·리필 시스템 확대', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '음식점에서 개인 다회용기로 음식을 가져갈 수 있는 시스템이 필요하다.',
      '생활용품을 필요한 만큼 소분·구매할 수 있는 리필 문화가 일상화되면 좋겠다.',
    ],
  },
  {
    id: '91220000-0000-4000-8000-000000000002', subgroup: '2분과', ordinal: 2,
    title: '분리배출 기준 전국 표준화', suggestedTeamNumbers: [2, 3, 5],
    sourceUtterances: [
      '재활용품 분리배출과 선별 기준이 지자체마다 달라 혼란과 비용이 커진다.',
      '소비자가 재활용 가능 여부를 쉽게 알 수 있는 단순한 표시가 필요하다.',
    ],
  },
  {
    id: '91220000-0000-4000-8000-000000000003', subgroup: '2분과', ordinal: 3,
    title: '생산자책임 강화·포장재 규제(EPR)', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '여러 재질이 섞인 과도한 포장재는 분리배출을 어렵게 한다.',
      '일회용품을 대량 생산·유통하는 기업의 환경 책임을 강화해야 한다.',
    ],
  },
  {
    id: '91220000-0000-4000-8000-000000000004', subgroup: '2분과', ordinal: 4,
    title: '보상·포인트 제도', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '친환경 행동의 불편을 감수할 수 있도록 보상이나 포인트가 필요하다.',
      '일회용품 대신 장바구니를 사용하는 개인에게 혜택을 줄 필요가 있다.',
    ],
  },
  {
    id: '91220000-0000-4000-8000-000000000005', subgroup: '2분과', ordinal: 5,
    title: '재활용 처리 결과 투명 공개', suggestedTeamNumbers: [],
    sourceUtterances: [
      '시민이 분리배출한 뒤 실제로 어떻게 처리되고 얼마나 재활용되는지 투명하게 공개해야 한다.',
    ],
  },
  {
    id: '91220000-0000-4000-8000-000000000006', subgroup: '2분과', ordinal: 6,
    title: '로컬푸드·공유경제·커뮤니티 순환', suggestedTeamNumbers: [1, 2],
    sourceUtterances: [
      '먹거리의 유통·보관 거리가 길어지며 불필요한 포장재가 늘어난다.',
      '물건을 버리기보다 수리하거나 중고거래로 순환하는 문화가 필요하다.',
    ],
  },
  {
    id: '91220000-0000-4000-8000-000000000007', subgroup: '2분과', ordinal: 7,
    title: '수리권 보장·내구재 장기사용 촉진', suggestedTeamNumbers: [1, 3, 4, 5],
    sourceUtterances: [
      '수리해서 다시 쓸 수 있는 제품도 새 제품으로 바꾸는 경우가 많다.',
      '부품만 바꾸면 되는데 전체를 교체하게 만드는 생산 방식이 문제다.',
    ],
  },
  {
    id: '91220000-0000-4000-8000-000000000008', subgroup: '2분과', ordinal: 8,
    title: '스마트 기술 기반 분류', suggestedTeamNumbers: [4],
    sourceUtterances: [
      '스마트 분류함이 재질을 자동으로 분석·분류하면 분리배출의 노동과 고민을 줄일 수 있다.',
    ],
  },
  {
    id: '91230000-0000-4000-8000-000000000001', subgroup: '3분과', ordinal: 1,
    title: '생애주기별 의무 환경교육 체계화', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '어린이부터 성인까지 생애주기에 맞는 정기적인 환경교육이 필요하다.',
      '반복되는 교육이 올바른 인식과 자연스러운 실천으로 연결되면 좋겠다.',
    ],
  },
  {
    id: '91230000-0000-4000-8000-000000000002', subgroup: '3분과', ordinal: 2,
    title: '체험형·재미있는 콘텐츠 개발', suggestedTeamNumbers: [1, 2, 3, 5],
    sourceUtterances: [
      '앉아서 듣는 환경교육보다 몸으로 체험하고 재미를 느낄 수 있는 교육이 필요하다.',
      '재활용센터 같은 기존 공간을 활용한 실습형 교육을 확대하면 좋겠다.',
    ],
  },
  {
    id: '91230000-0000-4000-8000-000000000003', subgroup: '3분과', ordinal: 3,
    title: '참여 인센티브·포인트 제도', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '환경 보호 행동을 했을 때 포인트나 보상을 주는 방식이 필요하다.',
      '강요와 규제만이 아니라 실천동기를 높일 보상 체계가 필요하다.',
    ],
  },
  {
    id: '91230000-0000-4000-8000-000000000004', subgroup: '3분과', ordinal: 4,
    title: '전문 강사·교육 인프라·예산 확충', suggestedTeamNumbers: [2, 5],
    sourceUtterances: [
      '지속적으로 운영할 수 있는 전문 강사와 프로그램이 부족하다.',
      '환경 교과를 담당할 별도의 전문 교사를 배치하면 좋겠다.',
    ],
  },
  {
    id: '91230000-0000-4000-8000-000000000005', subgroup: '3분과', ordinal: 5,
    title: '환경교과 정규화·입시 반영', suggestedTeamNumbers: [1, 3],
    sourceUtterances: [
      '정규 교과수업에서 환경 수업이 부족하다.',
      '환경 과목의 중요도를 높여 학생들의 관심과 지식을 넓힐 필요가 있다.',
    ],
  },
  {
    id: '91230000-0000-4000-8000-000000000006', subgroup: '3분과', ordinal: 6,
    title: '미디어·홍보 캠페인 강화', suggestedTeamNumbers: [1, 2, 3, 4, 5],
    sourceUtterances: [
      '인플루언서와 다양한 미디어를 활용해 환경교육과 실천을 알릴 필요가 있다.',
      '이론보다 생활 속 실천으로 이어지는 홍보가 부족하다.',
    ],
  },
  {
    id: '91230000-0000-4000-8000-000000000007', subgroup: '3분과', ordinal: 7,
    title: '정책결정자 대상 전문교육', suggestedTeamNumbers: [2, 4],
    sourceUtterances: [
      '공무원과 정책결정자가 기후환경을 어떻게 이해하고 정책에 반영하는지 점검할 필요가 있다.',
    ],
  },
  {
    id: '91230000-0000-4000-8000-000000000008', subgroup: '3분과', ordinal: 8,
    title: '지역사회 기반 접근성 확대', suggestedTeamNumbers: [2, 3, 5],
    sourceUtterances: [
      '주민센터처럼 시민이 쉽게 접할 수 있는 곳에서 환경교육을 제공해야 한다.',
      '지역별 참여단과 생활권 교육을 확대해 누구나 쉽게 참여할 수 있게 해야 한다.',
    ],
  },
] as const;

export function agendaCatalogFor(subgroup: string | null): readonly AgendaCatalogItem[] {
  if (!subgroup) return AGENDA_CATALOG_0912;
  return AGENDA_CATALOG_0912.filter((item) => item.subgroup === subgroup);
}
