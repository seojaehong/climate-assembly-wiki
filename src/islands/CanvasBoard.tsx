import { useState } from 'react';
import { ReactFlow, Background, Controls, applyNodeChanges, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AgendaNode from './canvas/AgendaNode';
import { useRealtimeAgendas } from './canvas/use-realtime-agendas';
import { getSupabase } from '../lib/supabase';
import { BG_PRESETS } from './canvas/palette';

const nodeTypes = { agenda: AgendaNode };
const BG_KEY = 'canvas-bg-preset';

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

export default function CanvasBoard({ sessionSlug }: { sessionSlug: string }) {
  const { nodes, setNodes, sessionId } = useRealtimeAgendas(sessionSlug);
  const [bgId, setBgId] = useState<string>(() => {
    try { return localStorage.getItem(BG_KEY) || 'navy'; } catch { return 'navy'; }
  });
  const bg = BG_PRESETS.find((p) => p.id === bgId) ?? BG_PRESETS[0];
  const pickBg = (id: string) => {
    setBgId(id);
    try { localStorage.setItem(BG_KEY, id); } catch { /* noop */ }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', background: bg.bg }}>
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
      {/* 배경(대시보드) 색상 선택 */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, display: 'flex', gap: 8 }}>
        {BG_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => pickBg(p.id)}
            title={p.label}
            aria-label={`배경 ${p.label}`}
            style={{
              width: 30, height: 30, borderRadius: 8, cursor: 'pointer',
              background: p.bg,
              border: p.id === bgId ? '3px solid #2563eb' : '2px solid rgba(255,255,255,.5)',
              boxShadow: '0 2px 6px rgba(0,0,0,.25)',
            }}
          />
        ))}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        nodesDraggable
        onNodesChange={(changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds) as typeof nds)}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={(deleted) => deleted.forEach((n) => archiveAgenda(n.id))}
        deleteKeyCode={['Delete', 'Backspace']}
        fitView
      >
        <Background color={bg.dot} /><Controls />
      </ReactFlow>
    </div>
  );
}
