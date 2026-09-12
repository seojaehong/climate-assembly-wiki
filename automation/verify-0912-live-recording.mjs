import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

if (!process.argv.includes('--write-authorized')) throw new Error('Explicit --write-authorized required for this production rehearsal');
const privateDirectory = process.env.WORKSHOP_PRIVATE_DIRECTORY;
if (!privateDirectory) throw new Error('WORKSHOP_PRIVATE_DIRECTORY is required');
const codes = JSON.parse(readFileSync(`${privateDirectory}/0912-rotated-join-codes-private.json`, 'utf8')).codes;
const teamEntry = codes.find((entry) => entry.teamName === '1분과 1조');
const concurrent = process.argv.includes('--concurrent');
const secondEntry = codes.find((entry) => entry.teamName === '2분과 1조');
const password = readFileSync(`${privateDirectory}/0912-hq-initial-credential-correction.sql`, 'utf8').match(/crypt\('([^']+)'\s*,/)?.[1];
if (!teamEntry?.joinCode || !password) throw new Error('Private credential inputs are incomplete');
const reportPath = `evaluation/0912-agenda-progress-board/${concurrent ? 'live-concurrent-recording' : 'live-recording'}.json`;
const report = { startedAt: new Date().toISOString(), phase: 'start', status: 'in_progress', namedHq: [], transitions: [], assignmentAdded: false, assignmentRestored: false, recommendationArchived: false, teamLoggedOut: false, hqLoggedOut: false };
const persist = () => writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const browser = await chromium.launch({ headless: true });
const hqContext = await browser.newContext();
const hq = await hqContext.newPage();
const teamContext = await browser.newContext();
const team = await teamContext.newPage();
const second = concurrent ? await (await browser.newContext()).newPage() : null;
for (const page of [hq, team, second].filter(Boolean)) { page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(90000); }
const title = `시스템 저장 점검 ${new Date().toISOString()} — 시민 의견 아님`;
const secondTitle = `${title} · 동시 입력 2분과`;
let agenda;
let assignment;
let testCard;
let secondAgenda;
let secondAssignment;
let secondCard;
const phase = (name) => { report.phase = name; persist(); console.log(`phase=${name}`); };
hq.on('dialog', async (dialog) => {
  if (report.phase === 'archive' && dialog.type() === 'prompt') await dialog.accept('운영 저장·재조회 점검 완료. 시민 의견이 아닌 시스템 점검 기록.');
  else await dialog.dismiss();
});
const loginHq = async (page, operator) => {
  await page.goto('https://climate-assembly-wiki.pages.dev/hq/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('운영자 표시 이름').fill(operator);
  await page.getByLabel('개인 비밀번호', { exact: true }).fill(password);
  await page.getByRole('button', { name: '본부 로그인', exact: true }).click();
  await page.getByRole('heading', { name: '분과별 권고안 진행상황판', exact: true }).waitFor();
  await page.locator('article[data-agenda-subgroup]').first().waitFor();
  const counts = {};
  for (const division of ['1분과', '2분과', '3분과']) counts[division] = await page.locator(`article[data-agenda-subgroup="${division}"]`).count();
  if (counts['1분과'] !== 9 || counts['2분과'] !== 8 || counts['3분과'] !== 8) throw new Error('Live agenda catalog differs from the authorized initial catalog');
  report.namedHq.push({ operator, counts });
  persist();
};
const loginTeam = async (page, entry) => {
  await page.goto(`https://climate-assembly-wiki.pages.dev/mod?code=${encodeURIComponent(entry.joinCode)}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '나가기', exact: true }).waitFor();
  await page.getByRole('tab', { name: '의제·권고안 기록', exact: true }).click();
  await page.getByRole('heading', { name: '우리 조 권고안 작성', exact: true }).waitFor();
  await page.getByRole('button', { name: '+ 권고안 추가', exact: true }).first().waitFor();
};
const createCard = async (page, cardTitle, retryLostResponse = false) => {
  await page.getByRole('button', { name: '+ 권고안 추가', exact: true }).first().click();
  await page.getByLabel('새 권고안 권고안 제목', { exact: true }).fill(cardTitle);
  await page.getByLabel('새 권고안 배경·문제 인식', { exact: true }).fill('시스템 점검 문안입니다. 시민 의견이나 정책 제안으로 집계하지 않습니다.');
  await page.getByLabel('새 권고안 권고 내용', { exact: true }).fill('운영 저장·재조회·단계 전환을 확인한 뒤 HQ에서 보관 처리합니다.');
  await page.getByRole('button', { name: '새 권고안 저장', exact: true }).click();
  if (retryLostResponse) await page.getByRole('button', { name: '같은 내용으로 다시 확인', exact: true }).click();
  const card = page.locator('section[data-recommendation-id]').filter({ has: page.getByRole('heading', { name: cardTitle, exact: true }) });
  await card.waitFor();
  return card;
};
try {
  phase('hq-logins');
  for (const operator of ['강혜연', '박진환']) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    await loginHq(page, operator);
    await page.getByRole('button', { name: '로그아웃', exact: true }).click();
    await page.getByRole('button', { name: '본부 로그인', exact: true }).waitFor();
    await ctx.close();
  }
  await loginHq(hq, '서재홍');
  phase('projectors');
  report.projectors = [];
  for (const division of ['1분과', '2분과', '3분과']) {
    await hq.getByRole('button', { name: `${division} 현황 송출`, exact: true }).click();
    await hq.getByRole('heading', { name: `${division} 권고안 진행상황`, exact: true }).waitFor();
    report.projectors.push(division);
    await hq.getByRole('button', { name: '운영 화면으로', exact: true }).click();
  }
  phase('assignment');
  agenda = hq.locator('article[data-agenda-subgroup="1분과"]').first();
  report.agendaTitle = await agenda.locator('h3').textContent();
  assignment = agenda.getByRole('button', { name: /^(✓ )?1조$/ });
  const initiallyAssigned = await assignment.getAttribute('aria-pressed') === 'true';
  report.initiallyAssigned = initiallyAssigned;
  if (!initiallyAssigned) {
    await assignment.click();
    await hq.waitForFunction(() => document.querySelector('article[data-agenda-subgroup="1분과"] button[aria-pressed="true"]') !== null);
    if (await assignment.getAttribute('aria-pressed') !== 'true') throw new Error('Assignment was not confirmed');
    report.assignmentAdded = true;
    persist();
  }
  if (second) {
    secondAgenda = hq.locator('article[data-agenda-subgroup="2분과"]').first();
    secondAssignment = secondAgenda.getByRole('button', { name: /^(✓ )?1조$/ });
    report.secondInitiallyAssigned = await secondAssignment.getAttribute('aria-pressed') === 'true';
    if (!report.secondInitiallyAssigned) {
      await secondAssignment.click();
      await secondAgenda.getByRole('button', { name: '✓ 1조', exact: true }).waitFor();
      report.secondAssignmentAdded = true;
    }
    let firstRequestId;
    report.responseLoss = { dropped: 0, attempts: 0, upstreamCommitted: false, sameRequestId: false };
    await second.route('**/rest/v1/rpc/recommendation_create_v2', async (route) => {
      const body = route.request().postDataJSON();
      if (body.p_title !== secondTitle) return route.continue();
      report.responseLoss.attempts += 1;
      if (report.responseLoss.dropped === 0) {
        firstRequestId = body.p_request_id;
        const response = await route.fetch();
        report.responseLoss.upstreamCommitted = response.ok();
        report.responseLoss.dropped = 1;
        persist();
        await route.abort('failed');
      } else {
        report.responseLoss.sameRequestId = Boolean(firstRequestId && firstRequestId === body.p_request_id);
        await route.continue();
      }
    });
    persist();
  }
  phase('team-login');
  await Promise.all([loginTeam(team, teamEntry), ...(second ? [loginTeam(second, secondEntry)] : [])]);
  phase('create');
  [testCard, secondCard] = await Promise.all([createCard(team, title), ...(second ? [createCard(second, secondTitle, true)] : [])]);
  report.recommendationId = await testCard.getAttribute('data-recommendation-id');
  if (secondCard) report.secondRecommendationId = await secondCard.getAttribute('data-recommendation-id');
  report.transitions.push(await testCard.getAttribute('data-recommendation-status'));
  persist();
  phase('read-back');
  await team.reload({ waitUntil: 'domcontentloaded' });
  await testCard.waitFor();
  report.readBack = await testCard.locator('input').first().inputValue() === title;
  if (!report.readBack) throw new Error('Stored title did not survive reload');
  if (second) {
    await second.reload({ waitUntil: 'domcontentloaded' });
    await secondCard.waitFor();
    report.secondReadBack = await secondCard.locator('input').first().inputValue() === secondTitle;
    report.divisionIsolation = await team.getByRole('heading', { name: secondTitle, exact: true }).count() === 0
      && await second.getByRole('heading', { name: title, exact: true }).count() === 0;
    if (!report.secondReadBack || !report.divisionIsolation || !report.responseLoss.upstreamCommitted || !report.responseLoss.sameRequestId) throw new Error('Concurrent read-back or retry contract failed');
  }
  phase('transitions');
  for (const [label, status] of [['논의 시작', 'discussing'], ['초안 작성 완료', 'drafting'], ['조 확인 완료', 'team_confirmed'], ['최종 제출', 'submitted']]) {
    await testCard.getByRole('button', { name: label, exact: true }).click();
    await team.locator(`[data-recommendation-id="${report.recommendationId}"][data-recommendation-status="${status}"]`).waitFor();
    report.transitions.push(status);
    persist();
  }
  phase('hq-read-back');
  await hq.getByRole('button', { name: '지금 새로고침', exact: true }).click();
  const expand = agenda.getByRole('button', { name: '권고안 펼치기', exact: true });
  if (await expand.count()) await expand.click();
  await hq.locator(`[data-recommendation-id="${report.recommendationId}"][data-recommendation-status="submitted"]`).waitFor();
  report.hqReadBack = true;
  if (second) {
    const secondExpand = secondAgenda.getByRole('button', { name: '권고안 펼치기', exact: true });
    if (await secondExpand.count()) await secondExpand.click();
    await hq.locator(`[data-recommendation-id="${report.secondRecommendationId}"]`).waitFor();
    report.retryCreatedExactlyOne = await secondAgenda.getByRole('heading', { name: secondTitle, exact: true }).count() === 1;
    if (!report.retryCreatedExactlyOne) throw new Error('Retry created duplicate records');
  }
  phase('archive');
  await hq.locator(`[data-recommendation-id="${report.recommendationId}"]`).getByRole('button', { name: '권고안 보관', exact: true }).click();
  await hq.locator(`[data-recommendation-id="${report.recommendationId}"]`).waitFor({ state: 'hidden' });
  report.recommendationArchived = true;
  if (second) {
    await hq.locator(`[data-recommendation-id="${report.secondRecommendationId}"]`).getByRole('button', { name: '권고안 보관', exact: true }).click();
    await hq.locator(`[data-recommendation-id="${report.secondRecommendationId}"]`).waitFor({ state: 'hidden' });
    report.secondRecommendationArchived = true;
  }
  persist();
  phase('restore-assignment');
  if (report.assignmentAdded) {
    await assignment.click();
    await hq.waitForFunction(() => {
      const buttons = [...document.querySelectorAll('article[data-agenda-subgroup="1분과"]')][0]?.querySelectorAll('button[aria-pressed]');
      return buttons && [...buttons].some((button) => button.textContent?.trim() === '1조' && button.getAttribute('aria-pressed') === 'false');
    });
  }
  report.assignmentRestored = true;
  if (report.secondAssignmentAdded) {
    await secondAssignment.click();
    await secondAgenda.getByRole('button', { name: '1조', exact: true }).waitFor();
  }
  if (second) report.secondAssignmentRestored = true;
  phase('logout');
  await team.getByRole('button', { name: '나가기', exact: true }).click();
  await team.getByRole('button', { name: '조에서 나가기', exact: true }).click();
  await team.getByRole('button', { name: '나가기', exact: true }).waitFor({ state: 'hidden' });
  report.teamLoggedOut = true;
  if (second) {
    await second.getByRole('button', { name: '나가기', exact: true }).click();
    await second.getByRole('button', { name: '조에서 나가기', exact: true }).click();
    await second.getByRole('button', { name: '나가기', exact: true }).waitFor({ state: 'hidden' });
    report.secondTeamLoggedOut = true;
  }
  await hq.getByRole('button', { name: '로그아웃', exact: true }).click();
  await hq.getByRole('button', { name: '본부 로그인', exact: true }).waitFor();
  report.hqLoggedOut = true;
  report.status = 'pass';
  phase('complete');
} catch (error) {
  report.status = 'fail';
  report.errorType = error instanceof Error ? error.name : 'UnknownError';
  // Do not emit exception messages: browser errors can include secret URLs.
  persist();
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  persist();
  console.log(JSON.stringify(report));
  await browser.close();
}
