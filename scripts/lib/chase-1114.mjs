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
 */

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
export function chaseState({ roster, responses, starts = [], exclude = [], itemCount = null }) {
  const isExcluded = excluder(exclude);
  const nameCount = new Map();
  for (const r of roster) nameCount.set(normName(r.name), (nameCount.get(normName(r.name)) ?? 0) + 1);

  const submittedKeys = new Set();
  const submittedNames = new Set();
  let submitted = 0;
  for (const r of responses) {
    if (!normName(r.voter_name)) continue; // 이름 없는 제출은 사람에 못 붙인다
    submitted += 1;
    submittedKeys.add(personKey(r.voter_team, r.voter_name));
    submittedNames.add(normName(r.voter_name));
  }
  const didSubmit = (team, name) =>
    submittedKeys.has(personKey(team, name)) || (nameCount.get(normName(name)) === 1 && submittedNames.has(normName(name)));

  // 시작 기록: (조, 이름)별 가장 이른 시각.
  const startOf = new Map();
  for (const s of starts) {
    const k = personKey(s.voter_team, s.voter_name);
    const prev = startOf.get(k);
    if (!prev || s.started_at < prev.started_at) startOf.set(k, s);
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
    if (didSubmit(r.team, r.name)) {
      g.submitted += 1;
      g.people.push({ name: r.name.trim(), status: 'submitted', answered: itemCount });
      continue;
    }
    if (isExcluded(r.team, r.name)) {
      excluded += 1;
      g.excluded += 1;
      g.people.push({ name: r.name.trim(), status: 'excluded', answered: null });
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
  const rosterKeys = new Set(roster.map((r) => personKey(r.team, r.name)));
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
  return {
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
  for (const v of voters) {
    if (v.in_roster) roster.push({ team: v.team, no: null, name: v.name });
    if (v.submitted) {
      responses.push({ voter_team: v.team, voter_name: v.name, submitted_at: v.submitted_at ?? null });
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
  return { roster, responses, starts, itemCount: board?.fallback ? null : Number(board?.item_count) || null };
}

/** board 응답으로 바로 상태를 만든다. */
export function boardChaseState(board, exclude = []) {
  return chaseState({ ...boardToInput(board), exclude });
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
  lines.push(`제출 ${st.submitted} / 명단 ${st.rosterCount} · 남은 분 ${st.remaining}${st.excluded ? ` (불참·서면 등 ${st.excluded}명 제외)` : ''}`);
  if (st.remaining === 0) {
    lines.push('');
    lines.push('명단 전원 제출했습니다.');
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
  return lines.join('\n');
}
