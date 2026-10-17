/**
 * 10/17 오전 통합 결과 시트 → 준비판(scripts/import-1017-sheet.ts). 순수 로직(vitest).
 *
 * 입력은 「묶음 기록 CSV」(bundleCsvRows / BUNDLE_CSV_COLUMNS)와 같은 모양이라 내보낸 파일을 고쳐 다시 넣을 수 있다.
 * - 파일이 기준이다: 파일에 나온 묶음의 기록 칸·안 제목·검토위원은 파일 값으로 바뀐다(빈칸이면 비운다).
 *   서버에 사람이 넣은 값이 다른 값으로 바뀌면 「덮어씀」으로 따로 세고, 스크립트는 --force 없이는 쓰지 않는다.
 * - 파일에 없는 묶음·안·분과는 건드리지 않는다. 안을 지우지 않는다.
 * - 분과 단위로 전부 아니면 전무: 오류가 하나라도 있으면 그 분과는 바꾸지 않는다.
 */
import {
  BUNDLE_DECISIONS,
  BUNDLE_DECISION_LABELS,
  TEAM_NOS,
  motionTitleRoom,
  updateMotion,
  type BundleDecision,
  type BundleRecord,
  type PrepState,
  type TeamNo,
} from './division-vote-logic';
import { BUNDLE_CSV_COLUMNS, addBundleMotion, bundleViews, nextBundleMotionNo, setBundleRecord } from './division-bundle';
import { setReviewer } from './division-reviewers';

// ── CSV 읽기 ─────────────────────────────────────────────────

/** RFC 4180 — 따옴표 안 쉼표·줄바꿈·"" 처리, BOM·CRLF 허용. 빈 줄은 버린다. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** 내보낼 때 수식 막이로 붙인 「'」를 뗀다(= + - @ 앞의 것만). */
function unguard(v: string): string {
  return /^'[=+\-@]/.test(v) ? v.slice(1) : v;
}

export type SheetRow = {
  line: number;
  division: number | null;
  divisionText: string;
  bundle: string;
  decision: string;
  teams: string;
  motionId: string;
  title: string;
  movedRecs: string;
  minority: string;
  reviewer: string;
};

/** 머리행이 BUNDLE_CSV_COLUMNS 와 글자까지 같아야 한다. 아니면 오류 문구. */
export function readSheet(text: string): { ok: true; rows: SheetRow[] } | { ok: false; message: string } {
  const table = parseCsv(text);
  if (!table.length) return { ok: false, message: '빈 파일입니다.' };
  const header = table[0].map((h) => h.trim());
  const want = [...BUNDLE_CSV_COLUMNS];
  if (header.length !== want.length || header.some((h, i) => h !== want[i])) {
    return { ok: false, message: `머리행이 다릅니다. 필요한 머리행: ${want.join(',')}` };
  }
  const rows: SheetRow[] = table.slice(1).map((r, i) => {
    const c = (k: number) => unguard(r[k] ?? '');
    const dt = c(0).trim();
    const m = /^([1-9])분과$/.exec(dt);
    return {
      line: i + 2,
      division: m ? Number(m[1]) : null,
      divisionText: dt,
      bundle: c(1).trim(),
      decision: c(5).trim(),
      teams: c(6).trim(),
      motionId: c(7).trim(),
      title: c(8),
      movedRecs: c(9),
      minority: c(10),
      reviewer: c(11),
    };
  });
  return { ok: true, rows };
}

// ── 판독 도우미 ──────────────────────────────────────────────

/** 결론 — 전체 라벨이나 앞말(합친다·옮긴다·따로 둔다), 빈칸은 null. 못 읽으면 undefined. */
export function readDecision(v: string): BundleDecision | null | undefined {
  const t = v.trim();
  if (!t) return null;
  for (const d of BUNDLE_DECISIONS) {
    const label = BUNDLE_DECISION_LABELS[d];
    if (t === label || t === label.replace(/\(.*\)$/, '') || label.startsWith(`${t}(`)) return d;
  }
  return undefined;
}

/** 참여 조 「1조 3조」·「1,3」 → ['1','3'](1~5조 순). 못 읽으면 undefined. */
export function readTeams(v: string): string[] | undefined {
  const parts = v.split(/[\s,·/]+/).map((p) => p.trim()).filter(Boolean);
  const out = new Set<string>();
  for (const p of parts) {
    const m = /^([0-9]+)조?$/.exec(p);
    if (!m || !(TEAM_NOS as readonly string[]).includes(m[1])) return undefined;
    out.add(m[1]);
  }
  return TEAM_NOS.filter((t) => out.has(t));
}

export function recNumbersIn(v: string): string[] {
  return v.match(/\b\d+-\d+-\d+-\d+\b/g) ?? [];
}

// ── 적용 ─────────────────────────────────────────────────────

export type SheetResult = {
  division: number;
  state: PrepState;
  errors: string[];
  warnings: string[];
  /** 바뀌는 것(옛 → 새). */
  changes: string[];
  /** 서버에 사람이 넣은 값이 다른 값으로 바뀌는 것 — --force 없이는 쓰지 않는다. */
  overwrites: string[];
};

const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * 한 분과 판에 그 분과 줄을 적용한다. roster = 검토위원 확인용(그 분과 「N분과 M조」 → 이름들), 없으면 확인하지 않는다.
 * 투표 기록(차수·투표)이 있는 판은 오류로 돌려준다.
 */
export function applySheet(
  current: PrepState,
  rows: readonly SheetRow[],
  roster?: ReadonlyMap<string, readonly string[]>,
): SheetResult {
  const division = current.division;
  const out: SheetResult = { division, state: current, errors: [], warnings: [], changes: [], overwrites: [] };
  const mine = rows.filter((r) => r.division === division);
  if (Object.keys(current.ballots).length || current.motions.some((m) => m.rounds.length)) {
    out.errors.push('이 분과는 투표 기록이 있어 시트로 바꾸지 않습니다.');
    return out;
  }
  const recNos = new Set(current.source.topics.flatMap((t) => t.cards.flatMap((c) => c.recs.map((r) => r.no))));
  const views = new Map(bundleViews(current).map((v) => [v.id, v]));
  let s = current;

  // 같은 안번호 두 번
  const seenIds = new Map<string, number>();
  for (const r of mine) {
    if (!r.motionId) continue;
    if (seenIds.has(r.motionId)) out.errors.push(`${r.line}행: 안번호 ${r.motionId} 가 ${seenIds.get(r.motionId)}행에도 있습니다.`);
    else seenIds.set(r.motionId, r.line);
  }

  // 묶음별 기록(같은 묶음의 줄끼리 기록 칸이 같아야 한다)
  const recordOf = new Map<string, { rec: BundleRecord; line: number }>();
  for (const r of mine) {
    if (r.bundle === '검토위원') continue;
    const v = views.get(r.bundle);
    if (!v) {
      out.errors.push(`${r.line}행: ${r.divisionText}에 묶음 「${r.bundle}」이 없습니다.`);
      continue;
    }
    const decision = readDecision(r.decision);
    if (decision === undefined) out.errors.push(`${r.line}행: 결론 「${r.decision}」 — 합친다·옮긴다·따로 둔다 중 하나여야 합니다.`);
    const teams = readTeams(r.teams);
    if (teams === undefined) out.errors.push(`${r.line}행: 참여 조 「${r.teams}」 — 1조~5조만 됩니다.`);
    const badRecs = recNumbersIn(r.movedRecs).filter((n) => !recNos.has(n));
    if (badRecs.length) out.errors.push(`${r.line}행: 옮긴 세부권고 ${badRecs.join(', ')} 는 ${division}분과 권고안에 없습니다.`);
    if (decision === undefined || teams === undefined) continue;
    const rec: BundleRecord = { decision, teams, movedRecs: r.movedRecs, minority: r.minority };
    const prev = recordOf.get(r.bundle);
    if (prev) {
      if (JSON.stringify(prev.rec) !== JSON.stringify(rec)) {
        out.errors.push(`${r.line}행: 묶음 ${r.bundle} 의 결론·참여 조·옮긴 세부권고·소수의견이 ${prev.line}행과 다릅니다(같은 묶음은 같아야 합니다).`);
      }
    } else recordOf.set(r.bundle, { rec, line: r.line });
  }

  // 안 제목(있는 안 고치기 / 없는 안 만들기)
  for (const r of mine) {
    if (r.bundle === '검토위원') continue;
    const v = views.get(r.bundle);
    if (!v) continue;
    if (!r.motionId) {
      if (!r.title.trim()) continue; // 기록만 있는 줄
      const made = addBundleMotion(s, r.bundle, nextBundleMotionNo(s, r.bundle));
      if (!made.motionId) {
        out.errors.push(`${r.line}행: 묶음 ${r.bundle}에 안을 더하지 못했습니다.`);
        continue;
      }
      s = made.state;
      if (motionTitleRoom(made.motionId, r.title) < 0) out.errors.push(`${r.line}행: ${made.motionId} 제목이 너무 깁니다(안 번호 포함 300자).`);
      s = updateMotion(s, made.motionId, { title: r.title });
      out.changes.push(`${made.motionId} 새 안(묶음 ${r.bundle}) 「${short(r.title)}」`);
      continue;
    }
    const m = s.motions.find((x) => x.id === r.motionId);
    if (!m) {
      // 「이 묶음에서 안 하나 더」와 같은 번호 규칙 — 다음 번호일 때만 만든다.
      const made = addBundleMotion(s, r.bundle, nextBundleMotionNo(s, r.bundle));
      if (!made.motionId || made.motionId !== r.motionId) {
        out.errors.push(`${r.line}행: 안번호 ${r.motionId} 가 없습니다(이 묶음에 새로 만들면 ${made.motionId ?? '?'} 입니다 — 안번호를 비우면 새로 만듭니다).`);
        continue;
      }
      s = made.state;
      if (motionTitleRoom(r.motionId, r.title) < 0) out.errors.push(`${r.line}행: ${r.motionId} 제목이 너무 깁니다(안 번호 포함 300자).`);
      s = updateMotion(s, r.motionId, { title: r.title });
      out.changes.push(`${r.motionId} 새 안(묶음 ${r.bundle}) 「${short(r.title)}」`);
      continue;
    }
    if (m.group?.id !== r.bundle) {
      out.errors.push(`${r.line}행: 안번호 ${r.motionId} 는 묶음 ${r.bundle}의 안이 아닙니다(${m.group?.id ?? '묶음 없음'}).`);
      continue;
    }
    if (motionTitleRoom(m.id, r.title) < 0) {
      out.errors.push(`${r.line}행: ${m.id} 제목이 너무 깁니다(안 번호 포함 300자).`);
      continue;
    }
    if (m.title !== r.title) {
      out.changes.push(`${m.id} 제목 「${short(m.title) || '(빈칸)'}」 → 「${short(r.title) || '(빈칸)'}」`);
      if (m.title.trim()) out.overwrites.push(`${m.id} 제목`);
      s = updateMotion(s, m.id, { title: r.title });
    }
  }

  // 기록 적용 + 따로 둔다 경고
  for (const [id, { rec }] of recordOf) {
    const v = views.get(id);
    if (!v) continue;
    const old = current.bundles?.[id];
    const before = old ?? v.record;
    const fields: (keyof BundleRecord)[] = ['decision', 'teams', 'movedRecs', 'minority'];
    for (const f of fields) {
      const a = JSON.stringify(before[f]);
      const b = JSON.stringify(rec[f]);
      if (a === b) continue;
      out.changes.push(`묶음 ${id} ${f} ${a} → ${b}`);
      // 저장된 기록(old)이 있고 사람이 넣은 값이면 덮어씀. 참여 조 미리 채움(저장 전)은 사람 입력이 아니다.
      const was = old?.[f];
      if (old && (Array.isArray(was) ? was.length : was)) out.overwrites.push(`묶음 ${id} ${f}`);
    }
    // 바뀐 것이 없으면 저장하지 않는다(미리 채운 참여 조만 있는 묶음을 「저장된 기록」으로 만들지 않게 — 왕복 시험).
    if (JSON.stringify(before) !== JSON.stringify(rec)) s = setBundleRecord(s, id, rec);
    if (rec.decision === 'separate') {
      const ms = s.motions.filter((m) => m.group?.id === id);
      if (!ms.length) out.warnings.push(`묶음 ${id}: 따로 둔다인데 안이 없습니다.`);
      else if (ms.some((m) => m.title.trim())) out.warnings.push(`묶음 ${id}: 따로 둔다인데 안 제목이 있습니다(투표에 올라갑니다).`);
    }
  }

  // 검토위원
  for (const r of mine) {
    if (r.bundle !== '검토위원') continue;
    const teams = readTeams(r.teams);
    if (!teams || teams.length !== 1) {
      out.errors.push(`${r.line}행: 검토위원 줄의 참여 조 「${r.teams}」 — 조 하나(1조~5조)여야 합니다.`);
      continue;
    }
    const t = teams[0] as TeamNo;
    const name = r.reviewer.trim();
    const old = (current.reviewers?.[t] ?? '').trim();
    if (name && roster) {
      const names = roster.get(`${division}분과 ${t}조`) ?? [];
      if (!names.some((n) => n.replace(/\s+/g, '') === name.replace(/\s+/g, ''))) out.warnings.push(`${r.line}행: 검토위원 「${name}」이 ${division}분과 ${t}조 명단에 없습니다.`);
    }
    if (old !== name) {
      out.changes.push(`검토위원 ${t}조 「${old || '(빈칸)'}」 → 「${name || '(빈칸)'}」`);
      if (old) out.overwrites.push(`검토위원 ${t}조`);
      s = setReviewer(s, t, name);
    }
  }

  out.state = out.errors.length ? current : s;
  return out;
}

/** 파일 전체 점검 — 모르는 분과 줄. */
export function sheetFileErrors(rows: readonly SheetRow[], divisions: readonly number[]): string[] {
  return rows
    .filter((r) => r.division === null || !divisions.includes(r.division))
    .map((r) => `${r.line}행: 분과 「${r.divisionText}」 — 이 세션 분과(${divisions.map((d) => `${d}분과`).join('·')})가 아닙니다.`);
}

export { BUNDLE_DECISIONS };
