#!/usr/bin/env node
/**
 * 11/14 전체회의 의결(의제별 투표지 3장 · 19·28·23건) — 운영 DB 드라이런 E2E.
 *
 * ★ 실제 Supabase 를 친다. 반드시 **전용 드라이런 세션**(slug 가 `zz-dryrun-1114-` 로 시작)의 조 코드로만 돌린다.
 *   운영 회차 · 실세션(1018-revote, 1017-division-vote 등) 코드 금지. 서비스 키를 쓰지 않는다 · 아무것도 지우지 않는다.
 *   세션 · 조 시드, 가상 명단 적재(scripts/load-1017-roster.ts --map), 정리 SQL 은 이 스크립트 밖에서 한다.
 *   로그인 뒤 /mod 의 sessionSlug 가 `zz-dryrun-1114-` 로 시작하지 않으면 그 자리에서 멈춘다.
 * ★ 운영자 접속 토큰 · 조 코드는 출력하지 않는다(결과 내보내기에는 환경 변수로만 넘긴다).
 *
 * ── 실행(Git Bash) ──────────────────────────────────────────
 *   PATH="/c/Users/iceam/tools/node-v20.18.0-win-x64:$PATH" \
 *   PLAYWRIGHT_MODULE=file:///C:/Users/iceam/dev/labor-law-guide/node_modules/playwright/index.mjs \
 *   BASE_URL=https://<브랜치>.climate-assembly-wiki.pages.dev  EXPECT_COMMIT=<sha> \
 *   SEED_FILE=C:/path/seed1114.json  ROSTER_FILE=C:/path/roster.json  OUT_DIR=C:/path/rehearsal_1114_<시각> \
 *   node scripts/verify-1114-e2e.mjs --confirm-dryrun-session
 *   인자 확인만: `--dry-run` (브라우저 · 네트워크 없음)
 *
 * ── SEED_FILE 모양 ──────────────────────────────────────────
 *   { "slug": "zz-dryrun-1114-…", "miniSlug": "zz-dryrun-1114-…-g",
 *     "teams": { "1": [이름, 코드], "2": […], "3": […], "o": [운영팀 이름(분과 없음), 코드] },
 *     "miniTeam": [운영팀 이름, 코드] }
 *   본 세션 = 명단(ROSTER_FILE, load-1017-roster 모양) 적재됨. 미니 세션 = 명단 0행(시나리오 g).
 *
 * ── 단계 ────────────────────────────────────────────────────
 *   M  /mod 「＋ 새 다의제 투표」로 투표지 3장(docs/1114-paste 붙여넣기 · 세션 전체 · 「전체회의 의결 의제N …」)
 *      — 잘못된 제목 · 분과 대상 막힘, 「누르지 않은 건 허용」 잠김, 28건(s31 상한 30) 생성, 큰 QR 화면에 실시간 수 · 「투표결과 보기」 없음
 *   a  숙의 시민 실명 → 넘김식 28건 → 제출          b  기획참여단 시민 같은 흐름
 *   c  1건 미응답 → 제출 막힘(요청 0) + 서버 직접 호출도 거부 → 보완 후 제출
 *   d  같은 이름 · 다른 기기 → 「이미 이 이름…」(재투표 불가)
 *   e  직접 입력 이름 → DB 저장(voter_in_roster=false) + 출석부 밖 직접 입력 1건(RPC)
 *   f  동명이인(다른 조 같은 이름) 두 사람 — 두 번째 거부면 「알려진 한계」(s32 미적용)
 *   g  명단 0행 미니 세션 → 막는 화면 · 제출 요청 0
 *   h  [제출하기] 한 틱 두 번 → 요청 1 · 응답 1 (+ 찬성 두 번 눌러도 한 건만 넘어감)
 *   B  가상 시민 다수 anon RPC 제출(의제별 결정적 답 — 경계 건 · 부결 건 포함) + 무기명 1건(관찰)
 *   X  결과 내보내기: 열린 상태 confirmed:false → [투표 마감] → confirmed:true(rehearsal) · 기대 집계 대조 · --verify ·
 *      출석 수를 작게 준 실행 / 출석부 사람 수 < 출석 실행은 파일을 만들지 않음 · 기존 파일 그대로
 *   결과: OUT_DIR/results-1114.json · results-1114.md · shots/*.png · shots_합본.jpg. FAIL 이 있으면 종료 코드 1.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const CONFIRMED = argv.includes('--confirm-dryrun-session');
const BASE = (process.env.BASE_URL ?? '').replace(/\/+$/, '');
const EXPECT_COMMIT = process.env.EXPECT_COMMIT ?? '';
const SEED_FILE = process.env.SEED_FILE;
const ROSTER_FILE = process.env.ROSTER_FILE;
const OUT_DIR = process.env.OUT_DIR;
const PROD_HOST = 'pleyuknjnprsckssxvrh.supabase.co';
const PREFIX = 'zz-dryrun-1114-';

function fail(msg) {
  console.error(msg);
  process.exit(2);
}
if (!BASE || !SEED_FILE || !ROSTER_FILE || !OUT_DIR) fail('BASE_URL, SEED_FILE, ROSTER_FILE, OUT_DIR 가 필요합니다(머리말 참고).');
const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8'));
if (!String(seed.slug ?? '').startsWith(PREFIX) || !String(seed.miniSlug ?? '').startsWith(PREFIX)) fail(`드라이런 세션 slug 는 ${PREFIX} 로 시작해야 합니다.`);
for (const k of ['1', '2', '3', 'o']) if (!Array.isArray(seed.teams?.[k]) || !/^\d{6}$/.test(seed.teams[k][1] ?? '')) fail(`SEED_FILE teams["${k}"] 모양 오류`);
if (!Array.isArray(seed.miniTeam) || !/^\d{6}$/.test(seed.miniTeam[1] ?? '')) fail('SEED_FILE miniTeam 모양 오류');
const roster = JSON.parse(readFileSync(ROSTER_FILE, 'utf8'));

const AGENDAS = [
  { no: 1, name: '기업 온실가스 감축 촉진', count: 19 },
  { no: 2, name: '일회용품 줄이기 등 자원순환', count: 28 },
  { no: 3, name: '기후시민 의식제고 교육', count: 23 },
].map((a) => {
  const paste = readFileSync(join(ROOT, 'docs/1114-paste', `agenda${a.no}.txt`), 'utf8');
  const lines = paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length !== a.count) fail(`agenda${a.no}.txt 줄 수 ${lines.length} ≠ ${a.count}`);
  return { ...a, paste, lines, title: `전체회의 의결 의제${a.no} ${a.name}` };
});

// ── 시민 배정(UI 시나리오 이름은 대량 제출에서 뺀다 — 이름 중복 규칙 때문에) ───────
const teamFirst = (team) => roster.find((r) => r.team === team && !r.name.startsWith('시험동명')).name;
const VOTER = {
  a: { team: '2분과 3조', name: teamFirst('2분과 3조') },
  b: { team: '기획참여단 분과A', name: teamFirst('기획참여단 분과A') },
  c: { team: '1분과 4조', name: teamFirst('1분과 4조') },
  e: { team: '3분과 2조', name: '시험직접01' },
  e2: { team: '3분과 2조', name: '시험직접02' },
  f1: { team: '1분과 2조', name: '시험동명' },
  f2: { team: '3분과 4조', name: '시험동명' },
  h: { team: '2분과 5조', name: teamFirst('2분과 5조') },
};
const RESERVED = new Set(Object.values(VOTER).map((v) => v.name));
const POOL = roster.filter((r) => !RESERVED.has(r.name));
const BULK_N = { 1: 110, 2: 100, 3: 95 };
const YES = 2;
const NAY = 1;
/** UI 시민의 답: 5 · 6번 반대, 나머지 찬성. */
const uiChoice = (ordinal) => (ordinal === 5 || ordinal === 6 ? 'no' : 'yes');
/** 대량 시민 i(0부터)의 답 — 2번 ≈75% 찬성(경계 건 X), 3번 = 2번에서 i=1 만 반대(경계 −1, Z), 4번 ≈50%(부결 F), 그 밖 ≈94%. */
function bulkValue(i, ordinal) {
  if (ordinal === 1) return YES;
  if (ordinal === 2) return i % 4 !== 0 ? YES : NAY;
  if (ordinal === 3) return i === 1 ? NAY : i % 4 !== 0 ? YES : NAY;
  if (ordinal === 4) return i % 2 === 0 ? YES : NAY;
  return i % 17 === 0 ? NAY : YES;
}
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(list, s) {
  const r = mulberry32(s);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const BULK = Object.fromEntries(AGENDAS.map((a) => [a.no, shuffled(POOL, 1114 + a.no).slice(0, BULK_N[a.no])]));

const PLAN = {
  base: BASE,
  expectCommit: EXPECT_COMMIT || '(검사 안 함)',
  slug: seed.slug,
  miniSlug: seed.miniSlug,
  roster: roster.length,
  agendas: AGENDAS.map((a) => `${a.title} (${a.lines.length}건)`),
  voters: VOTER,
  bulk: BULK_N,
  outDir: OUT_DIR,
};
if (DRY) {
  console.log(JSON.stringify({ dryRun: true, ...PLAN }, null, 2));
  process.exit(0);
}
if (!CONFIRMED) fail('드라이런 세션 코드인지 확인했으면 --confirm-dryrun-session 을 붙이십시오. 인자만 보려면 --dry-run.');

const SHOTS = join(OUT_DIR, 'shots');
mkdirSync(SHOTS, { recursive: true });

const SUPA_SRC = readFileSync(resolve(ROOT, 'src/lib/supabase.ts'), 'utf8');
const URL_BASE = /FALLBACK_URL = '([^']+)'/.exec(SUPA_SRC)?.[1];
const ANON = /FALLBACK_ANON =\s*'([^']+)'/.exec(SUPA_SRC)?.[1];
if (!URL_BASE || !ANON) fail('src/lib/supabase.ts 에서 공개 URL·키를 찾지 못했습니다.');

// ── 결과 기록 ────────────────────────────────────────────────
const results = [];
function record(id, ok, detail, kind = ok ? 'PASS' : 'FAIL') {
  results.push({ id, ok: !!ok, kind, detail: String(detail ?? '') });
  console.log(`${kind.padEnd(5)} ${id} — ${detail}`);
}
const note = (id, detail) => record(id, true, detail, 'NOTE');
const limit = (id, detail) => record(id, true, detail, 'LIMIT');

async function rpc(name, body) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', 'Accept-Profile': 'climate_vote', 'Content-Profile': 'climate_vote' },
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

// ── 브라우저 ─────────────────────────────────────────────────
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true });
const pageErrors = {};
const netLog = {};
/** 페이지마다 RPC 호출(함수 이름 · 호스트)을 모은다. */
async function newCtx(name, mobile = false) {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'ko-KR' }
      : { viewport: { width: 1440, height: 900 }, locale: 'ko-KR' },
  );
  const page = await ctx.newPage();
  pageErrors[name] = [];
  netLog[name] = [];
  page.on('pageerror', (e) => pageErrors[name].push(String(e.message).slice(0, 200)));
  page.on('request', (r) => {
    const u = r.url();
    const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(u);
    if (m) netLog[name].push({ fn: m[1], host: new URL(u).host, t: Date.now() });
  });
  return { ctx, page, name };
}
const submits = (name) => (netLog[name] ?? []).filter((x) => x.fn.startsWith('ballot_submit'));
const shot = (C, file, full = false) => C.page.screenshot({ path: join(SHOTS, file), fullPage: full }).catch(() => undefined);
async function phase(id, fn) {
  try {
    await fn();
  } catch (e) {
    record(`${id}-error`, false, String(e?.message ?? e).slice(0, 400));
  }
}
const bodyText = (page) => page.evaluate(() => document.body.innerText);

// ── 상태 ─────────────────────────────────────────────────────
let O; // 운영팀 콘솔(1440)
let TOKEN = null; // 운영자 접속 토큰 — 출력 금지
const ballots = {}; // no → { id, token }
const submitted = { 1: [], 2: [], 3: [] }; // 기대 집계용: { team, name, answers(ordinal→값), accepted, manual }
const manifest = { slug: seed.slug, miniSlug: seed.miniSlug, ballots: {}, miniBallot: null };

// ── /mod ─────────────────────────────────────────────────────
async function openOps(name, code) {
  const C = await newCtx(name);
  await C.page.goto(`${BASE}/mod?code=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await C.page.locator('#mod-tab-vote').waitFor({ timeout: 60000 });
  const sess = await C.page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('climate_vote_mod_session_v1') ?? 'null');
    } catch {
      return null;
    }
  });
  if (!sess || !String(sess.sessionSlug ?? '').startsWith(PREFIX)) {
    await browser.close();
    fail(`로그인한 세션이 드라이런이 아닙니다(${sess?.sessionSlug ?? '없음'}) — 멈춤`);
  }
  await C.page.locator('#mod-tab-vote').click();
  await C.page.getByRole('button', { name: /새 다의제 투표/ }).waitFor({ timeout: 30000 });
  return { C, sess };
}

async function createBallotUI(C, ag, { negatives = false, shotPrefix = null, idp = 'M' } = {}) {
  const page = C.page;
  const P = `${idp}${ag.no}`;
  const before = await page.locator('[data-ballot-id]').count();
  await page.getByRole('button', { name: /새 다의제 투표/ }).click();
  const titleInput = page.locator('input[placeholder^="예: 폐회 일괄 투표"]');
  await titleInput.waitFor({ timeout: 15000 });
  const optional = page.locator('[data-testid=ballot-optional]');
  if (negatives) {
    // 잠기기 전에는 켤 수 있다 — 켠 뒤 전체회의 제목을 쓰면 꺼진 채 잠기는지.
    await optional.check();
    await titleInput.fill('전체회의 의결 의제 1 기업 온실가스 감축 촉진');
  } else await titleInput.fill(ag.title);
  const locked = (await optional.isDisabled()) && !(await optional.isChecked()) && (await page.locator('[data-testid=ballot-optional-locked]').isVisible());
  // 대상: 분과 조가 있으면 「세션 전체」 단추가 보인다(미니 세션은 분과 조가 없어 대상 칸 자체가 없다).
  const whole = page.getByRole('button', { name: '세션 전체', exact: true });
  await whole.waitFor({ timeout: 6000 }).catch(() => undefined);
  const hasTarget = (await whole.count()) > 0;
  await page.locator('[data-testid=ballot-bulk]').fill(ag.paste);
  await page.locator('[data-testid=ballot-bulk-apply]').click();
  const stmts = page.locator('input[placeholder="의제 문장"]');
  await page.waitForFunction((n) => document.querySelectorAll('input[placeholder="의제 문장"]').length === n, ag.count, { timeout: 10000 });
  const nItems = await stmts.count();
  const lastVal = await stmts.nth(nItems - 1).inputValue();
  if (negatives) {
    // ① 띄어쓴 제목 — 점검 상자 · [초안 만들기] 막힘
    const warnBad = await page.locator('[data-testid=plenary-warnings]').isVisible();
    await page.getByRole('button', { name: '초안 만들기', exact: true }).click();
    await page.waitForTimeout(1200);
    const stillForm = await titleInput.isVisible();
    const afterBad = await page.locator('[data-ballot-id]').count();
    record(`${P}-title-bad`, warnBad && stillForm && afterBad === before,`「의제 1」(띄어씀) 제목 → 점검 상자 ${warnBad} · 폼 그대로 ${stillForm} · 투표지 수 ${before}→${afterBad}`);
    // ② 분과 대상 — 점검 상자
    if (hasTarget) {
      await titleInput.fill(ag.title);
      await page.getByRole('button', { name: /^1분과/ }).click();
      const warnTarget = ((await page.locator('[data-testid=plenary-warnings]').textContent().catch(() => '')) ?? '').includes('세션 전체');
      record(`${P}-target-division`, warnTarget,`대상 1분과 → 점검 「대상을 세션 전체로」 ${warnTarget}`);
      await whole.click();
    }
    await titleInput.fill(ag.title);
    const optAfter = (await optional.isDisabled()) && !(await optional.isChecked()) && (await page.locator('[data-testid=ballot-optional-locked]').isVisible());
    record(`${P}-optional-locked`, locked && optAfter, `「누르지 않은 건 허용」을 먼저 켠 뒤 전체회의 제목 → 꺼진 채 잠김(disabled ${await optional.isDisabled()}, checked ${await optional.isChecked()}) · 안내문 보임 ${optAfter} — 서버 필수 표시는 ${P}-required 에서 확인`);
  } else {
    record(`${P}-optional-locked`, locked, `의제${ag.no} 폼 「누르지 않은 건 허용」 잠김(disabled · 꺼짐 · 안내문) ${locked}`);
    if (hasTarget) await whole.click();
  }
  if (hasTarget) record(`${P}-target-whole`, (await whole.getAttribute('aria-pressed')) === 'true', `대상 「세션 전체」 눌림 ${await whole.getAttribute('aria-pressed')}`);
  else note(`${P}-target-none`, '분과 조가 없는 세션 — 「대상」 칸이 없고 세션 전체로 만든다');
  const warnings = await page.locator('[data-testid=plenary-warnings]').count();
  record(`${P}-form-items`, nItems === ag.count && lastVal.startsWith(`${ag.no}-${ag.count}-안1 `) && warnings === 0, `붙여넣기 → 문항 ${nItems}개(기대 ${ag.count}) · 마지막 ${lastVal.slice(0, 12)}… · 점검 상자 ${warnings}`);
  if (shotPrefix) await shot(C, `${shotPrefix}_폼.png`, true);
  await page.getByRole('button', { name: '초안 만들기', exact: true }).click();
  const card = page.locator('[data-ballot-id]', { hasText: ag.title }).first();
  await card.waitFor({ timeout: 20000 });
  const cardText = (await card.innerText()).replace(/\s+/g, ' ');
  const id = await card.getAttribute('data-ballot-id');
  const badges = await card.locator('span.rounded-full').evaluateAll((els) => els.map((e) => e.textContent.trim()));
  record(`${P}-draft`, cardText.includes(`의제 ${ag.count}개`) && badges.includes('전체') && badges.includes('초안'), `초안 카드: 문항 「의제 ${ag.count}개」 ${cardText.includes(`의제 ${ag.count}개`)} · 배지 ${badges.join('/')}`);
  // [투표 시작] → 확인 창 → QR 자동
  await card.getByRole('button', { name: '투표 시작', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ timeout: 10000 });
  await dlg.getByRole('button', { name: '투표 시작', exact: true }).click();
  const qr = page.locator('[data-testid=qr-fullscreen]');
  await qr.waitFor({ timeout: 20000 });
  await page.waitForTimeout(3500); // 실시간 수 폴링(3초)이 있었다면 한 번은 돌 시간
  const url = await qr.getAttribute('data-ballot-url');
  const token = /[?&]t=([0-9a-f]{32})/.exec(url ?? '')?.[1] ?? null;
  const liveYes = await page.locator('[data-testid=qr-live-yes], [data-testid=qr-live-no]').count();
  const liveTotal = await page.locator('[data-testid=qr-live-total]').count();
  const names = await page.locator('[data-testid=qr-show-names]').count();
  const qrText = (await qr.innerText()).replace(/\s+/g, ' ').trim();
  const quiet = liveYes === 0 && liveTotal === 0 && names === 0 && !qrText.includes('투표결과 보기') && !/제출\s*\d/.test(qrText);
  if (shotPrefix) await shot(C, `${shotPrefix}_QR.png`);
  record(`${P}-qr-quiet`, quiet && !!token, `큰 QR 화면 글자 전부 「${qrText.slice(0, 60)}」 · 실시간 찬반 ${liveYes} · 제출 수 ${liveTotal} · 「투표결과 보기」 ${names} · 토큰 ${token ? '있음' : '없음'}`);
  await page.keyboard.press('Escape');
  await qr.waitFor({ state: 'detached', timeout: 10000 });
  return { id, token };
}

// ── /b (390) ─────────────────────────────────────────────────
async function openBallot(name, token) {
  const V = await newCtx(name, true);
  for (let attempt = 0; attempt < 3; attempt++) {
    await V.page.goto(`${BASE}/b?t=${token}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
    const ok = await V.page
      .locator('[data-testid=pager-start], [data-testid=voter-confirm], [data-testid=pager-position]')
      .or(V.page.getByText('명단이 아직 준비되지 않았습니다'))
      .first()
      .waitFor({ timeout: 40000 })
      .then(() => true)
      .catch(() => false);
    if (ok) break;
  }
  return V;
}
async function pickVoter(V, voter, manual = false) {
  const page = V.page;
  await page.locator('[data-testid=pager-start]').waitFor({ timeout: 30000 });
  await page.locator(`[data-team="${voter.team}"]`).click();
  if (manual) {
    await page.locator('[data-testid=voter-manual]').click();
    await page.locator('[data-testid=voter-name-input]').fill(voter.name);
  } else {
    await page.locator(`[data-testid=voter-picker] [data-name="${voter.name}"]`).click();
  }
  const chosen = ((await page.locator('[data-testid=voter-chosen]').innerText().catch(() => '')) ?? '').trim();
  return chosen;
}
// PR #49 이후 — 「다음」(pager-start)은 「OOO 님이 맞나요?」 확인 화면을 열 뿐이고, 「네」(pager-confirm-yes)를 눌러야 투표가 시작된다.
async function startVoting(page) {
  await page.locator('[data-testid=pager-start]').click();
  await page.locator('[data-testid=voter-confirm]').waitFor({ timeout: 20000 });
  await page.locator('[data-testid=pager-confirm-yes]').click();
}
const posText = (page) => page.locator('[data-testid=pager-position]').innerText().then((s) => s.trim()).catch(() => null);
async function waitAdvance(page, prev) {
  await page.waitForFunction(
    (p) => {
      const pos = document.querySelector('[data-testid=pager-position]');
      return !!document.querySelector('[data-testid=pager-counts]') || (pos && pos.textContent.trim() !== p);
    },
    prev,
    { timeout: 10000 },
  );
  // 넘어간 직후 0.5초는 누름을 받지 않는다(ballot-pager-logic INPUT_LOCK_MS — 두 번 눌러 한 건 건너뛰기 방지, 설계).
  await page.waitForTimeout(600);
}
/** 넘김식 전 건 — choice(ordinal) = 'yes' | 'no' | 'skip'. 돌려주는 값 = ordinal → 값. */
async function answerAll(V, total, choice, onPos) {
  const page = V.page;
  const answers = {};
  for (let guard = 0; guard < total + 3; guard++) {
    if (await page.locator('[data-testid=pager-counts]').count()) break;
    const p = await posText(page);
    const k = Number(/^(\d+)\s*\/\s*(\d+)$/.exec(p ?? '')?.[1]);
    if (!k) throw new Error(`위치를 읽지 못함: ${p}`);
    if (onPos) await onPos(k, p);
    const c = choice(k);
    if (c === 'skip') {
      await page.locator('[data-testid=pager-next]').click();
    } else {
      await page.locator(`[data-testid=pager-${c}]`).click();
      answers[k] = c === 'yes' ? YES : NAY;
    }
    await waitAdvance(page, p);
  }
  await page.locator('[data-testid=pager-counts]').waitFor({ timeout: 10000 });
  return answers;
}
async function waitOutcome(page) {
  await page.locator('[data-testid=named-done]').or(page.getByRole('alert')).first().waitFor({ timeout: 30000 });
  const done = await page.locator('[data-testid=named-done]').count();
  const alert = done ? '' : ((await page.getByRole('alert').first().innerText().catch(() => '')) ?? '');
  return { done: done > 0, alert: alert.trim() };
}
async function responsesOf(ballotId) {
  const r = await rpc('ballot_named_responses_v2', { p_token: TOKEN, p_ballot_id: ballotId });
  if (!r.ok) throw new Error(`ballot_named_responses_v2: ${r.message}`);
  return r.data;
}
const normName = (s) => String(s ?? '').replace(/[\s 　]+/g, '').toLowerCase();
const rowsFor = (data, name) => (data?.responses ?? []).filter((x) => normName(x.voter_name) === normName(name));
/** 투표지 문항 id(ordinal 순) — ballot_get. */
const itemIds = {};
async function loadItems(no) {
  const g = await rpc('ballot_get', { p_token: ballots[no].token });
  const items = [...(g.data?.items ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  itemIds[no] = items.map((x) => x.id);
  return items;
}
const answersById = (no, byOrdinal) => Object.fromEntries(Object.entries(byOrdinal).map(([k, v]) => [itemIds[no][Number(k) - 1], v]));

// ═══ main ═══════════════════════════════════════════════════
async function main() {
  await phase('P0', async () => {
    if (EXPECT_COMMIT) {
      const rev = await (await fetch(`${BASE}/deployment-revision.json`, { cache: 'no-store' })).json();
      record('P0-commit', rev.sourceCommit === EXPECT_COMMIT, `${BASE} sourceCommit=${String(rev.sourceCommit).slice(0, 7)} 기대=${EXPECT_COMMIT.slice(0, 7)}`);
    }
  });

  // ═══ M: 투표지 3장 ═══
  await phase('M', async () => {
    const r = await openOps('ops', seed.teams.o[1]);
    O = r.C;
    TOKEN = r.sess.accessToken;
    record('M-login', r.sess.sessionSlug === seed.slug && r.sess.team?.subgroup === null, `운영팀(분과 없음) 로그인 · 세션 ${r.sess.sessionSlug}`);
    await O.page.waitForTimeout(1500);
    await shot(O, 'M_00_투표탭.png');
    for (const ag of AGENDAS) {
      const b = await createBallotUI(O, ag, { negatives: ag.no === 1, shotPrefix: `M_${ag.no}_의제${ag.no}` });
      ballots[ag.no] = b;
      manifest.ballots[ag.no] = b.id;
    }
    writeFileSync(join(OUT_DIR, 'manifest-1114.json'), JSON.stringify(manifest, null, 2));
    const list = await rpc('ballot_list_v2', { p_token: TOKEN });
    const mine = (list.data ?? []).filter((x) => Object.values(ballots).some((b) => b.id === x.id));
    const shape = mine.map((x) => `${x.title.slice(0, 13)}:${x.status}:${x.subgroup ?? '전체'}:${x.item_count}`).join(' | ');
    record('M-list', mine.length === 3 && mine.every((x) => x.status === 'open' && !x.subgroup) && mine.map((x) => x.item_count).sort((a, b) => a - b).join(',') === '19,23,28', `ballot_list_v2: ${shape}`);
    for (const ag of AGENDAS) {
      const items = await loadItems(ag.no);
      const allReq = items.length === ag.count && items.every((x) => x.required === true && x.scale === 2);
      record(`M${ag.no}-required`, allReq, `ballot_get 문항 ${items.length} · 전부 required ${items.every((x) => x.required === true)} · 전부 2점 ${items.every((x) => x.scale === 2)}`);
    }
    const namedBtn = await O.page.locator('[data-testid=ballot-named-board]').count();
    record('M-list-no-names', namedBtn === 0, `목록에 「투표결과 보기 (조·이름)」 단추 ${namedBtn}개(전체회의 투표지는 0)`);
    await shot(O, 'M_04_목록_열림3장.png', true);
  });
  if (!ballots[1] || !ballots[2] || !ballots[3] || !TOKEN) {
    record('M-abort', false, '투표지 3장을 만들지 못해 시민 단계를 건너뜀');
    return;
  }

  // ═══ a: 숙의 시민 28건 ═══
  await phase('a', async () => {
    const V = await openBallot('a', ballots[2].token);
    const teams = await V.page.locator('[data-testid=voter-picker] [data-team]').evaluateAll((els) => els.map((e) => e.getAttribute('data-team')));
    record('a-roster-teams', teams.length === 17 && teams.includes('기획참여단 분과A') && teams.includes('3분과 5조'), `조 단추 ${teams.length}개(1·2·3분과 15 + 기획참여단 2): ${teams.slice(0, 3).join(', ')} … ${teams.slice(-2).join(', ')}`);
    const chosen = await pickVoter(V, VOTER.a);
    await shot(V, 'C_a_00_본인확인.png');
    await startVoting(V.page);
    await V.page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    record('a-first', (await posText(V.page)) === '1 / 28', `첫 화면 ${await posText(V.page)} · 고른 사람 「${chosen}」`);
    await shot(V, 'C_a_01_1of28.png');
    const ans = await answerAll(V, 28, uiChoice);
    const counts = (await V.page.locator('[data-testid=pager-counts]').innerText()).replace(/\s+/g, ' ');
    await shot(V, 'C_a_02_요약.png');
    await V.page.locator('[data-testid=pager-submit]').click();
    const out = await waitOutcome(V.page);
    await shot(V, 'C_a_03_제출완료.png');
    const db = rowsFor(await responsesOf(ballots[2].id), VOTER.a.name);
    const ok = out.done && db.length === 1 && db[0].voter_team === VOTER.a.team && Object.keys(db[0].answers ?? {}).length === 28 && submits('a').length === 1;
    record('a', ok, `요약 「${counts}」 → 완료 ${out.done} · 제출 요청 ${submits('a').length} · DB ${db.length}행 ${db[0]?.voter_team ?? ''} 답 ${Object.keys(db[0]?.answers ?? {}).length}건 명단 ${db[0]?.voter_in_roster}`);
    submitted[2].push({ ...VOTER.a, answers: ans, accepted: out.done });
    const hosts = [...new Set(netLog.a.map((x) => x.host))];
    record('a-host', hosts.length === 1 && hosts[0] === PROD_HOST, `RPC 호스트 ${hosts.join(', ')}`);
    await V.ctx.close();
  });

  // ═══ b: 기획참여단 시민 ═══
  await phase('b', async () => {
    const V = await openBallot('b', ballots[2].token);
    await pickVoter(V, VOTER.b);
    await shot(V, 'C_b_00_본인확인_기획참여단.png');
    await startVoting(V.page);
    await V.page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    const ans = await answerAll(V, 28, uiChoice);
    await V.page.locator('[data-testid=pager-submit]').click();
    const out = await waitOutcome(V.page);
    await shot(V, 'C_b_01_제출완료.png');
    const db = rowsFor(await responsesOf(ballots[2].id), VOTER.b.name);
    record('b', out.done && db.length === 1 && db[0].voter_team === VOTER.b.team && db[0].voter_in_roster !== false, `기획참여단 ${VOTER.b.team} → 완료 ${out.done} · DB ${db.length}행 명단 ${db[0]?.voter_in_roster}`);
    submitted[2].push({ ...VOTER.b, answers: ans, accepted: out.done });
    await V.ctx.close();
  });

  // ═══ c: 1건 미응답 → 막힘 ═══
  await phase('c', async () => {
    const V = await openBallot('c', ballots[1].token);
    await pickVoter(V, VOTER.c);
    await startVoting(V.page);
    await V.page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    const ans = await answerAll(V, 19, (k) => (k === 7 ? 'skip' : uiChoice(k)));
    const counts = (await V.page.locator('[data-testid=pager-counts]').innerText()).replace(/\s+/g, ' ');
    const disabled = await V.page.locator('[data-testid=pager-submit]').isDisabled();
    const goto = ((await V.page.locator('[data-testid=pager-goto-missing]').innerText().catch(() => '')) ?? '').trim();
    // 꺼진 단추를 스크립트로 눌러도(=화면 우회) 요청이 나가지 않는지
    await V.page.evaluate(() => document.querySelector('[data-testid=pager-submit]')?.click());
    await V.page.waitForTimeout(1500);
    await V.page.locator('[data-testid=pager-goto-missing]').scrollIntoViewIfNeeded();
    await shot(V, 'C_c_01_1건미응답_막힘.png');
    record('c-ui', disabled && goto.includes('1-7') && counts.includes('미응답 1') && submits('c').length === 0, `요약 「${counts}」 · [제출하기] 꺼짐 ${disabled} · 단추 「${goto}」 · 제출 요청 ${submits('c').length}`);
    // 서버: 한 건 빠진 답을 직접 보내면 거부(문항 required)
    const partial = Object.fromEntries(itemIds[1].filter((_, i) => i !== 6).map((id) => [id, YES]));
    const sv = await rpc('ballot_submit_named', { p_token: ballots[1].token, p_client_id: `dryrun1114-c-${randomUUID()}`, p_answers: partial, p_voter_team: '1분과 4조', p_voter_name: '시험누락서버' });
    record('c-server', !sv.ok && /missing answer/.test(sv.message), `서버 직접 호출(18/19건) → ${sv.status} ${sv.message.slice(0, 60)}`);
    // 보완 — 빠진 건으로 가서 누르고 제출
    await V.page.locator('[data-testid=pager-goto-missing]').click();
    await V.page.waitForTimeout(700);
    const at = await posText(V.page);
    await V.page.locator('[data-testid=pager-yes]').click();
    ans[7] = YES;
    await V.page.waitForTimeout(700);
    await V.page.locator('[data-testid=pager-to-summary]').click();
    await V.page.locator('[data-testid=pager-counts]').waitFor({ timeout: 10000 });
    await V.page.locator('[data-testid=pager-submit]').click();
    const out = await waitOutcome(V.page);
    await shot(V, 'C_c_02_보완후_제출완료.png');
    const db = rowsFor(await responsesOf(ballots[1].id), VOTER.c.name);
    record('c-recover', at === '7 / 19' && out.done && db.length === 1 && Object.keys(db[0].answers).length === 19, `빠진 건 단추 → ${at} → 찬성 → 제출 완료 ${out.done} · DB ${db.length}행 답 ${Object.keys(db[0]?.answers ?? {}).length}건`);
    submitted[1].push({ ...VOTER.c, answers: ans, accepted: out.done });
    await V.ctx.close();
  });

  // ═══ d: 같은 이름 · 다른 기기 ═══
  await phase('d', async () => {
    const V = await openBallot('d', ballots[1].token);
    await pickVoter(V, VOTER.c);
    await startVoting(V.page);
    await V.page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    await answerAll(V, 19, () => 'yes');
    await V.page.locator('[data-testid=pager-submit]').click();
    const out = await waitOutcome(V.page);
    await V.page.getByRole('alert').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await shot(V, 'C_d_다른기기_같은이름_거부.png');
    const db = rowsFor(await responsesOf(ballots[1].id), VOTER.c.name);
    record('d', !out.done && out.alert.includes('이미 이 이름으로 제출되었습니다') && db.length === 1, `다른 기기 같은 이름 → 「${out.alert.slice(0, 40)}…」 · 제출 요청 ${submits('d').length} · DB 그 이름 ${db.length}행`);
    await V.ctx.close();
  });

  // ═══ e: 직접 입력 ═══
  await phase('e', async () => {
    const V = await openBallot('e', ballots[3].token);
    const chosen = await pickVoter(V, VOTER.e, true);
    await shot(V, 'C_e_00_직접입력.png');
    await startVoting(V.page);
    await V.page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    const ans = await answerAll(V, 23, uiChoice);
    await V.page.locator('[data-testid=pager-submit]').click();
    const out = await waitOutcome(V.page);
    await shot(V, 'C_e_01_제출완료.png');
    const db = rowsFor(await responsesOf(ballots[3].id), VOTER.e.name);
    record('e', out.done && db.length === 1 && db[0].voter_team === VOTER.e.team && db[0].voter_in_roster === false, `직접 입력 「${chosen}」 → 완료 ${out.done} · DB ${db.length}행 조 ${db[0]?.voter_team} voter_in_roster=${db[0]?.voter_in_roster}`);
    submitted[3].push({ ...VOTER.e, answers: ans, accepted: out.done, manual: true });
    await V.ctx.close();
    // 출석부에 넣지 않을 직접 입력 1건(RPC) — 결과 내보내기의 「검증자 확인 목록」 시험용
    const all = Object.fromEntries(itemIds[3].map((id) => [id, YES]));
    const r2 = await rpc('ballot_submit_named', { p_token: ballots[3].token, p_client_id: `dryrun1114-e2-${randomUUID()}`, p_answers: all, p_voter_team: VOTER.e2.team, p_voter_name: VOTER.e2.name });
    record('e2-rpc', r2.ok && r2.data?.in_roster === false, `RPC 직접 입력 ${VOTER.e2.name} → ${r2.ok ? 'ok' : r2.message} in_roster=${r2.data?.in_roster}`);
    submitted[3].push({ ...VOTER.e2, answers: Object.fromEntries(itemIds[3].map((_, i) => [i + 1, YES])), accepted: r2.ok, manual: true });
  });

  // ═══ f: 동명이인 ═══
  await phase('f', async () => {
    const V1 = await openBallot('f1', ballots[3].token);
    await pickVoter(V1, VOTER.f1);
    await startVoting(V1.page);
    await V1.page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    const ans1 = await answerAll(V1, 23, uiChoice);
    await V1.page.locator('[data-testid=pager-submit]').click();
    const o1 = await waitOutcome(V1.page);
    submitted[3].push({ ...VOTER.f1, answers: ans1, accepted: o1.done });
    record('f-first', o1.done, `동명이인 첫째 ${VOTER.f1.team} ${VOTER.f1.name} → 완료 ${o1.done}`);
    await V1.ctx.close();
    const V2 = await openBallot('f2', ballots[3].token);
    await pickVoter(V2, VOTER.f2);
    await shot(V2, 'C_f_00_동명이인_둘째_본인확인.png');
    await startVoting(V2.page);
    await V2.page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    const ans2 = await answerAll(V2, 23, uiChoice);
    await V2.page.locator('[data-testid=pager-submit]').click();
    const o2 = await waitOutcome(V2.page);
    await V2.page.getByRole('alert').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await shot(V2, 'C_f_01_동명이인_둘째_결과.png');
    submitted[3].push({ ...VOTER.f2, answers: ans2, accepted: o2.done });
    const db = rowsFor(await responsesOf(ballots[3].id), '시험동명');
    const detail = `동명이인 둘째 ${VOTER.f2.team} ${VOTER.f2.name}(28건 아니라 23건 다 누른 뒤) → ${o2.done ? '완료' : `거부 「${o2.alert.slice(0, 30)}…」`} · DB 「시험동명」 ${db.length}행(${db.map((x) => x.voter_team).join(', ')})`;
    if (o2.done) record('f-second', db.length === 2, detail);
    else limit('f-second', `${detail} — 운영 ballot_submit_named 는 이름만으로 중복을 본다(s32 제안 · 미적용: supabase/migrations/20261111_s32_vote_dup_guard.sql). 둘째 사람은 투표하지 못한다`);
    await V2.ctx.close();
  });

  // ═══ h: 두 번 누름 ═══
  await phase('h', async () => {
    const V = await openBallot('h', ballots[3].token);
    await pickVoter(V, VOTER.h);
    await startVoting(V.page);
    await V.page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    // 찬성을 한 틱에 두 번 — 1번만 기록되고 2번으로 한 칸만 넘어가야 한다
    await V.page.evaluate(() => {
      const b = document.querySelector('[data-testid=pager-yes]');
      b?.click();
      b?.click();
    });
    await V.page.waitForTimeout(1200);
    const p2 = await posText(V.page);
    const pressedTwice = await V.page.evaluate(() => {
      const el = document.querySelector('[data-testid=pager-yes]');
      return el?.getAttribute('aria-pressed') ?? null;
    });
    record('h-pager-double', p2 === '2 / 23' && pressedTwice !== 'true', `찬성 두 번 누름 → ${p2} · 2번 찬성 눌림 표시 ${pressedTwice}`);
    const ans = { 1: YES, ...(await answerAll(V, 23, uiChoice)) };
    const counts = (await V.page.locator('[data-testid=pager-counts]').innerText()).replace(/\s+/g, ' ');
    await V.page.evaluate(() => {
      const b = document.querySelector('[data-testid=pager-submit]');
      b?.click();
      b?.click();
    });
    const out = await waitOutcome(V.page);
    await V.page.waitForTimeout(1500);
    await shot(V, 'C_h_두번누름_제출완료.png');
    const db = rowsFor(await responsesOf(ballots[3].id), VOTER.h.name);
    record('h', out.done && submits('h').length === 1 && db.length === 1, `요약 「${counts}」 · [제출하기] 한 틱 두 번 → 제출 요청 ${submits('h').length} · 완료 ${out.done} · DB ${db.length}행`);
    submitted[3].push({ ...VOTER.h, answers: ans, accepted: out.done });
    await V.ctx.close();
  });

  // ═══ g: 명단 0행 세션 ═══
  await phase('g', async () => {
    const r = await openOps('ops-g', seed.miniTeam[1]);
    record('g-login', r.sess.sessionSlug === seed.miniSlug, `미니 세션 로그인 ${r.sess.sessionSlug}`);
    const gb = await createBallotUI(r.C, AGENDAS[0], { shotPrefix: 'G_미니', idp: 'G' });
    manifest.miniBallot = gb.id;
    writeFileSync(join(OUT_DIR, 'manifest-1114.json'), JSON.stringify(manifest, null, 2));
    const V = await openBallot('g', gb.token);
    const blocked = await V.page.getByText('명단이 아직 준비되지 않았습니다').first().isVisible().catch(() => false);
    const start = await V.page.locator('[data-testid=pager-start], [data-testid=voter-confirm], [data-testid=pager-position], [data-testid=pager-submit]').count();
    await shot(V, 'C_g_명단0행_막힘.png');
    // 「다시 확인」을 눌러도 그대로 · 제출 요청 0
    await V.page.getByRole('button', { name: '다시 확인' }).click().catch(() => undefined);
    await V.page.waitForTimeout(2500);
    const still = await V.page.getByText('명단이 아직 준비되지 않았습니다').first().isVisible().catch(() => false);
    const list = await rpc('ballot_list_v2', { p_token: r.sess.accessToken });
    const row = (list.data ?? []).find((x) => x.id === gb.id);
    record('g', blocked && still && start === 0 && submits('g').length === 0 && row?.response_count === 0, `명단 0행 → 막는 화면 ${blocked} · 다시 확인 뒤 ${still} · 넘김식/제출 단추 ${start} · 제출 요청 ${submits('g').length} · 서버 제출 수 ${row?.response_count}`);
    const gItems = (await rpc('ballot_get', { p_token: gb.token })).data?.items ?? [];
    const sv = await rpc('ballot_submit_named', { p_token: gb.token, p_client_id: `dryrun1114-g-${randomUUID()}`, p_answers: Object.fromEntries(gItems.map((x) => [x.id, YES])), p_voter_team: '1분과 1조', p_voter_name: '시험영행' });
    record('g-server-named', !sv.ok && /roster not configured/.test(sv.message), `서버 직접 실명 제출(19건 전부) → ${sv.status} ${sv.message.slice(0, 50)}`);
    await V.ctx.close();
    await r.C.ctx.close();
  });

  // ═══ B: 가상 시민 다수(anon RPC) ═══
  await phase('B', async () => {
    let ok = 0;
    let bad = [];
    const jobs = [];
    for (const ag of AGENDAS) {
      BULK[ag.no].forEach((v, i) => {
        const byOrd = Object.fromEntries(itemIds[ag.no].map((_, j) => [j + 1, bulkValue(i, j + 1)]));
        jobs.push({ no: ag.no, v, byOrd });
      });
    }
    // 의제마다 순서를 섞어 흩어 낸다(동시 6)
    const order = shuffled(jobs, 77);
    let idx = 0;
    async function worker() {
      while (idx < order.length) {
        const j = order[idx++];
        const r = await rpc('ballot_submit_named', { p_token: ballots[j.no].token, p_client_id: `dryrun1114-bulk-${randomUUID()}`, p_answers: answersById(j.no, j.byOrd), p_voter_team: j.v.team, p_voter_name: j.v.name });
        if (r.ok) ok++;
        else bad.push(`${j.no}:${j.v.name}:${r.message.slice(0, 40)}`);
        submitted[j.no].push({ team: j.v.team, name: j.v.name, answers: j.byOrd, accepted: r.ok });
      }
    }
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 6 }, worker));
    record('B-bulk', bad.length === 0 && ok === jobs.length, `anon RPC 실명 제출 ${ok}/${jobs.length}(의제1 ${BULK_N[1]} · 의제2 ${BULK_N[2]} · 의제3 ${BULK_N[3]}) · ${Date.now() - t0}ms${bad.length ? ` · 실패 ${bad.slice(0, 3).join(' / ')}` : ''}`);
    // 무기명 1건(의제1) — 운영 ballot_submit 은 실명 수집 중에도 이름 없는 표를 받는다(s32 ① 미적용). 내보내기가 「이름 없음」으로 빼는지 본다.
    const all = Object.fromEntries(itemIds[1].map((id) => [id, YES]));
    const an = await rpc('ballot_submit', { p_token: ballots[1].token, p_client_id: `dryrun1114-anon-${randomUUID()}`, p_answers: all });
    submitted[1].push({ team: null, name: null, answers: Object.fromEntries(itemIds[1].map((_, i) => [i + 1, YES])), accepted: an.ok, nameless: true });
    if (an.ok) limit('B-anon', '명단이 있는 전체회의 투표지에 무기명 ballot_submit 이 서버에서 받아짐(토큰만 있으면 직접 호출 가능 · 화면은 부르지 않음) — s32 ① 미적용. 내보내기가 「이름 없음」으로 빼는지 X 단계에서 확인');
    else note('B-anon', `무기명 ballot_submit 거부 ${an.message.slice(0, 60)}`);
    // 운영 화면 「잠정 결과」(전체회의 투표지에도 열린다) — 관찰
    const card = O.page.locator('[data-ballot-id]', { hasText: AGENDAS[0].title }).first();
    await card.getByRole('button', { name: '잠정 결과', exact: true }).click();
    await O.page.waitForTimeout(4000);
    const txt = (await bodyText(O.page)).replace(/\s+/g, ' ');
    await shot(O, 'M_05_잠정결과_관찰.png');
    const shows = /제출\s*\d+\s*명/.test(txt);
    note('M-provisional', `목록의 [잠정 결과] 단추는 전체회의 투표지에도 있고 누르면 전체 화면에 제출 수${shows ? '·찬반 막대가 보인다' : '가 보이지 않는다'}(큰 화면 위생 W07 은 QR 화면만 가림 — 운영자가 누르지 않으면 됨)`);
    await O.page.getByRole('button', { name: '결과 화면 나가기' }).click().catch(() => O.page.keyboard.press('Escape'));
    await O.page.waitForTimeout(800);
  });

  // ═══ X: 결과 내보내기 ═══
  await phase('X', exportPhase);
}

// ── 기대 집계(내가 보낸 것 + 계약 4-3 규칙) ─────────────────────
function expectedTally(no, attendancePairs) {
  const count = AGENDAS.find((a) => a.no === no).count;
  const yes = Array(count + 1).fill(0);
  const nay = Array(count + 1).fill(0);
  let valid = 0;
  const seen = new Set();
  for (const s of submitted[no]) {
    if (!s.accepted) continue;
    if (!s.name) continue; // 이름 없음
    const key = normName(s.name);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!attendancePairs.has(`${s.team}\u0000${key}`)) continue; // 출석부 없음
    valid++;
    for (let k = 1; k <= count; k++) {
      if (s.answers[k] === YES) yes[k]++;
      else if (s.answers[k] === NAY) nay[k]++;
    }
  }
  return { valid, yes, nay };
}
const thresholdFor = (p) => Math.floor((2 * p + 2) / 3);

function runExport(args, label) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/export-result-v2.mjs'), ...args], {
    cwd: ROOT,
    env: { ...process.env, CV_ACCESS_TOKEN: TOKEN ?? '' },
    encoding: 'utf8',
    timeout: 120000,
  });
  writeFileSync(join(OUT_DIR, `export_${label}.log`), `rc=${r.status}\n--- stdout\n${r.stdout}\n--- stderr\n${r.stderr}`);
  return r;
}
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

async function exportPhase() {
  const ENROLLED = 180;
  // 출석부 = 받아진 실명 표의 (조, 이름) 전원(명단 + 시험직접01). 시험직접02 는 넣지 않는다 → 확인 목록.
  const pairs = new Map();
  for (const no of [1, 2, 3]) {
    for (const s of submitted[no]) {
      if (!s.accepted || !s.name || s.name === VOTER.e2.name) continue;
      pairs.set(`${s.team}\u0000${normName(s.name)}`, { team: s.team, name: s.name });
    }
  }
  const attendance = [...pairs.values()];
  const attSet = new Set(pairs.keys());
  writeFileSync(join(OUT_DIR, 'attendance_가상.json'), JSON.stringify(attendance, null, 1));
  writeFileSync(join(OUT_DIR, 'attendance_직접입력만.json'), JSON.stringify([{ team: VOTER.e.team, name: VOTER.e.name }], null, 1));
  // 출석(present): 2번 문항(경계 건 X)의 찬성 = 가결 기준이 되게 고른다 → X 가결 · 3번(Z, 하나 적음) 부결.
  const exp = {};
  const present = {};
  for (const ag of AGENDAS) {
    const t = expectedTally(ag.no, attSet);
    exp[ag.no] = t;
    let P = null;
    for (let p = t.valid; p <= Math.min(ENROLLED, attendance.length); p++) {
      if (thresholdFor(p) === t.yes[2] && 2 * p > ENROLLED) {
        P = p;
        break;
      }
    }
    present[ag.no] = P ?? Math.min(ENROLLED, attendance.length);
    note(`X${ag.no}-plan`, `기대: 유효 ${t.valid} · 2번 찬성 ${t.yes[2]} · 3번 찬성 ${t.yes[3]} · 4번 찬성 ${t.yes[4]} → 출석 ${present[ag.no]}(기준 ${thresholdFor(present[ag.no])}) · 출석부 ${attendance.length}명`);
  }
  const cfg = (over = {}) => ({
    rehearsal: true,
    example: false,
    enrolled: ENROLLED,
    report: { mode: 'present_only' },
    agendas: AGENDAS.map((ag) => ({
      no: ag.no,
      name: ag.name,
      count: ag.count,
      ballot_id: ballots[ag.no].id,
      present: present[ag.no],
      method: '휴대폰',
      attendance_file: 'attendance_가상.json',
      confirmed: true,
      signer: '드라이런 검증자',
      confirmed_at: `${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19)}+09:00`,
      ...(over[ag.no] ?? {}),
    })),
  });
  const writeCfg = (name, c) => {
    const f = join(OUT_DIR, name);
    writeFileSync(f, JSON.stringify(c, null, 2));
    return f;
  };

  // ① 열린 상태 · confirmed:false — 필수 표시 · 분과 지정 검사(절차서 0-5)
  const openCfg = cfg(Object.fromEntries(AGENDAS.map((a) => [a.no, { confirmed: false, signer: null, confirmed_at: null }])));
  const r1 = runExport(['--config', writeCfg('config_open_unconfirmed.json', openCfg), '--out', join(OUT_DIR, 'export_open_unconfirmed')], 'open_unconfirmed');
  const f1 = join(OUT_DIR, 'export_open_unconfirmed', 'result_v2.json');
  const d1 = existsSync(f1) ? JSON.parse(readFileSync(f1, 'utf8')) : null;
  record('X-open-unconfirmed', r1.status === 0 && d1?.status === '미확정' && d1.items.every((i) => i.yes === null && i.verdict === '미확정'), `열린 투표지 confirmed:false 내보내기 rc=${r1.status} · 상태 ${d1?.status} · 표수 null ${d1?.items?.every((i) => i.yes === null)} · ${(r1.stdout.match(/읽기 \d+ms · 전체 \d+ms/) ?? [''])[0]}`);
  // 확정인데 아직 open → 거부
  const rOpen = runExport(['--config', writeCfg('config_confirmed_while_open.json', cfg()), '--out', join(OUT_DIR, 'export_neg_open')], 'neg_confirmed_while_open');
  record('X-neg-open', rOpen.status === 2 && !existsSync(join(OUT_DIR, 'export_neg_open', 'result_v2.json')) && /열려 있음/.test(rOpen.stderr), `확정 + 투표지 open → rc=${rOpen.status} · 파일 없음 · 「열려 있음」 ${/열려 있음/.test(rOpen.stderr)}`);

  // ② [투표 마감] (운영 화면)
  for (const ag of AGENDAS) {
    const card = O.page.locator('[data-ballot-id]', { hasText: ag.title }).first();
    await card.getByRole('button', { name: '투표 마감', exact: true }).click();
    const dlg = O.page.getByRole('dialog');
    await dlg.waitFor({ timeout: 10000 });
    await dlg.getByRole('button', { name: '투표 마감', exact: true }).click();
    await O.page.waitForTimeout(1500);
  }
  await O.page.waitForTimeout(3500);
  await shot(O, 'M_06_목록_마감3장.png', true);
  const list = await rpc('ballot_list_v2', { p_token: TOKEN });
  const st = AGENDAS.map((ag) => (list.data ?? []).find((x) => x.id === ballots[ag.no].id));
  record('X-closed', st.every((x) => x?.status === 'closed'), `마감 뒤 상태 ${st.map((x) => `${x?.status}·제출${x?.response_count}`).join(' | ')} (공개 published 로 바꾸지 않음)`);

  // ③ 확정 내보내기
  const outC = join(OUT_DIR, 'export_confirmed');
  const r3 = runExport(['--config', writeCfg('config_confirmed.json', cfg()), '--out', outC], 'confirmed');
  const fC = join(outC, 'result_v2.json');
  if (r3.status !== 0 || !existsSync(fC)) {
    record('X-confirmed', false, `확정 내보내기 rc=${r3.status} ${r3.stderr.slice(0, 400)}`);
    return;
  }
  const doc = JSON.parse(readFileSync(fC, 'utf8'));
  const summaryTxt = readFileSync(join(outC, 'result_v2_요약.txt'), 'utf8');
  record('X-confirmed', doc.status === '확정' && doc.rehearsal === true && doc.items.length === 70, `rc=0 · 상태 ${doc.status} · rehearsal ${doc.rehearsal} · 건수 ${doc.items.length} · 합계 가결 ${doc.summary.passed} 부결 ${doc.summary.failed} · ${(r3.stdout.match(/읽기 \d+ms · 전체 \d+ms/) ?? [''])[0]}`);
  // 기대 집계 대조(건마다)
  for (const ag of AGENDAS) {
    const its = doc.items.filter((i) => i.agenda === ag.no);
    const e = exp[ag.no];
    const diffs = [];
    its.forEach((it, idx) => {
      const k = idx + 1;
      if (it.yes !== e.yes[k] || it.nay !== e.nay[k]) diffs.push(`${it.no} ${it.yes}/${it.nay}≠${e.yes[k]}/${e.nay[k]}`);
    });
    const a = doc.agendas.find((x) => x.no === ag.no);
    const vX = its[1]?.verdict;
    const vZ = its[2]?.verdict;
    const vF = its[3]?.verdict;
    record(`X${ag.no}-tally`, diffs.length === 0, `의제${ag.no} 건별 찬/반 = 기대(내가 보낸 표 + 4-3 규칙) ${diffs.length ? `불일치 ${diffs.slice(0, 4).join(' · ')}` : `${its.length}건 전부 일치`}`);
    record(`X${ag.no}-boundary`, a.threshold === its[1].yes && vX === '가결' && its[2].yes === a.threshold - 1 && vZ === '부결' && vF === '부결', `출석 ${a.present} · 기준 ${a.threshold} · ${its[1].no} 찬성 ${its[1].yes}=기준 → ${vX} · ${its[2].no} 찬성 ${its[2].yes}=기준−1 → ${vZ} · ${its[3].no} 찬성 ${its[3].yes} → ${vF}`);
  }
  // DB 응답 수 = 유효 + 뺀 표 (요약 txt 「휴대폰 제출 N → 유효 V · 뺀 표 E」)
  for (const ag of AGENDAS) {
    const data = await responsesOf(ballots[ag.no].id);
    const n = (data?.responses ?? []).length;
    const m = new RegExp(`\\[의제 ${ag.no}\\][\\s\\S]*?휴대폰 제출 (\\d+) → 유효 (\\d+) · 뺀 표 (\\d+)`).exec(summaryTxt);
    const [sys, valid, ex] = m ? m.slice(1).map(Number) : [null, null, null];
    record(`X${ag.no}-count`, sys === n && valid === exp[ag.no].valid && valid + ex === n, `DB 응답 ${n} = 요약 휴대폰 제출 ${sys} → 유효 ${valid}(기대 ${exp[ag.no].valid}) + 뺀 표 ${ex}`);
  }
  const m3 = /\[의제 3\][\s\S]*?직접 입력\(명단에 없는 조·이름\) (\d+)건 — 유효 (\d+) · 검증자 확인 목록 (\d+)/.exec(summaryTxt);
  const okManual = m3 && m3[1] === '2' && m3[2] === '1' && m3[3] === '1' && summaryTxt.includes(`유효: ${VOTER.e.team} ${VOTER.e.name}`) && summaryTxt.includes(`확인 목록: ${VOTER.e2.team} ${VOTER.e2.name}`);
  record('X-manual', !!okManual, `요약 의제3 직접 입력 ${m3 ? `${m3[1]}건 — 유효 ${m3[2]} · 확인 목록 ${m3[3]}` : '줄 없음'} · ${VOTER.e.name}=유효 · ${VOTER.e2.name}=확인 목록(출석부 없음)`);
  const nameless = /\[의제 1\][\s\S]*?뺀 표: 이름 없음/.test(summaryTxt);
  record('X-nameless', nameless, `무기명 1건 → 요약 의제1 「뺀 표: 이름 없음」 ${nameless}`);
  // 검사 · 해시
  const rv = spawnSync(process.execPath, [join(ROOT, 'scripts/export-result-v2.mjs'), '--verify', fC], { cwd: ROOT, encoding: 'utf8' });
  const shaLine = readFileSync(`${fC}.sha256`, 'utf8').trim();
  const shaOk = shaLine.split(/\s+/)[0] === sha(fC) && /\s\sresult_v2\.json$/.test(shaLine);
  const noNames = !/시험(가람|기획|직접|동명)/.test(readFileSync(fC, 'utf8'));
  record('X-verify', rv.status === 0 && shaOk && noNames, `--verify rc=${rv.status} 「${rv.stdout.trim().slice(0, 60)}…」 · .sha256 곁 파일 = 본문 sha256 ${shaOk} · result_v2.json 에 이름 없음 ${noNames}`);
  const keepSha = sha(fC);
  const keepMtime = statSync(fC).mtimeMs;

  // ④ 고의로 출석을 작게 — 새 폴더(원자료 파일로) → 파일 없음
  const smallP = exp[1].valid - 1;
  const negDir = join(OUT_DIR, 'export_neg_present');
  const rN = runExport(['--config', writeCfg('config_neg_present.json', cfg({ 1: { present: smallP } })), '--out', negDir, '--source', 'file', '--raw-dir', join(outC, 'raw')], 'neg_present');
  record('X-neg-present', rN.status === 2 && !existsSync(join(negDir, 'result_v2.json')) && /휴대폰 유효표 \d+ \+ 서면 0 > 출석/.test(rN.stderr), `의제1 출석 ${smallP}(유효 ${exp[1].valid}보다 1 적게) → rc=${rN.status} · 새 폴더에 result_v2.json ${existsSync(join(negDir, 'result_v2.json')) ? '있음' : '없음'} · 「${(rN.stderr.match(/의제 1: 휴대폰[^\n]*/) ?? [''])[0].slice(0, 70)}」`);
  // ⑤ 출석부 사람 수 < 출석 — 새 폴더 → 파일 없음
  const negAtt = join(OUT_DIR, 'export_neg_attendance');
  const rA = runExport(['--config', writeCfg('config_neg_attendance.json', cfg({ 1: { attendance_file: 'attendance_직접입력만.json' } })), '--out', negAtt, '--source', 'file', '--raw-dir', join(outC, 'raw')], 'neg_attendance');
  record('X-neg-attendance', rA.status === 2 && !existsSync(join(negAtt, 'result_v2.json')) && /출석부 1명 < 출석/.test(rA.stderr), `출석부 = 직접 입력자 1명만 → rc=${rA.status} · 파일 없음 · 「출석부 1명 < 출석」 ${/출석부 1명 < 출석/.test(rA.stderr)}`);
  // ⑥ 같은 폴더에 실패 실행 → 기존 확정 파일 그대로
  const rK = runExport(['--config', join(OUT_DIR, 'config_neg_present.json'), '--out', outC, '--source', 'file', '--raw-dir', join(outC, 'raw')], 'neg_present_same_dir');
  record('X-neg-keep', rK.status === 2 && sha(fC) === keepSha && statSync(fC).mtimeMs === keepMtime, `확정 폴더에 출석 작은 실행 → rc=${rK.status} · 기존 result_v2.json sha256 · 수정 시각 그대로 ${sha(fC) === keepSha && statSync(fC).mtimeMs === keepMtime}`);
}

// ── 합본(긴 변 ≤1600 JPEG) ──────────────────────────────────
async function contactSheet() {
  const wide = ['M_1_의제1_QR.png', 'M_2_의제2_QR.png', 'M_04_목록_열림3장.png'];
  const tall = ['C_a_00_본인확인.png', 'C_a_01_1of28.png', 'C_a_02_요약.png', 'C_a_03_제출완료.png', 'C_b_01_제출완료.png', 'C_c_01_1건미응답_막힘.png', 'C_c_02_보완후_제출완료.png', 'C_d_다른기기_같은이름_거부.png', 'C_e_00_직접입력.png', 'C_e_01_제출완료.png', 'C_f_01_동명이인_둘째_결과.png', 'C_h_두번누름_제출완료.png', 'C_g_명단0행_막힘.png', 'M_05_잠정결과_관찰.png'];
  const cell = (f, w, h) =>
    existsSync(join(SHOTS, f))
      ? `<figure style="margin:0;width:${w}px"><img src="${pathToFileURL(join(SHOTS, f)).href}" style="width:${w}px;height:${h}px;object-fit:cover;object-position:top;border:1px solid #999"><figcaption style="font:11px sans-serif;height:14px;overflow:hidden">${f.replace('.png', '')}</figcaption></figure>`
      : '';
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:6px;background:#fff">
  <div style="display:flex;gap:6px;flex-wrap:wrap">${wide.map((f) => cell(f, 524, 328)).join('')}</div>
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${tall.map((f) => cell(f, 189, 410)).join('')}</div></body>`;
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
  const f = join(OUT_DIR, '_sheet.html');
  writeFileSync(f, html);
  await page.goto(pathToFileURL(f).href);
  await page.waitForTimeout(1500);
  const h = await page.evaluate(() => document.body.scrollHeight + 12);
  await page.setViewportSize({ width: 1600, height: Math.min(1600, h) });
  await page.screenshot({ path: join(OUT_DIR, 'shots_합본.jpg'), type: 'jpeg', quality: 80 });
}

let crashed = null;
try {
  await main();
} catch (e) {
  crashed = String(e?.stack ?? e).slice(0, 800);
  record('crash', false, crashed);
}
await contactSheet().catch((e) => console.error('합본 실패', e?.message));
await browser.close();

const errs = Object.entries(pageErrors).filter(([, v]) => v.length);
record('pageerror', errs.length === 0, errs.length ? errs.map(([k, v]) => `${k}: ${v[0]}`).join(' | ') : '페이지 오류 0');
const hosts = [...new Set(Object.values(netLog).flat().map((x) => x.host))];
record('hosts', hosts.every((h) => h === PROD_HOST), `브라우저 RPC 호스트 ${hosts.join(', ')}`);
const fails = results.filter((r) => !r.ok);
const out = { base: BASE, expectCommit: EXPECT_COMMIT, slug: seed.slug, miniSlug: seed.miniSlug, finishedAt: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19) + '+09:00', ballots: manifest.ballots, miniBallot: manifest.miniBallot, pass: results.filter((r) => r.kind === 'PASS').length, fail: fails.length, results };
writeFileSync(join(OUT_DIR, 'results-1114.json'), JSON.stringify(out, null, 2));
const md = [`# 11/14 전체회의 의결 드라이런 E2E 결과`, '', `- 대상 ${BASE} (기대 커밋 ${EXPECT_COMMIT || '검사 안 함'})`, `- 세션 ${seed.slug} · 미니 ${seed.miniSlug}`, `- 끝난 시각 ${out.finishedAt}`, `- PASS ${out.pass} · FAIL ${out.fail} · LIMIT ${results.filter((r) => r.kind === 'LIMIT').length} · NOTE ${results.filter((r) => r.kind === 'NOTE').length}`, '', ...results.map((r) => `- ${r.kind} ${r.id} — ${r.detail}`), ''].join('\n');
writeFileSync(join(OUT_DIR, 'results-1114.md'), md);
console.log(`\nPASS ${out.pass} · FAIL ${out.fail} → ${join(OUT_DIR, 'results-1114.md')}`);
process.exit(fails.length ? 1 : 0);
