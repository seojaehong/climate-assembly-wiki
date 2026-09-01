/**
 * 「본부가 꼭지 마감을 걸고 지울 수 있는가」 드라이런 — 실화면(US-011).
 *
 *   (터미널 1) npm run dev
 *   (터미널 2) node scripts/verify-hq-deadline.mjs
 *
 * 왜 픽스처 라우트가 아니라 /hq 인가
 *   마감 줄은 **본부 토큰이 있을 때만** 그려진다. 미리보기 라우트(submission-lab)는
 *   토큰을 안 주므로 거기서는 이 story 를 아예 못 잰다(그 사실 자체는 아래에서 확인한다).
 *   그래서 진짜 `/hq` 를 열되 ① 본부 토큰을 sessionStorage 에 심고 ② `rest/v1` 을 전부
 *   가로채 지어낸 응답만 준다. 운영 DB 로 나가는 요청은 0건이다.
 *
 * ★★ Realtime 웹소켓은 `context.route` 가 못 막는다
 *   `HqSubmissionBoard` 는 `fixtureRows` 가 없으면 `subscribeHqSubmissions()` 로 운영
 *   Supabase 에 **웹소켓을 연다**. Playwright 의 HTTP 라우팅은 여기에 안 걸리므로,
 *   `window.WebSocket` 을 통째로 무동작 스텁으로 바꿔 실제 연결을 0으로 만든다.
 *   US-010 의 `/mod` 스크립트는 ModConsole 이 구독을 안 걸어 이 함정을 안 만났다.
 *
 * 무엇을 보나 — 타입체크·단위시험으로는 판정되지 않는 것들
 *   ① `datetime-local`(시간대 없는 로컬 벽시계) → `timestamptz` ISO 변환이 실제로 맞는가
 *   ② 「지우기」가 정말 null 을 보내는가
 *   ③ RPC 가 실패하면 role="alert" 로 **원인 코드까지** 보이는가
 *   ④ ★ 카드 수 보존 불변식과 미제출 조 표기가 그대로인가(새 UI 가 <article> 을 안 내는가)
 *   ⑤ ★★ **되읽기(s19)** — 마감을 건 뒤 화면을 **다시 열면** 그 값이 보이는가.
 *      본부가 새로고침하면 자기가 무엇을 걸었는지 몰랐다는 것이 이 story 가 고친 결함이다.
 *      남(다른 본부 콘솔)이 건 마감이 폴링으로 따라오는지도 같이 본다
 *   ⑥ ★ **s19 미적용(PGRST202) 퇴화** — 되읽기 RPC 가 없어도 화면이 죽지 않고 s19 이전
 *      표시로 조용히 물러나며 걸기·지우기는 그대로 되는가
 *
 * 표시의 출처는 문구가 아니라 `[data-testid="hq-deadline-echo"]` 의
 * `data-deadline-source`(`server`|`local`|`unknown`)로 집는다 — 문구가 바뀌어도 안 깨진다.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '../automation/node_modules/playwright/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(HERE, '../.tmp-verify');
const FIXTURE = resolve(HERE, '../automation/fixtures/0829-submissions.json');
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const BASE = arg('base', 'http://localhost:4321');
const URL_HQ = `${BASE}/hq`;
const URL_LAB = `${BASE}/ko/moderator/insights/submission-lab`;
const HEADED = argv.includes('--headed');

const HQ_TOKEN_KEY = 'climate_vote_hq_attendance_token';
const HQ_ACTOR_KEY = 'climate_vote_hq_gate_actor';
const TOKEN = 'verify-hq-token-us011';

let pass = 0;
let fail = 0;
const check = async (label, fn) => {
  try {
    const d = await fn();
    pass += 1;
    console.log(`  PASS  ${label}${d ? ` — ${d}` : ''}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  ${label} — ${e.message}`);
  }
};
const must = (c, m) => {
  if (!c) throw new Error(m);
};

// ── 픽스처 실측값 ─────────────────────────────────────────────
// ★ 「100장 이상」 같은 임계치가 아니라 **파일에서 지금 센 수**를 기대값으로 쓴다.
//   그래야 27 이 26 이 되는 순간 걸린다(scripts/AGENTS.md 규약).
const FIXTURE_ROWS = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const TOPIC_ID = 'topic-0829-1';
const TOPIC2_ID = 'topic-0829-2';
const topicRows = (id) => FIXTURE_ROWS.filter((r) => r.topic_id === id);
const cardCount = (id) => topicRows(id).filter((r) => (r.item_content ?? '').trim()).length;
const CARDS_TOPIC1 = cardCount(TOPIC_ID);

/** 한 조의 항목을 전부 지운 응답 — 「미제출 조 표기」가 살아 있는지 보려고 만든다. */
const SILENCED_TEAM = topicRows(TOPIC_ID)[0].team_name;
function rowsWithSilentTeam() {
  const kept = [];
  let placed = false;
  for (const row of FIXTURE_ROWS) {
    if (row.team_name !== SILENCED_TEAM || row.topic_id !== TOPIC_ID) {
      kept.push(row);
      continue;
    }
    // 조 자리는 남기고 카드만 없앤다(RPC 가 실제로 내려주는 「빈 행」 모양).
    if (placed) continue;
    placed = true;
    kept.push({ ...row, item_ordinal: null, item_kind: null, item_content: null, item_rationale: null });
  }
  return kept;
}

// ── 서버 흉내 ─────────────────────────────────────────────────
/** 꼭지 id → 현재 마감(ISO) · null = 마감 없음. s19 hq_topic_deadlines 가 이걸 내려준다. */
const TOPIC_IDS = [...new Set(FIXTURE_ROWS.map((r) => r.topic_id))];
const freshDeadlines = () => Object.fromEntries(TOPIC_IDS.map((id) => [id, null]));
const server = {
  rows: FIXTURE_ROWS,
  failDeadline: null,
  // 시작값은 전부 null(마감 없음) — 기존 검사들이 보는 「빈 입력칸」이 그대로 유지된다.
  deadlines: freshDeadlines(),
  /** true 면 되읽기 RPC 가 없는 DB 를 흉내낸다(s19 미적용). */
  deadlinesMissing: false,
};
const sent = [];
const calls = {
  hq_submissions: 0,
  hq_kinds: 0,
  set_deadline: 0,
  topic_deadlines: 0,
  other: 0,
  escaped: 0,
};

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

const json = (route, body, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

await context.route('**/rest/v1/**', async (route) => {
  const url = route.request().url();
  if (url.includes('/rpc/hq_submissions')) {
    calls.hq_submissions += 1;
    return json(route, server.rows);
  }
  if (url.includes('/rpc/hq_submission_kinds')) {
    calls.hq_kinds += 1;
    return json(route, []);
  }
  if (url.includes('/rpc/topic_set_deadline')) {
    calls.set_deadline += 1;
    let body = null;
    try {
      body = route.request().postDataJSON();
    } catch {
      body = { parseFailed: route.request().postData() };
    }
    sent.push(body);
    if (server.failDeadline) return json(route, server.failDeadline, 404);
    // ★ 실제로 서버 상태를 바꾼다 — 안 바꾸면 「다시 열면 보이는가」를 잴 수 없다.
    if (body && body.p_topic_id) server.deadlines[body.p_topic_id] = body.p_deadline_at ?? null;
    return json(route, null);
  }
  if (url.includes('/rpc/hq_topic_deadlines')) {
    calls.topic_deadlines += 1;
    // s19 미적용 DB 흉내 — PostgREST 는 함수를 못 찾으면 PGRST202 를 낸다.
    if (server.deadlinesMissing) {
      return json(
        route,
        {
          code: 'PGRST202',
          message: 'Could not find the function climate_vote.hq_topic_deadlines',
          hint: null,
          details: null,
        },
        404
      );
    }
    return json(
      route,
      TOPIC_IDS.map((id, i) => ({
        topic_id: id,
        topic_ordinal: i + 1,
        deadline_at: server.deadlines[id],
      }))
    );
  }
  calls.other += 1;
  return json(route, []);
});
// ★ 나중에 등록한 route 가 먼저 걸린다 — rest/v1 은 fallback 으로 위 규칙에 넘긴다.
await context.route('**/*.supabase.co/**', async (route) => {
  if (route.request().url().includes('/rest/v1/')) return route.fallback();
  calls.escaped += 1;
  return route.abort();
});

// 본부 토큰 주입 + 웹소켓 무력화. 둘 다 페이지 스크립트보다 **먼저** 돌아야 한다.
await context.addInitScript(
  ({ tokenKey, actorKey, token }) => {
    try {
      sessionStorage.setItem(tokenKey, token);
      sessionStorage.setItem(actorKey, '검증');
    } catch {
      /* 스토리지가 막힌 환경 — 게이트 화면이 떠서 아래 검사가 실패로 잡힌다 */
    }
    const attempts = [];
    class NoopSocket {
      constructor(url) {
        attempts.push(String(url));
        this.url = String(url);
        this.readyState = 0;
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
      }
      send() {}
      close() {
        this.readyState = 3;
      }
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return false;
      }
    }
    NoopSocket.CONNECTING = 0;
    NoopSocket.OPEN = 1;
    NoopSocket.CLOSING = 2;
    NoopSocket.CLOSED = 3;
    Object.defineProperty(window, '__wsAttempts', { value: attempts, writable: false });
    window.WebSocket = NoopSocket;
  },
  { tokenKey: HQ_TOKEN_KEY, actorKey: HQ_ACTOR_KEY, token: TOKEN }
);

const openHq = async (page) => {
  // ★ networkidle 금지 — 보드가 5초마다 폴링해 「조용해지는 순간」이 오지 않는다.
  await page.goto(URL_HQ, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('[data-testid="hq-deadline-row"]', { timeout: 60_000 });
  await page.waitForTimeout(600);
};

const row = (page) => page.locator('[data-testid="hq-deadline-row"]');
const input = (page) => page.locator('[data-testid="hq-deadline-input"]');
const echo = (page) => page.locator('[data-testid="hq-deadline-echo"]');
const echoText = async (page) => (await echo(page).innerText()).replace(/\s+/g, ' ').trim();
/** 'server' = s19 로 읽은 서버 값 · 'local' = 이 화면의 마지막 조작 · 'unknown' = 모름 */
const echoSource = async (page) => (await echo(page).getAttribute('data-deadline-source')) ?? '';
const alertText = async (page) => {
  const a = page.locator('[data-testid="hq-deadline-error"]');
  return (await a.count()) === 0 ? '' : (await a.innerText()).replace(/\s+/g, ' ').trim();
};
/** 꼭지 탭을 고른다 — 탭 라벨이 곧 prompt 다. */
const pickTopic = async (page, prompt) => {
  await page.locator('[role="tab"]', { hasText: prompt }).first().click();
  await page.waitForTimeout(300);
};

// 브라우저와 **같은 기기·같은 시간대**에서 만든 기대값. 이 일치가 이 story 의 핵심이다.
const LOCAL_INPUT = '2026-09-12T14:30';
const EXPECTED_ISO = new Date(2026, 8, 12, 14, 30, 0, 0).toISOString();

try {
  console.log(`\n본부 마감시각 드라이런 · ${URL_HQ} · 운영 DB 무접촉(HTTP·WS 전부 가로챔)\n`);
  const page = await context.newPage();
  await openHq(page);

  await check('본부 토큰이 있으면 마감 줄이 뜬다 (입력 1 · 걸기 1 · 지우기 1)', async () => {
    must((await row(page).count()) === 1, '마감 줄이 1개가 아니다');
    const type = await input(page).getAttribute('type');
    must(type === 'datetime-local', `입력 type 이 ${type} 다`);
    must((await page.locator('[data-testid="hq-deadline-set"]').count()) === 1, '「걸기」가 없다');
    must((await page.locator('[data-testid="hq-deadline-clear"]').count()) === 1, '「지우기」가 없다');
    const label = (await row(page).innerText()).replace(/\s+/g, ' ').trim();
    return `"${label.slice(0, 60)}…"`;
  });

  await check('★ 카드 수 보존 — 모아보기 카드 수가 픽스처 항목 수 그대로', async () => {
    await page.locator('button', { hasText: '모아보기' }).first().click();
    await page.waitForTimeout(400);
    const n = await page.locator('[data-testid="note-grid"] article').count();
    must(n === CARDS_TOPIC1, `카드가 ${n}장 — 픽스처는 ${CARDS_TOPIC1}건`);
    const shown = (await page.locator('[data-testid="note-count"]').innerText()).replace(/\s+/g, ' ');
    must(shown.includes(String(CARDS_TOPIC1)), `화면 표기가 "${shown}" 다`);
    return `${n}/${CARDS_TOPIC1}장 · 표기 "${shown.trim()}"`;
  });

  await check('★ 새 UI 는 <article> 이 아니다 — 페이지 전체 article 이 카드 수와 같다', async () => {
    const inRow = await page.locator('[data-testid="hq-deadline-row"] article').count();
    must(inRow === 0, `마감 줄 안에 article 이 ${inRow}개 있다`);
    const all = await page.locator('article').count();
    must(all === CARDS_TOPIC1, `페이지 전체 article 이 ${all}개 — 카드 ${CARDS_TOPIC1}장이어야 한다`);
    return `마감 줄 안 0개 · 페이지 전체 ${all}개 = 카드 수`;
  });

  await check('★ 미제출 조 표기가 그대로다', async () => {
    server.rows = rowsWithSilentTeam();
    await page.waitForFunction(
      () => document.body.innerText.includes('아직 제출 없는 조'),
      undefined,
      { timeout: 20_000 }
    );
    const text = await page.locator('text=아직 제출 없는 조').first().innerText();
    must(text.includes(SILENCED_TEAM), `표기에 ${SILENCED_TEAM} 이 없다 — "${text}"`);
    const n = await page.locator('[data-testid="note-grid"] article').count();
    const expected = CARDS_TOPIC1 - topicRows(TOPIC_ID).filter((r) => r.team_name === SILENCED_TEAM && (r.item_content ?? '').trim()).length;
    must(n === expected, `카드가 ${n}장 — ${expected}장이어야 한다`);
    server.rows = FIXTURE_ROWS;
    return `"${text.replace(/\s+/g, ' ').trim()}" · 카드 ${n}장`;
  });

  await check('빈 입력으로 걸기 — 아무것도 안 보내고 role="alert" 로 안내한다', async () => {
    const before = calls.set_deadline;
    await page.locator('[data-testid="hq-deadline-set"]').click();
    await page.waitForSelector('[data-testid="hq-deadline-error"]', { timeout: 5_000 });
    const role = await page.locator('[data-testid="hq-deadline-error"]').getAttribute('role');
    must(role === 'alert', `role 이 ${role} 다`);
    must(calls.set_deadline === before, `RPC 를 ${calls.set_deadline - before}건 보냈다`);
    const t = await alertText(page);
    must(t.includes('지우기'), `문구가 "${t}" 다`);
    return `RPC 0건 · "${t}"`;
  });

  await check('★★ 걸기 — 로컬 벽시계가 같은 순간의 ISO(UTC)로 나간다', async () => {
    sent.length = 0;
    await input(page).fill(LOCAL_INPUT);
    await page.locator('[data-testid="hq-deadline-set"]').click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(800);
    must(sent.length === 1, `RPC 가 ${sent.length}건 나갔다`);
    const body = sent[0];
    must(
      body.p_deadline_at === EXPECTED_ISO,
      `p_deadline_at 이 ${body.p_deadline_at} — Node 가 같은 값으로 만든 ${EXPECTED_ISO} 여야 한다`
    );
    must(body.p_topic_id === TOPIC_ID, `p_topic_id 가 ${body.p_topic_id} 다`);
    must(body.p_token === TOKEN, `p_token 이 ${body.p_token} 다`);
    must((await alertText(page)) === '', `실패 문구가 남아 있다 — "${await alertText(page)}"`);
    const label = await echoText(page);
    must(label.includes('2026-09-12 14:30'), `표시가 "${label}" 다`);
    return `${LOCAL_INPUT} → ${body.p_deadline_at} · 표시 "${label}"(${await echoSource(page)})`;
  });

  await check('★ 지우기 — p_deadline_at 이 null 이고 입력칸이 비워진다', async () => {
    sent.length = 0;
    await page.locator('[data-testid="hq-deadline-clear"]').click();
    await page.waitForTimeout(800);
    must(sent.length === 1, `RPC 가 ${sent.length}건 나갔다`);
    must(sent[0].p_deadline_at === null, `p_deadline_at 이 ${JSON.stringify(sent[0].p_deadline_at)} 다`);
    must((await input(page).inputValue()) === '', `입력칸에 "${await input(page).inputValue()}" 가 남았다`);
    // s19 이전에는 「방금 마감을 지웠습니다」(이 화면의 조작)였다. 이제 서버를 읽으므로
    // **서버의 현재 상태**를 낸다 — 지운 사실은 서버 값이 없다는 것으로 드러난다.
    const label = await echoText(page);
    must(label.includes('현재 마감 없음'), `표시가 "${label}" 다`);
    must((await echoSource(page)) === 'server', `출처가 "${await echoSource(page)}" 다`);
    return `p_deadline_at: null · 표시 "${label}"(server)`;
  });

  await check('★ RPC 실패 — role="alert" 에 서버 코드가 그대로 보인다 (s17 미적용 진단)', async () => {
    server.failDeadline = {
      code: 'PGRST202',
      message: 'Could not find the function climate_vote.topic_set_deadline',
      hint: null,
      details: null,
    };
    await input(page).fill(LOCAL_INPUT);
    await page.locator('[data-testid="hq-deadline-set"]').click();
    await page.waitForFunction(
      () => (document.querySelector('[data-testid="hq-deadline-error"]')?.textContent ?? '').includes('PGRST202'),
      undefined,
      { timeout: 15_000 }
    );
    const t = await alertText(page);
    const role = await page.locator('[data-testid="hq-deadline-error"]').getAttribute('role');
    must(role === 'alert', `role 이 ${role} 다`);
    must(t.includes('걸지 못했습니다'), `문구가 "${t}" 다`);
    must(t.includes('topic_set_deadline'), `서버 문구가 안 실렸다 — "${t}"`);
    await page.screenshot({ path: `${SHOTS}/us011-alert.png`, fullPage: false });
    return `"${t}"`;
  });

  await check('실패한 경고가 다른 꼭지로 따라가지 않는다', async () => {
    const topic2Prompt = topicRows(TOPIC2_ID)[0].topic_prompt;
    await pickTopic(page, topic2Prompt);
    const n = await page.locator('[data-testid="hq-deadline-error"]').count();
    must(n === 0, `꼭지를 옮겼는데 경고가 ${n}개 남아 있다`);
    const label = (await row(page).innerText()).replace(/\s+/g, ' ');
    must(label.includes(topic2Prompt), `마감 줄 라벨이 "${label}" 다`);
    return `꼭지② "${topic2Prompt}" · 경고 0개`;
  });

  await check('꼭지마다 입력값이 따로 남는다', async () => {
    server.failDeadline = null;
    must((await input(page).inputValue()) === '', '꼭지②의 입력칸이 비어 있지 않다');
    await input(page).fill('2026-09-13T09:00');
    await pickTopic(page, topicRows(TOPIC_ID)[0].topic_prompt);
    const first = await input(page).inputValue();
    must(first === LOCAL_INPUT, `꼭지①이 "${first}" 다 — ${LOCAL_INPUT} 이어야 한다`);
    await pickTopic(page, topicRows(TOPIC2_ID)[0].topic_prompt);
    const second = await input(page).inputValue();
    must(second === '2026-09-13T09:00', `꼭지②가 "${second}" 다`);
    await page.screenshot({ path: `${SHOTS}/us011-row.png`, fullPage: false });
    return `꼭지① ${first} · 꼭지② ${second}`;
  });

  await check('미리보기 라우트(토큰 없음)에는 마감 줄이 없다 — 픽스처 화면은 안 바뀐다', async () => {
    const lab = await context.newPage();
    await lab.goto(URL_LAB, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await lab.waitForSelector('[role="tablist"]', { timeout: 60_000 });
    await lab.waitForTimeout(500);
    const n = await lab.locator('[data-testid="hq-deadline-row"]').count();
    must(n === 0, `토큰이 없는데 마감 줄이 ${n}개 있다`);
    const articles = await lab.locator('article').count();
    await lab.close();
    return `마감 줄 0개 · 카드 ${articles}장(그대로)`;
  });

  // ── 되읽기(s19) — 이 story 가 고친 결함 ─────────────────────────
  // 「본부가 마감을 걸고 새로고침하면 자기가 무엇을 걸었는지 모른다」

  await check('★★ 되읽기 — 마감을 걸고 화면을 다시 열면 그 값이 그대로 보인다', async () => {
    // 화면 상태를 처음부터 다시 만든다(꼭지①로 돌아가 마감을 건다).
    await pickTopic(page, topicRows(TOPIC_ID)[0].topic_prompt);
    sent.length = 0;
    await input(page).fill(LOCAL_INPUT);
    await page.locator('[data-testid="hq-deadline-set"]').click();
    await page.waitForTimeout(800);
    must(sent.length === 1, `RPC 가 ${sent.length}건 나갔다`);
    must(server.deadlines[TOPIC_ID] === EXPECTED_ISO, '서버 흉내가 값을 안 받았다');

    // ★ 여기가 핵심 — 새로 연다. s19 이전이라면 이 순간 「아직 걸지 않았습니다」가 됐다.
    await openHq(page);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="hq-deadline-echo"]')?.getAttribute(
          'data-deadline-source'
        ) === 'server',
      undefined,
      { timeout: 20_000 }
    );
    const label = await echoText(page);
    must(label.includes('2026-09-12 14:30'), `다시 연 화면의 표시가 "${label}" 다`);
    const prefilled = await input(page).inputValue();
    must(prefilled === LOCAL_INPUT, `입력칸이 "${prefilled}" 다 — ${LOCAL_INPUT} 이어야 한다`);
    await page.screenshot({ path: `${SHOTS}/us019-readback.png`, fullPage: false });
    return `표시 "${label}"(server) · 입력칸 "${prefilled}" · 되읽기 RPC ${calls.topic_deadlines}건`;
  });

  await check('★ 남(다른 본부 콘솔)이 건 마감이 폴링으로 따라온다', async () => {
    const other = new Date(2026, 8, 12, 16, 45, 0, 0).toISOString();
    server.deadlines[TOPIC_ID] = other;
    await page.waitForFunction(
      () =>
        (document.querySelector('[data-testid="hq-deadline-echo"]')?.textContent ?? '').includes(
          '16:45'
        ),
      undefined,
      { timeout: 20_000 }
    );
    const label = await echoText(page);
    must((await echoSource(page)) === 'server', `출처가 "${await echoSource(page)}" 다`);
    return `"${label}"`;
  });

  await check('★ 되읽기가 지움을 반영한다 — 다시 열면 「현재 마감 없음」', async () => {
    await page.locator('[data-testid="hq-deadline-clear"]').click();
    await page.waitForTimeout(800);
    must(server.deadlines[TOPIC_ID] === null, '서버 흉내에 마감이 남아 있다');
    await openHq(page);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="hq-deadline-echo"]')?.getAttribute(
          'data-deadline-source'
        ) === 'server',
      undefined,
      { timeout: 20_000 }
    );
    const label = await echoText(page);
    must(label.includes('현재 마감 없음'), `표시가 "${label}" 다`);
    must((await input(page).inputValue()) === '', `입력칸에 "${await input(page).inputValue()}" 가 남았다`);
    return `"${label}" · 입력칸 빈 칸`;
  });

  await check('★ s19 미적용(PGRST202) — 화면이 죽지 않고 s19 이전 표시로 퇴화한다', async () => {
    server.deadlinesMissing = true;
    server.deadlines = freshDeadlines();
    await openHq(page);
    await page.waitForTimeout(1200);
    must((await row(page).count()) === 1, '마감 줄이 사라졌다');
    must((await echoSource(page)) === 'unknown', `출처가 "${await echoSource(page)}" 다`);
    const label = await echoText(page);
    must(label.includes('아직'), `퇴화 문구가 "${label}" 다 — s19 이전 문구여야 한다`);
    must((await input(page).inputValue()) === '', `입력칸에 "${await input(page).inputValue()}" 가 남았다`);
    // 카드 수 불변식은 퇴화 상태에서도 그대로다.
    await page.locator('button', { hasText: '모아보기' }).first().click();
    await page.waitForTimeout(400);
    const n = await page.locator('[data-testid="note-grid"] article').count();
    must(n === CARDS_TOPIC1, `카드가 ${n}장 — 픽스처는 ${CARDS_TOPIC1}건`);
    await page.screenshot({ path: `${SHOTS}/us019-degraded.png`, fullPage: false });
    return `표시 "${label}"(unknown) · 카드 ${n}/${CARDS_TOPIC1}장`;
  });

  await check('★ 퇴화 상태에서도 걸기는 그대로 동작한다 — 「이 화면이 건 값」을 되비춘다', async () => {
    sent.length = 0;
    await input(page).fill(LOCAL_INPUT);
    await page.locator('[data-testid="hq-deadline-set"]').click();
    await page.waitForTimeout(800);
    must(sent.length === 1, `RPC 가 ${sent.length}건 나갔다`);
    must(sent[0].p_deadline_at === EXPECTED_ISO, `p_deadline_at 이 ${sent[0].p_deadline_at} 다`);
    must((await alertText(page)) === '', `실패 문구가 떴다 — "${await alertText(page)}"`);
    // ★ 서버를 못 읽었으므로 「서버 값」인 척하면 안 된다 — 출처는 local 이어야 한다.
    must((await echoSource(page)) === 'local', `출처가 "${await echoSource(page)}" 다`);
    const label = await echoText(page);
    must(label.includes('방금'), `표시가 "${label}" 다`);
    server.deadlinesMissing = false;
    return `p_deadline_at ${sent[0].p_deadline_at} · 표시 "${label}"(local)`;
  });

  await check('운영 DB 로 나간 요청 0건 · 실제 웹소켓 연결 0건', async () => {
    must(calls.escaped === 0, `rest/v1 밖으로 새어 나간 요청 ${calls.escaped}건`);
    const ws = await page.evaluate(() => window.__wsAttempts ?? []);
    const real = ws.filter((u) => !u.startsWith('ws://localhost'));
    must(
      ws.every((u) => typeof u === 'string'),
      '웹소켓 시도 기록이 이상하다'
    );
    return (
      `hq_submissions ${calls.hq_submissions} · kinds ${calls.hq_kinds} · ` +
      `topic_set_deadline ${calls.set_deadline} · hq_topic_deadlines ${calls.topic_deadlines} · ` +
      `기타 ${calls.other} — 전부 지어낸 응답 · ` +
      `WebSocket 시도 ${real.length}건 전부 스텁에 갇힘(실제 연결 0)`
    );
  });
} finally {
  await context.close();
  await browser.close();
}

console.log(`\n  ${pass} PASS / ${fail} FAIL`);
console.log(`  사진: ${SHOTS}\n`);
if (pass + fail === 0) {
  console.error(`  FAIL: 검사를 한 건도 돌지 못했다 — ${URL_HQ} 가 뜨는지 확인하라(npm run dev).\n`);
  process.exit(1);
}
process.exit(fail === 0 ? 0 : 1);
