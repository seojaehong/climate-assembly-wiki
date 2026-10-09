#!/usr/bin/env node
/**
 * 10/17 분과 의결 탭(2단계: 서버 공유 저장·원클릭 투표) — 드라이런 E2E.
 *
 * ★ 실제 Supabase 를 친다. 반드시 **전용 드라이런 세션**의 조 코드로만 돌린다(운영 회차 코드 금지).
 *   서비스 키를 쓰지 않는다 · 아무것도 지우지 않는다 · 세션·조 시드와 정리는 이 스크립트 밖에서 한다.
 *   만든 투표 id·기기 id 는 OUT_DIR/manifest-1017-v2.json 에 남긴다(정리용).
 * ★ 실데이터(recs_1017.json)는 브라우저 「JSON 가져오기」로만 넣고, 로그에 권고 문장을 찍지 않는다.
 *
 * 옛 scripts/verify-1017-e2e.mjs(1단계 화면 기준)는 그대로 두었다 — 이제 맞지 않는다(투표 열기 탭·재적 R 칸 등이 없어짐).
 *
 * ── 실행(Git Bash) ──────────────────────────────────────────
 *   PATH="/c/Users/iceam/tools/node-v20.18.0-win-x64:$PATH" \
 *   PLAYWRIGHT_MODULE=file:///C:/Users/iceam/dev/labor-law-guide/node_modules/playwright/index.mjs \
 *   BASE_URL=https://climate-assembly.org \
 *   SEED_FILE=C:/path/seed-1017-dryrun.json \
 *   RECS_FILE="C:/Users/iceam/OneDrive/_30_컨설팅/2026/기후회의모더레이터/10_작업산출물/2026-10-04_1017토론회_준비/recs_1017.json" \
 *   OUT_DIR=C:/path/e2e-1017-v2-out \
 *   node scripts/verify-1017-e2e-v2.mjs --confirm-dryrun-session
 *
 *   인자 확인만: 위와 같은 환경으로 `node scripts/verify-1017-e2e-v2.mjs --dry-run` (브라우저·네트워크 없음)
 *   선택: EXPECT_COMMIT=<sha> 를 주면 BASE_URL/deployment-revision.json 의 sourceCommit 과 대조한다(안 주면 건너뜀).
 *   로컬 `astro dev`/`astro preview` 에도 BASE_URL=http://localhost:4321 처럼 그대로 쓴다(운영 Supabase env 를 쓰는 빌드).
 *
 * ── SEED_FILE 모양(정확히 이대로) ───────────────────────────
 *   {
 *     "teams": {
 *       "1": ["드라이런 1분과 조 이름", "1분과 조 접속코드"],
 *       "2": ["드라이런 2분과 조 이름", "2분과 조 접속코드"],
 *       "3": ["드라이런 3분과 조 이름", "3분과 조 접속코드"],
 *       "o": ["드라이런 운영팀 이름", "운영팀(분과 칸이 빈 조) 접속코드"]
 *     }
 *   }
 *   조 1·2·3 은 subgroup 이 각각 「1분과」「2분과」「3분과」, o 는 subgroup 이 비어 있어야 한다. 네 조 모두 같은 드라이런 세션.
 *   기기 상한(조마다 2대): 1 = 브라우저 2개, 2 = 브라우저 1 + 스크립트 1, o = 브라우저 1 + 스크립트 1, 3 = 쓰지 않음.
 *   s26(division_prep_get_v1/save_v1) 이 그 DB 에 적용돼 있어야 한다.
 *
 * ── 단계 ────────────────────────────────────────────────────
 *   a 서버 저장·읽기  b 동시 고침 충돌  c 원클릭 시작·투표·두 번 눌러 마감·거수  d 2차·소수 의견
 *   e 분과 범위 네거티브  f 운영팀 현황판·전체 CSV  g 투표 중 새로고침
 *   결과: OUT_DIR/results-1017-v2.json · OUT_DIR/results-1017-v2.md · OUT_DIR/shots/*.png. FAIL 이 하나라도 있으면 종료 코드 1.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const CONFIRMED = argv.includes('--confirm-dryrun-session');
const BASE = (process.env.BASE_URL ?? 'https://climate-assembly.org').replace(/\/+$/, '');
const EXPECT_COMMIT = process.env.EXPECT_COMMIT ?? '';
const SEED_FILE = process.env.SEED_FILE;
const RECS_FILE = process.env.RECS_FILE;
const OUT_DIR = process.env.OUT_DIR;

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

// ── 인자·시드 검증(드라이런에서도 여기까지는 한다) ───────────
if (!SEED_FILE || !RECS_FILE || !OUT_DIR) fail('SEED_FILE, RECS_FILE, OUT_DIR 가 필요합니다(머리말의 실행 예 참고).');
if (!existsSync(SEED_FILE)) fail(`SEED_FILE 이 없습니다: ${SEED_FILE}`);
if (!existsSync(RECS_FILE)) fail(`RECS_FILE 이 없습니다: ${RECS_FILE}`);
const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
for (const k of ['1', '2', '3', 'o']) {
  const t = seed?.teams?.[k];
  if (!Array.isArray(t) || t.length !== 2 || typeof t[0] !== 'string' || typeof t[1] !== 'string' || !t[1].trim()) {
    fail(`SEED_FILE 의 teams["${k}"] 가 [이름, 접속코드] 모양이 아닙니다.`);
  }
}
const recs = JSON.parse(readFileSync(RECS_FILE, 'utf8'));
if (!Array.isArray(recs) || !recs.some((d) => d.division === 1)) fail('RECS_FILE 에 1분과가 없습니다.');
const HOMEWORK = ['2-14', '2-15', '2-16', '2-17'];
const div1 = recs.find((d) => d.division === 1);
// 1분과에서 카드 둘(P = 가결될 안, F = 부결될 안). 같은 주제면 안1·안2, 아니면 각 주제 안1.
const cardsD1 = div1.topics.filter((t) => !HOMEWORK.includes(t.no)).flatMap((t) => t.cards.map((c) => ({ topic: t.no, no: c.no })));
if (cardsD1.length < 2) fail('1분과 카드가 2장 미만입니다.');
const [CARD_P, CARD_F] = cardsD1;

const PLAN = {
  base: BASE,
  expectCommit: EXPECT_COMMIT || '(검사 안 함)',
  teams: Object.fromEntries(Object.entries(seed.teams).map(([k, v]) => [k, v[0]])),
  cards: { pass: CARD_P.no, fail: CARD_F.no },
  attendance: { enrolled: 12, present: 9, threshold: 6 },
  votes: { pass: '찬성 5 · 반대 2 (온라인만 부결) → 거수 찬성 1 → 6 = 가결', fail: '찬성 2 · 반대 5 → 거수 찬성 1 → 3 = 부결', round2: '찬성 3 · 반대 0 → 부결 → 소수 의견' },
  outDir: OUT_DIR,
};
if (DRY) {
  console.log(JSON.stringify({ dryRun: true, ...PLAN }, null, 2));
  process.exit(0);
}
if (!CONFIRMED) fail('드라이런 세션 코드인지 확인했으면 --confirm-dryrun-session 을 붙이십시오. 인자만 보려면 --dry-run.');

const SHOTS = join(OUT_DIR, 'shots');
mkdirSync(SHOTS, { recursive: true });
const MANIFEST = join(OUT_DIR, 'manifest-1017-v2.json');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { devices: [], ballots: [], voterDevices: [] };
const saveManifest = () => writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

// 공개 publishable 키 — 번들에 이미 실려 있다. 로그에는 찍지 않는다.
const SUPA_SRC = readFileSync(resolve(ROOT, 'src/lib/supabase.ts'), 'utf8');
const URL_BASE = /FALLBACK_URL = '([^']+)'/.exec(SUPA_SRC)?.[1];
const ANON = /FALLBACK_ANON =\s*'([^']+)'/.exec(SUPA_SRC)?.[1];
if (!URL_BASE || !ANON) fail('src/lib/supabase.ts 에서 공개 URL·키를 찾지 못했습니다.');

// ── 결과 기록 ────────────────────────────────────────────────
const results = [];
function record(id, ok, detail) {
  results.push({ id, ok: !!ok, detail: String(detail ?? '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} — ${detail}`);
}

// ── RPC(anon 키, 조 토큰) ────────────────────────────────────
async function rpc(name, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'climate_vote',
      'Content-Profile': 'climate_vote',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, message: res.ok ? '' : String(data?.message ?? text).slice(0, 200) };
}
async function login(teamKey) {
  const device = randomUUID();
  const r = await rpc('mod_exchange_join_code', { p_join_code: seed.teams[teamKey][1], p_device_id: device, p_device_label: 'dryrun-1017-v2 script' });
  if (!r.ok || !r.data?.accessToken) throw new Error(`login ${teamKey} failed: ${r.status} ${r.message}`);
  manifest.devices.push({ team: teamKey, device });
  saveManifest();
  return r.data.accessToken;
}
async function serverRow(token, division) {
  const r = await rpc('division_prep_get_v1', { p_token: token });
  if (!r.ok) throw new Error(`division_prep_get_v1: ${r.message}`);
  return (r.data?.rows ?? []).find((x) => x.subgroup === `${division}분과`) ?? null;
}

// ── 브라우저 ─────────────────────────────────────────────────
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true });
const pageErrors = {};

async function newCtx(name, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR', acceptDownloads: true });
  const page = await ctx.newPage();
  pageErrors[name] = [];
  page.on('pageerror', (e) => pageErrors[name].push(String(e.message).slice(0, 200)));
  page.on('dialog', (d) => d.accept());
  return { ctx, page, name };
}
async function openConsole(name, teamKey) {
  const C = await newCtx(name);
  await C.page.goto(`${BASE}/mod?code=${encodeURIComponent(seed.teams[teamKey][1])}`, { waitUntil: 'domcontentloaded' });
  await C.page.locator('#mod-tab-decision').waitFor({ timeout: 40000 });
  await C.page.locator('#mod-tab-decision').click();
  await C.page.locator('[data-testid=division-vote-panel]').waitFor({ timeout: 20000 });
  return C;
}
const shot = (C, file) => C.page.screenshot({ path: join(SHOTS, file) }).catch(() => undefined);
const tab = (page, name) => page.locator('[data-testid=division-vote-panel]').getByRole('tab', { name, exact: true });
const chip = (page) => page.locator('[data-testid=division-sync-chip]');
const notice = (page) => page.locator('[data-testid=division-notice]');
async function waitUntil(fn, ms, step = 500) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* 다시 */
    }
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, step));
  }
}
const waitSaved = (page, ms = 15000) => waitUntil(async () => /저장됨/.test((await chip(page).textContent()) ?? ''), ms);
async function importFile(page, file) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'JSON 가져오기' }).click()]);
  await chooser.setFiles(file);
  await page.waitForTimeout(800);
}
async function makeMotion(page, cardNo, title) {
  await tab(page, '1. 준비판').click();
  await page.locator(`li[data-card-no="${cardNo}"] input[type=checkbox]`).check();
  await page.getByLabel('안 제목', { exact: true }).fill(title);
  await page.getByRole('button', { name: '의결안 만들기' }).click();
  await page.waitForTimeout(300);
  const ids = await page.locator('[data-testid=motion-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-motion-id')));
  return ids;
}
const unitOf = (page, motionId) =>
  page.locator('[data-testid=vote-unit]', { has: page.locator(`[data-testid=motion-vote][data-motion-id="${motionId}"]`) });
async function twoStep(loc) {
  await loc.click();
  await loc.page().waitForTimeout(250);
  await loc.click();
}
/** /b 에서 찬성(2)/반대(1) 하나를 골라 제출. */
async function voteUi(V, token, answer) {
  const groups = V.page.locator('[role=group][aria-label$="응답"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await V.page.goto(`${BASE}/b?t=${token}`, { waitUntil: 'commit', timeout: 60000 }).catch(() => undefined);
    if (await groups.first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)) break;
  }
  await V.page.waitForTimeout(400);
  await groups.first().getByRole('button', { name: answer === 2 ? '찬성' : '반대', exact: true }).click();
  await V.page.getByRole('button', { name: '제출하기' }).first().click();
  await V.page.getByRole('dialog').getByRole('button', { name: '제출하기' }).click();
  await V.page.getByText('의견이 제출되었습니다').waitFor({ timeout: 20000 });
  const dev = await V.page.evaluate(() => localStorage.getItem('cv_device')).catch(() => null);
  if (dev && !manifest.voterDevices.includes(dev)) manifest.voterDevices.push(dev);
}
async function phase(id, fn) {
  try {
    await fn();
  } catch (e) {
    record(`${id}-error`, false, String(e?.message ?? e).slice(0, 300));
  }
}
const lastRound = (state, motionId) => {
  const m = state?.motions?.find((x) => x.id === motionId);
  return m?.rounds?.[m.rounds.length - 1] ?? null;
};
const ballotOf = (state, round) => (round ? state?.ballots?.[round.requestId] ?? null : null);

// ── 공통 상태 ────────────────────────────────────────────────
let A; // 1분과 오퍼레이터
let O; // 운영팀
let TO; // 운영팀 스크립트 토큰(서버 상태 읽기)
let P; // 가결될 안 번호
let F; // 부결될 안 번호
const voters = [];

async function main() {
  if (EXPECT_COMMIT) {
    await phase('P0', async () => {
      const rev = await (await fetch(`${BASE}/deployment-revision.json`, { cache: 'no-store' })).json();
      record('P0-commit', rev.sourceCommit === EXPECT_COMMIT, `sourceCommit=${String(rev.sourceCommit).slice(0, 7)} 기대=${EXPECT_COMMIT.slice(0, 7)}`);
    });
  }
  TO = await login('o');

  // ═══ (a) 서버 저장·읽기 ═══
  await phase('a', async () => {
    A = await openConsole('div1-a', '1');
    await importFile(A.page, RECS_FILE);
    const onlyMine = (await A.page.getByRole('button', { name: '2분과', exact: true }).count()) === 0;
    record('a1-import-locked', onlyMine, '1분과 조는 1분과만 보인다');
    await tab(A.page, '2. 투표 진행').click();
    await A.page.getByLabel('재적', { exact: true }).fill(String(PLAN.attendance.enrolled));
    await A.page.getByLabel('참석', { exact: true }).fill(String(PLAN.attendance.present));
    const line = await A.page.locator('[data-testid=division-pass-line]').textContent();
    record('a2-pass-line', line?.includes(`찬성 ${PLAN.attendance.threshold}표 이상`), line);
    let ids = await makeMotion(A.page, CARD_P.no, 'E2E 가결 예정 안');
    ids = await makeMotion(A.page, CARD_F.no, 'E2E 부결 예정 안');
    [P, F] = ids;
    record('a3-motions', !!P && !!F && ids.length === 2, `안 ${ids.join(', ')}`);
    record('a4-saved-chip', await waitSaved(A.page), (await chip(A.page).textContent()) ?? '');
    const row = await serverRow(TO, 1);
    record('a5-server-row', row?.version > 0 && row?.state?.motions?.length === 2 && row?.state?.attendance?.present === 9, `version ${row?.version} · 안 ${row?.state?.motions?.length} · 참석 ${row?.state?.attendance?.present}`);
    await shot(A, 'a-operator.png');

    // 새 브라우저(이 기기 저장소 없음)에서 같은 내용이 서버에서 온다
    const B = await openConsole('div1-b', '1');
    const ok = await waitUntil(async () => (await B.page.locator('[data-testid=motion-card]').count()) === 2, 20000);
    await tab(B.page, '2. 투표 진행').click();
    const present = await B.page.getByLabel('참석', { exact: true }).inputValue();
    record('a6-fresh-context', ok && present === '9', `새 컨텍스트: 안 ${await B.page.locator('[data-testid=motion-card]').count()} · 참석 ${present}`);
    await shot(B, 'a-fresh-context.png');
    await B.ctx.close();

    // 운영팀 현황판에 10초 안에
    O = await openConsole('ops', 'o');
    const t0 = Date.now();
    const seen = await waitUntil(async () => /후보안\s*2/.test((await O.page.locator('[data-testid=ops-column][data-division="1"]').textContent()) ?? ''), 15000);
    record('a7-ops-board', seen && Date.now() - t0 < 15000, `현황판 반영 ${Math.round((Date.now() - t0) / 1000)}초`);
    await shot(O, 'a-ops-board.png');
  });

  // ═══ (b) 동시 고침 ═══
  await phase('b', async () => {
    await O.page.getByRole('button', { name: '1분과 화면 열기' }).click();
    await tab(O.page, '1. 준비판').click();
    await tab(A.page, '1. 준비판').click();
    // 운영팀 화면의 읽기를 막아 옛 판번호를 쥐고 있게 한다(폴링 때문에 결과가 우연에 맡겨지지 않게)
    await O.page.route('**/rest/v1/rpc/division_prep_get_v1', (r) => r.abort());
    await A.page.getByLabel(`${P} 문안`).fill('A 가 먼저 쓴 문안');
    await waitSaved(A.page);
    await O.page.getByLabel(`${P} 문안`).fill('운영팀이 나중에 쓴 문안');
    const conflict = await waitUntil(async () => /다른 화면에서 먼저 고쳤습니다/.test((await notice(O.page).textContent().catch(() => '')) ?? ''), 15000);
    await shot(O, 'b-conflict-notice.png');
    await O.page.unroute('**/rest/v1/rpc/division_prep_get_v1');
    const oText = await O.page.getByLabel(`${P} 문안`).inputValue();
    const row = await serverRow(TO, 1);
    const sText = row?.state?.motions?.find((m) => m.id === P)?.text;
    record('b1-conflict-notice', conflict, '나중에 저장한 화면에 충돌 안내');
    record('b2-server-wins', oText === 'A 가 먼저 쓴 문안' && sText === 'A 가 먼저 쓴 문안', `운영팀 화면="${oText}" · 서버="${sText}"`);
  });

  // ═══ (c)+(g) 원클릭 시작 → QR → 투표 → 새로고침 → 두 번 눌러 마감 → 거수 ═══
  await phase('c', async () => {
    await tab(A.page, '2. 투표 진행').click();
    const uP = unitOf(A.page, P);
    // 한 번만 누르면 무장만 된다(투표는 아직 없다) → 5초 뒤 원래대로 → 두 번 눌러 시작.
    const startBtn = uP.locator('[data-testid=vote-start]');
    await startBtn.click();
    const armedTxt = (await startBtn.textContent())?.trim();
    await A.page.waitForTimeout(1500);
    const noBallotYet = !Object.values((await serverRow(TO, 1))?.state?.ballots ?? {}).some((b) => b.motionIds.includes(P));
    const startReverted = await waitUntil(async () => (await startBtn.getAttribute('data-armed')) === 'false', 8000);
    record('c0-start-two-step', /다시 누르면 시작/.test(armedTxt ?? '') && noBallotYet && startReverted, `무장 문구="${armedTxt}" · 한 번 누름에 투표 없음=${noBallotYet} · 5초 뒤 원래대로=${startReverted}`);
    await twoStep(startBtn);
    const qr = await A.page.getByRole('button', { name: 'QR 화면 나가기' }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    await shot(A, 'c-qr.png');
    let state = (await serverRow(TO, 1))?.state;
    const rP = lastRound(state, P);
    const bP = ballotOf(state, rP);
    const ballotsForP = Object.values(state?.ballots ?? {}).filter((b) => b.motionIds.includes(P));
    record('c1-start-qr', qr && bP?.stage === 'open' && ballotsForP.length === 1, `QR ${qr} · stage ${bP?.stage} · 이 안의 투표 ${ballotsForP.length}개`);
    if (bP?.ballotId) manifest.ballots.push(bP.ballotId);
    saveManifest();
    const qrText = await A.page.locator('p.font-mono').first().textContent().catch(() => '');
    record('c2-qr-token', !!bP?.token && qrText.includes(`t=${bP.token}`), 'QR 주소가 서버에 적힌 투표 토큰과 같다');
    await A.page.keyboard.press('Escape');

    // (g) 투표 중 새로고침 — 열린 투표와 QR 이 그대로
    await A.page.reload({ waitUntil: 'domcontentloaded' });
    await A.page.locator('#mod-tab-decision').waitFor({ timeout: 40000 });
    if (!(await A.page.locator('[data-testid=division-vote-panel]').count())) await A.page.locator('#mod-tab-decision').click();
    await A.page.locator('[data-testid=division-vote-panel]').waitFor();
    await tab(A.page, '2. 투표 진행').click();
    const openAfter = await waitUntil(async () => (await unitOf(A.page, P).getAttribute('data-phase')) === 'open', 20000);
    await unitOf(A.page, P).locator('[data-testid=vote-qr]').click();
    const qrAgain = await A.page.locator('p.font-mono').first().textContent().catch(() => '');
    record('g1-reload-mid-vote', openAfter && qrAgain.includes(`t=${bP?.token}`), `새로고침 후 투표 중=${openAfter} · QR 같은 토큰=${qrAgain.includes(`t=${bP?.token}`)}`);
    await shot(A, 'g-reload-qr.png');
    await A.page.keyboard.press('Escape');

    // 투표 7명 — 찬성 5, 반대 2
    for (let v = 0; v < 7; v++) voters.push(await newCtx(`voter${v}`, { width: 390, height: 844 }));
    for (let v = 0; v < 7; v++) await voteUi(voters[v], bP.token, v < 5 ? 2 : 1);
    saveManifest();
    await shot(voters[0], 'c-voter.png');

    // 운영팀이 읽기를 막은 채 기타 의견을 고치는 사이 마감 — 투표 사실이 사라지면 안 된다
    await tab(O.page, '2. 투표 진행').click();
    await O.page.route('**/rest/v1/rpc/division_prep_get_v1', (r) => r.abort());
    await O.page.getByLabel(`${P} 기타 의견`).fill('운영팀 메모(충돌로 사라져도 됨)');

    // 한 번만 누르면 5초 뒤 원래대로(마감 안 됨)
    const close = unitOf(A.page, P).locator('[data-testid=vote-close]');
    await close.click();
    const armed = await close.textContent();
    await A.page.waitForTimeout(5600);
    const reverted = (await close.getAttribute('data-armed')) === 'false' && (await unitOf(A.page, P).getAttribute('data-phase')) === 'open';
    record('c3-two-step-revert', armed?.includes('정말 마감합니까') && reverted, `무장 문구="${armed}" · 5초 뒤 원래대로=${reverted}`);
    await twoStep(close);
    const bar = unitOf(A.page, P).locator('[data-testid=result-bar]');
    await bar.waitFor({ timeout: 30000 });
    const yes = (await bar.locator('[data-testid=result-yes]').textContent())?.trim();
    const no = (await bar.locator('[data-testid=result-no]').textContent())?.trim();
    const v1 = await bar.getAttribute('data-verdict');
    record('c4-result-numbers', yes === '5' && no === '2', `찬성 ${yes} · 반대 ${no}`);
    record('c5-below-line-fails', v1 === 'failed', `온라인만 찬성 5 < 가결선 6 → ${v1}`);
    await unitOf(A.page, P).getByLabel('거수 찬성').fill('1');
    const flipped = await waitUntil(async () => (await bar.getAttribute('data-verdict')) === 'passed', 5000);
    record('c6-hand-flips-to-pass', flipped && (await bar.locator('[data-testid=result-yes]').textContent())?.trim() === '6', '거수 찬성 1 더해 6 = 가결선 → 가결');
    await bar.screenshot({ path: join(SHOTS, 'c-result-pass.png') }).catch(() => undefined);
    await waitSaved(A.page, 20000);
    await O.page.unroute('**/rest/v1/rpc/division_prep_get_v1');
    await O.page.waitForTimeout(3000);
    state = (await serverRow(TO, 1))?.state;
    const r1 = lastRound(state, P);
    const b1 = ballotOf(state, r1);
    record(
      'c7-facts-survive-conflict',
      b1?.stage === 'closed' && r1?.onlineYes === 5 && r1?.onlineNo === 2 && r1?.handYes === 1 && r1?.verdict === 'passed',
      `서버: stage ${b1?.stage} · 온라인 ${r1?.onlineYes}/${r1?.onlineNo} · 거수 ${r1?.handYes} · ${r1?.verdict}`,
    );
    const oSeesPass = await waitUntil(async () => (await unitOf(O.page, P).getAttribute('data-phase')) === 'passed', 15000);
    record('c8-ops-sees-pass', oSeesPass, '운영팀 화면에도 가결');

    // F — 찬성 2 · 반대 5, 거수 찬성 1 → 3 (부결)
    const uF = unitOf(A.page, F);
    await twoStep(uF.locator('[data-testid=vote-start]'));
    await A.page.getByRole('button', { name: 'QR 화면 나가기' }).waitFor({ timeout: 20000 });
    await A.page.keyboard.press('Escape');
    state = (await serverRow(TO, 1))?.state;
    const bF = ballotOf(state, lastRound(state, F));
    if (bF?.ballotId) manifest.ballots.push(bF.ballotId);
    saveManifest();
    for (let v = 0; v < 7; v++) await voteUi(voters[v], bF.token, v < 2 ? 2 : 1);
    await twoStep(uF.locator('[data-testid=vote-close]'));
    const barF = uF.locator('[data-testid=result-bar]');
    await barF.waitFor({ timeout: 30000 });
    await uF.getByLabel('거수 찬성').fill('1');
    await A.page.waitForTimeout(500);
    const vF = await barF.getAttribute('data-verdict');
    const yF = (await barF.locator('[data-testid=result-yes]').textContent())?.trim();
    record('c9-fail-case', vF === 'failed' && yF === '3', `찬성 ${yF} < 6 → ${vF}`);
    await barF.screenshot({ path: join(SHOTS, 'c-result-fail.png') }).catch(() => undefined);
    await waitSaved(A.page, 20000);
  });

  // ═══ (d) 2차 투표 · 소수 의견 ═══
  await phase('d', async () => {
    const uF = unitOf(A.page, F);
    await uF.locator('[data-testid=revote]').click();
    await A.page.getByLabel(`${F} 2차 투표 제목`).fill('E2E 부결 예정 안(문구 수정)');
    await twoStep(unitOf(A.page, F).locator('[data-testid=vote-start]'));
    await A.page.getByRole('button', { name: 'QR 화면 나가기' }).waitFor({ timeout: 20000 });
    await A.page.keyboard.press('Escape');
    let state = (await serverRow(TO, 1))?.state;
    const r2 = lastRound(state, F);
    const b2 = ballotOf(state, r2);
    if (b2?.ballotId) manifest.ballots.push(b2.ballotId);
    saveManifest();
    record('d1-round2-linked', r2?.round === 2 && b2?.round === 2 && /2차$/.test(b2?.title ?? '') && state.motions.find((m) => m.id === F).rounds.length === 2, `차수 ${r2?.round} · 제목 「${b2?.title}」`);
    for (let v = 0; v < 3; v++) await voteUi(voters[v], b2.token, 2);
    await twoStep(unitOf(A.page, F).locator('[data-testid=vote-close]'));
    // 1차 결과 막대가 이미 떠 있어서 result-bar 만 기다리면 2차 집계가 오기 전에 센다 → 1차 줄이 생길 때까지 기다린다.
    await unitOf(A.page, F).locator('[data-testid=round-history]').first().waitFor({ timeout: 30000 }).catch(() => undefined);
    const hist = await unitOf(A.page, F).locator('[data-testid=round-history]').count();
    await unitOf(A.page, F).screenshot({ path: join(SHOTS, 'd-round-history.png') }).catch(() => undefined);
    record('d2-round1-kept', hist === 1, `1차 결과 줄 ${hist}`);
    await A.page.getByLabel(`${F} 소수 의견`).fill('E2E 소수 의견');
    await twoStep(unitOf(A.page, F).locator('[data-testid=minority]'));
    const minority = await waitUntil(async () => (await A.page.locator(`[data-testid=motion-vote][data-motion-id="${F}"]`).getAttribute('data-phase')) === 'minority', 5000);
    await waitSaved(A.page, 20000);
    state = (await serverRow(TO, 1))?.state;
    const m = state?.motions?.find((x) => x.id === F);
    record('d3-minority', minority && m?.resolution === 'minority' && m?.minorityOpinion === 'E2E 소수 의견', `resolution ${m?.resolution}`);
    await shot(A, 'd-minority.png');
  });

  // ═══ (e) 분과 범위 네거티브 ═══
  await phase('e', async () => {
    const C2 = await openConsole('div2', '2');
    await importFile(C2.page, RECS_FILE);
    await waitSaved(C2.page, 20000);
    const sees1 = (await C2.page.getByRole('button', { name: '1분과', exact: true }).count()) + (await C2.page.locator(`[data-motion-id="${P}"]`).count());
    record('e1-ui-hides-div1', sees1 === 0 && (await C2.page.locator('[data-testid=ops-board]').count()) === 0, '2분과 화면에 1분과·현황판 없음');
    await shot(C2, 'e-div2.png');
    const T2 = await login('2');
    const got = await rpc('division_prep_get_v1', { p_token: T2 });
    const subs = (got.data?.rows ?? []).map((r) => r.subgroup);
    record('e2-get-own-only', got.ok && subs.length === 1 && subs[0] === '2분과', `받은 분과 ${JSON.stringify(subs)}`);
    const save = await rpc('division_prep_save_v1', { p_token: T2, p_subgroup: '1분과', p_expected_version: 0, p_state: {}, p_label: 'e2e-negative' });
    record('e3-save-div1-denied', !save.ok && /division mismatch/.test(save.message), `${save.status} ${save.message}`);
    const st = (await serverRow(TO, 1))?.state;
    const bP = ballotOf(st, lastRound(st, P));
    const setS = await rpc('ballot_set_status_v2', { p_token: T2, p_ballot_id: bP?.ballotId, p_status: 'closed' });
    record('e4-ballot-div1-denied', !setS.ok && /authorization scope/.test(setS.message), `${setS.status} ${setS.message}`);
    await rpc('workshop_team_logout_v2', { p_token: T2 });
    await C2.ctx.close();
  });

  // ═══ (f) 운영팀 현황판 · 전체 CSV ═══
  await phase('f', async () => {
    await O.page.reload({ waitUntil: 'domcontentloaded' });
    await O.page.locator('#mod-tab-decision').waitFor({ timeout: 40000 });
    if (!(await O.page.locator('[data-testid=division-vote-panel]').count())) await O.page.locator('#mod-tab-decision').click();
    await O.page.locator('[data-testid=ops-board]').waitFor({ timeout: 20000 });
    await importFile(O.page, RECS_FILE); // 비어 있던 3분과만 들어간다
    await O.page.waitForTimeout(6000);
    const col = async (d) => ((await O.page.locator(`[data-testid=ops-column][data-division="${d}"]`).textContent()) ?? '').replace(/\s+/g, '');
    const c1 = await col(1);
    const c2 = await col(2);
    const c3 = await col(3);
    record('f1-board-div1', /후보안2/.test(c1) && /가결1/.test(c1) && /부결0/.test(c1) && /소수의견1/.test(c1) && /재적12·참석9/.test(c1), c1.slice(0, 120));
    record('f2-board-div2', /참석인원미입력/.test(c2) && /후보안0/.test(c2), c2.slice(0, 80));
    record('f3-board-div3', /참석인원미입력/.test(c3) && /후보안0/.test(c3), c3.slice(0, 80));
    await shot(O, 'f-ops-board.png');
    const [dl] = await Promise.all([O.page.waitForEvent('download'), O.page.locator('[data-testid=ops-csv-all]').click()]);
    const csvPath = join(OUT_DIR, dl.suggestedFilename());
    await dl.saveAs(csvPath);
    const raw = readFileSync(csvPath, 'utf8');
    const rows = parseCsv(raw.replace(/^\uFEFF/, ''));
    const header = rows[0] ?? [];
    const body = rows.slice(1).filter((r) => r.length > 1);
    const col_ = (name) => header.indexOf(name);
    const pRow = body.find((r) => r[col_('안번호')] === P);
    const fRows = body.filter((r) => r[col_('안번호')] === F);
    record('f4-csv-name-bom', /^1017_의결결과_전체_\d{8}_\d{4}\.csv$/.test(dl.suggestedFilename()) && raw.charCodeAt(0) === 0xfeff, dl.suggestedFilename());
    record('f5-csv-header', header.length === 24 && header[0] === '분과' && header[23] === '마감시각', `열 ${header.length}`);
    record(
      'f6-csv-rows',
      body.length === 3 &&
        pRow?.[col_('판정')] === '가결' && pRow?.[col_('찬성합계')] === '6' && pRow?.[col_('반대합계')] === '2' && pRow?.[col_('가결선')] === '6' &&
        fRows.length === 2 && fRows[0][col_('판정')] === '부결' && fRows[1][col_('판정')] === '부결(소수의견)' && fRows[1][col_('차수')] === '2차',
      `줄 ${body.length} · P ${pRow?.[col_('판정')]}/${pRow?.[col_('찬성합계')]} · F ${fRows.map((r) => `${r[col_('차수')]}:${r[col_('판정')]}`).join(',')}`,
    );
  });

  const errs = Object.entries(pageErrors).filter(([, v]) => v.length);
  record('z-page-errors', errs.length === 0, errs.map(([k, v]) => `${k}: ${v[0]}`).join(' | ') || '없음');
}

function parseCsv(text) {
  const out = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

try {
  await main();
} catch (e) {
  record('fatal', false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (TO) await rpc('workshop_team_logout_v2', { p_token: TO }).catch(() => undefined);
  await browser.close().catch(() => undefined);
  saveManifest();
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  writeFileSync(join(OUT_DIR, 'results-1017-v2.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), passed, failed, results }, null, 2));
  const md = [
    `# 10/17 의결 E2E v2 — ${failed === 0 ? 'PASS' : 'FAIL'}`,
    '',
    `- 대상: ${BASE}`,
    `- 시각: ${new Date().toISOString()}`,
    `- 통과 ${passed} · 실패 ${failed}`,
    '',
    ...results.map((r) => `- ${r.ok ? 'PASS' : '**FAIL**'} \`${r.id}\` — ${r.detail}`),
    '',
    `스크린샷: ${SHOTS}`,
  ].join('\n');
  writeFileSync(join(OUT_DIR, 'results-1017-v2.md'), md);
  console.log(`\n통과 ${passed} · 실패 ${failed} → ${join(OUT_DIR, 'results-1017-v2.md')}`);
  process.exit(failed === 0 && results.length > 0 ? 0 : 1);
}
