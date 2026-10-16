/**
 * 10/17 A–G 묶음(카드 단위) — 오전 헤쳐모여 기록과 묶음별 안. 순수 로직(vitest).
 *
 * - 묶음은 「묶음 파일」(bundles_ag_1017.json)을 importSimilarGroups 로 가져와 안(motion.group)에 붙는다.
 *   묶음 정보(이름·겹침·카드별 조)는 그 안의 group 칸에 있고, 기록(결론·참여 조·옮긴 세부권고·소수의견)은 PrepState.bundles 에 있다.
 * - 합친 문구는 따로 저장하지 않는다 — 묶음 안(들)의 제목이 곧 16:15 투표 문구다(두 곳에 두면 어긋난다).
 * - 한 묶음에서 안이 여럿 나올 수 있다(일부 카드는 합치고 나머지는 따로) — [안 더하기]는 같은 묶음 정보를 단 새 안을 만든다.
 */
import {
  BUNDLE_DECISION_LABELS,
  TEAM_NOS,
  divisionLabel,
  groupLabel,
  newMotionFields,
  nextMotionId,
  sortMotions,
  type BundleRecord,
  type Motion,
  type MotionGroup,
  type PrepState,
} from './division-vote-logic';
import { reviewerRows } from './division-reviewers';

export type BundleView = {
  id: string;
  group: MotionGroup;
  label: string;
  /** 이 묶음 정보를 단 안(안 번호 순). 첫 안이 묶음을 가져올 때 만든 안이다. */
  motions: Motion[];
  /** 카드 번호(묶음의 첫 안 기준). */
  cards: string[];
  record: BundleRecord;
};

export const EMPTY_BUNDLE_RECORD: BundleRecord = { decision: null, teams: [], movedRecs: '', minority: '' };

/** A–G 묶음(letter 가 있는 묶음)만, 글자 순. 옛 유사 묶음은 여기 나오지 않는다(안 카드에 그대로 남는다). */
export function bundleViews(state: PrepState): BundleView[] {
  const map = new Map<string, Motion[]>();
  for (const m of state.motions) {
    if (!m.group?.letter) continue;
    const list = map.get(m.group.id) ?? [];
    list.push(m);
    map.set(m.group.id, list);
  }
  return [...map.entries()]
    .map(([id, motions]) => {
      const first = motions.find((m) => m.key === `group:${id}`) ?? motions[0];
      const group = first.group as MotionGroup;
      return {
        id,
        group,
        label: groupLabel(group),
        motions,
        cards: first.cardNos,
        record: state.bundles?.[id] ?? defaultBundleRecord(group),
      };
    })
    .sort((a, b) => (a.group.letter ?? '').localeCompare(b.group.letter ?? '') || a.id.localeCompare(b.id));
}

/** 처음 기록 — 참여 조는 카드를 쓴 조로 미리 채운다(「3조」 → '3'). 아직 저장하지 않은 값이다. */
export function defaultBundleRecord(group: Pick<MotionGroup, 'cardTeams' | 'teams'>): BundleRecord {
  const raw = group.cardTeams ? Object.values(group.cardTeams) : group.teams;
  const nos = new Set(raw.map((t) => /^(\d)조$/.exec(t.trim())?.[1]).filter((x): x is string => !!x && (TEAM_NOS as readonly string[]).includes(x)));
  return { ...EMPTY_BUNDLE_RECORD, teams: TEAM_NOS.filter((t) => nos.has(t)) };
}

/** 「1-5-2 (3조)」 — 카드별 조가 없으면 번호만. */
export function cardWithTeam(group: Pick<MotionGroup, 'cardTeams'>, cardNo: string): string {
  const t = group.cardTeams?.[cardNo];
  return t ? `${cardNo} (${t})` : cardNo;
}

export function setBundleRecord(state: PrepState, id: string, patch: Partial<BundleRecord>): PrepState {
  const group = state.motions.find((m) => m.group?.id === id)?.group;
  if (!group) return state;
  const cur = state.bundles?.[id] ?? defaultBundleRecord(group);
  const next: BundleRecord = {
    decision: patch.decision !== undefined ? patch.decision : cur.decision,
    teams: patch.teams !== undefined ? TEAM_NOS.filter((t) => patch.teams!.includes(t)) : cur.teams,
    movedRecs: patch.movedRecs !== undefined ? patch.movedRecs : cur.movedRecs,
    minority: patch.minority !== undefined ? patch.minority : cur.minority,
  };
  return { ...state, bundles: { ...(state.bundles ?? {}), [id]: next } };
}

export function toggleBundleTeam(state: PrepState, id: string, team: string): PrepState {
  const group = state.motions.find((m) => m.group?.id === id)?.group;
  if (!group) return state;
  const cur = state.bundles?.[id] ?? defaultBundleRecord(group);
  const teams = cur.teams.includes(team) ? cur.teams.filter((t) => t !== team) : [...cur.teams, team];
  return setBundleRecord(state, id, { teams });
}

/**
 * 같은 묶음에 안 하나 더(일부 카드는 합치고 나머지는 따로 둘 때). 카드는 묶음 카드 전체를 참고로 단다 — 어느 카드가
 * 어느 안으로 갔는지는 제목·옮긴 세부권고 칸에 적는다. 열쇠는 `group:<id>:<n>` 이라 저장 충돌 뒤 다시 적용해도 하나만 생긴다.
 */
export function addBundleMotion(state: PrepState, id: string, n: number): { state: PrepState; motionId: string | null } {
  const key = `group:${id}:${n}`;
  const existing = state.motions.find((m) => m.key === key);
  if (existing) return { state, motionId: existing.id };
  const base = state.motions.find((m) => m.group?.id === id);
  if (!base?.group) return { state, motionId: null };
  const mid = nextMotionId(state, base.topicNo);
  const motion: Motion = {
    id: mid,
    topicNo: base.topicNo,
    cardNos: [...base.cardNos],
    title: '',
    text: '',
    ...newMotionFields(),
    group: { ...base.group, recs: [...base.group.recs], teams: [...base.group.teams], ...(base.group.cardTeams ? { cardTeams: { ...base.group.cardTeams } } : {}) },
    key,
  };
  return { state: { ...state, motions: sortMotions(state.source, [...state.motions, motion]) }, motionId: mid };
}

/** 다음 [안 더하기] 번호 — 이미 있는 `group:<id>:<n>` 의 최댓값 + 1(첫 안은 1 로 본다). */
export function nextBundleMotionNo(state: PrepState, id: string): number {
  let max = 1;
  for (const m of state.motions) {
    const hit = m.key?.startsWith(`group:${id}:`) ? Number(m.key.slice(`group:${id}:`.length)) : NaN;
    if (Number.isInteger(hit) && hit > max) max = hit;
  }
  return max + 1;
}

// ── 묶음 기록 CSV ────────────────────────────────────────────

export const BUNDLE_CSV_COLUMNS = ['분과', '묶음', '묶음 이름', '겹치는 정도', '카드(조)', '결론', '참여 조', '안번호', '합친 문구(안 제목)', '옮긴 세부권고', '소수의견'] as const;

/** 묶음마다 안 하나당 한 줄(안이 둘이면 두 줄, 기록 칸은 되풀이). */
export function bundleCsvRows(state: PrepState): string[][] {
  const rows: string[][] = [];
  for (const b of bundleViews(state)) {
    const common = [
      divisionLabel(state.division),
      b.id,
      b.label,
      b.group.level ?? '',
      b.cards.map((c) => cardWithTeam(b.group, c)).join(' '),
      b.record.decision ? BUNDLE_DECISION_LABELS[b.record.decision] : '',
      b.record.teams.map((t) => `${t}조`).join(' '),
    ];
    for (const m of b.motions) rows.push([...common, m.id, m.title, b.record.movedRecs, b.record.minority]);
  }
  // 위임 안건 검토위원(조마다 한 명) — 같은 파일 아래쪽에 「검토위원」 줄로.
  if (rows.length || state.reviewers) {
    for (const [division, team, name] of reviewerRows(state)) rows.push([division, '검토위원', team, '', '', '', '', '', name, '', '']);
  }
  return rows;
}

function cell(value: string): string {
  let v = value ?? '';
  if (/^[=+\-@]/.test(v) && !/^[+-]?\d+(\.\d+)?$/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function bundleCsvText(rows: readonly (readonly string[])[]): string {
  return `﻿${[BUNDLE_CSV_COLUMNS as readonly string[], ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
