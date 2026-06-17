import type { Node } from '@xyflow/react';

export interface AgendaRow {
  id: string; text: string; jo: string | null; zone: string | null;
  status: 'active' | 'archived'; x: number; y: number;
  group_id?: string | null; merged_into?: string | null;
}
export type AgendaNode = Node<AgendaRow & { label: string }, 'agenda'>;

export function agendasToNodes(rows: AgendaRow[]): AgendaNode[] {
  return rows.filter(r => r.status === 'active').map(r => ({
    id: r.id, type: 'agenda', position: { x: r.x ?? 0, y: r.y ?? 0 },
    data: { ...r, label: r.text },
  }));
}

interface Change { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new?: AgendaRow; old?: { id: string }; }

export function mergeRealtimeChange(nodes: AgendaNode[], change: Change): AgendaNode[] {
  if (change.eventType === 'DELETE') return nodes.filter(n => n.id !== change.old?.id);
  const row = change.new!;
  const without = nodes.filter(n => n.id !== row.id);
  if (row.status === 'archived') return without;
  const [node] = agendasToNodes([row]);
  return [...without, node];
}
