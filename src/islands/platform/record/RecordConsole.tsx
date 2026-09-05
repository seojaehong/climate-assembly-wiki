import { useCallback, useEffect, useRef, useState } from 'react';
import { issueItems, type IssueItemsResult, type PlatformResult } from '../../../lib/platform';
import { downloadBlob } from '../../mod/svg-to-png';
import type { ScopePathContext, TopicTarget } from '../platform-nav-logic';
import { itemKindLabel, sourceReference } from '../review/review-console-logic';
import { buildRecordCsv, buildRecordView, recordCsvFileName, type RecordScope, type RecordView } from './record-console-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';

type IssueItemsLoader = (sessionId: string, topicId: string) => Promise<PlatformResult<IssueItemsResult>>;

export async function loadScopedRecords(
  sessionId: string,
  scope: RecordScope,
  topics: readonly TopicTarget[],
  context: ScopePathContext = {},
  loader: IssueItemsLoader = issueItems,
): Promise<PlatformResult<RecordView>> {
  const responses = await Promise.all(topics.map(async (target) => ({
    target,
    response: await loader(sessionId, target.id),
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
  return { data: buildRecordView(scope, topicResults, context), notice: null };
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

type RecordCsvDownloader = (blob: Blob, fileName: string) => void;
export type RecordExportState = { kind: 'status' | 'error'; text: string } | null;

export function downloadRecordCsv(
  view: RecordView,
  at: Date,
  downloader: RecordCsvDownloader = downloadBlob,
): void {
  downloader(
    new Blob([buildRecordCsv(view)], { type: 'text/csv;charset=utf-8' }),
    recordCsvFileName({ view, at }),
  );
}

export function completeRecordExport(
  action: () => void,
  onStateChange: (state: Exclude<RecordExportState, null>) => void,
): boolean {
  try {
    action();
    onStateChange({ kind: 'status', text: '기록 CSV 파일을 내려받았습니다.' });
    return true;
  } catch (error: unknown) {
    console.error('Failed to download record CSV', error);
    onStateChange({ kind: 'error', text: '기록 CSV 파일을 만들지 못했습니다. 다시 시도해 주세요.' });
    return false;
  }
}

export function RecordExportNotice({ state }: { state: RecordExportState }) {
  return (
    <p
      id="record-export-status"
      role={state?.kind === 'error' ? 'alert' : 'status'}
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {state?.text ?? ''}
    </p>
  );
}

export function RecordExportButton({ view }: { view: RecordView }) {
  const [state, setState] = useState<RecordExportState>(null);

  const onDownload = () => {
    completeRecordExport(() => downloadRecordCsv(view, new Date()), setState);
  };

  return (
    <div>
      <button
        type="button"
        aria-label="기록 CSV 내려받기"
        aria-describedby="record-export-status"
        onClick={onDownload}
        style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 10, background: TEAL, color: '#fff', padding: '8px 16px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}
      >
        기록 CSV 내려받기
      </button>
      <RecordExportNotice state={state} />
    </div>
  );
}

export function RecordResults({ view }: { view: RecordView }) {
  const showTopicSource = view.scope !== 'topic';
  const showSessionSource = view.scope === 'assembly';
  const scopePrefix = view.scope === 'assembly' ? '공론화 ' : view.scope === 'session' ? '회차 ' : '';
  const columns = [
    ...(showSessionSource ? ['출처 회차'] : []),
    ...(showTopicSource ? ['출처 주제'] : []),
    '조', '항목', '원문', '분류 상태', '제출 참조',
  ];
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

      {view.items.length > 0 ? <RecordExportButton view={view} /> : null}

      {view.items.length === 0 ? (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>등록된 조별 기록이 없습니다.</p>
      ) : (
        <div style={{ overflowX: 'auto', border: `2px solid ${LINE}`, borderRadius: 16, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: view.scope === 'assembly' ? 1120 : view.scope === 'session' ? 980 : 840 }}>
            <caption style={{ textAlign: 'left', color: NAVY, fontSize: 18, fontWeight: 800, padding: '16px 18px' }}>
              {scopePrefix}조별 기록 원문과 쟁점 연결 상태
            </caption>
            <thead style={{ background: PANEL }}>
              <tr>
                {columns.map((label) => (
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
                    {showSessionSource ? <td style={{ color: MUTED, fontSize: 13, fontWeight: 700, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{item.sessionLabel ?? '—'}</td> : null}
                    {showTopicSource ? <td style={{ color: MUTED, fontSize: 13, fontWeight: 700, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{item.topicLabel}</td> : null}
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
                            <li key={`${link.issueId}:${link.clusterId ?? ''}:${index}`}>
                              쟁점 {link.issueId} · 군집 {link.clusterId ?? '없음'} · 연결자 {link.linkedBy}
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
  sessionId,
  context = {},
}: {
  scope: RecordScope | null;
  topics: readonly TopicTarget[];
  sessionId: string | null;
  context?: ScopePathContext;
}) {
  const [view, setView] = useState<RecordView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);
  const topicsRef = useRef(topics);
  const contextRef = useRef(context);
  topicsRef.current = topics;
  contextRef.current = context;
  const scopeKey = `${scope ?? 'none'}:${topics.map((topic) => topic.id).join(',')}`;

  const load = useCallback(async (): Promise<void> => {
    if (!scope || !sessionId || topicsRef.current.length === 0) return;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    await completeRecordLoad(
      () => loadScopedRecords(sessionId, scope, topicsRef.current, contextRef.current),
      setBusy,
      setView,
      setNotice,
      () => requestGeneration.current === generation,
    );
  }, [scope, sessionId]);

  useEffect(() => {
    requestGeneration.current += 1;
    setView(null);
    setNotice(null);
    setBusy(false);
    void load();
    return () => { requestGeneration.current += 1; };
  }, [load, scopeKey]);

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

  if (!sessionId) {
    return (
      <div role="alert" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
        회차 연결 정보를 확인하지 못했습니다. 좌측 트리에서 회차 또는 주제를 다시 선택하세요.
      </div>
    );
  }

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

      <section aria-label={`${scopeLabel} 기록 동기화`} aria-busy={busy} style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: PANEL, padding: 18 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <p id="record-load-help" style={{ flex: '1 1 260px', color: MUTED, fontSize: 13, margin: 0, alignSelf: 'center' }}>
            로그인된 운영자 권한과 선택한 회차를 기준으로 자동 동기화합니다.
          </p>
          <button type="button" onClick={() => { void load(); }} disabled={busy} style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 10, background: busy ? '#CBD5DC' : TEAL, color: '#fff', padding: '8px 18px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? '불러오는 중…' : '기록 새로고침'}
          </button>
        </div>
        {notice ? <p id="record-load-notice" role="alert" style={{ color: '#B91C1C', fontSize: 14, fontWeight: 700, margin: '10px 0 0' }}>{notice}</p> : null}
      </section>

      {view ? <RecordResults view={view} /> : (
        <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>{busy ? '조별 기록을 안전하게 불러오는 중입니다.' : '조별 기록을 자동으로 불러옵니다.'}</p>
      )}
    </div>
  );
}
