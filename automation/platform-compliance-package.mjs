import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const TRACKED_CATALOG_PATH = fileURLToPath(new URL(
  '../docs/platform/platform-compliance-catalog.json',
  import.meta.url,
));
const DATASET_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const ORGANIZATION_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const TABLE_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;
const DEPLOYMENT_STATES = new Set(['live', 'dormant_draft']);
const SERVICE_TRACKS = new Set(['pending', 'managed_non_public', 'public_procurement_candidate']);
const PUBLIC_RELEASES = new Set(['never', 'human_review_only', 'public_by_design']);
const PRIVACY_STATUSES = new Set(['pending', 'approved']);
const POLITICAL_OPINION_CLASSIFICATIONS = new Set([
  'pending', 'ordinary_personal', 'sensitive_personal', 'not_personal',
]);
const AUDIO_CLASSIFICATIONS = new Set([
  'pending', 'not_collected', 'ordinary_personal', 'biometric_or_sensitive',
]);
const OVERSEAS_TRANSFER_DECISIONS = new Set(['pending', 'none', 'approved']);
const PROCESSOR_STATUSES = new Set(['pending', 'confirmed']);
const NOTICE_STATUSES = new Set(['pending', 'confirmed', 'not_applicable']);
const RECORDS_STATUSES = new Set(['pending', 'approved']);
const RECORD_CLASSES = new Set([
  'pending',
  'meeting_minutes',
  'administrative_record',
  'audit_record',
  'system_record',
  'public_result_record',
  'non_record',
]);
const RETENTION_PERIODS = new Set([
  'pending', '1y', '3y', '5y', '10y', '30y', 'semi_permanent', 'permanent',
]);
const DISPOSITION_ACTIONS = new Set([
  'pending', 'institution_records_process', 'transfer', 'preserve',
]);
const LEGACY_TABLES = Object.freeze(['rounds', 'session', 'snapshots', 'votes']);
const CATALOG_KEYS = Object.freeze(['schemaVersion', 'datasets']);
const DATASET_KEYS = Object.freeze([
  'id',
  'title',
  'deploymentState',
  'tables',
  'storageLocations',
  'purpose',
  'dataSubjects',
  'dataClasses',
  'ingress',
  'internalUses',
  'egress',
  'publicRelease',
]);
const PROFILE_KEYS = Object.freeze([
  'schemaVersion',
  'organizationCode',
  'systemName',
  'serviceTrack',
  'privacyDecision',
  'recordsDecision',
]);
const PRIVACY_KEYS = Object.freeze([
  'status',
  'reviewerRole',
  'reviewedAt',
  'lawfulBasisReference',
  'politicalOpinionClassification',
  'audioBiometricClassification',
  'overseasTransferDecision',
  'processorInventoryStatus',
  'noticeAndConsentStatus',
]);
const RECORDS_KEYS = Object.freeze([
  'status', 'reviewerRole', 'reviewedAt', 'scheduleAuthority', 'mappings',
]);
const MAPPING_KEYS = Object.freeze([
  'datasetId',
  'recordClass',
  'unitTaskCode',
  'retentionPeriod',
  'retentionTrigger',
  'dispositionAction',
  'dispositionAuthority',
  'destructionMethod',
]);

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function requireExactKeys(value, keys, label) {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new Error(`Unexpected ${label} field`);
  }
}

function requireText(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > 240) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function requireEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function requireStringList(value, label, pattern = null, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`Invalid ${label}`);
  const normalized = value.map((entry) => requireText(entry, label));
  if (new Set(normalized).size !== normalized.length) throw new Error(`Duplicate ${label}`);
  if (pattern && normalized.some((entry) => !pattern.test(entry))) throw new Error(`Invalid ${label}`);
  return normalized;
}

function requireTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)
    || Number.isNaN(Date.parse(text))
    || new Date(text).toISOString() !== text) {
    throw new Error(`Invalid ${label}`);
  }
  return text;
}

export function discoverClimateVoteTables(sql) {
  if (typeof sql !== 'string') throw new Error('Invalid migration SQL');
  const names = new Set();
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?climate_vote\.([a-z][a-z0-9_]*)/giu;
  for (const match of sql.matchAll(pattern)) names.add(match[1].toLowerCase());
  return [...names].sort();
}

function repositoryClimateVoteTables() {
  const migrationDirectory = join(REPO_ROOT, 'supabase', 'migrations');
  const names = new Set(LEGACY_TABLES);
  for (const file of readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(migrationDirectory, file), 'utf8');
    for (const table of discoverClimateVoteTables(sql)) names.add(table);
  }
  return [...names].sort();
}

export function validatePlatformComplianceCatalog(catalog, { verifyRepositoryCoverage = false } = {}) {
  const root = requireObject(catalog, 'compliance catalog');
  requireExactKeys(root, CATALOG_KEYS, 'compliance catalog');
  if (root.schemaVersion !== 1 || !Array.isArray(root.datasets) || root.datasets.length === 0) {
    throw new Error('Invalid compliance catalog');
  }
  const datasetIds = new Set();
  const tableOwners = new Map();
  const datasets = root.datasets.map((rawDataset) => {
    const dataset = requireObject(rawDataset, 'compliance dataset');
    requireExactKeys(dataset, DATASET_KEYS, 'compliance dataset');
    const id = requireText(dataset.id, 'dataset id');
    if (!DATASET_ID_PATTERN.test(id)) throw new Error('Invalid dataset id');
    if (datasetIds.has(id)) throw new Error('Duplicate dataset id');
    datasetIds.add(id);
    const tables = requireStringList(dataset.tables, 'dataset table', TABLE_PATTERN, { allowEmpty: true });
    for (const table of tables) {
      if (tableOwners.has(table)) throw new Error(`Duplicate catalog table ${table}`);
      tableOwners.set(table, id);
    }
    return {
      id,
      title: requireText(dataset.title, 'dataset title'),
      deploymentState: requireEnum(dataset.deploymentState, DEPLOYMENT_STATES, 'deployment state'),
      tables,
      storageLocations: requireStringList(dataset.storageLocations, 'storage location'),
      purpose: requireText(dataset.purpose, 'dataset purpose'),
      dataSubjects: requireStringList(dataset.dataSubjects, 'data subject'),
      dataClasses: requireStringList(dataset.dataClasses, 'data class'),
      ingress: requireStringList(dataset.ingress, 'data ingress'),
      internalUses: requireStringList(dataset.internalUses, 'internal use'),
      egress: requireStringList(dataset.egress, 'data egress'),
      publicRelease: requireEnum(dataset.publicRelease, PUBLIC_RELEASES, 'public release'),
    };
  });
  if (verifyRepositoryCoverage) {
    const catalogTables = [...tableOwners.keys()].sort();
    const repositoryTables = repositoryClimateVoteTables();
    if (canonicalJson(catalogTables) !== canonicalJson(repositoryTables)) {
      const missing = repositoryTables.filter((table) => !tableOwners.has(table));
      const extra = catalogTables.filter((table) => !repositoryTables.includes(table));
      throw new Error(`Compliance catalog table coverage mismatch: missing=${missing.join(',')} extra=${extra.join(',')}`);
    }
  }
  return { schemaVersion: 1, datasets };
}

function validatePrivacyDecision(rawDecision) {
  const decision = requireObject(rawDecision, 'privacy decision');
  requireExactKeys(decision, PRIVACY_KEYS, 'privacy decision');
  const normalized = {
    status: requireEnum(decision.status, PRIVACY_STATUSES, 'privacy status'),
    reviewerRole: requireText(decision.reviewerRole, 'privacy reviewer role', { nullable: true }),
    reviewedAt: requireTimestamp(decision.reviewedAt, 'privacy review timestamp', { nullable: true }),
    lawfulBasisReference: requireText(decision.lawfulBasisReference, 'lawful basis reference', { nullable: true }),
    politicalOpinionClassification: requireEnum(
      decision.politicalOpinionClassification,
      POLITICAL_OPINION_CLASSIFICATIONS,
      'political opinion classification',
    ),
    audioBiometricClassification: requireEnum(
      decision.audioBiometricClassification,
      AUDIO_CLASSIFICATIONS,
      'audio classification',
    ),
    overseasTransferDecision: requireEnum(
      decision.overseasTransferDecision,
      OVERSEAS_TRANSFER_DECISIONS,
      'overseas transfer decision',
    ),
    processorInventoryStatus: requireEnum(
      decision.processorInventoryStatus,
      PROCESSOR_STATUSES,
      'processor inventory status',
    ),
    noticeAndConsentStatus: requireEnum(
      decision.noticeAndConsentStatus,
      NOTICE_STATUSES,
      'notice and consent status',
    ),
  };
  if (normalized.status === 'approved' && (
    !normalized.reviewerRole
    || !normalized.reviewedAt
    || !normalized.lawfulBasisReference
    || normalized.politicalOpinionClassification === 'pending'
    || normalized.audioBiometricClassification === 'pending'
    || normalized.overseasTransferDecision === 'pending'
    || normalized.processorInventoryStatus === 'pending'
    || normalized.noticeAndConsentStatus === 'pending'
  )) throw new Error('Approved privacy decision is incomplete');
  return normalized;
}

function validateRetentionMapping(rawMapping) {
  const mapping = requireObject(rawMapping, 'retention mapping');
  requireExactKeys(mapping, MAPPING_KEYS, 'retention mapping');
  return {
    datasetId: requireText(mapping.datasetId, 'retention dataset id'),
    recordClass: requireEnum(mapping.recordClass, RECORD_CLASSES, 'record class'),
    unitTaskCode: requireText(mapping.unitTaskCode, 'unit task code', { nullable: true }),
    retentionPeriod: requireEnum(mapping.retentionPeriod, RETENTION_PERIODS, 'retention period'),
    retentionTrigger: requireText(mapping.retentionTrigger, 'retention trigger', { nullable: true }),
    dispositionAction: requireEnum(mapping.dispositionAction, DISPOSITION_ACTIONS, 'disposition action'),
    dispositionAuthority: requireText(mapping.dispositionAuthority, 'disposition authority', { nullable: true }),
    destructionMethod: requireText(mapping.destructionMethod, 'destruction method', { nullable: true }),
  };
}

function validateRecordsDecision(rawDecision, datasetIds) {
  const decision = requireObject(rawDecision, 'records decision');
  requireExactKeys(decision, RECORDS_KEYS, 'records decision');
  if (!Array.isArray(decision.mappings)) throw new Error('Invalid retention mappings');
  const mappings = decision.mappings.map(validateRetentionMapping);
  const mappingIds = mappings.map((mapping) => mapping.datasetId);
  if (new Set(mappingIds).size !== mappingIds.length) throw new Error('Duplicate retention mapping');
  if (mappingIds.some((id) => !datasetIds.has(id))) throw new Error('Unknown retention mapping');
  if (canonicalJson([...mappingIds].sort()) !== canonicalJson([...datasetIds].sort())) {
    throw new Error('Retention mapping set does not match catalog');
  }
  const normalized = {
    status: requireEnum(decision.status, RECORDS_STATUSES, 'records status'),
    reviewerRole: requireText(decision.reviewerRole, 'records reviewer role', { nullable: true }),
    reviewedAt: requireTimestamp(decision.reviewedAt, 'records review timestamp', { nullable: true }),
    scheduleAuthority: requireText(decision.scheduleAuthority, 'records schedule authority', { nullable: true }),
    mappings: mappings.sort((left, right) => left.datasetId.localeCompare(right.datasetId)),
  };
  if (normalized.status === 'approved' && (
    !normalized.reviewerRole
    || !normalized.reviewedAt
    || !normalized.scheduleAuthority
    || normalized.mappings.some((mapping) => (
      mapping.recordClass === 'pending'
      || !mapping.unitTaskCode
      || mapping.retentionPeriod === 'pending'
      || !mapping.retentionTrigger
      || mapping.dispositionAction === 'pending'
      || !mapping.dispositionAuthority
      || !mapping.destructionMethod
    ))
  )) throw new Error('Approved records decision is incomplete');
  return normalized;
}

function validateProfile(rawProfile, datasetIds) {
  const profile = requireObject(rawProfile, 'institution profile');
  requireExactKeys(profile, PROFILE_KEYS, 'institution profile');
  if (profile.schemaVersion !== 1) throw new Error('Unsupported institution profile schema version');
  const organizationCode = requireText(profile.organizationCode, 'organization code');
  if (!ORGANIZATION_CODE_PATTERN.test(organizationCode)) throw new Error('Invalid organization code');
  return {
    schemaVersion: 1,
    organizationCode,
    systemName: requireText(profile.systemName, 'system name'),
    serviceTrack: requireEnum(profile.serviceTrack, SERVICE_TRACKS, 'service track'),
    privacyDecision: validatePrivacyDecision(profile.privacyDecision),
    recordsDecision: validateRecordsDecision(profile.recordsDecision, datasetIds),
  };
}

function privacyBlockers(decision) {
  const blockers = [];
  if (decision.status !== 'approved') blockers.push('privacy.review');
  if (!decision.lawfulBasisReference) blockers.push('privacy.lawful_basis');
  if (decision.politicalOpinionClassification === 'pending') {
    blockers.push('privacy.political_opinion_classification');
  }
  if (decision.audioBiometricClassification === 'pending') blockers.push('privacy.audio_classification');
  if (decision.overseasTransferDecision === 'pending') blockers.push('privacy.overseas_transfer');
  if (decision.processorInventoryStatus === 'pending') blockers.push('privacy.processor_inventory');
  if (decision.noticeAndConsentStatus === 'pending') blockers.push('privacy.notice_and_consent');
  return blockers;
}

function recordsBlockers(decision) {
  const blockers = [];
  if (decision.status !== 'approved') blockers.push('records.review');
  if (!decision.scheduleAuthority) blockers.push('records.schedule_authority');
  for (const mapping of decision.mappings) {
    const prefix = `records.${mapping.datasetId}`;
    if (mapping.recordClass === 'pending') blockers.push(`${prefix}.record_class`);
    if (!mapping.unitTaskCode) blockers.push(`${prefix}.unit_task_code`);
    if (mapping.retentionPeriod === 'pending') blockers.push(`${prefix}.retention_period`);
    if (!mapping.retentionTrigger) blockers.push(`${prefix}.retention_trigger`);
    if (mapping.dispositionAction === 'pending') blockers.push(`${prefix}.disposition_action`);
    if (!mapping.dispositionAuthority) blockers.push(`${prefix}.disposition_authority`);
    if (!mapping.destructionMethod) blockers.push(`${prefix}.destruction_method`);
  }
  return blockers;
}

export function buildPlatformCompliancePackage({ catalog, profile, generatedAt }) {
  const validatedCatalog = validatePlatformComplianceCatalog(catalog);
  const datasetIds = new Set(validatedCatalog.datasets.map((dataset) => dataset.id));
  const validatedProfile = validateProfile(profile, datasetIds);
  const observedAt = requireTimestamp(generatedAt, 'package generation timestamp');
  for (const reviewedAt of [
    validatedProfile.privacyDecision.reviewedAt,
    validatedProfile.recordsDecision.reviewedAt,
  ]) {
    if (reviewedAt && Date.parse(reviewedAt) > Date.parse(observedAt)) {
      throw new Error('Review timestamp follows package generation');
    }
  }
  const blockers = [
    ...(validatedProfile.serviceTrack === 'pending' ? ['service_track'] : []),
    ...privacyBlockers(validatedProfile.privacyDecision),
    ...recordsBlockers(validatedProfile.recordsDecision),
  ].sort();
  const dataFlows = validatedCatalog.datasets
    .map((dataset) => ({
      datasetId: dataset.id,
      title: dataset.title,
      deploymentState: dataset.deploymentState,
      purpose: dataset.purpose,
      dataSubjects: dataset.dataSubjects,
      dataClasses: dataset.dataClasses,
      ingress: dataset.ingress,
      schemaObjects: dataset.tables.map((table) => `climate_vote.${table}`),
      storageLocations: dataset.storageLocations,
      internalUses: dataset.internalUses,
      egress: dataset.egress,
      publicRelease: dataset.publicRelease,
    }))
    .sort((left, right) => left.datasetId.localeCompare(right.datasetId));
  const packageWithoutChecksum = {
    schemaVersion: 1,
    packageKind: 'pia_and_public_records_support',
    organizationCode: validatedProfile.organizationCode,
    systemName: validatedProfile.systemName,
    serviceTrack: validatedProfile.serviceTrack,
    generatedAt: observedAt,
    status: blockers.length === 0 ? 'ready_for_institution_submission' : 'needs_institution_decisions',
    readyForInstitutionSubmission: blockers.length === 0,
    complianceCertified: false,
    legalAssessmentPerformedByProduct: false,
    databaseMutationExecuted: false,
    privacyDecision: validatedProfile.privacyDecision,
    recordsDecision: {
      status: validatedProfile.recordsDecision.status,
      reviewerRole: validatedProfile.recordsDecision.reviewerRole,
      reviewedAt: validatedProfile.recordsDecision.reviewedAt,
      scheduleAuthority: validatedProfile.recordsDecision.scheduleAuthority,
    },
    dataFlows,
    retentionMappings: validatedProfile.recordsDecision.mappings,
    blockers,
    summary: {
      datasetCount: dataFlows.length,
      tableCount: dataFlows.reduce((sum, flow) => sum + flow.schemaObjects.length, 0),
      blockerCount: blockers.length,
    },
  };
  return {
    ...packageWithoutChecksum,
    checksumSha256: sha256(canonicalJson(packageWithoutChecksum)),
  };
}

function markdownCell(value) {
  if (Array.isArray(value)) return value.join(', ').replaceAll('|', '\\|');
  if (value === null) return '미정';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function mermaidLabel(value) {
  return String(value)
    .replaceAll('"', "'")
    .replaceAll('[', '(')
    .replaceAll(']', ')')
    .replaceAll('\n', ' ');
}

function renderDataFlowDiagram(dataFlows) {
  const lines = ['```mermaid', 'flowchart LR'];
  for (let index = 0; index < dataFlows.length; index += 1) {
    const flow = dataFlows[index];
    const nodeId = `d${index}`;
    lines.push(
      `  ${nodeId}_in["${mermaidLabel(flow.ingress.join(', '))}"] --> ${nodeId}["${mermaidLabel(`${flow.datasetId}: ${flow.title}`)}"]`,
      `  ${nodeId} --> ${nodeId}_store["${mermaidLabel(flow.storageLocations.join(', '))}"]`,
      `  ${nodeId} --> ${nodeId}_out["${mermaidLabel(flow.egress.join(', '))}"]`,
    );
  }
  lines.push('```');
  return lines;
}

export function renderPlatformCompliancePackageMarkdown(packageData) {
  const lines = [
    `# ${packageData.systemName} 개인정보 영향평가·기록물 관리 지원 패키지`,
    '',
    `- 기관 코드: \`${packageData.organizationCode}\``,
    `- 기관 제출 준비 상태: **${packageData.status}**`,
    `- 생성 시각: ${packageData.generatedAt}`,
    `- 패키지 checksum: \`${packageData.checksumSha256}\``,
    '- 이 산출물은 기관의 개인정보·기록물 판단을 구조화하며 인증·법률 판단을 대신하지 않습니다.',
    '',
    '## 개인정보 판단',
    '',
    `- 검토 상태: ${markdownCell(packageData.privacyDecision.status)}`,
    `- 처리 근거 문서: ${markdownCell(packageData.privacyDecision.lawfulBasisReference)}`,
    `- 정치적 의견 분류: ${markdownCell(packageData.privacyDecision.politicalOpinionClassification)}`,
    `- 음성·생체 분류: ${markdownCell(packageData.privacyDecision.audioBiometricClassification)}`,
    `- 국외 이전: ${markdownCell(packageData.privacyDecision.overseasTransferDecision)}`,
    '',
    '## 데이터 흐름',
    '',
    ...renderDataFlowDiagram(packageData.dataFlows),
    '',
    '| 데이터셋 | 정보주체 | 데이터 분류 | 수집 | schema object | 저장 위치 | 내부 이용 | 외부 이동 | 공개 |',
    '|---|---|---|---|---|---|---|---|---|',
    ...packageData.dataFlows.map((flow) => (
      `| ${markdownCell(flow.title)} | ${markdownCell(flow.dataSubjects)} | ${markdownCell(flow.dataClasses)} | ${markdownCell(flow.ingress)} | ${markdownCell(flow.schemaObjects)} | ${markdownCell(flow.storageLocations)} | ${markdownCell(flow.internalUses)} | ${markdownCell(flow.egress)} | ${markdownCell(flow.publicRelease)} |`
    )),
    '',
    '## 보존·처분 매핑',
    '',
    '| 데이터셋 | 기록 유형 | 단위과제 | 보존기간 | 기산점 | 처분 | 처분 권한 | 파기 방법 |',
    '|---|---|---|---|---|---|---|---|',
    ...packageData.retentionMappings.map((mapping) => (
      `| ${markdownCell(mapping.datasetId)} | ${markdownCell(mapping.recordClass)} | ${markdownCell(mapping.unitTaskCode)} | ${markdownCell(mapping.retentionPeriod)} | ${markdownCell(mapping.retentionTrigger)} | ${markdownCell(mapping.dispositionAction)} | ${markdownCell(mapping.dispositionAuthority)} | ${markdownCell(mapping.destructionMethod)} |`
    )),
    '',
    '## 미결정 항목',
    '',
    ...(packageData.blockers.length === 0
      ? ['- 없음']
      : packageData.blockers.map((blocker) => `- \`${blocker}\``)),
    '',
  ];
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = new Map();
  if (argv.length % 2 !== 0) throw new Error('Invalid CLI arguments');
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || args.has(key)) throw new Error('Invalid CLI arguments');
    args.set(key, value);
  }
  return args;
}

function readJsonFile(path, label) {
  try {
    const resolvedPath = realpathSync(resolve(path));
    if (!statSync(resolvedPath).isFile()) throw new Error('not a file');
    return JSON.parse(readFileSync(resolvedPath, 'utf8'));
  } catch {
    throw new Error(`Unable to read ${label}`);
  }
}

function validatePrivateProfilePath(path) {
  let resolvedPath;
  try {
    resolvedPath = realpathSync(resolve(path));
    if (!statSync(resolvedPath).isFile()) throw new Error('not a file');
  } catch {
    throw new Error('Institution profile is unavailable');
  }
  const relativeToRepository = relative(REPO_ROOT, resolvedPath);
  if (relativeToRepository === ''
    || (!relativeToRepository.startsWith('..') && !isAbsolute(relativeToRepository))) {
    throw new Error('Institution profile must remain outside the repository');
  }
  return resolvedPath;
}

function validatePrivateOutputPath(path) {
  const absolutePath = resolve(path);
  let resolvedParent;
  try {
    resolvedParent = realpathSync(dirname(absolutePath));
  } catch {
    throw new Error('Output directory is unavailable');
  }
  const relativeToRepository = relative(REPO_ROOT, resolve(resolvedParent, absolutePath.split(/[\\/]/).at(-1)));
  if (relativeToRepository === ''
    || (!relativeToRepository.startsWith('..') && !isAbsolute(relativeToRepository))) {
    throw new Error('Compliance package output must remain outside the repository');
  }
  return absolutePath;
}

export async function runPlatformCompliancePackageCli({ argv, generatedAt = new Date().toISOString() }) {
  const args = parseArgs(argv);
  const allowedArgs = new Set(['--profile', '--json-output', '--markdown-output']);
  if ([...args.keys()].some((key) => !allowedArgs.has(key))) throw new Error('Invalid CLI arguments');
  const profilePath = args.get('--profile');
  const jsonOutput = args.get('--json-output');
  const markdownOutput = args.get('--markdown-output');
  if (!profilePath || !jsonOutput || !markdownOutput) {
    throw new Error('Profile, JSON output, and Markdown output are required');
  }
  const jsonPath = validatePrivateOutputPath(jsonOutput);
  const markdownPath = validatePrivateOutputPath(markdownOutput);
  if (jsonPath === markdownPath || existsSync(jsonPath) || existsSync(markdownPath)) {
    throw new Error('Output already exists');
  }
  const catalog = readJsonFile(TRACKED_CATALOG_PATH, 'tracked compliance catalog');
  validatePlatformComplianceCatalog(catalog, { verifyRepositoryCoverage: true });
  const packageData = buildPlatformCompliancePackage({
    catalog,
    profile: readJsonFile(validatePrivateProfilePath(profilePath), 'institution profile'),
    generatedAt,
  });
  let jsonCreated = false;
  let markdownCreated = false;
  try {
    writeFileSync(jsonPath, `${JSON.stringify(packageData, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    jsonCreated = true;
    writeFileSync(markdownPath, renderPlatformCompliancePackageMarkdown(packageData), {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
    markdownCreated = true;
  } catch {
    if (jsonCreated) unlinkSync(jsonPath);
    if (markdownCreated) unlinkSync(markdownPath);
    throw new Error('Unable to write compliance package');
  }
  return {
    status: packageData.status,
    checksumSha256: packageData.checksumSha256,
    blockerCount: packageData.summary.blockerCount,
    databaseMutationExecuted: false,
    credentialFieldSchemaIncluded: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPlatformCompliancePackageCli({ argv: process.argv.slice(2) })
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Compliance package generation failed');
      process.exitCode = 1;
    });
}
