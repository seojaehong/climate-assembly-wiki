// 부천 100인 공론장 드라이런 — 운영 DB 에 anon(공개) 키로 실제 RPC 를 때린다.
//   BF_CODES="코드1,…,코드10"  BF_HQ_KEY="…"  node scripts/bucheon-dryrun.mjs
// 조 코드·본부 키는 파일에 남기지 않는다(환경변수로만 받는다).
// 시험 데이터가 남으니 끝나면 bucheon_question·bucheon_priority·bucheon_survey 를 비운다.

const URL = 'https://pleyuknjnprsckssxvrh.supabase.co/rest/v1/';
const KEY = 'sb_publishable_OVwo9zs5i6xl5iFykM6zJQ_GWFcf5zn';
const CODES = (process.env.BF_CODES || '').split(',').filter(Boolean);
const HQ = process.env.BF_HQ_KEY || '';
if (CODES.length !== 10 || !HQ) { console.error('BF_CODES(10개) 와 BF_HQ_KEY 가 필요합니다'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
};

async function rpc(fn, args) {
  const r = await fetch(URL + 'rpc/' + fn, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b, msg: b && b.message, code: b && b.code };
}

// 결정적 의사난수 — 같은 입력이면 같은 시험 데이터
let seed = 20261118;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const TERMS = ['S', 'M', 'LI', 'LR'];

// ── 1. 차단 확인 ──
{
  const r = await rpc('bucheon_join', { p_code: 'ZZZZZZ' });
  ok(r.status === 400 && r.msg === 'invalid team code', '없는 조 코드 거절', `${r.status} ${r.msg}`);
  const h = await rpc('bucheon_hq', { p_key: 'wrong' });
  ok(h.status === 400 && h.msg === 'invalid hq key', '틀린 본부 키 거절', `${h.status} ${h.msg}`);
  const i = await rpc('bucheon__team_no', { p_code: CODES[0] });
  ok(i.status >= 400 && (i.code === '42501' || i.code === 'PGRST202'), '내부 함수 anon 호출 차단', `${i.status} ${i.code}`);
  for (const t of ['bucheon_team', 'bucheon_config', 'bucheon_question', 'bucheon_survey']) {
    const r2 = await fetch(URL + t + '?select=*', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
    const b = await r2.text();
    ok(r2.status >= 400 || b === '[]', `테이블 직접 조회 차단: ${t}`, `${r2.status} ${b.slice(0, 60)}`);
  }
}

// ── 2. 조 입장 ──
const joined = await Promise.all(CODES.map((c) => rpc('bucheon_join', { p_code: c })));
ok(joined.every((j) => j.status === 200), '10개 조 모두 입장');
const teamNos = joined.map((j) => j.body.team_no);
ok(new Set(teamNos).size === 10, '조 번호 10개 서로 다름', teamNos.join(','));
const lower = await rpc('bucheon_join', { p_code: ' ' + CODES[0].toLowerCase() + ' ' });
ok(lower.status === 200, '소문자·공백 섞인 코드도 입장');
const policies = joined[0].body.policies;
const ids = policies.map((p) => p.id);
console.log(`      정책과제 ${ids.length}개`);

// ── 3. 세션1 질문 — 10개 조 동시 제출 ──
const qs = await Promise.all(CODES.map((c, i) => rpc('bucheon_submit_questions', {
  p_code: c, p_q1: `[시험] ${teamNos[i]}조 질문 1 — 청년 노동자 지원은 언제부터 시행되나요?`,
  p_q2: `[시험] ${teamNos[i]}조 질문 2 — 플랫폼 노동자 실태조사 결과는 공개되나요?`, p_note: i % 2 ? null : '참고 메모',
})));
ok(qs.every((r) => r.status === 200 && r.body.ok), '세션1 질문 10건 동시 제출');
const re = await rpc('bucheon_submit_questions', { p_code: CODES[0], p_q1: '[시험] 고친 질문 1', p_q2: '[시험] 고친 질문 2' });
ok(re.status === 200, '같은 조 재제출(고치기)');
for (const [name, args, want] of [
  ['질문1 빈칸 거절', { p_code: CODES[1], p_q1: '   ', p_q2: 'x' }, 'q1 is required'],
  ['질문 501자 거절', { p_code: CODES[1], p_q1: 'ㄱ'.repeat(501), p_q2: 'x' }, 'q1 is too long (max 500)'],
  ['없는 코드로 제출 거절', { p_code: 'ZZZZZZ', p_q1: 'x', p_q2: 'x' }, 'invalid team code'],
]) { const r = await rpc('bucheon_submit_questions', args); ok(r.status === 400 && r.msg === want, name, `${r.status} ${r.msg}`); }

// ── 4. 세션2 우선순위 ──
const expected = {};
const prs = await Promise.all(CODES.map((c, i) => {
  const terms = Object.fromEntries(ids.map((id) => [String(id), TERMS[Math.floor(rnd() * 4)]]));
  const ranking = shuffle(ids);
  expected[teamNos[i]] = { terms, ranking };
  return rpc('bucheon_submit_priority', { p_code: c, p_terms: terms, p_ranking: ranking,
    p_reason_top: `[시험] ${teamNos[i]}조 1~3순위 이유`, p_reason_long: null, p_split: null });
}));
ok(prs.every((r) => r.status === 200 && r.body.ok), '세션2 우선순위 10건 동시 제출', prs.filter((r) => r.status !== 200).map((r) => r.msg).join('|'));
const goodTerms = expected[teamNos[0]].terms, goodRank = expected[teamNos[0]].ranking;
const missingTerm = { ...goodTerms }; delete missingTerm[String(ids[0])];
const badValue = { ...goodTerms, [String(ids[0])]: 'X' };
const dupRank = goodRank.slice(); dupRank[1] = dupRank[0];
for (const [name, terms, ranking, top, want] of [
  ['시기 하나 빠짐 거절', missingTerm, goodRank, 'x', 'terms must cover every policy exactly once'],
  ['시기 값 이상 거절', badValue, goodRank, 'x', 'terms must cover every policy exactly once'],
  ['순위 중복 거절', goodTerms, dupRank, 'x', 'ranking must list every policy exactly once'],
  ['순위 하나 모자람 거절', goodTerms, goodRank.slice(1), 'x', 'ranking must list every policy exactly once'],
  ['없는 과제 번호 거절', goodTerms, [...goodRank.slice(1), 999], 'x', 'ranking must list every policy exactly once'],
  ['이유 빈칸 거절', goodTerms, goodRank, '', 'reason_top is required'],
]) {
  const r = await rpc('bucheon_submit_priority', { p_code: CODES[0], p_terms: terms, p_ranking: ranking, p_reason_top: top });
  ok(r.status === 400 && r.msg === want, name, `${r.status} ${r.msg}`);
}

// ── 5. 만족도 설문 ──
const surveys = Array.from({ length: 20 }, (_, i) => ({ overall: 1 + (i % 5), info: 5 - (i % 5), talk: 4, reflect: 3, again: i % 3 ? '참여하겠다' : '잘 모르겠다', ...(i % 4 ? {} : { free: '[시험] 자유 의견' }) }));
const sv = await Promise.all(surveys.map((a) => rpc('bucheon_submit_survey', { p_answers: a })));
ok(sv.every((r) => r.status === 200), '설문 20건 동시 제출');
for (const [name, a] of [['빈 응답 거절', {}], ['문항 31개 거절', Object.fromEntries(Array.from({ length: 31 }, (_, i) => ['k' + i, 1]))], ['6000자 초과 거절', { free: 'ㄱ'.repeat(6001) }]]) {
  const r = await rpc('bucheon_submit_survey', { p_answers: a });
  ok(r.status === 400 && r.msg === 'invalid answers', name, `${r.status} ${r.msg}`);
}

// ── 6. 본부 집계 대조 ──
const hq = (await rpc('bucheon_hq', { p_key: HQ })).body;
ok(hq.questions.length === 10, '본부: 질문 10개 조', String(hq.questions.length));
ok(hq.priorities.length === 10, '본부: 우선순위 10개 조', String(hq.priorities.length));
ok(hq.surveys.length === 20, '본부: 설문 20건', String(hq.surveys.length));
const t1 = hq.questions.find((q) => q.team_no === teamNos[0]);
ok(t1 && t1.q1 === '[시험] 고친 질문 1', '본부: 재제출이 덮어씀');
let same = 0;
for (const p of hq.priorities) {
  const e = expected[p.team_no];
  if (JSON.stringify(p.ranking) === JSON.stringify(e.ranking) && ids.every((id) => p.terms[String(id)] === e.terms[String(id)])) same++;
}
ok(same === 10, '본부: 10개 조 분류·순위가 보낸 값과 일치', `${same}/10`);
// 과제 하나를 손으로 세어 화면 집계식과 대조
const target = ids[2];
const handCounts = { S: 0, M: 0, LI: 0, LR: 0 }; let handSum = 0;
for (const tn of teamNos) { handCounts[expected[tn].terms[String(target)]]++; handSum += expected[tn].ranking.indexOf(target) + 1; }
const hqCounts = { S: 0, M: 0, LI: 0, LR: 0 }; let hqSum = 0;
for (const p of hq.priorities) { hqCounts[p.terms[String(target)]]++; hqSum += p.ranking.indexOf(target) + 1; }
ok(JSON.stringify(handCounts) === JSON.stringify(hqCounts) && handSum === hqSum, `본부: 과제 ${target} 손집계 대조`,
  `손 ${JSON.stringify(handCounts)} 평균 ${(handSum / 10).toFixed(1)} / 본부 ${JSON.stringify(hqCounts)} 평균 ${(hqSum / 10).toFixed(1)}`);
const avgOverall = hq.surveys.reduce((s, a) => s + a.overall, 0) / hq.surveys.length;
ok(avgOverall === 3, '본부: 설문 전반만족 평균 = 3.00', avgOverall.toFixed(2));

console.log(`\n합계 PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
