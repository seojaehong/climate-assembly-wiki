import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import AgendaNode from './canvas/AgendaNode';
import { useRealtimeAgendas } from './canvas/use-realtime-agendas';

const nodeTypes = { agenda: AgendaNode };

export default function CanvasBoard({ sessionSlug }: { sessionSlug: string }) {
  const { nodes } = useRealtimeAgendas(sessionSlug);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} fitView>
        <Background /><Controls />
      </ReactFlow>
    </div>
  );
}
