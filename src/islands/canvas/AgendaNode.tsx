import { useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import type { AgendaNode as TNode } from './agenda-sync';
import { getSupabase } from '../../lib/supabase';
import { joColor } from './palette';

const ZONES = ['감축', '적응', '미분류'] as const;
const EMOJIS = ['🌱', '♻️', '🚌', '⚡', '🏭', '💧', '🌳', '☀️', '🔋', '🚲'];

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

async function saveField(id: string, patch: Record<string, unknown>) {
  const sb = getSupabase();
  if (!sb) return;
  await sb.schema('climate_vote').from('agenda')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id);
}

export default function AgendaNode({ id, data }: NodeProps<TNode>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const [joDraft, setJoDraft] = useState(data.jo ?? '');
  // 우선순위: CanvasBoard가 주입한 조별 커스텀 색(data.cardBg) > 기본 팔레트(joColor)
  const fallback = joColor(data.jo);
  const bg = (data as { cardBg?: string }).cardBg ?? fallback.bg;
  const ink = (data as { cardInk?: string }).cardInk ?? fallback.ink;
  const groupOutline = (data as { groupOutline?: string | null }).groupOutline ?? null;

  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div style={{
      background: bg, borderRadius: 14,
      padding: '16px 20px', minWidth: 240, maxWidth: 440, fontSize: 22, fontWeight: 800,
      boxShadow: '0 6px 16px rgba(0,0,0,.12)', wordBreak: 'keep-all', color: ink,
      outline: groupOutline ? `4px solid ${groupOutline}` : undefined,
      outlineOffset: groupOutline ? 3 : undefined,
    }}>
      <div style={{ fontSize: 14, opacity: .65, fontWeight: 800 }}>{data.jo}{data.zone ? ` · ${data.zone}` : ''}</div>
      {editing ? (
        <div className="nodrag">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => saveEdit(id, data.label, draft)}
            style={{
              width: '100%', boxSizing: 'border-box', minHeight: 60, fontSize: 22, fontWeight: 800,
              fontFamily: 'inherit', color: '#1f2937', background: 'rgba(255,255,255,.92)',
              border: '2px solid #2563eb', borderRadius: 8, padding: 6, resize: 'vertical',
              wordBreak: 'keep-all',
            }}
          />
          {/* 조 지정 (유동 — 아무 조나 입력) */}
          <input
            value={joDraft}
            onChange={(e) => setJoDraft(e.target.value)}
            onBlur={() => saveField(id, { jo: joDraft.trim() || null })}
            placeholder="조 (예: A조, 3조)"
            style={{
              width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '6px 10px',
              fontSize: 15, fontWeight: 800, color: '#1f2937', background: '#fff',
              border: '1px solid #cbd5e1', borderRadius: 8,
            }}
          />
          {/* 감축/적응/미분류 선택 */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {ZONES.map((z) => {
              const active = data.zone === z;
              return (
                <button
                  key={z}
                  onMouseDown={keepFocus}
                  onClick={() => saveField(id, { zone: z })}
                  style={{
                    flex: 1, padding: '6px 4px', fontSize: 14, fontWeight: 800, borderRadius: 8,
                    cursor: 'pointer', border: active ? '2px solid #2563eb' : '1px solid #cbd5e1',
                    background: active ? '#2563eb' : '#fff', color: active ? '#fff' : '#1f2937',
                  }}
                >
                  {z}
                </button>
              );
            })}
          </div>
          {/* 이모지 빠른 삽입 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            {EMOJIS.map((em) => (
              <button
                key={em}
                onMouseDown={keepFocus}
                onClick={() => setDraft((d) => d + em)}
                style={{
                  width: 30, height: 30, fontSize: 18, lineHeight: 1, borderRadius: 7,
                  cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff',
                }}
              >
                {em}
              </button>
            ))}
          </div>
          {/* 완료 (멀티 컨트롤이라 명시적 닫기) */}
          <button
            onMouseDown={keepFocus}
            onClick={() => { saveEdit(id, data.label, draft); setEditing(false); }}
            style={{
              width: '100%', marginTop: 8, padding: '8px', fontSize: 15, fontWeight: 800,
              borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer',
            }}
          >
            완료
          </button>
        </div>
      ) : (
        <div onDoubleClick={() => { setDraft(data.label); setJoDraft(data.jo ?? ''); setEditing(true); }}>{data.label}</div>
      )}
    </div>
  );
}
