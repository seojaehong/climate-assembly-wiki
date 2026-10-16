/**
 * 10/17 14:45 문구 조정 — 세부권고마다 전문가 검토 의견(expert_1017.json: { "1-1-1-1": ["②[…] …", …] }).
 * 공개 번들에 넣지 않는다 — 로더가 서버 준비판의 원천(source.recs[].expert)에 붙인다. 순수 로직(vitest).
 */
import type { PrepState } from './division-vote-logic';

export type ExpertCategory = 1 | 2 | 3 | 4 | 0;

export const EXPERT_CATEGORY_LABELS: Record<ExpertCategory, string> = {
  1: '① 기술적으로 불가능',
  2: '② 추가·보완 필요',
  3: '③ 기시행 정책',
  4: '④ 기타',
  0: '분류 없음',
};

const MARKS: Record<string, ExpertCategory> = { '①': 1, '②': 2, '③': 3, '④': 4 };

/** 의견 한 줄 → 분류·꼬리표(「[추가·보완이 꼭 필요한 제안]」)·본문. 맨 앞 ①~④가 없으면 분류 없음(0). */
export function parseExpert(line: string): { cat: ExpertCategory; tag: string; body: string } {
  const t = line.trim();
  const cat = MARKS[t[0]] ?? 0;
  let rest = cat ? t.slice(1).trim() : t;
  let tag = '';
  const m = /^\[([^\]]{1,40})\]\s*/.exec(rest);
  if (m) {
    tag = m[1];
    rest = rest.slice(m[0].length);
  }
  return { cat, tag, body: rest };
}

/** 분류별 수(화면 요약 「②3 ③1」). */
export function expertTally(lines: readonly string[]): Partial<Record<ExpertCategory, number>> {
  const out: Partial<Record<ExpertCategory, number>> = {};
  for (const l of lines) {
    const c = parseExpert(l).cat;
    out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

/** expert_1017.json 판독 — { 세부번호: 문자열 배열 }. 모양이 틀리면 null. */
export function parseExpertFile(text: string): Record<string, string[]> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return null;
    out[k] = v.map((x) => x.trim()).filter(Boolean);
  }
  return out;
}

/**
 * 준비판 원천의 세부권고에 의견을 붙인다(파일에 있는 번호만, 덮어씀). 몇 번 돌려도 결과가 같다.
 * 원천에 없는 번호는 unknown 으로 돌려준다(다른 분과 번호는 세지 않는다 — 분과 접두사로 거른다).
 */
export function attachExpertOpinions(
  state: PrepState,
  opinions: Readonly<Record<string, readonly string[]>>,
): { state: PrepState; attached: number; unknown: string[] } {
  const prefix = `${state.division}-`;
  const known = new Set<string>();
  let attached = 0;
  const topics = state.source.topics.map((t) => ({
    ...t,
    cards: t.cards.map((c) => ({
      ...c,
      recs: c.recs.map((r) => {
        known.add(r.no);
        const list = opinions[r.no];
        if (!list) return r;
        attached += 1;
        return { ...r, expert: [...list] };
      }),
    })),
  }));
  const unknown = Object.keys(opinions).filter((k) => k.startsWith(prefix) && !known.has(k));
  return { state: { ...state, source: { ...state.source, topics } }, attached, unknown };
}
