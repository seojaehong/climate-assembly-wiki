import { useState, useMemo } from 'react';
import { ReactFlow, Background, Controls, applyNodeChanges, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AgendaNode from './canvas/AgendaNode';
import { useRealtimeAgendas } from './canvas/use-realtime-agendas';
import { useAuth } from './canvas/useAuth';
import { getSupabase } from '../lib/supabase';
import { BG_PRESETS, joColor, readableInk } from './canvas/palette';

const nodeTypes = { agenda: AgendaNode };
const BG_KEY = 'canvas-bg-hex';
const JO_KEY = 'canvas-jo-colors';

function onNodeDragStop(_: unknown, node: { id: string; position: { x: number; y: number } }) {
  const sb = getSupabase();
  if (!sb) return;
  sb.schema('climate_vote').from('agenda')
    .update({ x: node.position.x, y: node.position.y, updated_at: new Date().toISOString() })
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

// 배경 휘도에 맞는 그리드 점색.
function dotFor(bg: string): string {
  return readableInk(bg) === '#1f2937' ? '#cbd5e1' : '#475569';
}

export default function CanvasBoard({ sessionSlug }: { sessionSlug: string }) {
  const { nodes, setNodes, sessionId } = useRealtimeAgendas(sessionSlug);

  // 진행자 인증 — 미인증 시 읽기전용(로그인 패널), 인증 시 쓰기 허용
  const { session, email, signIn, signOut } = useAuth();
  const authed = !!session;
  const [loginEmail, setLoginEmail] = useState('');
  const [loginSent, setLoginSent] = useState(false);
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const submitLogin = async () => {
    setLoginErr(null);
    const { error } = await signIn(loginEmail.trim());
    if (error) setLoginErr(error.message);
    else setLoginSent(true);
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

  // 조별 색을 각 노드 data에 주입 (override > 기본 팔레트)
  const displayNodes = useMemo(() => nodes.map((n) => {
    const jo = (n.data.jo ?? '').trim();
    const cardBg = joColors[jo] ?? joColor(jo).bg;
    return { ...n, data: { ...n.data, cardBg, cardInk: readableInk(cardBg) } };
  }), [nodes, joColors]);

  const colorOf = (jo: string) => joColors[jo] ?? joColor(jo).bg;

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
        nodes={displayNodes}
        edges={[]}
        nodeTypes={nodeTypes}
        nodesDraggable
        onNodesChange={(changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as typeof nds)}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={(deleted) => deleted.forEach((n) => archiveAgenda(n.id))}
        deleteKeyCode={['Delete', 'Backspace']}
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
            {loginSent ? (
              <p style={{ fontSize: 16, fontWeight: 700, color: '#2563eb', margin: '12px 0 0' }}>
                메일함의 링크를 확인하세요
              </p>
            ) : (
              <>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitLogin(); }}
                  placeholder="이메일 주소"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16,
                    border: '2px solid #cbd5e1', borderRadius: 10, marginBottom: 12,
                  }}
                />
                <button
                  onClick={submitLogin}
                  disabled={!loginEmail.trim()}
                  style={{
                    width: '100%', padding: '12px 16px', fontSize: 17, fontWeight: 800, borderRadius: 10,
                    border: 'none', color: '#fff', cursor: loginEmail.trim() ? 'pointer' : 'not-allowed',
                    background: loginEmail.trim() ? '#2563eb' : '#9ca3af',
                  }}
                >
                  매직링크 보내기
                </button>
                {loginErr && (
                  <p style={{ fontSize: 14, color: '#dc2626', margin: '12px 0 0' }}>{loginErr}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
