import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));
const CONTRACT_PATH = new URL('../src/islands/platform/design/design-blueprint-contract.json', import.meta.url);
const MAX_PROVISIONING_PLAN_BYTES = 16 * 1024 * 1024;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DESIGN_PROVISIONING_BLOCKERS = Object.freeze([
  'schema.session_title_slug_storage_not_approved',
  'server.design_provisioning_rpc_not_implemented',
  'server.idempotent_operation_ledger_not_implemented',
  'team.join_code_generation_contract_not_approved',
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

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function loadDesignBlueprintContract() {
  let contract;
  try {
    contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
  } catch {
    throw new Error('Unable to read the design blueprint contract');
  }
  const limitKeys = [
    'assemblyTitleChars', 'assemblyPurposeChars', 'sessionTitleChars', 'sessions',
    'topicsPerSession', 'topicChars', 'topicsTextChars', 'teamsPerSession',
    'participantsPerSession', 'generatedItems', 'importChars', 'importBytes',
  ];
  if (!isRecord(contract)
    || !exactKeys(contract, [
      'schemaVersion', 'kind', 'assemblyModes', 'readinessChecks', 'slugPattern', 'limits', 'boundaries',
    ])
    || contract.schemaVersion !== 4
    || contract.kind !== 'platform-design-blueprint'
    || canonicalJson(contract.assemblyModes) !== canonicalJson(['consensus', 'vote'])
    || canonicalJson(contract.readinessChecks) !== canonicalJson(['topics_open', 'teams_active', 'roster_loaded'])
    || contract.slugPattern !== '^[a-z0-9-]{3,40}$'
    || !isRecord(contract.limits)
    || !exactKeys(contract.limits, limitKeys)
    || limitKeys.some((key) => !Number.isSafeInteger(contract.limits[key]) || contract.limits[key] <= 0)
    || !isRecord(contract.boundaries)
    || !exactKeys(contract.boundaries, ['dryRun', 'databaseMutationExecuted', 'requiresApproval'])
    || contract.boundaries.dryRun !== true
    || contract.boundaries.databaseMutationExecuted !== false
    || contract.boundaries.requiresApproval !== true) {
    throw new Error('Design blueprint contract is invalid');
  }
  return Object.freeze({
    ...contract,
    assemblyModes: Object.freeze([...contract.assemblyModes]),
    readinessChecks: Object.freeze([...contract.readinessChecks]),
    limits: Object.freeze({ ...contract.limits }),
    boundaries: Object.freeze({ ...contract.boundaries }),
  });
}

export const DESIGN_BLUEPRINT_CONTRACT = loadDesignBlueprintContract();

function isCalendarDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function canonicalText(value, maximum, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value) {
    throw new Error('Design blueprint is invalid');
  }
  return value;
}

function canonicalSlug(value) {
  if (typeof value !== 'string'
    || value.trim() !== value
    || !(new RegExp(DESIGN_BLUEPRINT_CONTRACT.slugPattern)).test(value)) {
    throw new Error('Design blueprint is invalid');
  }
  return value;
}

export function validateDesignBlueprint(value) {
  const contract = DESIGN_BLUEPRINT_CONTRACT;
  if (!isRecord(value)
    || !exactKeys(value, [
      'schemaVersion', 'kind', 'dryRun', 'databaseMutationExecuted', 'requiresApproval',
      'assembly', 'sessions', 'stats',
    ])
    || value.schemaVersion !== contract.schemaVersion
    || value.kind !== contract.kind
    || value.dryRun !== contract.boundaries.dryRun
    || value.databaseMutationExecuted !== contract.boundaries.databaseMutationExecuted
    || value.requiresApproval !== contract.boundaries.requiresApproval
    || !isRecord(value.assembly)
    || !exactKeys(value.assembly, ['title', 'slug', 'purpose', 'mode', 'config'])
    || !isRecord(value.assembly.config)
    || !exactKeys(value.assembly.config, ['readiness'])
    || !Array.isArray(value.assembly.config.readiness)
    || !Array.isArray(value.sessions)
    || value.sessions.length === 0
    || value.sessions.length > contract.limits.sessions
    || !isRecord(value.stats)
    || !exactKeys(value.stats, ['sessionCount', 'topicCount', 'teamCount', 'participantCount'])) {
    throw new Error('Design blueprint is invalid');
  }
  const assembly = {
    title: canonicalText(value.assembly.title, contract.limits.assemblyTitleChars),
    slug: canonicalSlug(value.assembly.slug),
    purpose: canonicalText(value.assembly.purpose, contract.limits.assemblyPurposeChars, { nullable: true }),
    mode: value.assembly.mode,
    config: { readiness: [...value.assembly.config.readiness] },
  };
  if (!contract.assemblyModes.includes(assembly.mode)) throw new Error('Design blueprint is invalid');
  const readinessSet = new Set(assembly.config.readiness);
  const canonicalReadiness = contract.readinessChecks.filter((key) => readinessSet.has(key));
  if (assembly.config.readiness.length === 0
    || readinessSet.size !== assembly.config.readiness.length
    || assembly.config.readiness.some((key) => !contract.readinessChecks.includes(key))
    || canonicalJson(assembly.config.readiness) !== canonicalJson(canonicalReadiness)) {
    throw new Error('Design blueprint is invalid');
  }

  const sessionSlugs = new Set();
  let previousDate = null;
  let topicCount = 0;
  let teamCount = 0;
  let participantCount = 0;
  const sessions = value.sessions.map((session, sessionIndex) => {
    if (!isRecord(session)
      || !exactKeys(session, ['ordinal', 'title', 'slug', 'heldOn', 'topics', 'teams'])
      || session.ordinal !== sessionIndex + 1
      || !isCalendarDate(session.heldOn)
      || (previousDate !== null && session.heldOn < previousDate)
      || !Array.isArray(session.topics)
      || session.topics.length === 0
      || session.topics.length > contract.limits.topicsPerSession
      || !Array.isArray(session.teams)
      || session.teams.length === 0
      || session.teams.length > contract.limits.teamsPerSession) {
      throw new Error('Design blueprint is invalid');
    }
    previousDate = session.heldOn;
    const slug = canonicalSlug(session.slug);
    if (sessionSlugs.has(slug)) throw new Error('Design blueprint is invalid');
    sessionSlugs.add(slug);
    const topicPrompts = new Set();
    const topics = session.topics.map((topic, topicIndex) => {
      if (!isRecord(topic)
        || !exactKeys(topic, ['ordinal', 'prompt'])
        || topic.ordinal !== topicIndex + 1) {
        throw new Error('Design blueprint is invalid');
      }
      const prompt = canonicalText(topic.prompt, contract.limits.topicChars);
      if (topicPrompts.has(prompt)) throw new Error('Design blueprint is invalid');
      topicPrompts.add(prompt);
      return { ordinal: topic.ordinal, prompt };
    });
    let sessionCapacity = 0;
    const teams = session.teams.map((team, teamIndex) => {
      if (!isRecord(team)
        || !exactKeys(team, ['ordinal', 'name', 'plannedCapacity'])
        || team.ordinal !== teamIndex + 1
        || team.name !== `${team.ordinal}조`
        || !Number.isSafeInteger(team.plannedCapacity)
        || team.plannedCapacity < 1) {
        throw new Error('Design blueprint is invalid');
      }
      sessionCapacity += team.plannedCapacity;
      if (!Number.isSafeInteger(sessionCapacity)
        || sessionCapacity > contract.limits.participantsPerSession) {
        throw new Error('Design blueprint is invalid');
      }
      return { ordinal: team.ordinal, name: team.name, plannedCapacity: team.plannedCapacity };
    });
    topicCount += topics.length;
    teamCount += teams.length;
    participantCount += sessionCapacity;
    if (!Number.isSafeInteger(participantCount)) throw new Error('Design blueprint is invalid');
    return {
      ordinal: session.ordinal,
      title: canonicalText(session.title, contract.limits.sessionTitleChars),
      slug,
      heldOn: session.heldOn,
      topics,
      teams,
    };
  });
  if (topicCount + teamCount > contract.limits.generatedItems
    || value.stats.sessionCount !== sessions.length
    || value.stats.topicCount !== topicCount
    || value.stats.teamCount !== teamCount
    || value.stats.participantCount !== participantCount) {
    throw new Error('Design blueprint is invalid');
  }
  return {
    schemaVersion: contract.schemaVersion,
    kind: contract.kind,
    ...contract.boundaries,
    assembly,
    sessions,
    stats: { sessionCount: sessions.length, topicCount, teamCount, participantCount },
  };
}

function operationId(operation) {
  return sha256(canonicalJson(operation));
}

function withOperationId(operation) {
  return { operationId: operationId(operation), ...operation };
}

export function designProvisioningPlanChecksum(plan) {
  const { checksum: _checksum, ...unsigned } = plan;
  return sha256(canonicalJson(unsigned));
}

export function buildDesignProvisioningPlan(blueprint, sourceBytes) {
  const source = validateDesignBlueprint(blueprint);
  if (!Buffer.isBuffer(sourceBytes)
    || sourceBytes.length === 0
    || sourceBytes.length > DESIGN_BLUEPRINT_CONTRACT.limits.importBytes) {
    throw new Error('Design blueprint source bytes are invalid');
  }
  const assemblyRef = `assembly:${source.assembly.slug}`;
  const operations = [withOperationId({
    type: 'create_assembly',
    ref: assemblyRef,
    parentRef: null,
    ordinal: null,
    payload: source.assembly,
  })];
  for (const session of source.sessions) {
    const sessionRef = `${assemblyRef}/session:${session.slug}`;
    operations.push(withOperationId({
      type: 'create_session',
      ref: sessionRef,
      parentRef: assemblyRef,
      ordinal: session.ordinal,
      payload: {
        title: session.title,
        slug: session.slug,
        heldOn: session.heldOn,
      },
    }));
    for (const topic of session.topics) {
      operations.push(withOperationId({
        type: 'create_topic',
        ref: `${sessionRef}/topic:${topic.ordinal}`,
        parentRef: sessionRef,
        ordinal: topic.ordinal,
        payload: { prompt: topic.prompt },
      }));
    }
    for (const team of session.teams) {
      operations.push(withOperationId({
        type: 'create_team',
        ref: `${sessionRef}/team:${team.ordinal}`,
        parentRef: sessionRef,
        ordinal: team.ordinal,
        payload: { name: team.name, plannedCapacity: team.plannedCapacity },
      }));
    }
  }
  const unsigned = {
    schemaVersion: 1,
    planKind: 'platform_design_provisioning_plan',
    sourceBlueprint: {
      sha256: sha256(sourceBytes),
      bytes: sourceBytes.length,
      schemaVersion: source.schemaVersion,
    },
    assembly: { title: source.assembly.title, slug: source.assembly.slug },
    operations,
    summary: {
      assemblyCount: 1,
      sessionCount: source.stats.sessionCount,
      topicCount: source.stats.topicCount,
      teamCount: source.stats.teamCount,
      participantCount: source.stats.participantCount,
      operationCount: operations.length,
    },
    executionPolicy: {
      stableOperationIdsRequired: true,
      parentBeforeChildRequired: true,
      lookupBeforeMutationRequired: true,
      idempotentServerContractRequired: true,
      stopOnFailure: true,
      auditReceiptRequired: true,
    },
    blockers: [...DESIGN_PROVISIONING_BLOCKERS],
    readyForExecution: false,
    serverContractImplemented: false,
    dryRun: true,
    databaseMutationExecuted: false,
    requiresApproval: true,
  };
  return { ...unsigned, checksum: designProvisioningPlanChecksum(unsigned) };
}

export function verifyDesignProvisioningPlan(plan, blueprint, sourceBytes) {
  if (!isRecord(plan)
    || !exactKeys(plan, [
      'schemaVersion', 'planKind', 'sourceBlueprint', 'assembly', 'operations', 'summary',
      'executionPolicy', 'blockers', 'readyForExecution', 'serverContractImplemented',
      'dryRun', 'databaseMutationExecuted', 'requiresApproval', 'checksum',
    ])
    || plan.schemaVersion !== 1
    || plan.planKind !== 'platform_design_provisioning_plan'
    || plan.readyForExecution !== false
    || plan.serverContractImplemented !== false
    || plan.dryRun !== true
    || plan.databaseMutationExecuted !== false
    || plan.requiresApproval !== true
    || !SHA256_PATTERN.test(plan.checksum ?? '')
    || designProvisioningPlanChecksum(plan) !== plan.checksum) {
    throw new Error('Design provisioning plan checksum verification failed');
  }
  const expected = buildDesignProvisioningPlan(blueprint, sourceBytes);
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error('Design provisioning plan does not match its source blueprint');
  }
  return {
    status: 'verified',
    checksum: plan.checksum,
    operationCount: plan.summary.operationCount,
    blockerCount: plan.blockers.length,
    readyForExecution: false,
    databaseMutationExecuted: false,
  };
}

function readJsonFile(path, label, maximumBytes) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new Error(`Unable to read ${label}`);
  }
  if (bytes.length === 0 || bytes.length > maximumBytes) {
    throw new Error(`${label} violates the size boundary`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Error(`${label} is malformed`);
  }
}

function isWithin(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function requireExternalPath(path, { forWrite = false } = {}) {
  const absolutePath = resolve(path);
  let resolvedTarget;
  try {
    resolvedTarget = existsSync(absolutePath)
      ? realpathSync.native(absolutePath)
      : resolve(realpathSync.native(dirname(absolutePath)), absolutePath.split(/[\\/]/).at(-1));
  } catch {
    throw new Error(forWrite ? 'Design provisioning output directory is unavailable' : 'Design provisioning path is unavailable');
  }
  if (isWithin(REPO_ROOT, resolvedTarget)) {
    throw new Error('Design provisioning files must remain outside the repository');
  }
  return absolutePath;
}

function valueAfter(args, option) {
  const index = args.indexOf(option);
  if (index < 0 || index + 1 >= args.length) return null;
  return args[index + 1];
}

export function runDesignProvisioningCli(args) {
  const sourceArgument = valueAfter(args, '--source');
  const verifyArgument = valueAfter(args, '--verify');
  const outputArgument = valueAfter(args, '--output');
  const force = args.includes('--force');
  if (!sourceArgument) throw new Error('Use --source <path> with a design blueprint');
  const sourcePath = requireExternalPath(sourceArgument);
  const source = readJsonFile(
    sourcePath,
    'design blueprint',
    DESIGN_BLUEPRINT_CONTRACT.limits.importBytes,
  );
  if (verifyArgument) {
    if (outputArgument || force || args.length !== 4) {
      throw new Error('Invalid design provisioning verification arguments');
    }
    const planPath = requireExternalPath(verifyArgument);
    const plan = readJsonFile(planPath, 'design provisioning plan', MAX_PROVISIONING_PLAN_BYTES);
    return verifyDesignProvisioningPlan(plan.value, source.value, source.bytes);
  }
  if (!outputArgument || args.length !== 4 + Number(force)) {
    throw new Error('Use --output <path> to create a design provisioning plan');
  }
  const outputPath = requireExternalPath(outputArgument, { forWrite: true });
  const plan = buildDesignProvisioningPlan(source.value, source.bytes);
  try {
    writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8',
      flag: force ? 'w' : 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (!force && isRecord(error) && error.code === 'EEXIST') {
      throw new Error('Design provisioning plan already exists; use --force to replace it');
    }
    throw new Error('Unable to write the design provisioning plan');
  }
  return {
    status: 'written',
    checksum: plan.checksum,
    operationCount: plan.summary.operationCount,
    blockerCount: plan.blockers.length,
    readyForExecution: false,
    databaseMutationExecuted: false,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    process.stdout.write(`${JSON.stringify(runDesignProvisioningCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown failure';
    console.error(`design provisioning plan failed: ${message}`);
    process.exitCode = 1;
  }
}
