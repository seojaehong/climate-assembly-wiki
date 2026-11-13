/**
 * 11/14 의결 — 운영 스태프 단톡방에 보낼 「투표 독려(미제출자)」 문구(순수 함수, I/O 없음).
 *
 * 입력 = ballot_named_responses_v2 응답의 roster · responses · starts.
 * ★ 찬반은 절대 넣지 않는다(16:30 공개 전). 제출 수와 이름만.
 * ★ 판정 키는 (조, 이름). 명단에 같은 이름이 둘 이상이면 이름만으로 「냈다」고 보지 않는다
 *   (named-vote-logic.reconcile 은 이름만 보므로 동명이인 한쪽이 내면 다른 쪽이 목록에서 빠진다).
 *   명단에 하나뿐인 이름은 조를 다르게 골라 냈어도 낸 것으로 본다.
 * 출력 층 ① 투표 시작했는데 아직 안 냄(오래된 순) ② 아직 시작 안 함(조별).
 * 「뺄 사람」(불참 확인 · 서면 투표 · 태블릿 대리 등)은 exclude 로 받아 목록에서 뺀다.
 * ★ 수정 표(11/13 결정) — 진행요원이 대리 입력으로 낸 「이름(수정)」은 같은 조의 원래 사람에 붙인다
 *   (제출 1번 · 명단 밖 · 기기 경고 없음). 같은 조에 원래 사람이 없으면 ③ 「확인 필요」로 띄운다.
 */
import { correctionBase } from './result-v2.mjs';

/** 공백 정리 + 소문자(영문) — 이름 비교용. */
export function normName(name) {
  return String(name ?? '').replace(/[\s 　]+/g, '').toLowerCase();
}

function normTeam(team) {
  return String(team ?? '').replace(/[\s 　]+/g, ' ').trim();
}

/** 판정 키 — 조는 공백을 전부 지워 비교한다(「1분과1조」 = 「1분과 1조」). 표시는 normTeam. */
export function personKey(team, name) {
  return `${normTeam(team).replace(/\s/g, '')}|${normName(name)}`;
}

function compareTeam(a, b) {
  return a.localeCompare(b, 'ko', { numeric: true });
}

/** 「HH:MM」 KST. */
export function kstHm(iso) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * 마감 시각(KST 「HH:MM」) → 「남은 시간 7분」. 비었거나 잘못되면 ''. 지났으면 「마감 시각 지남」.
 */
export function remainText(deadlineHm, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(deadlineHm ?? '').trim());
  if (!m) return '';
  const d = now instanceof Date ? now : new Date(now);
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const nowMin = k.getUTCHours() * 60 + k.getUTCMinutes() + k.getUTCSeconds() / 60;
  const left = Number(m[1]) * 60 + Number(m[2]) - nowMin;
  if (left <= 0) return '마감 시각 지남';
  return `남은 시간 ${Math.ceil(left)}분`;
}

/**
 * exclude 한 줄 =「조|이름」 또는 「이름」(이름만 쓰면 그 이름 전부).
 * @returns {(team: string, name: string) => boolean}
 */
export function excluder(exclude = []) {
  const keys = new Set();
  const names = new Set();
  for (const raw of exclude) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const i = s.indexOf('|');
    if (i >= 0) keys.add(personKey(s.slice(0, i), s.slice(i + 1)));
    else names.add(normName(s));
  }
  return (team, name) => keys.has(personKey(team, name)) || names.has(normName(name));
}

/**
 * @param {{ roster: {team:string,no?:number|null,name:string}[],
 *           responses: {voter_team:string|null,voter_name:string|null}[],
 *           starts?: {voter_team:string,voter_name:string,started_at:string}[],
 *           exclude?: string[] }} input
 */
export function chaseState({ roster, responses, starts = [], exclude = [], itemCount = null, signed = [], checks = [] }) {
  const isExcluded = excluder(exclude);
  // 의결 서명 명단(현장 마감 명부) — 있으면 그 사람만 독려 대상 · 분모. 없으면 명단 전원(지금과 같음).
  const signedLines = signed.map((s) => String(s ?? '').trim()).filter(Boolean);
  const useSigned = signedLines.length > 0;
  const isSigned = excluder(signedLines);
  let unsigned = 0;
  let signedCount = 0;
  let submittedSigned = 0;
  const unsignedSubmit = []; // 서명 명단에 없는데 제출 — ③ 로 올린다.
  const nameCount = new Map();
  for (const r of roster) nameCount.set(normName(r.name), (nameCount.get(normName(r.name)) ?? 0) + 1);
  const rosterKeys = new Set(roster.map((r) => personKey(r.team, r.name)));
  const rosterNameOf = new Map(roster.map((r) => [personKey(r.team, r.name), String(r.name).trim()]));

  // 수정 표(「이름(수정)」)를 따로 가른다. 원래 사람 = 같은 조에 명단 줄이 있거나, (수정) 아닌 시작·제출 줄이 있는 (조, 기준 이름).
  const isCorr = (name) => !!normName(name) && correctionBase(name) != null;
  const plainResponses = responses.filter((r) => !isCorr(r.voter_name));
  const corrResponses = responses.filter((r) => isCorr(r.voter_name));
  const plainStarts = starts.filter((s) => !isCorr(s.voter_name));
  const corrStarts = starts.filter((s) => isCorr(s.voter_name));
  const ownKeys = new Set(rosterKeys);
  for (const r of plainResponses) if (normName(r.voter_name)) ownKeys.add(personKey(r.voter_team, r.voter_name));
  for (const s of plainStarts) ownKeys.add(personKey(s.voter_team, s.voter_name));

  const submittedKeys = new Set();
  const submittedNames = new Set();
  let submitted = 0;
  for (const r of plainResponses) {
    if (!normName(r.voter_name)) continue; // 이름 없는 제출은 사람에 못 붙인다
    submitted += 1;
    submittedKeys.add(personKey(r.voter_team, r.voter_name));
    submittedNames.add(normName(r.voter_name));
  }
  const didSubmit = (team, name) =>
    submittedKeys.has(personKey(team, name)) || (nameCount.get(normName(name)) === 1 && submittedNames.has(normName(name)));

  // 수정 표 제출 — 같은 조 원래 사람에 붙인다(원래 표가 있으면 제출 수 그대로, 없으면 그 사람 1번).
  const corrMap = new Map(); // 원래 사람 키 → 수정 표 요약
  const corrChecks = []; // 같은 조에 원래 사람이 없는 (수정) — 붙이지 않고 ③ 확인 필요
  const corrRawSeen = new Set(); // 제출된 (수정) 줄(조, 원래 이름 그대로) — 같은 줄의 시작 기록은 다시 보지 않는다
  for (const r of corrResponses) {
    const base = correctionBase(r.voter_name);
    const k = personKey(r.voter_team, base);
    corrRawSeen.add(personKey(r.voter_team, r.voter_name));
    if (!ownKeys.has(k)) {
      submitted += 1; // 지금처럼 제출 1(명단 밖 제출과 같다) — 사람에는 안 붙인다
      corrChecks.push({ team: normTeam(r.voter_team), name: String(r.voter_name).trim(), devices: 0, offRoster: false, submitted: true, proxy: !!r.proxy, correction: true });
      continue;
    }
    let c = corrMap.get(k);
    if (!c) {
      c = { key: k, team: normTeam(r.voter_team), name: rosterNameOf.get(k) ?? base, submitted_at: null, count: 0, devices: 0, hadOriginal: didSubmit(r.voter_team, base) };
      corrMap.set(k, c);
    }
    c.count += Math.max(1, Number(r.correction_count) || 1);
    c.devices = Math.max(c.devices, Number(r.devices) || 0);
    if (r.submitted_at && (!c.submitted_at || r.submitted_at > c.submitted_at)) c.submitted_at = r.submitted_at;
  }
  for (const c of corrMap.values()) {
    if (c.hadOriginal) continue;
    submitted += 1; // 원래 표 없이 수정 표만 — 그 사람을 한 번 센다
    submittedKeys.add(c.key);
  }
  const corrections = [...corrMap.values()]
    .map((c) => {
      const why = [];
      if (!c.hadOriginal) why.push('원래 표 없음');
      if (c.count >= 2) why.push(`수정 ${c.count}건`);
      if (c.devices >= 2) why.push(`수정 기기 ${c.devices}대`);
      return { team: c.team, name: c.name, submitted_at: c.submitted_at, hadOriginal: c.hadOriginal, count: c.count, needsCheck: why.length > 0, note: why.join(', ') };
    })
    .sort((a, b) => compareTeam(a.team, b.team) || a.name.localeCompare(b.name, 'ko'));

  // 수정 표 진행 중(아직 미제출) — 같은 조 원래 사람의 시작으로 합친다. 원래 사람이 없으면 ③.
  const mergedStarts = [...plainStarts];
  for (const s of corrStarts) {
    if (corrRawSeen.has(personKey(s.voter_team, s.voter_name))) continue;
    const base = correctionBase(s.voter_name);
    const k = personKey(s.voter_team, base);
    if (!ownKeys.has(k)) {
      corrChecks.push({ team: normTeam(s.voter_team), name: String(s.voter_name).trim(), devices: 0, offRoster: false, submitted: false, proxy: false, correction: true });
      continue;
    }
    mergedStarts.push({ ...s, voter_name: rosterNameOf.get(k) ?? base, voter_in_roster: rosterKeys.has(k) });
  }

  // 시작 기록: (조, 이름)별 가장 이른 시각(누른 건수는 큰 쪽 — 원래 기기와 대리 입력을 합친다).
  const startOf = new Map();
  for (const s of mergedStarts) {
    const k = personKey(s.voter_team, s.voter_name);
    const prev = startOf.get(k);
    if (!prev) startOf.set(k, s);
    else {
      const first = s.started_at < prev.started_at ? s : prev;
      const a = Math.max(Number(prev.answered_count) || 0, Number(s.answered_count) || 0);
      startOf.set(k, Number.isFinite(first.answered_count) || a ? { ...first, answered_count: a } : first);
    }
  }
  const startedByName = new Map();
  for (const s of startOf.values()) {
    const n = normName(s.voter_name);
    const prev = startedByName.get(n);
    if (!prev || s.started_at < prev.started_at) startedByName.set(n, s);
  }
  const startFor = (team, name) =>
    startOf.get(personKey(team, name)) ?? (nameCount.get(normName(name)) === 1 ? startedByName.get(normName(name)) : undefined);

  const waiting = []; // ① 시작했는데 안 냄
  const notStarted = new Map(); // ② 조 → 이름[]
  const groupMap = new Map(); // 조 → 진행표
  const groupOf = (team) => {
    const t = normTeam(team);
    let g = groupMap.get(t);
    if (!g) {
      g = { team: t, total: 0, submitted: 0, inProgress: 0, notStarted: 0, excluded: 0, people: [] };
      groupMap.set(t, g);
    }
    return g;
  };
  const answeredOf = (s) => (s && Number.isFinite(s.answered_count) ? s.answered_count : null);
  let excluded = 0;
  for (const r of roster) {
    const g = groupOf(r.team);
    g.total += 1;
    const signedHere = !useSigned || isSigned(r.team, r.name);
    if (useSigned && signedHere) signedCount += 1;
    if (didSubmit(r.team, r.name)) {
      g.submitted += 1;
      g.people.push({ name: r.name.trim(), status: 'submitted', answered: itemCount });
      if (signedHere) submittedSigned += 1;
      else unsignedSubmit.push({ team: normTeam(r.team), name: r.name.trim(), devices: 0, offRoster: false, submitted: true, proxy: false, unsigned: true });
      continue;
    }
    if (isExcluded(r.team, r.name)) {
      excluded += 1;
      g.excluded += 1;
      g.people.push({ name: r.name.trim(), status: 'excluded', answered: null });
      continue;
    }
    if (!signedHere) {
      // 의결 서명 안 함(불참 · 마감 뒤 도착) — 독려 대상 아님.
      unsigned += 1;
      g.excluded += 1;
      g.people.push({ name: r.name.trim(), status: 'unsigned', answered: null });
      continue;
    }
    const s = startFor(r.team, r.name);
    if (s) {
      g.inProgress += 1;
      g.people.push({ name: r.name.trim(), status: 'progress', answered: answeredOf(s) });
      waiting.push({ team: normTeam(r.team), name: r.name.trim(), started_at: s.started_at, answered: answeredOf(s) });
    } else {
      g.notStarted += 1;
      g.people.push({ name: r.name.trim(), status: 'none', answered: 0 });
      const t = normTeam(r.team);
      const list = notStarted.get(t) ?? [];
      list.push({ no: r.no ?? null, name: r.name.trim() });
      notStarted.set(t, list);
    }
  }
  // 명단에 없는데 시작만 하고 안 낸 사람(직접 입력) — ①에 덧붙인다.
  // 동명이인(명단에 같은 이름 2명 이상)은 이름만으로 명단 사람에 붙이지 않는다 — 조가 안 맞으면 명단 밖으로 ①에 올린다.
  for (const s of startOf.values()) {
    const k = personKey(s.voter_team, s.voter_name);
    const n = normName(s.voter_name);
    const nc = nameCount.get(n) ?? 0;
    if (rosterKeys.has(k) || nc === 1) continue;
    if (submittedKeys.has(k) || (nc === 0 && submittedNames.has(n))) continue;
    if (isExcluded(s.voter_team, s.voter_name)) continue;
    waiting.push({
      team: normTeam(s.voter_team),
      name: String(s.voter_name).trim(),
      started_at: s.started_at,
      answered: answeredOf(s),
      offRoster: true,
    });
  }
  waiting.sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : compareTeam(a.team, b.team)));
  const teams = [...notStarted.entries()]
    .sort(([a], [b]) => compareTeam(a, b))
    .map(([team, names]) => ({
      team,
      names: names.sort((x, y) => (x.no ?? 1e9) - (y.no ?? 1e9) || x.name.localeCompare(y.name, 'ko')).map((n) => n.name),
    }));
  const notStartedCount = teams.reduce((n, t) => n + t.names.length, 0);
  const groups = [...groupMap.values()].sort((a, b) => compareTeam(a.team, b.team));
  // 서명 명단 줄 중 명단(조·이름)에 안 맞는 줄 — 오타·조 표기 차이. 화면에서 고친다.
  const rosterNames = new Set(roster.map((r) => normName(r.name)));
  const signedUnmatched = useSigned
    ? signedLines.filter((line) => {
        const i = line.indexOf('|');
        if (i < 0) return !rosterNames.has(normName(line));
        return !rosterKeys.has(personKey(line.slice(0, i), line.slice(i + 1)));
      })
    : [];
  return {
    useSigned,
    signedCount,
    unsigned,
    signedUnmatched,
    // 머리줄 「제출」 — 서명 명단이 있으면 서명한 사람의 제출만(명단 밖 · 서명 안 한 제출은 ③).
    submittedBase: useSigned ? submittedSigned : submitted,
    checks: mergeChecks([...checks.filter((c) => !isExcluded(c.team, c.name)), ...corrChecks], unsignedSubmit),
    corrections,
    rosterCount: roster.length,
    itemCount: Number.isFinite(itemCount) ? itemCount : null,
    submitted,
    excluded,
    waiting,
    teams,
    groups,
    notStartedCount,
    remaining: waiting.length + notStartedCount,
  };
}

/**
 * ballot_progress_board 응답 → chaseState 입력. 찬반 값은 이 응답에 없다.
 * voters 한 줄 = (조, 이름) 하나. 명단 밖 줄은 시작 · 제출 기록이 있을 때만 온다.
 * started_at 이 비었어도 눌러 본 건이 있으면 updated_at 을 시작 시각으로 본다.
 * @param {{ item_count:number, voters: {team:string,name:string,in_roster:boolean,started_at:string|null,
 *   answered_count:number,last_ordinal:number|null,updated_at:string|null,submitted:boolean,submitted_at:string|null}[] }} board
 */
export function boardToInput(board) {
  const voters = Array.isArray(board?.voters) ? board.voters : [];
  const roster = [];
  const responses = [];
  const starts = [];
  // ③ 이름 확인 — 한 이름에 기기 2대 이상(s35 devices) · 명단 밖 이름으로 제출.
  const checks = [];
  for (const v of voters) {
    const devices = Number(v.devices) || 0;
    // 「이름(수정)」 줄은 여기서 ③ 에 올리지 않는다 — chaseState 가 원래 사람에 붙이거나 「확인 필요」로 따로 올린다.
    if (normName(v.name) && correctionBase(v.name) != null) continue;
    if (devices >= 2 || (!v.in_roster && v.submitted)) {
      checks.push({
        team: normTeam(v.team),
        name: String(v.name ?? '').trim(),
        devices,
        offRoster: !v.in_roster,
        submitted: !!v.submitted,
        proxy: !!v.proxy,
      });
    }
  }
  for (const v of voters) {
    if (v.in_roster) roster.push({ team: v.team, no: null, name: v.name });
    if (v.submitted) {
      // devices · proxy · correction_count 는 수정 표 판정에만 쓴다(같은 (조, 이름)의 제출이 몇 건인지 — namedToBoard 만 안다).
      responses.push({ voter_team: v.team, voter_name: v.name, submitted_at: v.submitted_at ?? null,
        devices: Number(v.devices) || 0, proxy: !!v.proxy, correction_count: Number(v.response_count) || 1 });
      continue;
    }
    const answered = Number(v.answered_count) || 0;
    const startedAt = v.started_at ?? (answered > 0 ? v.updated_at : null);
    if (startedAt) {
      starts.push({
        voter_team: v.team,
        voter_name: v.name,
        voter_in_roster: !!v.in_roster,
        started_at: startedAt,
        answered_count: answered,
        last_ordinal: v.last_ordinal ?? null,
      });
    }
  }
  // 대체 경로(진행 기록 없음)면 n/총건을 쓰지 않는다 — 0/19 로 보이면 오해를 부른다. 시작 시각 문구로 돌아간다.
  checks.sort((a, b) => compareTeam(a.team, b.team) || a.name.localeCompare(b.name, 'ko'));
  return { roster, responses, starts, checks, itemCount: board?.fallback ? null : Number(board?.item_count) || null };
}

/** board 응답으로 바로 상태를 만든다. signed = 의결 서명 명단(줄마다 「조|이름」 또는 「이름」). */
export function boardChaseState(board, exclude = [], signed = []) {
  return chaseState({ ...boardToInput(board), exclude, signed });
}

/** ③ 합치기 — 같은 (조, 이름)은 한 줄(서명 안 함 표시를 더한다). */
function mergeChecks(base, extra) {
  const out = base.map((c) => ({ ...c }));
  for (const e of extra) {
    const hit = out.find((c) => personKey(c.team, c.name) === personKey(e.team, e.name));
    if (hit) hit.unsigned = true;
    else out.push(e);
  }
  return out.sort((a, b) => compareTeam(a.team, b.team) || a.name.localeCompare(b.name, 'ko'));
}

/** ③ 한 줄 설명. */
export function checkNote(c) {
  const parts = [];
  if (c.correction) parts.push('(수정) 표인데 같은 조에 원래 사람 없음 — 확인 필요');
  if (c.unsigned) parts.push('의결 서명 명단에 없음');
  if (c.devices >= 2) parts.push(`기기 ${c.devices}대`);
  if (c.offRoster) parts.push('명단 밖 이름');
  parts.push(c.submitted ? (c.proxy ? '대리 입력으로 제출됨' : '제출됨') : '미제출');
  return parts.join(', ');
}

/**
 * 진행 기록 함수(s34)가 아직 없을 때의 대체 — ballot_named_responses_v2 응답을 board 모양으로.
 * ★ answers(찬반)는 「그 문항에 답이 있다」로만 세고 값은 버린다. 진행 중 건수는 알 수 없어 0.
 */
export function namedToBoard(named, at = new Date().toISOString()) {
  const items = Array.isArray(named?.items) ? named.items : [];
  const roster = Array.isArray(named?.roster) ? named.roster : [];
  const responses = Array.isArray(named?.responses) ? named.responses : [];
  const starts = Array.isArray(named?.starts) ? named.starts : [];
  const idToOrdinal = new Map(items.map((it) => [String(it.id), it.ordinal]));
  const answeredByOrdinal = new Map();
  const voters = new Map();
  const get = (team, name, inRoster) => {
    const k = personKey(team, name);
    let v = voters.get(k);
    if (!v) {
      v = { team: normTeam(team), name: String(name ?? '').trim(), in_roster: inRoster, started_at: null,
        answered_count: 0, last_ordinal: null, updated_at: null, submitted: false, submitted_at: null };
      voters.set(k, v);
    }
    return v;
  };
  for (const r of roster) get(r.team, r.name, true);
  for (const s of starts) {
    const v = get(s.voter_team, s.voter_name, false);
    if (!v.started_at || s.started_at < v.started_at) v.started_at = s.started_at;
  }
  for (const r of responses) {
    if (!normName(r.voter_name)) continue;
    const v = get(r.voter_team, r.voter_name, false);
    v.submitted = true;
    v.submitted_at = r.submitted_at ?? null;
    v.response_count = (v.response_count ?? 0) + 1; // 같은 (조, 이름) 제출 건수 — 「이름(수정)」 2건 이상을 알아보려고
    const ords = new Set();
    for (const key of Object.keys(r.answers ?? {})) {
      const o = idToOrdinal.get(String(key));
      if (o != null) ords.add(o);
    }
    v.answered_count = ords.size;
    for (const o of ords) answeredByOrdinal.set(o, (answeredByOrdinal.get(o) ?? 0) + 1);
  }
  const list = [...voters.values()];
  return {
    id: named?.id,
    title: named?.title,
    status: named?.status,
    item_count: items.length,
    at,
    roster_count: roster.length,
    items: items.map((it) => ({
      ordinal: it.ordinal,
      statement_head: String(it.statement ?? '').slice(0, 40),
      answered: answeredByOrdinal.get(it.ordinal) ?? 0,
    })),
    voters: list,
    submitted: list.filter((v) => v.submitted).length,
    started: list.filter((v) => v.submitted || v.started_at).length,
    fallback: 'named_responses',
  };
}

/**
 * 카톡 평문. 마크다운·표 없음.
 * @param {ReturnType<typeof chaseState>} st
 * @param {{ label: string, now?: Date|string, remainText?: string }} opt
 */
export function chaseText(st, { label, now = new Date(), remainText = '' }) {
  const lines = [];
  lines.push(`[${label} 투표 독려] ${kstHm(now)} 기준${remainText ? ` · ${remainText}` : ''}`);
  // 머리줄 둘째 줄은 아래 그대로 — 「제출 n / 명단 m · 남은 분 k」.
  const base = st.useSigned ? `의결 서명 ${st.signedCount}` : `명단 ${st.rosterCount}`;
  lines.push(`제출 ${st.submittedBase ?? st.submitted} / ${base} · 남은 분 ${st.remaining}${st.excluded ? ` (그 밖 제외 ${st.excluded}명)` : ''}`);
  const checks = st.checks ?? [];
  const pushChecks = () => {
    if (!checks.length) return;
    lines.push('');
    lines.push(`③ 이름 확인 ${checks.length}명 — 한 이름이 여러 기기에서 쓰였거나, 명단·서명에 없는 이름 (도움 중이면 그대로 두세요)`);
    for (const c of checks) lines.push(`· ${c.team} ${c.name} (${checkNote(c)})`);
  };
  if (st.remaining === 0) {
    lines.push('');
    lines.push(st.useSigned ? '의결 서명자 전원 제출했습니다.' : '명단 전원 제출했습니다.');
    pushChecks();
    return lines.join('\n');
  }
  if (st.waiting.length) {
    lines.push('');
    lines.push(`① 투표 화면에 들어왔는데 아직 제출 안 함 ${st.waiting.length}명 — 찾아가 도와주세요`);
    if (st.itemCount) {
      // 진행 기록이 있으면 조별로 묶고 「이름 n/총건」.
      const byTeam = new Map();
      for (const w of st.waiting) {
        const list = byTeam.get(w.team) ?? [];
        list.push(w);
        byTeam.set(w.team, list);
      }
      for (const [team, ws] of [...byTeam.entries()].sort(([a], [b]) => compareTeam(a, b))) {
        const names = ws.map((w) => `${w.name} ${w.answered ?? 0}/${st.itemCount}${w.offRoster ? '(명단 밖)' : ''}`);
        lines.push(`· ${team}(${ws.length}): ${names.join(', ')}`);
      }
    } else {
      for (const w of st.waiting) {
        lines.push(`· ${w.team} ${w.name} (${kstHm(w.started_at)} 시작${w.offRoster ? ', 명단에 없는 이름' : ''})`);
      }
    }
  }
  if (st.notStartedCount) {
    lines.push('');
    lines.push(`② 아직 투표 시작 안 함 ${st.notStartedCount}명 — 도착·QR 접속 확인`);
    for (const t of st.teams) lines.push(`· ${t.team}(${t.names.length}): ${t.names.join(', ')}`);
  }
  pushChecks();
  return lines.join('\n');
}

/**
 * 카톡 로컬 API GET /v1/messages/{방} 의 data.text(11/13 실측) → [{ at, hm, sender, text }].
 *   머리말 뒤에 메시지마다 「[2026-11-13T13:01:02+09:00 | <메시지 해시> | participant_xxxxxxxx]」 한 줄 + 본문 줄 + 빈 줄.
 *   보낸 사람은 가린 이름(participant_…)뿐이다(masked). 입장 등 시스템 알림 본문은 {"feedType":…,"members":[{"userId":…,"nickName":…}]}
 *   — JSON 으로 풀지 않고(userId 자리가 따옴표 없는 <…>) 닉네임만 꺼내 「(알림)」 한 줄로 바꾼다.
 */
export function parseKakaoText(text) {
  const out = [];
  let cur = null;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\[(\d{4}-\d{2}-\d{2}T[^\s|\]]+)\s*\|\s*([^|\]]*?)\s*(?:\|\s*([^\]]*?)\s*)?\]\s*$/.exec(line);
    if (m) {
      cur = { at: m[1], sender: (m[3] ?? '').slice(0, 40), lines: [] };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  return out.map((x) => {
    let body = x.lines.join('\n').trim();
    if (/^\{\s*"feedType"/.test(body)) {
      const nicks = [...body.matchAll(/"nickName"\s*:\s*"([^"]*)"/g)].map((n) => n[1]);
      body = `(알림)${nicks.length ? ` ${nicks.join(', ')}` : ''}`;
    }
    return { at: x.at, hm: kstHm(x.at), sender: x.sender, text: body.slice(0, 300) };
  });
}
