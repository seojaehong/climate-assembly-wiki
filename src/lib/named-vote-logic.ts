/**
 * 실명 투표(10/17, s28) — 명단·대조·결과 이름표의 순수 로직. React·DOM·fetch 의존 금지(vitest).
 *
 * - 이름 대조 키는 SQL climate_vote.voter_name_norm 과 같아야 한다: 공백 전부 제거 + 소문자.
 *   화면에는 원래 이름(앞뒤 공백만 정리)을 그대로 보인다.
 * - 명단·응답 행의 모양은 s28 RPC(ballot_roster_get · ballot_named_responses_v2)의 jsonb 그대로다.
 */

export type RosterRow = { team: string; no: number | null; name: string };

export type NamedResponse = {
  id: string;
  voter_team: string | null;
  voter_name: string | null;
  voter_in_roster: boolean | null;
  answers: Record<string, number>;
  submitted_at: string;
};

export type NamedItem = { id: string; ordinal: number; statement: string; scale: number };

/** 대조 키 — SQL voter_name_norm 과 같은 규칙. */
export function normalizeVoterName(name: string | null | undefined): string {
  return (name ?? '').replace(/[\s 　]+/g, '').toLowerCase();
}

/** 저장·표시용 — 앞뒤 공백을 떼고 안쪽 공백 여러 개는 하나로. SQL 의 v_name 과 같다. */
export function displayVoterName(name: string | null | undefined): string {
  return (name ?? '').replace(/[\s 　]+/g, ' ').trim();
}

/** 「1분과 3조」 → 「3조」, 「기획참여단 분과A」 → 「분과A」. 공백이 없으면 그대로. */
export function teamShort(team: string): string {
  const parts = team.trim().split(/\s+/);
  return parts[parts.length - 1] ?? team;
}

/** 조 자연 정렬 키 — 숫자는 숫자로(2조 < 10조). */
export function compareTeam(a: string, b: string): number {
  return a.localeCompare(b, 'ko', { numeric: true });
}

function compareRow(a: RosterRow, b: RosterRow): number {
  return compareTeam(a.team, b.team) || (a.no ?? 1e9) - (b.no ?? 1e9) || a.name.localeCompare(b.name, 'ko');
}

export type RosterTeam = { team: string; short: string; names: RosterRow[] };

/** 명단을 조별로 접는다(조 자연 정렬, 조 안은 번호 → 이름). */
export function rosterTeams(rows: readonly RosterRow[]): RosterTeam[] {
  const map = new Map<string, RosterRow[]>();
  for (const r of rows) {
    const list = map.get(r.team) ?? [];
    list.push(r);
    map.set(r.team, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => compareTeam(a, b))
    .map(([team, names]) => ({ team, short: teamShort(team), names: [...names].sort(compareRow) }));
}

/** 제출 전 검사 — 조·이름 둘 다 있어야 한다. 조는 명단의 조여야 한다. */
export function voterReady(team: string | null, name: string, teams: readonly RosterTeam[]): boolean {
  return !!team && teams.some((t) => t.team === team) && normalizeVoterName(name).length > 0 && displayVoterName(name).length <= 80;
}

/** 이름이 그 조 명단에 있는가(직접 입력해도 명단과 같으면 true). */
export function inRoster(team: string | null, name: string, rows: readonly RosterRow[]): boolean {
  const key = normalizeVoterName(name);
  return !!team && rows.some((r) => r.team === team && normalizeVoterName(r.name) === key);
}

// ── 대조 ─────────────────────────────────────────────────────────────

export type OffRoster = {
  response: NamedResponse;
  /** 같은 이름이 다른 조 명단에 있으면 그 조(「조를 잘못 골랐을 수 있음」). */
  rosterTeam: string | null;
};

export type Reconciliation = {
  rosterCount: number;
  submitted: number;
  /** 명단에 있는데 이름으로 제출이 없는 사람. 거수한 분도 여기 나온다(「QR 미제출」). */
  missing: { team: string; short: string; names: RosterRow[] }[];
  missingCount: number;
  /** 조·이름 짝이 명단에 없는 제출(오타 의심). */
  offRoster: OffRoster[];
  /** 같은 이름(대조 키)으로 두 건 이상. */
  duplicates: { key: string; responses: NamedResponse[] }[];
  /** 이름이 없는 제출(실명 전 화면·옛 제출). */
  anonymous: number;
};

export function reconcile(roster: readonly RosterRow[], responses: readonly NamedResponse[]): Reconciliation {
  const byKey = new Map<string, NamedResponse[]>();
  let anonymous = 0;
  for (const r of responses) {
    const key = normalizeVoterName(r.voter_name);
    if (!key) {
      anonymous += 1;
      continue;
    }
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  const rosterPairs = new Set(roster.map((r) => `${r.team}\u0000${normalizeVoterName(r.name)}`));
  const rosterTeamOf = new Map<string, string>();
  for (const r of roster) rosterTeamOf.set(normalizeVoterName(r.name), r.team);

  const missingRows = roster.filter((r) => !byKey.has(normalizeVoterName(r.name)));
  const missing = rosterTeams(missingRows);

  const offRoster: OffRoster[] = [];
  for (const r of responses) {
    const key = normalizeVoterName(r.voter_name);
    if (!key) continue;
    if (rosterPairs.has(`${r.voter_team ?? ''}\u0000${key}`)) continue;
    offRoster.push({ response: r, rosterTeam: rosterTeamOf.get(key) ?? null });
  }
  offRoster.sort((a, b) => compareTeam(a.response.voter_team ?? '', b.response.voter_team ?? ''));

  const duplicates = [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, responses: list }));

  return {
    rosterCount: roster.length,
    submitted: responses.length,
    missing,
    missingCount: missingRows.length,
    offRoster,
    duplicates,
    anonymous,
  };
}

// ── 찬반 라벨 · 결과 이름표 ──────────────────────────────────────────

const SCALE2 = ['반대', '찬성'];

/** 응답 한 건의 문항별 라벨. 찬반(2점)은 1=반대 · 2=찬성(BallotCard 저장값). */
export function answerLabel(value: number | undefined, scale: number): string {
  if (value === undefined || value === null) return '';
  if (scale === 2) return SCALE2[value - 1] ?? String(value);
  return String(value);
}

/** CSV·목록용 — 문항 하나면 그 라벨, 여럿이면 「1:찬성 / 2:반대」. */
export function responseChoiceText(answers: Record<string, number>, items: readonly NamedItem[]): string {
  const sorted = [...items].sort((a, b) => a.ordinal - b.ordinal);
  if (sorted.length === 1) return answerLabel(answers[sorted[0].id], sorted[0].scale);
  return sorted
    .map((it) => `${it.ordinal}:${answerLabel(answers[it.id], it.scale) || '-'}`)
    .join(' / ');
}

/** 결과 화면 이름표 — 「3조 홍길동」. 이름 없는 응답은 null(수만 센다). */
export function voterTag(r: Pick<NamedResponse, 'voter_team' | 'voter_name'>): string | null {
  const name = displayVoterName(r.voter_name);
  if (!name) return null;
  return r.voter_team ? `${teamShort(r.voter_team)} ${name}` : name;
}

export type YesNoColumns = {
  yes: number;
  no: number;
  /** 이름 있는 찬성·반대 이름표(조 → 이름 순). */
  yesNames: string[];
  noNames: string[];
  /** 이름 없이 들어온 찬성·반대 수(이름표 없이 수에만 들어간다). */
  yesAnonymous: number;
  noAnonymous: number;
};

/**
 * 찬반 두 단 — 첫 찬반(2점) 문항 기준. 문항이 없거나 찬반 문항이 아니면 null.
 * 정렬은 조(자연 정렬) → 이름.
 */
export function yesNoColumns(items: readonly NamedItem[], responses: readonly NamedResponse[]): YesNoColumns | null {
  const item = [...items].sort((a, b) => a.ordinal - b.ordinal).find((it) => it.scale === 2);
  if (!item) return null;
  const yes: NamedResponse[] = [];
  const no: NamedResponse[] = [];
  for (const r of responses) {
    const v = r.answers?.[item.id];
    if (v === 2) yes.push(r);
    else if (v === 1) no.push(r);
  }
  const sortTags = (list: NamedResponse[]) =>
    list
      .filter((r) => voterTag(r) !== null)
      .sort(
        (a, b) =>
          compareTeam(a.voter_team ?? '', b.voter_team ?? '') ||
          displayVoterName(a.voter_name).localeCompare(displayVoterName(b.voter_name), 'ko'),
      )
      .map((r) => voterTag(r) as string);
  const yesNames = sortTags(yes);
  const noNames = sortTags(no);
  return {
    yes: yes.length,
    no: no.length,
    yesNames,
    noNames,
    yesAnonymous: yes.length - yesNames.length,
    noAnonymous: no.length - noNames.length,
  };
}

/**
 * 이름표 단의 글자 크기·단 수 — 1920×1080 한 화면(이름표 영역 세로 약 640px, 한 단 폭 약 900px)에
 * 스크롤 없이 들어가게. 이름이 많을수록 작게, 단을 늘린다. 가장 작아도 22px.
 */
export function nameGridLayout(count: number, height = 640): { columns: number; fontPx: number } {
  if (count <= 0) return { columns: 1, fontPx: 40 };
  for (const columns of [2, 3, 4]) {
    for (const fontPx of [40, 36, 32, 28, 26, 24]) {
      const lineH = Math.ceil(fontPx * 1.35);
      const rows = Math.floor(height / lineH);
      if (rows * columns >= count) return { columns, fontPx };
    }
  }
  const columns = 5;
  const rows = Math.ceil(count / columns);
  const fontPx = Math.max(16, Math.floor(height / rows / 1.35));
  return { columns, fontPx };
}

// ── 실명 CSV ─────────────────────────────────────────────────────────

export const NAMED_CSV_HEADER = ['투표', '조', '이름', '찬반', '명단 여부', '제출 시각(KST)'] as const;

/** 서울 시각 「2026-10-17 16:05:09」(기계 시간대와 무관). 읽을 수 없으면 원문 그대로. */
export function kstText(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** 투표 하나의 실명 CSV 행(머리행 제외). 조 → 이름 순. */
export function namedCsvRows(title: string, items: readonly NamedItem[], responses: readonly NamedResponse[]): string[][] {
  return [...responses]
    .sort(
      (a, b) =>
        compareTeam(a.voter_team ?? '', b.voter_team ?? '') ||
        displayVoterName(a.voter_name).localeCompare(displayVoterName(b.voter_name), 'ko'),
    )
    .map((r) => [
      title,
      r.voter_team ?? '',
      displayVoterName(r.voter_name),
      responseChoiceText(r.answers ?? {}, items),
      r.voter_name ? (r.voter_in_roster ? '명단' : '명단에 없음') : '이름 없음',
      kstText(r.submitted_at),
    ]);
}

function csvCell(v: string): string {
  // 엑셀 수식 주입 방지(= + - @ 로 시작) + 따옴표 처리.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 실명 CSV 전체 글(BOM + 머리행, 엑셀에서 바로 열림). */
export function namedCsvText(rows: readonly (readonly string[])[]): string {
  return `﻿${[NAMED_CSV_HEADER as readonly string[], ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * 제출자 대조 — 낸 사람 전체에서 찾기(조·이름, 공백·대소문자 무시). 빈 검색어면 전부. 조 → 이름 순.
 * 잘못 고른 이름(명단 안의 남의 이름)도 여기서 찾아 조·이름을 고친다 — 찬반은 고치지 않는다.
 */
export function searchResponses(responses: readonly NamedResponse[], query: string): NamedResponse[] {
  const q = normalizeVoterName(query);
  return responses
    .filter((r) => !q || normalizeVoterName(`${r.voter_team ?? ''}${r.voter_name ?? ''}`).includes(q) || normalizeVoterName(r.voter_name).includes(q))
    .sort(
      (a, b) =>
        compareTeam(a.voter_team ?? '', b.voter_team ?? '') ||
        displayVoterName(a.voter_name).localeCompare(displayVoterName(b.voter_name), 'ko'),
    );
}
