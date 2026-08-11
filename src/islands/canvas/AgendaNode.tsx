import { useEffect, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { AgendaNode as TNode } from './agenda-sync';
import { getSupabase } from '../../lib/supabase';
import { joColor } from './palette';
import {
  executeCanvasOperation,
  createCanvasAuditedEditOperation,
  reconcileCommittedCanvasInsert,
  useCanvasOperationRunner,
  type CanvasOperationOptions,
  type CanvasOperationResult,
  type CanvasWriteResponse,
} from './canvas-operation';

const ZONES = ['감축', '적응', '미분류'] as const;
const EMOJIS = ['🌱', '♻️', '🚌', '⚡', '🏭', '💧', '🌳', '☀️', '🔋', '🚲'];

type CanvasClient = NonNullable<ReturnType<typeof getSupabase>>;

function runNodeWrite(
  label: string,
  write: (client: CanvasClient) => PromiseLike<CanvasWriteResponse>,
  options: CanvasOperationOptions = {},
): Promise<CanvasOperationResult> {
  const sb = getSupabase();
  return executeCanvasOperation(label, sb ? () => write(sb) : null, undefined, options);
}

function saveEdit(id: string, before: string, after: string) {
  const auditId = crypto.randomUUID();
  const sb = getSupabase();
  if (!sb) return executeCanvasOperation('의제 내용 저장', null);
  const auditRow = { id: auditId, agenda_id: id, before, after, editor: 'moderator' };
  const operation = createCanvasAuditedEditOperation(before, after, {
    readCurrent: () => sb.schema('climate_vote').from('agenda')
      .select('text').eq('id', id).maybeSingle(),
    updateIfUnchanged: () => sb.schema('climate_vote').from('agenda')
      .update({ text: after, updated_at: new Date().toISOString() })
      .eq('id', id).eq('text', before).select('id').maybeSingle(),
    writeAudit: async () => {
      const editLog = await sb.schema('climate_vote').from('agenda_edit_log').insert(auditRow);
      return reconcileCommittedCanvasInsert<Record<string, unknown>>(
        editLog,
        () => sb.schema('climate_vote').from('agenda_edit_log')
          .select('id,agenda_id,before,after,editor').eq('id', auditId).maybeSingle(),
        (existing) => Object.entries(auditRow).every(([key, value]) => existing[key] === value),
      );
    },
  });
  return executeCanvasOperation('의제 내용 저장', operation, undefined, {
    failureMessage: '의제 내용 또는 변경 이력 저장을 완료하지 못했습니다. 다시 시도하면 동일 작업을 안전하게 이어갑니다.',
  });
}

function saveField(id: string, patch: Record<string, unknown>) {
  return runNodeWrite('의제 속성 저장', (sb) => sb.schema('climate_vote').from('agenda')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id), {
    retryable: false,
    failureMessage: '의제 속성 저장 결과를 확인하지 못했습니다. 상태를 새로고침한 뒤 다시 조정해 주세요.',
  });
}

function addAction(parentId: string, sessionId: string, px: number, py: number) {
  const id = crypto.randomUUID();
  const row = {
    id, session_id: sessionId, text: '새 실천과제', kind: 'action', parent_id: parentId,
    status: 'active', x: px + 40, y: py + 170, created_by: 'moderator',
  };
  return runNodeWrite('실천과제 추가', async (sb) => reconcileCommittedCanvasInsert<Record<string, unknown>>(
    await sb.schema('climate_vote').from('agenda').insert(row),
    () => sb.schema('climate_vote').from('agenda')
      .select('id,session_id,text,kind,parent_id,status,x,y,created_by').eq('id', id).maybeSingle(),
    (existing) => Object.entries(row).every(([key, value]) => existing[key] === value),
  ));
}

export default function AgendaNode({ id, data }: NodeProps<TNode>) {
  const runOperation = useCanvasOperationRunner();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const [joDraft, setJoDraft] = useState(data.jo ?? '');
  // 우선순위: CanvasBoard가 주입한 조별 커스텀 색(data.cardBg) > 기본 팔레트(joColor)
  const fallback = joColor(data.jo);
  const bg = (data as { cardBg?: string }).cardBg ?? fallback.bg;
  const ink = (data as { cardInk?: string }).cardInk ?? fallback.ink;
  const groupOutline = (data as { groupOutline?: string | null }).groupOutline ?? null;
  const isAction = (data as { kind?: string | null }).kind === 'action';
  const sessionId = (data as { session_id?: string }).session_id ?? '';
  const writable = (data as { writable?: boolean }).writable === true;

  useEffect(() => {
    if (!writable) setEditing(false);
  }, [writable]);

  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div style={{
      background: isAction ? '#fff' : bg, borderRadius: 14,
      padding: isAction ? '12px 16px' : '16px 20px',
      minWidth: isAction ? 200 : 240, maxWidth: isAction ? 360 : 440,
      fontSize: isAction ? 17 : 22, fontWeight: 800, wordBreak: 'keep-all', color: ink,
      boxShadow: '0 6px 16px rgba(0,0,0,.12)',
      border: isAction ? `2px dashed ${bg}` : undefined,
      outline: groupOutline ? `4px solid ${groupOutline}` : undefined,
      outlineOffset: groupOutline ? 3 : undefined,
    }}>
      {/* 연결선 핸들 — 점을 드래그해 다른 카드에 놓으면 선으로 연결 */}
      <Handle type="target" position={Position.Left} title="여기로 연결" isConnectable={writable} style={{ width: 18, height: 18, background: '#7c3aed', border: '3px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.3)' }} />
      <Handle type="source" position={Position.Right} title="여기서 끌어 연결" isConnectable={writable} style={{ width: 18, height: 18, background: '#7c3aed', border: '3px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,.3)' }} />
      <div style={{ fontSize: isAction ? 12 : 14, opacity: .7, fontWeight: 800, color: isAction ? '#7c3aed' : undefined }}>
        {isAction ? '🛠 실천과제' : `${data.jo ?? ''}${data.zone ? ` · ${data.zone}` : ''}`}
      </div>
      {editing ? (
        <div className="nodrag">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
            onBlur={() => {
              if (joDraft.trim() !== (data.jo ?? '').trim()) {
                void runOperation(() => saveField(id, { jo: joDraft.trim() || null }));
              }
            }}
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
                  onClick={() => { if (!active) void runOperation(() => saveField(id, { zone: z })); }}
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
          {/* 확정 의제 아래 실천과제 추가 (의제 카드에서만) */}
          {!isAction && sessionId && (
            <button
              onMouseDown={keepFocus}
              onClick={() => void runOperation(() => addAction(
                id,
                sessionId,
                (data as { x?: number }).x ?? 0,
                (data as { y?: number }).y ?? 0,
              ))}
              style={{
                width: '100%', marginTop: 8, padding: '8px', fontSize: 14, fontWeight: 800,
                borderRadius: 8, border: '2px dashed #7c3aed', background: '#faf5ff', color: '#7c3aed', cursor: 'pointer',
              }}
            >
              🛠 + 실천과제
            </button>
          )}
          {/* 실천과제 → 의제로 승격 (잘못 붙인 경우 되돌리기) */}
          {isAction && (
            <button
              onMouseDown={keepFocus}
              onClick={() => void runOperation(() => saveField(id, { kind: 'agenda', parent_id: null }))}
              style={{
                width: '100%', marginTop: 8, padding: '8px', fontSize: 14, fontWeight: 800,
                borderRadius: 8, border: '2px solid #2563eb', background: '#eff6ff', color: '#2563eb', cursor: 'pointer',
              }}
            >
              ⬆ 의제로 승격
            </button>
          )}
          {/* 완료 (멀티 컨트롤이라 명시적 닫기) */}
          <button
            onMouseDown={keepFocus}
            onClick={() => {
              if (draft.trim() !== data.label.trim()) {
                void runOperation(() => saveEdit(id, data.label, draft));
              }
              setEditing(false);
            }}
            style={{
              width: '100%', marginTop: 8, padding: '8px', fontSize: 15, fontWeight: 800,
              borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer',
            }}
          >
            완료
          </button>
        </div>
      ) : (
        <div onDoubleClick={() => {
          if (!writable) return;
          setDraft(data.label);
          setJoDraft(data.jo ?? '');
          setEditing(true);
        }}>{data.label}</div>
      )}
    </div>
  );
}
