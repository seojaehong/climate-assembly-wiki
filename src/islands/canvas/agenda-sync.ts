import type { Node, Edge } from '@xyflow/react';

export interface AgendaRow {
  id: string; text: string; jo: string | null; zone: string | null;
  status: 'active' | 'archived'; x: number; y: number;
  group_id?: string | null; merged_into?: string | null;
  parent_id?: string | null; kind?: string | null; // kind: 'agenda' | 'action'(실천과제)
  [key: string]: unknown; // React Flow Node<T> 제약: Record<string, unknown> 호환
}
export type AgendaNodeData = AgendaRow & { label: string };
export type AgendaNode = Node<AgendaNodeData, 'agenda'>;

export function agendasToNodes(rows: AgendaRow[]): AgendaNode[] {
  return rows.filter(r => r.status === 'active').map(r => ({
    id: r.id, type: 'agenda', position: { x: r.x ?? 0, y: r.y ?? 0 },
    data: { ...r, label: r.text },
  }));
}

// 연결선 — 관련 의제끼리 잇는 선
export interface AgendaLink { id: string; source_id: string; target_id: string; }

export function linksToEdges(links: AgendaLink[]): Edge[] {
  return links.map((l) => ({
    id: l.id, source: l.source_id, target: l.target_id,
    type: 'default', animated: false,
    style: { stroke: '#7c3aed', strokeWidth: 3 },
  }));
}

interface LinkChange { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new?: AgendaLink; old?: { id: string }; }
export function mergeLinkChange(edges: Edge[], change: LinkChange): Edge[] {
  if (change.eventType === 'DELETE') return edges.filter((e) => e.id !== change.old?.id);
  const [edge] = linksToEdges([change.new!]);
  return [...edges.filter((e) => e.id !== edge.id), edge];
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
