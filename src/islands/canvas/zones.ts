// 감축/적응/미분류 = 카테고리 프레임(=zone). 카드를 프레임 영역에 놓으면 그 zone이 된다.
// React Flow 중첩 부모노드 대신, 큰 배경 프레임 노드 + x좌표 기반 zone 판정(절대좌표 유지).

export interface ZoneFrame { zone: string; x: number; w: number; bg: string; label: string; }

export const FRAME_Y = -60;
export const FRAME_H = 820;

export const ZONE_FRAMES: ZoneFrame[] = [
  { zone: '감축',   x: -40,   w: 600, bg: 'rgba(34,197,94,.08)',   label: '감축' },
  { zone: '적응',   x: 600,   w: 600, bg: 'rgba(59,130,246,.08)',  label: '적응' },
  { zone: '미분류', x: 1240,  w: 600, bg: 'rgba(148,163,184,.12)', label: '미분류' },
];

// 카드 중심 x → 어느 zone 프레임에 속하는지. 범위 밖이면 중심이 가장 가까운 프레임.
export function zoneForX(x: number): string {
  for (const f of ZONE_FRAMES) {
    if (x >= f.x && x < f.x + f.w) return f.zone;
  }
  let best = ZONE_FRAMES[0];
  let bestDist = Infinity;
  for (const f of ZONE_FRAMES) {
    const center = f.x + f.w / 2;
    const d = Math.abs(x - center);
    if (d < bestDist) { bestDist = d; best = f; }
  }
  return best.zone;
}
