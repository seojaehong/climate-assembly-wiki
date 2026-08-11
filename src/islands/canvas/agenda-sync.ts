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

export type LinkChange =
  | { eventType: 'INSERT' | 'UPDATE'; new: AgendaLink }
  | { eventType: 'DELETE'; old: { id: string } };

export function mergeLinkChange(edges: Edge[], change: LinkChange): Edge[] {
  if (change.eventType === 'DELETE') return edges.filter((edge) => edge.id !== change.old.id);
  const [edge] = linksToEdges([change.new]);
  return [...edges.filter((e) => e.id !== edge.id), edge];
}

export type AgendaChange =
  | { eventType: 'INSERT' | 'UPDATE'; new: AgendaRow }
  | { eventType: 'DELETE'; old: { id: string } };

export function mergeRealtimeChange(nodes: AgendaNode[], change: AgendaChange): AgendaNode[] {
  if (change.eventType === 'DELETE') return nodes.filter((node) => node.id !== change.old.id);
  const row = change.new;
  const without = nodes.filter(n => n.id !== row.id);
  if (row.status === 'archived') return without;
  const [node] = agendasToNodes([row]);
  return [...without, node];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAgendaRow(value: unknown): value is AgendaRow {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.text === 'string'
    && (value.jo === null || typeof value.jo === 'string')
    && (value.zone === null || typeof value.zone === 'string')
    && (value.status === 'active' || value.status === 'archived')
    && typeof value.x === 'number'
    && typeof value.y === 'number';
}

function isAgendaLink(value: unknown): value is AgendaLink {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.source_id === 'string'
    && typeof value.target_id === 'string';
}

export function parseAgendaRows(value: unknown): AgendaRow[] | null {
  return Array.isArray(value) && value.every(isAgendaRow) ? value : null;
}

export function parseAgendaLinks(value: unknown): AgendaLink[] | null {
  return Array.isArray(value) && value.every(isAgendaLink) ? value : null;
}

function deletedId(value: unknown): { id: string } | null {
  return isRecord(value) && typeof value.id === 'string' ? { id: value.id } : null;
}

export function parseAgendaRealtimePayload(payload: unknown): AgendaChange | null {
  if (!isRecord(payload)) return null;
  if (payload.eventType === 'DELETE') {
    const old = deletedId(payload.old);
    return old ? { eventType: 'DELETE', old } : null;
  }
  if ((payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') && isAgendaRow(payload.new)) {
    return { eventType: payload.eventType, new: payload.new };
  }
  return null;
}

export function parseLinkRealtimePayload(payload: unknown): LinkChange | null {
  if (!isRecord(payload)) return null;
  if (payload.eventType === 'DELETE') {
    const old = deletedId(payload.old);
    return old ? { eventType: 'DELETE', old } : null;
  }
  if ((payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') && isAgendaLink(payload.new)) {
    return { eventType: payload.eventType, new: payload.new };
  }
  return null;
}
