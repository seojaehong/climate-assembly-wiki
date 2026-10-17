/**
 * 10/17 오전 세부권고 검토표(CSV) → 서버 준비판의 세부권고 처리(recEdits). 카드별 투표(오후)에 쓴다.
 *
 *   npx tsx scripts/import-1017-recedits.ts --code <운영팀형 6자리 코드> --csv <검토표.csv> [--force] [--apply --after-deploy]
 *   npx tsx scripts/import-1017-recedits.ts --recs <recs_1017.json> --csv <검토표.csv>   (서버 없이 점검만 — 새 기본 판 기준)
 *
 * - 입력은 sheet_review_to_csv.py 가 만든 CSV(UTF-8, BOM 허용). 머리행은 REC_EDIT_CSV_COLUMNS 와 글자까지 같아야 한다.
 *   빈 처리 = 유지. 추가 줄은 세부권고 번호를 비우고 권고카드에 붙는다.
 * - 미리보기가 기본이다(서버에 쓰지 않음). 분과마다 카드별 남은 세부권고 수(이전 → 이후)와 처리 줄, 비게 되는 카드를 찍는다.
 * - 분과 단위로 전부 아니면 전무: 오류가 하나라도 있는 분과는 쓰지 않는다. 파일에 없는 분과는 건드리지 않는다.
 *   파일에 있는 분과는 그 분과의 처리 목록을 파일 것으로 통째로 바꾼다 — 같은 파일을 다시 넣으면 바뀌는 것이 없다.
 * - 투표 기록(차수·투표)이 있는 분과는 절대 바꾸지 않는다.
 * - 서버에 이미 있던 처리가 바뀌거나 없어지면(사람이 넣었을 수 있다) --force 없이는 그 분과를 쓰지 않는다.
 * - 저장은 division_prep_save_v1(판 번호 대조) — 그사이 화면에서 누가 고쳤으면 「저장 충돌」로 멈춘다. 다시 실행하면 된다.
 * - 출력에 사람 이름은 없다(번호·처리·문구만).
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initPrepState, migratePrep, parseImport, type PrepState } from '../src/islands/mod/division-vote-logic';
import { parseCsv } from '../src/islands/mod/division-sheet-import';
import { planRecEdits, readRecEditTable } from '../src/islands/mod/division-rec-edits';

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
const recsPath = arg('--recs');
if ((!code && !recsPath) || !csvPath) throw new Error('--code(또는 --recs) --csv 가 필요합니다');
if (apply && !process.argv.includes('--after-deploy')) {
  throw new Error('판 번호 6(세부권고 처리)으로 씁니다. 배포·전 화면 새로고침을 확인한 뒤 --after-deploy 를 붙여 다시 실행하십시오.');
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

const table = readRecEditTable(parseCsv(readFileSync(csvPath, 'utf8')));
if (!table.ok) throw new Error(table.message);
const rows = table.rows.filter((r) => r.divisionText || r.edit.card || r.edit.no || r.rawAction);
const bad = rows.filter((r) => r.division === null);
if (bad.length) {
  for (const r of bad) console.log(`파일 오류 ${r.line}행: 분과 「${r.divisionText}」 — 「N분과」 형식이어야 합니다.`);
  process.exit(1);
}
const divisions = [...new Set(rows.map((r) => r.division as number))].sort();

function report(sub: string, version: number | string, cur: PrepState) {
  const p = planRecEdits(cur, rows);
  const overwrites = p.changes.filter((c) => c.startsWith('바뀜') || c.startsWith('없어짐'));
  const mine = rows.filter((r) => r.division === cur.division);
  console.log(
    `\n── ${sub} (판 ${version}) — 파일 ${mine.length}줄 · 처리 ${p.edits.length} · 바뀜 ${p.changes.length} · 덮어씀 ${overwrites.length} · 오류 ${p.errors.length} · 경고 ${p.warnings.length}`,
  );
  for (const c of p.cardDiff) console.log(`  카드 ${c.card}  남은 세부권고 ${c.before} → ${c.after}${c.after === 0 ? '  (남은 것 없음 — 투표 제외 후보)' : ''}`);
  for (const c of p.changes) console.log(`  ${c.startsWith('새로') ? '처리 ' : '덮어씀'} ${c}`);
  for (const w of p.warnings) console.log(`  경고  ${w}`);
  for (const c of p.emptied) console.log(`  경고  카드 ${c} 에 남은 세부권고가 없습니다(투표 제외 후보).`);
  for (const e of p.errors) console.log(`  오류  ${e}`);
  return { p, overwrites };
}

// 서버 없이 점검만(--recs): 새 기본 판 기준으로 같은 점검·미리보기를 찍는다.
if (!code) {
  const recs = parseImport(readFileSync(recsPath as string, 'utf8'));
  if (recs.kind !== 'recs') throw new Error('권고안 파일이 아닙니다');
  let bad = false;
  for (const d of divisions) {
    const source = recs.divisions.find((x) => x.division === d);
    if (!source) {
      console.log(`${d}분과: 권고안 파일에 없습니다.`);
      bad = true;
      continue;
    }
    if (report(`${d}분과`, '새 기본', initPrepState(source)).p.errors.length) bad = true;
  }
  process.exit(bad ? 1 : 0);
}

const auth = await must('mod_exchange_join_code', { p_join_code: code, p_device_id: randomUUID(), p_device_label: 'recedits-import' });
if (!auth?.accessToken) throw new Error('코드로 들어가지 못했습니다(만료·오타·비활성)');
if (auth.team?.subgroup) throw new Error(`운영팀형 코드가 아닙니다(${auth.team.name})`);
console.log(`세션 ${auth.sessionSlug} · 파일 ${rows.length}줄 · 분과 ${divisions.map((d) => `${d}분과`).join(',')}${apply ? '' : ' · 미리보기(--apply 없음)'}`);

const got = await must('division_prep_get_v1', { p_token: auth.accessToken });
let failed = false;
for (const d of divisions) {
  const sub = `${d}분과`;
  const row = (got.rows ?? []).find((r: { subgroup: string }) => r.subgroup === sub);
  if (!row?.version || !row.state) {
    console.log(`\n${sub}: 서버 판이 없습니다 — 기본 자료(load-1017-baseline --per-card)부터 넣으십시오.`);
    failed = true;
    continue;
  }
  const cur: PrepState | null = migratePrep(row.state);
  if (!cur) {
    console.log(`\n${sub}: 서버 판(${row.version})을 읽지 못했습니다.`);
    failed = true;
    continue;
  }
  const { p, overwrites } = report(sub, row.version, cur);
  if (p.errors.length) {
    console.log(`  → ${sub} 은 쓰지 않습니다(오류).`);
    failed = true;
    continue;
  }
  if (!p.changes.length) {
    console.log('  → 바뀔 것이 없습니다(이미 같은 처리).');
    continue;
  }
  if (overwrites.length && !force) {
    console.log(`  → 서버에 있던 처리 ${overwrites.length}개를 바꾸거나 없앱니다. 맞으면 --force 를 붙이십시오. ${sub} 은 쓰지 않습니다.`);
    failed = true;
    continue;
  }
  if (!apply) {
    console.log(`  → 판 ${row.version} 위에 저장할 예정`);
    continue;
  }
  const saved = await rpc('division_prep_save_v1', {
    p_token: auth.accessToken, p_subgroup: sub, p_expected_version: row.version, p_state: p.state, p_label: '운영팀(세부권고 검토표)',
  });
  if (!saved.ok || !saved.data?.ok) {
    failed = true;
    console.log(`  → 저장 충돌(그사이 화면에서 고침) 또는 오류 — 다시 실행하십시오. ${saved.ok ? '' : saved.text.slice(0, 200)}`);
  } else console.log(`  → 저장 판 ${saved.data.version}`);
}
process.exit(failed ? 1 : 0);
