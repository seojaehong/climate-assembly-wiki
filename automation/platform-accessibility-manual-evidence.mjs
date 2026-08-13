import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANUAL_ACCESSIBILITY_PROFILES = [
  { id: 'desktop-screen-reader', label: '데스크톱 스크린리더' },
  { id: 'mobile-screen-reader', label: '모바일 스크린리더' },
];

export const MANUAL_ACCESSIBILITY_SURFACES = [
  {
    id: 'platform-login',
    label: '플랫폼 로그인',
    path: '/platform/',
    setup: '로그아웃 상태에서 연다. 실제 자격증명은 증거 파일에 기록하지 않는다.',
    checks: [
      { id: 'skip-focus', procedure: '페이지 첫 포커스에서 본문 바로가기를 실행한다.', expected: '포커스가 로그인 폼으로 이동하고 스크린리더가 로그인 영역을 알린다.' },
      { id: 'form-labels', procedure: '아이디와 비밀번호 입력란을 탐색하고 이름·역할·값을 확인한다.', expected: '각 입력란의 보이는 레이블과 접근 가능한 이름이 일치하고 비밀번호 값은 읽히지 않는다.' },
      { id: 'error-announcement', procedure: '승인된 잘못된 테스트 값으로 로그인을 한 번 시도한다.', expected: '오류가 포커스 이동 없이 즉시 안내되고 다시 입력할 수 있다.' },
      { id: 'focus-order', procedure: 'Tab과 Shift+Tab으로 로그인 폼 전체를 왕복한다.', expected: '포커스 순서가 시각 순서와 일치하고 키보드 포커스가 갇히지 않는다.' },
    ],
  },
  {
    id: 'authenticated-platform',
    label: '인증 후 플랫폼',
    path: '/platform/',
    setup: '승인된 접근성 평가 계정으로 로그인한다. 계정·토큰은 승인된 비밀 채널로 받고 증거 파일에 기록하지 않는다.',
    checks: [
      { id: 'skip-focus', procedure: '페이지 첫 포커스에서 본문 바로가기를 실행한다.', expected: '포커스가 현재 스코프 본문으로 이동하고 현재 화면 제목이 안내된다.' },
      { id: 'tree-current-location', procedure: '조직 트리와 브레드크럼을 탐색한 뒤 다른 스코프로 이동한다.', expected: '현재 위치가 한 곳으로만 안내되고 이동 후 제목·현재 위치가 함께 갱신된다.' },
      { id: 'async-announcements', procedure: '읽기 전용 조회 탭을 열어 로딩과 완료 또는 빈 상태를 기다린다.', expected: '로딩과 완료·빈 상태가 중복 없이 안내되고 결과 건수를 인지할 수 있다.' },
      { id: 'controls-and-forms', procedure: '지원되는 탭·버튼·입력·선택 컨트롤을 키보드로 순서대로 조작한다.', expected: '각 컨트롤의 이름·역할·선택·busy 상태가 안내되고 모든 기능을 키보드로 실행할 수 있다.' },
      { id: 'logout-alert', procedure: '정상 로그아웃을 확인한다. 실패 경로는 승인된 격리 fixture에서만 실행한다.', expected: '정상 시 로그인 화면으로 돌아가고 fixture 실패 시 오류 alert가 안내되며 재시도할 수 있다.' },
    ],
  },
  {
    id: 'accessibility-statement',
    label: '접근성 성명',
    path: '/platform/accessibility/',
    setup: '로그인 없이 사용자 도메인의 접근성 성명을 연다.',
    checks: [
      { id: 'skip-focus', procedure: '페이지 첫 포커스에서 본문 바로가기를 실행한다.', expected: '포커스가 main으로 이동하고 접근성 성명 제목이 안내된다.' },
      { id: 'landmarks-and-headings', procedure: '랜드마크와 제목 목록으로 문서 전체를 탐색한다.', expected: 'main이 하나이고 제목 단계와 섹션 이름만으로 문서 구조를 이해할 수 있다.' },
      { id: 'link-purpose', procedure: '기준 원문·증거·제보 링크를 링크 목록과 본문에서 확인한다.', expected: '각 링크 목적과 새 탭 여부를 링크 이름만으로 알 수 있다.' },
    ],
  },
  {
    id: 'public-result-unpublished',
    label: '미공개 결과',
    path: '/r/<approved-unpublished-token>/',
    setup: '승인된 미공개 테스트 결과 토큰을 비밀 채널로 받아 연다. 토큰은 증거 파일에 기록하지 않는다.',
    checks: [
      { id: 'skip-focus', procedure: '페이지 첫 포커스에서 본문 바로가기를 실행한다.', expected: '포커스가 결과 상태 main으로 이동한다.' },
      { id: 'status-announcement', procedure: '페이지 로드가 끝날 때까지 결과 상태 안내를 듣는다.', expected: '미공개 상태와 다음 행동이 한 번 명확히 안내되고 공개 결과로 오인되지 않는다.' },
      { id: 'focus-order', procedure: 'Tab과 Shift+Tab으로 제공된 상호작용 요소를 왕복한다.', expected: '포커스가 보이고 논리적 순서를 따르며 갇히지 않는다.' },
    ],
  },
  {
    id: 'published-result',
    label: '공개 결과',
    path: '/r/<approved-published-token>/',
    setup: '개인정보가 없는 승인된 공개 테스트 snapshot 토큰을 비밀 채널로 받아 연다. 토큰은 증거 파일에 기록하지 않는다.',
    checks: [
      { id: 'skip-focus', procedure: '페이지 첫 포커스에서 본문 바로가기를 실행한다.', expected: '포커스가 공개 결과 main으로 이동하고 결과 제목이 안내된다.' },
      { id: 'landmarks-and-headings', procedure: '랜드마크와 제목 목록으로 결과 전체를 탐색한다.', expected: '결과 범위·요약·쟁점·대체표·다운로드 구조를 제목만으로 찾을 수 있다.' },
      { id: 'hitl-meaning', procedure: '검수 완료·초안·보관 상태가 섞인 쟁점을 읽는다.', expected: '각 상태의 보이는 라벨과 설명이 함께 안내되어 색상이나 AI 출처를 추정할 필요가 없다.' },
      { id: 'table-navigation', procedure: '쟁점 표와 커버리지 표를 표 탐색 명령으로 행·열 이동한다.', expected: 'caption과 행·열 머리글이 각 데이터 셀에 연결되고 현재 셀의 의미를 이해할 수 있다.' },
      { id: 'details-and-scroll', procedure: '두 표 대체본을 펼치고 각 명명된 영역에 포커스한 뒤 방향키·Home·End로 가로 이동한다.', expected: '펼침 상태가 안내되고 표 영역만 스크롤되며 포커스가 사라지거나 문서 내용이 잘리지 않는다.' },
    ],
  },
  {
    id: 'ontology-review',
    label: '온톨로지 검수 큐',
    path: '/ko/moderator/ontology-review/',
    setup: '승인된 접근성 평가 계정으로 로그인한 뒤 비식별 Canvas snapshot과 sealed review plan을 준비한다. 화면의 인증 검수자 ID는 Auth 사용자 UUID에서 파생되며 계정·토큰·파일 내용·검수자 ID는 증거 JSON에 기록하지 않는다.',
    checks: [
      { id: 'skip-focus', procedure: '페이지 첫 포커스에서 본문 바로가기를 실행한다.', expected: '포커스가 온톨로지 검수 main으로 이동하고 화면 제목이 안내된다.' },
      { id: 'auth-boundary', procedure: '로그인 전 검수 파일·마이크 컨트롤이 없는지 확인하고 승인된 계정으로 로그인한 뒤 로그아웃한다.', expected: '인증 전에는 로그인 폼만 제공되고 인증 후에만 로컬 검수 작업대가 나타난다. 세 검수 패널은 같은 읽기 전용 인증 검수자 ID를 표시하고 로그아웃 즉시 파일·음성·전사 초안이 제거된다.' },
      { id: 'upload-controls', procedure: 'plan 파일과 snapshot 파일 입력을 탐색하고 키보드로 값을 지정한 뒤 인증 검수자 ID가 편집 불가능한 텍스트인지 확인한다.', expected: '두 파일 입력의 보이는 레이블과 접근 가능한 이름이 일치하고 인증 검수자 ID는 별도 입력 없이 표시되며 필수 파일 전에는 검수 시작이 비활성 상태로 안내된다.' },
      { id: 'review-status', procedure: '로컬 검수를 시작하고 노드·관계·군집 결정을 하나씩 수행한다.', expected: '진행 건수와 진행 질문 건수가 갱신될 때 상태 메시지로 안내되고 승인·수정·반려 상태를 색상 없이 구분할 수 있다.' },
      { id: 'decision-and-download', procedure: '모든 항목을 키보드로 검수한 뒤 완료 plan 다운로드를 실행한다.', expected: '모든 필수 결정 전에는 다운로드가 비활성이고 완료 후 파일을 내려받을 수 있으며 DB·공개 그래프 미반영 경계가 안내된다.' },
    ],
  },
];

function emptyEnvironment() {
  return {
    assistiveTechnology: { name: null, version: null },
    browser: { name: null, version: null },
    operatingSystem: { name: null, version: null },
    device: null,
  };
}

export function createManualAccessibilityTemplate({ baseUrl, commitSha, generatedAt }) {
  return {
    schemaVersion: 1,
    generatedAt,
    baseUrl,
    commitSha,
    certificationClaimed: false,
    status: 'needs_review',
    profiles: MANUAL_ACCESSIBILITY_PROFILES.map((profile) => ({
      ...profile,
      environment: emptyEnvironment(),
    })),
    cases: MANUAL_ACCESSIBILITY_PROFILES.flatMap((profile) =>
      MANUAL_ACCESSIBILITY_SURFACES.map((surface) => ({
        id: `${surface.id}:${profile.id}`,
        surfaceId: surface.id,
        surfaceLabel: surface.label,
        path: surface.path,
        setup: surface.setup,
        profileId: profile.id,
        evaluator: null,
        testedAt: null,
        checks: surface.checks.map((check) => ({ ...check, status: 'not_run', notes: null })),
      })),
    ),
  };
}

const CHECK_STATUSES = new Set(['pass', 'fail', 'blocked', 'not_run']);

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidIsoDate(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validateEnvironment(environment) {
  const tools = [environment?.assistiveTechnology, environment?.browser, environment?.operatingSystem];
  return tools.every((tool) => isNonemptyString(tool?.name) && isNonemptyString(tool?.version))
    && isNonemptyString(environment?.device);
}

function validateEvidenceShape(evidence) {
  if (evidence?.schemaVersion !== 1) throw new Error('Unsupported manual accessibility evidence schema');
  if (evidence.certificationClaimed !== false) throw new Error('Manual evidence must not claim certification');
  if (!isValidIsoDate(evidence.generatedAt)) throw new Error('generatedAt must be a valid ISO date');
  if (!/^[0-9a-f]{7,40}$/i.test(evidence.commitSha ?? '')) throw new Error('commitSha must be a Git commit hash');
  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(evidence.baseUrl);
  } catch {
    throw new Error('baseUrl must be a valid HTTP URL');
  }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) throw new Error('baseUrl must be a valid HTTP URL');

  const expectedProfileIds = MANUAL_ACCESSIBILITY_PROFILES.map(({ id }) => id);
  const actualProfileIds = evidence.profiles?.map(({ id }) => id) ?? [];
  if (actualProfileIds.length !== expectedProfileIds.length
    || new Set(actualProfileIds).size !== expectedProfileIds.length
    || expectedProfileIds.some((id) => !actualProfileIds.includes(id))) {
    throw new Error('Manual evidence profiles do not match the required profiles');
  }

  const expectedCases = new Map(MANUAL_ACCESSIBILITY_PROFILES.flatMap((profile) =>
    MANUAL_ACCESSIBILITY_SURFACES.map((surface) => [
      `${surface.id}:${profile.id}`,
      { profileId: profile.id, surfaceId: surface.id, path: surface.path, setup: surface.setup, checks: surface.checks },
    ])));
  if (!Array.isArray(evidence.cases) || evidence.cases.length !== expectedCases.size) {
    throw new Error('Manual evidence cases do not match the required matrix');
  }
  const seenCaseIds = new Set();
  for (const item of evidence.cases) {
    const expected = expectedCases.get(item.id);
    if (!expected || seenCaseIds.has(item.id) || item.profileId !== expected.profileId || item.surfaceId !== expected.surfaceId
      || item.path !== expected.path || item.setup !== expected.setup) {
      throw new Error('Manual evidence cases do not match the required matrix');
    }
    seenCaseIds.add(item.id);
    const checkIds = item.checks?.map(({ id }) => id) ?? [];
    const expectedCheckIds = expected.checks.map(({ id }) => id);
    if (checkIds.length !== expected.checks.length
      || new Set(checkIds).size !== expected.checks.length
      || expectedCheckIds.some((id) => !checkIds.includes(id))) {
      throw new Error(`Manual evidence checks do not match ${item.id}`);
    }
    const executed = item.checks.some(({ status }) => status !== 'not_run');
    if (executed && (!isNonemptyString(item.evaluator) || !isValidIsoDate(item.testedAt))) {
      throw new Error('Executed cases require evaluator and testedAt');
    }
    const profile = evidence.profiles.find(({ id }) => id === item.profileId);
    if (executed && !validateEnvironment(profile?.environment)) {
      throw new Error('Executed cases require complete environment metadata');
    }
    for (const check of item.checks) {
      const expectedCheck = expected.checks.find(({ id }) => id === check.id);
      if (check.procedure !== expectedCheck?.procedure || check.expected !== expectedCheck?.expected) {
        throw new Error(`Manual evidence procedure does not match ${item.id}:${check.id}`);
      }
      if (!CHECK_STATUSES.has(check.status)) throw new Error(`Unsupported check status in ${item.id}`);
      if (['fail', 'blocked'].includes(check.status) && !isNonemptyString(check.notes)) {
        throw new Error('Failed or blocked checks require notes');
      }
    }
  }
}

export function evaluateManualAccessibilityEvidence(evidence) {
  validateEvidenceShape(evidence);
  const checks = evidence.cases.flatMap((item) => item.checks);
  const count = (status) => checks.filter((check) => check.status === status).length;
  const failCount = count('fail');
  const blockedCount = count('blocked');
  const notRunCount = count('not_run');
  const status = failCount > 0 ? 'fail' : blockedCount > 0 || notRunCount > 0 ? 'needs_review' : 'pass';
  if (evidence.status !== status) throw new Error(`Evidence status must be ${status}`);
  return {
    status,
    caseCount: evidence.cases.length,
    checkCount: checks.length,
    passCount: count('pass'),
    failCount,
    blockedCount,
    notRunCount,
  };
}

export function verifyManualAccessibilityEvidenceFile(path) {
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Failed to parse manual accessibility evidence');
  }
  return evaluateManualAccessibilityEvidence(evidence);
}

export function validateManualAccessibilityTarget(evidence, {
  expectedBaseUrl,
  isCommitAncestor,
  changedPaths,
}) {
  const normalizedExpected = expectedBaseUrl?.replace(/\/$/, '');
  const normalizedActual = evidence.baseUrl.replace(/\/$/, '');
  if (normalizedExpected && normalizedActual !== normalizedExpected) {
    throw new Error('Manual evidence baseUrl does not match the approved origin');
  }
  if (evidence.status === 'pass' && (!isCommitAncestor || changedPaths.length > 0)) {
    throw new Error('Passed manual evidence is stale for the current accessibility surfaces');
  }
}

export const MANUAL_ACCESSIBILITY_TARGET_PATHS = [
  'src/islands/OntologyReviewConsole.tsx',
  'src/islands/canvas',
  'src/islands/platform',
  'src/islands/result',
  'src/pages',
  'src/components',
  'src/lib',
  'src/styles',
];

function gitTargetState(repoRoot, commitSha) {
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', commitSha, 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (![0, 1].includes(ancestor.status)) throw new Error('Failed to validate the manual evidence commit');
  const diff = spawnSync('git', ['diff', '--name-only', commitSha, 'HEAD', '--', ...MANUAL_ACCESSIBILITY_TARGET_PATHS], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (diff.status !== 0) throw new Error('Failed to compare manual evidence accessibility surfaces');
  return {
    isCommitAncestor: ancestor.status === 0,
    changedPaths: diff.stdout.split(/\r?\n/).filter(Boolean),
  };
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

export function runManualAccessibilityEvidenceCli(args) {
  const verifyPath = optionValue(args, '--verify');
  if (verifyPath) {
    let evidence;
    try {
      evidence = JSON.parse(readFileSync(verifyPath, 'utf8'));
    } catch {
      throw new Error('Failed to parse manual accessibility evidence');
    }
    const summary = evaluateManualAccessibilityEvidence(evidence);
    const expectedBaseUrl = optionValue(args, '--expected-base-url');
    const repoRoot = optionValue(args, '--repo-root');
    if (evidence.status === 'pass' && (!expectedBaseUrl || !repoRoot)) {
      throw new Error('Passed evidence requires approved origin and repository verification');
    }
    const targetState = repoRoot
      ? gitTargetState(repoRoot, evidence.commitSha)
      : { isCommitAncestor: true, changedPaths: [] };
    validateManualAccessibilityTarget(evidence, { expectedBaseUrl, ...targetState });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    if (summary.status === 'fail') process.exitCode = 1;
    return;
  }

  const outputPath = optionValue(args, '--write-template');
  const baseUrl = optionValue(args, '--base-url');
  const commitSha = optionValue(args, '--commit-sha');
  const generatedAt = optionValue(args, '--generated-at') ?? new Date().toISOString();
  const force = args.includes('--force');
  if (!outputPath || !baseUrl || !commitSha) {
    throw new Error('Usage: --verify <path> or --write-template <path> --base-url <url> --commit-sha <sha>');
  }
  const evidence = createManualAccessibilityTemplate({ baseUrl, commitSha, generatedAt });
  evaluateManualAccessibilityEvidence(evidence);
  if (existsSync(outputPath) && !force) {
    throw new Error('Manual accessibility evidence already exists; use a new path or explicit --force');
  }
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ path: resolve(outputPath), status: evidence.status })}\n`);
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    runManualAccessibilityEvidenceCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Manual accessibility evidence failed');
    process.exitCode = 1;
  }
}
