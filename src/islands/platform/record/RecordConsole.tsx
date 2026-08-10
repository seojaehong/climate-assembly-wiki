import { useEffect, useRef, useState } from 'react';
import { issueItems, type IssueItemsResult, type PlatformResult } from '../../../lib/platform';
import type { TopicTarget } from '../platform-nav-logic';
import { itemKindLabel, sourceReference } from '../review/review-console-logic';
import { buildRecordView, type RecordScope, type RecordView } from './record-console-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';

type IssueItemsLoader = (code: string, topicId: string) => Promise<PlatformResult<IssueItemsResult>>;

export async function loadScopedRecords(
  code: string,
  scope: RecordScope,
  topics: readonly TopicTarget[],
  loader: IssueItemsLoader = issueItems,
): Promise<PlatformResult<RecordView>> {
  const responses = await Promise.all(topics.map(async (target) => ({
    target,
    response: await loader(code, target.id),
  })));
  const topicResults = [];
  for (const { target, response } of responses) {
    if (!response.data) {
      if (!response.notice) {
        console.error('Record topic request returned no data or notice', target.id);
      }
      return {
        data: null,
        notice: response.notice
          ? `${target.label}: ${response.notice}`
          : `${target.label}: 기록 데이터를 불러오지 못했습니다.`,
      };
    }
    topicResults.push({ target, result: response.data });
  }
  return { data: buildRecordView(scope, topicResults), notice: null };
}

export async function completeRecordLoad(
  action: () => Promise<PlatformResult<RecordView>>,
  onBusyChange: (busy: boolean) => void,
  onViewChange: (view: RecordView | null) => void,
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
      console.error('Record request returned no data or notice');
      onNoticeChange('기록 데이터를 불러오지 못했습니다.');
    }
    return Boolean(result.data);
  } catch (error: unknown) {
    if (!isCurrent()) return false;
    console.error('Failed to load scoped records', error);
    onNoticeChange('기록 데이터를 불러오는 중 예상하지 못한 오류가 발생했습니다.');
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

export function RecordResults({ view }: { view: RecordView }) {
  const session = view.scope === 'session';
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <p role="status" aria-live="polite" className="sr-only">
        기록을 불러왔습니다. 원문 {view.stats.itemCount}건, 제출 {view.stats.submissionCount}건, 미분류 {view.stats.unclassifiedCount}건입니다.
      </p>
      <section aria-label="기록 요약" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <StatCard label="기록 원문" value={view.stats.itemCount} />
        <StatCard label="제출" value={view.stats.submissionCount} />
        <StatCard label="참여 조" value={view.stats.teamCount} />
        <StatCard label="쟁점 연결" value={view.stats.classifiedCount} />
        <StatCard label="미분류" value={view.stats.unclassifiedCount} />
      </section>

      {view.items.length === 0 ? (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>등록된 조별 기록이 없습니다.</p>
      ) : (
        <div style={{ overflowX: 'auto', border: `2px solid ${LINE}`, borderRadius: 16, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: session ? 980 : 840 }}>
            <caption style={{ textAlign: 'left', color: NAVY, fontSize: 18, fontWeight: 800, padding: '16px 18px' }}>
              {session ? '회차 ' : ''}조별 기록 원문과 쟁점 연결 상태
            </caption>
            <thead style={{ background: PANEL }}>
              <tr>
                {(session
                  ? ['출처 주제', '조', '항목', '원문', '분류 상태', '제출 참조']
                  : ['조', '항목', '원문', '분류 상태', '제출 참조']).map((label) => (
                  <th key={label} scope="col" style={{ color: NAVY, fontSize: 13, textAlign: 'left', padding: '10px 12px', borderTop: `2px solid ${LINE}`, borderBottom: `2px solid ${LINE}` }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.items.map((item) => {
                const linked = item.issueIds.length > 0;
                const reference = sourceReference(item);
                return (
                  <tr key={item.itemId} id={reference.id} tabIndex={-1}>
                    {session ? <td style={{ color: MUTED, fontSize: 13, fontWeight: 700, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{item.topicLabel}</td> : null}
                    <td style={{ color: INK, fontSize: 13, fontWeight: 700, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{item.teamName}</td>
                    <td style={{ color: MUTED, fontSize: 13, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{itemKindLabel(item.kind)} {item.ordinal}번</td>
                    <th scope="row" style={{ color: INK, fontSize: 14, fontWeight: 600, lineHeight: 1.55, textAlign: 'left', padding: 12, borderBottom: `2px solid ${PANEL}` }}>
                      {item.content}
                      {item.rationale ? <span style={{ display: 'block', color: MUTED, fontSize: 12, fontWeight: 500, marginTop: 4 }}>근거: {item.rationale}</span> : null}
                    </th>
                    <td style={{ padding: 12, borderBottom: `2px solid ${PANEL}` }}>
                      <span style={{ display: 'inline-block', border: `2px solid ${linked ? '#2F6F25' : '#8A4F08'}`, borderRadius: 999, background: linked ? '#E3F1E6' : '#FFF4D6', color: linked ? '#2F6F25' : '#8A4F08', padding: '2px 9px', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {linked ? `쟁점 ${item.issueIds.length}건 연결` : '미분류'}
                      </span>
                      {linked ? (
                        <ul aria-label="쟁점 연결 상세" style={{ color: MUTED, fontSize: 12, lineHeight: 1.5, margin: '8px 0 0', paddingLeft: 18 }}>
                          {item.links.map((link, index) => (
                            <li key={`${link.issue_id}:${link.cluster_id ?? ''}:${index}`}>
                              쟁점 {link.issue_id} · 군집 {link.cluster_id ?? '없음'} · 연결자 {link.linked_by}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </td>
                    <td style={{ color: MUTED, fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere', padding: 12, borderBottom: `2px solid ${PANEL}` }}>
                      {item.submissionId}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RecordConsole({
  scope,
  topics,
}: {
  scope: RecordScope | null;
  topics: readonly TopicTarget[];
}) {
  const [code, setCode] = useState('');
  const [view, setView] = useState<RecordView | null>(null);
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
        이 {scope === 'session' ? '회차' : '주제'}에 기록할 주제가 등록되지 않았습니다.
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
    await completeRecordLoad(
      () => loadScopedRecords(trimmedCode, scope, topics),
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
          {scope === 'session' ? 'Session' : 'Topic'} · Records
        </div>
        <h2 style={{ color: NAVY, fontSize: 24, fontWeight: 800, margin: '6px 0' }}>이 {scopeLabel}의 조별 기록</h2>
        <p style={{ color: MUTED, fontSize: 15, margin: 0 }}>
          {scope === 'session' ? `${topics.length}개 주제를 합산해 ` : ''}조별 제출 원문, 근거와 쟁점 연결 상태를 읽기 전용으로 확인합니다.
        </p>
      </header>

      <form aria-label={`${scopeLabel} 기록 불러오기`} aria-busy={busy} onSubmit={load} style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: PANEL, padding: 18 }}>
        <label htmlFor="record-join-code" style={{ display: 'block', color: NAVY, fontSize: 14, fontWeight: 800, marginBottom: 6 }}>조 참여 코드</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            id="record-join-code"
            type="password"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-describedby={notice ? 'record-load-notice' : 'record-load-help'}
            autoComplete="off"
            style={{ flex: '1 1 220px', minWidth: 0, height: 44, boxSizing: 'border-box', border: `2px solid ${LINE}`, borderRadius: 10, padding: '0 12px', color: INK, background: '#fff', fontSize: 14 }}
          />
          <button type="submit" disabled={busy} style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 10, background: busy ? '#CBD5DC' : TEAL, color: '#fff', padding: '8px 18px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? '불러오는 중…' : '기록 불러오기'}
          </button>
        </div>
        <p id="record-load-help" style={{ color: MUTED, fontSize: 12, margin: '8px 0 0' }}>코드는 조회 권한 확인에만 사용하며 브라우저 저장소에 보관하지 않습니다.</p>
        {notice ? <p id="record-load-notice" role="alert" style={{ color: '#B91C1C', fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>{notice}</p> : null}
      </form>

      {view ? <RecordResults view={view} /> : (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>조별 기록을 불러오면 원문과 분류 상태가 표시됩니다.</p>
      )}
    </div>
  );
}
