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
 *   기기 상한은 s27(2026-10-10)로 없어졌다. 그래도 같은 조 코드로 다시 돌리면 준비판이 남아 있어 판정이 틀어지므로
 *   **실행마다 새 드라이런 세션**을 시드한다(slug zz-dryrun-1017-<YYYYMMDD>t<HHMM>, 조 4개, 만료 now()+6h).
 *   시드·정리 SQL 은 PAT + Management API 로 셸에서 친다(MCP 아님). 정리 = session status 'archived'·만료 now(),
 *   team status 'disabled'. workshop_audit_event 는 지우지 않는다(삭제 금지 트리거). 실세션·리허설 코드 금지.
 *   s26(division_prep_get_v1/save_v1) 이 그 DB 에 적용돼 있어야 한다.
 *
 * ── 단계(2026-10-15 판 = cec9d50 이후 화면) ─────────────────
 *   a 서버 저장·읽기 + 1장 자동 제목·2장째 비움·주제 섞기 경고(막지 않음)·남은 글자·묶음 버튼 없음
 *     + 카드 공유 경고(잠금 아님) + 유사 묶음 파일 가져오기(가상 묶음, 카드 공유)·다시 가져와도 그대로·빈 제목 [투표 시작] 막힘
 *     + 카드 없는 안건(1-최종-안1, 투표 진행 맨 뒤)
 *   b 같은 분과 PC-A·PC-B 두 브라우저 실제 충돌 → 늦은 화면의 고침을 최신 위에 다시 적용(둘 다 남는다)
 *   c 무장 문구 형식 · 한 번에 한 안 · 새로고침 시 QR 자동 · /b 찬성 위·초록/반대 빨강·확인 창 「선택: 찬성」
 *     · 두 번 눌러 마감 · 거수 잠정 → [거수 입력 완료] 확정 · 결과 막대 색(가결 초록·부결 회색)
 *   d 부결 → 2차(1차 결과 거수 칸 잠김·2차 중 안내) → [거수 없음] → 소수 의견
 *   v [잘못 연 투표 무효](차수 안 씀·서버 투표 닫힘·무효 줄) · 결과 뒤 무효는 운영팀 화면에만
 *   l 카드 없는 안건 투표 + 마감 뒤 제출 안내(「이 표는 반영되지 않았습니다」) + 거수만으로 가결
 *   h 운영팀 코드로 1분과 안(주제 섞인 긴 제목)을 대신 열고 닫기 → 분과 PC 에 「다른 화면에서 연 투표」 알림 · QR 2단 · 휴대폰 긴 제목
 *   e 분과 범위 네거티브  f 운영팀 현황판·전체 CSV(무효 줄 포함)
 *   i 운영팀이 3분과를 직접 준비·저장·투표 열고 닫기([거수 없음])  j 세리머니 빠진 안 목록 · 상정 N건(분과 안 M건 중) · 1920×1080 긴 제목 무잘림
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
// M = 주제가 다른 카드 두 장을 합친 긴 안(10/14 — 같은 분과면 주제가 달라도 합친다, 경고만). 제목이 있는 카드만 쓴다(자동 채움 확인).
const titled = cardsD1.filter((c, i) => i >= 2 && (div1.topics.find((t) => t.no === c.topic).cards.find((x) => x.no === c.no).title ?? '').trim());
const M1 = titled[0];
const M2 = titled.find((c) => c.topic !== M1?.topic);
// 손으로 고친 제목은 2장째에도 남는다 — 같은 주제 두 장(M 과 겹치지 않는 카드)
const K1 = titled.find((c) => ![M1?.no, M2?.no].includes(c.no) && titled.some((d) => d.topic === c.topic && d.no !== c.no));
const K2 = K1 ? titled.find((c) => c.topic === K1.topic && c.no !== K1.no) : null;
if (!M1 || !M2 || !K1 || !K2) fail('1분과에서 섞기·자동 채움 시험용 카드를 고르지 못했습니다.');
const cardTitle = (no) => div1.topics.flatMap((t) => t.cards).find((c) => c.no === no).title.trim();
const M_ID_EXPECT = `${M1.topic}-안1`;
// 합친 문구(가상) — 안 번호 + 띄어쓰기 + 제목 ≤ 300. 끝에 표지어를 둬서 「끝까지 보이는가」를 잰다.
const M_TITLE = (() => {
  const budget = 300 - M_ID_EXPECT.length - 1 - 8; // 8자 남긴다
  const words = 'E2E 합친 문구 시험 기후 위기 대응을 위한 시민 참여 확대와 지역 에너지 전환 지원을 함께 권고한다 '.repeat(12);
  const tail = ' 끝표지어마지막';
  return (words.slice(0, budget - tail.length).trimEnd() + tail).trim();
})();
const DECISION_NOTICE = '운영규정에 따라 참석자 3분의 2 이상 찬성하면 가결됩니다. 부결되면 다시 투표합니다.';
/** 화면 무장 문구의 제목 앞부분(division-vote-flow.ts titleHead 와 같은 규칙). */
const titleHead = (t, max = 18) => {
  const chars = [...t.replace(/\s+/g, ' ').trim()];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
};
const ARMED_TAIL = { start: '투표를 시작합니까? (다시 누르면 시작)', close: '투표를 마감합니까? (다시 누르면 마감)', void: '투표를 무효로 합니까? (다시 누르면 무효)' };
const armed = (kind, label, title) => `1분과 ${label} 「${titleHead(title)}」 ${ARMED_TAIL[kind]}`;
// 유사 묶음(가상) — 실제 묶음 이름은 공표 전이라 쓰지 않는다. 카드 번호·세부 번호만 실데이터에서 고른다.
// 두 묶음이 카드 하나(GY)를 함께 쓴다(실제 파일의 1-7-2 = 유사5·6·7 과 같은 모양). 2분과 묶음 하나는 1분과 화면이 건너뛰어야 한다.
const usedNos = new Set([CARD_P.no, CARD_F.no, M1.no, M2.no, K1.no, K2.no]);
const pool = cardsD1.filter((c) => !usedNos.has(c.no));
const GX = pool[0];
const GY = pool.find((c) => c.topic !== GX?.topic) ?? pool[1];
const GZ = pool.find((c) => ![GX?.no, GY?.no].includes(c.no));
if (!GX || !GY || !GZ) fail('1분과에서 유사 묶음 시험용 카드를 고르지 못했습니다.');
const recNos = (no) => div1.topics.flatMap((t) => t.cards).find((c) => c.no === no).recs.slice(0, 2).map((r) => r.no);
const div2src = recs.find((d) => d.division === 2);
const d2card = div2src?.topics?.[0]?.cards?.[0];
const GROUPS = {
  source: 'E2E 가상 묶음(실제 묶음 아님)',
  groups: [
    { id: 'E2E유사1', division: '1분과', name: 'E2E 가상 공통 취지 가', recs: [...recNos(GX.no), ...recNos(GY.no)], cards: [GX.no, GY.no], teams: ['1조', '3조'] },
    { id: 'E2E유사2', division: 1, name: 'E2E 가상 공통 취지 나', recs: [...recNos(GY.no), ...recNos(GZ.no)], cards: [GY.no, GZ.no], teams: ['2조'] },
    ...(d2card ? [{ id: 'E2E유사9', division: '2분과', name: 'E2E 가상 공통 취지 다', recs: d2card.recs.slice(0, 1).map((r) => r.no), cards: [d2card.no], teams: [] }] : []),
  ],
};
const AGENDA_TITLE = '최종 권고안 문구 작성 위임 의결';
const AGENDA_ID = '1-최종-안1';
const VOID_TITLE = 'E2E 무효 시험 안(합친 문구)';
/** 1분과 안 수 — P·F·M + 묶음 2 + 카드 없는 안건 1. */
const D1_MOTIONS = 6;

const PLAN = {
  base: BASE,
  expectCommit: EXPECT_COMMIT || '(검사 안 함)',
  teams: Object.fromEntries(Object.entries(seed.teams).map(([k, v]) => [k, v[0]])),
  cards: { pass: CARD_P.no, fail: CARD_F.no, mixed: [M1.no, M2.no], mixedTitleLength: M_TITLE.length, keepCustom: [K1.no, K2.no], groups: GROUPS.groups.map((g) => `${g.id}:${g.cards.join('+')}`) },
  attendance: { enrolled: 12, present: 9, threshold: 6 },
  votes: {
    pass: '찬성 5 · 반대 2 (온라인만 부결) → 거수 찬성 1 → 6 = 가결',
    fail: '찬성 2 · 반대 5 → 거수 찬성 1 → 3 = 부결',
    round2: '찬성 3 · 반대 0 → 부결 → 소수 의견',
    mixedByOps: '운영팀이 1분과 M 을 열고 닫음: 찬성 3 → 거수 찬성 3 → 6 = 가결',
    div3ByOps: '운영팀이 3분과 준비판 저장 + 안 하나 열고 닫음(찬성 1)',
  },
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
/** /b 를 열고 찬성(2)/반대(1)를 고른 뒤 확인 창까지 연다(제출은 아직). */
async function prepareVote(V, token, answer, inspect, onChosen) {
  const groups = V.page.locator('[role=group][aria-label$="응답"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await V.page.goto(`${BASE}/b?t=${token}`, { waitUntil: 'commit', timeout: 60000 }).catch(() => undefined);
    if (await groups.first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false)) break;
  }
  await V.page.waitForTimeout(400);
  if (inspect) await inspect(V.page);
  await groups.first().getByRole('button', { name: answer === 2 ? '찬성' : '반대', exact: true }).click();
  if (onChosen) await onChosen(V.page);
  await V.page.getByRole('button', { name: '제출하기' }).first().click();
  await V.page.getByRole('dialog').waitFor({ timeout: 10000 });
}
/** /b 에서 찬성(2)/반대(1) 하나를 골라 제출. onDialog = 확인 창이 떠 있을 때 살펴보기. */
async function voteUi(V, token, answer, inspect, onChosen, onDialog) {
  await prepareVote(V, token, answer, inspect, onChosen);
  if (onDialog) await onDialog(V.page);
  await V.page.getByRole('dialog').getByRole('button', { name: '제출하기' }).click();
  await V.page.getByText('투표가 제출되었습니다').waitFor({ timeout: 20000 });
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
let M = null; // 주제 섞인 긴 안(운영팀이 열고 닫는다)
let G1 = null; // 유사 묶음 E2E유사1 로 만든 안(제목 넣고 열었다가 무효)
let G2 = null; // 유사 묶음 E2E유사2 로 만든 안(제목 빈 채 남는다 → 세리머니 빠진 안)
const voters = [];
/** 계산된 색(rgb(...)). */
const cssOf = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop).catch(() => '');
const GREEN = 'rgb(47, 111, 37)'; // #2F6F25 (/b 찬성 선택)
const RED = 'rgb(185, 28, 28)'; // #B91C1C (/b 반대 선택)
const BAR_GREEN = 'rgb(53, 194, 122)'; // #35C27A (결과 막대 찬성·가결 도장)
const BAR_GREY = 'rgb(159, 179, 194)'; // #9FB3C2 (부결 도장)
const verdictText = async (unit) => ((await unit.locator('[data-testid=result-verdict]').first().textContent().catch(() => '')) ?? '').trim();
/** 요소가 잘리지 않고 화면 안에 다 들어오는가(스크롤·넘침 없음). */
async function fitOf(loc) {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, vw: innerWidth };
  });
}
const fitsBox = (f) => !!f && f.sh <= f.ch + 1 && f.sw <= f.cw + 1 && f.top >= 0 && f.bottom <= f.vh;

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

    // ── 10/14 판: 카드 잠금 · 자동 채움 · 주제 섞기 경고 · 긴 합친 문구 ──
    const pg = A.page;
    const box = (no) => pg.locator(`li[data-card-no="${no}"] input[type=checkbox]`);
    const titleBox = pg.getByLabel('안 제목', { exact: true });
    // 10/14 밤 — 잠금 해제: 다른 안에 들어간 카드도 고를 수 있고(유사 묶음이 카드를 공유) 들어간 안 번호를 적는다.
    const lockP = await box(CARD_P.no).isDisabled();
    const inP = await pg.locator(`li[data-card-no="${CARD_P.no}"]`).getAttribute('data-in-motion');
    record('a3b-card-shared-ok', !lockP && inP === P, `${CARD_P.no} 체크 가능=${!lockP} · 들어간 안=${inP}`);
    // 1장 → 그 카드 제목이 미리 들어간다
    await box(M1.no).check();
    const auto1 = await titleBox.inputValue();
    record('a3c-autofill-one', auto1 === cardTitle(M1.no), `카드 1장 → 안 제목 = 카드 제목 ${auto1 === cardTitle(M1.no)} (${[...auto1].length}자)`);
    // 2장째(다른 주제) → 미리 넣은 제목 비움 + 주황 경고 + 만들기 버튼은 살아 있다
    await box(M2.no).check();
    const auto2 = await titleBox.inputValue();
    record('a3d-autofill-cleared', auto2 === '', `2장째 고름 → 안 제목 「${auto2.slice(0, 20)}」`);
    const warnVisible = await pg.locator('[data-testid=combine-warning]').isVisible().catch(() => false);
    const warnText = ((await pg.locator('[data-testid=combine-warning]').textContent().catch(() => '')) ?? '').trim();
    await titleBox.fill(M_TITLE);
    const makeBtn = pg.getByRole('button', { name: '의결안 만들기' });
    const enabled = await makeBtn.isEnabled();
    const roomTxt = ((await pg.locator('[data-testid=motion-builder] [data-testid=title-room]').textContent()) ?? '').trim();
    record(
      'a3e-mixed-topic-warning',
      warnVisible && warnText.includes(M1.topic) && warnText.includes(M2.topic) && enabled,
      `경고 보임=${warnVisible} · 「${warnText.slice(0, 60)}」 · 만들기 버튼 활성=${enabled}`,
    );
    record('a3f-title-room', /남은 글자 \d+자/.test(roomTxt) && !/넘쳤/.test(roomTxt), `${roomTxt} (제목 ${[...M_TITLE].length}자)`);
    await pg.locator('[data-testid=motion-builder]').screenshot({ path: join(SHOTS, 'a-mixed-warning.png') }).catch(() => undefined);
    await makeBtn.click();
    await pg.waitForTimeout(400);
    const idsM = await pg.locator('[data-testid=motion-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-motion-id')));
    M = idsM.find((x) => ![P, F].includes(x)) ?? null;
    const mCardTitle = M ? await pg.getByLabel(`${M} 제목`, { exact: true }).inputValue() : '';
    const mixedBadge = M ? await pg.locator(`[data-testid=motion-card][data-motion-id="${M}"]`).getByText('주제 섞임').count() : 0;
    record('a3g-mixed-motion', M === M_ID_EXPECT && mCardTitle === M_TITLE && mixedBadge === 1, `안 ${M} (기대 ${M_ID_EXPECT}) · 제목 그대로=${mCardTitle === M_TITLE} · 「주제 섞임」 표지 ${mixedBadge}`);
    // 10/14 밤 — 안에 들어간 카드는 잠그지 않는다. 다시 고르면 「이 카드는 ○ 에도 들어 있습니다」 경고만.
    const freeM = !(await box(M1.no).isDisabled()) && !(await box(M2.no).isDisabled());
    const inM1 = await pg.locator(`li[data-card-no="${M1.no}"]`).getAttribute('data-in-motion');
    await box(M1.no).check();
    const sharedTxt = ((await pg.locator('[data-testid=shared-card-warning]').textContent().catch(() => '')) ?? '').trim();
    const makeOk = await pg.getByRole('button', { name: '의결안 만들기' }).isEnabled();
    record(
      'a3h-shared-card-warns-not-locks',
      freeM && inM1 === M && sharedTxt.includes(`${M1.no}`) && sharedTxt.includes(M ?? '?') && makeOk,
      `${M1.no}·${M2.no} 체크 가능=${freeM} · 들어간 안=${inM1} · 다시 고르면 경고 「${sharedTxt.slice(0, 50)}」 · 만들기 버튼 활성=${makeOk}`,
    );
    await pg.locator('[data-testid=motion-builder]').screenshot({ path: join(SHOTS, 'a-shared-card-warning.png') }).catch(() => undefined);
    await pg.getByRole('button', { name: '선택 해제' }).click();
    // 손으로 고친 제목은 2장째를 골라도 남는다
    await box(K1.no).check();
    await titleBox.fill('E2E 손으로 고친 제목');
    await box(K2.no).check();
    const kept = await titleBox.inputValue();
    record('a3i-custom-title-kept', kept === 'E2E 손으로 고친 제목', `2장째 고른 뒤 안 제목 「${kept}」`);
    await pg.getByRole('button', { name: '선택 해제' }).click();

    // ── 유사 묶음 파일 가져오기(가상 묶음, 카드 공유) ──
    const groupsPath = join(OUT_DIR, 'e2e-similar-groups-virtual.json');
    writeFileSync(groupsPath, JSON.stringify(GROUPS, null, 2));
    const before = await pg.locator('[data-testid=motion-card]').count();
    await pg.locator('[data-testid=groups-import-input]').setInputFiles(groupsPath);
    await pg.waitForTimeout(800);
    const n1 = ((await notice(pg).textContent().catch(() => '')) ?? '').trim();
    const groupMap = async () =>
      pg.locator('[data-testid=motion-card]').evaluateAll((els) =>
        Object.fromEntries(els.filter((e) => e.querySelector('[data-testid=motion-group-id]')).map((e) => [e.querySelector('[data-testid=motion-group-id]').textContent.trim(), e.getAttribute('data-motion-id')])),
      );
    const gm = await groupMap();
    G1 = gm['E2E유사1'] ?? null;
    G2 = gm['E2E유사2'] ?? null;
    const afterImport = await pg.locator('[data-testid=motion-card]').count();
    const g1Title = G1 ? await pg.getByLabel(`${G1} 제목`, { exact: true }).inputValue() : '?';
    const g2Title = G2 ? await pg.getByLabel(`${G2} 제목`, { exact: true }).inputValue() : '?';
    const emptyCount = ((await pg.locator('[data-testid=empty-title-count]').textContent().catch(() => '')) ?? '').trim();
    const ref1 = G1 ? ((await pg.locator(`[data-testid=motion-card][data-motion-id="${G1}"] [data-testid=group-reference]`).textContent().catch(() => '')) ?? '') : '';
    const inY = (await pg.locator(`li[data-card-no="${GY.no}"]`).getAttribute('data-in-motion')) ?? '';
    record(
      'a3k-groups-import',
      !!G1 && !!G2 && afterImport === before + 2 && !gm['E2E유사9'] && g1Title === '' && g2Title === '' && /제목 빈 안 2/.test(emptyCount) &&
        n1.includes('1분과 묶음 2개 — 새 안 2건') && !n1.includes('2분과') && ref1.includes('E2E 가상 공통 취지 가') && ref1.includes(GROUPS.groups[0].recs[0]),
      `안 ${before}→${afterImport} · 묶음→안 ${JSON.stringify(gm)} · 2분과 묶음 건너뜀=${!gm['E2E유사9']} · 제목 빈칸=${g1Title === '' && g2Title === ''} · 「${emptyCount}」 · 알림 「${n1.slice(0, 70)}」`,
    );
    record(
      'a3l-group-shared-card',
      inY.includes(G1 ?? '?') && inY.includes(G2 ?? '?') && (await pg.locator(`li[data-card-no="${GY.no}"] [data-testid=card-in-motions]`).count()) === 1 && !(await box(GY.no).isDisabled()),
      `${GY.no} 들어간 안 「${inY}」 · 체크 가능=${!(await box(GY.no).isDisabled())}`,
    );
    await pg.locator(`[data-testid=motion-card][data-motion-id="${G1}"]`).screenshot({ path: join(SHOTS, 'a-group-motion.png') }).catch(() => undefined);
    // 같은 파일을 다시 가져와도 안이 겹치지 않는다
    await pg.locator('[data-testid=groups-import-input]').setInputFiles(groupsPath);
    await pg.waitForTimeout(800);
    const n2 = ((await notice(pg).textContent().catch(() => '')) ?? '').trim();
    const again = await pg.locator('[data-testid=motion-card]').count();
    record('a3m-groups-idempotent', again === afterImport && n2.includes('새 안 0건') && n2.includes('이미 있어 건너뜀 2건'), `다시 가져온 뒤 안 ${again} · 알림 「${n2.slice(0, 70)}」`);

    // ── 카드 없는 안건 ──
    await pg.getByRole('button', { name: `「${AGENDA_TITLE}」 넣기` }).click();
    const agendaBtn = ((await pg.locator('[data-testid=agenda-make]').textContent()) ?? '').trim();
    await pg.locator('[data-testid=agenda-make]').click();
    await pg.waitForTimeout(400);
    const agCard = pg.locator(`[data-testid=motion-card][data-motion-id="${AGENDA_ID}"]`);
    const agOk = (await agCard.count()) === 1 && (await pg.getByLabel(`${AGENDA_ID} 제목`, { exact: true }).inputValue()) === AGENDA_TITLE && /카드 없는 안건/.test((await agCard.textContent()) ?? '');
    record('a3n-agenda-motion', agOk && agendaBtn === `${AGENDA_ID} 안건 만들기`, `버튼 「${agendaBtn}」 · 안 ${AGENDA_ID} 생김=${agOk}`);

    // 묶음 버튼은 없다(늘 하나씩) · 카드 없는 안건은 맨 뒤 · 제목 빈 안은 [투표 시작]이 막힌다
    await tab(pg, '2. 투표 진행').click();
    const batchUi = (await pg.locator('[data-testid=division-batches]').count()) + (await pg.getByRole('button', { name: /개 안팎|전체 한 번/ }).count());
    const order = await pg.locator('[data-testid=vote-unit] [data-testid=motion-vote]').evaluateAll((els) => els.map((e) => e.getAttribute('data-motion-id')));
    record('a3j-no-batch-buttons', batchUi === 0 && order.length === D1_MOTIONS && order[order.length - 1] === AGENDA_ID, `묶음 영역·버튼 ${batchUi} · 투표 단위 ${order.length}(안 ${D1_MOTIONS} = 하나씩) · 순서 ${order.join(' ')}`);
    const emptyBlocked = [];
    for (const id of [G1, G2]) {
      const u = unitOf(pg, id);
      emptyBlocked.push({ id, disabled: await u.locator('[data-testid=vote-start]').isDisabled(), msg: (await u.locator('[data-testid=vote-empty-title]').count()) === 1 });
    }
    record('a3o-empty-title-cannot-start', emptyBlocked.every((x) => x.disabled && x.msg), JSON.stringify(emptyBlocked));
    await unitOf(pg, G1).screenshot({ path: join(SHOTS, 'a-empty-title-blocked.png') }).catch(() => undefined);

    record('a4-saved-chip', await waitSaved(A.page), (await chip(A.page).textContent()) ?? '');
    const row = await serverRow(TO, 1);
    const sg = row?.state?.motions?.filter((m) => m.group).map((m) => `${m.group.id}=${m.key}`) ?? [];
    record(
      'a5-server-row',
      row?.version > 0 && row?.state?.motions?.length === D1_MOTIONS && row?.state?.attendance?.present === 9 && sg.includes('E2E유사1=group:E2E유사1') && sg.includes('E2E유사2=group:E2E유사2'),
      `version ${row?.version} · 안 ${row?.state?.motions?.length} · 참석 ${row?.state?.attendance?.present} · 묶음 열쇠 ${sg.join(', ')}`,
    );
    await tab(pg, '1. 준비판').click();
    await shot(A, 'a-operator.png');

    // 새 브라우저(이 기기 저장소 없음)에서 같은 내용이 서버에서 온다
    const B = await openConsole('div1-b', '1');
    const ok = await waitUntil(async () => (await B.page.locator('[data-testid=motion-card]').count()) === D1_MOTIONS, 20000);
    await tab(B.page, '2. 투표 진행').click();
    const present = await B.page.getByLabel('참석', { exact: true }).inputValue();
    record('a6-fresh-context', ok && present === '9', `새 컨텍스트: 안 ${await B.page.locator('[data-testid=motion-card]').count()} · 참석 ${present}`);
    await shot(B, 'a-fresh-context.png');
    await B.ctx.close();

    // 운영팀 현황판에 10초 안에
    O = await openConsole('ops', 'o');
    const t0 = Date.now();
    const seen = await waitUntil(async () => new RegExp(`후보안\\s*${D1_MOTIONS}`).test((await O.page.locator('[data-testid=ops-column][data-division="1"]').textContent()) ?? ''), 15000);
    record('a7-ops-board', seen && Date.now() - t0 < 15000, `현황판 반영 ${Math.round((Date.now() - t0) / 1000)}초`);
    await shot(O, 'a-ops-board.png');
  });

  // ═══ (b) 같은 분과 PC-A·PC-B 두 브라우저 — 실제 저장 충돌 → 늦은 화면의 고침을 최신 위에 다시 적용 ═══
  await phase('b', async () => {
    await O.page.getByRole('button', { name: '1분과 화면 열기' }).click();
    const PB = await openConsole('div1-pcb', '1');
    await waitUntil(async () => (await PB.page.locator('[data-testid=motion-card]').count()) === D1_MOTIONS, 20000);
    await tab(PB.page, '1. 준비판').click();
    await tab(A.page, '1. 준비판').click();
    // PC-B 의 읽기를 막아 옛 판번호를 쥐고 있게 한다(폴링 때문에 결과가 우연에 맡겨지지 않게)
    await PB.page.route('**/rest/v1/rpc/division_prep_get_v1', (r) => r.abort());
    const TA = 'PC-A 가 먼저 쓴 문안';
    const TB = 'PC-B 가 나중에 쓴 문안';
    await A.page.getByLabel(`${P} 문안`).fill(TA);
    const aSaved = await waitSaved(A.page);
    const vA = (await serverRow(TO, 1))?.version;
    await PB.page.getByLabel(`${F} 문안`).fill(TB);
    const replay = await waitUntil(async () => /다른 화면이 먼저 저장했습니다.*다시 적용해 저장합니다/.test((await notice(PB.page).textContent().catch(() => '')) ?? ''), 15000);
    await shot(PB, 'b-conflict-replay-notice.png');
    const bSaved = await waitSaved(PB.page, 20000);
    await PB.page.unroute('**/rest/v1/rpc/division_prep_get_v1');
    const row = await serverRow(TO, 1);
    const sP = row?.state?.motions?.find((m) => m.id === P)?.text;
    const sF = row?.state?.motions?.find((m) => m.id === F)?.text;
    const pbP = await PB.page.getByLabel(`${P} 문안`).inputValue();
    // PC-A 도 폴링으로 PC-B 의 고침을 받는다
    const aSeesB = await waitUntil(async () => (await A.page.getByLabel(`${F} 문안`).inputValue()) === TB, 15000);
    record('b1-conflict-replay-notice', aSaved && replay, `PC-A 저장=${aSaved}(version ${vA}) · PC-B 에 「다시 적용」 안내=${replay}`);
    record(
      'b2-both-edits-survive',
      bSaved && sP === TA && sF === TB && pbP === TA && aSeesB && row?.version > vA,
      `서버 ${P}="${sP}" · ${F}="${sF}" · PC-B 화면 ${P}="${pbP}" · PC-A 가 PC-B 고침 받음=${aSeesB} · version ${vA}→${row?.version}`,
    );
    await PB.ctx.close();
  });

  // ═══ (c)+(g) 원클릭 시작 → 한 번에 한 안 → QR → 새로고침 QR 자동 → 투표(찬성 위·색) → 두 번 눌러 마감 → 거수 잠정 → 확정 ═══
  await phase('c', async () => {
    await tab(A.page, '2. 투표 진행').click();
    const uP = unitOf(A.page, P);
    const TP = 'E2E 가결 예정 안';
    // 한 번만 누르면 무장만 된다(투표는 아직 없다) → 5초 뒤 원래대로 → 두 번 눌러 시작.
    const startBtn = uP.locator('[data-testid=vote-start]');
    await startBtn.click();
    const armedTxt = (await startBtn.textContent())?.trim();
    await A.page.waitForTimeout(1500);
    const noBallotYet = !Object.values((await serverRow(TO, 1))?.state?.ballots ?? {}).some((b) => b.motionIds.includes(P));
    const startReverted = await waitUntil(async () => (await startBtn.getAttribute('data-armed')) === 'false', 8000);
    record(
      'c0-start-two-step-armed-format',
      armedTxt === armed('start', P, TP) && noBallotYet && startReverted,
      `무장 문구 「${armedTxt}」 기대 「${armed('start', P, TP)}」 · 한 번 누름에 투표 없음=${noBallotYet} · 5초 뒤 원래대로=${startReverted}`,
    );
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
    const qrText = await (await A.page.locator('[data-ballot-url]').first().getAttribute('data-ballot-url').catch(() => '')) ?? '';
    record('c2-qr-token', !!bP?.token && qrText.includes(`t=${bP.token}`), 'QR 주소가 서버에 적힌 투표 토큰과 같다');
    await A.page.keyboard.press('Escape');

    // 한 번에 한 안 — P 가 열려 있으면 다른 안의 [투표 시작]은 막히고 이유가 나온다. 화면 위 「지금 투표 중」 띠.
    const fStart = unitOf(A.page, F).locator('[data-testid=vote-start]');
    const fDisabled = await fStart.isDisabled();
    const blockedTxt = ((await unitOf(A.page, F).locator('[data-testid=vote-blocked]').textContent().catch(() => '')) ?? '').trim();
    const bandTxt = ((await A.page.locator('[data-testid=live-vote-band]').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
    record(
      'c1b-one-at-a-time',
      fDisabled && blockedTxt.includes(P) && /먼저 마감하십시오/.test(blockedTxt) && bandTxt.includes('지금 투표 중') && bandTxt.includes(P),
      `${F} [투표 시작] 막힘=${fDisabled} · 「${blockedTxt.slice(0, 50)}」 · 띠 「${bandTxt.slice(0, 50)}」`,
    );
    await unitOf(A.page, F).screenshot({ path: join(SHOTS, 'c-one-at-a-time.png') }).catch(() => undefined);

    // (g) 투표 중 새로고침 — 누르지 않아도 「투표 진행」과 그 QR 이 바로 뜬다.
    await A.page.reload({ waitUntil: 'domcontentloaded' });
    await A.page.locator('#mod-tab-decision').waitFor({ timeout: 40000 });
    if (!(await A.page.locator('[data-testid=division-vote-panel]').count())) await A.page.locator('#mod-tab-decision').click();
    await A.page.locator('[data-testid=division-vote-panel]').waitFor();
    const autoQr = await A.page.locator('[data-testid=qr-fullscreen-decision]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    const qrAgain = autoQr ? ((await A.page.locator('[data-testid=qr-fullscreen-decision]').first().getAttribute('data-ballot-url').catch(() => '')) ?? '') : '';
    const noElsewhere = (await A.page.locator('[data-testid=band-elsewhere]').count()) === 0;
    record(
      'g1-reload-auto-qr',
      autoQr && qrAgain.includes(`t=${bP?.token}`) && noElsewhere,
      `새로고침 후 누르지 않고 QR 자동=${autoQr} · 같은 토큰=${qrAgain.includes(`t=${bP?.token}`)} · 「다른 화면에서 연 투표」 안내 없음=${noElsewhere}`,
    );
    await shot(A, 'g-reload-auto-qr.png');
    await A.page.keyboard.press('Escape');
    await A.page.locator('[data-testid=qr-fullscreen-decision]').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);

    // 투표 7명 — 찬성 5, 반대 2. 첫 사람 화면: 머리말·안내문·찬성 위·고르면 초록·확인 창 「선택: 찬성」
    for (let v = 0; v < 7; v++) voters.push(await newCtx(`voter${v}`, { width: 390, height: 844 }));
    for (let v = 0; v < 7; v++) {
      if (v > 0) {
        await voteUi(voters[v], bP.token, v < 5 ? 2 : 1);
        continue;
      }
      let order = [];
      let tones = [];
      await voteUi(
        voters[v],
        bP.token,
        2,
        async (vp) => {
          const body = (await vp.locator('body').innerText()).replace(/\s+/g, ' ');
          const eyebrow = body.includes('분과 의결 투표');
          const noticeOk = body.includes(DECISION_NOTICE);
          const oldWording = /의견조사|기기당|같은 브라우저 기준/.test(body);
          const motionTitle = ((await vp.locator('[data-testid=ballot-motion] h2').first().textContent()) ?? '').trim();
          record('c2b-voter-copy', eyebrow && noticeOk && !oldWording && motionTitle === TP, `머리말 「분과 의결 투표」=${eyebrow} · 안내문 일치=${noticeOk} · 옛 문구 없음=${!oldWording} · 안 제목 「${motionTitle}」`);
          const btns = vp.locator('[role=group][aria-label$="응답"] button');
          order = await btns.evaluateAll((els) => els.map((e) => `${e.getAttribute('data-choice')}:${e.textContent.trim()}`));
          tones = await btns.evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')));
          // 반대를 먼저 눌러 빨강을 확인하고, 찬성으로 바꾼다
          await btns.nth(1).click();
          await vp.waitForTimeout(600); // transition 이 끝난 색
          const noColor = await cssOf(btns.nth(1), 'borderTopColor');
          voters[0].noColor = noColor;
        },
        async (vp) => {
          const yesBtn = vp.locator('[role=group][aria-label$="응답"] button[data-choice="2"]');
          await vp.waitForTimeout(600);
          voters[0].yesColor = await cssOf(yesBtn, 'borderTopColor');
          voters[0].yesPressed = await yesBtn.getAttribute('aria-pressed');
          await vp.screenshot({ path: join(SHOTS, 'c-voter-yes-green.png') }).catch(() => undefined);
        },
        async (vp) => {
          const c = vp.locator('[data-testid=confirm-choice]');
          voters[0].confirm = ((await c.textContent().catch(() => '')) ?? '').trim();
          voters[0].confirmTone = await c.getAttribute('data-tone').catch(() => null);
          await vp.screenshot({ path: join(SHOTS, 'c-voter-confirm.png') }).catch(() => undefined);
        },
      );
      const x = voters[0];
      record(
        'c2c-voter-yes-first-colors',
        order[0]?.startsWith('2:') && order[0].includes('찬성') && order[1]?.startsWith('1:') && order[1].includes('반대') && tones.join() === 'yes,no' &&
          x.yesColor === GREEN && x.noColor === RED && x.yesPressed === 'true' && x.confirm === '선택: 찬성' && x.confirmTone === 'yes',
        `순서 ${order.join(' / ')} · 색 찬성 ${x.yesColor} 반대 ${x.noColor} · 확인 창 「${x.confirm}」(${x.confirmTone})`,
      );
    }
    saveManifest();
    await shot(voters[0], 'c-voter.png');

    // 운영팀이 읽기를 막은 채 기타 의견을 고치는 사이 마감 — 투표 사실이 사라지면 안 되고, 운영팀 고침도 다시 적용된다
    await tab(O.page, '2. 투표 진행').click();
    await O.page.route('**/rest/v1/rpc/division_prep_get_v1', (r) => r.abort());
    const MEMO = '운영팀 메모(충돌 뒤 다시 적용)';
    await O.page.getByLabel(`${P} 기타 의견`).fill(MEMO);

    // 한 번만 누르면 5초 뒤 원래대로(마감 안 됨)
    const close = unitOf(A.page, P).locator('[data-testid=vote-close]');
    await close.click();
    const armedClose = (await close.textContent())?.trim();
    await A.page.waitForTimeout(5600);
    const reverted = (await close.getAttribute('data-armed')) === 'false' && (await unitOf(A.page, P).getAttribute('data-phase')) === 'open';
    record('c3-close-two-step-armed-format', armedClose === armed('close', P, TP) && reverted, `무장 문구 「${armedClose}」 · 5초 뒤 원래대로=${reverted}`);
    await twoStep(close);
    const bar = unitOf(A.page, P).locator('[data-testid=result-bar]');
    await bar.waitFor({ timeout: 30000 });
    const yes = (await bar.locator('[data-testid=result-yes]').textContent())?.trim();
    const no = (await bar.locator('[data-testid=result-no]').textContent())?.trim();
    const v1 = await bar.getAttribute('data-verdict');
    record('c4-result-numbers', yes === '5' && no === '2', `찬성 ${yes} · 반대 ${no}`);
    const prov1 = await bar.getAttribute('data-provisional');
    const vt1 = await verdictText(unitOf(A.page, P));
    const noRevoteYet = (await unitOf(A.page, P).locator('[data-testid=revote]').count()) === 0 && (await unitOf(A.page, P).locator('[data-testid=hand-first]').count()) === 1;
    record('c5-below-line-provisional-fail', v1 === 'failed' && prov1 === 'true' && vt1 === '잠정 부결' && noRevoteYet, `온라인만 찬성 5 < 가결선 6 → ${v1} · 「${vt1}」 · 잠정=${prov1} · 2차·소수 의견 버튼 아직 없음=${noRevoteYet}`);
    await unitOf(A.page, P).getByLabel('거수 찬성').fill('1');
    const flipped = await waitUntil(async () => (await bar.getAttribute('data-verdict')) === 'passed', 5000);
    const vt2 = await verdictText(unitOf(A.page, P));
    const stillProv = (await bar.getAttribute('data-provisional')) === 'true';
    await bar.screenshot({ path: join(SHOTS, 'c-result-provisional-pass.png') }).catch(() => undefined);
    await unitOf(A.page, P).locator('[data-testid=hand-confirm]').click();
    const confirmed = await waitUntil(async () => (await bar.getAttribute('data-provisional')) === 'false', 5000);
    const vt3 = await verdictText(unitOf(A.page, P));
    const yesColor = await cssOf(bar.locator('[data-testid=result-yes]'), 'color');
    const stampColor = await cssOf(bar.locator('[data-testid=result-verdict]'), 'borderTopColor');
    record(
      'c6-hand-provisional-then-confirm',
      flipped && (await bar.locator('[data-testid=result-yes]').textContent())?.trim() === '6' && vt2 === '잠정 가결' && stillProv && confirmed && vt3 === '가결' &&
        (await unitOf(A.page, P).locator('[data-testid=result-provisional]').count()) === 0,
      `거수 찬성 1 → 6 「${vt2}」(잠정=${stillProv}) → [거수 입력 완료] → 「${vt3}」 확정=${confirmed}`,
    );
    record('c6b-pass-colors', yesColor === BAR_GREEN && stampColor === BAR_GREEN, `찬성 숫자 ${yesColor} · 가결 도장 테두리 ${stampColor} (기대 ${BAR_GREEN})`);
    await bar.screenshot({ path: join(SHOTS, 'c-result-pass.png') }).catch(() => undefined);
    await waitSaved(A.page, 20000);
    await O.page.unroute('**/rest/v1/rpc/division_prep_get_v1');
    const memoSaved = await waitUntil(async () => (await serverRow(TO, 1))?.state?.motions?.find((m) => m.id === P)?.otherOpinion === MEMO, 20000);
    state = (await serverRow(TO, 1))?.state;
    const r1 = lastRound(state, P);
    const b1 = ballotOf(state, r1);
    record(
      'c7-facts-survive-conflict',
      b1?.stage === 'closed' && r1?.onlineYes === 5 && r1?.onlineNo === 2 && r1?.handYes === 1 && r1?.verdict === 'passed' && r1?.handConfirmed === true && memoSaved,
      `서버: stage ${b1?.stage} · 온라인 ${r1?.onlineYes}/${r1?.onlineNo} · 거수 ${r1?.handYes} · ${r1?.verdict} · 거수 확정 ${r1?.handConfirmed} · 운영팀 메모 다시 적용=${memoSaved}`,
    );
    const oSeesPass = await waitUntil(async () => (await unitOf(O.page, P).getAttribute('data-phase')) === 'passed', 15000);
    record('c8-ops-sees-pass', oSeesPass, '운영팀 화면에도 가결');

    // F — 찬성 2 · 반대 5, 거수 찬성 1 → 3 (부결). 거수 확정 전에는 2차·소수 의견 버튼이 없다.
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
    const pendingButtons = (await uF.locator('[data-testid=revote]').count()) + (await uF.locator('[data-testid=minority]').count());
    const handFirst = (await uF.locator('[data-testid=hand-first]').count()) === 1;
    await uF.locator('[data-testid=hand-confirm]').click();
    const revoteShown = await uF.locator('[data-testid=revote]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    const vtF = await verdictText(uF);
    const failStamp = await cssOf(barF.locator('[data-testid=result-verdict]'), 'borderTopColor');
    record(
      'c9-fail-case',
      vF === 'failed' && yF === '3' && pendingButtons === 0 && handFirst && revoteShown && vtF === '부결' && failStamp === BAR_GREY,
      `찬성 ${yF} < 6 → ${vF} · 확정 전 2차·소수 버튼 ${pendingButtons}(안내 ${handFirst}) → 확정 뒤 [문구 고쳐 2차 투표]=${revoteShown} · 「${vtF}」 도장 ${failStamp}(회색 기대)`,
    );
    await barF.screenshot({ path: join(SHOTS, 'c-result-fail.png') }).catch(() => undefined);
    await waitSaved(A.page, 20000);
  });

  // ═══ (d) 2차 투표 — 1차 결과 거수 칸 잠김 · [거수 없음] · 소수 의견 ═══
  await phase('d', async () => {
    const uF = unitOf(A.page, F);
    await uF.locator('[data-testid=revote]').click();
    // 2차 준비 중 — 1차 결과 막대의 거수 칸은 잠긴다
    const bar1 = uF.locator('[data-testid=result-bar][data-round="1"]');
    const lockedPrep = (await bar1.locator('[data-testid=hand-locked]').count()) === 1 && (await bar1.getByLabel('거수 찬성').count()) === 0;
    const heading1 = ((await bar1.locator('[data-testid=result-heading]').textContent().catch(() => '')) ?? '').trim();
    await A.page.getByLabel(`${F} 2차 투표 제목`).fill('E2E 부결 예정 안(문구 수정)');
    await twoStep(unitOf(A.page, F).locator('[data-testid=vote-start]'));
    await A.page.getByRole('button', { name: 'QR 화면 나가기' }).waitFor({ timeout: 20000 });
    await A.page.keyboard.press('Escape');
    // 2차 투표 중 — 1차 칸은 여전히 잠기고 「2차 투표 중 — 거수는 마감 뒤…」 안내
    const lockedOpen = (await uF.locator('[data-testid=result-bar][data-round="1"] [data-testid=hand-locked]').count()) === 1 && (await uF.getByLabel('거수 찬성').count()) === 0;
    const waitTxt = ((await uF.locator('[data-testid=hand-wait]').textContent().catch(() => '')) ?? '').trim();
    record(
      'd0-round1-hand-locked',
      lockedPrep && lockedOpen && /^2차 투표 중/.test(waitTxt) && heading1 === '1차 투표 결과',
      `2차 준비 중 잠김=${lockedPrep}(「${heading1}」) · 2차 투표 중 잠김=${lockedOpen} · 안내 「${waitTxt.slice(0, 40)}」`,
    );
    await uF.screenshot({ path: join(SHOTS, 'd-round1-locked.png') }).catch(() => undefined);
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
    record('d2-round1-kept', hist === 1, `1차 결과 줄 ${hist}`);
    const bar2 = uF.locator('[data-testid=result-bar][data-round="2"]');
    const prov2 = await bar2.getAttribute('data-provisional');
    await uF.locator('[data-testid=hand-none]').click();
    const conf2 = await waitUntil(async () => (await bar2.getAttribute('data-provisional')) === 'false', 5000);
    record('d2b-hand-none-confirms', prov2 === 'true' && conf2, `2차 결과 잠정=${prov2} → [거수 없음] → 확정=${conf2}`);
    await unitOf(A.page, F).screenshot({ path: join(SHOTS, 'd-round-history.png') }).catch(() => undefined);
    await A.page.getByLabel(`${F} 소수 의견`).fill('E2E 소수 의견');
    await twoStep(unitOf(A.page, F).locator('[data-testid=minority]'));
    const minority = await waitUntil(async () => (await A.page.locator(`[data-testid=motion-vote][data-motion-id="${F}"]`).getAttribute('data-phase')) === 'minority', 5000);
    await waitSaved(A.page, 20000);
    state = (await serverRow(TO, 1))?.state;
    const m = state?.motions?.find((x) => x.id === F);
    record('d3-minority', minority && m?.resolution === 'minority' && m?.minorityOpinion === 'E2E 소수 의견' && lastRound(state, F)?.handConfirmed === true, `resolution ${m?.resolution} · 2차 거수 확정 ${lastRound(state, F)?.handConfirmed}`);
    await shot(A, 'd-minority.png');
  });

  // ═══ (v) [잘못 연 투표 무효] — 묶음 안 G1 에 제목을 넣고 열었다가 무효 ═══
  await phase('v', async () => {
    if (!G1) throw new Error('G1 안이 없습니다(a 단계 실패).');
    const pg = A.page;
    await tab(pg, '1. 준비판').click();
    await pg.getByLabel(`${G1} 제목`, { exact: true }).fill(VOID_TITLE);
    await waitSaved(pg, 20000);
    await tab(pg, '2. 투표 진행').click();
    const u = unitOf(pg, G1);
    const startable = await u.locator('[data-testid=vote-start]').isEnabled();
    record('v0-title-unblocks-start', startable && (await u.locator('[data-testid=vote-empty-title]').count()) === 0, `제목 넣은 뒤 ${G1} [투표 시작] 눌림=${startable}`);
    await twoStep(u.locator('[data-testid=vote-start]'));
    await pg.getByRole('button', { name: 'QR 화면 나가기' }).waitFor({ timeout: 20000 });
    await pg.keyboard.press('Escape');
    let state = (await serverRow(TO, 1))?.state;
    const bV = ballotOf(state, lastRound(state, G1));
    if (bV?.ballotId) manifest.ballots.push(bV.ballotId);
    saveManifest();
    await voteUi(voters[0], bV.token, 2);
    // 무효 — 한 번 누르면 무장, 다시 누르면 무효
    const vb = u.locator('[data-testid=vote-void]');
    await vb.click();
    const armedVoid = ((await vb.textContent()) ?? '').trim();
    await vb.click();
    const back = await waitUntil(async () => (await u.getAttribute('data-phase')) === 'ready', 20000);
    const voidLine = ((await u.locator('[data-testid=round-voided]').textContent().catch(() => '')) ?? '').trim();
    await waitSaved(pg, 20000);
    state = (await serverRow(TO, 1))?.state;
    const mV = state?.motions?.find((x) => x.id === G1);
    const rV = mV?.rounds?.[0];
    const recV = rV ? state.ballots[rV.requestId] : null;
    const list = await rpc('ballot_list_v2', { p_token: TO });
    const srv = (list.data ?? []).find((x) => x.id === bV?.ballotId);
    record(
      'v1-void-wrongly-opened',
      armedVoid === armed('void', G1, VOID_TITLE) && back && voidLine.includes('무효(잘못 열림)') && mV?.rounds?.length === 1 && !!rV?.voidedAt && recV?.stage === 'closed' && srv?.status === 'closed',
      `무장 「${armedVoid}」 · 투표 전으로 돌아감=${back} · 「${voidLine}」 · 서버 차수 ${mV?.rounds?.length}·voidedAt ${!!rV?.voidedAt} · 기록 ${recV?.stage} · 서버 투표 ${srv?.status}`,
    );
    // 차수를 쓰지 않는다 — 다시 열면 1차(「2차」가 붙지 않는다). 무장만 하고 5초 기다려 그대로 둔다.
    const sb = u.locator('[data-testid=vote-start]');
    const label = ((await sb.textContent()) ?? '').trim();
    await sb.click();
    const reArmed = ((await sb.textContent()) ?? '').trim();
    await pg.waitForTimeout(5600);
    record('v2-round-not-consumed', label === '투표 시작' && reArmed === armed('start', G1, VOID_TITLE) && !/2차/.test(reArmed), `버튼 「${label}」 · 다시 무장 「${reArmed}」`);
    await u.screenshot({ path: join(SHOTS, 'v-voided.png') }).catch(() => undefined);
    // 결과가 나온 뒤 무효는 운영팀 화면에서만 — 분과 PC 의 P(가결)에는 버튼이 없고, 운영팀 화면에는 있다(누르지 않는다).
    const opsSees = await waitUntil(async () => (await unitOf(O.page, P).locator('[data-testid=vote-void]').count()) === 1, 15000);
    const opPc = await unitOf(pg, P).locator('[data-testid=vote-void]').count();
    record('v3-void-after-result-ops-only', opPc === 0 && opsSees, `분과 PC ${P} 무효 버튼 ${opPc} · 운영팀 화면 ${P} 무효 버튼 있음=${opsSees}`);
  });

  // ═══ (l) 카드 없는 안건 투표 · 마감 뒤 제출 안내 · 거수만으로 가결 ═══
  await phase('l', async () => {
    const pg = A.page;
    await tab(pg, '2. 투표 진행').click();
    const u = unitOf(pg, AGENDA_ID);
    await twoStep(u.locator('[data-testid=vote-start]'));
    await pg.getByRole('button', { name: 'QR 화면 나가기' }).waitFor({ timeout: 20000 });
    await pg.keyboard.press('Escape');
    let state = (await serverRow(TO, 1))?.state;
    const bA = ballotOf(state, lastRound(state, AGENDA_ID));
    if (bA?.ballotId) manifest.ballots.push(bA.ballotId);
    saveManifest();
    // 늦은 사람 — 휴대폰에서 찬성을 고르고 확인 창까지 열어 둔 사이 마감
    const late = voters[1];
    let shownTitle = '';
    let shownId = '';
    await prepareVote(late, bA.token, 2, async (vp) => {
      shownTitle = ((await vp.locator('[data-testid=ballot-motion] h2').first().textContent()) ?? '').trim();
      shownId = ((await vp.locator('[data-testid=ballot-motion]').first().textContent()) ?? '').replace(/\s+/g, ' ');
    });
    record('l1-agenda-on-phone', bA?.stage === 'open' && /^1분과 의결 1-최종-안1/.test(bA?.title ?? '') && shownTitle === AGENDA_TITLE && shownId.includes(AGENDA_ID), `투표 「${bA?.title}」 · 휴대폰 안 제목 「${shownTitle}」 · 안 번호 보임=${shownId.includes(AGENDA_ID)}`);
    await twoStep(u.locator('[data-testid=vote-close]'));
    await u.locator('[data-testid=result-bar]').waitFor({ timeout: 30000 });
    await late.page.getByRole('dialog').getByRole('button', { name: '제출하기' }).click();
    const lateShown = await late.page.locator('[data-testid=closed-late]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    const lateTxt = ((await late.page.locator('[data-testid=closed-late]').textContent().catch(() => '')) ?? '').trim();
    const closedTitle = ((await late.page.locator('[data-testid=closed-ballot-title]').textContent().catch(() => '')) ?? '').trim();
    await late.page.screenshot({ path: join(SHOTS, 'l-late-submit.png'), fullPage: true }).catch(() => undefined);
    const responses = (await rpc('ballot_results_v2', { p_ballot_token: bA.token, p_token: TO })).data?.responses ?? null;
    record(
      'l2-late-submit-notice',
      lateShown && /반영되지 않았습니다/.test(lateTxt) && closedTitle.includes('1분과 의결 1-최종-안1') && responses === 0,
      `마감 뒤 제출 → 「${lateTxt}」 · 「${closedTitle}」 · 서버 제출 ${responses}`,
    );
    // 온라인 0 · 거수 찬성 6 → 가결(가결선 6) → 확정
    await u.getByLabel('거수 찬성').fill('6');
    await u.locator('[data-testid=hand-confirm]').click();
    await waitSaved(pg, 20000);
    state = (await serverRow(TO, 1))?.state;
    const rA = lastRound(state, AGENDA_ID);
    record('l3-agenda-hand-only-pass', rA?.onlineYes === 0 && rA?.handYes === 6 && rA?.verdict === 'passed' && rA?.handConfirmed === true, `온라인 ${rA?.onlineYes} · 거수 ${rA?.handYes} · ${rA?.verdict} · 확정 ${rA?.handConfirmed}`);
  });

  // ═══ (h) 운영팀 코드로 1분과 안(M, 주제 섞인 긴 제목)을 실제로 열고 닫는다 · 준비판 저장 ═══
  await phase('h', async () => {
    if (!M) throw new Error('M 안이 없습니다(a 단계 실패).');
    const op = O.page;
    await op.setViewportSize({ width: 1920, height: 1080 });
    await op.reload({ waitUntil: 'domcontentloaded' });
    await op.locator('#mod-tab-decision').waitFor({ timeout: 40000 });
    if (!(await op.locator('[data-testid=division-vote-panel]').count())) await op.locator('#mod-tab-decision').click();
    await op.locator('[data-testid=ops-board]').waitFor({ timeout: 20000 });
    await op.getByRole('button', { name: '1분과 화면 열기' }).click();
    const uM = unitOf(op, M);
    await uM.waitFor({ timeout: 20000 });
    await twoStep(uM.locator('[data-testid=vote-start]'));
    const qrOk = await op.locator('[data-testid=qr-fullscreen-decision]').waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    let state = (await serverRow(TO, 1))?.state;
    const bM = ballotOf(state, lastRound(state, M));
    if (bM?.ballotId) manifest.ballots.push(bM.ballotId);
    saveManifest();
    record('h1-ops-open-div1', qrOk && bM?.stage === 'open' && /^1분과 의결/.test(bM?.title ?? ''), `운영팀 [투표 시작] → QR ${qrOk} · stage ${bM?.stage} · 「${bM?.title}」`);
    // QR 화면 2단 — 왼쪽 안 제목 전체, 오른쪽 QR
    await op.waitForTimeout(1200);
    const head = ((await op.locator('[data-testid=qr-headline]').textContent()) ?? '').trim();
    const sub = ((await op.locator('[data-testid=qr-headline-sub]').textContent()) ?? '').trim();
    const colFit = await fitOf(op.locator('[data-testid=qr-headline]').locator('xpath=..'));
    const qrImg = await op.locator('[data-testid=qr-fullscreen-decision] img').first().boundingBox().catch(() => null);
    const urlOk = ((await op.locator('[data-testid=qr-fullscreen-decision]').first().getAttribute('data-ballot-url')) ?? '').includes(`t=${bM?.token}`);
    record(
      'h2-qr-two-column-full-title',
      head === M_TITLE && sub.includes(M) && fitsBox(colFit) && (qrImg?.width ?? 0) >= 420 && urlOk,
      `제목 전체 일치=${head === M_TITLE}(${[...head].length}자) · 부제 「${sub}」 · 왼쪽 단 넘침 없음=${fitsBox(colFit)}(${colFit.sh}/${colFit.ch}) · QR ${Math.round(qrImg?.width ?? 0)}px · 주소 토큰 일치=${urlOk}`,
    );
    await shot(O, 'h-qr-1920-long-title.png');
    await op.keyboard.press('Escape');
    // 분과 오퍼레이터 화면에도 투표 중으로 보인다
    await tab(A.page, '2. 투표 진행').click().catch(() => undefined);
    const aOpen = await waitUntil(async () => (await unitOf(A.page, M).getAttribute('data-phase')) === 'open', 20000);
    // 운영팀이 대신 열면 분과 PC 화면 위 띠에 「다른 화면에서 연 투표입니다 … [QR 띄우기]」. 운영팀 화면에는 그 안내가 없다.
    const elsewhere = await A.page.locator('[data-testid=band-elsewhere]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    const elsewhereTxt = ((await A.page.locator('[data-testid=band-elsewhere]').textContent().catch(() => '')) ?? '').trim();
    const bandQr = (await A.page.locator('[data-testid=band-qr]').count()) === 1;
    const opsNoHint = (await op.locator('[data-testid=band-elsewhere]').count()) === 0;
    await shot(A, 'h-division-pc-alert.png');
    record(
      'h3-operator-alerted-ops-open',
      aOpen && elsewhere && /다른 화면에서 연 투표입니다/.test(elsewhereTxt) && /QR 띄우기/.test(elsewhereTxt) && bandQr && opsNoHint,
      `1분과 PC: M 투표 중=${aOpen} · 알림 「${elsewhereTxt.slice(0, 45)}」 · [QR 띄우기] ${bandQr} · 운영팀 화면엔 안내 없음=${opsNoHint}`,
    );
    // 분과 PC 가 [QR 띄우기]를 누르면 같은 투표 QR 이 뜨고 안내는 사라진다
    await A.page.locator('[data-testid=band-qr]').click();
    const aQr = ((await A.page.locator('[data-testid=qr-fullscreen-decision]').first().getAttribute('data-ballot-url', { timeout: 10000 }).catch(() => '')) ?? '').includes(`t=${bM?.token}`);
    await A.page.keyboard.press('Escape');
    const hintGone = await waitUntil(async () => (await A.page.locator('[data-testid=band-elsewhere]').count()) === 0, 5000);
    record('h3b-operator-band-qr', aQr && hintGone, `분과 PC QR 같은 토큰=${aQr} · 안내 사라짐=${hintGone}`);
    // 투표자 3명 — 휴대폰 화면에 긴 안 제목이 잘리지 않고 다 나온다
    for (let v = 0; v < 3; v++)
      await voteUi(voters[v], bM.token, 2, v > 0 ? undefined : async (vp) => {
        const h2 = vp.locator('[data-testid=ballot-motion] h2').first();
        const t = ((await h2.textContent()) ?? '').trim();
        const f = await h2.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, clamp: getComputedStyle(el).webkitLineClamp, ov: getComputedStyle(el).overflow }));
        const noticeOk = (await vp.locator('body').innerText()).replace(/\s+/g, ' ').includes(DECISION_NOTICE);
        record('h4-voter-long-title', t === M_TITLE && f.sh <= f.ch + 1 && f.sw <= f.cw + 1 && (f.clamp === 'none' || !f.clamp) && noticeOk, `휴대폰 안 제목 전체=${t === M_TITLE} · 넘침 없음=${f.sh <= f.ch + 1 && f.sw <= f.cw + 1} · line-clamp ${f.clamp} · 안내문=${noticeOk}`);
        await vp.screenshot({ path: join(SHOTS, 'h-voter-long-title.png'), fullPage: true }).catch(() => undefined);
      });
    saveManifest();
    // 운영팀이 마감(두 번 누름) → 거수 찬성 3 → 6 = 가결
    await twoStep(uM.locator('[data-testid=vote-close]'));
    const barM = uM.locator('[data-testid=result-bar]');
    await barM.waitFor({ timeout: 30000 });
    const yOnline = (await barM.locator('[data-testid=result-yes]').textContent())?.trim();
    await uM.getByLabel('거수 찬성').fill('3');
    const flipped = await waitUntil(async () => (await barM.getAttribute('data-verdict')) === 'passed', 5000);
    await uM.locator('[data-testid=hand-confirm]').click();
    await waitSaved(op, 20000);
    await barM.screenshot({ path: join(SHOTS, 'h-ops-result.png') }).catch(() => undefined);
    state = (await serverRow(TO, 1))?.state;
    const rM = lastRound(state, M);
    const bM2 = ballotOf(state, rM);
    record(
      'h5-ops-close-div1',
      yOnline === '3' && flipped && bM2?.stage === 'closed' && rM?.onlineYes === 3 && rM?.handYes === 3 && rM?.verdict === 'passed' && rM?.handConfirmed === true,
      `운영팀 마감 → 온라인 찬성 ${yOnline} · 거수 3 더해 가결=${flipped} · 서버 stage ${bM2?.stage} · ${rM?.onlineYes}+${rM?.handYes} · ${rM?.verdict} · 확정 ${rM?.handConfirmed}`,
    );
    const aPassed = await waitUntil(async () => (await unitOf(A.page, M).getAttribute('data-phase')) === 'passed', 20000);
    record('h6-operator-sees-ops-close', aPassed, `1분과 오퍼레이터 화면 M 가결=${aPassed}`);
    // 운영팀 준비판 저장(충돌 없이)
    await tab(op, '1. 준비판').click();
    await op.getByLabel(`${M} 문안`).fill('E2E 운영팀이 저장한 문안');
    const saved = await waitSaved(op, 20000);
    const conflictTxt = ((await notice(op).textContent().catch(() => '')) ?? '');
    const row = await serverRow(TO, 1);
    const sText = row?.state?.motions?.find((m) => m.id === M)?.text;
    record(
      'h7-ops-prep-save',
      saved && !/먼저 고쳤습니다|먼저 저장했습니다/.test(conflictTxt) && sText === 'E2E 운영팀이 저장한 문안' && row?.updated_by === '운영팀',
      `칩 저장됨=${saved} · 서버 문안 일치=${sText === 'E2E 운영팀이 저장한 문안'} · 저장자 「${row?.updated_by}」 · version ${row?.version}`,
    );
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
    record('f1-board-div1', new RegExp(`후보안${D1_MOTIONS}`).test(c1) && /가결3/.test(c1) && /부결0/.test(c1) && /소수의견1/.test(c1) && /투표전2/.test(c1) && /재적12·참석9/.test(c1), c1.slice(0, 120));
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
    const mRow = body.find((r) => r[col_('안번호')] === M);
    const gRows = body.filter((r) => r[col_('안번호')] === G1);
    const g2Row = body.find((r) => r[col_('안번호')] === G2);
    const aRow = body.find((r) => r[col_('안번호')] === AGENDA_ID);
    record('f4-csv-name-bom', /^1017_의결결과_전체_\d{8}_\d{4}\.csv$/.test(dl.suggestedFilename()) && raw.charCodeAt(0) === 0xfeff, dl.suggestedFilename());
    record('f5-csv-header', header.length === 25 && header[0] === '분과' && header[23] === '마감시각' && header[24] === '수정문안', `열 ${header.length}`);
    record(
      'f6-csv-rows',
      body.length === 8 &&
        gRows.map((r) => r[col_('판정')]).join(',') === '무효(잘못 열림),미투표' && g2Row?.[col_('판정')] === '미투표' && aRow?.[col_('판정')] === '가결' && aRow?.[col_('거수찬성')] === '6' && aRow?.[col_('원카드번호')] === '' &&
        pRow?.[col_('판정')] === '가결' && pRow?.[col_('찬성합계')] === '6' && pRow?.[col_('반대합계')] === '2' && pRow?.[col_('가결선')] === '6' &&
        fRows.length === 2 && fRows[0][col_('판정')] === '부결' && fRows[1][col_('판정')] === '부결(소수의견)' && fRows[1][col_('차수')] === '2차' &&
        mRow?.[col_('판정')] === '가결' && mRow?.[col_('찬성합계')] === '6' && mRow?.includes(M_TITLE),
      `줄 ${body.length} · P ${pRow?.[col_('판정')]}/${pRow?.[col_('찬성합계')]} · F ${fRows.map((r) => `${r[col_('차수')]}:${r[col_('판정')]}`).join(',')} · ${G1} ${gRows.map((r) => r[col_('판정')]).join('+')} · ${G2} ${g2Row?.[col_('판정')]} · ${AGENDA_ID} ${aRow?.[col_('판정')]} · M ${mRow?.[col_('판정')]}/${mRow?.[col_('찬성합계')]} 긴 제목 그대로=${!!mRow?.includes(M_TITLE)}`,
    );
  });

  // ═══ (i) 운영팀이 오퍼레이터 없는 3분과를 직접 준비·저장하고 투표를 열고 닫는다 ═══
  await phase('i', async () => {
    const op = O.page;
    const div3 = recs.find((d) => d.division === 3);
    const card3 = div3?.topics.flatMap((t) => t.cards).find((c) => (c.title ?? '').trim());
    if (!card3) throw new Error('3분과 카드가 없습니다.');
    await op.getByRole('button', { name: '3분과 화면 열기' }).click();
    await op.getByLabel('재적', { exact: true }).fill('10');
    await op.getByLabel('참석', { exact: true }).fill('8');
    await tab(op, '1. 준비판').click();
    await op.locator(`li[data-card-no="${card3.no}"] input[type=checkbox]`).check();
    const auto = await op.getByLabel('안 제목', { exact: true }).inputValue();
    await op.getByRole('button', { name: '의결안 만들기' }).click();
    const saved = await waitSaved(op, 20000);
    let row = await serverRow(TO, 3);
    const m3 = row?.state?.motions?.[0];
    record(
      'i1-ops-save-div3',
      saved && row?.version > 0 && row?.state?.motions?.length === 1 && row?.state?.attendance?.present === 8 && row?.updated_by === '운영팀' && m3?.title === auto && !!auto,
      `칩 저장됨=${saved} · 3분과 version ${row?.version} · 안 ${row?.state?.motions?.length} · 참석 ${row?.state?.attendance?.present} · 저장자 「${row?.updated_by}」 · 자동 제목 그대로=${m3?.title === auto}`,
    );
    await tab(op, '2. 투표 진행').click();
    const u3 = unitOf(op, m3.id);
    await twoStep(u3.locator('[data-testid=vote-start]'));
    await op.getByRole('button', { name: 'QR 화면 나가기' }).waitFor({ timeout: 20000 });
    await op.keyboard.press('Escape');
    row = await serverRow(TO, 3);
    const b3 = ballotOf(row?.state, lastRound(row?.state, m3.id));
    if (b3?.ballotId) manifest.ballots.push(b3.ballotId);
    saveManifest();
    await voteUi(voters[0], b3.token, 2);
    await twoStep(u3.locator('[data-testid=vote-close]'));
    const bar3 = u3.locator('[data-testid=result-bar]');
    await bar3.waitFor({ timeout: 30000 });
    await u3.locator('[data-testid=hand-none]').click();
    const conf3 = await waitUntil(async () => (await bar3.getAttribute('data-provisional')) === 'false', 5000);
    await waitSaved(op, 20000);
    row = await serverRow(TO, 3);
    const r3 = lastRound(row?.state, m3.id);
    const b3c = ballotOf(row?.state, r3);
    record(
      'i2-ops-open-close-div3',
      b3?.stage === 'open' && /^3분과 의결/.test(b3?.title ?? '') && b3c?.stage === 'closed' && r3?.onlineYes === 1 && r3?.verdict === 'failed' && conf3 && r3?.handConfirmed === true && r3?.handYes === 0,
      `열 때 stage ${b3?.stage} 「${b3?.title}」 · 마감 후 ${b3c?.stage} · 찬성 ${r3?.onlineYes} · ${r3?.verdict}(가결선 6) · [거수 없음] 확정 ${r3?.handConfirmed}`,
    );
    await shot(O, 'i-ops-div3.png');
  });

  // ═══ (j) 세리머니 — 긴 합친 문구가 1920×1080 에서 잘리지 않는다 ═══
  await phase('j', async () => {
    const pg = A.page;
    await pg.setViewportSize({ width: 1920, height: 1080 });
    await tab(pg, '3. 세리머니').click();
    const stored = await pg.locator('[data-testid=ceremony-stored] li').count();
    // 세리머니에서 빠진 안 — 제목 넣고 무효로 돌린 G1, 제목 빈 G2. 투표 중인 안이 없으니 막지 않는다(한 번 눌러 시작).
    const gaps = pg.locator('[data-testid=ceremony-gaps]');
    const gapIds = await gaps.locator('[data-gap]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-gap')}:${e.getAttribute('data-blocking')}:${e.textContent.trim()}`)).catch(() => []);
    const gapHead = ((await gaps.locator('p').first().textContent().catch(() => '')) ?? '').trim();
    const gapsOk =
      gapIds.length === 2 && gapIds.some((x) => x.startsWith(`${G1}:false:`) && x.includes('투표 전')) && gapIds.some((x) => x.startsWith(`${G2}:false:`)) &&
      (await gaps.getAttribute('data-blocking')) === 'false' && gapHead.includes(`상정 4건(분과 안 ${D1_MOTIONS}건 중)`);
    record('j0-ceremony-gaps', gapsOk && stored === 4, `빠진 안 ${JSON.stringify(gapIds)} · 「${gapHead.slice(0, 60)}」 · 마감한 결과 ${stored}건`);
    await gaps.screenshot({ path: join(SHOTS, 'j-ceremony-gaps.png') }).catch(() => undefined);
    await pg.locator('[data-testid=division-ceremony-start]').click();
    const dlg = pg.locator('[data-testid=division-ceremony]');
    await dlg.waitFor({ timeout: 10000 });
    const total = ((await pg.locator('[data-testid=ceremony-total]').textContent().catch(() => '')) ?? '').trim();
    record('j0b-ceremony-total', total === `상정 4건(분과 안 ${D1_MOTIONS}건 중)`, `첫 화면 「${total}」`);
    const titleLoc = pg.locator('[data-testid=ceremony-title]');
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      const ph = await dlg.getAttribute('data-phase');
      const t = ((await titleLoc.textContent().catch(() => '')) ?? '').trim();
      if (ph === 'title' && t === M_TITLE) reached = true;
      else {
        await pg.keyboard.press('ArrowRight');
        await pg.waitForTimeout(500);
      }
    }
    const mainLoc = dlg.locator('main');
    const atTitle = { title: await fitOf(titleLoc), main: await fitOf(mainLoc) };
    await shot(A, 'j-ceremony-title-1920.png');
    await pg.keyboard.press('ArrowRight'); // → 막대
    await pg.waitForTimeout(400);
    await pg.keyboard.press('ArrowRight'); // → 판정
    const verdictShown = await waitUntil(async () => (await dlg.getAttribute('data-phase')) === 'verdict', 8000);
    await pg.waitForTimeout(800);
    const stamp = ((await pg.locator('[data-testid=ceremony-stamp]').first().textContent().catch(() => '')) ?? '').trim();
    const atVerdict = { title: await fitOf(titleLoc), main: await fitOf(mainLoc) };
    const yeasBox = await pg.locator('[data-testid=ceremony-yeas]').boundingBox().catch(() => null);
    const footerTop = (await dlg.locator('footer').boundingBox().catch(() => null))?.y ?? 0;
    const titleStill = ((await titleLoc.textContent()) ?? '').trim() === M_TITLE;
    const noOverlap = !!yeasBox && atVerdict.title.bottom <= yeasBox.y && yeasBox.y + yeasBox.height <= footerTop;
    await shot(A, 'j-ceremony-verdict-1920.png');
    record(
      'j1-ceremony-long-title',
      stored === 4 && reached && titleStill && fitsBox(atTitle.main) && fitsBox(atVerdict.main) && atVerdict.title.bottom <= footerTop && noOverlap && verdictShown && /가결/.test(stamp),
      `저장 결과 ${stored}건 · M 제목 화면 도달=${reached} · 제목 전체=${titleStill} · 본문 넘침 없음(제목 ${atTitle.main.sh}/${atTitle.main.ch}, 판정 ${atVerdict.main.sh}/${atVerdict.main.ch}) · 제목 아래끝 ${atVerdict.title.bottom} ≤ 찬성 숫자 ${Math.round(yeasBox?.y ?? -1)} ≤ 발판 ${Math.round(footerTop)} · 도장 「${stamp}」`,
    );
    await pg.keyboard.press('Escape');
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
