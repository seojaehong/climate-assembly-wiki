/**
 * 10/17 분과 의결 — 권고안(recs_1017.json)과 유사 묶음(similar_groups_1017.json)을 서버 준비판에 미리 넣는다.
 * 화면의 [JSON 가져오기] + [유사 묶음 파일 가져오기] 와 같은 함수(initPrepState·importSimilarGroups)를 쓴다.
 *
 *   npx tsx scripts/load-1017-baseline.ts --code <운영팀형 6자리 코드> --recs <recs.json> --groups <groups.json> [--replace] [--apply]
 *
 * - --apply 가 없으면 미리보기만 한다(서버에 쓰지 않음).
 * - 서버가 빈 분과는 새로 넣는다.
 * - 이미 내용이 있는 분과는 건너뛴다. --replace 를 주면 새 파일 내용으로 통째로 바꾼다(자료가 바뀌었을 때).
 *   단 투표 기록이 있거나 안 제목·기록 칸에 사람이 넣은 내용이 있으면 바꾸지 않는다(현장 입력을 지우지 않게).
 * - --force 를 --replace 와 함께 주면(10/17 A–G 묶음으로 다시 깔기, 사용자 승인) 사람이 넣은 제목·의견·참석도 버리고 바꾼다.
 *   ★ 그래도 투표 기록(차수·투표)이 있는 분과는 절대 바꾸지 않는다. 미리보기에서 버려질 항목을 먼저 확인할 것.
 * - --groups 에 bundles_ag_1017.json(A–G 묶음)을 주면 그 묶음으로 안을 만든다(유사 묶음 파일과 같은 모양 + letter·card_teams).
 * - --per-card(10/17 오후 결정): 카드(3자리) 하나 = 안 하나, 제목은 카드 원 제목(빈 제목은 「(제목 미정)」), 순서는 묶음 A..G → 카드 번호.
 *   --groups 의 A–G 묶음은 줄 세우기·묶어 보기에만 쓴다. 투표 기록이 있는 분과는 바꾸지 않는다(--replace --force 필요).
 * - --apply 는 --after-deploy 와 함께만 된다(판 번호 5 — 배포·전 화면 새로고침 뒤).
 * - --expert <expert_1017.json> 을 주면 세부권고마다 전문가 의견을 원천에 붙인다. 이미 있는 판도 그 칸만 바꿔 저장한다
 *   (사람이 넣은 내용은 그대로). 공개 저장소·번들에는 넣지 않는다.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { attachExpertOpinions, parseExpertFile } from '../src/islands/mod/division-expert';
import { carryOverRecords, humanInput as humanInputOf } from '../src/islands/mod/division-reseed';
import { cardMotionsState } from '../src/islands/mod/division-card-seed';
import {
  createAgendaMotion,
  importSimilarGroups,
  initPrepState,
  migratePrep,
  parseImport,
  parseSimilarGroups,
  type PrepState,
} from '../src/islands/mod/division-vote-logic';

const URL = 'https://pleyuknjnprsckssxvrh.supabase.co';
const ANON = readFileSync(new globalThis.URL('../src/lib/supabase.ts', import.meta.url), 'utf8').match(/FALLBACK_ANON = '([^']+)'/)?.[1];
if (!ANON) throw new Error('anon key not found in src/lib/supabase.ts');

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const code = arg('--code');
const recsPath = arg('--recs');
const groupsPath = arg('--groups');
const apply = process.argv.includes('--apply');
const replace = process.argv.includes('--replace');
const force = process.argv.includes('--force');
const perCard = process.argv.includes('--per-card');
// 이 로더는 판 번호 5(전문가 의견·검토위원 칸)로 쓴다. v4 화면(8188aec)이 떠 있으면 그 화면은 이 판을 못 읽는다.
if (apply && !process.argv.includes('--after-deploy')) {
  throw new Error('판 번호 5로 씁니다. (3)+(4) 배포 → 모든 분과 PC·운영 노트북·발표 창 새로고침 뒤에 --after-deploy 를 붙여 다시 실행하십시오.');
}
const expertPath = arg('--expert');
const expert = expertPath ? parseExpertFile(readFileSync(expertPath, 'utf8')) : null;
if (expertPath && !expert) throw new Error('전문가 의견 파일 모양이 맞지 않습니다');
const withExpert = (st: PrepState, sub: string): PrepState => {
  if (!expert) return st;
  const r = attachExpertOpinions(st, expert);
  console.log(`${sub}: 전문가 의견 붙임 세부권고 ${r.attached}${r.unknown.length ? ` · 원천에 없는 번호 ${r.unknown.length}(${r.unknown.slice(0, 5).join(',')})` : ''}`);
  return r.state;
};
if (!code || !recsPath || !groupsPath) throw new Error('--code --recs --groups 가 필요합니다');

async function rpc(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'Content-Profile': 'climate_vote', 'Accept-Profile': 'climate_vote' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} ${res.status} ${text}`);
  return JSON.parse(text);
}

/** 16:15~16:45 시간표 블록 — 분과마다 미리 넣는 카드 없는 안건(10/15 사용자 선택). key 로 한 번만 만든다. */
const agendaSpecs = (d: number) => [
  { key: 'baseline-final', title: `${d}분과 최종 권고안 의결` },
  { key: 'baseline-delegate', title: `${d}분과 최종 권고안 문구 작성 위임 의결` },
];

/** 사람이 화면에서 넣은 흔적(헤쳐모여 기록·검토위원·카드 상태 포함) — 있으면 --force 없이는 --replace 로도 덮지 않는다. */
const humanInput = (s: PrepState): string[] => humanInputOf(s, new Map(agendaSpecs(s.division).map((a) => [a.key, a.title])));

const recs = parseImport(readFileSync(recsPath, 'utf8'));
if (recs.kind !== 'recs') throw new Error(`권고안 파일이 아닙니다: ${recs.kind === 'error' ? recs.message : recs.kind}`);
const groups = parseSimilarGroups(readFileSync(groupsPath, 'utf8'));
if (!groups.ok) throw new Error(groups.message);

const auth = await rpc('mod_exchange_join_code', { p_join_code: code, p_device_id: randomUUID(), p_device_label: 'baseline-loader' });
if (!auth?.accessToken) throw new Error('코드로 들어가지 못했습니다(만료·오타·비활성)');
if (auth.team?.subgroup) throw new Error(`운영팀형 코드가 아닙니다(${auth.team.name})`);
console.log(`세션 ${auth.sessionSlug} · ${auth.team.name}${apply ? '' : ' · 미리보기(--apply 없음)'}`);
const got = await rpc('division_prep_get_v1', { p_token: auth.accessToken });

let failed = false;
for (const source of recs.divisions) {
  const sub = `${source.division}분과`;
  const row = (got.rows ?? []).find((r: { subgroup: string }) => r.subgroup === sub) ?? { version: 0, state: null };
  const mine = groups.groups.filter((g) => g.division === source.division);
  // --per-card(10/17 오후): 카드 하나 = 안 하나(제목은 카드 원 제목), 묶음 A..G → 카드 번호 순. 아니면 묶음 하나 = 안 하나.
  const res: { state: PrepState; created: { length: number }; failed: { groupId: string; reason: string }[] } = perCard
    ? (() => {
        const r = cardMotionsState(source, mine);
        return { state: r.state, created: { length: r.created }, failed: r.failed.map((f) => ({ groupId: f.card, reason: f.reason })) };
      })()
    : importSimilarGroups(initPrepState(source), mine);
  for (const a of agendaSpecs(source.division)) {
    const made = createAgendaMotion(res.state, { title: a.title, text: '', key: a.key });
    if (!made.ok) throw new Error(`${sub} 안건 만들기 실패: ${made.error}`);
    res.state = made.state;
  }
  res.state = withExpert(res.state, sub);
  const cards = Object.keys(res.state.cards).length;
  const agendas = res.state.motions.filter((m) => m.cardNos.length === 0).map((m) => m.id);
  const line = `${sub}: 카드 ${cards} · ${perCard ? '카드별 안' : '묶음 안'} ${res.created.length} · 최종 안건 ${agendas.join(',')}${res.failed.length ? ` · 못 만듦 ${res.failed.map((f) => f.groupId).join(',')}` : ''}`;
  if (res.failed.length) failed = true;
  let next = res.state;
  if (row.version && row.state) {
    // 서버 판을 지금 판 모양(v5)으로 읽는다 — 옛 판 번호로 다시 저장하면 옛 화면이 새 칸을 버린다.
    const cur = migratePrep(row.state);
    const rawBallots = Object.keys((row.state as { ballots?: Record<string, unknown> }).ballots ?? {}).length;
    const orphanRounds = ((row.state as { motions?: { id?: string; rounds?: unknown[] }[] }).motions ?? [])
      .filter((m) => Array.isArray(m.rounds) && m.rounds.length > 0)
      .map((m) => m.id ?? '?');
    if (!cur && replace && force && rawBallots === 0) {
      // 화면도 못 읽는 판(예: 다른 세션 판을 복사하며 ballots 만 비워 차수가 가리킬 투표가 없음). 투표가 없으니 통째로 바꾼다.
      console.log(`${sub}: 서버 판 ${row.version}을 읽을 수 없음(투표 0건, 투표 없는 차수 ${orphanRounds.join(',') || '없음'}) — --force 로 통째로 바꿈`);
    } else if (!cur) {
      throw new Error(
        `${sub}: 서버 판을 읽지 못했습니다(투표 ${rawBallots}건, 차수 있는 안 ${orphanRounds.join(',') || '없음'}). 투표가 0건이면 --replace --force 로 바꿀 수 있습니다`,
      );
    }
    const human = cur ? humanInput(cur) : [];
    const votes = human.filter((h) => h.endsWith('투표 기록') || h === '투표');
    if (replace && force && human.length && !votes.length) {
      console.log(`${sub}: --force — 버릴 사람 입력 ${human.length}건: ${human.join(', ')}`);
    }
    if (cur && (!replace || (human.length && !(force && !votes.length)))) {
      // 통째로 바꾸지 않는다. 대신 빠진 최종·위임 안건만 더한다(있던 내용은 그대로).
      let added = withExpert(cur, `${sub}(지금 판)`);
      const names: string[] = [];
      for (const a of agendaSpecs(source.division)) {
        if (added.motions.some((m) => m.key === a.key)) continue;
        const made = createAgendaMotion(added, { title: a.title, text: '', key: a.key });
        if (!made.ok) throw new Error(`${sub} 안건 만들기 실패: ${made.error}`);
        added = made.state;
        names.push(made.motion.id);
      }
      const why = human.length
        ? `사람이 넣은 내용 있음(${human.slice(0, 6).join(', ')}${human.length > 6 ? ' …' : ''})`
        : `서버 판 ${row.version}에 이미 내용(바꾸려면 --replace)`;
      if (replace && human.length) failed = true;
      if (force && votes.length) console.log(`${sub}: 투표 기록이 있어 --force 로도 바꾸지 않습니다(${votes.join(', ')})`);
      if (!names.length && !expert) {
        console.log(`${sub}: 그대로 둠 — ${why}`);
        continue;
      }
      console.log(`${sub}: 통째로 바꾸지 않음 — ${why}.${names.length ? ` 빠진 최종 안건만 더함 ${names.join(',')}` : ''}${expert ? ' 전문가 의견 칸만 바꿈' : ''}`);
      next = added;
    }
    if (cur && next === res.state) {
      // 통째로 바꾼다 — 새 판에도 있는 묶음의 헤쳐모여 기록과 검토위원은 옮긴다.
      const c = carryOverRecords(cur, next);
      next = c.state;
      if (c.carried.length || c.dropped.length) {
        console.log(`${sub}: 옮긴 기록 ${c.carried.join(', ') || '없음'}${c.dropped.length ? ` · 새 판에 없어 버림 ${c.dropped.join(', ')}` : ''}`);
      }
    }
  }
  if (!apply) {
    const whole = next.motions === res.state.motions;
    console.log(`${line} → ${row.version ? `판 ${row.version} 에 저장할 예정(${whole ? "통째로 바꿈" : "안건만 더함"})` : '새로 넣을 예정'}`);
    continue;
  }
  const saved = await rpc('division_prep_save_v1', {
    p_token: auth.accessToken, p_subgroup: sub, p_expected_version: row.version || 0, p_state: next, p_label: '운영팀(기본 자료)',
  });
  if (!saved?.ok) {
    failed = true;
    console.log(`${line} → 저장 충돌(다른 화면이 먼저 고침). 다시 실행하십시오.`);
  } else console.log(`${line} → 저장 판 ${saved.version}`);
}
process.exit(failed ? 1 : 0);
