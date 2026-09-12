import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const origin = 'https://climate-assembly.org';
const privateDir = process.env.WORKSHOP_PRIVATE_DIRECTORY;
if (!privateDir) throw new Error('Private credential directory required');
const codes = JSON.parse(readFileSync(`${privateDir}/0912-rotated-join-codes-private.json`, 'utf8')).codes;
const password = readFileSync(`${privateDir}/0912-hq-initial-credential-correction.sql`, 'utf8').match(/crypt\('([^']+)'\s*,/)?.[1];
if (!password) throw new Error('HQ credential unavailable');
const report = { startedAt: new Date().toISOString(), status: 'running', mode: 'live-read-and-intercepted-write', checks: [], liveTeams: [], blockedRpc: [], interceptedWrites: 0, productionContentWrites: 0 };
const output = 'evaluation/0912-agenda-progress-board/division1-evening-deep-test.json';
const persist = () => writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
const check = (name, passed) => { report.checks.push({ name, passed }); persist(); if (!passed) throw new Error(name); };
const allowed = new Set(['mod_exchange_join_code', 'mod_session_get', 'attendance_hq_unlock_named', 'workshop_team_logout_v2', 'workshop_hq_logout_v2', 'agenda_board_v2', 'topic_list_v2', 'submission_get_v2', 'mod_rounds_v2', 'mod_vote_counts_v2', 'mod_votes_v2', 'mod_session_teams_v2', 'workshop_hq_status', 'workshop_hq_devices', 'attendance_round_eligible_count_v2', 'ballot_list_v2', 'ballot_results_v2']);
const browser = await chromium.launch({ headless: true });
const actors = [];
const syntheticAgendas = [];
const expected = [];
const requests = new Map();
let lostResponse = false;
let liveHqBoard;
async function actor(entry) {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
  const state = { context, page: await context.newPage(), entry, isolated: Boolean(entry), board: entry ? { ...structuredClone(liveHqBoard), scope: 'team', teamId: entry.teamId, teamSubgroup: '1분과', agendas: liveHqBoard.agendas.filter(a => a.assignments.some(x => x.teamId === entry.teamId)) } : null, sessionToken: null, authHeaders: null, rpcOrigin: null };
  if (entry) {
    state.syntheticSession = { v: 1, accessToken: 'a'.repeat(64), expiresAt: '2026-09-15T00:00:00Z', deviceId: randomUUID(), deviceLabel: 'Isolated test', sessionId: randomUUID(), sessionSlug: '0912-deliberation', team: { id: entry.teamId, name: entry.teamName, subgroup: '1분과', capacity: 10, table_no: String(entry.tableNo ?? '') } };
    await context.addInitScript(session => localStorage.setItem('climate_vote_mod_session_v1', JSON.stringify(session)), state.syntheticSession);
  }
  actors.push(state);
  state.page.setDefaultTimeout(25000);
  await context.routeWebSocket(/.*/, socket => socket.close());
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    const rpc = /\/rest\/v1\/rpc\/([^/]+)$/.exec(url.pathname)?.[1];
    if (!rpc) {
      if (url.origin !== origin || /\/rest\/|\/realtime\//.test(url.pathname)) return route.abort('blockedbyclient');
      return route.continue();
    }
    const body = route.request().postDataJSON();
    const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    if (entry && rpc === 'mod_session_get') return json(state.syntheticSession);
    if (entry && rpc === 'workshop_team_logout_v2') return json(true);
    if (state.isolated && rpc === 'agenda_board_v2') {
      const own = syntheticAgendas.filter(a => a.assignments.some(x => x.teamId === entry?.teamId));
      return json({ ...state.board, agendas: entry ? (own.length ? own : state.board.agendas) : syntheticAgendas });
    }
    if (state.isolated && ['recommendation_create_v2', 'recommendation_revise_v2'].includes(rpc)) {
      report.interceptedWrites += 1;
      if (!requests.has(body.p_request_id)) {
        if (rpc === 'recommendation_create_v2') {
          const agenda = syntheticAgendas.find(a => a.id === body.p_agenda_id);
          if (!agenda || body.p_team_id !== entry?.teamId) throw new Error('Synthetic assignment mismatch');
          const rec = { id: randomUUID(), authorTeamId: entry.teamId, authorTeamName: entry.teamName, sortOrder: agenda.recommendations.length + 1, title: body.p_title, problemRecognition: body.p_problem_recognition, recommendationContent: body.p_recommendation_content, expectedEffect: body.p_expected_effect, status: 'drafting', feedback: null, updatedAt: new Date().toISOString(), archived: false, revisionVersion: 1, revisionCount: 1, progressCount: 1 };
          agenda.recommendations.push(rec);
          requests.set(body.p_request_id, rec.id);
        } else {
          const rec = syntheticAgendas.flatMap(a => a.recommendations).find(r => r.id === body.p_recommendation_id);
          if (!rec || rec.authorTeamId !== entry?.teamId || body.p_expected_version !== rec.revisionVersion) throw new Error('Synthetic revision mismatch');
          Object.assign(rec, { title: body.p_title, problemRecognition: body.p_problem_recognition, recommendationContent: body.p_recommendation_content, expectedEffect: body.p_expected_effect, revisionVersion: rec.revisionVersion + 1, updatedAt: new Date().toISOString() });
          requests.set(body.p_request_id, rec.id);
        }
        if (!lostResponse && rpc === 'recommendation_create_v2') { lostResponse = true; return route.abort('failed'); }
      }
      return json(requests.get(body.p_request_id));
    }
    if (!allowed.has(rpc)) { report.blockedRpc.push(rpc); return route.abort('blockedbyclient'); }
    if (entry) return json([]);
    const response = await route.fetch();
    report.rpcResponses ??= [];
    report.rpcResponses.push({ rpc, status: response.status() });
    if (rpc === 'agenda_board_v2' && response.ok()) { state.board = await response.json(); state.sessionToken = body.p_token; state.authHeaders = await route.request().allHeaders(); state.rpcOrigin = url.origin; }
    return route.fulfill({ response });
  });
  return state;
}
try {
  const hq = await actor(null);
  await hq.page.goto(`${origin}/hq/`, { waitUntil: 'domcontentloaded' });
  await hq.page.getByLabel('운영자 표시 이름').fill('서재홍');
  await hq.page.getByLabel('개인 비밀번호', { exact: true }).fill(password);
  await hq.page.getByRole('button', { name: '본부 로그인', exact: true }).click();
  await hq.page.locator('article[data-agenda-subgroup]').first().waitFor();
  liveHqBoard = structuredClone(hq.board);
  const deviceResponse = await hq.context.request.post(`${hq.rpcOrigin}/rest/v1/rpc/workshop_hq_devices`, { headers: hq.authHeaders, data: { p_token: hq.sessionToken, p_session_slug: '0912-deliberation' } });
  if (deviceResponse.ok()) {
    const devices = await deviceResponse.json();
    report.liveDeviceCounts = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`1분과 ${index + 1}조`, devices.filter(d => d.team_name === `1분과 ${index + 1}조`).length]));
  }
  for (let n = 1; n <= 5; n += 1) {
    console.log(`team-${n}`);
    const entry = codes.find(c => c.teamName === `1분과 ${n}조`);
    if (!entry) throw new Error(`Missing private access for team ${n}`);
    const state = await actor(entry);
    const page = state.page;
    await page.goto(`${origin}/mod/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: '의제·권고안 기록', exact: true }).click();
    await page.getByRole('heading', { name: '우리 조 권고안 작성', exact: true }).waitFor();
    await page.getByRole('button', { name: '+ 권고안 추가', exact: true }).first().waitFor();
    const live = state.board;
    check(`team-${n}-hq-read-writable`, live?.teamId === entry.teamId && live?.stageIntegrity?.writable === true);
    const primaryOrdinal = [6, 3, 4, 8, 7][n - 1];
    const livePrimary = live.agendas.find(a => !a.archived && a.ordinal === primaryOrdinal);
    if (livePrimary) {
      await page.getByLabel('작성할 주제 선택').selectOption(livePrimary.id);
      const label = await page.locator('article[data-agenda-subgroup="1분과"]').first().locator('p').first().textContent();
      report.topicNumbers ??= [];
      report.topicNumbers.push({ team: entry.teamName, canonical: primaryOrdinal, displayed: Number(/주제 (\d+)/.exec(label ?? '')?.[1]) });
    }
    report.liveTeams.push({ team: entry.teamName, writable: live.stageIntegrity.writable, assignedOrdinals: live.agendas.filter(a => !a.archived).map(a => a.ordinal), primaryAssigned: live.agendas.some(a => !a.archived && a.ordinal === primaryOrdinal), recommendationCount: live.agendas.flatMap(a => a.recommendations).filter(r => !r.archived && r.authorTeamId === entry.teamId).length, addedTopicAssigned: live.agendas.some(a => !a.archived && a.ordinal > 9) });
    check(`team-${n}-primary-assigned`, report.liveTeams.at(-1).primaryAssigned);
    for (let slot = 1; slot <= 2; slot += 1) {
      const base = live.agendas.find(a => !a.archived && a.ordinal === (slot === 1 ? primaryOrdinal : n === 5 ? 5 : primaryOrdinal));
      if (!base) throw new Error(`Team ${n} missing agenda`);
      syntheticAgendas.push({ ...structuredClone(base), id: randomUUID(), title: `격리 검증 ${n}조 ${slot}번째 주제`, ordinal: slot === 1 ? primaryOrdinal : n === 5 ? 5 : 20 + n, recommendations: [], assignments: [{ teamId: entry.teamId, teamName: entry.teamName, assignedAt: new Date().toISOString() }] });
    }
    state.isolated = true;
    await page.getByRole('button', { name: '지금 새로고침', exact: true }).click();
    for (let slot = 1; slot <= 2; slot += 1) {
      const agenda = syntheticAgendas.find(a => a.title === `격리 검증 ${n}조 ${slot}번째 주제`);
      await page.getByLabel('작성할 주제 선택').selectOption(agenda.id);
      await page.getByRole('button', { name: '+ 권고안 추가', exact: true }).click();
      const title = `격리 검증 ${n}조 ${slot}번째 문안`;
      const problem = `${n}조 ${slot}번째 문제인식 문장입니다. 시민 의견이 아닌 격리 테스트입니다.`;
      let effect = `${n}조 ${slot}번째 기대효과로 모두가 안전하게 생활할 수 있습니다.`;
      await page.getByLabel('새 권고안 권고안 제목', { exact: true }).fill(title);
      await page.getByLabel('새 권고안 배경·문제 인식', { exact: true }).fill(problem);
      await page.getByLabel('새 권고안 기대효과', { exact: true }).fill(effect);
      if (n === 1 && slot === 1) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByLabel('새 권고안 기대효과', { exact: true }).waitFor();
        check('new-draft-reload', await page.getByLabel('새 권고안 기대효과', { exact: true }).inputValue() === effect);
      }
      await page.getByRole('button', { name: '새 권고안 저장', exact: true }).click();
      if (n === 1 && slot === 1) await page.getByRole('button', { name: '같은 내용으로 다시 확인', exact: true }).click();
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
      check(`team-${n}-slot-${slot}-payload`, agenda.recommendations.length === 1 && agenda.recommendations[0].problemRecognition === problem && agenda.recommendations[0].expectedEffect === effect && agenda.recommendations[0].recommendationContent === '');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByLabel('작성할 주제 선택').selectOption(agenda.id);
      const card = page.locator(`[data-recommendation-id="${agenda.recommendations[0].id}"]`);
      await card.waitFor();
      check(`team-${n}-slot-${slot}-reload`, await card.getByRole('textbox', { name: /기대효과$/ }).inputValue() === effect && await card.getByRole('textbox', { name: /배경·문제 인식$/ }).inputValue() === problem);
      if (n === 1 && slot === 1) {
        effect += ' 저장 전 수정한 문장도 유지됩니다.';
        await card.getByRole('textbox', { name: /기대효과$/ }).fill(effect);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByLabel('작성할 주제 선택').selectOption(agenda.id);
        check('unsent-revision-reload', await card.getByRole('textbox', { name: /기대효과$/ }).inputValue() === effect);
        await card.getByRole('button', { name: '초안 저장', exact: true }).click();
        await page.waitForFunction(() => !document.body.innerText.includes('기기 초안 미전송'));
        check('revision-effect-payload', agenda.recommendations[0].expectedEffect === effect);
      }
      expected.push({ agenda, title, problem, effect });
    }
  }
  console.log('hq-projector');
  hq.isolated = true;
  await hq.page.getByRole('button', { name: '지금 새로고침', exact: true }).click();
  for (const item of expected) {
    const article = hq.page.locator('article[data-agenda-subgroup]').filter({ has: hq.page.getByRole('heading', { name: item.agenda.title, exact: true }) });
    await article.getByRole('button', { name: '이 주제 송출', exact: true }).click();
    const dialog = hq.page.getByRole('dialog');
    check(`projector-${item.title}`, await dialog.getByText(item.problem, { exact: true }).isVisible() && await dialog.getByText(item.effect, { exact: true }).isVisible());
    if (item === expected[0]) {
      const teamPage = actors.find(a => a.entry?.teamName === '1분과 1조').page;
      await teamPage.getByLabel('작성할 주제 선택').selectOption(item.agenda.id);
      const card = teamPage.locator(`[data-recommendation-id="${item.agenda.recommendations[0].id}"]`);
      const revisedEffect = `${item.effect} 발표 중 갱신도 반영됩니다.`;
      await card.getByRole('textbox', { name: /기대효과$/ }).fill(revisedEffect);
      await card.getByRole('button', { name: '초안 저장', exact: true }).click();
      await dialog.getByText(revisedEffect, { exact: true }).waitFor();
      check('open-projector-follows-saved-update', true);
    }
    if (item === expected[0]) await dialog.screenshot({ path: 'evaluation/0912-agenda-progress-board/division1-evening-projector.png' });
    await dialog.getByRole('button', { name: '운영 화면으로', exact: true }).click();
  }
  check('ten-distinct-records', expected.length === 10 && syntheticAgendas.flatMap(a => a.recommendations).length === 10);
  check('lost-response-no-duplicate', lostResponse && report.interceptedWrites === 13 && requests.size === 12);
  check('no-unexpected-rpc', report.blockedRpc.length === 0);
  check('canonical-topic-numbers-preserved', report.topicNumbers.every(item => item.canonical === item.displayed));
  report.status = 'pass';
} catch (error) {
  report.status = 'fail';
  // Error messages from browser navigation can contain private URLs; do not persist them.
  report.failure = report.checks.at(-1)?.passed === false ? report.checks.at(-1).name : `Browser step failed after ${report.checks.at(-1)?.name ?? 'start'}`;
  report.diagnostic = String(error?.message ?? error).split('\n').slice(0, 2).join(' ').replace(/https?:\/\/[^\s"']+/g, '[URL]');
  const failedPage = actors.at(-1)?.page;
  if (failedPage) report.visibleLabels = await failedPage.locator('h1,h2,[role="tab"],button').allTextContents().catch(() => []);
  if (failedPage) report.alerts = await failedPage.getByRole('alert').allTextContents().catch(() => []);
  persist();
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  report.loggedOut = 0;
  for (const state of actors) {
    try { await state.page.getByRole('button', { name: state.entry ? '나가기' : '로그아웃', exact: true }).click({ timeout: 4000 }); report.loggedOut += 1; }
    catch { console.error('Test browser logout not confirmed'); }
  }
  await browser.close();
  report.finishedAt = new Date().toISOString();
  persist();
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, report: output }));
}
