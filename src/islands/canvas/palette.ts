// 조별 카드 색 + 대시보드 배경 프리셋.
// 200명 대형스크린 기준: 밝은 카드 배경 + 어두운 잉크, 고대비.

const INK = '#1f2937';

// 조 명시 매핑 (A~F조). 그 외/미상은 해시로 팔레트에서 결정적 선택.
const JO_MAP: Record<string, string> = {
  'A조': '#FACC15', // 노랑
  'B조': '#FDBA74', // 살구
  'C조': '#93C5FD', // 하늘
  'D조': '#86EFAC', // 연두
  'E조': '#F9A8D4', // 분홍
  'F조': '#C4B5FD', // 라벤더
};
const FALLBACK_POOL = Object.values(JO_MAP);
const UNASSIGNED = '#E5E7EB'; // 미배정(조 없음)

export interface JoColor { bg: string; ink: string; }

export function joColor(jo: string | null | undefined): JoColor {
  const key = (jo ?? '').trim();
  if (!key) return { bg: UNASSIGNED, ink: INK };
  if (JO_MAP[key]) return { bg: JO_MAP[key], ink: INK };
  // 미지의 조 라벨도 결정적으로 같은 색을 받도록 해시
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return { bg: FALLBACK_POOL[h % FALLBACK_POOL.length], ink: INK };
}

export interface BgPreset { id: string; label: string; bg: string; dot: string; }

// 대시보드 배경 선택지 (배경색 + 그리드 점색).
export const BG_PRESETS: BgPreset[] = [
  { id: 'navy',  label: '네이비', bg: '#0b1220', dot: '#334155' },
  { id: 'dark',  label: '다크',   bg: '#111827', dot: '#374151' },
  { id: 'light', label: '라이트', bg: '#f8fafc', dot: '#cbd5e1' },
  { id: 'green', label: '그린',   bg: '#0f2417', dot: '#2f5d43' },
];
