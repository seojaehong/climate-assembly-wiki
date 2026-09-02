import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const ROUTING_MODES = new Set(['pending', 'tenant_registry']);
const REGION_TRACKS = new Set(['kr_public_csap', 'international']);
const PROVIDER_ELIGIBILITY = new Set(['pending', 'csap_eligible', 'commercially_approved']);
const KEY_SCOPES = new Set(['pending', 'region_local']);
const ASSIGNMENT_STATUSES = new Set(['pending', 'approved']);
const REVIEW_STATUSES = new Set(['pending', 'approved']);
const PROFILE_KEYS = Object.freeze([
  'schemaVersion', 'routingMode', 'regions', 'tenantAssignments', 'review',
]);
const REGION_KEYS = Object.freeze([
  'id', 'track', 'applicationOrigin', 'apiOrigin', 'dataLocationCountry',
  'objectStorageCountry', 'backupCountry', 'providerEligibility',
  'crossRegionReplication', 'encryptionKeyScope', 'operationalOwnerRole',
]);
const ASSIGNMENT_KEYS = Object.freeze([
  'organizationCode', 'homeRegionId', 'contractCountryCode', 'status',
  'approvedByRole', 'approvedAt',
]);
const REVIEW_KEYS = Object.freeze(['status', 'reviewerRole', 'reviewedAt']);

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

function requireCode(value, label, { nullable = false } = {}) {
  const text = requireText(value, label, { nullable });
  if (text !== null && !CODE_PATTERN.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

function requireCountry(value, label, { nullable = false } = {}) {
  const text = requireText(value, label, { nullable });
  if (text !== null && !COUNTRY_PATTERN.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

function requireEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`Invalid ${label}`);
  return value;
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

function requireHttpsOrigin(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = requireText(value, label);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.pathname !== '' && url.pathname !== '/')) {
    throw new Error(`Invalid ${label}`);
  }
  return url.origin;
}

function validateRegion(rawRegion) {
  const region = requireObject(rawRegion, 'residency region');
  requireExactKeys(region, REGION_KEYS, 'residency region');
  if (region.crossRegionReplication !== false) {
    throw new Error('Cross-region replication is not allowed');
  }
  const normalized = {
    id: requireCode(region.id, 'region id'),
    track: requireEnum(region.track, REGION_TRACKS, 'region track'),
    applicationOrigin: requireHttpsOrigin(region.applicationOrigin, 'application origin', { nullable: true }),
    apiOrigin: requireHttpsOrigin(region.apiOrigin, 'API origin', { nullable: true }),
    dataLocationCountry: requireCountry(region.dataLocationCountry, 'data location country', { nullable: true }),
    objectStorageCountry: requireCountry(region.objectStorageCountry, 'object storage country', { nullable: true }),
    backupCountry: requireCountry(region.backupCountry, 'backup country', { nullable: true }),
    providerEligibility: requireEnum(
      region.providerEligibility,
      PROVIDER_ELIGIBILITY,
      'provider eligibility',
    ),
    crossRegionReplication: false,
    encryptionKeyScope: requireEnum(region.encryptionKeyScope, KEY_SCOPES, 'encryption key scope'),
    operationalOwnerRole: requireText(
      region.operationalOwnerRole,
      'operational owner role',
      { nullable: true },
    ),
  };
  const countries = [
    normalized.dataLocationCountry,
    normalized.objectStorageCountry,
    normalized.backupCountry,
  ].filter(Boolean);
  if (new Set(countries).size > 1) throw new Error('Region storage and backup countries must match');
  if (normalized.track === 'kr_public_csap') {
    if (countries.some((country) => country !== 'KR')) throw new Error('Korean public region must remain in KR');
    if (!['pending', 'csap_eligible'].includes(normalized.providerEligibility)) {
      throw new Error('Korean public region requires CSAP-eligible infrastructure');
    }
  } else {
    if (countries.some((country) => country === 'KR')) {
      throw new Error('International region must use a separate overseas data location');
    }
    if (!['pending', 'commercially_approved'].includes(normalized.providerEligibility)) {
      throw new Error('International region requires commercial provider approval');
    }
  }
  return normalized;
}

function validateAssignment(rawAssignment, regionsById) {
  const assignment = requireObject(rawAssignment, 'tenant assignment');
  requireExactKeys(assignment, ASSIGNMENT_KEYS, 'tenant assignment');
  const normalized = {
    organizationCode: requireCode(assignment.organizationCode, 'organization code'),
    homeRegionId: requireCode(assignment.homeRegionId, 'home region id', { nullable: true }),
    contractCountryCode: requireCountry(
      assignment.contractCountryCode,
      'contract country code',
      { nullable: true },
    ),
    status: requireEnum(assignment.status, ASSIGNMENT_STATUSES, 'tenant assignment status'),
    approvedByRole: requireText(assignment.approvedByRole, 'assignment approver role', { nullable: true }),
    approvedAt: requireTimestamp(assignment.approvedAt, 'assignment approval timestamp', { nullable: true }),
  };
  if (normalized.homeRegionId && !regionsById.has(normalized.homeRegionId)) {
    throw new Error('Tenant assignment references an unknown region');
  }
  if (normalized.status === 'approved'
    && (!normalized.homeRegionId || !normalized.contractCountryCode
      || !normalized.approvedByRole || !normalized.approvedAt)) {
    throw new Error('Approved tenant assignment is incomplete');
  }
  if (normalized.homeRegionId && normalized.contractCountryCode) {
    const homeRegion = regionsById.get(normalized.homeRegionId);
    if (normalized.contractCountryCode === 'KR' && homeRegion.track !== 'kr_public_csap') {
      throw new Error('Korean tenant must route to the Korean public region');
    }
    if (normalized.contractCountryCode !== 'KR' && homeRegion.track !== 'international') {
      throw new Error('International tenant must route to an international region');
    }
  }
  return normalized;
}

function validateReview(rawReview) {
  const review = requireObject(rawReview, 'residency review');
  requireExactKeys(review, REVIEW_KEYS, 'residency review');
  const normalized = {
    status: requireEnum(review.status, REVIEW_STATUSES, 'residency review status'),
    reviewerRole: requireText(review.reviewerRole, 'residency reviewer role', { nullable: true }),
    reviewedAt: requireTimestamp(review.reviewedAt, 'residency review timestamp', { nullable: true }),
  };
  if (normalized.status === 'approved' && (!normalized.reviewerRole || !normalized.reviewedAt)) {
    throw new Error('Approved residency review is incomplete');
  }
  return normalized;
}

function validateProfile(rawProfile) {
  const profile = requireObject(rawProfile, 'data residency profile');
  requireExactKeys(profile, PROFILE_KEYS, 'data residency profile');
  if (profile.schemaVersion !== 1) throw new Error('Unsupported data residency profile schema version');
  if (!Array.isArray(profile.regions) || profile.regions.length < 2 || profile.regions.length > 20) {
    throw new Error('Data residency profile requires between 2 and 20 regions');
  }
  const regions = profile.regions.map(validateRegion);
  const regionIds = regions.map((region) => region.id);
  if (new Set(regionIds).size !== regionIds.length) throw new Error('Duplicate region id');
  if (regions.filter((region) => region.track === 'kr_public_csap').length !== 1) {
    throw new Error('Exactly one Korean public region is required');
  }
  if (!regions.some((region) => region.track === 'international')) {
    throw new Error('At least one international region is required');
  }
  const origins = regions.flatMap((region) => [region.applicationOrigin, region.apiOrigin]).filter(Boolean);
  if (new Set(origins).size !== origins.length) throw new Error('Region origins must be globally unique');
  if (!Array.isArray(profile.tenantAssignments) || profile.tenantAssignments.length > 10_000) {
    throw new Error('Invalid tenant assignments');
  }
  const regionsById = new Map(regions.map((region) => [region.id, region]));
  const tenantAssignments = profile.tenantAssignments.map((assignment) => (
    validateAssignment(assignment, regionsById)
  ));
  const organizationCodes = tenantAssignments.map((assignment) => assignment.organizationCode);
  if (new Set(organizationCodes).size !== organizationCodes.length) {
    throw new Error('Duplicate tenant assignment');
  }
  return {
    schemaVersion: 1,
    routingMode: requireEnum(profile.routingMode, ROUTING_MODES, 'routing mode'),
    regions,
    tenantAssignments,
    review: validateReview(profile.review),
  };
}

function profileBlockers(profile) {
  const blockers = [];
  if (profile.routingMode !== 'tenant_registry') blockers.push('routing_mode');
  for (const region of profile.regions) {
    for (const [field, value] of [
      ['application_origin', region.applicationOrigin],
      ['api_origin', region.apiOrigin],
      ['data_location_country', region.dataLocationCountry],
      ['object_storage_country', region.objectStorageCountry],
      ['backup_country', region.backupCountry],
      ['operational_owner', region.operationalOwnerRole],
    ]) {
      if (!value) blockers.push(`regions.${region.id}.${field}`);
    }
    if (region.providerEligibility === 'pending') blockers.push(`regions.${region.id}.provider_eligibility`);
    if (region.encryptionKeyScope !== 'region_local') blockers.push(`regions.${region.id}.encryption_key_scope`);
  }
  for (const assignment of profile.tenantAssignments) {
    if (assignment.status !== 'approved') {
      blockers.push(`tenant_assignments.${assignment.organizationCode}.approval`);
    }
  }
  if (profile.review.status !== 'approved') blockers.push('residency_review');
  return blockers.sort();
}

export function buildDataResidencyPlan({ profile, generatedAt }) {
  const validatedProfile = validateProfile(profile);
  const observedAt = requireTimestamp(generatedAt, 'plan generation timestamp');
  const timestamps = [
    validatedProfile.review.reviewedAt,
    ...validatedProfile.tenantAssignments.map((assignment) => assignment.approvedAt),
  ];
  if (timestamps.some((timestamp) => timestamp && Date.parse(timestamp) > Date.parse(observedAt))) {
    throw new Error('Approval timestamp follows plan generation');
  }
  const blockers = profileBlockers(validatedProfile);
  const planWithoutChecksum = {
    schemaVersion: 1,
    planKind: 'tenant_data_residency_routing',
    generatedAt: observedAt,
    status: blockers.length === 0 ? 'ready_for_isolated_deployment' : 'needs_residency_decisions',
    readyForIsolatedDeployment: blockers.length === 0,
    databaseMutationExecuted: false,
    infrastructureProvisioned: false,
    dnsChanged: false,
    routingBoundary: {
      mode: validatedProfile.routingMode,
      routingInput: 'approved_tenant_registry_only',
      clientIpOrBrowserLocaleRouting: false,
      centralControlPlaneStoresParticipantData: false,
      unknownTenantBehavior: 'deny',
    },
    dataBoundary: {
      crossRegionReplication: false,
      crossRegionBackup: false,
      encryptionKeyScope: 'region_local',
      coveredData: [
        'participant_identity', 'deliberation_content', 'audio', 'transcript', 'audit_log', 'backup',
      ],
    },
    regions: validatedProfile.regions.map((region) => ({
      ...region,
      assignedOrganizationCodes: validatedProfile.tenantAssignments
        .filter((assignment) => assignment.status === 'approved' && assignment.homeRegionId === region.id)
        .map((assignment) => assignment.organizationCode)
        .sort(),
    })),
    tenantAssignments: validatedProfile.tenantAssignments,
    residencyReview: validatedProfile.review,
    blockers,
  };
  return {
    ...planWithoutChecksum,
    checksumSha256: sha256(canonicalJson(planWithoutChecksum)),
  };
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length % 2 !== 0) throw new Error('Invalid CLI arguments');
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || args.has(key)) throw new Error('Invalid CLI arguments');
    args.set(key, value);
  }
  return args;
}

function privateFilePath(path, label) {
  let resolvedPath;
  try {
    resolvedPath = realpathSync(resolve(path));
    if (!statSync(resolvedPath).isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  const relativePath = relative(REPO_ROOT, resolvedPath);
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    throw new Error(`${label} must remain outside the repository`);
  }
  return resolvedPath;
}

function privateOutputPath(path) {
  const absolutePath = resolve(path);
  let resolvedParent;
  try {
    resolvedParent = realpathSync(dirname(absolutePath));
  } catch {
    throw new Error('Output directory is unavailable');
  }
  const finalPath = resolve(resolvedParent, absolutePath.split(/[\\/]/u).at(-1));
  const relativePath = relative(REPO_ROOT, finalPath);
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    throw new Error('Residency plan output must remain outside the repository');
  }
  return finalPath;
}

function readProfile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Unable to read data residency profile');
  }
}

export async function runDataResidencyPlanCli({ argv, generatedAt = new Date().toISOString() }) {
  const args = parseArgs(argv);
  if ([...args.keys()].some((key) => !['--profile', '--output'].includes(key))) {
    throw new Error('Invalid CLI arguments');
  }
  const profileArgument = args.get('--profile');
  const outputArgument = args.get('--output');
  if (!profileArgument || !outputArgument) throw new Error('Profile and output are required');
  const profilePath = privateFilePath(profileArgument, 'Data residency profile');
  const outputPath = privateOutputPath(outputArgument);
  if (existsSync(outputPath)) throw new Error('Output already exists');
  const plan = buildDataResidencyPlan({ profile: readProfile(profilePath), generatedAt });
  try {
    writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
  } catch {
    throw new Error('Unable to write data residency plan');
  }
  return {
    status: plan.status,
    blockerCount: plan.blockers.length,
    checksumSha256: plan.checksumSha256,
    databaseMutationExecuted: false,
    infrastructureProvisioned: false,
    dnsChanged: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDataResidencyPlanCli({ argv: process.argv.slice(2) })
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Data residency plan generation failed');
      process.exitCode = 1;
    });
}
