import { describe, it, expect } from 'vitest';
import { agendasToNodes, mergeRealtimeChange } from './agenda-sync';

const A = { id: 'a1', text: '교육', jo: 'A조', zone: '감축', status: 'active', x: 10, y: 20 };

describe('agendasToNodes', () => {
  it('agenda row → React Flow node (position·data)', () => {
    const [n] = agendasToNodes([A as any]);
    expect(n).toMatchObject({ id: 'a1', type: 'agenda', position: { x: 10, y: 20 } });
    expect(n.data).toMatchObject({ text: '교육', zone: '감축' });
  });
  it('archived는 제외', () => {
    expect(agendasToNodes([{ ...A, status: 'archived' } as any])).toHaveLength(0);
  });
});

describe('mergeRealtimeChange', () => {
  it('UPDATE는 해당 노드만 교체', () => {
    const nodes = agendasToNodes([A as any]);
    const next = mergeRealtimeChange(nodes, { eventType: 'UPDATE', new: { ...A, x: 99 } } as any);
    expect(next[0].position.x).toBe(99);
  });
  it('INSERT는 추가, DELETE/archived는 제거', () => {
    const nodes = agendasToNodes([A as any]);
    const ins = mergeRealtimeChange(nodes, { eventType: 'INSERT', new: { ...A, id: 'a2' } } as any);
    expect(ins).toHaveLength(2);
    const del = mergeRealtimeChange(ins, { eventType: 'UPDATE', new: { ...A, id: 'a2', status: 'archived' } } as any);
    expect(del).toHaveLength(1);
  });
});
