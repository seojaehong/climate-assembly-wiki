import { useRef, useState } from 'react';
import { resultGet, resultPublish, resultUnpublish } from '../../../lib/platform';
import type { ScopeLevel } from '../platform-nav-logic';
import {
  buildPublicResultUrl,
  readStoredHqToken,
  runExclusivePublicationOperation,
  validatePublishInput,
  verifyPublishedResult,
} from './publish-console-logic';
import ImplementationConsole from './ImplementationConsole';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const GREEN = '#397D2A';
const AMBER = '#9A5B00';
const RED = '#B42318';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F5F9FB';

interface Publication {
  id: string;
  token: string;
  title: string;
  url: string;
  publishedAt: string;
  reviewedCount: number;
  verified: boolean;
  body: unknown;
}

interface Props {
  scope: ScopeLevel | null;
  scopeId: string | null;
}

export function CopyAnnouncement({ copied }: { copied: boolean }) {
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {copied ? '공개 결과 URL을 클립보드에 복사했습니다.' : ''}
    </p>
  );
}

function scopeLabel(scope: ScopeLevel | null): string {
  if (scope === 'topic') return '주제';
  if (scope === 'session') return '회차';
  if (scope === 'assembly') return '공론화';
  return '미선택';
}

function formatPublishedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

function initialHqToken(): string {
  return readStoredHqToken(
    () => (typeof window === 'undefined' ? null : window.sessionStorage),
    (storageError) => console.error('Failed to read stored HQ token', storageError),
  );
}

export default function PublishConsole({ scope, scopeId }: Props) {
  const [hqToken, setHqToken] = useState(initialHqToken);
  const [title, setTitle] = useState('');
  const [publication, setPublication] = useState<Publication | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const operationLock = useRef(false);

  const publish = async () => {
    if (busy || operationLock.current) return;
    setError(null);
    setNotice(null);
    setCopied(false);

    const validation = validatePublishInput({ hqToken, title, scope, scopeId });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    try {
      await runExclusivePublicationOperation(operationLock, async () => {
        const input = validation.value;
        const published = await resultPublish(input.hqToken, input.scope, input.scopeId, input.title);
        if (published.notice || !published.data) {
          setError(published.notice ?? '발행 응답을 확인하지 못했습니다.');
          return;
        }

        const origin = window.location.origin;
        const nextPublication: Publication = {
          id: published.data.id,
          token: published.data.token,
          title: input.title,
          url: buildPublicResultUrl(published.data.token, origin),
          publishedAt: published.data.published_at,
          reviewedCount: published.data.reviewed_count,
          verified: false,
          body: null,
        };
        setPublication(nextPublication);

        const fetched = await resultGet(published.data.token);
        if (fetched.notice || !fetched.data) {
          setNotice(`발행 응답은 받았지만 공개 조회를 재확인하지 못했습니다: ${fetched.notice ?? '공개 결과가 없습니다.'}`);
          return;
        }

        const verification = verifyPublishedResult(
          { scope: input.scope, scopeId: input.scopeId, title: input.title },
          fetched.data,
        );
        if (!verification.ok) {
          setNotice(`발행 응답은 받았지만 공개 조회 검증이 완료되지 않았습니다: ${verification.error}`);
          return;
        }

        setPublication({ ...nextPublication, verified: true, body: fetched.data.body });
        setNotice(`공개 완료·재조회 검증 완료 · 검수 완료 쟁점 ${published.data.reviewed_count}건`);
      }, setBusy);
    } catch (requestError) {
      console.error('Failed to publish result', requestError);
      setError('결과 발행 중 예상하지 못한 오류가 발생했습니다.');
    }
  };

  const unpublish = async () => {
    if (busy || operationLock.current || !publication) return;
    const token = hqToken.trim();
    if (!token) {
      setError('공개 해제에도 HQ 인증 토큰이 필요합니다.');
      return;
    }

    setError(null);
    setNotice(null);
    setCopied(false);
    try {
      await runExclusivePublicationOperation(operationLock, async () => {
        const unpublished = await resultUnpublish(token, publication.id);
        if (unpublished.notice || !unpublished.data) {
          setError(unpublished.notice ?? '공개 해제 응답을 확인하지 못했습니다.');
          return;
        }

        const fetched = await resultGet(publication.token);
        if (fetched.notice) {
          setNotice(`공개 해제 응답은 받았지만 비공개 상태를 재확인하지 못했습니다: ${fetched.notice}`);
          return;
        }
        if (fetched.data !== null) {
          setError('공개 해제 후에도 결과가 조회됩니다. 운영자가 상태를 확인해 주세요.');
          return;
        }

        setPublication(null);
        setNotice('공개 해제·비공개 재조회 검증을 완료했습니다.');
      }, setBusy);
    } catch (requestError) {
      console.error('Failed to unpublish result', requestError);
      setError('공개 해제 중 예상하지 못한 오류가 발생했습니다.');
    }
  };

  const copyUrl = async () => {
    if (!publication) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(publication.url);
      setCopied(true);
    } catch (copyError) {
      console.error('Failed to copy public result URL', copyError);
      setError('링크를 복사하지 못했습니다. URL을 직접 선택해 복사해 주세요.');
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', border: `2px solid ${LINE}`, borderRadius: 10,
    padding: '11px 12px', color: INK, background: '#fff', font: 'inherit', fontSize: 15,
  };

  return (
    <div aria-busy={busy} style={{ maxWidth: 860 }}>
      <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase', marginBottom: 8 }}>
        {scopeLabel(scope)} · 공개 운영
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 800, color: NAVY, margin: '0 0 6px' }}>검수 결과 발행</h2>
      <p style={{ color: MUTED, fontSize: 15, lineHeight: 1.6, margin: '0 0 18px' }}>
        검수 완료 쟁점이 있는 현재 스코프를 스냅샷으로 발행합니다. AI는 초안을 만들고, 공개 여부와 최종 표현은 운영진이 결정합니다.
      </p>

      <section aria-label="공개 설정" style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>
          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 5 }}>HQ 인증 토큰</span>
            <input
              type="password"
              autoComplete="off"
              disabled={busy}
              value={hqToken}
              onChange={(event) => setHqToken(event.target.value)}
              placeholder="HQ 로그인 후 발급된 토큰"
              style={inputStyle}
            />
            <small style={{ display: 'block', color: MUTED, fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>
              현재 브라우저의 /hq 세션 토큰을 자동으로 불러옵니다. 없거나 만료된 경우에만 직접 입력하세요.
            </small>
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 5 }}>공개 결과 제목</span>
            <input
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 2026 기후시민회의 5차 주제별 결과"
              style={inputStyle}
            />
          </label>
        </div>

        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', margin: '16px 0', padding: 14, borderRadius: 12, background: PANEL, fontSize: 13 }}>
          <dt style={{ color: MUTED }}>선택 스코프</dt><dd style={{ margin: 0, color: NAVY, fontWeight: 700 }}>{scopeLabel(scope)}</dd>
          <dt style={{ color: MUTED }}>스코프 ID</dt><dd style={{ margin: 0, color: INK, fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{scopeId ?? '—'}</dd>
        </dl>

        <button
          type="button"
          onClick={publish}
          disabled={busy || !scope || !scopeId}
          style={{ border: 0, borderRadius: 10, background: busy || !scope || !scopeId ? '#AABBC5' : NAVY, color: '#fff', padding: '11px 18px', fontSize: 15, fontWeight: 800, cursor: busy ? 'wait' : 'pointer' }}
        >
          {busy ? '처리 중…' : publication ? '최신 검수 결과로 재발행' : '검수 결과 발행'}
        </button>
      </section>

      {error ? <p role="alert" style={{ color: RED, fontWeight: 700, margin: '14px 0 0' }}>{error}</p> : null}
      {notice ? <p role="status" aria-live="polite" style={{ color: notice.includes('못') || notice.includes('완료되지') ? AMBER : GREEN, fontWeight: 700, margin: '14px 0 0' }}>{notice}</p> : null}
      <CopyAnnouncement copied={copied} />

      {publication ? (
        <><section aria-label="발행된 결과" style={{ marginTop: 18, border: `2px solid ${publication.verified ? GREEN : AMBER}`, borderRadius: 16, background: '#fff', padding: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <h3 style={{ margin: 0, color: NAVY, fontSize: 19 }}>{publication.title}</h3>
            <span style={{ borderRadius: 999, padding: '3px 9px', color: '#fff', background: publication.verified ? GREEN : AMBER, fontSize: 12, fontWeight: 800 }}>
              {publication.verified ? '공개 재조회 검증 완료' : '공개 재조회 확인 필요'}
            </span>
          </div>
          <p style={{ margin: '0 0 10px', color: MUTED, fontSize: 13 }}>
            {formatPublishedAt(publication.publishedAt)} · 검수 완료 쟁점 {publication.reviewedCount}건
          </p>
          <input aria-label="공개 결과 URL" readOnly value={publication.url} onFocus={(event) => event.currentTarget.select()} style={{ ...inputStyle, fontFamily: 'monospace' }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button type="button" onClick={copyUrl} style={{ border: `2px solid ${TEAL}`, borderRadius: 9, background: '#fff', color: TEAL, padding: '9px 13px', fontWeight: 800, cursor: 'pointer' }}>
              {copied ? '복사됨' : '링크 복사'}
            </button>
            <a href={publication.url} target="_blank" rel="noreferrer" style={{ borderRadius: 9, background: TEAL, color: '#fff', padding: '9px 13px', fontWeight: 800, textDecoration: 'none' }}>
              새 창에서 공개 페이지 확인
            </a>
            <button type="button" onClick={unpublish} disabled={busy} style={{ border: `2px solid ${RED}`, borderRadius: 9, background: '#fff', color: RED, padding: '9px 13px', fontWeight: 800, cursor: busy ? 'wait' : 'pointer' }}>
              공개 해제
            </button>
          </div>
        </section>
        {publication.verified ? (
          <ImplementationConsole
            hqToken={hqToken}
            resultId={publication.id}
            resultToken={publication.token}
            resultBody={publication.body}
            onVerified={(body) => setPublication((current) => current ? { ...current, body } : current)}
          />
        ) : null}</>
      ) : null}
    </div>
  );
}
