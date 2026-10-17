/**
 * 10/17 오전 통합 결과 시트(CSV) → 서버 준비판. 「묶음 기록 CSV」와 같은 모양이라 내보낸 파일을 고쳐 다시 넣을 수 있다.
 *
 *   npx tsx scripts/import-1017-sheet.ts --code <운영팀형 6자리 코드> --csv <시트.csv> [--force] [--apply --after-deploy]
 *
 * - 미리보기가 기본이다(서버에 쓰지 않음). 바뀌는 것(옛 → 새)·덮어쓸 사람 입력·오류·경고를 분과별로 찍는다.
 * - 머리행은 BUNDLE_CSV_COLUMNS 와 글자까지 같아야 한다. CSV(UTF-8, BOM 허용)만 받는다 — 엑셀은 「CSV UTF-8」로 저장해서 넣는다.
 * - 분과 단위로 전부 아니면 전무: 오류가 하나라도 있는 분과는 쓰지 않는다. 파일에 없는 분과·묶음·안은 건드리지 않는다.
 * - 투표 기록(차수·투표)이 있는 분과는 절대 바꾸지 않는다.
 * - 서버에 사람이 넣은 값(안 제목·묶음 기록·검토위원)이 다른 값으로 바뀌면 --force 없이는 그 분과를 쓰지 않는다.
 * - 저장은 division_prep_save_v1(판 번호 대조) — 그사이 화면에서 누가 고쳤으면 「저장 충돌」로 멈춘다. 다시 실행하면 된다.
 * - 검토위원 이름은 명단(ballot_session_roster_v2, s29)과 대조해 경고만 한다. 출력에 이름을 찍는 것은 바뀌는 값뿐이다.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { migratePrep, type PrepState } from '../src/islands/mod/division-vote-logic';
import { applySheet, readSheet, sheetFileErrors } from '../src/islands/mod/division-sheet-import';

const URL = 'https://pleyuknjnprsckssxvrh.supabase.co';
const ANON = readFileSync(new globalThis.URL('../src/lib/supabase.ts', import.meta.url), 'utf8').match(/FALLBACK_ANON = '([^']+)'/)?.[1];
if (!ANON) throw new Error('anon key not found in src/lib/supabase.ts');

const arg = (k: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const code = arg('--code');
const csvPath = arg('--csv');
const apply = process.argv.includes('--apply');
const force = process.argv.includes('--force');
if (!code || !csvPath) throw new Error('--code --csv 가 필요합니다');
if (apply && !process.argv.includes('--after-deploy')) {
  throw new Error('판 번호 5로 씁니다. 배포·전 화면 새로고침을 확인한 뒤 --after-deploy 를 붙여 다시 실행하십시오.');
}

async function rpc(fn: string, body: Record<string, unknown>): Promise<{ ok: true; data: any } | { ok: false; status: number; text: string }> {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'Content-Profile': 'climate_vote', 'Accept-Profile': 'climate_vote' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return res.ok ? { ok: true, data: JSON.parse(text) } : { ok: false, status: res.status, text };
}
async function must(fn: string, body: Record<string, unknown>) {
  const r = await rpc(fn, body);
  if (!r.ok) throw new Error(`${fn} ${r.status} ${r.text}`);
  return r.data;
}

const sheet = readSheet(readFileSync(csvPath, 'utf8'));
if (!sheet.ok) throw new Error(sheet.message);
const fileErrors = sheetFileErrors(sheet.rows, [1, 2, 3]);
if (fileErrors.length) {
  for (const e of fileErrors) console.log(`파일 오류 ${e}`);
  process.exit(1);
}
const divisions = [...new Set(sheet.rows.map((r) => r.division as number))].sort();

const auth = await must('mod_exchange_join_code', { p_join_code: code, p_device_id: randomUUID(), p_device_label: 'sheet-import' });
if (!auth?.accessToken) throw new Error('코드로 들어가지 못했습니다(만료·오타·비활성)');
if (auth.team?.subgroup) throw new Error(`운영팀형 코드가 아닙니다(${auth.team.name})`);
console.log(`세션 ${auth.sessionSlug} · ${auth.team.name} · 파일 ${sheet.rows.length}줄 · 분과 ${divisions.map((d) => `${d}분과`).join(',')}${apply ? '' : ' · 미리보기(--apply 없음)'}`);

// 검토위원 대조용 명단(s29). 없으면 대조하지 않는다.
let roster: Map<string, string[]> | undefined;
const rr = await rpc('ballot_session_roster_v2', { p_token: auth.accessToken });
if (rr.ok && Array.isArray(rr.data)) {
  roster = new Map();
  for (const r of rr.data as { team: string; name: string }[]) roster.set(r.team, [...(roster.get(r.team) ?? []), r.name]);
} else console.log('명단을 읽지 못해 검토위원 이름은 대조하지 않습니다(s29 미적용?).');

const got = await must('division_prep_get_v1', { p_token: auth.accessToken });
let failed = false;
for (const d of divisions) {
  const sub = `${d}분과`;
  const row = (got.rows ?? []).find((r: { subgroup: string }) => r.subgroup === sub);
  if (!row?.version || !row.state) {
    console.log(`${sub}: 서버 판이 없습니다 — 기본 자료(load-1017-baseline)부터 넣으십시오.`);
    failed = true;
    continue;
  }
  const cur: PrepState | null = migratePrep(row.state);
  if (!cur) {
    console.log(`${sub}: 서버 판(${row.version})을 읽지 못했습니다.`);
    failed = true;
    continue;
  }
  const r = applySheet(cur, sheet.rows, roster);
  console.log(`\n── ${sub} (서버 판 ${row.version}) — 바뀜 ${r.changes.length} · 덮어씀 ${r.overwrites.length} · 오류 ${r.errors.length} · 경고 ${r.warnings.length}`);
  for (const c of r.changes) console.log(`  바뀜  ${c}`);
  for (const o of r.overwrites) console.log(`  덮어씀 ${o}`);
  for (const w of r.warnings) console.log(`  경고  ${w}`);
  for (const e of r.errors) console.log(`  오류  ${e}`);
  if (r.errors.length) {
    console.log(`  → ${sub} 은 쓰지 않습니다(오류).`);
    failed = true;
    continue;
  }
  if (!r.changes.length) {
    console.log(`  → 바뀔 것이 없습니다.`);
    continue;
  }
  if (r.overwrites.length && !force) {
    console.log(`  → 사람이 넣은 값 ${r.overwrites.length}개를 덮어씁니다. 맞으면 --force 를 붙이십시오. ${sub} 은 쓰지 않습니다.`);
    failed = true;
    continue;
  }
  if (!apply) {
    console.log(`  → 판 ${row.version} 위에 저장할 예정`);
    continue;
  }
  const saved = await rpc('division_prep_save_v1', {
    p_token: auth.accessToken, p_subgroup: sub, p_expected_version: row.version, p_state: r.state, p_label: '운영팀(시트 가져오기)',
  });
  if (!saved.ok || !saved.data?.ok) {
    failed = true;
    console.log(`  → 저장 충돌(그사이 화면에서 고침) 또는 오류 — 다시 실행하십시오. ${saved.ok ? '' : saved.text.slice(0, 200)}`);
  } else console.log(`  → 저장 판 ${saved.data.version}`);
}
process.exit(failed ? 1 : 0);
