import { useEffect, useRef, useState } from 'react';
import type { BallotListRow, BallotResults } from '../../../lib/deliberation';
import {
  issueList,
  platformBallotList,
  platformBallotResults,
  type PlatformResult,
} from '../../../lib/platform';
import { ballotStatusLabel, distRows, subgroupBadgeLabel } from '../../mod/ballot-panel-logic';
import type { TopicTarget } from '../platform-nav-logic';
import { buildVoteView, type VoteView } from './vote-console-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';

export interface VoteDataAdapter {
  validateTopic: (code: string, topicId: string) => Promise<PlatformResult<unknown>>;
  listBallots: (code: string) => Promise<PlatformResult<BallotListRow[]>>;
  loadResults: (token: string, code: string) => Promise<PlatformResult<BallotResults | null>>;
}

const voteDataAdapter: VoteDataAdapter = {
  validateTopic: issueList,
  listBallots: platformBallotList,
  loadResults: platformBallotResults,
};

export async function loadSessionVotes(
  code: string,
  topics: readonly TopicTarget[],
  adapter: VoteDataAdapter = voteDataAdapter,
): Promise<PlatformResult<VoteView>> {
  const validationTopic = topics[0];
  if (!validationTopic) {
    return { data: null, notice: '선택 회차에 범위를 검증할 주제가 없습니다.' };
  }

  const validation = await adapter.validateTopic(code, validationTopic.id);
  if (validation.notice || !validation.data) {
    return {
      data: null,
      notice: `선택 회차 검증 실패: ${validation.notice ?? '참여 코드 범위가 일치하지 않습니다.'}`,
    };
  }

  const listed = await adapter.listBallots(code);
  if (listed.notice || !listed.data) {
    return { data: null, notice: listed.notice ?? '투표 목록 응답을 확인하지 못했습니다.' };
  }

  const loadedResults = await Promise.all(
    listed.data.map(async (ballot) => ({ ballot, result: await adapter.loadResults(ballot.token, code) })),
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

export default function VoteConsole({ topics }: { topics: readonly TopicTarget[] }) {
  const [code, setCode] = useState('');
  const [view, setView] = useState<VoteView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const topicKey = topics.map((topic) => topic.id).join(',');

  useEffect(() => {
    generation.current += 1;
    setCode('');
    setView(null);
    setNotice(null);
    setBusy(false);
    return () => { generation.current += 1; };
  }, [topicKey]);

  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    const requestGeneration = ++generation.current;
    try {
      await completeVoteLoad(
        () => loadSessionVotes(trimmed, topics),
        () => generation.current === requestGeneration,
        setBusy,
        setView,
        setNotice,
      );
    } finally {
      if (generation.current === requestGeneration) setCode('');
    }
  };

  return (
    <div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase', marginBottom: 8 }}>회차 · 투표</div>
      <h2 style={{ color: NAVY, fontSize: 24, margin: '0 0 6px' }}>이 회차의 투표 집계</h2>
      <p style={{ color: MUTED, fontSize: 14, margin: '0 0 18px' }}>투표 상태·제출 수·문항별 점수 분포를 현재 회차 범위에서 확인합니다.</p>

      <form onSubmit={submit} aria-label="회차 투표 불러오기" aria-busy={busy} style={{ border: `2px solid ${LINE}`, borderRadius: 14, background: PANEL, padding: 16, marginBottom: 18 }}>
        <label htmlFor="vote-join-code" style={{ display: 'block', color: NAVY, fontSize: 14, fontWeight: 800, marginBottom: 6 }}>조 참여 코드</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            id="vote-join-code"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            disabled={busy || topics.length === 0}
            aria-describedby={notice ? 'vote-load-notice' : 'vote-load-help'}
            style={{ flex: '1 1 220px', minWidth: 0, border: `2px solid ${LINE}`, borderRadius: 9, background: '#fff', color: INK, padding: '10px 12px', fontSize: 15 }}
          />
          <button type="submit" disabled={busy || !code.trim() || topics.length === 0} style={{ border: `2px solid ${TEAL}`, borderRadius: 9, background: TEAL, color: '#fff', padding: '10px 16px', fontWeight: 800, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? '불러오는 중…' : '집계 불러오기'}
          </button>
        </div>
        <p id="vote-load-help" style={{ color: MUTED, fontSize: 12, margin: '8px 0 0' }}>코드는 선택 회차 검증에만 사용하며 브라우저 저장소에 보관하지 않습니다.</p>
        {notice ? <p id="vote-load-notice" role="alert" style={{ color: '#B91C1C', fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>{notice}</p> : null}
      </form>

      {topics.length === 0 ? <p role="status" style={{ color: '#8A4F08' }}>이 회차에 범위를 검증할 주제가 없어 투표를 불러올 수 없습니다.</p> : null}
      {view ? <VoteResults view={view} /> : !notice && topics.length > 0 ? <p role="status" aria-live="polite" style={{ color: MUTED }}>참여 코드를 입력하면 현재 투표 집계를 불러옵니다.</p> : null}
    </div>
  );
}
