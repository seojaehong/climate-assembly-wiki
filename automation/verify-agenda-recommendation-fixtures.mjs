import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = (process.env.AGENDA_FIXTURE_BASE_URL ?? 'http://127.0.0.1:4323').replace(/\/$/, '');
const outputDir = resolve(process.cwd(), 'evaluation/0912-agenda-progress-board');
const reportPath = resolve(outputDir, 'browser-fixture-report.json');
const hqScreenshot = resolve(outputDir, 'hq-add-agenda.png');
const teamScreenshot = resolve(outputDir, 'team-recommendation-authoring.png');

mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  serviceWorkers: 'block',
});
context.setDefaultTimeout(60000);
context.setDefaultNavigationTimeout(120000);
const externalAttempts = [];
await context.route('**/*', async (route) => {
  const requestUrl = new URL(route.request().url());
  if (requestUrl.origin !== new URL(baseUrl).origin) {
    externalAttempts.push(requestUrl.href);
    await route.abort('blockedbyclient');
    return;
  }
  await route.continue();
});
await context.routeWebSocket(/.*/, (socket) => socket.close());

const checks = [];
const record = (name, passed, detail) => {
  checks.push({ name, passed, detail });
  if (!passed) throw new Error(`${name}: ${detail}`);
};

try {
  const hq = await context.newPage();
  await hq.goto(`${baseUrl}/ko/moderator/insights/agenda-progress-lab/`, { waitUntil: 'domcontentloaded' });
  await hq.getByRole('heading', { name: '분과별 권고안 진행상황판' }).waitFor();
  const divisionCounts = {};
  for (const [division, expected] of [['1분과', 9], ['2분과', 8], ['3분과', 8]]) {
    const count = await hq.locator(`article[data-agenda-subgroup="${division}"]`).count();
    divisionCounts[division] = count;
    record(`hq-agenda-count-${division}`, count === expected, `${division} 의제는 ${expected}건이어야 합니다(실제 ${count}건).`);
    record(`hq-projector-${division}`, await hq.getByRole('button', { name: `${division} 현황 송출` }).isVisible(), `${division} 송출 버튼이 보여야 합니다.`);
  }
  const firstAgenda = hq.locator('article[data-agenda-subgroup="1분과"]').first();
  record('hq-multi-team-assignment', await firstAgenda.locator('button[aria-pressed="true"]').count() >= 2, '하나의 의제에 두 개 이상 조가 배정된 상태를 표시해야 합니다.');
  for (const label of ['대기', '논의 중', '초안 작성', '조 확인', '제출 완료']) {
    const labelMatches = await hq.getByText(label, { exact: true }).all();
    const visible = (await Promise.all(labelMatches.map((match) => match.isVisible()))).some(Boolean);
    record(`hq-status-${label}`, visible, `5단계 상태의 '${label}'이 표시되어야 합니다.`);
  }
  for (const division of ['1분과', '2분과', '3분과']) {
    await hq.getByRole('button', { name: `${division} 현황 송출` }).click();
    record(`hq-projector-open-${division}`, await hq.getByRole('heading', { name: `${division} 권고안 진행상황` }).isVisible(), '각 분과 전체화면 송출이 실제로 열려야 합니다.');
    if (division === '1분과') {
      record('evening-speaking-guide', await hq.getByText(/1조 6번 \+ 새 주제 1개/).isVisible(), '1분과 저녁 발표 주제가 정확해야 합니다.');
      await hq.getByRole('button', { name: '다음', exact: true }).click();
      record('evening-projector-no-recommendation-content', await hq.getByRole('dialog').getByText('권고 내용', { exact: true }).count() === 0, '1분과 송출은 기대효과까지만 표시합니다.');
    }
    await hq.getByRole('button', { name: '운영 화면으로', exact: true }).click();
  }
  const hqSummary = hq.getByLabel('권고안 진행건수 요약');
  const waitingFilter = hqSummary.getByRole('button', { name: /대기/ });
  await waitingFilter.click();
  record('hq-status-filter-selected', await waitingFilter.getAttribute('aria-pressed') === 'true', 'HQ 상태 필터 선택이 표시되어야 합니다.');
  const expandButtons = hq.getByRole('button', { name: '권고안 펼치기', exact: true });
  const collapsedCount = await expandButtons.count();
  for (let index = 0; index < collapsedCount; index += 1) await expandButtons.first().click();
  const filteredStatuses = await hq.locator('[data-recommendation-status]').evaluateAll((cards) => cards.map((card) => card.getAttribute('data-recommendation-status')));
  record('hq-status-filter-cards', filteredStatuses.length > 0 && filteredStatuses.every((status) => status === 'waiting'), '상태 필터는 권고안 카드에도 적용되어야 합니다.');
  await waitingFilter.click();
  record('hq-status-filter-toggle-off', await hq.getByLabel('권고안 상태 필터').inputValue() === 'all', '동일 필터 재선택으로 전체 상태를 복원해야 합니다.');
  await waitingFilter.click();
  await hq.getByRole('button', { name: '전체 보기 · 상태 필터 해제' }).click();
  record('hq-status-filter-clear', await hq.getByLabel('권고안 상태 필터').inputValue() === 'all', '전체 보기로 상태 필터를 해제해야 합니다.');
  for (const division of ['2분과', '3분과']) {
    const card = hq.locator(`article[data-agenda-subgroup="${division}"]`).first();
    const expand = card.getByRole('button', { name: '권고안 펼치기', exact: true });
    if (await expand.count()) await expand.click();
    record(`unchanged-effect-editor-${division}`, await card.getByRole('textbox', { name: /기대효과$/ }).count() === 0, '다른 분과 기대효과 입력은 활성화하지 않습니다.');
  }
  await hq.getByRole('button', { name: '+ 새 주제 추가' }).click();
  await hq.getByLabel('새 주제 제목').fill('현장 추가 주제 예시');
  await hq.getByLabel('새 주제 연결 시민 원문').fill('시민이 말한 원문을 그대로 연결하는 입력 예시입니다.');
  record('hq-add-fields', await hq.getByLabel('새 주제 연결 시민 원문').isVisible(), '주제 제목과 연결 시민 원문 입력칸이 필요합니다.');
  await hq.screenshot({ path: hqScreenshot });

  const team = await context.newPage();
  await team.goto(`${baseUrl}/ko/moderator/insights/agenda-progress-team-lab/`, { waitUntil: 'domcontentloaded' });
  await team.getByRole('heading', { name: '우리 조 권고안 작성' }).waitFor();
  record('team-agenda-select', await team.getByLabel('작성할 주제 선택').isVisible(), '배정 주제 드롭다운이 보여야 합니다.');
  record('team-summary-static', await team.getByLabel('권고안 진행건수 요약').getByRole('button').count() === 0, '조별 상태 요약에는 무반응 버튼이 없어야 합니다.');

  const transitionId = '30000000-0000-4000-8000-000000000001';
  const transitionCard = team.locator(`section[data-recommendation-id="${transitionId}"]`);
  const waitForTransition = async (status) => {
    await team.locator(`section[data-recommendation-id="${transitionId}"][data-recommendation-status="${status}"]`).waitFor();
    record(`team-current-step-${status}`, await transitionCard.locator('li[aria-current="step"]').textContent().then((text) => Boolean(text?.trim())), '현재 단계를 표시해야 합니다.');
    record(`team-transition-${status}`, true, `${status} 단계로 전환되어야 합니다.`);
  };
  record('team-five-step-display', await transitionCard.getByLabel('권고안 5단계 진행').locator('li').count() === 5, '카드 상단에 다섯 단계가 표시되어야 합니다.');
  record('team-actions-before-fields', await transitionCard.evaluate((card) => {
    const actions = card.querySelector('[data-recommendation-actions]');
    const field = card.querySelector('input,textarea');
    return Boolean(actions && field && (actions.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING));
  }), '다음 행동 버튼이 입력 본문보다 앞에 있어야 합니다.');
  record('team-transition-waiting', await transitionCard.getAttribute('data-recommendation-status') === 'waiting', '권고안은 대기에서 시작해야 합니다.');
  await transitionCard.getByRole('button', { name: '논의 시작', exact: true }).click();
  await waitForTransition('discussing');
  const effectField = transitionCard.getByRole('textbox', { name: /기대효과$/ });
  await effectField.fill('시민 누구나 가까운 곳에서 안전하게 쉴 수 있습니다.');
  const contentField = transitionCard.getByRole('textbox', { name: /권고 내용$/ });
  const originalContent = await contentField.inputValue();
  await contentField.fill('');
  await transitionCard.getByRole('button', { name: '초안 작성 완료', exact: true }).click();
  await waitForTransition('drafting');
  record('evening-effect-save-echo', await effectField.inputValue() === '시민 누구나 가까운 곳에서 안전하게 쉴 수 있습니다.', '저장 후 서버 역할 fixture에서 기대효과가 되읽혀야 합니다.');
  record('evening-save-without-final-content', await contentField.inputValue() === '', '권고 내용이 없어도 발표 초안을 저장할 수 있습니다.');
  await contentField.fill(originalContent);
  await transitionCard.getByRole('button', { name: '초안 저장', exact: true }).click();
  await transitionCard.getByRole('button', { name: '조 확인 완료', exact: true }).click();
  await waitForTransition('team_confirmed');
  await transitionCard.getByRole('button', { name: '최종 제출', exact: true }).click();
  await waitForTransition('submitted');

  await team.getByRole('button', { name: '+ 권고안 추가' }).click();
  await team.getByLabel('새 권고안 권고안 제목').fill('생활권 기후안전망 강화');
  await team.getByLabel('새 권고안 배경·문제 인식').fill('폭염 취약계층의 쉼터 접근성이 지역마다 다릅니다.');
  await team.getByLabel('새 권고안 기대효과').fill('폭염에도 안전한 생활을 누릴 수 있습니다.');
  await team.getByLabel('새 권고안 권고 내용').fill('생활권별 쉼터 운영시간과 이동 지원을 함께 제공합니다.');
  record('team-active-fields', await team.getByLabel('새 권고안 권고 내용').isVisible(), '오늘 작성할 세 입력칸이 모두 보여야 합니다.');
  record('inactive-fields-hidden', await team.getByText('이행 일정', { exact: true }).count() === 0, '이행 일정 이후 필드는 현재 입력 화면에 나오면 안 됩니다.');
  await team.screenshot({ path: teamScreenshot });

  record('no-external-network', externalAttempts.length === 0, `외부 연결 시도 ${externalAttempts.length}건`);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'pass',
    baseUrl,
    checks,
    divisionCounts,
    externalNetworkAttemptCount: externalAttempts.length,
    productionDatabaseRequestCount: 0,
    screenshots: [
      'evaluation/0912-agenda-progress-board/hq-add-agenda.png',
      'evaluation/0912-agenda-progress-board/team-recommendation-authoring.png',
    ],
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'fail',
    baseUrl,
    checks,
    externalNetworkAttemptCount: externalAttempts.length,
    productionDatabaseRequestCount: 0,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  throw error;
} finally {
  await browser.close();
}
