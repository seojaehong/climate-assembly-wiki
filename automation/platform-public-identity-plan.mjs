import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const ORGANIZATION_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const DEPLOYMENT_MODES = new Set(['pending', 'self_hosted_supabase']);
const FEDERATION_MODES = new Set(['pending', 'saml2', 'gpki_via_saml_gateway']);
const METADATA_SOURCE_KINDS = new Set(['pending', 'https_url', 'offline_file']);
const NAME_ID_FORMATS = new Set(['pending', 'persistent', 'email_address']);
const ACCOUNT_LINKING_MODES = new Set([
  'pending', 'preprovisioned_exact_subject', 'administrator_approved',
]);
const ENCRYPTED_ASSERTION_POLICIES = new Set([
  'pending', 'required', 'not_required_by_institution_review',
]);
const GATEWAY_STATUSES = new Set(['pending', 'approved', 'not_applicable']);
const REVIEW_STATUSES = new Set(['pending', 'approved']);
const PROFILE_KEYS = Object.freeze([
  'schemaVersion',
  'organizationCode',
  'systemName',
  'deploymentMode',
  'federationMode',
  'authBaseUrl',
  'applicationOrigin',
  'idpMetadata',
  'identityMapping',
  'assertionPolicy',
  'gatewayDecision',
  'review',
]);
const METADATA_KEYS = Object.freeze([
  'sourceKind',
  'sourceReference',
  'expectedEntityId',
  'certificateFingerprintSha256',
  'reviewedAt',
  'refreshOwnerRole',
]);
const IDENTITY_MAPPING_KEYS = Object.freeze([
  'nameIdFormat',
  'immutableSubjectAttribute',
  'emailAttribute',
  'accountLinking',
  'jitProvisioning',
  'defaultMembershipRole',
]);
const ASSERTION_POLICY_KEYS = Object.freeze([
  'responseSigned',
  'assertionSigned',
  'encryptedAssertions',
  'requireAudience',
  'requireDestination',
  'requireRecipient',
  'requireInResponseTo',
  'rejectReplay',
  'clockSyncOwnerRole',
]);
const GATEWAY_KEYS = Object.freeze(['status', 'ownerRole', 'reference']);
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

function requireHttpsUrl(value, label, { nullable = false, originOnly = false } = {}) {
  if (nullable && value === null) return null;
  const text = requireText(value, label);
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || (originOnly && url.toString() !== `${url.origin}/` && url.toString() !== url.origin)) {
    throw new Error(`Invalid ${label}`);
  }
  return originOnly ? url.origin : url.toString();
}

function validateMetadata(rawMetadata) {
  const metadata = requireObject(rawMetadata, 'IdP metadata');
  requireExactKeys(metadata, METADATA_KEYS, 'IdP metadata');
  const sourceKind = requireEnum(metadata.sourceKind, METADATA_SOURCE_KINDS, 'metadata source kind');
  let sourceReference = requireText(metadata.sourceReference, 'metadata source reference', { nullable: true });
  if (sourceKind === 'https_url' && sourceReference !== null) {
    sourceReference = requireHttpsUrl(sourceReference, 'metadata source reference');
    if (new URL(sourceReference).search) throw new Error('Metadata source URL cannot contain query parameters');
  }
  if (sourceKind === 'pending' && sourceReference !== null) throw new Error('Pending metadata source has a reference');
  if (sourceKind !== 'pending' && sourceReference === null) throw new Error('Metadata source reference is required');
  const certificateFingerprintSha256 = requireText(
    metadata.certificateFingerprintSha256,
    'metadata certificate fingerprint',
    { nullable: true },
  );
  if (certificateFingerprintSha256 !== null && !FINGERPRINT_PATTERN.test(certificateFingerprintSha256)) {
    throw new Error('Invalid metadata certificate fingerprint');
  }
  return {
    sourceKind,
    sourceReference,
    expectedEntityId: requireText(metadata.expectedEntityId, 'IdP entity id', { nullable: true }),
    certificateFingerprintSha256,
    reviewedAt: requireTimestamp(metadata.reviewedAt, 'metadata review timestamp', { nullable: true }),
    refreshOwnerRole: requireText(metadata.refreshOwnerRole, 'metadata refresh owner role', { nullable: true }),
  };
}

function validateIdentityMapping(rawMapping) {
  const mapping = requireObject(rawMapping, 'identity mapping');
  requireExactKeys(mapping, IDENTITY_MAPPING_KEYS, 'identity mapping');
  if (mapping.jitProvisioning !== false) throw new Error('JIT provisioning is not allowed');
  if (mapping.defaultMembershipRole !== null) throw new Error('External identity cannot grant membership role');
  return {
    nameIdFormat: requireEnum(mapping.nameIdFormat, NAME_ID_FORMATS, 'NameID format'),
    immutableSubjectAttribute: requireText(
      mapping.immutableSubjectAttribute,
      'immutable subject attribute',
      { nullable: true },
    ),
    emailAttribute: requireText(mapping.emailAttribute, 'email attribute', { nullable: true }),
    accountLinking: requireEnum(mapping.accountLinking, ACCOUNT_LINKING_MODES, 'account linking'),
    jitProvisioning: false,
    defaultMembershipRole: null,
  };
}

function validateAssertionPolicy(rawPolicy) {
  const policy = requireObject(rawPolicy, 'assertion policy');
  requireExactKeys(policy, ASSERTION_POLICY_KEYS, 'assertion policy');
  for (const field of [
    'responseSigned',
    'assertionSigned',
    'requireAudience',
    'requireDestination',
    'requireRecipient',
    'requireInResponseTo',
    'rejectReplay',
  ]) {
    if (policy[field] !== true) throw new Error(`Unsafe assertion policy ${field}`);
  }
  return {
    responseSigned: true,
    assertionSigned: true,
    encryptedAssertions: requireEnum(
      policy.encryptedAssertions,
      ENCRYPTED_ASSERTION_POLICIES,
      'encrypted assertion policy',
    ),
    requireAudience: true,
    requireDestination: true,
    requireRecipient: true,
    requireInResponseTo: true,
    rejectReplay: true,
    clockSyncOwnerRole: requireText(policy.clockSyncOwnerRole, 'clock sync owner role', { nullable: true }),
  };
}

function validateGatewayDecision(rawDecision, federationMode) {
  const decision = requireObject(rawDecision, 'gateway decision');
  requireExactKeys(decision, GATEWAY_KEYS, 'gateway decision');
  const normalized = {
    status: requireEnum(decision.status, GATEWAY_STATUSES, 'gateway status'),
    ownerRole: requireText(decision.ownerRole, 'gateway owner role', { nullable: true }),
    reference: requireText(decision.reference, 'gateway decision reference', { nullable: true }),
  };
  if (federationMode === 'gpki_via_saml_gateway'
    && (normalized.status !== 'approved' || !normalized.ownerRole || !normalized.reference)) {
    throw new Error('GPKI gateway decision is incomplete');
  }
  if (federationMode === 'saml2'
    && (normalized.status !== 'not_applicable' || normalized.ownerRole || normalized.reference)) {
    throw new Error('SAML gateway decision must be not applicable');
  }
  return normalized;
}

function validateReview(rawReview) {
  const review = requireObject(rawReview, 'institution review');
  requireExactKeys(review, REVIEW_KEYS, 'institution review');
  const normalized = {
    status: requireEnum(review.status, REVIEW_STATUSES, 'institution review status'),
    reviewerRole: requireText(review.reviewerRole, 'institution reviewer role', { nullable: true }),
    reviewedAt: requireTimestamp(review.reviewedAt, 'institution review timestamp', { nullable: true }),
  };
  if (normalized.status === 'approved' && (!normalized.reviewerRole || !normalized.reviewedAt)) {
    throw new Error('Approved institution review is incomplete');
  }
  return normalized;
}

function validateProfile(rawProfile) {
  const profile = requireObject(rawProfile, 'institution identity profile');
  requireExactKeys(profile, PROFILE_KEYS, 'institution identity profile');
  if (profile.schemaVersion !== 1) throw new Error('Unsupported institution identity profile schema version');
  const organizationCode = requireText(profile.organizationCode, 'organization code');
  if (!ORGANIZATION_CODE_PATTERN.test(organizationCode)) throw new Error('Invalid organization code');
  const deploymentMode = requireEnum(profile.deploymentMode, DEPLOYMENT_MODES, 'deployment mode');
  const federationMode = requireEnum(profile.federationMode, FEDERATION_MODES, 'federation mode');
  const authBaseUrl = requireHttpsUrl(profile.authBaseUrl, 'Auth base URL', { nullable: true });
  if (authBaseUrl !== null) {
    const parsed = new URL(authBaseUrl);
    if (parsed.search || !/\/auth\/v1\/?$/u.test(parsed.pathname)) throw new Error('Invalid Auth base URL');
  }
  return {
    schemaVersion: 1,
    organizationCode,
    systemName: requireText(profile.systemName, 'system name'),
    deploymentMode,
    federationMode,
    authBaseUrl: authBaseUrl?.replace(/\/$/u, '') ?? null,
    applicationOrigin: requireHttpsUrl(
      profile.applicationOrigin,
      'application origin',
      { nullable: true, originOnly: true },
    ),
    idpMetadata: validateMetadata(profile.idpMetadata),
    identityMapping: validateIdentityMapping(profile.identityMapping),
    assertionPolicy: validateAssertionPolicy(profile.assertionPolicy),
    gatewayDecision: validateGatewayDecision(profile.gatewayDecision, federationMode),
    review: validateReview(profile.review),
  };
}

function profileBlockers(profile) {
  const blockers = [];
  if (profile.deploymentMode === 'pending') blockers.push('deployment_mode');
  if (profile.federationMode === 'pending') blockers.push('federation_mode');
  if (!profile.authBaseUrl) blockers.push('service_provider.auth_base_url');
  if (!profile.applicationOrigin) blockers.push('service_provider.application_origin');
  if (profile.idpMetadata.sourceKind === 'pending') blockers.push('idp_metadata.source');
  if (!profile.idpMetadata.expectedEntityId) blockers.push('idp_metadata.entity_id');
  if (!profile.idpMetadata.certificateFingerprintSha256) blockers.push('idp_metadata.certificate_fingerprint');
  if (!profile.idpMetadata.reviewedAt) blockers.push('idp_metadata.reviewed_at');
  if (!profile.idpMetadata.refreshOwnerRole) blockers.push('idp_metadata.refresh_owner');
  if (profile.identityMapping.nameIdFormat === 'pending') blockers.push('identity_mapping.name_id_format');
  if (!profile.identityMapping.immutableSubjectAttribute) blockers.push('identity_mapping.immutable_subject');
  if (!profile.identityMapping.emailAttribute) blockers.push('identity_mapping.email_attribute');
  if (profile.identityMapping.accountLinking === 'pending') blockers.push('identity_mapping.account_linking');
  if (profile.assertionPolicy.encryptedAssertions === 'pending') {
    blockers.push('assertion_policy.encrypted_assertions');
  }
  if (!profile.assertionPolicy.clockSyncOwnerRole) blockers.push('assertion_policy.clock_sync_owner');
  if (profile.federationMode === 'pending' && profile.gatewayDecision.status === 'pending') {
    blockers.push('gateway_decision');
  }
  if (profile.review.status !== 'approved') blockers.push('institution_review');
  return blockers.sort();
}

export function buildPublicIdentityPlan({ profile, generatedAt }) {
  const validatedProfile = validateProfile(profile);
  const observedAt = requireTimestamp(generatedAt, 'plan generation timestamp');
  for (const reviewedAt of [validatedProfile.idpMetadata.reviewedAt, validatedProfile.review.reviewedAt]) {
    if (reviewedAt && Date.parse(reviewedAt) > Date.parse(observedAt)) {
      throw new Error('Review timestamp follows plan generation');
    }
  }
  const blockers = profileBlockers(validatedProfile);
  const metadataUrl = validatedProfile.authBaseUrl
    ? `${validatedProfile.authBaseUrl}/sso/saml/metadata`
    : null;
  const planWithoutChecksum = {
    schemaVersion: 1,
    planKind: 'public_identity_federation_support',
    organizationCode: validatedProfile.organizationCode,
    systemName: validatedProfile.systemName,
    generatedAt: observedAt,
    status: blockers.length === 0
      ? 'ready_for_institution_integration'
      : 'needs_institution_identity_decisions',
    readyForInstitutionIntegration: blockers.length === 0,
    databaseMutationExecuted: false,
    authProviderRegistered: false,
    credentialFieldSchemaIncluded: false,
    deploymentMode: validatedProfile.deploymentMode,
    federationBoundary: {
      mode: validatedProfile.federationMode,
      directGpkiCertificateProcessing: false,
      gatewayRequired: validatedProfile.federationMode === 'gpki_via_saml_gateway',
      gatewayDecision: validatedProfile.gatewayDecision,
    },
    serviceProvider: {
      entityId: metadataUrl,
      metadataUrl,
      assertionConsumerServiceUrl: validatedProfile.authBaseUrl
        ? `${validatedProfile.authBaseUrl}/sso/saml/acs`
        : null,
      applicationOrigin: validatedProfile.applicationOrigin,
    },
    identityProvider: validatedProfile.idpMetadata,
    identityMapping: validatedProfile.identityMapping,
    assertionPolicy: validatedProfile.assertionPolicy,
    authorizationBoundary: {
      membershipProvisioning: 'separate_approved_workflow',
      externalAttributesGrantApplicationRole: false,
      defaultMembershipRole: null,
    },
    institutionReview: validatedProfile.review,
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
    throw new Error('Identity plan output must remain outside the repository');
  }
  return finalPath;
}

function readProfile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Unable to read institution identity profile');
  }
}

export async function runPublicIdentityPlanCli({ argv, generatedAt = new Date().toISOString() }) {
  const args = parseArgs(argv);
  if ([...args.keys()].some((key) => !['--profile', '--output'].includes(key))) {
    throw new Error('Invalid CLI arguments');
  }
  const profileArgument = args.get('--profile');
  const outputArgument = args.get('--output');
  if (!profileArgument || !outputArgument) throw new Error('Profile and output are required');
  const profilePath = privateFilePath(profileArgument, 'Institution identity profile');
  const outputPath = privateOutputPath(outputArgument);
  if (existsSync(outputPath)) throw new Error('Output already exists');
  const plan = buildPublicIdentityPlan({ profile: readProfile(profilePath), generatedAt });
  try {
    writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
  } catch {
    throw new Error('Unable to write identity plan');
  }
  return {
    status: plan.status,
    blockerCount: plan.blockers.length,
    checksumSha256: plan.checksumSha256,
    databaseMutationExecuted: false,
    authProviderRegistered: false,
    credentialFieldSchemaIncluded: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicIdentityPlanCli({ argv: process.argv.slice(2) })
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Identity plan generation failed');
      process.exitCode = 1;
    });
}
