// 조별 카드 색 + 대시보드 배경 프리셋.
// 200명 대형스크린 기준: 밝은 카드 배경 + 어두운 잉크, 고대비.

const INK = '#1f2937';

// 최대 20개 조 — 각 조에 고유한 밝은 색(어두운 잉크 대비). 유동적 조 개수 지원.
const JO_PALETTE = [
  '#FACC15', '#FDBA74', '#93C5FD', '#86EFAC', '#F9A8D4',
  '#C4B5FD', '#FCA5A5', '#6EE7B7', '#FCD34D', '#A5B4FC',
  '#F0ABFC', '#7DD3FC', '#BEF264', '#FDA4AF', '#D8B4FE',
  '#5EEAD4', '#FED7AA', '#BBF7D0', '#DDD6FE', '#99F6E4',
];
const UNASSIGNED = '#E5E7EB'; // 미배정(조 없음)

function hashIndex(key: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % mod;
}

// 조 라벨 → 팔레트 슬롯. A조~T조(20) 또는 1조~20조는 순서대로, 그 외는 해시.
function joIndex(key: string): number {
  const letter = key.match(/^([A-Ta-t])\s*조?$/);
  if (letter) return letter[1].toUpperCase().charCodeAt(0) - 65; // A=0 .. T=19
  const num = key.match(/^(\d{1,2})\s*조?$/);
  if (num) { const n = parseInt(num[1], 10) - 1; if (n >= 0 && n < 20) return n; }
  return hashIndex(key, JO_PALETTE.length);
}

export interface JoColor { bg: string; ink: string; }

export function joColor(jo: string | null | undefined): JoColor {
  const key = (jo ?? '').trim();
  if (!key) return { bg: UNASSIGNED, ink: INK };
  return { bg: JO_PALETTE[joIndex(key)], ink: INK };
}

// 그룹(묶음) 테두리용 진한 채도 색 — group_id마다 결정적·구분되게.
const GROUP_OUTLINE = [
  '#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2',
  '#ca8a04', '#db2777', '#4f46e5', '#65a30d', '#0d9488', '#be123c',
];
export function groupColor(groupId: string): string {
  return GROUP_OUTLINE[hashIndex(groupId, GROUP_OUTLINE.length)];
}

// 임의 배경색 위 가독 잉크색(상대휘도 기준). 커스텀 조색·커스텀 배경에 사용.
export function readableInk(hex: string): string {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 단순 상대휘도
  return lum > 0.5 ? '#1f2937' : '#f8fafc';
}

export interface BgPreset { id: string; label: string; bg: string; dot: string; }

// 대시보드 배경 선택지 (배경색 + 그리드 점색).
export const BG_PRESETS: BgPreset[] = [
  { id: 'navy',  label: '네이비', bg: '#0b1220', dot: '#334155' },
  { id: 'dark',  label: '다크',   bg: '#111827', dot: '#374151' },
  { id: 'light', label: '라이트', bg: '#f8fafc', dot: '#cbd5e1' },
  { id: 'green', label: '그린',   bg: '#0f2417', dot: '#2f5d43' },
];
