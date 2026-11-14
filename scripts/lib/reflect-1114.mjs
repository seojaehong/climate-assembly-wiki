/**
 * 11/14 의결 — 진행판 「반영 확인」 칸(순수 함수). 수정 표 · 대리 입력(수기 투표지)이 제대로 들어갔는지 본다.
 *
 * 수정 표 규칙은 결과 내보내기(scripts/lib/result-v2.mjs recountAgenda · correctionBase)와 같다 —
 *   같은 조 · 이름의 「이름(수정)」 표가 있으면 원래 표는 「수정으로 대체」, 수정 표를 그 이름으로 센다.
 *   「(수정)」이 여럿이면 마지막 것만. 원래 표가 없어도 수정 표는 그 이름으로 센다(확인 필요로 띄운다).
 * 찬반 값은 이 칸에 오지 않는다. 재집계 요약도 유효 표 · 대체 · 이상 건수만 넘긴다.
 */
import { compareTeam, normTeam } from './chase-1114.mjs';
import { correctionBase, normName } from './result-v2.mjs';

/**
 * @param board ballot_progress_board 모양(voters[{team,name,in_roster,submitted,submitted_at,proxy,devices,response_count?}])
 * @param st boardChaseState 결과(corrections · checks · waiting · notStartedCount)
 */
export function reflectView(board, st) {
  const voters = Array.isArray(board?.voters) ? board.voters : [];
  const proxyKnown = !board?.fallback; // 대리 입력 표시는 진행 기록 함수(s35)에만 있다
  const proxy = proxyKnown
    ? voters
        .filter((v) => v.submitted && v.proxy)
        .map((v) => ({ team: normTeam(v.team), name: String(v.name ?? '').trim(), submitted_at: v.submitted_at ?? null, correction: correctionBase(v.name) != null }))
        .sort((a, b) => compareTeam(a.team, b.team) || String(a.submitted_at).localeCompare(String(b.submitted_at)))
    : [];
  const byTeam = new Map();
  for (const p of proxy) byTeam.set(p.team, (byTeam.get(p.team) ?? 0) + 1);
  const proxyTeams = [...byTeam].map(([team, n]) => ({ team, n }));

  const corrections = (st?.corrections ?? []).map((c) => ({
    team: c.team,
    name: c.name,
    submitted_at: c.submitted_at ?? null,
    count: c.count ?? 1,
    hadOriginal: !!c.hadOriginal,
    state: c.hadOriginal ? '원래 표 → 수정으로 대체(수정 표로 셈)' : '원래 표 없음 — 수정 표를 그 이름으로 셈',
  }));

  const anomalies = [];
  for (const c of corrections) {
    if (!c.hadOriginal) anomalies.push({ kind: '원래 표 없는 수정', team: c.team, name: c.name });
    if (c.count >= 2) anomalies.push({ kind: `수정 ${c.count}건(마지막만 셈)`, team: c.team, name: c.name });
  }
  // 같은 (조, 이름) 제출 2건 이상 — 이름(수정)이 아닌 줄. response_count 는 대체 경로(namedToBoard)만 준다.
  for (const v of voters) {
    if (correctionBase(v.name) != null || !v.submitted) continue;
    if ((Number(v.response_count) || 1) >= 2) anomalies.push({ kind: `같은 조·이름 ${v.response_count}건`, team: normTeam(v.team), name: String(v.name ?? '').trim() });
  }
  // 이름만 같은 제출(조가 다름) — 재집계는 이름만으로 중복을 보아 뒤의 것을 뺀다(result-v2 「중복」).
  const nameSeen = new Map();
  for (const v of voters) {
    if (!v.submitted) continue;
    const base = correctionBase(v.name) ?? v.name;
    const k = normName(base);
    if (!k) continue;
    const teams = nameSeen.get(k) ?? new Set();
    teams.add(normTeam(v.team));
    nameSeen.set(k, teams);
  }
  for (const [k, teams] of nameSeen) {
    if (teams.size >= 2) anomalies.push({ kind: `같은 이름이 ${teams.size}개 조에서 제출(재집계는 먼저 낸 것만)`, team: [...teams].sort(compareTeam).join(' · '), name: k });
  }
  for (const c of st?.checks ?? []) {
    if (c.offRoster && c.submitted && !c.correction) anomalies.push({ kind: '명단 밖 이름으로 제출', team: c.team, name: c.name });
  }
  anomalies.sort((a, b) => compareTeam(String(a.team), String(b.team)) || String(a.name).localeCompare(String(b.name), 'ko'));

  const progress = (st?.waiting ?? []).filter((w) => !w.offRoster).length;
  const notStarted = st?.notStartedCount ?? 0;
  return {
    proxyKnown,
    proxy,
    proxyTeams,
    proxyTotal: proxy.length,
    corrections,
    replacedCount: corrections.filter((c) => c.hadOriginal).length,
    anomalies,
    unanswered: { total: progress + notStarted, progress, notStarted },
  };
}

/** recountAgenda 결과 → 화면 한 줄(찬반 없음). */
export function recountSummary(rc) {
  const reasons = {};
  for (const x of rc?.excluded ?? []) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
  const replaced = reasons['수정으로 대체'] ?? 0;
  const stale = reasons['앞선 수정(마지막 수정만 셈)'] ?? 0;
  const odd = Object.entries(reasons)
    .filter(([r]) => r !== '수정으로 대체' && r !== '앞선 수정(마지막 수정만 셈)')
    .map(([reason, n]) => ({ reason, n }));
  const oddTotal = odd.reduce((s, x) => s + x.n, 0);
  return {
    ballotStatus: rc?.ballotStatus ?? null,
    systemResponses: rc?.systemResponses ?? 0,
    valid: rc?.phoneValid ?? 0,
    corrected: (rc?.corrected ?? []).length,
    replaced,
    stale,
    odd,
    oddTotal,
    manualCounted: (rc?.manual ?? []).filter((m) => m.counted).length,
    line: `유효 표 ${rc?.phoneValid ?? 0} · 수정으로 대체 ${replaced}${stale ? ` · 앞선 수정 ${stale}` : ''} · 이상 ${oddTotal}${odd.length ? `(${odd.map((x) => `${x.reason} ${x.n}`).join(', ')})` : ''} · 받은 응답 ${rc?.systemResponses ?? 0}`,
  };
}
