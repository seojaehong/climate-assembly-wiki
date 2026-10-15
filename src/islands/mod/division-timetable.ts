/**
 * 10/17 분과 의결 시간표(추진계획안_5 세부일정) — 화면 위 띠에 「지금 무엇을 어디서 하는지」를 보여 준다.
 * 10/15 사용자 「시간표와 UX 관점에서 최적화」. 순수 로직이라 vitest 로 검증한다.
 */

export type TimetableView = 'prep' | 'vote';

export type TimetableBlock = {
  id: 'merge1' | 'merge2' | 'edit' | 'final';
  start: string; // HH:MM (KST)
  end: string;
  label: string;
  /** 이 시간에 여는 화면. */
  view: TimetableView;
  /** 화면 어디를 만지는지 한 줄. */
  where: string;
};

export const DECISION_EVENT_DATE_KST = '2026-10-17';

// 10/15 상세 계획 v5(20261015-…상세 계획_ADR_v5.hwpx) 숙의참여단 상세 운영 계획 기준. 투표(QR)는 16:15 한 번뿐이다.
export const DECISION_TIMETABLE: readonly TimetableBlock[] = [
  { id: 'merge1', start: '11:10', end: '12:00', label: '중복 확인 · 통합(1) — 현황·전문가 의견', view: 'prep', where: '준비판: 묶음 안과 세부 권고를 보며 공유(투표 없음)' },
  { id: 'merge2', start: '13:00', end: '14:30', label: '중복 확인 · 통합(2) — 후보 권고안 목록', view: 'prep', where: '준비판: 안 합치기·나누기·빼기로 후보 목록 확정(투표 없음)' },
  { id: 'edit', start: '14:45', end: '16:00', label: '문구 조정 · 권고 수준 · 기타 의견', view: 'prep', where: '준비판 제목 칸에 최종 후보 문구 · 투표 진행에서 권고 수준·기타 의견' },
  { id: 'final', start: '16:15', end: '16:45', label: '분과별 의결(온라인) · 문구 작성 위임', view: 'vote', where: '투표 진행: 후보안 하나씩 QR(20분) → 맨 아래 위임 의결(10분)' },
] as const;

function kstParts(now: Date): { date: string; hm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hm: `${get('hour')}:${get('minute')}` };
}

/** 행사 당일(KST) 지금 시각이 든 블록. 당일이 아니거나 쉬는 시간이면 null. */
export function currentTimetableBlock(now: Date, eventDate: string = DECISION_EVENT_DATE_KST): TimetableBlock | null {
  const { date, hm } = kstParts(now);
  if (date !== eventDate) return null;
  return DECISION_TIMETABLE.find((b) => b.start <= hm && hm < b.end) ?? null;
}
