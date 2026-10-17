/**
 * 세리머니 마지막 요약(10/17 v2) — 가결 목록·부결 목록·위임 의결 줄이 1920×1080 한 화면에서 겹치지 않게
 * 글자 크기와 단 수를 정한다. 줄마다 한 줄(넘치면 말줄임)이라 높이는 줄 수로만 정해진다. 순수 로직(vitest).
 */
import type { CeremonyItem } from './division-vote-logic';

/** 목록 두 개에 쓸 수 있는 세로(px) — 1080 − 머리·발판·제목·부결 머리·위임 줄·사이 간격. */
export const SUMMARY_LIST_BUDGET = 540;

export function summaryLayout(passed: number, failed: number, budget = SUMMARY_LIST_BUDGET): { columns: number; fontPx: number; lineH: number } {
  for (const columns of [1, 2, 3]) {
    const rows = Math.ceil(passed / columns) + Math.ceil(failed / columns);
    for (const fontPx of [34, 30, 28, 26, 24, 22]) {
      const lineH = Math.ceil(fontPx * 1.3);
      if (rows * lineH <= budget) return { columns, fontPx, lineH };
    }
  }
  const columns = 3;
  const rows = Math.max(1, Math.ceil(passed / columns) + Math.ceil(failed / columns));
  const lineH = Math.floor(budget / rows);
  return { columns, fontPx: Math.max(14, Math.floor(lineH / 1.3)), lineH };
}

/** 머리줄 「안 k / N」 — 정책 권고안만 센다. 위임 의결 단계는 번호 없이 이름만. */
export function ceremonyCounter(items: readonly Pick<CeremonyItem, 'kind'>[], index: number): string | null {
  const it = items[index];
  if (!it) return null;
  if (it.kind === 'delegation') return '문구 작성 위임 의결';
  const total = items.filter((i) => i.kind !== 'delegation').length;
  const k = items.slice(0, index + 1).filter((i) => i.kind !== 'delegation').length;
  return `안 ${k} / ${total}`;
}
