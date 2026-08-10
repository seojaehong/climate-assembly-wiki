import { useEffect, useRef, useState } from 'react';
import HitlBadge from '../../../components/HitlBadge';
import { issueList, type IssueListResult, type PlatformResult } from '../../../lib/platform';
import { buildScopedAnalysisView } from './analyze-console-logic';
import type { AnalysisScope, AnalysisView, DistributionItem } from './analyze-console-logic';
import type { TopicTarget } from '../platform-nav-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';

type IssueListLoader = (code: string, topicId: string) => Promise<PlatformResult<IssueListResult>>;

export async function loadScopedAnalysis(
  code: string,
  scope: AnalysisScope,
  topics: readonly TopicTarget[],
  loader: IssueListLoader = issueList,
): Promise<PlatformResult<AnalysisView>> {
  const responses = await Promise.all(topics.map(async (target) => ({
    target,
    response: await loader(code, target.id),
  })));
  const topicResults = [];
  for (const { target, response } of responses) {
    if (!response.data) {
      if (!response.notice) {
        console.error('Analysis topic request returned no data or notice', target.id);
      }
      return {
        data: null,
        notice: response.notice
          ? `${target.label}: ${response.notice}`
          : `${target.label}: 분석 데이터를 불러오지 못했습니다.`,
      };
    }
    topicResults.push({ target, result: response.data });
  }
  return {
    data: buildScopedAnalysisView(scope, topicResults),
    notice: null,
  };
}

export async function completeAnalysisLoad(
  action: () => Promise<PlatformResult<AnalysisView>>,
  onBusyChange: (busy: boolean) => void,
  onViewChange: (view: AnalysisView | null) => void,
  onNoticeChange: (notice: string | null) => void,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  onBusyChange(true);
  onViewChange(null);
  onNoticeChange(null);
  try {
    const result = await action();
    if (!isCurrent()) return false;
    if (result.data) onViewChange(result.data);
    if (result.notice) onNoticeChange(result.notice);
    if (!result.data && !result.notice) {
      console.error('Analysis request returned no data or notice');
      onNoticeChange('분석 데이터를 불러오지 못했습니다.');
    }
    return Boolean(result.data);
  } catch (error: unknown) {
    if (!isCurrent()) return false;
    console.error('Failed to load scoped analysis', error);
    onNoticeChange('분석 데이터를 불러오는 중 예상하지 못한 오류가 발생했습니다.');
    return false;
  } finally {
    if (isCurrent()) onBusyChange(false);
  }
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div aria-label={`${label} ${value}건`} style={{ border: `2px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: '14px 16px' }}>
      <div style={{ color: MUTED, fontSize: 13, fontWeight: 700 }}>{label}</div>
      <div style={{ color: NAVY, fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}건</div>
    </div>
  );
}

function DistributionPanel({ id, title, items, total }: { id: string; title: string; items: DistributionItem[]; total: number }) {
  return (
    <section aria-labelledby={id} style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 18 }}>
      <h3 id={id} style={{ color: NAVY, fontSize: 18, fontWeight: 800, margin: '0 0 14px' }}>{title}</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
        {items.map((item) => {
          const width = total > 0 ? Math.round((item.count / total) * 100) : 0;
          return (
            <li key={item.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: INK, fontSize: 14, fontWeight: 700 }}>
                <span>{item.label}</span>
                <span>{item.count}건</span>
              </div>
              <div aria-hidden="true" style={{ height: 10, borderRadius: 999, background: PANEL, marginTop: 5, overflow: 'hidden' }}>
                <div style={{ width: `${width}%`, height: '100%', background: TEAL }} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AnalysisResults({ view }: { view: AnalysisView }) {
  const showTopicSource = view.scope !== 'topic';
  const showSessionSource = view.scope === 'assembly';
  const sourcePrefix = view.scope === 'assembly' ? '공론화 ' : view.scope === 'session' ? '회차 ' : '';
  const columns = [
    ...(showSessionSource ? ['출처 회차'] : []),
    ...(showTopicSource ? ['출처 주제'] : []),
    '쟁점', '빈도', '방향', '검수', '연결 근거',
  ];
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <p role="status" aria-live="polite" className="sr-only">
        분석 결과를 불러왔습니다. 쟁점 {view.stats.issueCount}건, 검수 완료 {view.stats.reviewedCount}건입니다.
      </p>
      <section aria-label="분석 요약" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <StatCard label="쟁점" value={view.stats.issueCount} />
        <StatCard label="검수 완료" value={view.stats.reviewedCount} />
        <StatCard label="미분류 원문" value={view.stats.unclassifiedCount} />
        <StatCard label="원문 연결 관계" value={view.stats.linkedRelationshipCount} />
      </section>

      {view.issues.length === 0 ? (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>분석할 쟁점이 없습니다.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 14 }}>
            <DistributionPanel id="analysis-frequency-distribution" title="빈도 분포" items={view.frequencyDistribution} total={view.stats.issueCount} />
            <DistributionPanel id="analysis-stance-distribution" title="방향 분포" items={view.stanceDistribution} total={view.stats.issueCount} />
          </div>

          <div style={{ overflowX: 'auto', border: `2px solid ${LINE}`, borderRadius: 16, background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: view.scope === 'assembly' ? 1040 : view.scope === 'session' ? 900 : 760 }}>
              <caption style={{ textAlign: 'left', color: NAVY, fontSize: 18, fontWeight: 800, padding: '16px 18px' }}>
                {sourcePrefix}쟁점별 빈도·방향·검수·원문 연결 분석
              </caption>
              <thead style={{ background: PANEL }}>
                <tr>
                  {columns.map((label) => (
                    <th key={label} scope="col" style={{ color: NAVY, fontSize: 13, textAlign: 'left', padding: '10px 12px', borderTop: `2px solid ${LINE}`, borderBottom: `2px solid ${LINE}` }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.issues.map((issue) => (
                  <tr key={issue.id}>
                    {showSessionSource ? (
                      <td style={{ color: MUTED, fontSize: 13, fontWeight: 700, padding: 12, borderBottom: `2px solid ${PANEL}` }}>
                        {issue.sessionLabel ?? '—'}
                      </td>
                    ) : null}
                    {showTopicSource ? (
                      <td style={{ color: MUTED, fontSize: 13, fontWeight: 700, padding: 12, borderBottom: `2px solid ${PANEL}` }}>
                        {issue.topicLabel}
                      </td>
                    ) : null}
                    <th scope="row" style={{ color: INK, fontSize: 14, textAlign: 'left', padding: 12, borderBottom: `2px solid ${PANEL}` }}>
                      <span style={{ display: 'block', fontWeight: 800 }}>{issue.label}</span>
                      {issue.summary ? <span style={{ display: 'block', color: MUTED, fontSize: 12, fontWeight: 500, marginTop: 4 }}>{issue.summary}</span> : null}
                    </th>
                    <td style={{ color: INK, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{issue.frequencyBadge}</td>
                    <td style={{ color: INK, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{issue.stanceBadge}</td>
                    <td style={{ padding: 12, borderBottom: `2px solid ${PANEL}` }}><HitlBadge status={issue.hitl} /></td>
                    <td style={{ color: MUTED, padding: 12, borderBottom: `2px solid ${PANEL}` }}>
                      원문 연결 {issue.linkedItemCount}건 · 군집 분모 {issue.consensusDenominator}건
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function AnalyzeConsole({
  scope,
  topics,
}: {
  scope: AnalysisScope | null;
  topics: readonly TopicTarget[];
}) {
  const [code, setCode] = useState('');
  const [view, setView] = useState<AnalysisView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);
  const scopeKey = `${scope ?? 'none'}:${topics.map((topic) => topic.id).join(',')}`;

  useEffect(() => {
    requestGeneration.current += 1;
    setCode('');
    setView(null);
    setNotice(null);
    setBusy(false);
    return () => { requestGeneration.current += 1; };
  }, [scopeKey]);

  if (!scope) {
    return (
      <div role="status" aria-live="polite" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
        주제(topic) 또는 회차(session) 스코프를 먼저 선택하세요.
      </div>
    );
  }

  if (topics.length === 0) {
    return (
      <div role="status" aria-live="polite" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
        이 {scope === 'session' ? '회차' : '주제'}에 분석할 주제가 등록되지 않았습니다.
      </div>
    );
  }

  const load = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setNotice('조 참여 코드(join_code)를 입력하세요.');
      return;
    }
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    await completeAnalysisLoad(
      () => loadScopedAnalysis(trimmedCode, scope, topics),
      setBusy,
      setView,
      setNotice,
      () => requestGeneration.current === generation,
    );
    if (requestGeneration.current === generation) setCode('');
  };

  const scopeLabel = scope === 'session' ? '회차' : '주제';

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <header>
        <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase' }}>
          {scope === 'session' ? 'Session' : 'Topic'} · Analysis
        </div>
        <h2 style={{ color: NAVY, fontSize: 24, fontWeight: 800, margin: '6px 0' }}>이 {scopeLabel}의 쟁점 분석</h2>
        <p style={{ color: MUTED, fontSize: 15, margin: 0 }}>
          {scope === 'session' ? `${topics.length}개 주제를 합산해 ` : ''}4×6 코딩 분포, 검수 상태, 미분류 원문과 쟁점별 연결 근거를 읽기 전용으로 확인합니다.
        </p>
      </header>

      <form
        aria-label={`${scopeLabel} 분석 불러오기`}
        aria-busy={busy}
        onSubmit={load}
        style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: PANEL, padding: 18 }}
      >
        <label htmlFor="analysis-join-code" style={{ display: 'block', color: NAVY, fontSize: 14, fontWeight: 800, marginBottom: 6 }}>
          조 참여 코드
        </label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            id="analysis-join-code"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby={notice ? 'analysis-load-notice' : 'analysis-load-help'}
            autoComplete="off"
            style={{ flex: '1 1 220px', minWidth: 0, height: 44, boxSizing: 'border-box', border: `2px solid ${LINE}`, borderRadius: 10, padding: '0 12px', color: INK, background: '#fff', fontSize: 14 }}
          />
          <button
            type="submit"
            disabled={busy}
            style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 10, background: busy ? '#CBD5DC' : TEAL, color: '#fff', padding: '8px 18px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}
          >
            {busy ? '불러오는 중…' : '분석 불러오기'}
          </button>
        </div>
        <p id="analysis-load-help" style={{ color: MUTED, fontSize: 12, margin: '8px 0 0' }}>
          코드는 조회 권한 확인에만 사용하며 브라우저 저장소에 보관하지 않습니다.
        </p>
        {notice ? <p id="analysis-load-notice" role="alert" style={{ color: '#B91C1C', fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>{notice}</p> : null}
      </form>

      {view ? <AnalysisResults view={view} /> : (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>
          쟁점 목록을 불러오면 분석 결과가 표시됩니다.
        </p>
      )}
    </div>
  );
}
