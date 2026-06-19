import { useState, useMemo } from 'react';
import { ReactFlow, Background, Controls, applyNodeChanges, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AgendaNode from './canvas/AgendaNode';
import ZoneFrameNode from './canvas/ZoneFrameNode';
import { useRealtimeAgendas } from './canvas/use-realtime-agendas';
import { useAuth } from './canvas/useAuth';
import { getSupabase } from '../lib/supabase';
import { BG_PRESETS, joColor, readableInk, groupColor } from './canvas/palette';
import { ZONE_FRAMES, FRAME_Y, FRAME_H, zoneForX } from './canvas/zones';

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

function onNodeDragStop(_: unknown, node: { id: string; position: { x: number; y: number } }) {
  if (node.id.startsWith('frame-')) return; // 프레임은 고정
  const sb = getSupabase();
  if (!sb) return;
  // 드롭한 프레임 영역이 곧 zone — x좌표로 판정해 zone도 함께 저장
  sb.schema('climate_vote').from('agenda')
    .update({ x: node.position.x, y: node.position.y, zone: zoneForX(node.position.x), updated_at: new Date().toISOString() })
    .eq('id', node.id)
    .then(() => {});
}

async function addAgenda(sessionId: string) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.schema('climate_vote').from('agenda')
    .insert({ session_id: sessionId, text: '새 의제', status: 'active', x: 80, y: 80, created_by: 'moderator' });
}

function archiveAgenda(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  sb.schema('climate_vote').from('agenda')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id)
    .then(() => {});
}

// 연결선 — 관련 의견끼리 잇기/끊기
function linkAgendas(sessionId: string, source: string, target: string) {
  const sb = getSupabase();
  if (!sb) return;
  sb.schema('climate_vote').from('agenda_link')
    .insert({ session_id: sessionId, source_id: source, target_id: target, created_by: 'moderator' })
    .then(() => {});
}
function unlink(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  sb.schema('climate_vote').from('agenda_link').delete().eq('id', id).then(() => {});
}

// 채택 → cv 투표 생성: 선택 의제들로 SCALE_MULTI 라운드 insert (기존 cv 투표 프론트가 받음)
async function createVoteRound(agendaTexts: string[]): Promise<string | null> {
  const sb = getSupabase();
  if (!sb || agendaTexts.length === 0) return null;
  const id = 'AGV-' + crypto.randomUUID().slice(0, 8);
  const { error } = await sb.schema('climate_vote').from('rounds').insert({
    id, title: '의제 평가 투표', description: '각 의제의 중요도를 5점 척도로 평가해 주세요.',
    type: 'SCALE_MULTI', options: agendaTexts,
    scale_low: 1, scale_high: 5, scale_low_label: '낮음', scale_high_label: '높음',
    status: 'pending', sort_order: 100,
  });
  return error ? null : id;
}

// 관련 의제 묶기/풀기 — 선택 카드들에 공통 group_id 부여/해제
function setGroup(ids: string[], groupId: string | null) {
  const sb = getSupabase();
  if (!sb || ids.length === 0) return;
  sb.schema('climate_vote').from('agenda')
    .update({ group_id: groupId, updated_at: new Date().toISOString() })
    .in('id', ids)
    .then(() => {});
}

// 배경 휘도에 맞는 그리드 점색.
function dotFor(bg: string): string {
  return readableInk(bg) === '#1f2937' ? '#cbd5e1' : '#475569';
}

export default function CanvasBoard({ sessionSlug }: { sessionSlug: string }) {
  const { nodes, setNodes, edges, sessionId } = useRealtimeAgendas(sessionSlug);

  // 진행자 인증 — 미인증 시 읽기전용(로그인 패널), 인증 시 쓰기 허용
  const { session, email, signIn, signOut } = useAuth();
  const authed = !!session;
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const submitLogin = async () => {
    if (!loginEmail.trim() || !loginPw) return;
    setLoginErr(null);
    setLoggingIn(true);
    const { error } = await signIn(loginEmail.trim(), loginPw);
    setLoggingIn(false);
    if (error) setLoginErr(error.message);
    // 성공 시 onAuthStateChange가 session을 채워 모달이 자동으로 사라짐
  };

  // 배경색 (프리셋 또는 커스텀 hex), localStorage 기억
  const [bgHex, setBgHex] = useState<string>(() => {
    try { return localStorage.getItem(BG_KEY) || BG_PRESETS[0].bg; } catch { return BG_PRESETS[0].bg; }
  });
  const setBg = (hex: string) => {
    setBgHex(hex);
    try { localStorage.setItem(BG_KEY, hex); } catch { /* noop */ }
  };

  // 조별 커스텀 색 override, localStorage 기억
  const [joColors, setJoColors] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(JO_KEY) || '{}'); } catch { return {}; }
  });
  const setJo = (jo: string, hex: string) => {
    setJoColors((prev) => {
      const next = { ...prev, [jo]: hex };
      try { localStorage.setItem(JO_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  };

  // 현재 보드에 존재하는 조 목록
  const jos = useMemo(() => {
    const s = new Set<string>();
    for (const n of nodes) { const j = (n.data.jo ?? '').trim(); if (j) s.add(j); }
    return [...s].sort();
  }, [nodes]);

  // 조별 색 + 그룹 테두리색을 각 노드 data에 주입
  const displayNodes = useMemo(() => nodes.map((n) => {
    const jo = (n.data.jo ?? '').trim();
    const cardBg = joColors[jo] ?? joColor(jo).bg;
    const gid = (n.data as { group_id?: string | null }).group_id;
    return { ...n, data: { ...n.data, cardBg, cardInk: readableInk(cardBg), groupOutline: gid ? groupColor(gid) : null } };
  }), [nodes, joColors]);

  const colorOf = (jo: string) => joColors[jo] ?? joColor(jo).bg;

  // 선택된 카드 + 묶기/해제 상태
  const selectedNodes = useMemo(() => nodes.filter((n) => (n as { selected?: boolean }).selected), [nodes]);
  const selectedIds = selectedNodes.map((n) => n.id);
  const [voteUrl, setVoteUrl] = useState<string | null>(null);
  const makeVote = async () => {
    const texts = selectedNodes.map((n) => (n.data as { label: string }).label);
    const id = await createVoteRound(texts);
    if (id) setVoteUrl(`${window.location.origin}/v/?round=${id}`);
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
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: bgHex }}>
      {authed && (
        <button
          onClick={() => sessionId && addAgenda(sessionId)}
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

      {/* 관련 의제 묶기/해제 — 카드 2개 이상 선택 시 (Shift+클릭 다중선택) */}
      {authed && selectedIds.length >= 2 && (
        <button
          onClick={() => setGroup(selectedIds, sharedGroup ? null : crypto.randomUUID())}
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
      {authed && selectedIds.length >= 1 && (
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

      {/* 생성된 투표 URL — 모바일 공유/QR용 */}
      {voteUrl && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
          background: '#fff', borderRadius: 12, padding: '14px 18px', maxWidth: '90vw',
          boxShadow: '0 8px 30px rgba(0,0,0,.3)', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontWeight: 800, color: '#0d9488' }}>🗳 투표 생성됨</span>
          <a href={voteUrl} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: '#1f2937', wordBreak: 'break-all' }}>{voteUrl}</a>
          <button onClick={() => { navigator.clipboard?.writeText(voteUrl); }} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer', fontWeight: 800 }}>복사</button>
          <button onClick={() => setVoteUrl(null)} style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: '#e5e7eb', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* 조별 색상 선택 레전드 (현재 보드의 조) */}
      {jos.length > 0 && (
        <div style={{
          position: 'absolute', top: 70, left: 16, zIndex: 10, display: 'flex', flexWrap: 'wrap',
          gap: 8, maxWidth: 360, padding: '8px 10px', borderRadius: 10,
          background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(4px)',
        }}>
          {jos.map((jo) => (
            <label key={jo} title={`${jo} 색 선택`} style={{
              display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
              color: '#fff', fontSize: 13, fontWeight: 800,
            }}>
              <input
                type="color"
                value={colorOf(jo)}
                onChange={(e) => setJo(jo, e.target.value)}
                style={{ width: 22, height: 22, border: 'none', borderRadius: 5, background: 'none', cursor: 'pointer', padding: 0 }}
              />
              {jo}
            </label>
          ))}
        </div>
      )}

      {/* 배경(대시보드) 색상 선택 — 프리셋 + 커스텀 + 진행자 칩 */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        {authed && (
          <button
            onClick={signOut}
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

      <ReactFlow
        nodes={[...FRAME_NODES, ...displayNodes]}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable
        onNodesChange={(changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as typeof nds)}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={(deleted) => deleted.forEach((n) => archiveAgenda(n.id))}
        onConnect={(c) => { if (sessionId && c.source && c.target) linkAgendas(sessionId, c.source, c.target); }}
        onEdgesDelete={(deleted) => deleted.forEach((e) => unlink(e.id))}
        deleteKeyCode={['Delete', 'Backspace']}
        multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
        fitView
      >
        <Background color={dotFor(bgHex)} /><Controls />
      </ReactFlow>

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
            {loginErr && (
              <p style={{ fontSize: 14, color: '#dc2626', margin: '12px 0 0' }}>{loginErr}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
