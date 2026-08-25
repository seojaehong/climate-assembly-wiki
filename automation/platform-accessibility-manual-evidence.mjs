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
      { id: 'source-backlinks', procedure: '공개검수된 원문 근거 링크를 실행해 원문 카드로 이동하고 쟁점으로 돌아온 뒤 미검수 원문 경로를 확인한다.', expected: '승인 원문은 쟁점과 원문 카드 사이를 키보드·보조기술로 왕복하고, 미검수·잘못된 원문은 내용 없이 확인 필요 상태만 안내된다.' },
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
  {
    id: 'kwcag-cross-surface',
    label: 'KWCAG 2.2 표면 간 공통 검수',
    path: '/platform/accessibility/',
    setup: 'KWCAG 2.2 적용 범위인 6개 표면을 모두 열고 해당 기능의 존재·비존재와 대체수단을 함께 검수한다.',
    checks: [
      { id: 'non-text-content', procedure: '정보성 이미지·아이콘·차트와 장식 이미지를 표면별로 탐색한다.', expected: '정보성 텍스트 아닌 콘텐츠에는 용도에 맞는 대체 텍스트가 있고 장식은 보조기술에서 제외된다.' },
      { id: 'multimedia-alternatives', procedure: '음성·영상·실시간 미디어의 존재를 표면별로 확인하고 존재하면 자막·대본·수어 대체수단을 실행한다.', expected: '멀티미디어가 없음이 기록되거나 있는 모든 멀티미디어의 동등한 대체수단을 이용할 수 있다.' },
      { id: 'instructions-color-and-contrast', procedure: '모양·위치·방향·색·소리만으로 제공되는 지시와 색상만으로 구분되는 상태를 찾고 텍스트·공통 UI·인접 영역의 명도 대비를 확인한다.', expected: '모든 지시와 상태를 색이나 위치 없이 이해할 수 있고 텍스트와 인접 콘텐츠가 필요한 대비와 구분을 제공한다.' },
      { id: 'audio-and-moving-content', procedure: '페이지 진입 후 자동 재생되는 소리와 자동으로 변경·이동·스크롤되는 콘텐츠를 확인한다.', expected: '자동 음성이 없고 자동 변경 콘텐츠가 있다면 정지·일시정지·탐색 수단을 키보드와 보조기술로 이용할 수 있다.' },
      { id: 'keyboard-focus-and-shortcuts', procedure: '모든 기능을 키보드로 실행하고 초점 순서·표시·이탈을 확인한 뒤 문자 단축키 사용 여부를 점검한다.', expected: '키보드만으로 모든 기능을 이용할 수 있고 초점이 논리적으로 이동·표시되며 문자 단축키는 오동작을 방지한다.' },
      { id: 'time-limits', procedure: '세션·입력·알림·상태 갱신의 시간제한을 찾고 연장·해제·조절 수단을 확인한다.', expected: '시간제한이 없음이 기록되거나 있는 제한은 사전 안내와 조절·연장 수단을 제공한다.' },
      { id: 'flashing-content', procedure: '깜빡임·번짝임·빠른 점멸 효과를 표면별로 확인한다.', expected: '광과민성 발작을 유발할 수 있는 빈도의 깜빡임과 번짝임을 사용하지 않는다.' },
      { id: 'language-titles-and-links', procedure: '문서 기본 언어, 페이지·프레임·콘텐츠 블록 제목과 링크 목적을 랜드마크·제목·링크 목록으로 확인한다.', expected: '기본 언어가 명시되고 제목과 링크 텍스트만으로 위치와 목적을 이해할 수 있다.' },
      { id: 'electronic-publication-reference', procedure: '전자출판문서 형식 콘텐츠 존재 여부를 확인하고 존재하면 고정된 참조 위치 정보를 탐색한다.', expected: '해당 콘텐츠가 없음이 기록되거나 있다면 페이지·절·위치를 일관되게 참조할 수 있다.' },
      { id: 'pointer-input', procedure: '다중 포인터·경로·드래그·기기 동작으로 실행되는 기능과 누름 순간 실행되는 기능을 확인한다.', expected: '단일 포인터 대체수단, 입력 취소·되돌리기, UI 대체 조작을 제공하고 조작 크기가 충분하다.' },
      { id: 'context-and-help', procedure: '초점·입력만으로 새 창·페이지·설정이 바뀌는지 확인하고 도움 정보가 있는 페이지의 위치가 일관되는지 비교한다.', expected: '사용자가 의도하거나 사전 안내받은 때만 맥락이 변경되고 제공되는 도움 정보를 같은 상대 위치에서 찾을 수 있다.' },
      { id: 'errors-labels-and-repeated-input', procedure: '필수·형식 오류를 발생시켜 식별·설명·정정 수단을 확인하고 레이블·네임 일치와 반복 입력 자동 완성을 검수한다.', expected: '오류 위치와 정정 방법이 안내되고 모든 입력에 대응 레이블이 있으며 이미 제공한 정보는 재입력하지 않아도 된다.' },
      { id: 'accessible-authentication', procedure: '로그인·재인증·회복 경로에서 기억·퍼즐·복사 금지 등 인지 기능 테스트 의존성과 대체수단을 확인한다.', expected: '인지 기능 테스트에만 의존하지 않고 비밀번호 관리자·붙여넣기·보조기술을 방해하지 않는 대체 인증을 제공한다.' },
      { id: 'markup-validity', procedure: 'DOM 검사 도구로 중복 ID, 잘못된 중첩·닫힘, 중복 속성과 보조기술에 노출되는 구조 오류를 확인한다.', expected: '마크업 오류가 없고 요소의 이름·역할·값·상태가 보조기술에 일관되게 노출된다.' },
      { id: 'web-application-compatibility', procedure: '로그인, 조직 탐색, 결과, 검수 앱의 커스텀 UI를 스크린리더·키보드·터치로 끝까지 실행한다.', expected: '웹 애플리케이션의 모든 필수 과업에서 접근성 API를 통해 이름·역할·상태가 제공되고 키보드·터치 조작이 성공한다.' },
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
      if (check.status === 'not_run' && check.notes !== null) {
        throw new Error('Not-run checks must not contain observation notes');
      }
      if (check.status !== 'not_run' && !isNonemptyString(check.notes)) {
        throw new Error('Executed checks require observation notes');
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
  'src/layouts',
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
  const worktree = spawnSync('git', [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--',
    ...MANUAL_ACCESSIBILITY_TARGET_PATHS,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (worktree.status !== 0) throw new Error('Failed to inspect manual evidence accessibility surfaces');
  const committedChanges = diff.stdout.split(/\r?\n/).filter(Boolean);
  const worktreeChanges = worktree.stdout.split('\0').filter(Boolean);
  return {
    isCommitAncestor: ancestor.status === 0,
    changedPaths: [...committedChanges, ...worktreeChanges],
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
