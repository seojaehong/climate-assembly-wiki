import { useCallback, useEffect, useRef, useState } from 'react';
import { issueItems, type IssueItemsResult, type PlatformResult } from '../../../lib/platform';
import type { ScopePathContext, SessionTopicGroup } from '../platform-nav-logic';
import { buildRecordView, type RecordView } from './record-console-logic';
import { completeRecordLoad, RecordResults } from './RecordConsole';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';

type IssueItemsLoader = (sessionId: string, topicId: string) => Promise<PlatformResult<IssueItemsResult>>;

export async function loadAssemblyRecords(
  groups: readonly SessionTopicGroup[],
  context: ScopePathContext = {},
  loader: IssueItemsLoader = issueItems,
): Promise<PlatformResult<RecordView>> {
  const targets = groups.flatMap((group) => group.topics.map((topic) => ({ group, topic })));
  const responses = await Promise.all(targets.map(async ({ group, topic }) => ({
    group,
    topic,
    response: await loader(group.id, topic.id),
  })));
  const topicResults = [];
  for (const { group, topic, response } of responses) {
    if (!response.data) {
      if (!response.notice) console.error('Assembly record request returned no data or notice', group.id, topic.id);
      return {
        data: null,
        notice: response.notice
          ? `${group.label} · ${topic.label}: ${response.notice}`
          : `${group.label} · ${topic.label}: 기록 데이터를 불러오지 못했습니다.`,
      };
    }
    topicResults.push({
      target: { ...topic, sessionId: group.id, sessionLabel: group.label },
      result: response.data,
    });
  }
  return { data: buildRecordView('assembly', topicResults, context), notice: null };
}

export default function AssemblyRecordConsole({
  groups,
  context = {},
}: {
  groups: readonly SessionTopicGroup[];
  context?: ScopePathContext;
}) {
  const [view, setView] = useState<RecordView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);
  const groupsRef = useRef(groups);
  const contextRef = useRef(context);
  groupsRef.current = groups;
  contextRef.current = context;
  const scopeKey = groups.map((group) => `${group.id}:${group.topics.map((topic) => topic.id).join(',')}`).join('|');
  const activeGroups = groups.filter((group) => group.topics.length > 0);
  const topicCount = activeGroups.reduce((total, group) => total + group.topics.length, 0);

  const load = useCallback(async (): Promise<void> => {
    if (groupsRef.current.every((group) => group.topics.length === 0)) return;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    await completeRecordLoad(
      () => loadAssemblyRecords(groupsRef.current, contextRef.current),
      setBusy,
      setView,
      setNotice,
      () => requestGeneration.current === generation,
    );
  }, []);

  useEffect(() => {
    requestGeneration.current += 1;
    setView(null);
    setNotice(null);
    setBusy(false);
    void load();
    return () => { requestGeneration.current += 1; };
  }, [load, scopeKey]);

  if (groups.length === 0) {
    return (
      <div role="status" aria-live="polite" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
        이 공론화에 기록을 확인할 회차가 등록되지 않았습니다.
      </div>
    );
  }

  if (topicCount === 0) {
    return (
      <div role="status" aria-live="polite" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
        이 공론화의 회차에 기록을 확인할 주제가 등록되지 않았습니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <header>
        <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase' }}>Assembly · Records</div>
        <h2 style={{ color: NAVY, fontSize: 24, fontWeight: 800, margin: '6px 0' }}>이 공론화의 조별 기록</h2>
        <p style={{ color: MUTED, fontSize: 15, margin: 0 }}>
          {activeGroups.length}개 회차 · {topicCount}개 주제의 조별 제출 원문과 쟁점 연결 상태를 출처와 함께 합산합니다.
        </p>
      </header>

      <section aria-label="공론화 기록 동기화" aria-busy={busy} style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: PANEL, padding: 18 }}>
        <p style={{ color: MUTED, fontSize: 13, margin: '0 0 10px' }}>
          로그인된 운영자 권한으로 각 회차의 {topicCount}개 주제를 자동 동기화합니다.
        </p>
        <button type="button" onClick={() => { void load(); }} disabled={busy} style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 10, background: busy ? '#CBD5DC' : TEAL, color: '#fff', padding: '8px 18px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? '불러오는 중…' : '공론화 기록 새로고침'}
        </button>
        {notice ? <p role="alert" style={{ color: '#B91C1C', fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>{notice}</p> : null}
      </section>

      {view ? <RecordResults view={view} /> : (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>{busy ? '공론화 전체 기록을 안전하게 불러오는 중입니다.' : '공론화 전체 기록을 자동으로 불러옵니다.'}</p>
      )}
    </div>
  );
}
