import { ReactFlow, Background, Controls } from '@xyflow/react';
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

export default function CanvasBoard({ sessionSlug }: { sessionSlug: string }) {
  const { nodes } = useRealtimeAgendas(sessionSlug);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        nodesDraggable
        onNodeDragStop={onNodeDragStop}
        fitView
      >
        <Background /><Controls />
      </ReactFlow>
    </div>
  );
}
