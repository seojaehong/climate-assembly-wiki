/**
 * 9.12 현장 리허설 드라이런 — **A·B 기능을 이어 붙인 단일 흐름**.
 *
 *   (터미널 1) npx astro preview --port 4331     ← 프로덕션 빌드
 *   (터미널 2) node scripts/verify-field-rehearsal.mjs --base http://localhost:4331
 *
 * 왜 또 하나 만드는가
 *   지금까지의 검증은 전부 **기능별 조각**이다 — 초안 보관(US-003), 재전송 큐(US-005),
 *   저장 배지(US-006), 마감 배너(US-010), 내려받기. 조각마다 매번 새 탭·새 컨텍스트로
 *   시작하므로 **앞 단계가 남긴 상태 위에서 다음 단계가 도는 경우는 한 번도 안 쟀다.**
 *   9.12 경주에서 조가 겪는 것은 조각이 아니라 한 줄기다 —
 *   치고 → 끊기고 → 저장 눌러 실패하고 → 탭이 죽고 → 다시 열고 → 연결이 돌아오고 →
 *   마감이 다가오고 → 받아 간다. 이 스크립트는 그 한 줄기를 **한 페이지에서** 재현한다.
 *
 * ★ 라우트를 왜 /mod 로 하는가 (지시와 다른 점 · 이 스크립트가 찾은 결함 #1)
 *   과업 지시는 픽스처 라우트(`/ko/moderator/insights/submission-panel-lab`)였다.
 *   그런데 **그 라우트에는 마감 배너가 아예 없다** — `DeadlineBanner` 는 `ModConsole.tsx`
 *   에서만 마운트되고, 픽스처 라우트는 `SubmissionPanel` 만 띄운다. 배너가 픽스처용으로
 *   받아 두는 `fixtureTopics` prop 은 **부르는 곳이 하나도 없는 죽은 인자**다(실측).
 *   게다가 그 라우트는 SSG 라 `deadline_at` 을 넣어도 **빌드 시각에 굳어** 구간 전환을
 *   잴 수 없다. 그래서 6단계(마감 임박)를 픽스처 라우트에서는 잴 방법이 없다.
 *   `verify-deadline-banner.mjs` 가 같은 이유로 이미 `/mod` 를 쓴다 — 그 선례를 따른다.
 *
 * 운영 DB 무접촉
 *   `**\/rest/v1/**` 을 **전부 가로챈다.** 통과시키는 경로가 하나도 없다.
 *   `mod_join` 까지 지어낸 응답으로 답하고, rest/v1 밖(auth·realtime)으로 새는 길도 막아
 *   마지막에 「새어 나간 요청 0건」을 증명한다.
 *
 * ★ 가로챈 서버는 **상태를 가진다.** `submission_save` 가 받은 items 를 그대로 담아 두고
 *   `submission_get` 이 그것을 돌려준다. 그래야 마지막 내려받기가 「내가 친 글이 실제로
 *   서버에 올라갔는가」를 재게 된다 — 빈 응답만 주면 ZIP 이 비어도 통과한다.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, statSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, '../.tmp-verify');
const OUT = resolve(HERE, '../.tmp-verify/downloads');
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const BASE = arg('base', 'http://localhost:4331');
const CODE = arg('code', '082901');
const URL_MOD = `${BASE}/mod?code=${CODE}`;
const HEADED = argv.includes('--headed');

const TOPIC1 = 'topic-1';
const TOPIC2 = 'topic-2';
const DRAFT1 = `climate_vote_draft:${CODE}:${TOPIC1}`;
const QUEUE1 = `climate_vote_queue:${CODE}:${TOPIC1}`;

/** 서버가 처음 들고 있는 updated_at. 초안 봉투·큐의 baseUpdatedAt 이 이 값을 딛는다. */
const T0 = '2026-09-12T00:00:00.000Z';

const STAMP = new Date().toISOString().slice(11, 19);
/** ① 붙여넣기로 한 번에 들어가는 줄 — 조가 실제로 하는 동작이다(8.29 실측 93%). */
const PASTED = [
  `연결이 끊겨도 남아야 하는 첫째 줄 ${STAMP}`,
  '둘째 줄 — 버스 노선을 마을 단위로 다시 짠다',
  '셋째 줄 — 옥상 태양광을 공공건물부터 의무화한다',
  '넷째 줄 — 폐열을 인근 온실에 돌려쓴다',
];
/** ② 연결이 끊긴 뒤에 더 친 줄. 이것이 사라지면 8.29 사고 그대로다. */
const OFFLINE_LINE = '다섯째 줄 — 오프라인 상태에서 더 친 글';
/** ③ 마감이 임박한 시점의 미저장 줄. 배너에 저장 안내를 띄우는 근거다. */
const DEADLINE_LINE = '여섯째 줄 — 마감 직전에 친 글, 아직 저장 안 함';
const SAVED_LINES = [...PASTED, OFFLINE_LINE]; // 서버까지 올라가야 하는 것
const ALL_LINES = [...SAVED_LINES, DEADLINE_LINE]; // 화면에 끝까지 남아야 하는 것

let pass = 0;
let fail = 0;
const findings = [];
/** 단계 하나 = 한 줄. **무엇을 기대했고 무엇을 봤는지**를 그 한 줄에 함께 적는다. */
const step = async (n, title, expected, fn) => {
  try {
    const seen = await fn();
    pass += 1;
    console.log(`  PASS  [${n}] ${title} — 기대: ${expected} / 본 것: ${seen}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  [${n}] ${title} — 기대: ${expected} / 본 것: ${String(e.message).split('\n')[0]}`);
  }
};
const must = (c, m) => {
  if (!c) throw new Error(m);
};

// ── 가로챈 서버 ─────────────────────────────────────────────────────────
const MIN = 60_000;
/**
 * 가로챈 서버가 들고 있는 꼭지. `deadlineAt` 은 **절대 시각**이다.
 *
 * ★ 여기가 함정이었다(실측). 마감을 「지금부터 4분 뒤」로 두고 응답을 만들 때마다
 *   다시 계산하면, 배너가 30초마다 새로 읽을 때마다 마감이 4분 뒤로 **밀린다** —
 *   잔여가 04:00 → 03:40 → 04:00 을 오가며 영영 warn 에 닿지 않는다. 화면은 멀쩡한데
 *   픽스처가 시간을 되감고 있었다. 마감시각은 정할 때 한 번만 굳힌다.
 */
const server = { topics: [], saveMode: 'ok' };
/** 지금부터 `ms` 뒤의 절대 시각. 마감을 정하는 순간에 **한 번만** 부른다. */
const deadlineFromNow = (ms) => new Date(Date.now() + ms).toISOString();
/** 꼭지별 서버 보관분. submission_save 가 쓰고 submission_get 이 읽는다. */
const store = {
  [TOPIC1]: { status: 'draft', updated_at: T0, items: [] },
  [TOPIC2]: { status: null, items: [] },
};
let saveSeq = 0;
const calls = { mod_join: 0, topic_list: 0, submission_get: 0, submission_save: 0, other: 0, escaped: 0 };

const isoAt = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const topicRows = () => {
  const now = isoAt(0);
  return server.topics.map((t, i) => ({
    id: t.id,
    ordinal: i + 1,
    block: i === 0 ? 'am' : 'pm',
    prompt: t.prompt,
    guidance: t.guidance ?? null,
    status: 'open',
    deadline_at: t.deadlineAt ?? null,
    server_now: now,
  }));
};

mkdirSync(SHOTS, { recursive: true });
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: !HEADED });
/**
 * 컨텍스트는 **하나뿐이고 끝까지 산다** — 탭을 닫아도 localStorage 가 살아 있어야
 * 4단계(재접속)가 성립한다. `acceptDownloads` 는 7단계(ZIP)가 쓴다.
 */
const context = await browser.newContext({
  viewport: { width: 1280, height: 1100 },
  acceptDownloads: true,
});

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

await context.route('**/rest/v1/**', async (route) => {
  const url = route.request().url();
  let body = {};
  try {
    body = route.request().postDataJSON() ?? {};
  } catch {
    body = {};
  }
  if (url.includes('/rpc/mod_join')) {
    calls.mod_join += 1;
    return json(route, [
      { id: 'rehearsal-team', name: '리허설 조', subgroup: null, join_code: CODE, capacity: 8, table_no: '1' },
    ]);
  }
  if (url.includes('/rpc/topic_list')) {
    calls.topic_list += 1;
    return json(route, topicRows());
  }
  if (url.includes('/rpc/submission_save')) {
    calls.submission_save += 1;
    if (server.saveMode === 'abort') return route.abort('internetdisconnected');
    const topicId = body.p_topic_id;
    const items = (body.p_items ?? []).map((it, i) => ({
      ordinal: it.ordinal ?? i + 1,
      kind: it.kind ?? 'core',
      content: it.content,
      rationale: it.rationale ?? null,
    }));
    saveSeq += 1;
    store[topicId] = {
      status: 'draft',
      // 저장할 때마다 앞으로 나아가는 시각. 큐의 baseUpdatedAt 대조가 실제로 의미를 갖는다.
      updated_at: new Date(Date.parse(T0) + saveSeq * 1000).toISOString(),
      items,
    };
    return json(route, { id: 'rehearsal-sub', status: 'draft', saved: items.length, split: 0 });
  }
  if (url.includes('/rpc/submission_get')) {
    calls.submission_get += 1;
    const got = store[body.p_topic_id] ?? { status: null, items: [] };
    return json(route, got);
  }
  // 그 밖의 조회(rounds·attendance·ballot 등)는 빈 배열. 화면이 죽지 않을 만큼만 준다.
  calls.other += 1;
  return json(route, []);
});
/**
 * rest/v1 밖(auth·realtime)으로 새는 길도 막는다.
 * ★ Playwright 는 **나중에 등록한 route 를 먼저** 본다. 이 포괄 규칙이 위 규칙을 가려
 *   버리므로 rest/v1 은 `fallback()` 으로 넘긴다(verify-deadline-banner 에서 실측된 함정).
 */
await context.route('**/*.supabase.co/**', async (route) => {
  if (route.request().url().includes('/rest/v1/')) return route.fallback();
  calls.escaped += 1;
  return route.abort();
});

// ── 화면 손잡이 ─────────────────────────────────────────────────────────
/** 입력 칸을 가진 구역만이 꼭지다 — 안내·내려받기·개발 툴바까지 세면 안 된다. */
const topicSection = (page, n) =>
  page.locator('section').filter({ has: page.locator('textarea') }).nth(n - 1);
const boxes = (page, n) => topicSection(page, n).locator('textarea');
const badge = (page, n) => topicSection(page, n).locator('[data-save-status]').first();
const badgeState = (page, n) => badge(page, n).getAttribute('data-save-status');
const badgeText = async (page, n) => (await badge(page, n).innerText()).replace(/\s+/g, ' ').trim();
const saveButton = (page, n) => topicSection(page, n).getByRole('button', { name: '저장', exact: true });
const addRowButton = (page, n) => topicSection(page, n).getByRole('button', { name: /한 줄 더/ });
const values = (page, n) => boxes(page, n).evaluateAll((els) => els.map((e) => e.value));
const readKey = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

const banner = (page) => page.locator('[data-deadline-banner]');
const bannerTier = (page) => banner(page).getAttribute('data-deadline-banner');
const bannerMessage = async (page) => {
  const m = page.locator('[data-deadline-message]');
  return (await m.count()) === 0 ? '' : (await m.innerText()).replace(/\s+/g, ' ').trim();
};

/**
 * 조 콘솔 열기.
 * ★ `networkidle` 을 기다리면 안 된다 — 조 콘솔은 라운드를 계속 폴링해 「조용해지는 순간」이
 *   오지 않는다. 탭 바와 입력 칸이 뜬 것을 신호로 쓴다.
 */
const openMod = async () => {
  const page = await context.newPage();
  await page.goto(URL_MOD, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[role="tablist"]', { timeout: 60_000 });
  await page.waitForSelector('textarea', { timeout: 60_000 });
  await page.waitForTimeout(900);
  return page;
};

/**
 * 고정 시간으로 재지 않는다 — 「몇 초 만에 그렇게 됐나」를 세는 편이 사실에 가깝고 재현된다.
 *
 * ★ `describe` 는 **함수**로 받는다. 문자열로 받으면 호출하는 자리에서 미리 계산돼
 *   기다리기 **전**의 화면이 실패 메시지에 박힌다 — 실제로 그 탓에 「120초를 기다려도
 *   calm」이라는 거짓 관찰이 나왔다(진짜 구간은 notice 였다).
 */
const waitUntil = async (page, fn, timeoutMs, describe) => {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return Math.round((Date.now() - t0) / 100) / 10;
    if (Date.now() - t0 > timeoutMs) {
      const what = typeof describe === 'function' ? await describe() : describe;
      throw new Error(`${timeoutMs / 1000}초를 기다려도 ${what}`);
    }
    await page.waitForTimeout(400);
  }
};

/** 실제 붙여넣기 이벤트. 타이핑이 아니라 clipboard 경로여야 「나눠 담기」가 돈다. */
const paste = (locator, text) =>
  locator.evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);

// ── ZIP 읽기 (verify-team-download.mjs 와 같은 구현) ──────────────────────
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1)
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('ZIP 이 아니다 — EOCD 서명을 못 찾았다');
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('중앙 디렉터리 서명이 깨졌다');
    const method = u16(buf, p + 10);
    const compressed = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const cmtLen = u16(buf, p + 32);
    const off = u32(buf, p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = off + 30 + u16(buf, off + 26) + u16(buf, off + 28);
    const raw = buf.subarray(start, start + compressed);
    out.push({ name, method, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}

// ── 리허설 ──────────────────────────────────────────────────────────────
try {
  console.log(`\n9.12 현장 리허설 · ${URL_MOD} · 운영 DB 무접촉(전부 가로챔)`);
  console.log(`  ※ 픽스처 라우트에는 마감 배너가 없어(DeadlineBanner 미마운트) /mod 로 돈다 — 보고 참조\n`);

  // 마감을 넉넉히(40분) 걸고 시작한다. 배너가 1단계부터 흐름 안에 있어야 한다.
  server.topics = [
    {
      id: TOPIC1,
      prompt: '기후위기 대응에서 우리 지역이 먼저 해야 할 일은 무엇입니까?',
      deadlineAt: deadlineFromNow(40 * MIN),
    },
    { id: TOPIC2, prompt: '그 일을 하려면 무엇이 필요합니까?', deadlineAt: null },
  ];

  let page = await openMod();
  // 저장소는 리허설 시작 때 **한 번만** 비운다. 이 뒤로는 절대 손대지 않는다 —
  // 이어 붙인 흐름에서 중간에 비우면 재는 대상 자체가 사라진다.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea', { timeout: 60_000 });
  await page.waitForTimeout(900);

  // ── [1] 입력 ──────────────────────────────────────────────────────────
  await step(
    1,
    '입력 — 꼭지①에 여러 줄',
    `${PASTED.length}줄이 칸마다 나뉘고 배지가 「저장 안 함」으로 뒤집힌다`,
    async () => {
      const before = await boxes(page, 1).count();
      must(before === 1, `시작 칸이 ${before}개다 — 빈 꼭지여야 한다`);
      const first = await badgeState(page, 1);
      must(first === 'saved', `첫 배지가 ${first} 다`);
      await boxes(page, 1).first().click();
      await paste(boxes(page, 1).first(), PASTED.join('\r\n'));
      await page.waitForTimeout(900);
      const v = await values(page, 1);
      must(v.length === PASTED.length, `칸이 ${v.length}개다 (${PASTED.length}개여야 한다)`);
      for (const line of PASTED) must(v.includes(line), `「${line.slice(0, 20)}…」이 제 칸에 없다`);
      const state = await badgeState(page, 1);
      must(state === 'unsaved', `배지가 ${state} 다`);
      const t = await badgeText(page, 1);
      must(t.includes('저장 안 함'), `배지 문구가 "${t}" 다`);
      const tier = (await banner(page).count()) ? await bannerTier(page) : '(없음)';
      await badge(page, 1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-1-typed.png` });
      return `칸 1→${v.length}개 · 배지 "${t}" · 마감 배너 ${tier}`;
    },
  );

  // ── [2] 오프라인 전환 ────────────────────────────────────────────────
  await step(
    2,
    '오프라인 전환 — 계속 타이핑',
    '연결이 끊긴 뒤에도 앞 글이 그대로 있고 새 줄이 더 들어간다',
    async () => {
      server.saveMode = 'abort';
      await context.setOffline(true);
      await page.waitForTimeout(600);
      const off = await page.evaluate(() => navigator.onLine);
      must(off === false, 'navigator.onLine 이 아직 true 다 — 오프라인 전환이 안 먹었다');
      await addRowButton(page, 1).click();
      await page.waitForTimeout(300);
      const v0 = await boxes(page, 1).count();
      must(v0 === PASTED.length + 1, `「한 줄 더」 뒤 칸이 ${v0}개다`);
      await boxes(page, 1).nth(v0 - 1).fill(OFFLINE_LINE);
      await page.waitForTimeout(900);
      const v = await values(page, 1);
      for (const line of SAVED_LINES) must(v.includes(line), `오프라인에서 「${line.slice(0, 16)}…」이 사라졌다`);
      const draft = await readKey(page, DRAFT1);
      must(draft, `${DRAFT1} 가 없다 — 초안이 기기에 안 남았다`);
      must(draft.includes(OFFLINE_LINE), '초안에 오프라인에서 친 줄이 없다');
      await boxes(page, 1).nth(v0 - 1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-2-offline.png` });
      return `onLine=false · 칸 ${v.length}개 전부 유지 · 초안에 오프라인 줄 포함`;
    },
  );

  // ── [3] 오프라인 저장 시도 ───────────────────────────────────────────
  await step(
    3,
    '오프라인 저장 시도 — 「저장」',
    '배지 「대기 중 · 1번째 시도」 + 본문에 대기 안내',
    async () => {
      await saveButton(page, 1).click();
      await page.waitForTimeout(1_800);
      const raw = await readKey(page, QUEUE1);
      must(raw, `${QUEUE1} 이 없다 — 실패한 저장이 큐에 안 얹혔다`);
      const q = JSON.parse(raw);
      must(q.v === 1 && q.attempts === 1, `봉투가 이상하다: attempts=${q.attempts}`);
      must(q.baseUpdatedAt === T0, `baseUpdatedAt 이 ${q.baseUpdatedAt} 다 (서버 ${T0})`);
      must(q.items.length === SAVED_LINES.length, `큐에 담긴 줄이 ${q.items.length}개다`);
      for (const line of SAVED_LINES)
        must(q.items.some((i) => i.content.includes(line)), `큐에 「${line.slice(0, 16)}…」이 없다`);
      const state = await badgeState(page, 1);
      must(state === 'queued', `배지가 ${state} 다`);
      const t = await badgeText(page, 1);
      must(t.includes('대기 중 · 1번째 시도'), `배지 문구가 "${t}" 다`);
      const body = await topicSection(page, 1).innerText();
      must(body.includes('저장하지 못한 내용이 대기 중입니다'), '본문에 대기 안내가 없다');
      must(body.includes('지금 다시 시도'), '「지금 다시 시도」 버튼이 없다');
      await badge(page, 1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-3-queued.png` });
      return `큐 ${q.items.length}줄(base=${T0}) · 배지 "${t}" · 본문 안내+재시도 버튼`;
    },
  );

  // ── [4] 탭 종료 → 재접속 ─────────────────────────────────────────────
  //
  // ★ 순서에 함정이 있다. `setOffline(true)` 는 **문서 요청까지** 끊으므로 오프라인인 채로는
  //   새 탭을 열 수 없다(localhost 도 못 받는다). 그래서 「닫는다 → 연결을 되돌린다 →
  //   새 탭을 연다」 순서로 간다. 이때 **열려 있는 페이지가 없어 `online` 이벤트가 어디에도
  //   도달하지 않는다** — 재접속한 탭은 큐를 들고 온라인이지만 `online` 이벤트를 못 받은
  //   상태다. 조각 검증(verify-queue-resend)이 재던 것은 「큐를 얹은 그 페이지가 online
  //   이벤트를 받는」 경로뿐이라, 여기서 재는 것은 **한 번도 안 재 본 이어 붙인 경로**다.
  await step(
    4,
    '탭 종료 → 재접속',
    `새 탭에서 친 글 ${SAVED_LINES.length}줄이 전부 복원된다`,
    async () => {
      await page.close();
      server.saveMode = 'ok';
      await context.setOffline(false); // 열린 페이지가 없다 = online 이벤트가 안 간다
      page = await openMod();
      const v = await values(page, 1);
      for (const line of SAVED_LINES) must(v.includes(line), `재접속 뒤 「${line.slice(0, 16)}…」이 사라졌다`);
      must(
        v.filter((s) => s.trim().length > 0).length === SAVED_LINES.length,
        `내용 있는 칸이 ${v.filter((s) => s.trim().length > 0).length}개다 (${SAVED_LINES.length}개여야 한다)`,
      );
      // 사진에 **복원된 글이 실제로 찍혀야** 증거가 된다 — 페이지 맨 위를 찍으면 안 보인다.
      await boxes(page, 1).last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-4-reopened.png` });
      return `새 탭 · ${SAVED_LINES.length}줄 전부 복원 (붙여넣기 4줄 + 오프라인 1줄)`;
    },
  );

  // ── [5] 온라인 복귀 — 큐 자동 재전송 ─────────────────────────────────
  await step(
    5,
    '온라인 복귀 — 큐 자동 재전송',
    '재접속한 탭이 스스로 큐를 비우고 배지가 「저장됨」으로 돌아온다',
    async () => {
      const beforeSave = calls.submission_save;
      let secs;
      try {
        secs = await waitUntil(page, async () => (await readKey(page, QUEUE1)) === null, 25_000, '큐가 안 비었다');
      } catch (e) {
        // 진단 — 실제 online 이벤트를 한 번 일으켜 보고 그때는 나가는지 본다.
        await context.setOffline(true);
        await page.waitForTimeout(400);
        await context.setOffline(false);
        let recovered = false;
        try {
          await waitUntil(page, async () => (await readKey(page, QUEUE1)) === null, 15_000, '');
          recovered = true;
        } catch {
          /* 그래도 안 나갔다 */
        }
        findings.push(
          `[5] 재접속한 탭이 스스로 큐를 비우지 않았다. 실제 online 이벤트를 일으키니 ${
            recovered ? '그때는 나갔다 — 마운트 경로만 비어 있다' : '그래도 안 나갔다'
          }`,
        );
        throw new Error(`${e.message} — 마운트 시 큐 워커가 안 돌았다(진단: online 이벤트 ${recovered ? '뒤엔 전송됨' : '뒤에도 미전송'})`);
      }
      must(calls.submission_save > beforeSave, 'submission_save 가 안 나갔다');
      must(store[TOPIC1].items.length === SAVED_LINES.length, `서버에 ${store[TOPIC1].items.length}줄만 올라갔다`);
      for (const line of SAVED_LINES)
        must(store[TOPIC1].items.some((i) => i.content.includes(line)), `서버에 「${line.slice(0, 16)}…」이 없다`);
      must((await readKey(page, DRAFT1)) === null, '전송했는데 초안이 안 지워졌다');
      await waitUntil(page, async () => (await badgeState(page, 1)) === 'saved', 10_000, '배지가 saved 로 안 돌아왔다');
      const t = await badgeText(page, 1);
      await badge(page, 1).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/rehearsal-5-resent.png` });
      return `${secs}초 만에 큐 비움 · 서버 ${store[TOPIC1].items.length}줄 · 배지 "${t}"`;
    },
  );

  // ── [6] 마감 임박 ────────────────────────────────────────────────────
  await step(
    6,
    '마감 임박 — 배너 warn + 저장 안내',
    'warn(주황) 구간으로 가고 미저장이 있으면 저장 안내가 함께 뜬다',
    async () => {
      // 먼저 **새 미저장**을 만든다. 5단계에서 전부 올라가 미저장이 0이 된 상태다.
      await addRowButton(page, 1).click();
      await page.waitForTimeout(300);
      const n = await boxes(page, 1).count();
      await boxes(page, 1).nth(n - 1).fill(DEADLINE_LINE);
      await page.waitForTimeout(700);
      const state = await badgeState(page, 1);
      must(state === 'unsaved', `미저장을 만들었는데 배지가 ${state} 다`);

      // 픽스처의 마감시각을 4분 뒤로 당긴다(절대 시각으로 굳힌다). 배너는 30초 주기로 다시 읽으므로
      // 먼저 notice(5분 이하)로 내려앉고, 1분쯤 더 지나 warn(3분 이하)에 닿는다.
      const fixedAt = deadlineFromNow(4 * MIN);
      server.topics = server.topics.map((t) => (t.id === TOPIC1 ? { ...t, deadlineAt: fixedAt } : t));
      const noticeSecs = await waitUntil(
        page,
        async () => ['notice', 'warn'].includes(await bannerTier(page)),
        60_000,
        async () => `구간이 ${await bannerTier(page)} 다 — 새 마감시각을 다시 안 읽었다`,
      );
      const secs = await waitUntil(
        page,
        async () => (await bannerTier(page)) === 'warn',
        120_000,
        async () => `구간이 ${await bannerTier(page)} 다 (잔여 ${(await page.locator('[data-deadline-countdown]').innerText()).trim()})`,
      );
      const msg = await bannerMessage(page);
      must(msg.includes('지금 저장하세요'), `문구가 "${msg}" 다`);
      must(msg.includes('저장하지 않은 내용이 있습니다'), `미저장인데 저장 안내가 없다 — "${msg}"`);
      const cd = (await page.locator('[data-deadline-countdown]').innerText()).trim();
      must(/^0[0-3]:\d{2}$/.test(cd), `잔여가 ${cd} 다 — 3분 이하여야 warn 이다`);
      // 배너는 탭 바 **바깥**이라 어느 탭에서도 보인다는 것이 이 기능의 요점이다.
      const outside = await page.evaluate(() => {
        const b = document.querySelector('[data-deadline-banner]');
        const tabs = document.querySelector('[role="tablist"]');
        return b && tabs ? !tabs.contains(b) && Boolean(b.compareDocumentPosition(tabs) & 4) : false;
      });
      must(outside, '배너가 탭 바 안에 있다');
      await page.screenshot({ path: `${SHOTS}/rehearsal-6-warn.png` });
      return `${noticeSecs}초 만에 notice(새 마감 반영) → ${secs}초 만에 warn · 잔여 ${cd} · "${msg}"`;
    },
  );

  // ── [7] 내려받기 ─────────────────────────────────────────────────────
  // ⚠️ 「전부 받기」 버튼의 접근성 이름에 부제 「워드·엑셀·줄글…」이 들어가므로
  //    `/워드/` 로 고르면 ZIP 버튼이 먼저 잡힌다. testid 로 고정한다.
  await step(
    7,
    '내려받기 — 「전부 받기 (.zip)」 한 번',
    'ZIP 하나가 떨어지고 안에 워드·엑셀·줄글 3개 · 저장한 줄이 그대로 담긴다',
    async () => {
      await page.getByRole('button', { name: /내려받기/ }).first().click();
      await page.locator('[data-testid="team-download-zip"]').scrollIntoViewIfNeeded();
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 30_000 }),
        page.locator('[data-testid="team-download-zip"]').click(),
      ]);
      const p = `${OUT}/rehearsal-bundle.zip`;
      await dl.saveAs(p);
      const size = statSync(p).size;
      must(dl.suggestedFilename().endsWith('.zip'), `확장자가 ${dl.suggestedFilename()} 다`);
      must(size > 1000, `파일이 ${size}바이트다`);
      const entries = unzip(readFileSync(p));
      must(entries.length === 3, `ZIP 안에 ${entries.length}개다`);
      const exts = entries.map((e) => e.name.split('.').pop());
      must(exts.join() === 'docx,csv,txt', `확장자·순서가 ${exts.join(' · ')} 다`);
      const csv = entries.find((e) => e.name.endsWith('.csv')).data.toString('utf8');
      const txt = entries.find((e) => e.name.endsWith('.txt')).data.toString('utf8');
      // 저장한 줄은 전부 들어 있고, **아직 저장 안 한 줄은 안 들어 있어야** 한다
      // (화면이 「아직 저장하지 않은 글은 담기지 않습니다」라고 약속한 그대로다).
      for (const line of SAVED_LINES) must(csv.includes(line), `ZIP 의 CSV 에 「${line.slice(0, 16)}…」이 없다`);
      must(!csv.includes(DEADLINE_LINE), '★ 저장하지 않은 줄이 내려받기에 섞여 들어갔다');
      must(txt.includes(SAVED_LINES[0]), '줄글에 첫 줄이 없다');
      await page.screenshot({ path: `${SHOTS}/rehearsal-7-download.png` });
      return `${dl.suggestedFilename()} · ${size}B · ${entries.length}개(${exts.join('/')}) · 저장분 ${SAVED_LINES.length}줄 담김 · 미저장 1줄 제외`;
    },
  );

  // ── [8] 불변식 ───────────────────────────────────────────────────────
  await step(
    8,
    '불변식 — 글자가 사라지지 않았다',
    `처음부터 친 ${ALL_LINES.length}줄이 순서 그대로 화면에 남아 있다`,
    async () => {
      const v = (await values(page, 1)).filter((s) => s.trim().length > 0);
      must(
        v.length === ALL_LINES.length,
        `친 줄은 ${ALL_LINES.length}개인데 남은 줄이 ${v.length}개다 — ${ALL_LINES.filter((l) => !v.includes(l)).join(' / ') || '순서만 어긋났다'}`,
      );
      for (let i = 0; i < ALL_LINES.length; i += 1)
        must(v[i] === ALL_LINES[i], `${i + 1}번째 줄이 "${v[i]}" 다 (기대 "${ALL_LINES[i]}")`);
      const blob = v.find((s) => s.includes('\n'));
      must(!blob, '한 칸에 줄바꿈째로 뭉친 값이 있다 — 붙여넣기 분해가 되돌아갔다');
      await page.screenshot({ path: `${SHOTS}/rehearsal-8-final.png`, fullPage: true });
      return `${v.length}/${ALL_LINES.length}줄 · 순서 일치 · 뭉친 칸 0개`;
    },
  );

  // ── 운영 DB 무접촉 ───────────────────────────────────────────────────
  await step(
    9,
    '운영 DB 무접촉',
    '가로채기 밖으로 새어 나간 요청 0건',
    async () => {
      must(calls.escaped === 0, `rest/v1 밖으로 새어 나간 요청 ${calls.escaped}건`);
      return `mod_join ${calls.mod_join} · topic_list ${calls.topic_list} · submission_get ${calls.submission_get} · submission_save ${calls.submission_save} · 기타 ${calls.other} — 전부 지어낸 응답`;
    },
  );
} finally {
  await context.close();
  await browser.close();
}

console.log(`\n  ${pass} PASS / ${fail} FAIL  (${pass}/${pass + fail})`);
if (findings.length) {
  console.log('\n  찾은 결함');
  for (const f of findings) console.log(`   · ${f}`);
}
console.log(`\n  사진: ${SHOTS}/rehearsal-*.png\n`);
// ★ 검사를 한 건도 못 돌았으면 실패다 — 「0 PASS · 0 FAIL」로 조용히 exit 0 이 되면
//   아무것도 안 잰 것을 통과로 읽게 된다.
if (pass + fail === 0) {
  console.error(`  FAIL: 검사를 한 건도 돌지 못했다 — ${URL_MOD} 이 뜨는지 확인하라(npx astro preview --port 4331).\n`);
  process.exit(1);
}
process.exit(fail === 0 ? 0 : 1);
