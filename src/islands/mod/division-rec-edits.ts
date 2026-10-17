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

/** 투표 문항 설명(휴대폰 「세부권고 보기」) — 처리 표시를 붙인 전부(삭제·옮겨 간 것도 표시해 남긴다). 서버 설명 칸에 들어간다. */
export function recDescription(list: readonly DisplayRec[]): string {
  return list.map((d, i) => recPlainLine(recView(d, i))).join('\n');
}


// ── 화면 표시(큰 화면·휴대폰·운영) ─────────────────────────────

export type RecView = { key: string; mark: RecMark; tag: string; no: string | null; text: string; struck: boolean };

/** 한 줄 표시값 — 표시(tag)는 수정·삭제·→ 대상·← 원번호·추가, 유지는 빈칸. */
export function recView(d: DisplayRec, i = 0): RecView {
  const tag =
    d.mark === 'edited' ? '수정' : d.mark === 'deleted' ? '삭제' : d.mark === 'moved-out' ? `→ ${d.ref}` : d.mark === 'incoming' ? `← ${d.ref}` : d.mark === 'added' ? '추가' : '';
  const no = d.mark === 'incoming' || d.mark === 'added' ? null : d.no;
  return { key: `${d.mark}:${d.no ?? 'add'}:${i}`, mark: d.mark, tag, no, text: d.text, struck: d.mark === 'deleted' || d.mark === 'moved-out' };
}

/** 안(카드 여럿일 수 있다)의 세부권고 표시 목록 — 처리 기록이 없으면 빈 배열(옛 판은 아무것도 안 그린다). */
export function motionRecViews(source: RecsDivision, edits: readonly RecEdit[] | undefined, cardNos: readonly string[]): RecView[] {
  if (!edits) return [];
  return cardNos.flatMap((c) => cardRecList(source, edits, c)).map((d, i) => recView(d, i));
}

/**
 * 큰 화면 맞춤 — 줄 수에 따라 글자 크기를 줄이고, 그래도 넘으면 앞 max 개만 + 「외 N개」.
 * 한 줄은 두 줄까지만 보인다(넘으면 말줄임). 1920×1080 QR 화면 왼쪽 단(약 840px × 600px) 기준.
 */
export function fitRecViews(views: readonly RecView[], room: 'qr' | 'result' = 'qr'): { items: RecView[]; more: number; fontPx: number } {
  const n = views.length;
  const steps = room === 'qr' ? [[4, 28], [6, 24], [8, 21], [10, 19]] : [[4, 30], [6, 26], [9, 22], [12, 20]];
  const max = steps[steps.length - 1][0];
  const fontPx = (steps.find(([k]) => n <= k) ?? steps[steps.length - 1])[1];
  if (n <= max) return { items: [...views], more: 0, fontPx };
  return { items: views.slice(0, max - 1), more: n - (max - 1), fontPx };
}

/** 휴대폰·글 한 줄(꺾쇠 표시). */
export function recPlainLine(v: RecView): string {
  const head = v.tag ? `[${v.tag}] ` : '';
  return `${head}${v.no ? `${v.no} ` : ''}${v.text}`;
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

// ── 판에 적용(가져오기) ─────────────────────────────────────

export type RecEditPlan = RecEditCheck & {
  division: number;
  /** 카드마다 남은 세부권고 수(이전 → 이후), 바뀐 카드만. */
  cardDiff: { card: string; before: number; after: number }[];
  /** 처리 줄 변화(새로 생김·바뀜·없어짐). */
  changes: string[];
  /** 남은 세부권고가 없어진 카드(투표 제외 후보). */
  emptied: string[];
  state: import('./division-vote-logic').PrepState;
};

const editKey = (e: RecEdit) => (e.no ? `n:${e.no}` : `a:${e.card}:${e.text}`);
const editText = (e: RecEdit) => `${e.no ?? `${e.card} 추가`} ${e.action}${e.target ? ` → ${e.target}` : ''}${e.text ? ` 「${e.text.length > 40 ? `${e.text.slice(0, 40)}…` : e.text}」` : ''}`;

/**
 * 한 분과 판에 검토표를 적용한다 — 그 분과의 세부권고 처리 목록을 파일 것으로 통째로 바꾼다(전부 아니면 전무).
 * 투표 기록이 있는 판은 오류.
 */
export function planRecEdits(current: import('./division-vote-logic').PrepState, rows: readonly RecEditRow[]): RecEditPlan {
  const check = checkRecEdits(current.source, rows);
  const plan: RecEditPlan = { ...check, division: current.division, cardDiff: [], changes: [], emptied: [], state: current };
  if (Object.keys(current.ballots).length || current.motions.some((m) => m.rounds.length)) {
    plan.errors.unshift('이 분과는 투표 기록이 있어 바꾸지 않습니다.');
    return plan;
  }
  if (check.errors.length) return plan;
  const before = current.recEdits ?? [];
  const after = check.edits;
  const bMap = new Map(before.map((e) => [editKey(e), e]));
  const aMap = new Map(after.map((e) => [editKey(e), e]));
  for (const [k, e] of aMap) {
    const old = bMap.get(k);
    if (!old) plan.changes.push(`새로 ${editText(e)}`);
    else if (JSON.stringify(old) !== JSON.stringify(e)) plan.changes.push(`바뀜 ${editText(old)} → ${editText(e)}`);
  }
  for (const [k, e] of bMap) if (!aMap.has(k)) plan.changes.push(`없어짐 ${editText(e)}(유지로 돌아감)`);
  for (const c of current.source.topics.flatMap((t) => t.cards)) {
    const b = remainingRecs(cardRecList(current.source, before, c.no)).length;
    const a = remainingRecs(cardRecList(current.source, after, c.no)).length;
    if (a !== b || JSON.stringify(cardRecList(current.source, before, c.no)) !== JSON.stringify(cardRecList(current.source, after, c.no))) {
      plan.cardDiff.push({ card: c.no, before: b, after: a });
    }
  }
  plan.emptied = emptiedCards(current.source, after);
  plan.state = { ...current, recEdits: after.map((e) => ({ ...e })) };
  return plan;
}
