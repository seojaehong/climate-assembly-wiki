import { ReactFlow, Background, Controls, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useState } from 'react';

export default function CanvasBoard({ sessionSlug }: { sessionSlug: string }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow nodes={nodes} edges={[]} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
