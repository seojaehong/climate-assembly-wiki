import { useEffect, useRef, useState } from 'react';
import { issueList, type IssueListResult, type PlatformResult } from '../../../lib/platform';
import type { SessionTopicGroup } from '../platform-nav-logic';
import { buildScopedAnalysisView, type AnalysisView } from './analyze-console-logic';
import { AnalysisResults, completeAnalysisLoad } from './AnalyzeConsole';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';

type IssueListLoader = (code: string, topicId: string) => Promise<PlatformResult<IssueListResult>>;

export async function loadAssemblyAnalysis(
  codes: Readonly<Record<string, string>>,
  groups: readonly SessionTopicGroup[],
  loader: IssueListLoader = issueList,
): Promise<PlatformResult<AnalysisView>> {
  const missingCode = groups.find((group) => group.topics.length > 0 && !codes[group.id]?.trim());
  if (missingCode) {
    return { data: null, notice: `${missingCode.label}의 조 참여 코드를 입력하세요.` };
  }
  const targets = groups.flatMap((group) => group.topics.map((topic) => ({ group, topic })));
  const responses = await Promise.all(targets.map(async ({ group, topic }) => ({
    group,
    topic,
    response: await loader(codes[group.id].trim(), topic.id),
  })));
  const topicResults = [];
  for (const { group, topic, response } of responses) {
    if (!response.data) {
      if (!response.notice) console.error('Assembly analysis request returned no data or notice', group.id, topic.id);
      return {
        data: null,
        notice: response.notice
          ? `${group.label} · ${topic.label}: ${response.notice}`
          : `${group.label} · ${topic.label}: 분석 데이터를 불러오지 못했습니다.`,
      };
    }
    topicResults.push({
      target: {
        ...topic,
        sessionId: group.id,
        sessionLabel: group.label,
      },
      result: response.data,
    });
  }
  return { data: buildScopedAnalysisView('assembly', topicResults), notice: null };
}

export default function AssemblyAnalyzeConsole({ groups }: { groups: readonly SessionTopicGroup[] }) {
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [view, setView] = useState<AnalysisView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);
  const scopeKey = groups.map((group) => `${group.id}:${group.topics.map((topic) => topic.id).join(',')}`).join('|');
  const activeGroups = groups.filter((group) => group.topics.length > 0);
  const topicCount = activeGroups.reduce((total, group) => total + group.topics.length, 0);

  useEffect(() => {
    requestGeneration.current += 1;
    setCodes({});
    setView(null);
    setNotice(null);
    setBusy(false);
    return () => { requestGeneration.current += 1; };
  }, [scopeKey]);

  if (groups.length === 0) {
    return (
      <div role="status" aria-live="polite" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
        이 공론화에 분석할 회차가 등록되지 않았습니다.
      </div>
    );
  }

  if (topicCount === 0) {
    return (
      <div role="status" aria-live="polite" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
        이 공론화의 회차에 분석할 주제가 등록되지 않았습니다.
      </div>
    );
  }

  const load = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const missing = activeGroups.find((group) => !codes[group.id]?.trim());
    if (missing) {
      setNotice(`${missing.label}의 조 참여 코드를 입력하세요.`);
      return;
    }
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    await completeAnalysisLoad(
      () => loadAssemblyAnalysis(codes, groups),
      setBusy,
      setView,
      setNotice,
      () => requestGeneration.current === generation,
    );
    if (requestGeneration.current === generation) setCodes({});
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <header>
        <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase' }}>Assembly · Analysis</div>
        <h2 style={{ color: NAVY, fontSize: 24, fontWeight: 800, margin: '6px 0' }}>이 공론화의 쟁점 분석</h2>
        <p style={{ color: MUTED, fontSize: 15, margin: 0 }}>
          {activeGroups.length}개 회차 · {topicCount}개 주제의 4×6 코딩 분포와 검수·연결 근거를 출처와 함께 합산합니다.
        </p>
      </header>

      <form
        aria-label="공론화 분석 불러오기"
        aria-busy={busy}
        onSubmit={load}
        style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: PANEL, padding: 18 }}
      >
        <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0 }}>
          <legend style={{ color: NAVY, fontSize: 15, fontWeight: 800, padding: 0, marginBottom: 10 }}>회차별 조 참여 코드</legend>
          <div style={{ display: 'grid', gap: 12 }}>
            {activeGroups.map((group) => {
              const inputId = `assembly-analysis-code-${group.id}`;
              return (
                <div key={group.id}>
                  <label htmlFor={inputId} style={{ display: 'block', color: NAVY, fontSize: 14, fontWeight: 800, marginBottom: 5 }}>
                    {group.label} 참여 코드
                  </label>
                  <input
                    id={inputId}
                    type="password"
                    value={codes[group.id] ?? ''}
                    onChange={(event) => setCodes((current) => ({ ...current, [group.id]: event.target.value }))}
                    autoComplete="off"
                    aria-describedby="assembly-analysis-code-help"
                    style={{ width: '100%', maxWidth: 420, height: 44, boxSizing: 'border-box', border: `2px solid ${LINE}`, borderRadius: 10, padding: '0 12px', color: INK, background: '#fff', fontSize: 14 }}
                  />
                  <span style={{ display: 'block', color: MUTED, fontSize: 12, marginTop: 4 }}>{group.topics.length}개 주제 조회</span>
                </div>
              );
            })}
          </div>
        </fieldset>
        <p id="assembly-analysis-code-help" style={{ color: MUTED, fontSize: 12, margin: '10px 0' }}>
          코드는 각 회차의 조회 권한 확인에만 사용하며 브라우저 저장소에 보관하지 않습니다.
        </p>
        <button
          type="submit"
          disabled={busy}
          style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 10, background: busy ? '#CBD5DC' : TEAL, color: '#fff', padding: '8px 18px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}
        >
          {busy ? '불러오는 중…' : '공론화 분석 불러오기'}
        </button>
        {notice ? <p role="alert" style={{ color: '#B91C1C', fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>{notice}</p> : null}
      </form>

      {view ? <AnalysisResults view={view} /> : (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>
          회차별 코드를 입력하면 공론화 전체 분석 결과가 표시됩니다.
        </p>
      )}
    </div>
  );
}
