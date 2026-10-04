/**
 * 10/17 의결 화면 — 시험·미리보기용 **가상** 원천 데이터.
 *
 * 실제 권고안(recs_1017.json)은 저장소에 넣지 않는다(공개 저장소·공개 배포).
 * 모양만 같게 만든 가짜이며 문장은 전부 지어낸 것이다.
 * 실제 데이터의 특징 셋을 일부러 넣었다 — 제목 없는 카드 · 숙제 주제(2-14) · 카드 여러 장인 주제.
 */
import type { RecsDivision } from './division-vote-logic';

const card = (no: string, title: string, recCount: number) => ({
  no,
  title,
  background: '• 예시 배경입니다.',
  recs: Array.from({ length: recCount }, (_, i) => ({ no: `${no}-${i + 1}`, text: `예시 권고 문장 ${no}-${i + 1}입니다.` })),
  effect: '• 예시 기대효과입니다.',
  schedule: '• 중기',
});

export const DIVISION_VOTE_FIXTURE: RecsDivision[] = [
  {
    division: 2,
    agenda: '예시 의제 — 가상 데이터',
    topics: [
      {
        no: '2-1',
        name: '예시 주제 가',
        written_by: '1조 2조',
        raised_by: '1조 2조 3조',
        cards: [
          card('2-1-1', '예시 제목 가-1 다회용기 보급 확대', 3),
          card('2-1-2', '예시 제목 가-2 다회용기 회수 체계 마련', 2),
          card('2-1-3', '예시 제목 가-3 보증금 제도 정비', 4),
        ],
      },
      {
        no: '2-4',
        name: '예시 주제 나',
        written_by: '3조',
        raised_by: '3조 4조',
        cards: [card('2-4-1', '예시 제목 나-1 지역 순환센터 설치', 2), card('2-4-6', '', 1)],
      },
      {
        no: '2-14',
        name: '예시 주제 다(숙제)',
        written_by: '5조',
        raised_by: '-',
        cards: [card('2-14-1', '', 1)],
      },
    ],
  },
  {
    division: 3,
    agenda: '예시 의제 — 가상 데이터',
    topics: [
      {
        no: '3-1',
        name: '예시 주제 라',
        written_by: '1조',
        raised_by: '1조',
        cards: [card('3-1-1', '예시 제목 라-1 기후교육 확대', 2)],
      },
    ],
  },
];
