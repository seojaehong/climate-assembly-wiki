/**
 * 11/14 의결 결과 파일 `result/v2` — 재집계 · 만들기 · 검사 · 검증자용 요약(순수 함수, I/O 없음).
 *
 * 계약 정본 = docs/result-v2-contract.md. 세리머니 로더는 그 문서를 따른다.
 * 공식 수치는 시스템 집계(dist)가 아니라 실명 응답 원자료를 다시 센 값이다:
 *   이름 있음 · 명단 안(조+이름) · 이름 중복 없음(먼저 낸 것) · (출석부를 주면) 출석부에 있음 → 휴대폰 유효표
 *   + 서면 집계표(입력) = 찬성 · 반대. 기권 = 출석 − 찬성 − 반대(미제출 · 누르지 않은 건 · 뺀 표 포함).
 * 저장값: 1 = 반대, 2 = 찬성(BallotCard 와 같다).
 */

export const RESULT_SCHEMA = 'result/v2';
export const RULE_TEXT = '재적 과반수의 출석과 출석자 3분의 2 이상의 찬성';
/** 닫힌 목록. 이 밖의 값이 들어간 파일은 검사기가 거부한다. */
export const VERDICTS = ['가결', '부결', '불성립', '미확정'];
export const STATUSES = ['확정', '일부 확정', '미확정'];
/** 실전 투표지 3장의 건수(00_고정조건 C-1). rehearsal=false 면 이 모양이어야 한다. */
export const FINAL_COUNTS = { 1: 19, 2: 28, 3: 23 };

const YES = 2;
const NAY = 1;
const ISO_KST = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(\+09:00|Z)$/;

export class ResultV2Error extends Error {
  constructor(problems) {
    const list = Array.isArray(problems) ? problems : [problems];
    super(list.join('\n'));
    this.name = 'ResultV2Error';
    this.problems = list;
  }
}

/** 기준표수 = 출석 × 2/3 올림. 부동소수 없이 정수로. */
export function thresholdFor(present) {
  return Math.floor((2 * present + 2) / 3);
}

/** 회의 성립 = 재적 과반수 출석(출석 > 재적/2). */
export function isEstablished(present, enrolled) {
  return 2 * present > enrolled;
}

/** 「2-5-안1 제목」 → 「2-5」. 모양이 아니면 null. */
export function motionNumber(statement) {
  const m = /^(\d+-\d+)-안\d+(?:\s|$)/.exec(String(statement ?? '').trim());
  return m ? m[1] : null;
}

function motionTitle(statement) {
  return String(statement ?? '').trim().replace(/^\d+-\d+-안\d+\s*/, '');
}

/** SQL climate_vote.voter_name_norm 과 같은 대조 키(공백 전부 제거 + 소문자). */
export function normName(name) {
  return String(name ?? '').replace(/[\s 　]+/g, '').toLowerCase();
}

const isInt = (v) => Number.isInteger(v);
const nonNegInt = (v) => Number.isInteger(v) && v >= 0;

/**
 * 투표지 한 장(ballot_named_responses_v2 모양)을 다시 센다.
 * @param raw { id, status, items[{id,ordinal,statement,scale}], roster[{team,name}], responses[...] }
 * @param opts { agendaNo, expectedCount, attendance?: [{team,name}], paper?: { ballots, items: { '1-1': {yes,nay} } }, numberPrefix?: boolean }
 */
export function recountAgenda(raw, { agendaNo, expectedCount, attendance = null, paper = null, numberPrefix = true }) {
  const problems = [];
  const items = [...(raw?.items ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  if (items.length !== expectedCount) problems.push(`의제 ${agendaNo}: 건수 ${items.length} ≠ 기대 ${expectedCount}`);
  // 11/14 투표지는 분과 지정 없음(전원 투표). 분과가 남아 있으면 서버가 명단을 그 분과로 좁혀 돌려주므로
  // 다른 분과 시민의 표가 전부 「명단 밖」으로 빠진다 — 세지 않고 거부한다.
  const subgroup = String(raw?.subgroup ?? '').trim();
  if (subgroup) problems.push(`의제 ${agendaNo}: 투표지에 분과 지정(${subgroup})이 있어 명단이 그 분과로 좁혀짐 — 전원 투표지는 분과 지정 없음이어야 함`);
  const seen = new Set();
  const out = items.map((it) => {
    const no = motionNumber(it.statement);
    if (it.scale !== 2) problems.push(`의제 ${agendaNo}: ${it.ordinal}번 문항이 찬반(2점) 문항이 아님(scale ${it.scale})`);
    if (!no) problems.push(`의제 ${agendaNo}: ${it.ordinal}번 문항 번호를 읽을 수 없음 — 「N-M-안1 제목」 모양이 아님`);
    else {
      if (numberPrefix && !no.startsWith(`${agendaNo}-`)) problems.push(`의제 ${agendaNo}: ${no} 는 다른 의제 번호`);
      if (seen.has(no)) problems.push(`의제 ${agendaNo}: 번호 ${no} 중복`);
      seen.add(no);
    }
    return { no: no ?? `?${it.ordinal}`, id: it.id, ordinal: it.ordinal, title: motionTitle(it.statement), yes: 0, nay: 0, sysYes: 0, sysNay: 0 };
  });

  // 서면 집계표
  let paperBallots = 0;
  if (paper) {
    paperBallots = paper.ballots ?? 0;
    if (!nonNegInt(paperBallots)) problems.push(`의제 ${agendaNo}: 서면 투표지 수(ballots)가 0 이상 정수가 아님`);
    for (const [no, v] of Object.entries(paper.items ?? {})) {
      const row = out.find((x) => x.no === no);
      const y = v?.yes ?? 0;
      const n = v?.nay ?? 0;
      if (!row) problems.push(`의제 ${agendaNo}: 서면 집계표의 ${no} 는 투표지에 없는 번호`);
      else if (!nonNegInt(y) || !nonNegInt(n)) problems.push(`의제 ${agendaNo}: 서면 ${no} 찬성·반대가 0 이상 정수가 아님`);
      else if (y + n > paperBallots) problems.push(`의제 ${agendaNo}: 서면 ${no} 찬성 + 반대 ${y + n} > 서면 투표지 ${paperBallots}`);
      else {
        row.yes += y;
        row.nay += n;
      }
    }
  }
  if (problems.length) throw new ResultV2Error(problems);

  // 휴대폰 응답 — 먼저 낸 것부터.
  const rosterPairs = new Set((raw.roster ?? []).map((r) => `${String(r.team ?? '').trim()}\u0000${normName(r.name)}`));
  const attendPairs = attendance ? new Set(attendance.map((r) => `${String(r.team ?? '').trim()}\u0000${normName(r.name)}`)) : null;
  const responses = [...(raw.responses ?? [])].sort(
    (a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)) || String(a.id).localeCompare(String(b.id)),
  );
  const usedNames = new Set();
  const excluded = [];
  const badValues = [];
  let phoneValid = 0;
  const byId = new Map(out.map((x) => [x.id, x]));
  for (const r of responses) {
    const answers = r.answers && typeof r.answers === 'object' ? r.answers : {};
    for (const [id, v] of Object.entries(answers)) {
      const row = byId.get(id);
      if (!row) continue;
      if (v === YES) row.sysYes += 1;
      else if (v === NAY) row.sysNay += 1;
    }
    const key = normName(r.voter_name);
    const team = String(r.voter_team ?? '').trim();
    const tag = { reason: '', team: team || null, name: r.voter_name ?? null, submitted_at: r.submitted_at ?? null };
    if (!key) excluded.push({ ...tag, reason: '이름 없음' });
    else if (!rosterPairs.has(`${team}\u0000${key}`)) excluded.push({ ...tag, reason: '명단 밖' });
    else if (usedNames.has(key)) excluded.push({ ...tag, reason: '중복' });
    else if (attendPairs && !attendPairs.has(`${team}\u0000${key}`)) {
      usedNames.add(key);
      excluded.push({ ...tag, reason: '출석부 없음' });
    } else {
      usedNames.add(key);
      phoneValid += 1;
      for (const [id, v] of Object.entries(answers)) {
        const row = byId.get(id);
        if (!row) continue;
        if (v === YES) row.yes += 1;
        else if (v === NAY) row.nay += 1;
        else badValues.push({ no: row.no, value: v });
      }
    }
  }
  return { agendaNo, ballotId: raw.id, ballotStatus: raw.status, items: out, phoneValid, paperBallots, excluded, badValues, systemResponses: responses.length };
}

function verdictOf({ confirmed, established, yes, threshold }) {
  if (!confirmed) return '미확정';
  if (!established) return '불성립';
  return yes >= threshold ? '가결' : '부결';
}

function checkConfirmation(label, src, problems) {
  if (src.confirmed !== true && src.confirmed !== false) problems.push(`${label}: confirmed 는 true/false`);
  if (src.confirmed === true) {
    if (!String(src.signer ?? '').trim()) problems.push(`${label}: 확정인데 서명자(signer)가 없음`);
    if (!ISO_KST.test(String(src.confirmed_at ?? ''))) problems.push(`${label}: 확정인데 확정 시각(confirmed_at)이 ISO(+09:00) 가 아님`);
  }
}

function checkCounts(label, { present, enrolled }, problems) {
  if (!isInt(enrolled) || enrolled <= 0) problems.push(`${label}: 재적(enrolled)이 양의 정수가 아님`);
  if (!isInt(present) || present <= 0) problems.push(`${label}: 출석(present)이 양의 정수가 아님(출석 > 0)`);
  else if (isInt(enrolled) && present > enrolled) problems.push(`${label}: 출석 ${present} > 재적 ${enrolled}`);
}

/**
 * 설정 + 투표지 원자료 → result/v2. 문제가 하나라도 있으면 ResultV2Error(파일을 만들지 않는다).
 * @param config { rehearsal, example, enrolled, report:{mode,...}, agendas:[{no,name,count,ballot_id,present,enrolled?,method,confirmed,signer,confirmed_at,paper?,attendance?}] }
 * @param raws { [agendaNo]: raw } (report 투표지는 raws.report)
 */
export function buildResultV2(config, raws, { generatedAt }) {
  const problems = [];
  if (typeof config?.rehearsal !== 'boolean') problems.push('rehearsal 은 true/false');
  if (typeof config?.example !== 'boolean') problems.push('example 은 true/false');
  const agendasCfg = [...(config?.agendas ?? [])].sort((a, b) => a.no - b.no);
  if (!agendasCfg.length) problems.push('agendas 가 비었음');
  if (config?.rehearsal === false) {
    const shape = agendasCfg.map((a) => `${a.no}:${a.count}`).join(',');
    if (shape !== '1:19,2:28,3:23') problems.push(`실전 파일은 의제 1·2·3 = 19 · 28 · 23건이어야 함(지금 ${shape || '없음'})`);
  }
  if (problems.length) throw new ResultV2Error(problems);

  const agendas = [];
  const items = [];
  const recounts = [];
  for (const a of agendasCfg) {
    const label = `의제 ${a.no}`;
    const enrolled = a.enrolled ?? config.enrolled;
    const p = [];
    checkCounts(label, { present: a.present, enrolled }, p);
    checkConfirmation(label, a, p);
    const raw = raws?.[a.no];
    if (!raw) p.push(`${label}: 투표지 원자료가 없음`);
    else {
      if (a.ballot_id && raw.id !== a.ballot_id) p.push(`${label}: 원자료 투표지 id ${raw.id} ≠ 설정 ballot_id ${a.ballot_id}`);
      if (a.confirmed === true && raw.status === 'open') p.push(`${label}: 확정인데 투표지가 아직 열려 있음(open) — 마감 후 다시`);
    }
    if (p.length) {
      problems.push(...p);
      continue;
    }
    let rc;
    try {
      rc = recountAgenda(raw, { agendaNo: a.no, expectedCount: a.count, attendance: a.attendance ?? null, paper: a.paper ?? null });
    } catch (e) {
      problems.push(...(e.problems ?? [String(e.message)]));
      continue;
    }
    recounts.push(rc);
    const present = a.present;
    const threshold = thresholdFor(present);
    const established = isEstablished(present, enrolled);
    if (rc.phoneValid + rc.paperBallots > present) {
      problems.push(`${label}: 유효 제출 ${rc.phoneValid} + 서면 ${rc.paperBallots} > 출석 ${present} — 판정 못 함(출석 수 · 명단 확인)`);
    }
    for (const it of rc.items) {
      if (it.yes + it.nay > present) problems.push(`${label}: ${it.no} 찬성 ${it.yes} + 반대 ${it.nay} > 출석 ${present}`);
      const confirmed = a.confirmed === true;
      items.push({
        no: it.no,
        agenda: a.no,
        title: it.title,
        yes: confirmed ? it.yes : null,
        nay: confirmed ? it.nay : null,
        abstain: confirmed ? present - it.yes - it.nay : null,
        verdict: verdictOf({ confirmed, established, yes: it.yes, threshold }),
        corrected: null,
      });
    }
    agendas.push({
      no: a.no,
      name: String(a.name ?? ''),
      count: a.count,
      enrolled,
      present,
      threshold,
      established,
      method: String(a.method ?? '휴대폰'),
      confirmed: a.confirmed === true,
      confirmed_at: a.confirmed === true ? a.confirmed_at : null,
      signer: a.confirmed === true ? String(a.signer).trim() : null,
    });
  }

  // 보고서
  const rep = config.report ?? { mode: 'present_only' };
  let report;
  if (rep.mode === 'present_only') report = { status: '발표' };
  else if (rep.mode === 'vote') {
    const p = [];
    const enrolled = rep.enrolled ?? config.enrolled;
    checkCounts('보고서', { present: rep.present, enrolled }, p);
    checkConfirmation('보고서', rep, p);
    let yes = rep.yes;
    let nay = rep.nay;
    if (raws?.report) {
      try {
        const rc = recountAgenda(raws.report, { agendaNo: 'report', expectedCount: 1, numberPrefix: false, paper: rep.paper ?? null });
        yes = rc.items[0].yes;
        nay = rc.items[0].nay;
      } catch (e) {
        p.push(...(e.problems ?? [String(e.message)]).map((m) => `보고서: ${m}`));
      }
    }
    if (rep.confirmed === true && (!nonNegInt(yes) || !nonNegInt(nay))) p.push('보고서: 찬성 · 반대(yes · nay)가 0 이상 정수가 아님');
    if (nonNegInt(yes) && nonNegInt(nay) && isInt(rep.present) && yes + nay > rep.present) p.push(`보고서: 찬성 + 반대 ${yes + nay} > 출석 ${rep.present}`);
    if (p.length) problems.push(...p);
    else {
      const confirmed = rep.confirmed === true;
      const threshold = thresholdFor(rep.present);
      const established = isEstablished(rep.present, enrolled);
      report = {
        status: confirmed ? '확정' : '미확정',
        yes: confirmed ? yes : null,
        nay: confirmed ? nay : null,
        abstain: confirmed ? rep.present - yes - nay : null,
        present: rep.present,
        enrolled,
        threshold,
        established,
        verdict: verdictOf({ confirmed, established, yes, threshold }),
        confirmed_at: confirmed ? rep.confirmed_at : null,
        signer: confirmed ? String(rep.signer).trim() : null,
      };
    }
  } else problems.push(`report.mode 는 "vote" 또는 "present_only"(지금 ${JSON.stringify(rep.mode)})`);

  if (problems.length) throw new ResultV2Error(problems);

  const confirmedN = agendas.filter((a) => a.confirmed).length;
  const doc = {
    schema: RESULT_SCHEMA,
    example: config.example,
    rehearsal: config.rehearsal,
    status: confirmedN === agendas.length ? '확정' : confirmedN === 0 ? '미확정' : '일부 확정',
    rule: RULE_TEXT,
    generated_at: generatedAt,
    agendas,
    items,
    report_mode: rep.mode,
    report,
    summary: summarize(items),
  };
  const v = validateResultV2(doc);
  if (v.length) throw new ResultV2Error(v.map((m) => `검사기: ${m}`));
  return { doc, recounts };
}

function summarize(items) {
  return {
    total: items.length,
    passed: items.filter((i) => i.verdict === '가결').length,
    failed: items.filter((i) => i.verdict === '부결').length,
    not_established: items.filter((i) => i.verdict === '불성립').length,
    pending: items.filter((i) => i.verdict === '미확정').length,
  };
}

/**
 * 파일만 보고 다시 계산해 맞는지 본다(세리머니 로더도 같은 규칙으로 검사한다 — 계약 §검사).
 * @returns 문제 문장 배열. 비면 통과.
 */
export function validateResultV2(doc) {
  const e = [];
  if (!doc || typeof doc !== 'object') return ['파일이 객체가 아님'];
  if (doc.schema !== RESULT_SCHEMA) e.push(`schema 가 ${RESULT_SCHEMA} 가 아님`);
  if (typeof doc.example !== 'boolean') e.push('example 은 true/false');
  if (typeof doc.rehearsal !== 'boolean') e.push('rehearsal 은 true/false');
  if (!STATUSES.includes(doc.status)) e.push(`status 허용값 밖: ${JSON.stringify(doc.status)}`);
  if (doc.rule !== RULE_TEXT) e.push('rule 문구가 운영규정 원문과 다름');
  if (!Array.isArray(doc.agendas) || !Array.isArray(doc.items)) return [...e, 'agendas · items 가 배열이 아님'];

  const agendaByNo = new Map();
  for (const a of doc.agendas) {
    const L = `agendas[${a?.no}]`;
    agendaByNo.set(a.no, a);
    if (!isInt(a.enrolled) || a.enrolled <= 0) e.push(`${L}: enrolled 가 양의 정수가 아님`);
    if (!isInt(a.present) || a.present <= 0) e.push(`${L}: present 가 양의 정수가 아님`);
    if (isInt(a.present) && isInt(a.enrolled) && a.present > a.enrolled) e.push(`${L}: present > enrolled`);
    if (a.threshold !== thresholdFor(a.present)) e.push(`${L}: threshold ${a.threshold} ≠ 재계산 ${thresholdFor(a.present)}`);
    if (a.established !== isEstablished(a.present, a.enrolled)) e.push(`${L}: established 가 재계산(출석 > 재적/2)과 다름`);
    if (typeof a.confirmed !== 'boolean') e.push(`${L}: confirmed 는 true/false`);
    if (a.confirmed === true) {
      if (!String(a.signer ?? '').trim()) e.push(`${L}: 확정인데 signer 없음`);
      if (!ISO_KST.test(String(a.confirmed_at ?? ''))) e.push(`${L}: 확정인데 confirmed_at 이 ISO 가 아님`);
    }
    const n = doc.items.filter((i) => i.agenda === a.no).length;
    if (n !== a.count) e.push(`${L}: count ${a.count} ≠ items ${n}`);
  }

  const seen = new Set();
  for (const it of doc.items) {
    const L = `items[${it?.no}]`;
    if (seen.has(it.no)) e.push(`${L}: 번호 중복`);
    seen.add(it.no);
    if (!VERDICTS.includes(it.verdict)) {
      e.push(`${L}: verdict 허용값 밖 ${JSON.stringify(it.verdict)}`);
      continue;
    }
    const a = agendaByNo.get(it.agenda);
    if (!a) {
      e.push(`${L}: agenda ${it.agenda} 가 agendas 에 없음`);
      continue;
    }
    if (!a.confirmed) {
      if (it.yes !== null || it.nay !== null || it.abstain !== null) e.push(`${L}: 미확정 의제인데 표수가 null 이 아님`);
      if (it.verdict !== '미확정') e.push(`${L}: 미확정 의제의 verdict 는 「미확정」`);
      continue;
    }
    if (!nonNegInt(it.yes) || !nonNegInt(it.nay)) {
      e.push(`${L}: yes · nay 가 0 이상 정수가 아님`);
      continue;
    }
    if (it.yes + it.nay > a.present) e.push(`${L}: yes + nay > present`);
    if (it.abstain !== a.present - it.yes - it.nay) e.push(`${L}: abstain ${it.abstain} ≠ 출석 − 찬성 − 반대 ${a.present - it.yes - it.nay}`);
    const expect = verdictOf({ confirmed: true, established: a.established, yes: it.yes, threshold: a.threshold });
    if (it.verdict !== expect) e.push(`${L}: verdict 「${it.verdict}」 ≠ 재계산 「${expect}」`);
  }

  const confirmedN = doc.agendas.filter((a) => a.confirmed).length;
  const expectStatus = confirmedN === doc.agendas.length ? '확정' : confirmedN === 0 ? '미확정' : '일부 확정';
  if (doc.status !== expectStatus) e.push(`status 「${doc.status}」 ≠ 재계산 「${expectStatus}」`);
  const s = summarize(doc.items);
  if (JSON.stringify(doc.summary) !== JSON.stringify(s)) e.push(`summary ${JSON.stringify(doc.summary)} ≠ 재계산 ${JSON.stringify(s)}`);

  if (doc.report_mode === 'present_only') {
    if (!doc.report || doc.report.status !== '발표') e.push('report_mode present_only 이면 report = {status:"발표"}');
  } else if (doc.report_mode === 'vote') {
    const r = doc.report ?? {};
    if (!['확정', '미확정'].includes(r.status)) e.push('report.status 는 「확정」 또는 「미확정」');
    if (r.threshold !== thresholdFor(r.present)) e.push('report.threshold 재계산과 다름');
    if (r.established !== isEstablished(r.present, r.enrolled)) e.push('report.established 재계산과 다름');
    if (r.status === '확정') {
      if (!nonNegInt(r.yes) || !nonNegInt(r.nay) || r.abstain !== r.present - r.yes - r.nay) e.push('report 표수 · abstain 재계산과 다름');
      else if (r.verdict !== verdictOf({ confirmed: true, established: r.established, yes: r.yes, threshold: r.threshold })) e.push('report.verdict 재계산과 다름');
    } else if (r.verdict !== '미확정' || r.yes !== null) e.push('report 미확정이면 표수 null · verdict 「미확정」');
  } else e.push(`report_mode 허용값 밖: ${JSON.stringify(doc.report_mode)}`);
  return e;
}

/** 검증자용 요약 글(소리 내어 대조하는 순서). 이름은 뺀 표 목록에만 나온다. */
export function summaryText(doc, recounts, sha256) {
  const L = [];
  const bar = '='.repeat(48);
  L.push(bar);
  if (doc.rehearsal) L.push('★★ 리허설 파일 — 실전 공개에 쓰지 않는다 ★★');
  if (doc.example) L.push('★★ 예시 파일 — 실전 공개에 쓰지 않는다 ★★');
  L.push(`result/v2 · 상태 ${doc.status} · 만든 시각 ${doc.generated_at}`);
  L.push(`sha256 ${sha256}`);
  L.push(bar);
  for (const a of doc.agendas) {
    const its = doc.items.filter((i) => i.agenda === a.no);
    const by = (v) => its.filter((i) => i.verdict === v).map((i) => i.no);
    L.push('');
    L.push(`[의제 ${a.no}] ${a.name} — ${a.count}건 · ${a.confirmed ? `확정 ${a.confirmed_at} 서명 ${a.signer}` : '미확정'}`);
    L.push(`  재적 ${a.enrolled} · 출석 ${a.present} · 성립 ${a.established ? '예' : '아니오(불성립)'} · 가결 기준 찬성 ${a.threshold}표 이상 · 방법 ${a.method}`);
    const rc = recounts.find((r) => r.agendaNo === a.no);
    if (rc) {
      const reasons = {};
      for (const x of rc.excluded) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
      const rs = Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음';
      L.push(`  휴대폰 제출 ${rc.systemResponses} → 유효 ${rc.phoneValid} · 뺀 표 ${rc.excluded.length} (${rs}) · 서면 투표지 ${rc.paperBallots}`);
      for (const x of rc.excluded) L.push(`    - 뺀 표: ${x.reason} · ${x.team ?? '(조 없음)'} ${x.name ?? '(이름 없음)'} · ${x.submitted_at ?? ''}`);
      if (rc.badValues.length) L.push(`  ! 찬반 아닌 값 ${rc.badValues.length}건(기권으로 셈): ${rc.badValues.map((b) => `${b.no}=${b.value}`).join(', ')}`);
    }
    if (a.confirmed) {
      L.push(`  가결 ${by('가결').length}건: ${by('가결').join(', ') || '-'}`);
      L.push(`  부결 ${by('부결').length}건: ${by('부결').join(', ') || '-'}`);
      if (by('불성립').length) L.push(`  불성립 ${by('불성립').length}건: ${by('불성립').join(', ')}`);
      L.push('  번호 | 찬성 | 반대 | 기권 | 판정 | 기준까지(찬성 − 기준)  [시스템 dist 찬/반]');
      for (const i of its) {
        const sys = rc?.items.find((x) => x.no === i.no);
        const margin = i.yes - a.threshold;
        const near = Math.abs(margin) <= 3 ? '  ← 3표 안쪽: 다시 읽기' : '';
        L.push(`  ${i.no.padEnd(5)}| ${String(i.yes).padStart(4)} | ${String(i.nay).padStart(4)} | ${String(i.abstain).padStart(4)} | ${i.verdict} | ${margin >= 0 ? '+' : ''}${margin}  [${sys?.sysYes ?? '-'}/${sys?.sysNay ?? '-'}]${near}`);
      }
    } else {
      L.push('  미확정 — 표수는 파일에 싣지 않았다(null). 세리머니는 이 의제를 공개하지 않는다.');
    }
  }
  L.push('');
  const s = doc.summary;
  L.push(`합계 ${s.total}건 — 가결 ${s.passed} · 부결 ${s.failed} · 불성립 ${s.not_established} · 미확정 ${s.pending}`);
  if (doc.report_mode === 'vote') {
    const r = doc.report;
    L.push(`보고서 승인 표결: ${r.status} · 찬성 ${r.yes ?? '-'} · 반대 ${r.nay ?? '-'} · 기권 ${r.abstain ?? '-'} · 출석 ${r.present} · 기준 ${r.threshold} · ${r.verdict}`);
  } else L.push('보고서: 발표만(표결 없음)');
  return `${L.join('\n')}\n`;
}
