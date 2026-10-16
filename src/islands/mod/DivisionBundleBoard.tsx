import {
  BUNDLE_DECISIONS,
  BUNDLE_DECISION_LABELS,
  TEAM_NOS,
  groupRecTexts,
  motionRef,
  motionTitleRoom,
  onMotion,
  updateMotion,
  type PrepState,
} from './division-vote-logic';
import {
  addBundleMotion,
  bundleCsvRows,
  bundleCsvText,
  bundleViews,
  cardWithTeam,
  nextBundleMotionNo,
  setBundleRecord,
  toggleBundleTeam,
} from './division-bundle';
import { downloadBlob } from './svg-to-png';

/**
 * 10/17 오전 헤쳐모여 — A–G 묶음마다 결론(합친다·옮긴다·따로 둔다)·참여 조·합친 문구·옮긴 세부권고·소수의견.
 * 합친 문구 칸은 그 묶음 안의 제목 칸이다(16:15 투표 문구). 판단은 division-bundle.ts(순수, vitest).
 * 묶음 파일(A–G)을 가져오지 않은 분과는 아무것도 그리지 않는다.
 */
export default function DivisionBundleBoard({
  state,
  update,
}: {
  state: PrepState;
  update: (fn: (s: PrepState) => PrepState) => void;
}) {
  const views = bundleViews(state);
  if (views.length === 0) return null;
  const btn =
    'min-h-12 rounded-xl px-4 text-[16px] font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] disabled:cursor-not-allowed disabled:opacity-40';
  const field =
    'w-full min-w-0 rounded-xl border border-[#C4D8E4] px-3 py-2 text-[17px] text-[#1F2933] outline-none focus:border-[#23B2C3]';
  const decided = views.filter((v) => v.record.decision).length;

  const csv = () => {
    const rows = bundleCsvRows(state);
    downloadBlob(new Blob([bundleCsvText(rows)], { type: 'text/csv;charset=utf-8' }), `1017_묶음기록_${state.division}분과.csv`);
  };

  return (
    <section data-testid="bundle-board" className="space-y-4 rounded-2xl border-2 border-[#135C73] bg-[#F5F8FB] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="min-w-0 flex-1 text-[20px] font-extrabold text-[#135C73]">
          오전 헤쳐모여 — 묶음 {views.length}개 · 결론 적은 묶음 {decided}
        </h4>
        <button type="button" className={`${btn} border border-[#135C73] bg-white text-[#135C73]`} onClick={csv} data-testid="bundle-csv">
          묶음 기록 CSV
        </button>
      </div>
      <ol className="space-y-4">
        {views.map((b) => {
          const recs = groupRecTexts(state.source, b.group.recs);
          return (
            <li key={b.id} data-testid="bundle" data-bundle={b.id} className="space-y-3 rounded-xl border border-[#DCE7EE] bg-white p-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-[22px] font-extrabold text-[#1F4E79]">{b.label}</span>
                {b.group.level ? (
                  <span className={`rounded-full px-3 py-0.5 text-[15px] font-bold ${b.group.level === '높음' ? 'bg-[#135C73] text-white' : 'bg-[#E6F0F8] text-[#1F4E79]'}`}>
                    겹침 {b.group.level}
                  </span>
                ) : null}
                <span className="text-[16px] text-[#1F2933] tr-num">{b.cards.map((c) => cardWithTeam(b.group, c)).join(' · ')}</span>
              </div>
              {b.group.common ? <p className="text-[15px] text-[#5A6B73]">공통: {b.group.common}</p> : null}
              <details className="rounded-lg bg-[#F5F8FB] px-3 py-2">
                <summary className="cursor-pointer text-[15px] font-bold text-[#1F4E79]">세부권고 {recs.length}개 보기</summary>
                <ul className="mt-2 space-y-1 text-[15px] leading-snug">
                  {recs.map((r) => (
                    <li key={r.no}>
                      <b className="tr-num">{r.no}</b>
                      {r.cardNo && b.group.cardTeams?.[r.cardNo] ? <span className="text-[#5A6B73]"> ({b.group.cardTeams[r.cardNo]})</span> : null} {r.text ?? '(원천에 없음)'}
                    </li>
                  ))}
                </ul>
              </details>

              <div className="flex flex-wrap gap-2" role="group" aria-label={`${b.label} 결론`}>
                {BUNDLE_DECISIONS.map((d) => {
                  const on = b.record.decision === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      data-decision={d}
                      className={`${btn} ${on ? 'bg-[#135C73] text-white' : 'border border-[#C4D8E4] bg-white text-[#1F4E79]'}`}
                      onClick={() => update((s) => setBundleRecord(s, b.id, { decision: on ? null : d }))}
                    >
                      {BUNDLE_DECISION_LABELS[d]}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${b.label} 참여 조`}>
                <span className="text-[16px] font-bold text-[#1F4E79]">참여 조</span>
                {TEAM_NOS.map((t) => {
                  const on = b.record.teams.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={on}
                      className={`min-h-11 min-w-14 rounded-lg px-3 text-[16px] font-bold ${on ? 'bg-[#1F4E79] text-white' : 'border border-[#C4D8E4] bg-white text-[#1F4E79]'}`}
                      onClick={() => update((s) => toggleBundleTeam(s, b.id, t))}
                    >
                      {t}조
                    </button>
                  );
                })}
              </div>

              {b.motions.map((m, i) => {
                const locked = m.rounds.length > 0 && !m.revote;
                const room = motionTitleRoom(m.id, m.title);
                return (
                  <label key={m.key ?? m.id} className="block">
                    <span className="text-[16px] font-bold text-[#1F4E79]">
                      합친 문구{b.motions.length > 1 ? ` ${i + 1}` : ''} · {m.id} <span className="font-normal text-[#5A6B73]">(16:15 투표 문구 — 안 제목 칸과 같습니다)</span>
                    </span>
                    <textarea
                      className={`${field} mt-1 min-h-16`}
                      value={m.title}
                      disabled={locked}
                      aria-label={`${b.label} 합친 문구 ${i + 1}`}
                      onChange={(e) => update(onMotion(motionRef(m), (s, id) => updateMotion(s, id, { title: e.target.value })))}
                    />
                    <span className={`text-[14px] ${room < 0 ? 'font-bold text-[#B91C1C]' : 'text-[#5A6B73]'}`}>
                      {locked ? '투표를 시작한 안이라 여기서 고칠 수 없습니다.' : `남은 글자 ${room}`}
                    </span>
                  </label>
                );
              })}
              <button
                type="button"
                className={`${btn} border border-dashed border-[#135C73] bg-white text-[#135C73]`}
                onClick={() => update((s) => addBundleMotion(s, b.id, nextBundleMotionNo(s, b.id)).state)}
              >
                이 묶음에서 안 하나 더(일부는 따로 둘 때)
              </button>

              <label className="block">
                <span className="text-[16px] font-bold text-[#1F4E79]">옮긴 세부권고 번호</span>
                <textarea
                  className={`${field} mt-1 min-h-12`}
                  value={b.record.movedRecs}
                  placeholder="예: 1-8-2-2 → 통합5"
                  onChange={(e) => update((s) => setBundleRecord(s, b.id, { movedRecs: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="text-[16px] font-bold text-[#5B21B6]">소수의견(합쳐지지 않은 의견)</span>
                <textarea
                  className={`${field} mt-1 min-h-12`}
                  value={b.record.minority}
                  onChange={(e) => update((s) => setBundleRecord(s, b.id, { minority: e.target.value }))}
                />
              </label>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
