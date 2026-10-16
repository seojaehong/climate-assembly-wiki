import { useContext, useEffect, useState } from 'react';
import { sessionRoster } from '../../lib/deliberation';
import type { RosterRow } from '../../lib/named-vote-logic';
import { TEAM_NOS, type PrepState } from './division-vote-logic';
import { reviewerTeamLabel, rosterNamesFor, setReviewer } from './division-reviewers';
import { NamedAccessContext } from './NamedResultBoard';

/**
 * 위임 안건 아래 「검토위원(시민대표)」 1조~5조 — 조마다 한 명. 이름은 출석 명단에서 고르거나(목록) 직접 적는다.
 * 연락처는 받지 않는다. 저장은 준비판(서버 공유)이라 운영팀 화면에도 같이 보인다.
 */
export default function ReviewerSlots({ state, update }: { state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  const access = useContext(NamedAccessContext);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  useEffect(() => {
    if (!access) return undefined;
    let cancelled = false;
    sessionRoster(access)
      .then((r) => {
        if (!cancelled && r) setRoster(r);
      })
      .catch((e: unknown) => console.warn('[reviewers] roster load failed', e));
    return () => {
      cancelled = true;
    };
  }, [access]);
  const filled = TEAM_NOS.filter((t) => state.reviewers?.[t]).length;
  return (
    <section data-testid="reviewer-slots" className="rounded-xl border-2 border-[#5B21B6] bg-[#F5F3FF] px-4 py-3">
      <p className="text-[17px] font-extrabold text-[#5B21B6]">
        검토위원(시민대표) · 조마다 한 명 <span className="font-bold text-[#5A6B73]">({filled}/5)</span>
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-5">
        {TEAM_NOS.map((t) => {
          const names = rosterNamesFor(roster, state.division, t);
          const listId = `reviewers-${state.division}-${t}`;
          return (
            <label key={t} className="block">
              <span className="text-[16px] font-bold text-[#1F4E79]">{t}조</span>
              <input
                className="mt-1 h-12 w-full min-w-0 rounded-lg border border-[#C4D8E4] bg-white px-2 text-[17px]"
                list={listId}
                value={state.reviewers?.[t] ?? ''}
                placeholder={names.length ? '명단에서 고르기' : '이름'}
                aria-label={`${reviewerTeamLabel(state.division, t)} 검토위원`}
                onChange={(e) => update((s) => setReviewer(s, t, e.target.value))}
              />
              <datalist id={listId}>
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </label>
          );
        })}
      </div>
    </section>
  );
}
