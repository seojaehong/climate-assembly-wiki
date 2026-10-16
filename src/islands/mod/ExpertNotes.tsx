import { EXPERT_CATEGORY_LABELS, expertTally, parseExpert, type ExpertCategory } from './division-expert';

const TONE: Record<ExpertCategory, string> = {
  1: 'border-[#B91C1C] bg-[#FEF2F2] text-[#7F1D1D]',
  2: 'border-[#B45309] bg-[#FFF7E6] text-[#7A4B00]',
  3: 'border-[#2E75B6] bg-[#EEF5FB] text-[#1F4E79]',
  4: 'border-[#8A94A0] bg-[#F4F5F7] text-[#374151]',
  0: 'border-[#8A94A0] bg-[#F4F5F7] text-[#374151]',
};
const CHIP: Record<ExpertCategory, string> = {
  1: 'bg-[#B91C1C] text-white',
  2: 'bg-[#B45309] text-white',
  3: 'bg-[#2E75B6] text-white',
  4: 'bg-[#6B7280] text-white',
  0: 'bg-[#6B7280] text-white',
};

/**
 * 세부권고 아래 전문가 의견(운영 화면 전용 — 발표 창에는 띄우지 않는다). 접혀 있고, 요약에 분류별 수.
 * 색: ① 빨강(기술적으로 불가능) · ② 주황(추가·보완 필요) · ③ 파랑(기시행 정책) · ④ 회색(기타).
 */
export default function ExpertNotes({ opinions }: { opinions?: readonly string[] }) {
  if (!opinions || opinions.length === 0) return null;
  const tally = expertTally(opinions);
  const order: ExpertCategory[] = [1, 2, 3, 4, 0];
  return (
    <details className="mt-1" data-testid="expert-notes">
      <summary className="cursor-pointer text-[14px] font-bold text-[#5A6B73]">
        전문가 의견 {opinions.length}
        {order
          .filter((c) => tally[c])
          .map((c) => (
            <span key={c} className={`ml-1.5 rounded px-1.5 py-0.5 text-[12px] font-bold ${CHIP[c]}`} title={EXPERT_CATEGORY_LABELS[c]}>
              {c ? '①②③④'[c - 1] : '·'}
              {tally[c]}
            </span>
          ))}
      </summary>
      <ul className="mt-1 space-y-1">
        {opinions.map((line, i) => {
          const p = parseExpert(line);
          return (
            <li key={i} data-expert-cat={p.cat} className={`rounded-md border-l-4 px-2 py-1 text-[14px] leading-snug ${TONE[p.cat]}`}>
              <b className="mr-1">{EXPERT_CATEGORY_LABELS[p.cat]}</b>
              {p.tag && !p.cat ? <span className="mr-1 opacity-80">[{p.tag}]</span> : null}
              <span className="whitespace-pre-line">{p.body}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
