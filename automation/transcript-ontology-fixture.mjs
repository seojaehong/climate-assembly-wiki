import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = resolve(REPOSITORY_ROOT, 'public');
const NODE_KINDS = ['Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence'];
const RELATIONS = [
  'supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
  'modifies', 'isAbout', 'raisesIssue', 'impacts',
];
const SPEAKER_PSEUDONYM_PATTERN = /^speaker-[a-z]{1,3}$/;
const OPAQUE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const REVIEWER_ALIAS_PATTERN = /^(moderator|reviewer)-(fixture|test)$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

const KIND_KO = {
  Issue: '쟁점', Claim: '주장', Proposal: '제안', Concern: '우려',
  Condition: '조건', Value: '가치', Evidence: '근거',
};

const RELATION_KO = {
  supports: '지지', opposes: '반대', hasConcern: '우려', requiresCondition: '조건필요',
  hasEvidence: '근거', modifies: '수정', isAbout: '관련', raisesIssue: '쟁점제기',
  impacts: '영향',
};

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid ${label}`);
  return value;
}

function opaqueId(value, label) {
  const result = nonemptyString(value, label);
  if (!OPAQUE_ID_PATTERN.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function canonicalIsoInstant(value, label) {
  const result = nonemptyString(value, label);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== result) throw new Error(`Invalid ${label}`);
  return result;
}

function uniqueIds(rows, label) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`Invalid ${label}`);
  const ids = rows.map((row) => opaqueId(row?.uid, `${label} uid`));
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} uid`);
  return ids;
}

function citedUids(value, chunkIds, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Invalid ${label} cited uids`);
  const result = value.map((uid) => nonemptyString(uid, `${label} cited uid`));
  if (new Set(result).size !== result.length) throw new Error(`Duplicate ${label} cited uid`);
  if (result.some((uid) => !chunkIds.has(uid))) throw new Error(`${label} cites an unknown transcript chunk`);
  return result;
}

/** Builds a non-public graph payload from a reviewed, de-identified transcript fixture. */
export function buildReviewedTranscriptGraph(input) {
  if (!isRecord(input)
    || input.schemaVersion !== 1
    || input.kind !== 'transcript-ontology-fixture'
    || !isRecord(input.expected)) {
    throw new Error('Invalid transcript ontology fixture');
  }
  const fixtureId = opaqueId(input.fixtureId, 'fixture id');
  const sessionId = opaqueId(input.sessionId, 'session id');
  const language = nonemptyString(input.language, 'fixture language');
  const reviewedBy = nonemptyString(input.reviewedBy, 'fixture reviewer');
  const reviewedAt = canonicalIsoInstant(input.reviewedAt, 'fixture reviewedAt');
  if (!LANGUAGE_PATTERN.test(language)) throw new Error('Invalid fixture language');
  if (!REVIEWER_ALIAS_PATTERN.test(reviewedBy)) throw new Error('Invalid fixture reviewer alias');
  const fixtureChecksumSha256 = sha256(input);
  const chunkIds = new Set(uniqueIds(input.chunks, 'transcript chunk'));
  for (const chunk of input.chunks) {
    if (!isRecord(chunk)
      || !Number.isSafeInteger(chunk.startMs)
      || !Number.isSafeInteger(chunk.endMs)
      || chunk.startMs < 0
      || chunk.endMs <= chunk.startMs) {
      throw new Error('Invalid transcript chunk time range');
    }
    nonemptyString(chunk.text, 'transcript chunk text');
    if (!SPEAKER_PSEUDONYM_PATTERN.test(String(chunk.speakerLabelPseudonym ?? ''))) {
      throw new Error('Invalid transcript speaker pseudonym');
    }
  }
  const nodeUids = uniqueIds(input.expected.nodes, 'ontology node');
  uniqueIds(input.expected.relations, 'ontology relation');
  const nodeIds = new Map(nodeUids.map((uid) => [uid, `transcript-node:${uid}`]));

  const nodes = input.expected.nodes.map((node) => {
    if (!isRecord(node) || !NODE_KINDS.includes(node.kind)) throw new Error('Invalid ontology node candidate');
    const uid = opaqueId(node.uid, 'ontology node uid');
    const citations = citedUids(node.citedUids, chunkIds, 'ontology node');
    return {
      data: {
        id: nodeIds.get(uid),
        node_id: nodeIds.get(uid),
        label: nonemptyString(node.label, 'ontology node label'),
        kind: node.kind,
        kindKo: KIND_KO[node.kind],
        text: nonemptyString(node.text, 'ontology node text'),
        cited: citations,
        cited_uids: citations,
        session: sessionId,
        review_state: 'reviewed',
        is_public: false,
        synthesized: false,
        meta: {
          source_uid: uid,
          source_chunk_uids: citations,
          reviewer: reviewedBy,
          reviewed_at: reviewedAt,
        },
      },
    };
  });

  const edges = input.expected.relations.map((relation) => {
    if (!isRecord(relation) || !RELATIONS.includes(relation.relation)) {
      throw new Error('Invalid ontology relation candidate');
    }
    const uid = opaqueId(relation.uid, 'ontology relation uid');
    const source = nodeIds.get(opaqueId(relation.sourceUid, 'ontology relation source'));
    const target = nodeIds.get(opaqueId(relation.targetUid, 'ontology relation target'));
    if (!source || !target) throw new Error('Ontology relation references an unknown node candidate');
    const citations = citedUids(relation.citedUids, chunkIds, 'ontology relation');
    return {
      data: {
        id: `transcript-edge:${uid}`,
        source,
        target,
        rel: relation.relation,
        relKo: RELATION_KO[relation.relation],
        cited: citations,
        cited_uids: citations,
        meta: {
          source_uid: uid,
          source_chunk_uids: citations,
          reviewer: reviewedBy,
          reviewed_at: reviewedAt,
        },
      },
    };
  });

  return {
    elements: { nodes, edges },
    meta: {
      variant: 'transcript-reviewed-fixture',
      fixture_reviewed_at: reviewedAt,
      counts: { nodes: nodes.length, edges: edges.length },
      advisory_notice: '사람이 검수한 비식별 fixture이며 공개 승인을 뜻하지 않습니다.',
      live: false,
      publication_status: 'internal_reviewed_fixture',
      requires_publication_review: true,
      source: {
        fixture_id: fixtureId,
        session_id: sessionId,
        language,
        chunk_count: chunkIds.size,
        fixture_checksum_sha256: fixtureChecksumSha256,
      },
    },
  };
}

/** Verifies a graph by rebuilding the complete deterministic payload from its fixture. */
export function verifyReviewedTranscriptGraph({ fixture, graph }) {
  const expected = buildReviewedTranscriptGraph(fixture);
  if (canonicalJson(graph) !== canonicalJson(expected)) {
    throw new Error('Transcript ontology graph does not match its reviewed fixture');
  }
  return {
    nodeCount: expected.elements.nodes.length,
    edgeCount: expected.elements.edges.length,
    databaseMutationExecuted: false,
  };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${label} JSON`, { cause: error });
  }
}

function writeJson(path, value) {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (isRecord(error) && error.code === 'EEXIST') throw new Error('Output already exists');
    throw error;
  }
}

function parseCliArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--fixture', '--output-graph', '--verify-graph'].includes(key) || !value) {
      throw new Error('Usage: --fixture <path> (--output-graph <path> | --verify-graph <path>)');
    }
    if (values.has(key)) throw new Error('Duplicate CLI option');
    values.set(key, value);
  }
  if (!values.has('--fixture') || Number(values.has('--output-graph')) + Number(values.has('--verify-graph')) !== 1) {
    throw new Error('Usage: --fixture <path> (--output-graph <path> | --verify-graph <path>)');
  }
  return values;
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function resolvedOutputPath(path) {
  const parent = realpathSync.native(dirname(path));
  return resolve(parent, basename(path));
}

async function runCli(argv) {
  const values = parseCliArgs(argv);
  const fixture = readJson(resolve(values.get('--fixture')), 'transcript fixture');
  if (values.has('--output-graph')) {
    const outputPath = resolve(values.get('--output-graph'));
    if (isInside(realpathSync.native(PUBLIC_ROOT), resolvedOutputPath(outputPath))) {
      throw new Error('R0 transcript fixture output must not be written under public');
    }
    const graph = buildReviewedTranscriptGraph(fixture);
    writeJson(outputPath, graph);
    return {
      nodeCount: graph.elements.nodes.length,
      edgeCount: graph.elements.edges.length,
      databaseMutationExecuted: false,
      publicGraphWritten: false,
    };
  }
  const graph = readJson(resolve(values.get('--verify-graph')), 'transcript graph');
  return verifyReviewedTranscriptGraph({ fixture, graph });
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) {
  try {
    const result = await runCli(process.argv.slice(2));
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Transcript ontology fixture failed');
    process.exitCode = 1;
  }
}
