import { useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import type { AgendaNode as TNode } from './agenda-sync';
import { getSupabase } from '../../lib/supabase';

const ZONE_BG: Record<string, string> = { '감축': '#fde047', '적응': '#fed7aa', '미분류': '#e5e7eb' };

async function saveEdit(id: string, before: string, after: string) {
  if (after.trim() === before.trim()) return;
  const sb = getSupabase();
  if (!sb) return;
  await sb.schema('climate_vote').from('agenda')
    .update({ text: after, updated_at: new Date().toISOString() })
    .eq('id', id);
  await sb.schema('climate_vote').from('agenda_edit_log')
    .insert({ agenda_id: id, before, after, editor: 'moderator' });
}

export default function AgendaNode({ id, data }: NodeProps<TNode>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);

  return (
    <div style={{
      background: ZONE_BG[data.zone ?? '미분류'] ?? '#fff', borderRadius: 14,
      padding: '16px 20px', minWidth: 240, maxWidth: 420, fontSize: 22, fontWeight: 800,
      boxShadow: '0 6px 16px rgba(0,0,0,.12)', wordBreak: 'keep-all', color: '#1f2937',
    }}>
      <div style={{ fontSize: 14, opacity: .6 }}>{data.jo}</div>
      {editing ? (
        <textarea
          className="nodrag"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { setEditing(false); saveEdit(id, data.label, draft); }}
          style={{
            width: '100%', minHeight: 64, fontSize: 22, fontWeight: 800,
            fontFamily: 'inherit', color: '#1f2937', background: 'rgba(255,255,255,.85)',
            border: '2px solid #2563eb', borderRadius: 8, padding: 6, resize: 'vertical',
            wordBreak: 'keep-all',
          }}
        />
      ) : (
        <div onDoubleClick={() => { setDraft(data.label); setEditing(true); }}>{data.label}</div>
      )}
    </div>
  );
}
