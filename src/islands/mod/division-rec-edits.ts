/**
 * 10/17 오후 — 카드(3자리) 하나씩 투표. 오전 검토표의 세부권고(4자리) 처리 결과를 준비판에 두고,
 * 카드마다 「지금 남은 세부권고」 목록을 만든다. 순수 로직(vitest).
 *
 * 처리: 유지(빈칸) · 수정 · 삭제 · 이관 · 흡수 · 추가.
 * - 수정: 수정 문구로 바뀐다. 삭제: 지운다(목록에 줄 그어 남긴다).
 * - 이관·흡수: 대상 번호(카드 x-y-z 또는 세부권고 x-y-z-w, 같은 분과)로 옮긴다 — 원래 카드에는 「→ 대상」으로 줄 그어 남고,
 *   대상 카드에는 「← 원번호」로 들어간다(수정 문구가 있으면 그 글, 없으면 원문).
 * - 추가: 세부권고 번호가 없다 — 그 줄의 권고카드에 수정 문구가 새 세부권고로 붙는다.
 */
import type { RecsDivision } from './division-vote-logic';

export const REC_ACTIONS = ['유지', '수정', '삭제', '이관', '흡수', '추가'] as const;
export type RecAction = (typeof REC_ACTIONS)[number];

export type RecEdit = {
  /** 세부권고 번호. 추가는 null. */
  no: string | null;
  /** 그 줄의 권고카드(3자리). */
  card: string;
  action: RecAction;
  text: string;
  target: string;
  note: string;
};

export type RecMark = 'keep' | 'edited' | 'deleted' | 'moved-out' | 'incoming' | 'added';

export type DisplayRec = {
  /** 원래 세부권고 번호(추가는 null). */
  no: string | null;
  text: string;
  mark: RecMark;
  /** moved-out: 옮겨 간 곳 · incoming: 원래 번호. */
  ref?: string;
  /** 이관·흡수 중 무엇이었나(moved-out·incoming). */
  via?: '이관' | '흡수';
};

export const cardOfRec = (no: string): string => no.split('-').slice(0, 3).join('-');
const isCardNo = (s: string) => /^\d+-\d+-\d+$/.test(s);
const isRecNo = (s: string) => /^\d+-\d+-\d+-\d+$/.test(s);
const MOVES: readonly RecAction[] = ['이관', '흡수'];

function recIndex(source: RecsDivision): Map<string, { card: string; text: string }> {
  const m = new Map<string, { card: string; text: string }>();
  for (const t of source.topics) for (const c of t.cards) for (const r of c.recs) m.set(r.no, { card: c.no, text: r.text });
  return m;
}

/** 대상 번호가 가리키는 카드(카드 번호면 그대로, 세부권고면 그 카드). */
export function targetCard(target: string): string | null {
  const t = target.trim();
  if (isCardNo(t)) return t;
  if (isRecNo(t)) return cardOfRec(t);
  return null;
}

/** 카드 하나에 지금 보일 세부권고 목록 — 자기 세부권고(처리 반영) → 옮겨 온 것 → 추가. */
export function cardRecList(source: RecsDivision, edits: readonly RecEdit[], cardNo: string): DisplayRec[] {
  const idx = recIndex(source);
  const byNo = new Map(edits.filter((e) => e.no).map((e) => [e.no as string, e]));
  const card = source.topics.flatMap((t) => t.cards).find((c) => c.no === cardNo);
  const out: DisplayRec[] = [];
  for (const r of card?.recs ?? []) {
    const e = byNo.get(r.no);
    const action = e?.action ?? '유지';
    if (action === '수정' && e?.text.trim()) out.push({ no: r.no, text: e.text.trim(), mark: 'edited' });
    else if (action === '삭제') out.push({ no: r.no, text: r.text, mark: 'deleted' });
    else if (MOVES.includes(action) && e) out.push({ no: r.no, text: r.text, mark: 'moved-out', ref: e.target.trim(), via: action as '이관' | '흡수' });
    else out.push({ no: r.no, text: r.text, mark: 'keep' });
  }
  for (const e of edits) {
    if (!e.no || !MOVES.includes(e.action)) continue;
    if (targetCard(e.target) !== cardNo || cardOfRec(e.no) === cardNo) continue;
    out.push({ no: e.no, text: e.text.trim() || idx.get(e.no)?.text || '', mark: 'incoming', ref: e.no, via: e.action as '이관' | '흡수' });
  }
  for (const e of edits) {
    if (e.action === '추가' && e.card === cardNo && e.text.trim()) out.push({ no: null, text: e.text.trim(), mark: 'added' });
  }
  return out;
}

/** 남은(투표에 올라가는) 세부권고 — 삭제·옮겨 간 것 빼고. */
export function remainingRecs(list: readonly DisplayRec[]): DisplayRec[] {
  return list.filter((d) => d.mark !== 'deleted' && d.mark !== 'moved-out');
}

/** 자기 세부권고가 모두 빠졌고 옮겨 온 것·추가도 없는 카드 — 「남은 세부권고 없음 — 투표 제외 후보」. */
export function emptiedCards(source: RecsDivision, edits: readonly RecEdit[]): string[] {
  return source.topics
    .flatMap((t) => t.cards)
    .filter((c) => c.recs.length > 0 && remainingRecs(cardRecList(source, edits, c.no)).length === 0)
    .map((c) => c.no);
}

const MARK_TEXT: Record<RecMark, string> = { keep: '', edited: '수정', deleted: '삭제', 'moved-out': '', incoming: '', added: '추가' };

/** 한 줄 글(큰 화면·휴대폰·CSV). */
export function recLine(d: DisplayRec): string {
  if (d.mark === 'moved-out') return `${d.no} → ${d.ref}(으)로 ${d.via === '흡수' ? '흡수' : '이동'}`;
  if (d.mark === 'incoming') return `← ${d.ref}에서 옮겨 옴: ${d.text}`;
  if (d.mark === 'added') return `추가: ${d.text}`;
  if (d.mark === 'deleted') return `${d.no} 삭제`;
  return `${d.no}${MARK_TEXT[d.mark] ? ` (${MARK_TEXT[d.mark]})` : ''} ${d.text}`;
}

/** 큰 화면·휴대폰용 — 남은 세부권고만, 최대 max 줄, 넘으면 「외 N개」. */
export function compactRecLines(list: readonly DisplayRec[], max: number): string[] {
  const rem = remainingRecs(list);
  const lines = rem.slice(0, max).map(recLine);
  if (rem.length > max) lines.push(`외 ${rem.length - max}개`);
  return lines;
}

/** 투표 문항 설명(휴대폰) — 남은 세부권고 전부를 줄바꿈으로. 서버 설명 칸에 들어간다. */
export function recDescription(list: readonly DisplayRec[]): string {
  return remainingRecs(list).map(recLine).join('\n');
}

// ── 검토표 CSV 판독·점검 ─────────────────────────────────────

export const REC_EDIT_CSV_COLUMNS = ['분과', '묶음', '권고카드', '세부권고 번호', '처리', '수정 문구', '이관·흡수 대상 번호', '비고(소수의견)'] as const;

export type RecEditRow = { line: number; division: number | null; divisionText: string; edit: RecEdit; rawAction: string };

/** 머리행 글자까지 같아야 한다. 빈 처리 = 유지. */
export function readRecEditTable(table: string[][]): { ok: true; rows: RecEditRow[] } | { ok: false; message: string } {
  if (!table.length) return { ok: false, message: '빈 파일입니다.' };
  const header = table[0].map((h) => h.trim());
  const want = [...REC_EDIT_CSV_COLUMNS];
  if (header.length !== want.length || header.some((h, i) => h !== want[i])) {
    return { ok: false, message: `머리행이 다릅니다. 필요한 머리행: ${want.join(',')}` };
  }
  const rows = table.slice(1).map((r, i) => {
    const c = (k: number) => (r[k] ?? '').trim();
    const dt = c(0);
    const m = /^([1-9])분과$/.exec(dt);
    const raw = c(4);
    return {
      line: i + 2,
      division: m ? Number(m[1]) : null,
      divisionText: dt,
      rawAction: raw,
      edit: { no: c(3) || null, card: c(2), action: (raw || '유지') as RecAction, text: (r[5] ?? '').trim(), target: c(6), note: (r[7] ?? '').trim() },
    };
  });
  return { ok: true, rows };
}

export type RecEditCheck = { errors: string[]; warnings: string[]; edits: RecEdit[] };

/** 한 분과 줄 점검 — 오류가 하나라도 있으면 그 분과는 쓰지 않는다. 유지 줄은 저장하지 않는다(빈 처리와 같다). */
export function checkRecEdits(source: RecsDivision, rows: readonly RecEditRow[]): RecEditCheck {
  const out: RecEditCheck = { errors: [], warnings: [], edits: [] };
  const idx = recIndex(source);
  const cards = new Set(source.topics.flatMap((t) => t.cards.map((c) => c.no)));
  const seen = new Map<string, number>();
  const mine = rows.filter((r) => r.division === source.division);
  for (const r of mine) {
    const e = r.edit;
    const where = `${r.line}행`;
    if (!REC_ACTIONS.includes(e.action)) {
      out.errors.push(`${where}: 처리 「${r.rawAction}」 — 유지·수정·삭제·이관·흡수·추가 중 하나여야 합니다.`);
      continue;
    }
    if (!cards.has(e.card)) out.errors.push(`${where}: 권고카드 ${e.card || '(빈칸)'} 가 ${source.division}분과에 없습니다.`);
    if (e.action === '추가') {
      if (e.no) out.errors.push(`${where}: 추가 줄은 세부권고 번호를 비웁니다(${e.no}).`);
      if (!e.text) out.errors.push(`${where}: 추가인데 수정 문구(새 세부권고)가 없습니다.`);
    } else {
      if (!e.no || !idx.has(e.no)) {
        out.errors.push(`${where}: 세부권고 ${e.no || '(빈칸)'} 가 ${source.division}분과에 없습니다.`);
        continue;
      }
      if (idx.get(e.no)!.card !== e.card) out.errors.push(`${where}: 세부권고 ${e.no} 는 권고카드 ${e.card} 의 것이 아닙니다.`);
      if (seen.has(e.no)) out.errors.push(`${where}: 세부권고 ${e.no} 가 ${seen.get(e.no)}행에도 있습니다.`);
      seen.set(e.no, r.line);
    }
    if (e.action === '수정' && !e.text) out.errors.push(`${where}: 수정인데 수정 문구가 없습니다.`);
    if (MOVES.includes(e.action)) {
      if (!e.target) out.errors.push(`${where}: ${e.action}인데 대상 번호가 없습니다.`);
      else {
        const tc = targetCard(e.target);
        const ok = tc && (isCardNo(e.target) ? cards.has(e.target) : idx.has(e.target));
        if (!ok) {
          const other = tc && !tc.startsWith(`${source.division}-`);
          out.errors.push(`${where}: 대상 ${e.target} ${other ? '은 다른 분과입니다(분과를 넘는 이관·흡수는 안 됩니다).' : `가 ${source.division}분과에 없습니다.`}`);
        } else if (e.no && (e.target === e.no || (isCardNo(e.target) && e.target === cardOfRec(e.no)))) {
          out.errors.push(`${where}: ${e.no} 의 대상이 자기 자신(또는 자기 카드)입니다.`);
        }
      }
    } else if (e.target && e.action !== '유지') out.warnings.push(`${where}: ${e.action}인데 대상 번호(${e.target})가 있어 무시합니다.`);
    if (e.action !== '유지') out.edits.push({ ...e });
  }
  // 맞바꾸기(a → b 카드, b → a 카드) — 경고
  const moves = out.edits.filter((e) => e.no && MOVES.includes(e.action));
  for (const a of moves) {
    for (const b of moves) {
      if (a === b || (a.no as string) > (b.no as string)) continue;
      if (targetCard(a.target) === cardOfRec(b.no as string) && targetCard(b.target) === cardOfRec(a.no as string)) {
        out.warnings.push(`${a.no} → ${a.target} 와 ${b.no} → ${b.target} 가 서로 옮깁니다(맞바꾸기). 맞는지 확인하십시오.`);
      }
    }
  }
  return out;
}
