import { useEffect, useRef, useState } from 'react';
import type { BallotListRow, BallotResults } from '../../../lib/deliberation';
import {
  platformBallotList,
  platformBallotResults,
  type PlatformResult,
} from '../../../lib/platform';
import { ballotStatusLabel, distRows, subgroupBadgeLabel } from '../../mod/ballot-panel-logic';
import { buildVoteView, type VoteView } from './vote-console-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';

export interface VoteDataAdapter {
  listBallots: (sessionId: string) => Promise<PlatformResult<BallotListRow[]>>;
  loadResults: (token: string, sessionId: string) => Promise<PlatformResult<BallotResults | null>>;
}

const voteDataAdapter: VoteDataAdapter = {
  listBallots: platformBallotList,
  loadResults: platformBallotResults,
};

export async function loadSessionVotes(
  sessionId: string,
  adapter: VoteDataAdapter = voteDataAdapter,
): Promise<PlatformResult<VoteView>> {
  const listed = await adapter.listBallots(sessionId);
  if (listed.notice || !listed.data) {
    return { data: null, notice: listed.notice ?? '투표 목록 응답을 확인하지 못했습니다.' };
  }

  const loadedResults = await Promise.all(
    listed.data.map(async (ballot) => ({ ballot, result: await adapter.loadResults(ballot.token, sessionId) })),
  );
  const aggregateResults: BallotResults[] = [];
  for (const loaded of loadedResults) {
    if (loaded.result.notice || !loaded.result.data) {
      return {
        data: null,
        notice: `${loaded.ballot.title}: ${loaded.result.notice ?? '집계 응답을 확인하지 못했습니다.'}`,
      };
    }
    aggregateResults.push(loaded.result.data);
  }

  return {
    data: buildVoteView(listed.data, aggregateResults),
    notice: null,
  };
}

export async function completeVoteLoad(
  action: () => Promise<PlatformResult<VoteView>>,
  isCurrent: () => boolean,
  onBusyChange: (busy: boolean) => void,
  onView: (view: VoteView | null) => void,
  onNotice: (notice: string | null) => void,
): Promise<void> {
  onBusyChange(true);
  if (isCurrent()) {
    onView(null);
    onNotice(null);
  }
  try {
    const result = await action();
    if (!isCurrent()) return;
    if (result.notice || !result.data) {
      if (!result.notice && !result.data) console.error('Vote request returned no data or notice');
      onNotice(result.notice ?? '투표 집계를 불러오지 못했습니다.');
      return;
    }
    onView(result.data);
  } catch (error: unknown) {
    if (!isCurrent()) return;
    console.error('Failed to load session votes', error);
    onNotice('투표 집계를 불러오는 중 예상하지 못한 오류가 발생했습니다.');
  } finally {
    if (isCurrent()) onBusyChange(false);
  }
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div aria-label={`${label} ${value}건`} style={{ border: `2px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: '12px 14px' }}>
      <div style={{ color: MUTED, fontSize: 12, fontWeight: 700 }}>{label}</div>
      <div style={{ color: NAVY, fontSize: 24, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function distributionText(scale: number, dist: Record<string, number>): string {
  return distRows(scale, dist)
    .map(({ value, count }) => `${value}점 ${count}명`)
    .join(' · ');
}

export function VoteResults({ view }: { view: VoteView }) {
  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        투표 집계를 불러왔습니다. 투표 {view.stats.ballotCount}건, 제출 합계 {view.stats.responseCount}건입니다.
      </p>
      <section aria-label="회차 투표 요약" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, marginBottom: 18 }}>
        <StatCard label="투표" value={view.stats.ballotCount} />
        <StatCard label="진행 중" value={view.stats.openCount} />
        <StatCard label="문항" value={view.stats.itemCount} />
        <StatCard label="제출 합계" value={view.stats.responseCount} />
      </section>

      {view.ballots.length === 0 ? (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>이 회차에 등록된 투표가 없습니다.</p>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {view.ballots.map((ballot) => (
            <section key={ballot.id} aria-labelledby={`vote-title-${ballot.id}`} style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: '#fff', overflow: 'hidden' }}>
              <header style={{ padding: '14px 16px', background: PANEL, borderBottom: `2px solid ${LINE}` }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <h3 id={`vote-title-${ballot.id}`} style={{ color: NAVY, fontSize: 19, margin: 0 }}>{ballot.title}</h3>
                  <span style={{ border: `2px solid ${TEAL}`, borderRadius: 999, color: TEAL, background: '#fff', padding: '2px 8px', fontSize: 12, fontWeight: 800 }}>{ballotStatusLabel(ballot.status)}</span>
                  <span style={{ color: MUTED, fontSize: 12, fontWeight: 700 }}>{subgroupBadgeLabel(ballot.subgroup)}</span>
                </div>
                <p style={{ color: MUTED, fontSize: 13, margin: '6px 0 0' }}>제출 {ballot.responses}건 · 문항 {ballot.items.length}개</p>
              </header>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}>
                  <caption className="sr-only">{ballot.title} 문항별 응답 집계</caption>
                  <thead>
                    <tr>
                      {['문항', '응답', '평균', '점수 분포'].map((label) => (
                        <th key={label} scope="col" style={{ color: NAVY, fontSize: 13, textAlign: 'left', padding: '10px 12px', borderBottom: `2px solid ${LINE}` }}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ballot.items.map((item) => (
                      <tr key={item.id}>
                        <th scope="row" style={{ color: INK, fontSize: 14, lineHeight: 1.5, textAlign: 'left', padding: 12, borderBottom: `2px solid ${PANEL}` }}>{item.ordinal}. {item.statement}</th>
                        <td style={{ color: MUTED, fontSize: 13, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{item.n}명</td>
                        <td style={{ color: INK, fontSize: 13, fontWeight: 800, padding: 12, borderBottom: `2px solid ${PANEL}` }}>평균 {item.avg == null ? '—' : item.avg.toFixed(2)}</td>
                        <td style={{ color: MUTED, fontSize: 12, lineHeight: 1.5, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{distributionText(item.scale, item.dist)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VoteConsole({ sessionId }: { sessionId: string | null }) {
  const [view, setView] = useState<VoteView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    setView(null);
    setNotice(null);
    setBusy(false);
    if (!sessionId) {
      setNotice('선택 회차의 식별자를 확인하지 못했습니다. 좌측 트리에서 회차를 다시 선택해 주세요.');
      return () => { generation.current += 1; };
    }
    void completeVoteLoad(
      () => loadSessionVotes(sessionId),
      () => generation.current === requestGeneration,
      setBusy,
      setView,
      setNotice,
    );
    return () => { generation.current += 1; };
  }, [sessionId]);

  return (
    <div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase', marginBottom: 8 }}>회차 · 투표</div>
      <h2 style={{ color: NAVY, fontSize: 24, margin: '0 0 6px' }}>이 회차의 투표 집계</h2>
      <p style={{ color: MUTED, fontSize: 14, margin: '0 0 18px' }}>
        로그인한 운영자의 기관·선택 회차 범위에서 투표 상태, 제출 수, 문항별 점수 분포를 확인합니다.
      </p>

      <div aria-busy={busy}>
        {notice ? <p role="alert" style={{ color: '#B91C1C', fontSize: 14, fontWeight: 700 }}>{notice}</p> : null}
        {view ? <VoteResults view={view} /> : !notice ? (
          <p role="status" aria-live="polite" style={{ color: MUTED }}>투표 집계를 안전하게 불러오는 중…</p>
        ) : null}
      </div>
    </div>
  );
}
