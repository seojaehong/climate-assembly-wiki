import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function analysisMeta(analysis) {
  const root = analysis && typeof analysis === 'object' ? analysis : {};
  const meta = root.meta && typeof root.meta === 'object' ? root.meta : {};
  return { ...root, ...meta };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ISSUE_STANCES = new Set(['pro', 'con', 'conditional', 'concern', 'proposal', 'neutral']);
const FREQUENCY_CLASSES = new Set(['consensus', 'majority', 'minority', 'mixed']);
const SOURCE_MAPPING_FIELDS = new Set(['sourceUid', 'transcriptChunkId', 'itemId', 'clusterId']);
const CANDIDATE_MAPPING_FIELDS = new Set([
  'recommendationId', 'title', 'summary', 'sourceRecommendationSha256', 'minorityMappings',
]);
const MINORITY_MAPPING_FIELDS = new Set([
  'index', 'minorityId', 'title', 'sourceTextSha256', 'citedUids',
]);
const MAX_ANALYSIS_IMPORT_JSON_BYTES = 16 * 1024 * 1024;
const REPO_ROOT = realpathSync.native(fileURLToPath(new URL('..', import.meta.url)));

function requireExactFields(value, allowedFields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    throw new Error(`Invalid ${label} fields`);
  }
}

function isWithinRepository(path) {
  const pathFromRepository = relative(REPO_ROOT, path);
  return pathFromRepository === ''
    || (!pathFromRepository.startsWith('..') && !isAbsolute(pathFromRepository));
}

export function validatePlatformAnalysisImportPrivateInputPath(path, label) {
  const absolutePath = resolve(path);
  let resolvedPath;
  try {
    resolvedPath = realpathSync.native(absolutePath);
    if (!statSync(resolvedPath).isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`Analysis import ${label} input is unavailable`);
  }
  if (isWithinRepository(resolvedPath)) {
    throw new Error(`Analysis import ${label} input must remain outside the repository`);
  }
  return resolvedPath;
}

export function validatePlatformAnalysisImportPrivateOutputPath(path) {
  const absolutePath = resolve(path);
  let resolvedParent;
  try {
    resolvedParent = realpathSync.native(dirname(absolutePath));
    if (!statSync(resolvedParent).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('Analysis import output location is unavailable');
  }
  if (isWithinRepository(resolvedParent)) {
    throw new Error('Analysis import output must remain outside the repository');
  }
  if (existsSync(absolutePath)) {
    let outputInfo;
    let resolvedOutput;
    try {
      outputInfo = lstatSync(absolutePath);
      resolvedOutput = realpathSync.native(absolutePath);
    } catch {
      throw new Error('Analysis import output location is unavailable');
    }
    if (!outputInfo.isFile() || outputInfo.isSymbolicLink() || outputInfo.nlink !== 1) {
      throw new Error('Analysis import output location is unavailable');
    }
    if (isWithinRepository(resolvedOutput)) {
      throw new Error('Analysis import output must remain outside the repository');
    }
  }
  return absolutePath;
}

function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`Invalid ${label}`);
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid ${label}`);
  return value.trim();
}

function issueLabel(value) {
  const label = requireText(value, 'issue label');
  if (label.length > 200) throw new Error('Issue label must be 1 to 200 characters');
  return label;
}

function optionalText(value, label) {
  if (value == null || value === '') return null;
  return requireText(value, label);
}

function optionalEnum(value, allowed, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function optionalTimeSpan(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recommendation time span');
  const boundary = (item) => {
    if (item == null) return null;
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0) {
      throw new Error('Invalid recommendation time span');
    }
    return item;
  };
  const start = boundary(value.start);
  const end = boundary(value.end);
  if (start != null && end != null && start > end) throw new Error('Invalid recommendation time span');
  return { start, end };
}

function citedUids(value) {
  if (Array.isArray(value?.cited_uids)) return value.cited_uids;
  if (Array.isArray(value?.was_derived_from)) return value.was_derived_from;
  return [];
}

function uniqueCitations(citations) {
  const seen = new Set();
  for (const sourceUid of citations) {
    requireText(sourceUid, 'cited source');
    if (seen.has(sourceUid)) throw new Error('Duplicate cited source');
    seen.add(sourceUid);
  }
  return citations;
}

function mappedSources(uids, mappings) {
  const byUid = new Map(mappings.map((mapping) => [mapping.sourceUid, mapping]));
  return uids.map((sourceUid) => {
    const mapping = byUid.get(sourceUid);
    if (!mapping) throw new Error('Missing source mapping for cited source');
    return {
      sourceUid,
      transcriptChunkId: mapping.transcriptChunkId ?? sourceUid,
      itemId: mapping.itemId,
      clusterId: mapping.clusterId ?? null,
    };
  });
}

function mappedLinks(sources) {
  const byItem = new Map();
  for (const source of sources) {
    const existing = byItem.get(source.itemId);
    if (existing) {
      if (existing.clusterId !== source.clusterId) {
        throw new Error('Conflicting cluster mappings for cited item');
      }
      existing.sourceUids.push(source.sourceUid);
      continue;
    }
    byItem.set(source.itemId, {
      sourceUids: [source.sourceUid],
      itemId: source.itemId,
      clusterId: source.clusterId,
      linkedBy: 'ai',
    });
  }
  return [...byItem.values()];
}

function candidate({
  externalId, parentExternalId, title, summary, stance, frequencyClass, citations, mappings,
  timeSpan = null, candidateMappingApplied = false, minoritySourceTextSha256 = null,
  sourceRecommendationSha256 = null,
}) {
  if (citations.length === 0) throw new Error('Every analysis candidate requires at least one cited source');
  const provenanceUids = uniqueCitations(citations);
  const provenanceSources = mappedSources(provenanceUids, mappings);
  return {
    externalId,
    parentExternalId,
    issue: {
      label: issueLabel(title),
      summary: optionalText(summary, 'issue summary'),
      stance: optionalEnum(stance, ISSUE_STANCES, 'stance'),
      frequencyClass: optionalEnum(frequencyClass, FREQUENCY_CLASSES, 'frequency class'),
      origin: 'ai',
      reviewStatus: 'draft',
    },
    links: mappedLinks(provenanceSources),
    provenance: {
      citedUids: provenanceUids,
      sources: provenanceSources,
      ...(timeSpan == null ? {} : { timeSpan: optionalTimeSpan(timeSpan) }),
      ...(candidateMappingApplied ? { candidateMappingApplied: true } : {}),
      ...(minoritySourceTextSha256 == null ? {} : { minoritySourceTextSha256 }),
      ...(sourceRecommendationSha256 == null ? {} : { sourceRecommendationSha256 }),
    },
  };
}

function normalizeCandidateMappings(value) {
  if (value == null) return new Map();
  if (!Array.isArray(value)) throw new Error('Invalid candidateMappings');
  const mappings = new Map();
  for (const candidateMapping of value) {
    requireExactFields(candidateMapping, CANDIDATE_MAPPING_FIELDS, 'candidate mapping');
    const recommendationId = requireText(candidateMapping.recommendationId, 'candidate mapping recommendationId');
    if (mappings.has(recommendationId)) throw new Error('Duplicate candidate mapping');
    if (typeof candidateMapping.sourceRecommendationSha256 !== 'string'
      || !SHA256_PATTERN.test(candidateMapping.sourceRecommendationSha256)) {
      throw new Error('Invalid candidate mapping source hash');
    }
    const minorityMappings = candidateMapping.minorityMappings ?? [];
    if (!Array.isArray(minorityMappings)) throw new Error('Invalid minority mappings');
    const minorityByIndex = new Map();
    for (const minorityMapping of minorityMappings) {
      requireExactFields(minorityMapping, MINORITY_MAPPING_FIELDS, 'minority mapping');
      if (!Number.isInteger(minorityMapping.index) || minorityMapping.index < 0) {
        throw new Error('Invalid minority mapping');
      }
      if (minorityByIndex.has(minorityMapping.index)) throw new Error('Duplicate minority mapping index');
      if (!Array.isArray(minorityMapping.citedUids)) throw new Error('Invalid minority mapping citations');
      if (typeof minorityMapping.sourceTextSha256 !== 'string'
        || !SHA256_PATTERN.test(minorityMapping.sourceTextSha256)) {
        throw new Error('Invalid minority mapping source hash');
      }
      minorityByIndex.set(minorityMapping.index, {
        minorityId: requireText(minorityMapping.minorityId, 'minority mapping id'),
        title: issueLabel(minorityMapping.title),
        sourceTextSha256: minorityMapping.sourceTextSha256,
        citedUids: minorityMapping.citedUids,
      });
    }
    mappings.set(recommendationId, {
      title: issueLabel(candidateMapping.title),
      summary: optionalText(candidateMapping.summary, 'candidate mapping summary'),
      sourceRecommendationSha256: candidateMapping.sourceRecommendationSha256,
      minorityByIndex,
    });
  }
  return mappings;
}

export function buildPlatformAnalysisImportPlan({
  topicId, analysis, sourceMappings, candidateMappings = [], provenanceSchemaVersion = 1,
}) {
  requireUuid(topicId, 'topicId');
  if (!Array.isArray(sourceMappings)) throw new Error('Invalid sourceMappings');
  const effectiveProvenanceSchemaVersion = provenanceSchemaVersion;
  if (effectiveProvenanceSchemaVersion !== 1 && effectiveProvenanceSchemaVersion !== 2) {
    throw new Error('Unsupported provenance map schemaVersion');
  }
  if (effectiveProvenanceSchemaVersion === 1 && candidateMappings.length > 0) {
    throw new Error('Candidate mappings require provenance map schemaVersion 2');
  }
  const sourceIds = new Set();
  for (const mapping of sourceMappings) {
    requireExactFields(mapping, SOURCE_MAPPING_FIELDS, 'source mapping');
    const sourceUid = requireText(mapping.sourceUid, 'sourceUid');
    if (sourceIds.has(sourceUid)) throw new Error('Duplicate source mapping');
    sourceIds.add(sourceUid);
    requireUuid(mapping.itemId, 'itemId');
    if (mapping.clusterId != null) requireUuid(mapping.clusterId, 'clusterId');
    if (mapping.transcriptChunkId != null) requireText(mapping.transcriptChunkId, 'transcriptChunkId');
  }
  const meta = analysisMeta(analysis);
  const candidateMappingById = normalizeCandidateMappings(candidateMappings);
  if (effectiveProvenanceSchemaVersion === 2) {
    for (const mapping of sourceMappings) requireText(mapping.transcriptChunkId, 'transcriptChunkId');
  }
  const consumedCandidateMappings = new Set();
  const candidates = [];
  const candidateIds = new Set();
  const recommendationIds = new Set();
  const recommendations = meta.recommendations ?? [];
  if (!Array.isArray(recommendations)) throw new Error('Invalid recommendations');
  if (recommendations.length === 0) throw new Error('Analysis contains no recommendation candidates');
  const addCandidate = (value) => {
    if (candidateIds.has(value.externalId)) throw new Error('Duplicate candidate id');
    candidateIds.add(value.externalId);
    candidates.push(value);
  };
  for (const recommendation of recommendations) {
    if ((recommendation.kind && recommendation.kind !== 'recommendation_candidate')
      || (recommendation.review_status && recommendation.review_status !== 'draft')) {
      throw new Error('Analysis import accepts recommendation candidates only');
    }
    const externalId = requireText(recommendation.rec_id, 'recommendation id');
    if (recommendationIds.has(externalId)) throw new Error('Duplicate recommendation id');
    recommendationIds.add(externalId);
    const mapping = candidateMappingById.get(externalId) ?? null;
    if (mapping) consumedCandidateMappings.add(externalId);
    if (mapping && sha256(canonicalJson(recommendation)) !== mapping.sourceRecommendationSha256) {
      throw new Error('Candidate mapping source recommendation mismatch');
    }
    const citations = citedUids(recommendation);
    const recommendationTitle = typeof recommendation.title === 'string' && recommendation.title.trim().length > 0
      ? recommendation.title
      : mapping?.title;
    addCandidate(candidate({
      externalId,
      parentExternalId: null,
      title: recommendationTitle,
      summary: recommendation.summary ?? mapping?.summary,
      stance: recommendation.stance,
      frequencyClass: recommendation.frequency_class,
      citations,
      mappings: sourceMappings,
      timeSpan: effectiveProvenanceSchemaVersion === 2 ? recommendation.time_span : null,
      candidateMappingApplied: mapping !== null,
      sourceRecommendationSha256: mapping?.sourceRecommendationSha256 ?? null,
    }));
    const minorityConcerns = recommendation.minority ?? [];
    if (!Array.isArray(minorityConcerns)) throw new Error('Invalid minority concerns');
    const consumedMinorityMappings = new Set();
    for (const [index, minority] of minorityConcerns.entries()) {
      const stringMinority = typeof minority === 'string';
      const minorityMapping = mapping?.minorityByIndex.get(index) ?? null;
      if (stringMinority && !minorityMapping) throw new Error('String minority concern requires a candidate mapping');
      if (stringMinority) requireText(minority, 'minority concern');
      if (stringMinority && sha256(minority) !== minorityMapping.sourceTextSha256) {
        throw new Error('Minority mapping source text mismatch');
      }
      if (stringMinority) consumedMinorityMappings.add(index);
      const minorityId = stringMinority
        ? minorityMapping.minorityId
        : (minority.minority_id == null ? `minority-${index + 1}` : requireText(minority.minority_id, 'minority id'));
      addCandidate(candidate({
        externalId: `${externalId}:${minorityId}`,
        parentExternalId: externalId,
        title: stringMinority ? minorityMapping.title : minority.title,
        summary: stringMinority ? minority : (minority.text ?? minority.summary),
        stance: 'concern',
        frequencyClass: 'minority',
        citations: stringMinority ? minorityMapping.citedUids : citedUids(minority),
        mappings: sourceMappings,
        candidateMappingApplied: stringMinority,
        minoritySourceTextSha256: stringMinority ? minorityMapping.sourceTextSha256 : null,
      }));
    }
    if (mapping) {
      for (const index of mapping.minorityByIndex.keys()) {
        if (!consumedMinorityMappings.has(index)) throw new Error('Unused minority mapping');
      }
    }
  }
  for (const recommendationId of candidateMappingById.keys()) {
    if (!consumedCandidateMappings.has(recommendationId)) throw new Error('Unused candidate mapping');
  }
  const quality = meta.quality ?? null;
  return {
    schemaVersion: 1,
    topicId,
    dryRun: true,
    databaseMutationExecuted: false,
    requiresHumanReview: true,
    qualityContext: quality ? {
      label: optionalText(quality.validity_label ?? quality.label, 'quality label'),
      sourceReliabilityFlag: quality.reliability === true,
      limitationsNotice: optionalText(quality.limitations_notice, 'limitations notice'),
    } : null,
    candidates,
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sealPlatformAnalysisImportPlan({ plan, analysisSource, provenanceMapSource }) {
  const unsigned = {
    ...plan,
    schemaVersion: 2,
    integrity: {
      kind: 'self-checksum',
      algorithm: 'sha256',
      analysisSha256: sha256(analysisSource),
      provenanceMapSha256: sha256(provenanceMapSource),
    },
  };
  return {
    ...unsigned,
    integrity: {
      ...unsigned.integrity,
      planSha256: sha256(canonicalJson(unsigned)),
    },
  };
}

function provenanceCandidateMappings(provenanceMap) {
  if (provenanceMap?.schemaVersion === 1) {
    requireExactFields(
      provenanceMap,
      new Set(['schemaVersion', 'topicId', 'sourceMappings']),
      'provenance map',
    );
    return [];
  }
  if (provenanceMap?.schemaVersion === 2) {
    requireExactFields(
      provenanceMap,
      new Set(['schemaVersion', 'topicId', 'sourceMappings', 'candidateMappings']),
      'provenance map',
    );
    if (!Array.isArray(provenanceMap.candidateMappings)) throw new Error('Invalid candidateMappings');
    return provenanceMap.candidateMappings;
  }
  throw new Error('Unsupported provenance map schemaVersion');
}

export function verifyPlatformAnalysisImportPlan({
  plan,
  analysis,
  provenanceMap,
  analysisSource,
  provenanceMapSource,
}) {
  if (plan?.schemaVersion !== 2
    || plan?.integrity?.kind !== 'self-checksum'
    || plan?.integrity?.algorithm !== 'sha256') {
    throw new Error('Unsupported analysis import plan integrity contract');
  }
  const { planSha256, ...integrityWithoutPlanHash } = plan.integrity;
  if (typeof planSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(planSha256)) {
    throw new Error('Invalid analysis import plan checksum');
  }
  const unsigned = { ...plan, integrity: integrityWithoutPlanHash };
  if (sha256(canonicalJson(unsigned)) !== planSha256) {
    throw new Error('Analysis import plan checksum mismatch');
  }
  if (plan.integrity.analysisSha256 !== sha256(analysisSource)) {
    throw new Error('Analysis input hash mismatch');
  }
  if (plan.integrity.provenanceMapSha256 !== sha256(provenanceMapSource)) {
    throw new Error('Provenance map hash mismatch');
  }
  const candidateMappings = provenanceCandidateMappings(provenanceMap);
  const expected = sealPlatformAnalysisImportPlan({
    plan: buildPlatformAnalysisImportPlan({
      topicId: provenanceMap.topicId,
      analysis,
      sourceMappings: provenanceMap.sourceMappings,
      candidateMappings,
      provenanceSchemaVersion: provenanceMap.schemaVersion,
    }),
    analysisSource,
    provenanceMapSource,
  });
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error('Analysis import plan does not match its inputs');
  }
  return { candidateCount: plan.candidates.length, databaseMutationExecuted: false };
}

function readJsonFile(path, label) {
  let expectedSize;
  try {
    expectedSize = statSync(path).size;
  } catch (error) {
    throw new Error(`Cannot read ${label} JSON`, { cause: error });
  }
  if (expectedSize <= 0 || expectedSize > MAX_ANALYSIS_IMPORT_JSON_BYTES) {
    throw new Error(`Analysis import ${label} JSON violates the size boundary`);
  }
  let source;
  try {
    source = readFileSync(path);
  } catch (error) {
    throw new Error(`Cannot read ${label} JSON`, { cause: error });
  }
  if (source.length !== expectedSize || source.length > MAX_ANALYSIS_IMPORT_JSON_BYTES) {
    throw new Error(`Analysis import ${label} JSON violates the size boundary`);
  }
  try {
    return { source, data: JSON.parse(source.toString('utf8')) };
  } catch (error) {
    throw new Error(`Cannot parse ${label} JSON`, { cause: error });
  }
}

function parseCliArgs(argv) {
  const values = new Map();
  let force = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') {
      if (force) throw new Error('Duplicate argument: --force');
      force = true;
      continue;
    }
    if (!['--analysis', '--provenance-map', '--output', '--verify-plan'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  for (const required of ['--analysis', '--provenance-map']) {
    if (!values.has(required)) throw new Error(`Missing required argument: ${required}`);
  }
  const verifyPlanPath = values.get('--verify-plan');
  if (verifyPlanPath && values.has('--output')) throw new Error('--verify-plan cannot be combined with --output');
  if (verifyPlanPath && force) throw new Error('--force is only valid when creating a plan');
  if (!verifyPlanPath && !values.has('--output')) throw new Error('Missing required argument: --output');
  return {
    analysisPath: values.get('--analysis'),
    provenanceMapPath: values.get('--provenance-map'),
    outputPath: values.get('--output'),
    verifyPlanPath,
    force,
  };
}

export function runPlatformAnalysisImportCli(argv) {
  const options = parseCliArgs(argv);
  const analysisPath = validatePlatformAnalysisImportPrivateInputPath(options.analysisPath, 'analysis');
  const provenanceMapPath = validatePlatformAnalysisImportPrivateInputPath(
    options.provenanceMapPath,
    'provenance map',
  );
  const verifyPlanPath = options.verifyPlanPath
    ? validatePlatformAnalysisImportPrivateInputPath(options.verifyPlanPath, 'review plan')
    : null;
  const outputPath = options.outputPath
    ? validatePlatformAnalysisImportPrivateOutputPath(options.outputPath)
    : null;
  const analysisFile = readJsonFile(analysisPath, 'analysis');
  const provenanceFile = readJsonFile(provenanceMapPath, 'provenance map');
  if (options.verifyPlanPath) {
    const planFile = readJsonFile(verifyPlanPath, 'analysis import plan');
    const verification = verifyPlatformAnalysisImportPlan({
      plan: planFile.data,
      analysis: analysisFile.data,
      provenanceMap: provenanceFile.data,
      analysisSource: analysisFile.source,
      provenanceMapSource: provenanceFile.source,
    });
    return { mode: 'verify', ...verification };
  }
  const candidateMappings = provenanceCandidateMappings(provenanceFile.data);
  const plan = sealPlatformAnalysisImportPlan({
    plan: buildPlatformAnalysisImportPlan({
      topicId: provenanceFile.data.topicId,
      analysis: analysisFile.data,
      sourceMappings: provenanceFile.data.sourceMappings,
      candidateMappings,
      provenanceSchemaVersion: provenanceFile.data.schemaVersion,
    }),
    analysisSource: analysisFile.source,
    provenanceMapSource: provenanceFile.source,
  });
  const planSource = `${JSON.stringify(plan, null, 2)}\n`;
  if (Buffer.byteLength(planSource, 'utf8') > MAX_ANALYSIS_IMPORT_JSON_BYTES) {
    throw new Error('Analysis import plan JSON violates the size boundary');
  }
  try {
    writeFileSync(outputPath, planSource, {
      encoding: 'utf8',
      flag: options.force ? 'w' : 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Output already exists; use --force to replace it');
    }
    throw error;
  }
  return { mode: 'create', outputPath, candidateCount: plan.candidates.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = runPlatformAnalysisImportCli(process.argv.slice(2));
    if (result.mode === 'verify') {
      console.log(`Analysis import plan verified (${result.candidateCount} candidates; database mutation: false)`);
    } else {
      console.log(`Analysis import plan written (${result.candidateCount} candidates; database mutation: false)`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Analysis import planning failed');
    process.exitCode = 1;
  }
}
