import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MANUAL_ACCESSIBILITY_PROFILES,
  MANUAL_ACCESSIBILITY_SURFACES,
  evaluateManualAccessibilityEvidence,
} from './platform-accessibility-manual-evidence.mjs';

export const KWCAG_22_STANDARD = {
  id: 'KS X OT0003:2022',
  title: '한국형 웹 콘텐츠 접근성 지침 2.2',
  principleCount: 4,
  guidelineCount: 14,
  requirementCount: 33,
  sourcePage: 'https://www.webwatch.or.kr/WA/010301.html?MenuCD=130',
  sourceDocument: 'https://www.webwatch.or.kr/include/fileDown.asp?filename=%28KS%20X%20OT0003%29%20%ED%95%9C%EA%B5%AD%ED%98%95%20%EC%9B%B9%20%EC%BD%98%ED%85%90%EC%B8%A0%20%EC%A0%91%EA%B7%BC%EC%84%B1%20%EC%A7%80%EC%B9%A8%202.2.pdf',
  sourceSha256: 'c5a139dc548bf018115d142847b69b7017953f5987fc50534c81e6b175402f13',
};

export const AUTOMATED_ACCESSIBILITY_EVIDENCE = [
  { id: 'axe-wcag22-aa', label: 'axe-core WCAG 2.2 AA automated subset' },
  { id: 'skip-link-focus', label: 'Chromium skip-link focus movement' },
  { id: 'responsive-overflow', label: 'Desktop and mobile responsive overflow' },
  { id: 'keyboard-scroll-regions', label: 'Keyboard-operable named horizontal scroll regions' },
];

const KWCAG_22_REQUIREMENT_IDS = [
  '5.1.1', '5.2.1', '5.3.1', '5.3.2', '5.3.3', '5.4.1', '5.4.2', '5.4.3', '5.4.4',
  '6.1.1', '6.1.2', '6.1.3', '6.1.4', '6.2.1', '6.2.2', '6.3.1', '6.4.1', '6.4.2',
  '6.4.3', '6.4.4', '6.5.1', '6.5.2', '6.5.3', '6.5.4', '7.1.1', '7.2.1', '7.2.2',
  '7.3.1', '7.3.2', '7.3.3', '7.3.4', '8.1.1', '8.2.1',
];

const cross = (checkId) => `kwcag-cross-surface:${checkId}`;

export const KWCAG_22_CRITERIA = [
  { id: '5.1.1', name: '적절한 대체 텍스트 제공', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: [cross('non-text-content')] },
  { id: '5.2.1', name: '자막 제공', automatedEvidence: [], manualEvidence: [cross('multimedia-alternatives')] },
  { id: '5.3.1', name: '표의 구성', automatedEvidence: ['axe-wcag22-aa', 'keyboard-scroll-regions'], manualEvidence: ['published-result:table-navigation'] },
  { id: '5.3.2', name: '콘텐츠의 선형구조', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: ['published-result:landmarks-and-headings'] },
  { id: '5.3.3', name: '명확한 지시사항 제공', automatedEvidence: [], manualEvidence: [cross('instructions-color-and-contrast')] },
  { id: '5.4.1', name: '색에 무관한 콘텐츠 인식', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: [cross('instructions-color-and-contrast')] },
  { id: '5.4.2', name: '자동 재생 금지', automatedEvidence: [], manualEvidence: [cross('audio-and-moving-content')] },
  { id: '5.4.3', name: '텍스트 콘텐츠의 명도 대비', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: [cross('instructions-color-and-contrast')] },
  { id: '5.4.4', name: '콘텐츠 간의 구분', automatedEvidence: ['responsive-overflow'], manualEvidence: [cross('instructions-color-and-contrast')] },
  { id: '6.1.1', name: '키보드 사용 보장', automatedEvidence: ['keyboard-scroll-regions'], manualEvidence: ['authenticated-platform:controls-and-forms', cross('keyboard-focus-and-shortcuts')] },
  { id: '6.1.2', name: '초점 이동과 표시', automatedEvidence: ['skip-link-focus'], manualEvidence: ['platform-login:focus-order', cross('keyboard-focus-and-shortcuts')] },
  { id: '6.1.3', name: '조작 가능', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: [cross('pointer-input')] },
  { id: '6.1.4', name: '문자 단축키', automatedEvidence: [], manualEvidence: [cross('keyboard-focus-and-shortcuts')] },
  { id: '6.2.1', name: '응답시간 조절', automatedEvidence: [], manualEvidence: [cross('time-limits')] },
  { id: '6.2.2', name: '정지 기능 제공', automatedEvidence: [], manualEvidence: [cross('audio-and-moving-content'), cross('time-limits')] },
  { id: '6.3.1', name: '깜빡임과 번짝임 사용 제한', automatedEvidence: [], manualEvidence: [cross('flashing-content')] },
  { id: '6.4.1', name: '반복 영역 건너뛰기', automatedEvidence: ['skip-link-focus'], manualEvidence: ['platform-login:skip-focus'] },
  { id: '6.4.2', name: '제목 제공', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: [cross('language-titles-and-links')] },
  { id: '6.4.3', name: '적절한 링크 텍스트', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: ['accessibility-statement:link-purpose', cross('language-titles-and-links')] },
  { id: '6.4.4', name: '고정된 참조 위치 정보', automatedEvidence: [], manualEvidence: [cross('electronic-publication-reference')] },
  { id: '6.5.1', name: '단일 포인터 입력 지원', automatedEvidence: [], manualEvidence: [cross('pointer-input')] },
  { id: '6.5.2', name: '포인터 입력 취소', automatedEvidence: [], manualEvidence: [cross('pointer-input')] },
  { id: '6.5.3', name: '레이블과 네임', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: ['platform-login:form-labels', 'ontology-review:upload-controls'] },
  { id: '6.5.4', name: '동작기반 작동', automatedEvidence: [], manualEvidence: [cross('pointer-input')] },
  { id: '7.1.1', name: '기본 언어 표시', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: [cross('language-titles-and-links')] },
  { id: '7.2.1', name: '사용자 요구에 따른 실행', automatedEvidence: [], manualEvidence: [cross('context-and-help')] },
  { id: '7.2.2', name: '찾기 쉬운 도움 정보', automatedEvidence: [], manualEvidence: [cross('context-and-help')] },
  { id: '7.3.1', name: '오류 정정', automatedEvidence: [], manualEvidence: ['platform-login:error-announcement', cross('errors-labels-and-repeated-input')] },
  { id: '7.3.2', name: '레이블 제공', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: ['platform-login:form-labels', cross('errors-labels-and-repeated-input')] },
  { id: '7.3.3', name: '접근 가능한 인증', automatedEvidence: [], manualEvidence: [cross('accessible-authentication')] },
  { id: '7.3.4', name: '반복 입력 정보', automatedEvidence: [], manualEvidence: [cross('errors-labels-and-repeated-input')] },
  { id: '8.1.1', name: '마크업 오류 방지', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: [cross('markup-validity')] },
  { id: '8.2.1', name: '웹 애플리케이션 접근성 준수', automatedEvidence: ['axe-wcag22-aa'], manualEvidence: ['authenticated-platform:controls-and-forms', cross('web-application-compatibility')] },
];

function isNonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function expectedManualEvidenceIds() {
  return new Set(MANUAL_ACCESSIBILITY_SURFACES.flatMap((surface) => (
    surface.checks.map((check) => `${surface.id}:${check.id}`)
  )));
}

export function validateKwcagCoverageContract({ criteria = KWCAG_22_CRITERIA } = {}) {
  if (!Array.isArray(criteria) || criteria.length !== KWCAG_22_STANDARD.requirementCount) {
    throw new Error('KWCAG coverage must contain exactly 33 requirements');
  }
  const criterionIds = criteria.map(({ id }) => id);
  if (new Set(criterionIds).size !== criteria.length) {
    throw new Error('KWCAG coverage requirement ids must be unique');
  }
  if (criterionIds.some((id, index) => id !== KWCAG_22_REQUIREMENT_IDS[index])) {
    throw new Error('KWCAG coverage must preserve the canonical 33-requirement sequence');
  }
  const automatedIds = new Set(AUTOMATED_ACCESSIBILITY_EVIDENCE.map(({ id }) => id));
  const manualIds = expectedManualEvidenceIds();
  for (const criterion of criteria) {
    if (!/^\d\.\d\.\d$/.test(criterion.id) || !isNonemptyString(criterion.name)) {
      throw new Error('KWCAG coverage requirements require canonical id and name');
    }
    if (!Array.isArray(criterion.automatedEvidence) || !Array.isArray(criterion.manualEvidence)
      || criterion.manualEvidence.length === 0) {
      throw new Error(`KWCAG requirement ${criterion.id} requires explicit evidence arrays and manual coverage`);
    }
    if (new Set(criterion.automatedEvidence).size !== criterion.automatedEvidence.length
      || new Set(criterion.manualEvidence).size !== criterion.manualEvidence.length) {
      throw new Error(`KWCAG requirement ${criterion.id} contains duplicate evidence references`);
    }
    for (const id of criterion.automatedEvidence) {
      if (!automatedIds.has(id)) throw new Error(`KWCAG requirement ${criterion.id} references unknown automated evidence`);
    }
    for (const id of criterion.manualEvidence) {
      if (!manualIds.has(id)) throw new Error(`KWCAG requirement ${criterion.id} references unknown manual evidence`);
    }
  }
  return { requirementCount: criteria.length, unmappedCount: 0 };
}

function automatedEvidenceResults(report) {
  if (report?.schemaVersion !== 3 || !/^[0-9a-f]{40}$/.test(report.sourceCommit ?? '')
    || report.sourceTreeClean !== true) {
    throw new Error('Automated accessibility report requires clean committed source');
  }
  if (!Array.isArray(report.routes) || report.routes.length === 0
    || report.standard !== 'WCAG 2.2 AA automated subset + skip-link focus + responsive overflow') {
    throw new Error('Automated accessibility report does not match the required schema and standard');
  }
  const summary = report.summary ?? {};
  const axePassed = summary.auditCaseCount > 0
    && summary.passedCases === summary.auditCaseCount
    && summary.violationCount === 0
    && summary.incompleteCount === 0;
  const skipPassed = report.routes.every((route) => route.skipLink?.focusMoved === true);
  const responsivePassed = report.routes.every((route) => route.layout
    && route.layout.horizontalOverflow === false
    && route.layout.contentWidthSufficient === true
    && Array.isArray(route.layout.clippedOutsideScrollRegions)
    && route.layout.clippedOutsideScrollRegions.length === 0);
  const scrollRegions = report.routes.flatMap((route) => route.requiredScrollRegions ?? []);
  const scrollPassed = scrollRegions.length > 0 && scrollRegions.every((region) => (
    region.found === true && region.scrollable === true
    && region.focused === true && region.keyboardScrolled === true
  ));
  return [
    { id: 'axe-wcag22-aa', status: axePassed ? 'pass' : 'fail' },
    { id: 'skip-link-focus', status: skipPassed ? 'pass' : 'fail' },
    { id: 'responsive-overflow', status: responsivePassed ? 'pass' : 'fail' },
    { id: 'keyboard-scroll-regions', status: scrollRegions.length === 0 ? 'needs_review' : scrollPassed ? 'pass' : 'fail' },
  ];
}

function manualEvidenceResult(evidence, reference) {
  const separator = reference.indexOf(':');
  const surfaceId = reference.slice(0, separator);
  const checkId = reference.slice(separator + 1);
  const checks = evidence.cases
    .filter((item) => item.surfaceId === surfaceId)
    .flatMap((item) => item.checks.filter((check) => check.id === checkId));
  if (checks.length !== MANUAL_ACCESSIBILITY_PROFILES.length) {
    throw new Error(`Manual accessibility evidence is incomplete for ${reference}`);
  }
  const status = checks.some((check) => check.status === 'fail')
    ? 'fail'
    : checks.every((check) => check.status === 'pass')
      ? 'pass'
      : 'needs_review';
  return { id: reference, status };
}

function combinedStatus(statuses) {
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('needs_review')) return 'needs_review';
  return 'pass';
}

export function buildKwcagCoverageReport({ automatedReport, manualEvidence, generatedAt = new Date() }) {
  validateKwcagCoverageContract();
  evaluateManualAccessibilityEvidence(manualEvidence);
  const automatedEvidence = automatedEvidenceResults(automatedReport);
  const automatedById = new Map(automatedEvidence.map((item) => [item.id, item.status]));
  const manualReferences = [...new Set(KWCAG_22_CRITERIA.flatMap(({ manualEvidence: refs }) => refs))];
  const manualResults = manualReferences.map((reference) => manualEvidenceResult(manualEvidence, reference));
  const manualById = new Map(manualResults.map((item) => [item.id, item.status]));
  const criteria = KWCAG_22_CRITERIA.map((criterion) => {
    const statuses = [
      ...criterion.automatedEvidence.map((id) => automatedById.get(id)),
      ...criterion.manualEvidence.map((id) => manualById.get(id)),
    ];
    return {
      ...criterion,
      status: combinedStatus(statuses),
    };
  });
  const count = (status) => criteria.filter((criterion) => criterion.status === status).length;
  const summary = {
    requirementCount: criteria.length,
    passedCount: count('pass'),
    failedCount: count('fail'),
    needsReviewCount: count('needs_review'),
    unmappedCount: 0,
  };
  return {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    certificationClaimed: false,
    status: combinedStatus(criteria.map((criterion) => criterion.status)),
    standard: KWCAG_22_STANDARD,
    inputs: {
      automatedSourceCommit: automatedReport.sourceCommit,
      manualCommit: manualEvidence.commitSha,
      manualStatus: manualEvidence.status,
    },
    summary,
    automatedEvidence,
    manualEvidence: manualResults,
    criteria,
  };
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Failed to parse KWCAG coverage input');
  }
}

export function runKwcagCoverageCli(args) {
  const automatedPath = optionValue(args, '--automated-report');
  const manualPath = optionValue(args, '--manual-evidence');
  const outputPath = optionValue(args, '--output');
  const generatedAtValue = optionValue(args, '--generated-at');
  if (!automatedPath || !manualPath || !outputPath) {
    throw new Error('Usage: --automated-report <path> --manual-evidence <path> --output <path>');
  }
  const generatedAt = generatedAtValue ? new Date(generatedAtValue) : new Date();
  if (Number.isNaN(generatedAt.getTime()) || generatedAt.toISOString() !== generatedAtValue && generatedAtValue) {
    throw new Error('generatedAt must be a canonical ISO timestamp');
  }
  const report = buildKwcagCoverageReport({
    automatedReport: readJson(automatedPath),
    manualEvidence: readJson(manualPath),
    generatedAt,
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    path: resolve(outputPath),
    status: report.status,
    requirementCount: report.summary.requirementCount,
  })}\n`);
  if (report.status === 'fail') process.exitCode = 1;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    runKwcagCoverageCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'KWCAG coverage evaluation failed');
    process.exitCode = 1;
  }
}
