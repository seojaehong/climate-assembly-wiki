import { type NodeProps } from '@xyflow/react';

// 카테고리 프레임(=zone) — 큰 이름표 영역. 카드 뒤에 깔리고, 클릭/드래그/선택 안 됨.
export default function ZoneFrameNode({ data }: NodeProps) {
  const d = data as { label: string; w: number; h: number; bg: string };
  return (
    <div style={{
      width: d.w, height: d.h, background: d.bg,
      border: '2px dashed rgba(100,116,139,.45)', borderRadius: 20,
      pointerEvents: 'none', boxSizing: 'border-box',
    }}>
      <div style={{
        padding: '14px 22px', fontSize: 28, fontWeight: 900,
        color: 'rgba(71,85,105,.65)', letterSpacing: '-0.01em',
      }}>
        {d.label}
      </div>
    </div>
  );
}
