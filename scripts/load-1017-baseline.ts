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
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  importSimilarGroups,
  initPrepState,
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

/** 사람이 화면에서 넣은 흔적 — 있으면 --replace 로도 덮지 않는다. */
function humanInput(s: PrepState): string[] {
  const out: string[] = [];
  for (const m of s.motions) {
    if (m.rounds.length) out.push(`${m.id} 투표 기록`);
    if (m.title.trim()) out.push(`${m.id} 제목`);
    if (m.otherOpinion.trim() || m.minorityOpinion.trim()) out.push(`${m.id} 의견 칸`);
    if (Object.keys(m.grid).length) out.push(`${m.id} 권고 수준`);
  }
  if (s.attendance.enrolled !== null || s.attendance.present !== null) out.push('참석 인원');
  if (Object.keys(s.ballots).length) out.push('투표');
  return out;
}

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
  const res = importSimilarGroups(initPrepState(source), mine);
  const cards = Object.keys(res.state.cards).length;
  const line = `${sub}: 카드 ${cards} · 묶음 안 ${res.created.length}${res.failed.length ? ` · 못 만듦 ${res.failed.map((f) => f.groupId).join(',')}` : ''}`;
  if (res.failed.length) failed = true;
  if (row.version && row.state) {
    const cur = row.state as PrepState;
    const human = humanInput(cur);
    if (!replace) {
      console.log(`${line} → 건너뜀(서버 판 ${row.version}에 이미 내용, 카드 ${Object.keys(cur.cards ?? {}).length} · 안 ${cur.motions?.length ?? 0}). 바꾸려면 --replace`);
      continue;
    }
    if (human.length) {
      failed = true;
      console.log(`${line} → 바꾸지 않음: 사람이 넣은 내용 있음(${human.slice(0, 6).join(', ')}${human.length > 6 ? ' …' : ''})`);
      continue;
    }
  }
  if (!apply) {
    console.log(`${line} → ${row.version ? `판 ${row.version} 덮어쓸 예정` : '새로 넣을 예정'}`);
    continue;
  }
  const saved = await rpc('division_prep_save_v1', {
    p_token: auth.accessToken, p_subgroup: sub, p_expected_version: row.version || 0, p_state: res.state, p_label: '운영팀(기본 자료)',
  });
  if (!saved?.ok) {
    failed = true;
    console.log(`${line} → 저장 충돌(다른 화면이 먼저 고침). 다시 실행하십시오.`);
  } else console.log(`${line} → 저장 판 ${saved.version}`);
}
process.exit(failed ? 1 : 0);
