import { useState, useMemo } from 'react';
import QRCode from 'qrcode';
import { ReactFlow, Background, Controls, applyNodeChanges, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AgendaNode from './canvas/AgendaNode';
import ZoneFrameNode from './canvas/ZoneFrameNode';
import { useRealtimeAgendas } from './canvas/use-realtime-agendas';
import { useAuth } from './canvas/useAuth';
import { getSupabase } from '../lib/supabase';
import { BG_PRESETS, joColor, readableInk, groupColor } from './canvas/palette';
import { ZONE_FRAMES, FRAME_Y, FRAME_H, zoneForX } from './canvas/zones';
import {
  executeCanvasOperation,
  reconcileCommittedCanvasInsert,
  CanvasOperationProvider,
  type CanvasOperationResult,
  type CanvasOperationOptions,
  type CanvasWriteResponse,
} from './canvas/canvas-operation';
import type { CanvasConnectionState, CanvasConnectionStatus } from './canvas/canvas-connection';

const nodeTypes = { agenda: AgendaNode, zoneFrame: ZoneFrameNode };

// 카테고리 프레임(=zone) 노드 — 카드 뒤 배경, 비상호작용.
const FRAME_NODES = ZONE_FRAMES.map((f) => ({
  id: `frame-${f.zone}`, type: 'zoneFrame',
  position: { x: f.x, y: FRAME_Y },
  data: { label: f.label, w: f.w, h: FRAME_H, bg: f.bg },
  draggable: false, selectable: false, deletable: false, focusable: false,
  zIndex: -1,
}));
const BG_KEY = 'canvas-bg-hex';
const JO_KEY = 'canvas-jo-colors';

export function CanvasOperationNotice({
  result,
  retrying,
  retryAllowed,
  onRetry,
  onRefresh,
  onDismiss,
}: {
  result: CanvasOperationResult;
  retrying: boolean;
  retryAllowed: boolean;
  onRetry: () => void;
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role={result.kind}
      aria-live={result.kind === 'alert' ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        position: 'absolute', top: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 10, maxWidth: 'min(92vw, 680px)',
        padding: '12px 16px', borderRadius: 12,
        border: `2px solid ${result.ok ? '#2f6f25' : '#b42318'}`,
        background: result.ok ? '#e3f1e6' : '#fff1f0',
        color: result.ok ? '#24591d' : '#8f1d13', fontWeight: 800,
        boxShadow: '0 6px 18px rgba(0,0,0,.2)',
      }}
    >
      <span>{result.message}</span>
      {result.retry && (
        <button type="button" onClick={onRetry} disabled={retrying || !retryAllowed}>
          {retrying ? '재시도 중…' : retryAllowed ? '다시 시도' : '연결 후 재시도'}
        </button>
      )}
      {!result.ok && !result.retry && (
        <button type="button" onClick={onRefresh}>상태 새로고침</button>
      )}
      <button type="button" onClick={onDismiss} aria-label="알림 닫기">×</button>
    </div>
  );
}

export function CanvasConnectionNotice({
  connection,
  onRetry,
}: {
  connection: CanvasConnectionState;
  onRetry: () => void;
}) {
  const requiresAttention = connection.status === 'error' || connection.status === 'degraded';
  return (
    <div
      role={requiresAttention ? 'alert' : 'status'}
      aria-live={requiresAttention ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        position: 'absolute', bottom: 20, right: 16, zIndex: 30,
        display: 'flex', alignItems: 'center', gap: 8,
        maxWidth: 'min(88vw, 520px)', padding: '9px 12px', borderRadius: 10,
        border: `2px solid ${requiresAttention ? '#b42318' : '#2f6f25'}`,
        background: requiresAttention ? '#fff1f0' : '#e3f1e6',
        color: requiresAttention ? '#8f1d13' : '#24591d',
        fontSize: 13, fontWeight: 800, boxShadow: '0 4px 12px rgba(0,0,0,.18)',
      }}
    >
      <span>{connection.message}</span>
      {connection.status === 'error' && (
        <button type="button" onClick={onRetry}>다시 연결</button>
      )}
    </div>
  );
}

export function canWriteCanvas(authenticated: boolean, status: CanvasConnectionStatus): boolean {
  return authenticated && status === 'ready';
}

export function retainCanvasOperationNotice(
  current: CanvasOperationResult | null,
  incoming: CanvasOperationResult,
): CanvasOperationResult {
  return current && !current.ok && incoming.ok ? current : incoming;
}

type CanvasClient = NonNullable<ReturnType<typeof getSupabase>>;

function runCanvasWrite(
  label: string,
  write: (client: CanvasClient) => PromiseLike<CanvasWriteResponse>,
  options: CanvasOperationOptions = {},
): Promise<CanvasOperationResult> {
  const sb = getSupabase();
  return executeCanvasOperation(label, sb ? () => write(sb) : null, undefined, options);
}

function moveAgenda(node: { id: string; position: { x: number; y: number } }) {
  return runCanvasWrite('의제 이동', (sb) => sb.schema('climate_vote').from('agenda')
    .update({ x: node.position.x, y: node.position.y, zone: zoneForX(node.position.x), updated_at: new Date().toISOString() })
    .eq('id', node.id), {
    retryable: false,
    failureMessage: '의제 이동 결과를 확인하지 못했습니다. 상태를 새로고침한 뒤 다시 조정해 주세요.',
  });
}

function addAgenda(sessionId: string) {
  const id = crypto.randomUUID();
  const row = { id, session_id: sessionId, text: '새 의제', status: 'active', x: 80, y: 80, created_by: 'moderator' };
  return runCanvasWrite('의제 추가', async (sb) => reconcileCommittedCanvasInsert<Record<string, unknown>>(
    await sb.schema('climate_vote').from('agenda').insert(row),
    () => sb.schema('climate_vote').from('agenda')
      .select('id,session_id,text,status,x,y,created_by').eq('id', id).maybeSingle(),
    (existing) => Object.entries(row).every(([key, value]) => existing[key] === value),
  ));
}

function archiveAgendas(ids: string[]) {
  return runCanvasWrite('의제 보관', (sb) => sb.schema('climate_vote').from('agenda')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .in('id', ids));
}

function linkAgendas(sessionId: string, source: string, target: string) {
  const id = crypto.randomUUID();
  const row = { id, session_id: sessionId, source_id: source, target_id: target, created_by: 'moderator' };
  return runCanvasWrite('의제 연결', async (sb) => reconcileCommittedCanvasInsert<Record<string, unknown>>(
    await sb.schema('climate_vote').from('agenda_link').insert(row),
    () => sb.schema('climate_vote').from('agenda_link')
      .select('id,session_id,source_id,target_id,created_by').eq('id', id).maybeSingle(),
    (existing) => Object.entries(row).every(([key, value]) => existing[key] === value),
  ));
}
function unlinkAgendas(ids: string[]) {
  return runCanvasWrite('의제 연결 해제', (sb) => sb.schema('climate_vote').from('agenda_link').delete().in('id', ids));
}

async function createVoteRound(agendaTexts: string[]): Promise<{ id: string | null; result: CanvasOperationResult }> {
  const id = `AGV-${crypto.randomUUID()}`;
  const row = {
    id, title: '의제 평가 투표', description: '각 의제의 중요도를 5점 척도로 평가해 주세요.',
    type: 'SCALE_MULTI', options: agendaTexts,
    scale_low: 1, scale_high: 5, scale_low_label: '낮음', scale_high_label: '높음',
    status: 'pending', sort_order: 100,
  };
  const result = await runCanvasWrite('투표 생성', async (sb) => reconcileCommittedCanvasInsert<Record<string, unknown>>(
    await sb.schema('climate_vote').from('rounds').insert(row),
    () => sb.schema('climate_vote').from('rounds')
      .select('id,title,description,type,options,scale_low,scale_high,scale_low_label,scale_high_label,status,sort_order')
      .eq('id', id).maybeSingle(),
    (existing) => Object.entries(row).every(([key, value]) => (
      key === 'options'
        ? JSON.stringify(existing[key]) === JSON.stringify(value)
        : existing[key] === value
    )),
  ));
  return { id: result.ok ? id : null, result };
}

function setGroup(ids: string[], groupId: string | null) {
  return runCanvasWrite(groupId ? '의제 묶기' : '의제 묶음 해제', (sb) => sb.schema('climate_vote').from('agenda')
    .update({ group_id: groupId, updated_at: new Date().toISOString() })
    .in('id', ids), {
    retryable: false,
    failureMessage: '의제 묶음 결과를 확인하지 못했습니다. 상태를 새로고침한 뒤 다시 조정해 주세요.',
  });
}

function setParent(id: string, parentId: string) {
  return runCanvasWrite('실천과제 연결', (sb) => sb.schema('climate_vote').from('agenda')
    .update({ kind: 'action', parent_id: parentId, updated_at: new Date().toISOString() })
    .eq('id', id), {
    retryable: false,
    failureMessage: '실천과제 연결 결과를 확인하지 못했습니다. 상태를 새로고침한 뒤 다시 조정해 주세요.',
  });
}

// 배경 휘도에 맞는 그리드 점색.
function dotFor(bg: string): string {
  return readableInk(bg) === '#1f2937' ? '#cbd5e1' : '#475569';
}

export default function CanvasBoard({ sessionSlug }: { sessionSlug: string }) {
  const { nodes, setNodes, edges, sessionId, connection, retry: retryConnection } = useRealtimeAgendas(sessionSlug);
  const [operationResult, setOperationResult] = useState<CanvasOperationResult | null>(null);
  const [retryingOperation, setRetryingOperation] = useState(false);

  const completeOperation = async (operation: Promise<CanvasOperationResult>) => {
    const result = await operation;
    setOperationResult((current) => retainCanvasOperationNotice(current, result));
    return result;
  };

  const retryOperation = async () => {
    if (!writable || !operationResult?.retry || retryingOperation) return;
    setRetryingOperation(true);
    const result = await operationResult.retry();
    setOperationResult(result);
    setRetryingOperation(false);
  };

  // 진행자 인증 — 미인증 시 읽기전용(로그인 패널), 인증 시 쓰기 허용
  const { session, email, initializationError, signIn, signOut } = useAuth();
  const authed = !!session;
  const writable = canWriteCanvas(authed, connection.status);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const submitLogin = async () => {
    if (!loginEmail.trim() || !loginPw) return;
    setLoginErr(null);
    setLoggingIn(true);
    try {
      const { error } = await signIn(loginEmail.trim(), loginPw);
      if (error) setLoginErr(error.message);
    } finally {
      setLoggingIn(false);
    }
    // 성공 시 onAuthStateChange가 session을 채워 모달이 자동으로 사라짐
  };

  // 배경색 (프리셋 또는 커스텀 hex), localStorage 기억
  const [bgHex, setBgHex] = useState<string>(() => {
    try { return localStorage.getItem(BG_KEY) || BG_PRESETS[0].bg; } catch (error: unknown) {
      console.error('Canvas background preference load failed', error);
      return BG_PRESETS[0].bg;
    }
  });
  const setBg = (hex: string) => {
    setBgHex(hex);
    try { localStorage.setItem(BG_KEY, hex); } catch (error: unknown) {
      console.error('Canvas background preference save failed', error);
    }
  };

  // 조별 커스텀 색 override, localStorage 기억
  const [joColors, setJoColors] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(JO_KEY) || '{}'); } catch (error: unknown) {
      console.error('Canvas team color preference load failed', error);
      return {};
    }
  });
  const setJo = (jo: string, hex: string) => {
    setJoColors((prev) => {
      const next = { ...prev, [jo]: hex };
      try { localStorage.setItem(JO_KEY, JSON.stringify(next)); } catch (error: unknown) {
        console.error('Canvas team color preference save failed', error);
      }
      return next;
    });
  };

  // 현재 보드에 존재하는 조 목록
  const jos = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) { const j = (n.data.jo ?? '').trim(); if (j) s.add(j); }
    return [...s].sort();
  }, [nodes]);

  // 조별 확인 — 특정 조만 보기(focus). null=전체. zone(공간축)과 직교한 가시성 필터.
  const [focusJo, setFocusJo] = useState<string | null>(null);

  // 조별 색 + 그룹 테두리색 주입 + 조 필터(focus 외 숨김)
  const displayNodes = useMemo(() => nodes.map((n) => {
    const jo = (n.data.jo ?? '').trim();
    const cardBg = joColors[jo] ?? joColor(jo).bg;
    const gid = (n.data as { group_id?: string | null }).group_id;
    return {
      ...n,
      hidden: focusJo ? jo !== focusJo : false,
      data: {
        ...n.data,
        cardBg,
        cardInk: readableInk(cardBg),
        groupOutline: gid ? groupColor(gid) : null,
        writable,
      },
    };
  }), [nodes, joColors, focusJo, writable]);

  // 실천과제(action) → 부모 의제 점선 엣지
  const parentEdges = useMemo(() => nodes
    .filter((n) => (n.data as { parent_id?: string | null }).parent_id)
    .map((n) => ({
      id: `pe-${n.id}`, source: (n.data as { parent_id?: string }).parent_id as string, target: n.id,
      type: 'default', style: { stroke: '#7c3aed', strokeWidth: 2, strokeDasharray: '5 5' },
    })), [nodes]);

  const colorOf = (jo: string) => joColors[jo] ?? joColor(jo).bg;

  // 선택된 카드 + 묶기/해제 상태
  const selectedNodes = useMemo(() => nodes.filter((n) => (n as { selected?: boolean }).selected), [nodes]);
  const selectedIds = selectedNodes.map((n) => n.id);
  const [voteUrl, setVoteUrl] = useState<string | null>(null);

  // ✨ 임베딩 유사 의제 추천 (gte-small 코사인 유사도, edge function). 추천일 뿐 자동병합 없음.
  const [suggestions, setSuggestions] = useState<{ a: string; at: string; b: string; bt: string; sim: number }[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [simThreshold, setSimThreshold] = useState(0.88); // 짧은 한국어 baseline 높아 보수적 기본값
  const suggestMerges = async () => {
    setSuggesting(true);
    const agendas = nodes.map((n) => ({ id: n.id, text: (n.data as { label: string }).label }));
    let pairs: typeof suggestions = [];
    const result = await completeOperation(runCanvasWrite('유사 의제 분석', async (sb) => {
      const response = await sb.functions.invoke('suggest-merges', {
        body: { agendas, threshold: simThreshold },
      });
      pairs = (response.data as { pairs?: typeof suggestions } | null)?.pairs ?? [];
      return { error: response.error };
    }));
    setSuggesting(false);
    if (result.ok) setSuggestions(pairs);
  };

  // 🔍 앵커 KNN — 카드 1개만 선택 시, 그 카드 기준 최근접. 토글: 전수 코퍼스(173) | 현재 의제(부모추천)
  const anchor = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const anchorLabel = anchor ? (anchor.data as { label: string }).label : '';
  const anchorHasChildren = anchor
    ? nodes.some((n) => (n.data as { parent_id?: string | null }).parent_id === anchor.id)
    : false;
  const [knnTarget, setKnnTarget] = useState<'corpus' | 'agenda'>('corpus');
  const [knnCorpus, setKnnCorpus] = useState<{ source: string; title: string; category: string; similarity: number }[]>([]);
  const [knnAgenda, setKnnAgenda] = useState<{ id: string; text: string; sim: number }[]>([]);
  const [knnFor, setKnnFor] = useState<string | null>(null); // 결과가 어느 카드 것인지(앵커 바뀌면 옛 결과 숨김)
  const [knnLoading, setKnnLoading] = useState(false);
  const runKnn = async () => {
    if (!anchor) return;
    const query = (anchor.data as { label: string }).label;
    setKnnLoading(true);
    let corpusMatches: typeof knnCorpus = [];
    let agendaMatches: typeof knnAgenda = [];
    let result: CanvasOperationResult;
    if (knnTarget === 'corpus') {
      result = await completeOperation(runCanvasWrite('코퍼스 유사도 분석', async (sb) => {
        const response = await sb.functions.invoke('corpus-search', { body: { query, k: 8 } });
        corpusMatches = (response.data as { matches?: typeof knnCorpus } | null)?.matches ?? [];
        return { error: response.error };
      }));
    } else {
      // 후보 = 현재 캔버스의 의제(kind!=action) 중 자기 자신 제외 → 부모 후보
      const candidates = nodes
        .filter((n) => (n.data as { kind?: string | null }).kind !== 'action' && n.id !== anchor.id)
        .map((n) => ({ id: n.id, text: (n.data as { label: string }).label }));
      result = await completeOperation(runCanvasWrite('의제 유사도 분석', async (sb) => {
        const response = await sb.functions.invoke('agenda-knn', { body: { query, candidates, k: 6 } });
        agendaMatches = (response.data as { matches?: typeof knnAgenda } | null)?.matches ?? [];
        return { error: response.error };
      }));
    }
    setKnnLoading(false);
    if (!result.ok) return;
    if (knnTarget === 'corpus') setKnnCorpus(corpusMatches);
    else setKnnAgenda(agendaMatches);
    setKnnFor(anchor.id);
  };

  const [voteQr, setVoteQr] = useState<string | null>(null);
  const makeVote = async () => {
    const texts = selectedNodes.map((n) => (n.data as { label: string }).label);
    const { id, result } = await createVoteRound(texts);
    setOperationResult(result);
    if (id) {
      const u = `${window.location.origin}/v/?round=${id}`;
      setVoteUrl(u);
      await completeOperation(executeCanvasOperation('투표 QR 생성', async () => {
        const qr = await QRCode.toDataURL(u, { width: 200, margin: 1 });
        setVoteQr(qr);
        return { error: null };
      }));
    }
  };
  // 📲 참여 QR — 180명이 폰으로 /join 접속해 의제 제출
  const [joinQr, setJoinQr] = useState<string | null>(null);
  const showJoinQr = async () => {
    const u = `${window.location.origin}/ko/join?s=${sessionSlug}`;
    await completeOperation(executeCanvasOperation('참여 QR 생성', async () => {
      const qr = await QRCode.toDataURL(u, { width: 240, margin: 1 });
      setJoinQr(qr);
      return { error: null };
    }));
  };
  const copyVoteLink = async () => {
    const operation = navigator.clipboard
      ? async () => {
        await navigator.clipboard.writeText(voteUrl ?? '');
        return { error: null };
      }
      : null;
    await completeOperation(executeCanvasOperation('투표 링크 복사', operation));
  };

  const sharedGroup = selectedNodes.length >= 2
    && selectedNodes.every((n) => {
      const g = (n.data as { group_id?: string | null }).group_id;
      const g0 = (selectedNodes[0].data as { group_id?: string | null }).group_id;
      return g && g === g0;
    })
    ? (selectedNodes[0].data as { group_id?: string | null }).group_id ?? null
    : null;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: bgHex }}>
      {writable && (
        <button
          onClick={() => { if (sessionId) void completeOperation(addAgenda(sessionId)); }}
          disabled={!sessionId}
          style={{
            position: 'absolute', top: 16, left: 16, zIndex: 10,
            padding: '12px 20px', fontSize: 18, fontWeight: 800, borderRadius: 12,
            border: 'none', background: sessionId ? '#2563eb' : '#9ca3af',
            color: '#fff', cursor: sessionId ? 'pointer' : 'not-allowed',
            boxShadow: '0 4px 12px rgba(0,0,0,.18)',
          }}
        >
          + 의제
        </button>
      )}

      {operationResult && (
        <CanvasOperationNotice
          result={operationResult}
          retrying={retryingOperation}
          retryAllowed={writable}
          onRetry={() => void retryOperation()}
          onRefresh={() => {
            setOperationResult(null);
            retryConnection();
          }}
          onDismiss={() => setOperationResult(null)}
        />
      )}

      <CanvasConnectionNotice connection={connection} onRetry={retryConnection} />

      {/* 📲 참여 QR — 시민 폰 입력(/join) 배포 */}
      {writable && (
        <button
          onClick={() => void showJoinQr()}
          style={{
            position: 'absolute', bottom: 20, left: 16, zIndex: 10,
            padding: '12px 18px', fontSize: 15, fontWeight: 800, borderRadius: 12,
            border: 'none', background: '#1f4e79', color: '#fff', cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,.18)',
          }}
        >
          📲 참여 QR
        </button>
      )}

      {/* 관련 의제 묶기/해제 — 카드 2개 이상 선택 시 (Shift+클릭 다중선택) */}
      {writable && selectedIds.length >= 2 && (
        <button
          onClick={() => void completeOperation(setGroup(selectedIds, sharedGroup ? null : crypto.randomUUID()))}
          style={{
            position: 'absolute', top: 16, left: 128, zIndex: 10,
            padding: '12px 18px', fontSize: 16, fontWeight: 800, borderRadius: 12,
            border: 'none', background: sharedGroup ? '#6b7280' : '#7c3aed', color: '#fff',
            cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.18)',
          }}
        >
          {sharedGroup ? '묶음 해제' : `🔗 묶기 (${selectedIds.length})`}
        </button>
      )}

      {/* 채택 → cv 투표 생성: 선택 의제로 모바일 투표(SCALE_MULTI) 라운드 만들기 */}
      {writable && selectedIds.length >= 1 && (
        <button
          onClick={makeVote}
          style={{
            position: 'absolute', top: 16, left: selectedIds.length >= 2 ? 250 : 128, zIndex: 10,
            padding: '12px 18px', fontSize: 16, fontWeight: 800, borderRadius: 12,
            border: 'none', background: '#0d9488', color: '#fff', cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,.18)',
          }}
        >
          🗳 투표 생성 ({selectedIds.length})
        </button>
      )}

      {/* 생성된 투표 — QR로 사람들이 스캔해 투표 */}
      {voteUrl && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
          background: '#fff', borderRadius: 16, padding: '20px 24px', maxWidth: '92vw', textAlign: 'center',
          boxShadow: '0 12px 40px rgba(0,0,0,.35)',
        }}>
          <div style={{ fontWeight: 900, fontSize: 18, color: '#0d9488', marginBottom: 12 }}>🗳 투표 생성됨 — 스캔해서 투표하세요</div>
          {voteQr && <img src={voteQr} alt="투표 QR" style={{ width: 200, height: 200 }} />}
          <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <a href={voteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#6b7280', wordBreak: 'break-all', maxWidth: 240 }}>{voteUrl}</a>
            <button onClick={() => void copyVoteLink()} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 800 }}>복사</button>
            <button onClick={() => { setVoteUrl(null); setVoteQr(null); }} style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: '#e5e7eb', cursor: 'pointer' }}>✕</button>
          </div>
        </div>
      )}

      {/* 📲 참여 QR 모달 — 시민이 폰으로 의제 제출(/join) */}
      {joinQr && (
        <div onClick={() => setJoinQr(null)} style={{
          position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.5)',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '24px 28px', textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,.4)' }}>
            <div style={{ fontWeight: 900, fontSize: 20, color: '#1f4e79', marginBottom: 14 }}>📲 의제 제출 — 폰으로 스캔</div>
            <img src={joinQr} alt="참여 QR" style={{ width: 240, height: 240 }} />
            <div style={{ marginTop: 12, fontSize: 14, color: '#6b7280' }}>스캔하면 의제·의견을 제출할 수 있어요</div>
            <button onClick={() => setJoinQr(null)} style={{ marginTop: 14, padding: '8px 20px', borderRadius: 10, border: 'none', background: '#1f4e79', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>닫기</button>
          </div>
        </div>
      )}

      {/* 조별 색상 선택 레전드 (현재 보드의 조) */}
      {jos.length > 0 && (
        <div style={{
          position: 'absolute', top: 70, left: 16, zIndex: 10, display: 'flex', flexWrap: 'wrap',
          gap: 8, maxWidth: 360, padding: '8px 10px', borderRadius: 10,
          background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)',
        }}>
          <span style={{ color: '#cbd5e1', fontSize: 11, fontWeight: 800, width: '100%' }}>조별 보기 (칩 클릭=해당 조만)</span>
          <button
            onClick={() => setFocusJo(null)}
            style={{
              padding: '3px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 800,
              border: focusJo === null ? '2px solid #fff' : '1px solid rgba(255,255,255,.4)',
              background: focusJo === null ? '#2563eb' : 'rgba(255,255,255,.15)', color: '#fff',
            }}
          >전체</button>
          {jos.map((jo) => (
            <span key={jo} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px 2px 4px', borderRadius: 999,
              background: focusJo === jo ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.15)',
              color: focusJo === jo ? '#1f2937' : '#fff', fontSize: 13, fontWeight: 800,
              border: focusJo === jo ? '2px solid #fff' : '1px solid rgba(255,255,255,.3)', cursor: 'pointer',
            }}>
              <input
                type="color"
                value={colorOf(jo)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setJo(jo, e.target.value)}
                title={`${jo} 색 선택`}
                style={{ width: 20, height: 20, border: 'none', borderRadius: 5, background: 'none', cursor: 'pointer', padding: 0 }}
              />
              <span onClick={() => setFocusJo(focusJo === jo ? null : jo)} title={`${jo}만 보기`}>{jo}</span>
            </span>
          ))}
        </div>
      )}

      {/* 배경(대시보드) 색상 선택 — 프리셋 + 커스텀 + 진행자 칩 */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        {authed && (
          <button
            onClick={() => void completeOperation(executeCanvasOperation('로그아웃', signOut))}
            title="로그아웃"
            style={{
              padding: '6px 12px', borderRadius: 999, border: 'none', cursor: 'pointer',
              background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 13, fontWeight: 800,
              maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              boxShadow: '0 2px 6px rgba(0,0,0,.25)',
            }}
          >
            ✓ {email} · 로그아웃
          </button>
        )}
        {BG_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setBg(p.bg)}
            title={p.label}
            aria-label={`배경 ${p.label}`}
            style={{
              width: 30, height: 30, borderRadius: 8, cursor: 'pointer', background: p.bg,
              border: p.bg === bgHex ? '3px solid #2563eb' : '2px solid rgba(255,255,255,.5)',
              boxShadow: '0 2px 6px rgba(0,0,0,.25)',
            }}
          />
        ))}
        <label title="배경 직접 선택" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <input
            type="color"
            value={bgHex}
            onChange={(e) => setBg(e.target.value)}
            style={{ width: 32, height: 32, border: '2px dashed rgba(255,255,255,.6)', borderRadius: 8, background: 'none', cursor: 'pointer', padding: 0 }}
          />
        </label>
      </div>

      {/* ✨ 임베딩 추천 패널 — 카드 1개 선택=앵커 KNN(코퍼스/현재의제 토글), 그 외=pairwise 유사쌍 */}
      {writable && (
        <div style={{ position: 'absolute', top: 64, right: 16, zIndex: 10, width: 312, maxHeight: '76vh', overflowY: 'auto' }}>
          {anchor ? (
            /* ── 앵커 모드: 선택한 1개 카드 기준 최근접 ── */
            <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,.97)', boxShadow: '0 4px 14px rgba(0,0,0,.18)' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280' }}>🔍 이 카드와 유사한 의제</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1f2937', margin: '3px 0 9px', wordBreak: 'keep-all' }}>{anchorLabel}</div>
              {/* 매칭 대상 토글 */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {([['corpus', '전수 코퍼스 173'], ['agenda', '현재 의제(부모)']] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setKnnTarget(v)} style={{
                    flex: 1, padding: '6px 4px', fontSize: 12, fontWeight: 800, borderRadius: 8, cursor: 'pointer',
                    border: knnTarget === v ? '2px solid #9333ea' : '1px solid #cbd5e1',
                    background: knnTarget === v ? '#9333ea' : '#fff', color: knnTarget === v ? '#fff' : '#374151',
                  }}>{l}</button>
                ))}
              </div>
              <button onClick={runKnn} disabled={knnLoading} style={{
                width: '100%', padding: '9px', fontSize: 14, fontWeight: 800, borderRadius: 9, border: 'none',
                background: knnLoading ? '#9ca3af' : '#9333ea', color: '#fff', cursor: knnLoading ? 'wait' : 'pointer',
              }}>{knnLoading ? '분석 중…' : '✨ 분석'}</button>
              <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>gte-small 임베딩 · 코사인 유사도 · 추천만</div>

              {/* 코퍼스 결과 */}
              {knnFor === anchor.id && knnTarget === 'corpus' && knnCorpus.map((m, i) => (
                <div key={i} style={{ marginTop: 8, padding: '8px 10px', borderRadius: 9, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: '#1f2937', wordBreak: 'keep-all' }}>{m.title}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 999, background: m.source === 'expert-65' ? '#dbeafe' : '#dcfce7', color: m.source === 'expert-65' ? '#1e40af' : '#166534' }}>{m.source === 'expert-65' ? '전문가' : '대국민'}</span>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>{m.category}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 800, color: '#9333ea' }}>{m.similarity.toFixed(2)}</span>
                  </div>
                </div>
              ))}

              {/* 현재 의제 결과 — '여기 붙이기'로 parent 지정 */}
              {knnFor === anchor.id && knnTarget === 'agenda' && knnAgenda.map((m) => (
                <div key={m.id} style={{ marginTop: 8, padding: '8px 10px', borderRadius: 9, background: '#f8fafc', border: '1px solid #e5e7eb', fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: '#1f2937', wordBreak: 'keep-all' }}>{m.text}</div>
                  <div style={{ display: 'flex', alignItems: 'center', marginTop: 6, gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#9333ea' }}>유사도 {m.sim.toFixed(2)}</span>
                    <button
                      onClick={async () => {
                        const result = await completeOperation(setParent(anchor.id, m.id));
                        if (result.ok) { setKnnAgenda([]); setKnnFor(null); }
                      }}
                      disabled={anchorHasChildren}
                      title={anchorHasChildren ? '이 카드에 이미 실천과제가 달려 있어 붙일 수 없습니다' : '이 의제의 실천과제로 붙이기'}
                      style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 8, border: 'none', background: anchorHasChildren ? '#d1d5db' : '#7c3aed', color: '#fff', fontWeight: 800, cursor: anchorHasChildren ? 'not-allowed' : 'pointer' }}
                    >🛠 여기 붙이기</button>
                  </div>
                </div>
              ))}
              {knnTarget === 'agenda' && anchorHasChildren && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#b45309' }}>※ 자식 실천과제가 있어 다른 의제 밑으로 붙이기 불가</div>
              )}
            </div>
          ) : (
            /* ── pairwise 모드: 0개 또는 2개+ 선택 시 캔버스 의제 간 유사쌍 추천 ── */
            <>
              <button
                onClick={suggestMerges}
                disabled={suggesting}
                style={{
                  width: '100%', padding: '10px 14px', fontSize: 15, fontWeight: 800, borderRadius: 10,
                  border: 'none', background: suggesting ? '#9ca3af' : '#9333ea', color: '#fff',
                  cursor: suggesting ? 'wait' : 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.18)',
                }}
              >
                {suggesting ? '분석 중…' : '✨ 유사 의제 추천'}
              </button>
              {/* 방식 투명성 + 임계값 조절 (전문가 검수용) */}
              <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,.9)', fontSize: 11, color: '#6b7280' }}>
                gte-small 임베딩 · 코사인 유사도 · 추천만(자동병합X) · <b>카드 1개 선택 시 코퍼스/부모 매칭</b>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ whiteSpace: 'nowrap' }}>임계값 {simThreshold.toFixed(2)}</span>
                  <input type="range" min={0.7} max={0.98} step={0.01} value={simThreshold}
                    onChange={(e) => setSimThreshold(parseFloat(e.target.value))} style={{ flex: 1 }} />
                </div>
              </div>
              {suggestions.map((s, i) => (
                <div key={i} style={{
                  marginTop: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.95)',
                  boxShadow: '0 2px 8px rgba(0,0,0,.15)', fontSize: 13, color: '#1f2937',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 2 }}>{s.at}</div>
                  <div style={{ color: '#6b7280', margin: '2px 0' }}>↔ {s.bt}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#9333ea' }}>유사도 {s.sim}</span>
                    <button
                      onClick={async () => {
                        const result = await completeOperation(setGroup([s.a, s.b], crypto.randomUUID()));
                        if (result.ok) setSuggestions((prev) => prev.filter((x) => x !== s));
                      }}
                      style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                    >
                      🔗 묶기
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <CanvasOperationProvider run={(operation) => {
        if (writable) return completeOperation(operation());
        const result: CanvasOperationResult = {
          ok: false,
          kind: 'alert',
          message: '실시간 연결과 인증을 확인한 뒤 다시 시도해 주세요.',
        };
        setOperationResult(result);
        return Promise.resolve(result);
      }}>
      <ReactFlow
        nodes={[...FRAME_NODES, ...displayNodes]}
        edges={[...edges, ...parentEdges]}
        nodeTypes={nodeTypes}
        nodesDraggable={writable}
        nodesConnectable={writable}
        onNodesChange={(changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as typeof nds)}
        onNodeDragStop={(_, node) => {
          if (writable && !node.id.startsWith('frame-')) void completeOperation(moveAgenda(node));
        }}
        onNodesDelete={(deleted) => {
          const ids = deleted.filter((node) => !node.id.startsWith('frame-')).map((node) => node.id);
          if (writable && ids.length > 0) void completeOperation(archiveAgendas(ids));
        }}
        onConnect={(connection) => {
          if (writable && sessionId && connection.source && connection.target) {
            void completeOperation(linkAgendas(sessionId, connection.source, connection.target));
          }
        }}
        onEdgesDelete={(deleted) => {
          const ids = deleted.filter((edge) => !edge.id.startsWith('pe-')).map((edge) => edge.id);
          if (writable && ids.length > 0) void completeOperation(unlinkAgendas(ids));
        }}
        deleteKeyCode={writable ? ['Delete', 'Backspace'] : null}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        fitView
      >
        <Background color={dotFor(bgHex)} /><Controls />
      </ReactFlow>
      </CanvasOperationProvider>

      {/* 진행자 로그인 패널 — 미인증 시 캔버스 위 중앙 오버레이 (뒤 캔버스는 읽기전용 노출) */}
      {!authed && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(2px)',
        }}>
          <div style={{
            width: 'min(92vw, 420px)', padding: '28px 28px 24px', borderRadius: 16,
            background: '#fff', boxShadow: '0 12px 40px rgba(0,0,0,.35)', textAlign: 'center',
          }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 24, fontWeight: 900, color: '#1f2937' }}>진행자 로그인</h2>
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitLogin(); }}
              placeholder="이메일 주소"
              autoComplete="username"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16,
                border: '2px solid #cbd5e1', borderRadius: 10, marginBottom: 10,
              }}
            />
            <input
              type="password"
              value={loginPw}
              onChange={(e) => setLoginPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitLogin(); }}
              placeholder="비밀번호"
              autoComplete="current-password"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16,
                border: '2px solid #cbd5e1', borderRadius: 10, marginBottom: 12,
              }}
            />
            <button
              onClick={submitLogin}
              disabled={!loginEmail.trim() || !loginPw || loggingIn}
              style={{
                width: '100%', padding: '12px 16px', fontSize: 17, fontWeight: 800, borderRadius: 10,
                border: 'none', color: '#fff',
                cursor: (loginEmail.trim() && loginPw && !loggingIn) ? 'pointer' : 'not-allowed',
                background: (loginEmail.trim() && loginPw && !loggingIn) ? '#2563eb' : '#9ca3af',
              }}
            >
              {loggingIn ? '로그인 중…' : '로그인'}
            </button>
            {(loginErr || initializationError) && (
              <p role="alert" style={{ fontSize: 14, color: '#b42318', margin: '12px 0 0' }}>
                {loginErr ?? initializationError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
