import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  readinessCheck,
  type PlatformResult,
  type ReadinessResult,
} from '../../../lib/platform';
import type { SessionTarget } from '../platform-nav-logic';
import { downloadBlob } from '../../mod/svg-to-png';
import {
  buildDesignBlueprint,
  buildDesignView,
  DESIGN_BLUEPRINT_LIMITS,
  parseDesignBlueprintImport,
  serializeDesignBlueprint,
  type DesignBlueprint,
  type DesignBlueprintDownload,
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
const RED = '#9B2C2C';
const RED_BG = '#FDECEC';

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

interface DesignSessionDraft {
  title: string;
  slug: string;
  heldOn: string;
  topicsText: string;
  teamCount: string;
  participantCount: string;
}

type BlueprintDownloader = (blob: Blob, fileName: string) => void;
export type DesignBlueprintTransferState = { kind: 'status' | 'error'; text: string } | null;

const EMPTY_SESSION: DesignSessionDraft = {
  title: '',
  slug: '',
  heldOn: '',
  topicsText: '',
  teamCount: '',
  participantCount: '',
};

export function downloadDesignBlueprint(
  download: DesignBlueprintDownload,
  downloader: BlueprintDownloader = downloadBlob,
): void {
  downloader(new Blob([download.content], { type: 'application/json;charset=utf-8' }), download.filename);
}

export function completeDesignBlueprintExport(
  action: () => void,
  onStateChange: (state: Exclude<DesignBlueprintTransferState, null>) => void,
): boolean {
  try {
    action();
    onStateChange({ kind: 'status', text: '설계 청사진 JSON 파일을 내려받았습니다.' });
    return true;
  } catch (error: unknown) {
    console.error('Failed to download design blueprint', error);
    onStateChange({ kind: 'error', text: '설계 청사진 파일을 만들지 못했습니다. 다시 시도해 주세요.' });
    return false;
  }
}

function toSessionInput(session: DesignSessionDraft) {
  return {
    title: session.title,
    slug: session.slug,
    heldOn: session.heldOn,
    topics: session.topicsText.trim() ? session.topicsText.split(/\r?\n/) : [],
    teamCount: Number(session.teamCount),
    participantCount: Number(session.participantCount),
  };
}

function handleBlueprintTableKey(event: KeyboardEvent<HTMLDivElement>) {
  const region = event.currentTarget;
  if (event.key === 'ArrowRight') region.scrollLeft += 40;
  else if (event.key === 'ArrowLeft') region.scrollLeft -= 40;
  else if (event.key === 'End') region.scrollLeft = region.scrollWidth;
  else if (event.key === 'Home') region.scrollLeft = 0;
  else return;
  event.preventDefault();
}

export function BlueprintPreview({ blueprint }: { blueprint: DesignBlueprint }) {
  return (
    <section aria-labelledby="design-blueprint-preview" style={{ display: 'grid', gap: 12, border: `2px solid ${TEAL}`, borderRadius: 16, background: PANEL, padding: 16 }}>
      <h4 id="design-blueprint-preview" style={{ color: NAVY, fontSize: 18, margin: 0 }}>승인 검토용 미리보기</h4>
      <p style={{ color: MUTED, margin: 0 }}>
        회차 {blueprint.stats.sessionCount}개 · 주제 {blueprint.stats.topicCount}개 · 조 {blueprint.stats.teamCount}개 · 예상 참여자 {blueprint.stats.participantCount}명
      </p>
      <div
        role="region"
        aria-label="설계 청사진 회차별 구성 표"
        tabIndex={0}
        onKeyDown={handleBlueprintTableKey}
        style={{ overflowX: 'auto', background: '#fff', border: `2px solid ${LINE}`, borderRadius: 12 }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <caption className="sr-only">설계 청사진 회차별 구성</caption>
          <thead>
            <tr>
              {['회차', '식별자', '날짜', '주제', '조별 계획 인원'].map((label) => (
                <th key={label} scope="col" style={{ color: NAVY, textAlign: 'left', padding: 10, borderBottom: `2px solid ${LINE}` }}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {blueprint.sessions.map((session) => (
              <tr key={session.ordinal}>
                <th scope="row" style={{ color: INK, textAlign: 'left', padding: 10, borderBottom: `2px solid ${PANEL}` }}>{session.title}</th>
                <td style={{ color: INK, padding: 10, borderBottom: `2px solid ${PANEL}` }}><code>{session.slug}</code></td>
                <td style={{ color: INK, padding: 10, borderBottom: `2px solid ${PANEL}` }}>{session.heldOn}</td>
                <td style={{ color: INK, padding: 10, borderBottom: `2px solid ${PANEL}` }}>{session.topics.map((topic) => topic.prompt).join(' / ')}</td>
                <td style={{ color: INK, padding: 10, borderBottom: `2px solid ${PANEL}` }}>{session.teams.map((team) => `${team.name} ${team.plannedCapacity}명`).join(' / ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DesignBlueprintBuilder() {
  const [assemblyTitle, setAssemblyTitle] = useState('');
  const [assemblySlug, setAssemblySlug] = useState('');
  const [sessions, setSessions] = useState<DesignSessionDraft[]>([{ ...EMPTY_SESSION }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [blueprint, setBlueprint] = useState<DesignBlueprint | null>(null);
  const [transferState, setTransferState] = useState<DesignBlueprintTransferState>(null);
  const importGeneration = useRef(0);

  const invalidatePreview = () => {
    importGeneration.current += 1;
    setBlueprint(null);
    setErrors([]);
    setTransferState(null);
  };

  const updateSession = (index: number, patch: Partial<DesignSessionDraft>) => {
    setSessions((current) => current.map((session, sessionIndex) => (
      sessionIndex === index ? { ...session, ...patch } : session
    )));
    invalidatePreview();
  };

  const validate = () => {
    importGeneration.current += 1;
    const result = buildDesignBlueprint({
      assemblyTitle,
      assemblySlug,
      sessions: sessions.map(toSessionInput),
    });
    setTransferState(null);
    if (!result.ok) {
      setBlueprint(null);
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setBlueprint(result.blueprint);
  };

  const onDownload = () => {
    if (!blueprint) return;
    completeDesignBlueprintExport(
      () => downloadDesignBlueprint(serializeDesignBlueprint(blueprint)),
      setTransferState,
    );
  };

  const onImport = async (file: File) => {
    const generation = importGeneration.current + 1;
    importGeneration.current = generation;
    try {
      if (file.size > DESIGN_BLUEPRINT_LIMITS.importBytes) {
        console.error('Failed to import design blueprint: file exceeds the safe size limit');
        setTransferState({ kind: 'error', text: '청사진 JSON 형식 또는 내용이 올바르지 않습니다.' });
        return;
      }
      const content = await file.text();
      if (importGeneration.current !== generation) return;
      const imported = parseDesignBlueprintImport(content);
      if (!imported.ok) {
        console.error('Failed to import design blueprint: validation rejected the file');
        setTransferState({ kind: 'error', text: imported.error });
        return;
      }
      setAssemblyTitle(imported.input.assemblyTitle);
      setAssemblySlug(imported.input.assemblySlug);
      setSessions(imported.input.sessions.map((session) => ({
        title: session.title ?? '',
        slug: session.slug ?? '',
        heldOn: session.heldOn,
        topicsText: session.topics.join('\n'),
        teamCount: String(session.teamCount),
        participantCount: String(session.participantCount),
      })));
      setErrors([]);
      setBlueprint(imported.blueprint);
      setTransferState({ kind: 'status', text: '청사진 JSON을 불러왔습니다. 내용을 확인하고 편집을 이어가세요.' });
    } catch (error: unknown) {
      if (importGeneration.current !== generation) return;
      console.error('Failed to import design blueprint', error);
      setTransferState({ kind: 'error', text: '청사진 파일을 읽지 못했습니다. 다시 시도해 주세요.' });
    }
  };

  const inputStyle = { minHeight: 44, width: '100%', border: `2px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', color: INK, background: '#fff' };

  return (
    <section aria-labelledby="design-blueprint-title" style={{ display: 'grid', gap: 16, border: `2px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 18 }}>
      <header>
        <h3 id="design-blueprint-title" style={{ color: NAVY, fontSize: 20, margin: 0 }}>설계 청사진</h3>
        <p style={{ color: MUTED, margin: '6px 0 0' }}>DB를 변경하지 않으며 실제 생성에는 별도 승인이 필요합니다.</p>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        <label style={{ color: INK, fontWeight: 700 }}>공론화 이름
          <input value={assemblyTitle} maxLength={DESIGN_BLUEPRINT_LIMITS.assemblyTitleChars} onChange={(event) => { setAssemblyTitle(event.target.value); invalidatePreview(); }} style={inputStyle} />
        </label>
        <label style={{ color: INK, fontWeight: 700 }}>공론화 slug
          <input value={assemblySlug} maxLength={40} onChange={(event) => { setAssemblySlug(event.target.value); invalidatePreview(); }} placeholder="climate-2026" style={inputStyle} />
        </label>
      </div>

      {sessions.map((session, index) => (
        <fieldset key={index} style={{ display: 'grid', gap: 12, border: `2px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
          <legend style={{ color: NAVY, fontWeight: 800, padding: '0 6px' }}>제{index + 1}회차</legend>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
            <label style={{ color: INK, fontWeight: 700 }}>회차 이름
              <input value={session.title} maxLength={DESIGN_BLUEPRINT_LIMITS.sessionTitleChars} onChange={(event) => updateSession(index, { title: event.target.value })} placeholder={`제${index + 1}회차`} style={inputStyle} />
            </label>
            <label style={{ color: INK, fontWeight: 700 }}>회차 slug
              <input value={session.slug} maxLength={40} onChange={(event) => updateSession(index, { slug: event.target.value })} placeholder={`${assemblySlug || 'assembly'}-session-${index + 1}`} style={inputStyle} />
            </label>
            <label style={{ color: INK, fontWeight: 700 }}>회차 날짜
              <input type="date" value={session.heldOn} onChange={(event) => updateSession(index, { heldOn: event.target.value })} style={inputStyle} />
            </label>
            <label style={{ color: INK, fontWeight: 700 }}>조 수
              <input type="number" min="1" max={DESIGN_BLUEPRINT_LIMITS.teamsPerSession} step="1" value={session.teamCount} onChange={(event) => updateSession(index, { teamCount: event.target.value })} style={inputStyle} />
            </label>
            <label style={{ color: INK, fontWeight: 700 }}>예상 참여자 수
              <input type="number" min="1" max={DESIGN_BLUEPRINT_LIMITS.participantsPerSession} step="1" value={session.participantCount} onChange={(event) => updateSession(index, { participantCount: event.target.value })} style={inputStyle} />
            </label>
          </div>
          <label style={{ color: INK, fontWeight: 700 }}>주제 (한 줄에 하나)
            <textarea value={session.topicsText} maxLength={DESIGN_BLUEPRINT_LIMITS.topicsTextChars} onChange={(event) => updateSession(index, { topicsText: event.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </label>
          {sessions.length > 1 ? (
            <button type="button" onClick={() => { setSessions((current) => current.filter((_, sessionIndex) => sessionIndex !== index)); invalidatePreview(); }} style={{ justifySelf: 'start', minHeight: 40, border: `2px solid ${RED}`, borderRadius: 8, background: '#fff', color: RED, padding: '6px 12px', fontWeight: 800 }}>이 회차 삭제</button>
          ) : null}
        </fieldset>
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <label style={{ display: 'grid', gap: 4, color: INK, fontWeight: 700 }}>
          청사진 JSON 불러오기
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void onImport(file);
            }}
            style={{ color: MUTED, minHeight: 44, maxWidth: 320 }}
          />
        </label>
        <button type="button" disabled={sessions.length >= DESIGN_BLUEPRINT_LIMITS.sessions} onClick={() => { setSessions((current) => [...current, { ...EMPTY_SESSION }]); invalidatePreview(); }} style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 9, background: '#fff', color: TEAL, padding: '8px 14px', fontWeight: 800 }}>회차 추가</button>
        <button type="button" onClick={validate} style={{ minHeight: 44, border: `2px solid ${TEAL}`, borderRadius: 9, background: TEAL, color: '#fff', padding: '8px 14px', fontWeight: 800 }}>청사진 검증</button>
        {blueprint ? <button type="button" onClick={onDownload} aria-describedby="design-blueprint-transfer-status" style={{ minHeight: 44, border: `2px solid ${GREEN}`, borderRadius: 9, background: GREEN, color: '#fff', padding: '8px 14px', fontWeight: 800 }}>JSON 내려받기</button> : null}
      </div>

      {errors.length > 0 ? (
        <div role="alert" style={{ border: `2px solid ${RED}`, borderRadius: 12, background: RED_BG, color: RED, padding: 14 }}>
          <strong>청사진을 확인해 주세요.</strong>
          <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      ) : null}
      {blueprint ? <BlueprintPreview blueprint={blueprint} /> : null}
      <p id="design-blueprint-transfer-status" role={transferState?.kind === 'error' ? 'alert' : 'status'} aria-live="polite" aria-atomic="true" style={{ color: transferState?.kind === 'error' ? RED : GREEN, fontWeight: 700, margin: 0 }}>{transferState?.text ?? ''}</p>
    </section>
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

  return (
    <div style={{ display: 'grid', gap: 18 }} aria-busy={busy}>
      <header>
        <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color: TEAL, textTransform: 'uppercase' }}>{scope === 'assembly' ? 'Assembly' : 'Session'} · Design</div>
        <h2 style={{ color: NAVY, fontSize: 24, fontWeight: 800, margin: '6px 0' }}>운영 준비도</h2>
        <p style={{ color: MUTED, fontSize: 15, margin: 0 }}>공개 주제, 활성 조, 참여자 배정 상태를 읽기 전용으로 확인합니다.</p>
      </header>

      {scope === 'assembly' ? <DesignBlueprintBuilder /> : null}

      {sessions.length === 0 ? (
        <div role="status" aria-live="polite" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, background: PANEL, padding: 20, color: MUTED }}>
          이 {scope === 'assembly' ? '공론화' : '회차'}에 준비도를 확인할 회차가 없습니다.
        </div>
      ) : null}
      {busy ? <p role="status" aria-live="polite" style={{ color: MUTED, margin: 0 }}>준비도를 확인하는 중…</p> : null}
      {notice ? (
        <div role="alert" style={{ border: `2px solid ${AMBER}`, borderRadius: 14, background: AMBER_BG, color: AMBER, padding: 16 }}>
          <p style={{ margin: '0 0 10px', fontWeight: 700 }}>{notice}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)} style={{ border: `2px solid ${AMBER}`, borderRadius: 8, background: '#fff', color: AMBER, padding: '7px 12px', fontWeight: 800 }}>다시 확인</button>
        </div>
      ) : null}
      {view ? <DesignResults view={view} /> : null}
      <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>청사진은 승인 검토용 JSON만 만들며 공론화·회차·주제의 실제 생성은 P3 데이터 모델 활성화 후 제공됩니다.</p>
    </div>
  );
}
