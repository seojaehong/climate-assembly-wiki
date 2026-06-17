import { type NodeProps } from '@xyflow/react';
import type { AgendaNode as TNode } from './agenda-sync';

const ZONE_BG: Record<string, string> = { '감축': '#fde047', '적응': '#fed7aa', '미분류': '#e5e7eb' };

export default function AgendaNode({ data }: NodeProps<TNode>) {
  return (
    <div style={{
      background: ZONE_BG[data.zone ?? '미분류'] ?? '#fff', borderRadius: 14,
      padding: '16px 20px', minWidth: 240, maxWidth: 420, fontSize: 22, fontWeight: 800,
      boxShadow: '0 6px 16px rgba(0,0,0,.12)', wordBreak: 'keep-all', color: '#1f2937',
    }}>
      <div style={{ fontSize: 14, opacity: .6 }}>{data.jo}</div>
      {data.label}
    </div>
  );
}
