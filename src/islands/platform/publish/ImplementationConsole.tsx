import { useMemo, useRef, useState } from 'react';
import {
  resultGet,
  resultImplementationUpsert,
} from '../../../lib/platform';
import implementationStatusContract from '../../result/implementation-status-contract.json';
import {
  IMPLEMENTATION_STATUSES,
  buildImplementationMutation,
  isImplementationStatus,
  listImplementationIssues,
  verifyImplementationMutation,
} from './implementation-console-logic';
import { runExclusivePublicationOperation } from './publish-console-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const GREEN = '#397D2A';
const AMBER = '#9A5B00';
const RED = '#B42318';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F5F9FB';

interface Props {
  hqToken: string;
  resultId: string;
  resultToken: string;
  resultBody: unknown;
  onVerified: (body: unknown) => void;
}

function localDateTimeValue(iso?: string): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function ImplementationConsole({ hqToken, resultId, resultToken, resultBody, onVerified }: Props) {
  const issues = useMemo(() => listImplementationIssues(resultBody), [resultBody]);
  const [issueId, setIssueId] = useState(issues[0]?.id ?? '');
  const selected = issues.find((issue) => issue.id === issueId) ?? null;
  const [status, setStatus] = useState(selected?.implementation?.status ?? 'under_review');
  const [responsibleBody, setResponsibleBody] = useState(selected?.implementation?.responsible_body ?? '');
  const [updatedAt, setUpdatedAt] = useState(localDateTimeValue(selected?.implementation?.updated_at));
  const [summary, setSummary] = useState(selected?.implementation?.summary ?? '');
  const [evidenceUrl, setEvidenceUrl] = useState(selected?.implementation?.evidence_url ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operationLock = useRef(false);

  const chooseIssue = (nextIssueId: string) => {
    const next = issues.find((issue) => issue.id === nextIssueId)?.implementation ?? null;
    setIssueId(nextIssueId);
    setStatus(next?.status ?? 'under_review');
    setResponsibleBody(next?.responsible_body ?? '');
    setUpdatedAt(localDateTimeValue(next?.updated_at));
    setSummary(next?.summary ?? '');
    setEvidenceUrl(next?.evidence_url ?? '');
    setError(null);
    setNotice(null);
  };

  const save = async () => {
    if (busy || operationLock.current) return;
    setError(null);
    setNotice(null);
    let mutation;
    try {
      mutation = buildImplementationMutation({ issueId, status, responsibleBody, updatedAt, summary, evidenceUrl });
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : '입력값을 확인해 주세요.');
      return;
    }

    const token = hqToken.trim();
    if (!token) {
      setError('이행조치 등록에는 HQ 인증 토큰이 필요합니다.');
      return;
    }

    try {
      await runExclusivePublicationOperation(operationLock, async () => {
        const saved = await resultImplementationUpsert(
          token,
          resultId,
          mutation.issue_id,
          mutation.implementation,
        );
        if (saved.notice || !saved.data) {
          setError(saved.notice ?? '이행조치 저장 응답을 확인하지 못했습니다.');
          return;
        }
        const fetched = await resultGet(resultToken);
        if (fetched.notice || !fetched.data) {
          setError(fetched.notice ?? '저장 후 공개 결과를 재조회하지 못했습니다.');
          return;
        }
        const verification = verifyImplementationMutation(fetched.data.body, mutation);
        if (!verification.ok) {
          setError(verification.error);
          return;
        }
        onVerified(fetched.data.body);
        setNotice('기관 이행조치 저장·공개 재조회 검증을 완료했습니다.');
      }, setBusy);
    } catch (requestError) {
      console.error('Failed to save implementation response', requestError);
      setError('이행조치 저장 중 예상하지 못한 오류가 발생했습니다.');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', border: `2px solid ${LINE}`, borderRadius: 10,
    padding: '10px 11px', color: INK, background: '#fff', font: 'inherit', fontSize: 14,
  };

  if (issues.length === 0) {
    return (
      <section aria-label="기관 이행조치 등록" style={{ marginTop: 18, border: `2px solid ${AMBER}`, borderRadius: 16, background: PANEL, padding: 20 }}>
        <h3 style={{ margin: '0 0 6px', color: NAVY, fontSize: 19 }}>기관 이행조치 직접 등록</h3>
        <p style={{ margin: 0, color: AMBER, fontWeight: 700 }}>검수 완료된 공개 권고가 없어 등록할 수 없습니다.</p>
      </section>
    );
  }

  return (
    <section aria-label="기관 이행조치 등록" aria-busy={busy} style={{ marginTop: 18, border: `2px solid ${TEAL}`, borderRadius: 16, background: '#fff', padding: 20 }}>
      <h3 style={{ margin: '0 0 6px', color: NAVY, fontSize: 19 }}>기관 이행조치 직접 등록</h3>
      <p style={{ margin: '0 0 14px', color: MUTED, fontSize: 13, lineHeight: 1.55 }}>
        관계 기관의 공개 답변을 권고에 연결합니다. 저장 후 공개 페이지를 다시 읽어 같은 값이 확인되어야 완료됩니다.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
        <label>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 5 }}>대상 권고</span>
          <select value={issueId} disabled={busy} onChange={(event) => chooseIssue(event.target.value)} style={inputStyle}>
            {issues.map((issue) => <option key={issue.id} value={issue.id}>{issue.label}</option>)}
          </select>
        </label>
        <label>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 5 }}>이행 상태</span>
          <select value={status} disabled={busy} onChange={(event) => {
            if (isImplementationStatus(event.target.value)) setStatus(event.target.value);
          }} style={inputStyle}>
            {IMPLEMENTATION_STATUSES.map((value) => (
              <option key={value} value={value}>{implementationStatusContract.states[value].label}</option>
            ))}
          </select>
        </label>
        <label>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 5 }}>책임 기관</span>
          <input value={responsibleBody} disabled={busy} maxLength={implementationStatusContract.record.responsibleBodyMaxLength} onChange={(event) => setResponsibleBody(event.target.value)} style={inputStyle} />
        </label>
        <label>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 5 }}>기관 갱신 시각</span>
          <input type="datetime-local" value={updatedAt} disabled={busy} onChange={(event) => setUpdatedAt(event.target.value)} style={inputStyle} />
        </label>
        <label>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 5 }}>공개 설명</span>
          <textarea value={summary} disabled={busy} maxLength={implementationStatusContract.record.summaryMaxLength} rows={4} onChange={(event) => setSummary(event.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
        </label>
        <label>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 5 }}>공개 근거 URL</span>
          <input type="url" value={evidenceUrl} disabled={busy} maxLength={implementationStatusContract.record.evidenceUrlMaxLength} placeholder="https://…" onChange={(event) => setEvidenceUrl(event.target.value)} style={inputStyle} />
          <small style={{ display: 'block', color: MUTED, marginTop: 4 }}>이행 완료·미이행 사유 공개는 HTTPS 근거가 필수입니다.</small>
        </label>
      </div>

      <button type="button" onClick={save} disabled={busy} style={{ marginTop: 14, border: 0, borderRadius: 10, background: busy ? '#AABBC5' : NAVY, color: '#fff', padding: '11px 18px', fontSize: 15, fontWeight: 800, cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? '저장·재조회 중…' : '이행조치 저장 및 공개 확인'}
      </button>
      {error ? <p role="alert" style={{ color: RED, fontWeight: 700, margin: '12px 0 0' }}>{error}</p> : null}
      {notice ? <p role="status" aria-live="polite" style={{ color: GREEN, fontWeight: 700, margin: '12px 0 0' }}>{notice}</p> : null}
    </section>
  );
}
