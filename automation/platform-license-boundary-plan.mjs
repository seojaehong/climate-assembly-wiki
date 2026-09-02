import { createHash } from 'node:crypto';
import {
  existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const STRATEGIES = new Set(['pending', 'open_source_agpl', 'dual_license']);
const SOFTWARE_LICENSES = new Set(['pending', 'AGPL-3.0-only', 'AGPL-3.0-or-later']);
const REVIEW_STATUSES = new Set(['pending', 'approved']);
const PROFILE_KEYS = Object.freeze([
  'schemaVersion', 'strategy', 'softwareLicense', 'contentLicense',
  'commercialLicenseOwnerRole', 'copyrightOwnershipReview',
  'contributorRightsReview', 'thirdPartyNoticeReview', 'decisionReview',
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

function requireEnum(value, allowed, label) {
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function requireTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text)
    || Number.isNaN(Date.parse(text)) || new Date(text).toISOString() !== text) {
    throw new Error(`Invalid ${label}`);
  }
  return text;
}

function readText(repoRoot, path) {
  const absolutePath = join(repoRoot, path);
  try {
    if (!statSync(absolutePath).isFile()) throw new Error('not a file');
    return readFileSync(absolutePath, 'utf8');
  } catch {
    throw new Error(`Required repository file is unavailable: ${path}`);
  }
}

function readJson(repoRoot, path) {
  try {
    return JSON.parse(readText(repoRoot, path));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Required repository file')) throw error;
    throw new Error(`Invalid repository JSON: ${path}`);
  }
}

function fileEvidence(repoRoot, path) {
  const absolutePath = join(repoRoot, path);
  let stat;
  try {
    stat = statSync(absolutePath);
  } catch {
    throw new Error(`Required repository evidence is unavailable: ${path}`);
  }
  if (stat.isFile()) {
    const content = readText(repoRoot, path);
    return {
      path, kind: 'file', sha256: sha256(content), byteCount: Buffer.byteLength(content, 'utf8'),
    };
  }
  if (!stat.isDirectory()) throw new Error(`Unsupported repository evidence type: ${path}`);
  const files = [];
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), relativePath);
      else if (entry.isFile()) files.push(relativePath);
      else throw new Error(`Unsupported repository evidence entry: ${path}/${relativePath}`);
    }
  };
  visit(absolutePath);
  if (files.length === 0) throw new Error(`Repository evidence directory is empty: ${path}`);
  const entries = files.map((relativePath) => {
    const content = readFileSync(join(absolutePath, ...relativePath.split('/')), 'utf8');
    return { path: relativePath, sha256: sha256(content), byteCount: Buffer.byteLength(content, 'utf8') };
  });
  return {
    path,
    kind: 'directory',
    fileCount: entries.length,
    byteCount: entries.reduce((total, entry) => total + entry.byteCount, 0),
    sha256: sha256(canonicalJson(entries)),
  };
}

function directDependencyEvidence(repoRoot, packageJson, packageLock) {
  const rootLock = requireObject(packageLock.packages, 'package lock packages');
  const declared = [
    ...Object.entries(packageJson.dependencies ?? {}).map(([name, range]) => ({ name, range, scope: 'runtime' })),
    ...Object.entries(packageJson.devDependencies ?? {}).map(([name, range]) => ({ name, range, scope: 'development' })),
  ].sort((left, right) => left.name.localeCompare(right.name));

  return declared.map(({ name, range, scope }) => {
    const lockPath = `node_modules/${name}`;
    const lockEntry = requireObject(rootLock[lockPath], `lock entry for ${name}`);
    let metadata = lockEntry;
    let metadataPath = 'package-lock.json';
    if (lockEntry.link === true) {
      const resolved = requireText(lockEntry.resolved, `resolved path for ${name}`);
      const normalized = resolved.replaceAll('\\', '/');
      let resolvedDependencyPath;
      try {
        resolvedDependencyPath = realpathSync(resolve(repoRoot, normalized));
      } catch {
        throw new Error(`Linked dependency path is unavailable: ${name}`);
      }
      const dependencyRelativePath = relative(repoRoot, resolvedDependencyPath);
      if (dependencyRelativePath === ''
        || dependencyRelativePath.startsWith('..')
        || isAbsolute(dependencyRelativePath)) {
        throw new Error(`Unsafe linked dependency path: ${name}`);
      }
      metadataPath = `${dependencyRelativePath.replaceAll('\\', '/')}/package.json`;
      metadata = readJson(repoRoot, metadataPath);
    }
    const license = typeof metadata.license === 'string' && metadata.license.trim()
      ? metadata.license.trim() : null;
    return {
      name,
      declaredRange: requireText(range, `declared range for ${name}`),
      scope,
      version: requireText(metadata.version, `version for ${name}`),
      license,
      metadataPath,
    };
  });
}

function validateReview(rawReview, label) {
  const review = requireObject(rawReview, label);
  requireExactKeys(review, REVIEW_KEYS, label);
  const normalized = {
    status: requireEnum(review.status, REVIEW_STATUSES, `${label} status`),
    reviewerRole: requireText(review.reviewerRole, `${label} reviewer role`, { nullable: true }),
    reviewedAt: requireTimestamp(review.reviewedAt, `${label} timestamp`, { nullable: true }),
  };
  if (normalized.status === 'approved' && (!normalized.reviewerRole || !normalized.reviewedAt)) {
    throw new Error(`Approved ${label} is incomplete`);
  }
  return normalized;
}

function validateProfile(rawProfile) {
  const profile = requireObject(rawProfile, 'license decision profile');
  requireExactKeys(profile, PROFILE_KEYS, 'license decision profile');
  if (profile.schemaVersion !== 1) throw new Error('Unsupported license decision profile schema version');
  const normalized = {
    schemaVersion: 1,
    strategy: requireEnum(profile.strategy, STRATEGIES, 'license strategy'),
    softwareLicense: requireEnum(profile.softwareLicense, SOFTWARE_LICENSES, 'software license'),
    contentLicense: requireText(profile.contentLicense, 'content license'),
    commercialLicenseOwnerRole: requireText(
      profile.commercialLicenseOwnerRole,
      'commercial license owner role',
      { nullable: true },
    ),
    copyrightOwnershipReview: validateReview(profile.copyrightOwnershipReview, 'copyright ownership review'),
    contributorRightsReview: validateReview(profile.contributorRightsReview, 'contributor rights review'),
    thirdPartyNoticeReview: validateReview(profile.thirdPartyNoticeReview, 'third-party notice review'),
    decisionReview: validateReview(profile.decisionReview, 'license decision review'),
  };
  if (normalized.contentLicense !== 'CC-BY-SA-4.0') {
    throw new Error('Content license must preserve CC-BY-SA-4.0 in this decision package');
  }
  if (normalized.strategy === 'pending' && normalized.softwareLicense !== 'pending') {
    throw new Error('Pending strategy cannot select a software license');
  }
  if (normalized.strategy !== 'pending' && normalized.softwareLicense === 'pending') {
    throw new Error('Selected strategy requires a software license');
  }
  if (normalized.strategy === 'dual_license' && !normalized.commercialLicenseOwnerRole) {
    throw new Error('Dual license strategy requires a commercial license owner role');
  }
  if (normalized.strategy !== 'dual_license' && normalized.commercialLicenseOwnerRole) {
    throw new Error('Commercial license owner role is only valid for dual licensing');
  }
  return normalized;
}

function decisionBlockers(profile) {
  const blockers = [];
  if (profile.strategy === 'pending') blockers.push('strategy');
  if (profile.softwareLicense === 'pending') blockers.push('software_license');
  for (const [name, review] of [
    ['copyright_ownership_review', profile.copyrightOwnershipReview],
    ['contributor_rights_review', profile.contributorRightsReview],
    ['third_party_notice_review', profile.thirdPartyNoticeReview],
    ['license_decision_review', profile.decisionReview],
  ]) {
    if (review.status !== 'approved') blockers.push(name);
  }
  return blockers.sort();
}

export function buildLicenseBoundaryPlan({ repoRoot, profile, generatedAt }) {
  const resolvedRepoRoot = realpathSync(resolve(repoRoot));
  const packageJson = readJson(resolvedRepoRoot, 'package.json');
  const packageLock = readJson(resolvedRepoRoot, 'package-lock.json');
  const validatedProfile = validateProfile(profile);
  const observedAt = requireTimestamp(generatedAt, 'plan generation timestamp');
  const reviews = [
    validatedProfile.copyrightOwnershipReview,
    validatedProfile.contributorRightsReview,
    validatedProfile.thirdPartyNoticeReview,
    validatedProfile.decisionReview,
  ];
  if (reviews.some((review) => review.reviewedAt && Date.parse(review.reviewedAt) > Date.parse(observedAt))) {
    throw new Error('Review timestamp follows plan generation');
  }

  const directDependencies = directDependencyEvidence(resolvedRepoRoot, packageJson, packageLock);
  const missingDependencyLicenses = directDependencies
    .filter((dependency) => !dependency.license)
    .map((dependency) => dependency.name);
  const blockers = decisionBlockers(validatedProfile);
  if (missingDependencyLicenses.length > 0) blockers.push('direct_dependency_license_metadata');
  blockers.sort();

  const rootLicenseText = readText(resolvedRepoRoot, 'LICENSE');
  const readmeText = readText(resolvedRepoRoot, 'README.md');
  const contentConfigText = readText(resolvedRepoRoot, 'src/content/config.ts');
  const enRoadsLicenseText = readText(resolvedRepoRoot, 'tools/en-roads/LICENSE.md');
  const repositoryEvidence = [
    'LICENSE', 'README.md', 'package.json', 'package-lock.json', 'src/content/config.ts',
    'tools/en-roads/LICENSE.md', 'vendor/rhwp-core-0.8.4/LICENSE',
    'vendor/rhwp-core-0.8.4/package.json', 'vendor/kordoc-4.12.0/LICENSE',
    'vendor/kordoc-4.12.0/NOTICE', 'vendor/kordoc-4.12.0/THIRD_PARTY',
    'vendor/kordoc-4.12.0/package.json', 'vendor/UPSTREAM.md',
  ].map((path) => fileEvidence(resolvedRepoRoot, path));

  const planWithoutChecksum = {
    schemaVersion: 1,
    planKind: 'software_content_license_boundary',
    generatedAt: observedAt,
    status: blockers.length === 0 ? 'ready_for_license_change_review' : 'needs_rights_holder_decisions',
    readyForLicenseChangeReview: blockers.length === 0,
    legalAdviceProvided: false,
    rightsGranted: false,
    licenseFilesChanged: false,
    packageMetadataChanged: false,
    databaseMutationExecuted: false,
    decision: validatedProfile,
    currentRepositoryState: {
      rootLicenseDetected: /Creative Commons Attribution-ShareAlike 4\.0 International/i.test(rootLicenseText)
        ? 'CC-BY-SA-4.0' : 'unclassified',
      readmeDeclaresCcBySa: /CC BY-SA 4\.0/i.test(readmeText),
      packageLicenseField: typeof packageJson.license === 'string' ? packageJson.license : null,
      contentSchemaDeclaresCcBySa: /z\.literal\('CC-BY-SA-4\.0'\)/.test(contentConfigText),
      enRoadsBoundaryDeclaresCcBy: /CC BY 4\.0/i.test(enRoadsLicenseText),
      directDependencies,
      missingDependencyLicenses,
      repositoryEvidence,
    },
    requiredChangeReview: [
      'separate_software_and_content_scope',
      'confirm_all_relicensing_authority',
      'preserve_third_party_license_and_notice_files',
      'add_root_package_spdx_license_after_approval',
      'review_contributor_and_trademark_terms',
    ],
    currentStateRisks: [
      'root_cc_license_appears_to_cover_software_and_content_together',
      'root_package_has_no_explicit_license_field',
      'third_party_material_requires_scope_specific_notices',
    ],
    blockers,
  };
  return { ...planWithoutChecksum, checksumSha256: sha256(canonicalJson(planWithoutChecksum)) };
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
    throw new Error('License boundary plan output must remain outside the repository');
  }
  return finalPath;
}

function readProfile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Unable to read license decision profile');
  }
}

export async function runLicenseBoundaryPlanCli({ argv, generatedAt = new Date().toISOString() }) {
  const args = parseArgs(argv);
  if ([...args.keys()].some((key) => !['--profile', '--output'].includes(key))) {
    throw new Error('Invalid CLI arguments');
  }
  const profileArgument = args.get('--profile');
  const outputArgument = args.get('--output');
  if (!profileArgument || !outputArgument) throw new Error('Profile and output are required');
  const profilePath = privateFilePath(profileArgument, 'License decision profile');
  const outputPath = privateOutputPath(outputArgument);
  if (existsSync(outputPath)) throw new Error('Output already exists');
  const plan = buildLicenseBoundaryPlan({
    repoRoot: REPO_ROOT,
    profile: readProfile(profilePath),
    generatedAt,
  });
  try {
    writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: 0o600,
    });
  } catch {
    throw new Error('Unable to write license boundary plan');
  }
  return {
    status: plan.status,
    blockerCount: plan.blockers.length,
    directDependencyCount: plan.currentRepositoryState.directDependencies.length,
    checksumSha256: plan.checksumSha256,
    rightsGranted: false,
    licenseFilesChanged: false,
    packageMetadataChanged: false,
    databaseMutationExecuted: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLicenseBoundaryPlanCli({ argv: process.argv.slice(2) })
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'License boundary plan generation failed');
      process.exitCode = 1;
    });
}
