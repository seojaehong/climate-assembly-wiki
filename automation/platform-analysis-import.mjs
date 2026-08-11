import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function analysisMeta(analysis) {
  const root = analysis && typeof analysis === 'object' ? analysis : {};
  const meta = root.meta && typeof root.meta === 'object' ? root.meta : {};
  return { ...root, ...meta };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISSUE_STANCES = new Set(['pro', 'con', 'conditional', 'concern', 'proposal', 'neutral']);
const FREQUENCY_CLASSES = new Set(['consensus', 'majority', 'minority', 'mixed']);

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
  if (typeof value !== 'string' || !allowed.has(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
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
    if (seen.has(sourceUid)) throw new Error(`Duplicate cited source: ${sourceUid}`);
    seen.add(sourceUid);
  }
  return citations;
}

function mappedSources(uids, mappings) {
  const byUid = new Map(mappings.map((mapping) => [mapping.sourceUid, mapping]));
  return uids.map((sourceUid) => {
    const mapping = byUid.get(sourceUid);
    if (!mapping) throw new Error(`Missing source mapping: ${sourceUid}`);
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
        throw new Error(`Conflicting cluster mappings for item: ${source.itemId}`);
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

function candidate({ externalId, parentExternalId, title, summary, stance, frequencyClass, citations, mappings }) {
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
    provenance: { citedUids: provenanceUids, sources: provenanceSources },
  };
}

export function buildPlatformAnalysisImportPlan({ topicId, analysis, sourceMappings }) {
  requireUuid(topicId, 'topicId');
  if (!Array.isArray(sourceMappings)) throw new Error('Invalid sourceMappings');
  const sourceIds = new Set();
  for (const mapping of sourceMappings) {
    const sourceUid = requireText(mapping.sourceUid, 'sourceUid');
    if (sourceIds.has(sourceUid)) throw new Error(`Duplicate source mapping: ${sourceUid}`);
    sourceIds.add(sourceUid);
    requireUuid(mapping.itemId, 'itemId');
    if (mapping.clusterId != null) requireUuid(mapping.clusterId, 'clusterId');
    if (mapping.transcriptChunkId != null) requireText(mapping.transcriptChunkId, 'transcriptChunkId');
  }
  const meta = analysisMeta(analysis);
  const candidates = [];
  const candidateIds = new Set();
  const recommendationIds = new Set();
  const recommendations = meta.recommendations ?? [];
  if (!Array.isArray(recommendations)) throw new Error('Invalid recommendations');
  if (recommendations.length === 0) throw new Error('Analysis contains no recommendation candidates');
  const addCandidate = (value) => {
    if (candidateIds.has(value.externalId)) throw new Error(`Duplicate candidate id: ${value.externalId}`);
    candidateIds.add(value.externalId);
    candidates.push(value);
  };
  for (const recommendation of recommendations) {
    if ((recommendation.kind && recommendation.kind !== 'recommendation_candidate')
      || (recommendation.review_status && recommendation.review_status !== 'draft')) {
      throw new Error('Analysis import accepts recommendation candidates only');
    }
    const externalId = requireText(recommendation.rec_id, 'recommendation id');
    if (recommendationIds.has(externalId)) throw new Error(`Duplicate recommendation id: ${externalId}`);
    recommendationIds.add(externalId);
    const citations = citedUids(recommendation);
    addCandidate(candidate({
      externalId,
      parentExternalId: null,
      title: recommendation.title,
      summary: recommendation.summary,
      stance: recommendation.stance,
      frequencyClass: recommendation.frequency_class,
      citations,
      mappings: sourceMappings,
    }));
    const minorityConcerns = recommendation.minority ?? [];
    if (!Array.isArray(minorityConcerns)) throw new Error('Invalid minority concerns');
    for (const [index, minority] of minorityConcerns.entries()) {
      const minorityId = minority.minority_id == null
        ? `minority-${index + 1}`
        : requireText(minority.minority_id, 'minority id');
      addCandidate(candidate({
        externalId: `${externalId}:${minorityId}`,
        parentExternalId: externalId,
        title: minority.title,
        summary: minority.text ?? minority.summary,
        stance: 'concern',
        frequencyClass: 'minority',
        citations: citedUids(minority),
        mappings: sourceMappings,
      }));
    }
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

function parseJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
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
      force = true;
      continue;
    }
    if (!['--analysis', '--provenance-map', '--output'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  for (const required of ['--analysis', '--provenance-map', '--output']) {
    if (!values.has(required)) throw new Error(`Missing required argument: ${required}`);
  }
  return {
    analysisPath: values.get('--analysis'),
    provenanceMapPath: values.get('--provenance-map'),
    outputPath: values.get('--output'),
    force,
  };
}

export function runPlatformAnalysisImportCli(argv) {
  const options = parseCliArgs(argv);
  const analysis = parseJsonFile(options.analysisPath, 'analysis');
  const provenanceMap = parseJsonFile(options.provenanceMapPath, 'provenance map');
  if (provenanceMap?.schemaVersion !== 1) throw new Error('Unsupported provenance map schemaVersion');
  const plan = buildPlatformAnalysisImportPlan({
    topicId: provenanceMap.topicId,
    analysis,
    sourceMappings: provenanceMap.sourceMappings,
  });
  try {
    writeFileSync(options.outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      encoding: 'utf8',
      flag: options.force ? 'w' : 'wx',
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      throw new Error('Output already exists; use --force to replace it');
    }
    throw error;
  }
  return { outputPath: options.outputPath, candidateCount: plan.candidates.length };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = runPlatformAnalysisImportCli(process.argv.slice(2));
    console.log(`Analysis import plan written (${result.candidateCount} candidates; database mutation: false)`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Analysis import planning failed');
    process.exitCode = 1;
  }
}
