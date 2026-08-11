import { describe, it, expect } from 'vitest';
import {
  agendasToNodes,
  mergeRealtimeChange,
  linksToEdges,
  mergeLinkChange,
  parseAgendaRealtimePayload,
  parseAgendaRows,
  parseAgendaLinks,
  parseLinkRealtimePayload,
  type AgendaRow,
  type AgendaChange,
  type LinkChange,
} from './agenda-sync';

describe('linksToEdges', () => {
  it('링크 → React Flow 엣지(source/target)', () => {
    const [e] = linksToEdges([{ id: 'l1', source_id: 'a1', target_id: 'a2' }]);
    expect(e).toMatchObject({ id: 'l1', source: 'a1', target: 'a2' });
  });
  it('mergeLinkChange: INSERT 추가, DELETE 제거', () => {
    let edges = linksToEdges([{ id: 'l1', source_id: 'a1', target_id: 'a2' }]);
    const insert: LinkChange = { eventType: 'INSERT', new: { id: 'l2', source_id: 'a2', target_id: 'a3' } };
    edges = mergeLinkChange(edges, insert);
    expect(edges).toHaveLength(2);
    const remove: LinkChange = { eventType: 'DELETE', old: { id: 'l1' } };
    edges = mergeLinkChange(edges, remove);
    expect(edges.map((e) => e.id)).toEqual(['l2']);
  });
});

const A: AgendaRow = { id: 'a1', text: '교육', jo: 'A조', zone: '감축', status: 'active', x: 10, y: 20 };

describe('agendasToNodes', () => {
  it('agenda row → React Flow node (position·data)', () => {
    const [n] = agendasToNodes([A]);
    expect(n).toMatchObject({ id: 'a1', type: 'agenda', position: { x: 10, y: 20 } });
    expect(n.data).toMatchObject({ text: '교육', zone: '감축' });
  });
  it('archived는 제외', () => {
    expect(agendasToNodes([{ ...A, status: 'archived' }])).toHaveLength(0);
  });
});

describe('mergeRealtimeChange', () => {
  it('UPDATE는 해당 노드만 교체', () => {
    const nodes = agendasToNodes([A]);
    const update: AgendaChange = { eventType: 'UPDATE', new: { ...A, x: 99 } };
    const next = mergeRealtimeChange(nodes, update);
    expect(next[0].position.x).toBe(99);
  });
  it('INSERT는 추가, DELETE/archived는 제거', () => {
    const nodes = agendasToNodes([A]);
    const insert: AgendaChange = { eventType: 'INSERT', new: { ...A, id: 'a2' } };
    const ins = mergeRealtimeChange(nodes, insert);
    expect(ins).toHaveLength(2);
    const archive: AgendaChange = { eventType: 'UPDATE', new: { ...A, id: 'a2', status: 'archived' } };
    const del = mergeRealtimeChange(ins, archive);
    expect(del).toHaveLength(1);
  });
});

describe('realtime payload parsing', () => {
  it('preserves valid agenda and link changes without broad casts', () => {
    expect(parseAgendaRealtimePayload({ eventType: 'UPDATE', new: A, old: {} })).toEqual({
      eventType: 'UPDATE',
      new: A,
    });
    expect(parseLinkRealtimePayload({
      eventType: 'DELETE',
      new: {},
      old: { id: 'link-1' },
    })).toEqual({ eventType: 'DELETE', old: { id: 'link-1' } });
  });

  it('rejects malformed changes before they reach canvas state', () => {
    expect(parseAgendaRealtimePayload({ eventType: 'UPDATE', new: { id: 'a1' }, old: {} })).toBeNull();
    expect(parseLinkRealtimePayload({
      eventType: 'INSERT',
      new: { id: 'link-1', source_id: 'a1' },
      old: {},
    })).toBeNull();
    expect(parseAgendaRealtimePayload({ eventType: 'UNKNOWN', new: A, old: {} })).toBeNull();
  });
});

describe('initial snapshot parsing', () => {
  it('accepts complete rows and rejects malformed database payloads', () => {
    expect(parseAgendaRows([A])).toEqual([A]);
    expect(parseAgendaLinks([{ id: 'l1', source_id: 'a1', target_id: 'a2' }])).toEqual([
      { id: 'l1', source_id: 'a1', target_id: 'a2' },
    ]);
    expect(parseAgendaRows([{ ...A, x: '10' }])).toBeNull();
    expect(parseAgendaLinks([{ id: 'l1', source_id: 'a1' }])).toBeNull();
    expect(parseAgendaRows(null)).toBeNull();
    expect(parseAgendaLinks(null)).toBeNull();
  });
});
