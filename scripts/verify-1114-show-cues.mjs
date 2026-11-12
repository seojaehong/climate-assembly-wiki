/**
 * 11/14 표출 화면 알림 리허설 — 미리보기 배포 + 운영 DB 드라이런 세션(zz-dryrun-1114-…-s)에서
 * 남은 시간 띠(5분 · 3분 · 1분 · 30초) · 10→1 카운트다운 · 종료 띠가 진행(1) · 실시간 순환(4) · 영상(V) 화면에
 * 뜨는지, PageDown 으로 화면을 오가도 띠가 겹치거나 빠지거나 다시 뜨지 않는지 실제 데이터 경로로 본다.
 *
 * 사용:
 *   PLAYWRIGHT_MODULE=file:///C:/.../node_modules/playwright/index.mjs \
 *   BASE_URL=https://<미리보기> EXPECT_COMMIT=<sha> SEED_FILE=C:/path/seed1114.json ROSTER_FILE=C:/path/roster.json \
 *   OUT_DIR=C:/path/out [MIN=6] [PRESENT=174] node scripts/verify-1114-show-cues.mjs --confirm-dryrun-session
 *   --smoke-demo : 투표지를 만들지 않고 /show?demo=1 로 감시 · 캡처만 시험(DB 를 읽지도 쓰지도 않는다)
 *
 * SEED_FILE.show = { slug: 'zz-dryrun-1114-<시각>-s', team: [이름, 운영팀 코드] } — 그 세션에 명단(ROSTER_FILE)이 적재돼 있어야 한다.
 * 하는 일: /mod(운영팀 코드 · 세션 slug 일치 확인) → 의제1 투표지(19건) 초안 · 투표 시작
 *   → /show?t=…&present=…&min=… 네 창(1 · 4 · V · PgDn 순환 — 창마다 저장소 따로) 동시에 Space
 *   → /b 화면 투표 3명 + anon RPC 실명 투표(명단 가상 시민)를 시간에 걸쳐 → 띠 · 카운트다운 · 종료 캡처
 *   → /mod [투표 마감] → 띠가 사라지고 「투표 마감」.
 * 결과: OUT_DIR/show_cues/results-show.json · results-show.md · shots/*.jpg · 합본_표출알림.jpg(긴 변 ≤1600). FAIL 이 있으면 종료 코드 1.
 * 코드 · 토큰은 출력하지 않는다.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SMOKE = argv.includes('--smoke-demo');
const CONFIRMED = argv.includes('--confirm-dryrun-session');
const BASE = (process.env.BASE_URL ?? '').replace(/\/+$/, '');
const EXPECT_COMMIT = process.env.EXPECT_COMMIT ?? '';
const OUT = join(process.env.OUT_DIR ?? '', 'show_cues');
const SHOTS = join(OUT, 'shots');
const MIN = Number(process.env.MIN ?? 6);
const PRESENT = Number(process.env.PRESENT ?? 174);
const PREFIX = 'zz-dryrun-1114-';
const PROD_HOST = 'pleyuknjnprsckssxvrh.supabase.co';
const fail = (m) => {
  console.error(m);
  process.exit(2);
};
if (!BASE || !process.env.OUT_DIR) fail('BASE_URL, OUT_DIR 가 필요합니다(머리말).');
if (!SMOKE && !CONFIRMED) fail('드라이런 세션인지 확인했으면 --confirm-dryrun-session (DB 없이 시험만 하려면 --smoke-demo).');
if (!(MIN >= 6)) fail('MIN 은 6 이상(5분 띠가 뜨려면).');
let seed = null;
let roster = [];
if (!SMOKE) {
  if (!process.env.SEED_FILE || !process.env.ROSTER_FILE) fail('SEED_FILE, ROSTER_FILE 이 필요합니다.');
  seed = JSON.parse(readFileSync(process.env.SEED_FILE, 'utf8'));
  const s = String(seed.show?.slug ?? '');
  if (!s.startsWith(PREFIX) || !s.endsWith('-s') || !/^\d{6}$/.test(seed.show?.team?.[1] ?? '')) fail(`SEED_FILE.show 모양 오류(slug 는 ${PREFIX}…-s)`);
  roster = JSON.parse(readFileSync(process.env.ROSTER_FILE, 'utf8'));
}
mkdirSync(SHOTS, { recursive: true });

const SUPA_SRC = readFileSync(resolve(ROOT, 'src/lib/supabase.ts'), 'utf8');
const URL_BASE = /FALLBACK_URL = '([^']+)'/.exec(SUPA_SRC)?.[1];
const ANON = /FALLBACK_ANON =\s*'([^']+)'/.exec(SUPA_SRC)?.[1];
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
  return { ok: res.ok, status: res.status, data, message: res.ok ? '' : String(data?.message ?? text).slice(0, 160) };
}

const results = [];
function record(id, ok, detail, kind = ok ? 'PASS' : 'FAIL') {
  results.push({ id, ok: !!ok, kind, detail: String(detail ?? '') });
  console.log(`${kind.padEnd(5)} ${id} — ${detail}`);
}
const note = (id, d) => record(id, true, d, 'NOTE');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 19);

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true });
const pageErrors = {};
const netLog = {};
async function newCtx(name, opt) {
  const ctx = await browser.newContext({ locale: 'ko-KR', ...opt });
  const page = await ctx.newPage();
  pageErrors[name] = [];
  netLog[name] = [];
  page.on('pageerror', (e) => pageErrors[name].push(String(e.message).slice(0, 200)));
  page.on('request', (r) => {
    const m = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(r.url());
    if (m) netLog[name].push({ fn: m[1], host: new URL(r.url()).host });
  });
  return { ctx, page, name };
}

// ── 운영 콘솔: 투표지 만들기 · 마감 ───────────────────────────
const TITLE = '전체회의 의결 의제1 기업 온실가스 감축 촉진';
let O = null;
async function createBallot() {
  O = await newCtx('ops', { viewport: { width: 1440, height: 900 } });
  const page = O.page;
  await page.goto(`${BASE}/mod?code=${encodeURIComponent(seed.show.team[1])}`, { waitUntil: 'domcontentloaded' });
  await page.locator('#mod-tab-vote').waitFor({ timeout: 60000 });
  const slug = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('climate_vote_mod_session_v1') ?? 'null')?.sessionSlug ?? null;
    } catch {
      return null;
    }
  });
  if (slug !== seed.show.slug) {
    await browser.close();
    fail(`로그인한 세션이 리허설 세션이 아닙니다(${slug}) — 멈춤`);
  }
  record('ops-login', true, `운영 콘솔 로그인 세션 ${slug}`);
  await page.locator('#mod-tab-vote').click();
  await page.getByRole('button', { name: /새 다의제 투표/ }).click();
  await page.locator('input[placeholder^="예: 폐회 일괄 투표"]').fill(TITLE);
  await page.locator('[data-testid=ballot-bulk]').fill(readFileSync(join(ROOT, 'docs/1114-paste/agenda1.txt'), 'utf8'));
  await page.locator('[data-testid=ballot-bulk-apply]').click();
  await page.waitForFunction(() => document.querySelectorAll('input[placeholder="의제 문장"]').length === 19, null, { timeout: 10000 });
  const whole = page.getByRole('button', { name: '세션 전체', exact: true });
  if (await whole.count()) await whole.click();
  await page.getByRole('button', { name: '초안 만들기', exact: true }).click();
  const card = page.locator('[data-ballot-id]', { hasText: TITLE }).first();
  await card.waitFor({ timeout: 20000 });
  const id = await card.getAttribute('data-ballot-id');
  await card.getByRole('button', { name: '투표 시작', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor({ timeout: 10000 });
  await dlg.getByRole('button', { name: '투표 시작', exact: true }).click();
  const qr = page.locator('[data-testid=qr-fullscreen]');
  await qr.waitFor({ timeout: 20000 });
  const token = /[?&]t=([0-9a-f]{32})/.exec((await qr.getAttribute('data-ballot-url')) ?? '')?.[1] ?? null;
  await page.keyboard.press('Escape');
  record('ballot-open', !!token && !!id, `투표지 「${TITLE}」 19건 · 투표 시작 · 토큰 ${token ? '있음' : '없음'}`);
  return { id, token };
}
async function closeBallot() {
  const card = O.page.locator('[data-ballot-id]', { hasText: TITLE }).first();
  await card.getByRole('button', { name: '투표 마감', exact: true }).click();
  const dlg = O.page.getByRole('dialog');
  await dlg.waitFor({ timeout: 10000 });
  await dlg.getByRole('button', { name: '투표 마감', exact: true }).click();
}

// ── 투표: /b 화면 3명 + anon RPC ──────────────────────────────
const YES = 2;
const NAY = 1;
async function uiVote(token, voter, i) {
  const V = await newCtx(`b${i}`, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = V.page;
  try {
    await page.goto(`${BASE}/b?t=${token}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-testid=pager-start]').waitFor({ timeout: 40000 });
    await page.locator(`[data-team="${voter.team}"]`).click();
    await page.locator(`[data-testid=voter-picker] [data-name="${voter.name}"]`).click();
    await page.locator('[data-testid=pager-start]').click();
    await page.locator('[data-testid=voter-confirm]').waitFor({ timeout: 20000 });
    await page.locator('[data-testid=pager-confirm-yes]').click();
    await page.locator('[data-testid=pager-position]').waitFor({ timeout: 20000 });
    for (let g = 0; g < 25; g++) {
      if (await page.locator('[data-testid=pager-counts]').count()) break;
      const p = (await page.locator('[data-testid=pager-position]').innerText().catch(() => '')).trim();
      await page.locator('[data-testid=pager-yes]').click();
      await page.waitForFunction((q) => !!document.querySelector('[data-testid=pager-counts]') || document.querySelector('[data-testid=pager-position]')?.textContent.trim() !== q, p, { timeout: 10000 });
      await page.waitForTimeout(600);
    }
    await page.locator('[data-testid=pager-submit]').click();
    await page.locator('[data-testid=named-done]').or(page.getByRole('alert')).first().waitFor({ timeout: 30000 });
    const done = (await page.locator('[data-testid=named-done]').count()) > 0;
    record(`b-ui-${i}`, done, `/b 화면 투표 ${voter.team} ${voter.name} → 완료 ${done} (${kst()})`);
    return done;
  } catch (e) {
    record(`b-ui-${i}`, false, String(e?.message ?? e).slice(0, 200));
    return false;
  } finally {
    await V.ctx.close();
  }
}

// ── 표출 화면 감시 ───────────────────────────────────────────
const PROBE = () => {
  const els = [...document.querySelectorAll('[data-testid=show-cue]')];
  const view = document.querySelector('[data-testid^=rot-panel-]') ? 'rotate' : document.querySelector('[data-testid=show-video-cell]') ? 'video' : 'live';
  const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
  // 띠(5분 · 3분 · 1분 · 30초 · 종료)가 다른 글자나 QR 을 덮는지 — 글자 줄 상자 · 그림 상자와 겹친 면적으로 잰다.
  const band = els.find((e) => e.dataset.kind === 'notice' || e.dataset.kind === 'ended');
  let ov = null;
  if (band) {
    const b = band.getBoundingClientRect();
    const hit = (q) => Math.min(b.right, q.right) - Math.max(b.left, q.left) > 2 && Math.min(b.bottom, q.bottom) - Math.max(b.top, q.top) > 2;
    ov = [];
    const stage = document.querySelector('[data-testid=show-stage]') ?? document.body;
    const w = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (!t.textContent.trim() || band.contains(t)) continue;
      const rg = document.createRange();
      rg.selectNodeContents(t);
      if ([...rg.getClientRects()].some(hit)) ov.push(t.textContent.trim().slice(0, 16));
    }
    for (const im of stage.querySelectorAll('img')) if (hit(im.getBoundingClientRect())) ov.push(`[그림 ${im.alt}]`);
  }
  return {
    ov,
    n: els.length,
    cues: els.map((e) => (e.dataset.kind === 'notice' ? `notice-${e.dataset.sec}` : e.dataset.kind === 'count' ? `count-${e.dataset.n}` : e.dataset.kind)),
    view,
    clock: txt('[data-testid=show-clock]') ?? txt('[data-testid=rot-single-clock]'),
    status: txt('[data-testid=show-status]'),
    submitted: txt('[data-testid=show-submitted]') ?? txt('[data-testid=rot-single-submitted]'),
  };
};
const MARKS = [300, 180, 60, 30];
const SHOT_KEYS = ['notice-300', 'notice-180', 'notice-60', 'notice-30', 'count-10', 'count-3', 'ended'];
const SHOT_DELAY = { 'count-10': 120, 'count-3': 120 };
const VIEWS = [
  { L: '1', key: null, expect: 'live', label: '1 진행' },
  { L: '4', key: 'Digit4', expect: 'rotate', label: '4 실시간 순환' },
  { L: 'V', key: 'KeyV', expect: 'video', label: 'V 영상' },
  { L: 'C', key: null, expect: null, label: 'PgDn 순환' },
];
let T0 = 0;
let stopAll = false;
const watchers = {};
async function watch(W) {
  W.polls = [];
  W.first = {};
  W.shots = [];
  while (!stopAll) {
    const s = await W.page.evaluate(PROBE).catch(() => null);
    if (s) {
      s.t = Date.now() - T0;
      W.polls.push(s);
      for (const k of s.cues) {
        if (W.first[k] != null) continue;
        W.first[k] = { t: s.t, clock: s.clock, view: s.view };
        if (W.L !== 'C' && SHOT_KEYS.includes(k)) {
          const file = `${W.L}_${k}.jpg`;
          W.shots.push(sleep(SHOT_DELAY[k] ?? 1600).then(() => W.page.screenshot({ path: join(SHOTS, file), type: 'jpeg', quality: 72 })).catch(() => undefined));
        }
      }
    }
    await sleep(200);
  }
}
const secOf = (clock) => {
  const m = /^(\d+):(\d{2})$/.exec(clock ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** 그 열쇠가 보인 폴 구간들(연속 폴 묶음). */
function episodes(polls, key) {
  const out = [];
  let cur = null;
  for (const p of polls) {
    if (p.cues.includes(key)) {
      if (!cur) cur = { from: p.t, to: p.t, views: new Set() };
      cur.to = p.t;
      cur.views.add(p.view);
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function main() {
  if (!SMOKE) {
    const rev = await fetch(`${BASE}/deployment-revision.json`).then((r) => r.json()).catch(() => null);
    record('deploy', !EXPECT_COMMIT || rev?.sourceCommit === EXPECT_COMMIT, `미리보기 sourceCommit ${rev?.sourceCommit ?? '못 읽음'} (기대 ${EXPECT_COMMIT || '검사 안 함'})`);
  }
  const ballot = SMOKE ? null : await createBallot();
  const showUrl = SMOKE ? `${BASE}/show?demo=1&speed=${process.env.SPEED ?? 30}` : `${BASE}/show?t=${ballot.token}&present=${PRESENT}&min=${MIN}`;
  for (const v of VIEWS) {
    watchers[v.L] = { ...v, ...(await newCtx(`show${v.L}`, { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })) };
  }
  await Promise.all(
    Object.values(watchers).map(async (W) => {
      await W.page.goto(showUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await W.page.locator('[data-testid=show-clock]').waitFor({ timeout: 60000 });
      if (W.key) await W.page.keyboard.press(W.key);
    }),
  );
  await sleep(1500);
  const before = await Promise.all(Object.values(watchers).map((W) => W.page.evaluate(PROBE)));
  T0 = Date.now();
  await Promise.all(Object.values(watchers).map((W) => W.page.keyboard.press('Space')));
  console.log(`타이머 시작 ${kst()} (KST) · ${showUrl.replace(/t=[0-9a-f]{32}/, 't=<토큰>')}`);
  const loops = Object.values(watchers).map((W) => watch(W));
  // PgDn 순환 창 — 1.5초마다 진행 → 실시간 → 영상 → 진행
  const cycler = (async () => {
    while (!stopAll) {
      await sleep(1500);
      if (!stopAll) await watchers.C.page.keyboard.press('PageDown').catch(() => undefined);
    }
  })();
  await sleep(3000);
  const after = await Promise.all(Object.values(watchers).map((W) => W.page.evaluate(PROBE)));
  Object.values(watchers).forEach((W, i) => {
    const okView = !W.expect || before[i].view === W.expect;
    const runs = before[i].clock != null && after[i].clock != null && before[i].clock !== after[i].clock;
    // 실시간 순환(4)은 시계 칸이 있는 판이 돌아올 때만 시계를 읽을 수 있다 — 화면만 보고, 도는지는 띠 판정이 본다.
    record(`${W.L}-start`, okView && (runs || W.L === 'C' || W.L === '4'), `${W.label}: 화면 ${before[i].view} · 시작 전 ${before[i].clock ?? '(시계 칸 없는 판)'} → 3초 뒤 ${after[i].clock ?? '(시계 칸 없는 판)'}`);
  });

  // 투표 — 시간에 걸쳐(마지막 표는 끝나기 약 15초 전)
  let rpcOk = 0;
  let rpcFail = 0;
  let uiOk = 0;
  const voting = [];
  if (!SMOKE) {
    const items = [...((await rpc('ballot_get', { p_token: ballot.token })).data?.items ?? [])].sort((a, b) => a.ordinal - b.ordinal);
    record('items', items.length === 19, `ballot_get 문항 ${items.length}개`);
    const teams = [...new Set(roster.map((r) => r.team))];
    const pick = (team) => roster.find((r) => r.team === team && !/^시험(동명|직접)/.test(r.name));
    const UI = [teams[1], teams[Math.floor(teams.length / 2)], teams[teams.length - 2]].map(pick).filter(Boolean);
    const uiNames = new Set(UI.map((v) => v.name));
    const pool = roster.filter((r) => !uiNames.has(r.name) && !/^시험(동명|직접)/.test(r.name)).slice(0, 140);
    const span = (MIN * 60 - 20) * 1000;
    voting.push(
      (async () => {
        for (let i = 0; i < pool.length; i++) {
          const due = T0 + 5000 + Math.round((i * (span - 5000)) / pool.length);
          if (due > Date.now()) await sleep(due - Date.now());
          const v = pool[i];
          const ans = Object.fromEntries(items.map((it, k) => [it.id, k === 1 && i % 9 === 0 ? NAY : YES]));
          const r = await rpc('ballot_submit_named', { p_token: ballot.token, p_client_id: `dryrun1114-show-${randomUUID()}`, p_answers: ans, p_voter_team: v.team, p_voter_name: v.name });
          if (r.ok) rpcOk++;
          else rpcFail++;
        }
      })(),
    );
    UI.forEach((v, i) =>
      voting.push(
        (async () => {
          await sleep([15000, 110000, 220000][i] ?? 0);
          if (await uiVote(ballot.token, v, i + 1)) uiOk++;
        })(),
      ),
    );
  }

  // 종료 띠까지 기다림
  const limitMs = (SMOKE ? 600 : MIN * 60 + 90) * 1000;
  while (Date.now() - T0 < limitMs && watchers['1'].first.ended == null) await sleep(500);
  await sleep(3500);
  await Promise.all(voting);
  if (!SMOKE) {
    record('votes', rpcFail === 0 && uiOk === 3, `RPC 실명 투표 ${rpcOk}/${rpcOk + rpcFail} · /b 화면 투표 ${uiOk}/3`);
    await sleep(4000);
    const lc = await rpc('ballot_live_counts', { p_token: ballot.token });
    const showSub = Object.fromEntries(['1', '4', 'V'].map((L) => [L, watchers[L].polls.at(-1)?.submitted ?? null]));
    const want = String(rpcOk + uiOk);
    record('submitted', lc.data?.submitted === rpcOk + uiOk && ['1', 'V'].every((L) => (showSub[L] ?? '').replace(/\D/g, '') === want), `DB 제출 ${lc.data?.submitted} · 기대 ${want} · 화면 제출 수 1=${showSub['1']} 4=${showSub['4']} V=${showSub.V} (상태 ${lc.data?.status})`);
    await closeBallot();
    const tClose = Date.now() - T0;
    // 마감 뒤 — 띠가 사라지고 상태 「투표 마감」
    const okClosed = {};
    for (let g = 0; g < 40; g++) {
      await sleep(500);
      for (const L of ['1', '4', 'V', 'C']) {
        const last = watchers[L].polls.at(-1);
        if (last && last.t > tClose && last.n === 0 && okClosed[L] == null) okClosed[L] = last;
      }
      if (Object.keys(okClosed).length === 4) break;
    }
    await sleep(800);
    await Promise.all(['1', '4', 'V'].map((L) => watchers[L].page.screenshot({ path: join(SHOTS, `${L}_closed.jpg`), type: 'jpeg', quality: 72 })));
    for (const L of ['1', '4', 'V', 'C']) {
      const s = okClosed[L];
      record(`${L}-closed`, !!s && (L !== '1' || /마감/.test(s.status ?? '')), s ? `[투표 마감] ${((s.t - tClose) / 1000).toFixed(1)}초 뒤 띠 없음 · 상태 「${s.status ?? '-'}」 · 시계 ${s.clock}` : '마감 뒤 20초 안에 띠가 사라지지 않음');
    }
  }
  stopAll = true;
  await cycler;
  await Promise.all(loops);
  await Promise.all(Object.values(watchers).flatMap((W) => W.shots));

  // ── 판정 ──
  for (const W of Object.values(watchers)) {
    const P = W.polls.filter((p) => SMOKE || !watchers.C || true);
    const maxN = Math.max(0, ...P.map((p) => p.n));
    const views = [...new Set(P.map((p) => p.view))];
    record(`${W.L}-one`, maxN <= 1 && (!W.expect || (views.length === 1 && views[0] === W.expect)), `${W.label}: 폴 ${P.length}회 · 한 번에 뜬 띠 최대 ${maxN}개 · 화면 ${views.join('/')}`);
    for (const m of MARKS) {
      const k = `notice-${m}`;
      const ep = episodes(P, k);
      const f = W.first[k];
      const dur = ep[0] ? (ep[0].to - ep[0].from) / 1000 : 0;
      const cs = secOf(f?.clock);
      const clockOk = cs == null || Math.abs(cs - m) <= 1;
      const viewOk = W.L !== 'C' || (ep[0]?.views.size ?? 0) >= 2;
      record(`${W.L}-${k}`, ep.length === 1 && dur >= 4.4 && dur <= 6.6 && clockOk && viewOk, `${W.label} ${m >= 60 ? `${m / 60}분` : `${m}초`} 띠: 뜬 횟수 ${ep.length} · 보인 시간 ${dur.toFixed(1)}초 · 처음 본 시계 ${f?.clock ?? '-'}${W.L === 'C' ? ` · 그동안 지난 화면 ${[...(ep[0]?.views ?? [])].join('/')}` : ''}`);
    }
    const seq = P.flatMap((p) => p.cues.filter((c) => c.startsWith('count-')).map((c) => Number(c.slice(6))));
    const seen = [...new Set(seq)];
    const mono = seq.every((n, i) => i === 0 || n <= seq[i - 1]);
    const eachOnce = seen.every((n) => episodes(P, `count-${n}`).length === 1);
    const cViews = [...new Set(P.filter((p) => p.cues.some((c) => c.startsWith('count-'))).map((p) => p.view))];
    record(`${W.L}-count`, seen.length === 10 && seen.every((n) => n >= 1 && n <= 10) && mono && eachOnce, `${W.label} 카운트다운: 본 숫자 ${seen.join(',')} · 줄어드는 순서 ${mono} · 숫자마다 한 번 ${eachOnce}${W.L === 'C' ? ` · 화면 ${cViews.join('/')}` : ''}`);
    const ee = episodes(P, 'ended');
    record(`${W.L}-ended`, ee.length === 1, `${W.label} 종료 띠: 뜬 횟수 ${ee.length} · 처음 본 시계 ${W.first.ended?.clock ?? '-'}`);
    // 겹침 — 뜬 뒤 1.5초(등장 움직임 1.4초)가 지난 폴은 FAIL, 그 안은 NOTE
    const bandKey = (p) => p.cues.find((c) => c.startsWith('notice-') || c === 'ended');
    const settled = [];
    const entering = [];
    for (const p of P) {
      const k = bandKey(p);
      if (!k || !p.ov?.length) continue;
      (p.t - (W.first[k]?.t ?? p.t) >= 1500 ? settled : entering).push(`${k}@${p.view}:${p.ov.join('/')}`);
    }
    record(`${W.L}-overlap`, settled.length === 0, `${W.label} 띠가 글자·QR 을 덮은 폴(자리 잡은 뒤) ${settled.length}회${settled.length ? ` — ${[...new Set(settled)].slice(0, 4).join(' | ')}` : ''}`);
    if (entering.length) note(`${W.L}-overlap-entering`, `${W.label} 등장 움직임 1.5초 안 겹침 ${entering.length}회 — ${[...new Set(entering)].slice(0, 3).join(' | ')}`);
    const extra = Object.keys(W.first).filter((k) => !/^notice-(300|180|60|30)$|^count-([1-9]|10)$|^ended$/.test(k));
    record(`${W.L}-no-extra`, extra.length === 0, `${W.label} 그 밖의 띠 ${extra.length ? extra.join(',') : '없음'}`);
  }
  const t300 = ['1', '4', 'V'].map((L) => watchers[L].first['notice-300']?.t ?? NaN);
  note('sync', `5분 띠 처음 본 때(시작 뒤 초) 1=${(t300[0] / 1000).toFixed(1)} 4=${(t300[1] / 1000).toFixed(1)} V=${(t300[2] / 1000).toFixed(1)} — 세 창 따로 시작`);
  const showFns = [...new Set(['1', '4', 'V', 'C'].flatMap((L) => netLog[`show${L}`].map((x) => `${x.fn}@${x.host === PROD_HOST ? 'prod' : x.host}`)))];
  record('show-rpc', SMOKE ? showFns.length === 0 : showFns.every((f) => f === 'ballot_live_counts@prod'), `표출 화면이 부른 RPC ${showFns.join(', ') || '없음'}`);
}

async function contactSheet() {
  const rows = [
    ['notice-300', '5분 띠'],
    ['notice-180', '3분 띠'],
    ['notice-60', '1분 띠'],
    ['notice-30', '30초 띠'],
    ['count-10', '카운트다운 10'],
    ['count-3', '카운트다운 3'],
    ['ended', '종료 띠'],
    ...(SMOKE ? [] : [['closed', '[투표 마감] 뒤']]),
  ];
  const cols = VIEWS.filter((v) => v.L !== 'C');
  const w = 348;
  const h = 196;
  const cell = (f, label) =>
    `<div style="position:relative;width:${w}px;height:${h}px;background:#222"><img src="${pathToFileURL(join(SHOTS, f)).href}" style="width:${w}px;height:${h}px;display:block" onerror="this.remove()"><span style="position:absolute;left:0;top:0;background:#fff;color:#000;font:bold 12px sans-serif;padding:2px 5px">${label}</span></div>`;
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:4px;background:#fff">
  <div style="display:grid;grid-template-columns:repeat(${cols.length},${w}px);gap:4px">
  ${cols.map((c) => `<div style="font:bold 14px sans-serif;height:18px">${c.label}</div>`).join('')}
  ${rows.map(([k, lab]) => cols.map((c) => cell(`${c.L}_${k}.jpg`, `${lab} · ${c.L}`)).join('')).join('')}
  </div></body>`;
  const f = join(OUT, '_sheet.html');
  writeFileSync(f, html);
  const page = await (await browser.newContext({ viewport: { width: cols.length * (w + 4) + 8, height: 1600 } })).newPage();
  await page.goto(pathToFileURL(f).href);
  await page.waitForTimeout(1200);
  const hh = await page.evaluate(() => document.body.scrollHeight + 8);
  await page.setViewportSize({ width: cols.length * (w + 4) + 8, height: Math.min(1600, hh) });
  const out = join(OUT, '합본_표출알림.jpg');
  for (const q of [80, 65, 50]) {
    await page.screenshot({ path: out, type: 'jpeg', quality: q });
    if (statSync(out).size < 290 * 1024) break;
  }
}

let crashed = null;
try {
  await main();
} catch (e) {
  crashed = String(e?.stack ?? e).slice(0, 600);
  record('crash', false, crashed);
  stopAll = true;
}
await contactSheet().catch((e) => console.error('합본 실패', e?.message));
await browser.close();
const errs = Object.entries(pageErrors).filter(([, v]) => v.length);
record('pageerror', errs.length === 0, errs.length ? errs.map(([k, v]) => `${k}: ${v[0]}`).join(' | ') : '페이지 오류 0');
const fails = results.filter((r) => !r.ok);
const pass = results.filter((r) => r.kind === 'PASS').length;
const polls = Object.fromEntries(Object.values(watchers).map((W) => [W.L, { first: W.first, n: W.polls?.length ?? 0 }]));
writeFileSync(join(OUT, 'results-show.json'), JSON.stringify({ base: BASE, smoke: SMOKE, slug: seed?.show?.slug ?? null, min: MIN, present: PRESENT, finishedKst: kst(), pass, fail: fails.length, results, polls }, null, 2));
const md = [`# 11/14 표출 화면 알림 리허설 결과${SMOKE ? ' (시연 모드 시험)' : ''}`, '', `- 대상 ${BASE} · 세션 ${seed?.show?.slug ?? '(시연 — DB 없음)'} · min=${MIN} · present=${PRESENT}`, `- 끝난 시각 ${kst()} (KST)`, `- PASS ${pass} · FAIL ${fails.length}`, '', ...results.map((r) => `- ${r.kind} ${r.id} — ${r.detail}`), ''].join('\n');
writeFileSync(join(OUT, 'results-show.md'), md);
console.log(`\nPASS ${pass} · FAIL ${fails.length} → ${join(OUT, 'results-show.md')}`);
process.exit(fails.length ? 1 : 0);
