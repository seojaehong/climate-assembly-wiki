import { useEffect, useRef, useState } from 'react';
import {
  readinessCheck,
  type PlatformResult,
  type ReadinessResult,
} from '../../../lib/platform';
import type { SessionTarget } from '../platform-nav-logic';
import {
  buildDesignView,
  type DesignScope,
  type DesignView,
} from './design-console-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';
const GREEN = '#2F6F25';
const GREEN_BG = '#E3F1E6';
const AMBER = '#7A4500';
const AMBER_BG = '#FFF1D6';

type ReadinessLoader = (sessionId: string) => Promise<PlatformResult<ReadinessResult>>;

export async function loadScopedReadiness(
  scope: DesignScope,
  sessions: readonly SessionTarget[],
  loader: ReadinessLoader = readinessCheck,
): Promise<PlatformResult<DesignView>> {
  const responses = await Promise.all(sessions.map(async (target) => ({
    target,
    response: await loader(target.id),
  })));
  const results = [];
  for (const { target, response } of responses) {
    if (!response.data) {
      if (!response.notice) console.error('Readiness request returned no data or notice', target.id);
      return {
        data: null,
        notice: response.notice
          ? `${target.label}: ${response.notice}`
          : `${target.label}: 준비도를 불러오지 못했습니다.`,
      };
    }
    results.push({ target, result: response.data });
  }
  return { data: buildDesignView(scope, results), notice: null };
}

export async function completeReadinessLoad(
  action: () => Promise<PlatformResult<DesignView>>,
  isCurrent: () => boolean,
  onBusyChange: (busy: boolean) => void,
  onViewChange: (view: DesignView | null) => void,
  onNoticeChange: (notice: string | null) => void,
): Promise<boolean> {
  onBusyChange(true);
  try {
    const result = await action();
    if (!isCurrent()) return false;
    onViewChange(result.data);
    onNoticeChange(result.notice);
    if (!result.data && !result.notice) {
      console.error('Readiness request returned no data or notice');
      onNoticeChange('준비도를 불러오지 못했습니다.');
    }
    return Boolean(result.data);
  } catch (error: unknown) {
    if (!isCurrent()) return false;
    console.error('Failed to load scoped readiness', error);
    onNoticeChange('준비도를 불러오는 중 예상하지 못한 오류가 발생했습니다.');
    return false;
  } finally {
    if (isCurrent()) onBusyChange(false);
  }
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div aria-label={`${label} ${value}개`} style={{ border: `2px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: '14px 16px' }}>
      <div style={{ color: MUTED, fontSize: 13, fontWeight: 700 }}>{label}</div>
      <div style={{ color: NAVY, fontSize: 24, fontWeight: 800, marginTop: 4 }}>{value}개</div>
    </div>
  );
}

export function DesignResults({ view }: { view: DesignView }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p role="status" aria-live="polite" className="sr-only">
        준비도 확인을 완료했습니다. 회차 {view.stats.sessionCount}개 중 {view.stats.readyCount}개가 준비 완료입니다.
      </p>
      <section aria-label="준비도 요약" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <StatCard label="회차" value={view.stats.sessionCount} />
        <StatCard label="준비 완료" value={view.stats.readyCount} />
        <StatCard label="확인 필요" value={view.stats.blockedCount} />
      </section>

      {view.sessions.map((session) => (
        <section key={session.id} aria-labelledby={`readiness-${session.id}`} style={{ border: `2px solid ${LINE}`, borderRadius: 16, background: '#fff', overflow: 'hidden' }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', background: PANEL }}>
            <h3 id={`readiness-${session.id}`} style={{ color: NAVY, fontSize: 18, fontWeight: 800, margin: 0 }}>{session.label}</h3>
            <span style={{ color: session.ready ? GREEN : AMBER, background: session.ready ? GREEN_BG : AMBER_BG, border: `2px solid ${session.ready ? GREEN : AMBER}`, borderRadius: 999, padding: '4px 10px', fontSize: 13, fontWeight: 800 }}>
              {session.ready ? '준비 완료' : '확인 필요'}
            </span>
          </header>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <caption className="sr-only">{session.label} 준비도 검사 상세</caption>
              <thead>
                <tr>
                  {['검사 항목', '상태', '근거'].map((label) => (
                    <th key={label} scope="col" style={{ color: NAVY, fontSize: 13, textAlign: 'left', padding: '10px 14px', borderTop: `2px solid ${LINE}`, borderBottom: `2px solid ${LINE}` }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {session.checks.map((check) => (
                  <tr key={check.key}>
                    <th scope="row" style={{ color: INK, fontSize: 14, textAlign: 'left', padding: 12, borderBottom: `2px solid ${PANEL}` }}>{check.label}</th>
                    <td style={{ color: check.kind === 'informational' ? NAVY : check.pass ? GREEN : AMBER, fontWeight: 800, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{check.statusLabel}</td>
                    <td style={{ color: MUTED, padding: 12, borderBottom: `2px solid ${PANEL}` }}>{check.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>최종 제출 현황은 운영 정보이며 준비 완료 판정에는 포함되지 않습니다.</p>
    </div>
  );
}

export default function DesignConsole({
  scope,
  sessions,
}: {
  scope: DesignScope;
  sessions: readonly SessionTarget[];
}) {
  const [view, setView] = useState<DesignView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const requestGeneration = useRef(0);
  const scopeKey = `${scope}:${sessions.map((session) => session.id).join(',')}`;

  useEffect(() => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    if (sessions.length > 0) {
      void completeReadinessLoad(
        () => loadScopedReadiness(scope, sessions),
        () => requestGeneration.current === generation,
        setBusy,
        setView,
        setNotice,
      );
    } else {
      setBusy(false);
      setView(null);
      setNotice(null);
    }
    return () => { requestGeneration.current += 1; };
  }, [scopeKey, retry]);

  if (sessions.length === 0) {
    return (
      <div role="status" aria-live="polite" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
        이 {scope === 'assembly' ? '공론화' : '회차'}에 준비도를 확인할 회차가 없습니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18 }} aria-busy={busy}>
      <header>
        <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase' }}>{scope === 'assembly' ? 'Assembly' : 'Session'} · Design</div>
        <h2 style={{ color: NAVY, fontSize: 24, fontWeight: 800, margin: '6px 0' }}>운영 준비도</h2>
        <p style={{ color: MUTED, fontSize: 15, margin: 0 }}>공개 주제, 활성 조, 참여자 배정 상태를 읽기 전용으로 확인합니다.</p>
      </header>

      {busy ? <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>준비도를 확인하는 중…</p> : null}
      {notice ? (
        <div role="alert" style={{ border: `2px solid ${AMBER}`, borderRadius: 14, background: AMBER_BG, color: AMBER, padding: 16 }}>
          <p style={{ margin: '0 0 10px', fontWeight: 700 }}>{notice}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)} style={{ border: `2px solid ${AMBER}`, borderRadius: 8, background: '#fff', color: AMBER, padding: '7px 12px', fontWeight: 800 }}>다시 확인</button>
        </div>
      ) : null}
      {view ? <DesignResults view={view} /> : null}
      <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>공론화·회차·주제 생성은 P3 데이터 모델 활성화 후 제공됩니다.</p>
    </div>
  );
}
