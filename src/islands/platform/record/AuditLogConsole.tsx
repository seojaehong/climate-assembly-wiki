import { useCallback, useEffect, useRef, useState } from 'react';
import { platformAuditList, type PlatformAuditEvent } from '../../../lib/platform';
import type { ScopePathRef } from '../platform-nav-logic';
import { auditEventsToCsv, formatAuditActor, formatAuditResource } from './audit-log-logic';

const PAGE_SIZE = 100;
const NAVY = '#1F4E79';
const TEAL = '#135C73';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const RED = '#B42318';

function downloadCsv(events: readonly PlatformAuditEvent[], orgLabel: string): void {
  const blob = new Blob([auditEventsToCsv(events)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${orgLabel.replace(/[^0-9A-Za-z가-힣_-]+/g, '-')}-audit-log.csv`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function AuditLogConsole({ organization }: { organization: ScopePathRef | null }) {
  const [events, setEvents] = useState<PlatformAuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('감사로그를 불러오는 중입니다.');
  const [isError, setIsError] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (nextCursor: string | null, append: boolean) => {
    const request = generation.current + 1;
    generation.current = request;
    setBusy(true);
    setIsError(false);
    const result = await platformAuditList(nextCursor, PAGE_SIZE);
    if (generation.current !== request) return;
    if (!result.data) {
      console.error('Platform audit list failed', result.notice);
      setNotice(result.notice ?? '감사로그를 불러오지 못했습니다.');
      setIsError(true);
      setBusy(false);
      return;
    }
    const page = result.data;
    setEvents((current) => append ? [...current, ...page.events] : page.events);
    setCursor(page.next_after_id);
    setNotice(page.events.length === 0 && !append
      ? '선택한 기관에 기록된 사용자 행위가 없습니다.'
      : `감사로그 ${append ? '추가 ' : ''}${page.events.length}건을 불러왔습니다.`);
    setBusy(false);
  }, []);

  useEffect(() => {
    setEvents([]);
    setCursor(null);
    setNotice('감사로그를 불러오는 중입니다.');
    void load(null, false);
    return () => { generation.current += 1; };
  }, [organization?.id, load]);

  return (
    <div aria-busy={busy}>
      <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase', marginBottom: 8 }}>기관 · 감사로그</div>
      <h2 style={{ color: NAVY, margin: '0 0 6px' }}>{organization?.label ?? '선택 기관'} 사용자 행위 감사로그</h2>
      <p style={{ color: MUTED, margin: '0 0 16px' }}>선택 조직에서 발생한 변경의 시각·행위자·대상·변경 필드만 표시합니다. 원문과 비밀 값은 저장하지 않습니다.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <button type="button" aria-label="감사로그 새로고침" disabled={busy} onClick={() => void load(null, false)} style={{ minHeight: 44, border: `2px solid ${NAVY}`, borderRadius: 8, padding: '8px 14px', background: NAVY, color: '#fff', fontWeight: 800 }}>새로고침</button>
        <button type="button" disabled={events.length === 0 || busy} onClick={() => downloadCsv(events, organization?.label ?? 'organization')} style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 8, padding: '8px 14px', background: '#fff', color: TEAL, fontWeight: 800 }}>CSV 내보내기</button>
      </div>
      <p role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} style={{ color: isError ? RED : TEAL, fontWeight: 700 }}>{notice}</p>
      {events.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <caption style={{ textAlign: 'left', color: MUTED, paddingBottom: 8 }}>최신순 감사 이벤트</caption>
            <thead><tr>{['시각', '행위자', '동작', '대상', '변경 필드'].map((label) => <th key={label} scope="col" style={{ textAlign: 'left', borderBottom: `2px solid ${LINE}`, padding: 10, color: NAVY }}>{label}</th>)}</tr></thead>
            <tbody>{events.map((event) => (
              <tr key={event.id}>
                <td style={{ borderBottom: `2px solid ${LINE}`, padding: 10, whiteSpace: 'nowrap' }}><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString('ko-KR')}</time></td>
                <td style={{ borderBottom: `2px solid ${LINE}`, padding: 10 }}>{formatAuditActor(event)}</td>
                <td style={{ borderBottom: `2px solid ${LINE}`, padding: 10 }}>{event.operation}</td>
                <td style={{ borderBottom: `2px solid ${LINE}`, padding: 10, fontFamily: 'monospace' }}>{formatAuditResource(event)}</td>
                <td style={{ borderBottom: `2px solid ${LINE}`, padding: 10 }}>{event.changed_fields.join(', ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      {cursor !== null ? <button type="button" disabled={busy} onClick={() => void load(cursor, true)} style={{ minHeight: 44, marginTop: 14, border: `2px solid ${TEAL}`, borderRadius: 8, padding: '8px 14px', background: '#fff', color: TEAL, fontWeight: 800 }}>이전 기록 더 보기</button> : null}
    </div>
  );
}
