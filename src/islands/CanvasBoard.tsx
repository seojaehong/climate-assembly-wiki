import { ReactFlow, Background, Controls, applyNodeChanges, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AgendaNode from './canvas/AgendaNode';
import { useRealtimeAgendas } from './canvas/use-realtime-agendas';
import { getSupabase } from '../lib/supabase';

const nodeTypes = { agenda: AgendaNode };

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
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
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
        <Background /><Controls />
      </ReactFlow>
    </div>
  );
}
