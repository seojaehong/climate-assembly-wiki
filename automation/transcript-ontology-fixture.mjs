import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = resolve(REPOSITORY_ROOT, 'public');
const PUBLIC_GRAPH_DATA_ROOT = resolve(PUBLIC_ROOT, 'workshop-graph', 'data');
const LIVE_GRAPH_FILENAME_PATTERN = /^live-[a-z0-9][a-z0-9._-]*\.json$/;
const NODE_KINDS = ['Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence'];
const RELATIONS = [
  'supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
  'modifies', 'isAbout', 'raisesIssue', 'impacts',
];
const SPEAKER_PSEUDONYM_PATTERN = /^speaker-[a-z]{1,3}$/;
const OPAQUE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const REVIEWER_ALIAS_PATTERN = /^(moderator|reviewer)-(fixture|test)$/;
const AUTH_REVIEWER_ID_PATTERN = /^auth-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVIEW_DECISION_ID_PATTERN = /^(?:auth-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|moderator-r2-test)$/;
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

function rawSha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function reviewedTranscriptPlanSha256(reviewedPlan) {
  return sha256(reviewedPlan);
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

function privateExtractionHandoff(value) {
  if (value === undefined) return null;
  if (!isRecord(value)
    || canonicalJson(Object.keys(value).sort()) !== canonicalJson([
      'audioSha256', 'candidateSetId', 'captureId', 'kind', 'reviewBatchSha256',
    ].sort())
    || value.kind !== 'private-transcript-extraction-handoff'
    || !/^[a-f0-9]{64}$/.test(String(value.reviewBatchSha256 ?? ''))
    || !/^[a-f0-9]{64}$/.test(String(value.audioSha256 ?? ''))) {
    throw new Error('Invalid private transcript extraction handoff');
  }
  return {
    kind: 'private-transcript-extraction-handoff',
    reviewBatchSha256: value.reviewBatchSha256,
    captureId: opaqueId(value.captureId, 'capture id'),
    audioSha256: value.audioSha256,
    candidateSetId: opaqueId(value.candidateSetId, 'candidate set id'),
  };
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
  if (!REVIEWER_ALIAS_PATTERN.test(reviewedBy) && !AUTH_REVIEWER_ID_PATTERN.test(reviewedBy)) {
    throw new Error('Invalid fixture reviewer identity');
  }
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

function reviewedPublication(input) {
  if (!isRecord(input.publication) || input.publication.mode !== 'synthetic-reviewed-demo') {
    throw new Error('Synthetic live graph publication approval is required');
  }
  const { identity: approvedBy, kind: identityKind } = publicationIdentity(input.publication.approvedBy);
  const approvedAt = canonicalIsoInstant(input.publication.approvedAt, 'publication approvedAt');
  const reviewedAt = canonicalIsoInstant(input.reviewedAt, 'fixture reviewedAt');
  if (approvedAt <= reviewedAt) throw new Error('Publication approval must follow fixture review');
  return {
    mode: input.publication.mode,
    approvedBy,
    approvedAt,
    identityKind,
  };
}

function publicFixtureAuditMeta(meta, publication) {
  const reviewer = nonemptyString(meta.reviewer, 'fixture reviewer');
  const result = { ...meta };
  delete result.reviewer;
  return {
    ...result,
    review_identity_kind: publicIdentityKind(reviewer),
    publication_identity_kind: publication.identityKind,
    published_at: publication.approvedAt,
  };
}

/** Builds a public synthetic live graph after explicit fixture publication approval. */
export function buildLiveTranscriptGraph(input) {
  const graph = buildReviewedTranscriptGraph(input);
  const publication = reviewedPublication(input);
  return {
    ...graph,
    elements: {
      nodes: graph.elements.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          review_state: 'accepted',
          is_public: true,
          meta: publicFixtureAuditMeta(node.data.meta, publication),
        },
      })),
      edges: graph.elements.edges.map((edge) => ({
        ...edge,
        data: {
          ...edge.data,
          review_state: 'accepted',
          is_public: true,
          meta: publicFixtureAuditMeta(edge.data.meta, publication),
        },
      })),
    },
    meta: {
      ...graph.meta,
      variant: 'transcript-live-reviewed-fixture',
      advisory_notice: '합성 전사 검수 데모 · 실제 시민 발언이나 회의 결과가 아닙니다.',
      live: true,
      publication_status: 'synthetic_reviewed_demo',
      requires_publication_review: false,
      publication: {
        mode: publication.mode,
        approved_identity_kind: publication.identityKind,
        approved_at: publication.approvedAt,
      },
    },
  };
}

function reviewedPlanSource(fixture, fixtureText, reviewedPlan) {
  if (!isRecord(reviewedPlan)
    || reviewedPlan.schemaVersion !== 1
    || reviewedPlan.kind !== 'transcript-ontology-reviewed-plan'
    || reviewedPlan.dryRun !== true
    || reviewedPlan.databaseMutationExecuted !== false
    || reviewedPlan.publicGraphWritten !== false
    || reviewedPlan.requiresPublicationReview !== true
    || !isRecord(reviewedPlan.source)) {
    throw new Error('Invalid transcript ontology reviewed plan');
  }
  const source = reviewedPlan.source;
  const expected = {
    fixtureId: opaqueId(fixture.fixtureId, 'fixture id'),
    sessionId: opaqueId(fixture.sessionId, 'session id'),
    language: nonemptyString(fixture.language, 'fixture language'),
    reviewedBy: nonemptyString(fixture.reviewedBy, 'fixture reviewer'),
    reviewedAt: canonicalIsoInstant(fixture.reviewedAt, 'fixture reviewedAt'),
    fixtureSha256: rawSha256(fixtureText),
    ...(fixture.source === undefined ? {} : { handoff: privateExtractionHandoff(fixture.source) }),
  };
  if (canonicalJson(source) !== canonicalJson(expected)) {
    throw new Error('Reviewed plan source does not match its transcript fixture');
  }
  return expected;
}

function reviewAudit(item, sourceReviewedAt) {
  if (!['accepted', 'edited', 'rejected'].includes(item.reviewStatus)) {
    throw new Error('Invalid reviewed plan item status');
  }
  const reviewer = nonemptyString(item.reviewer, 'reviewed plan reviewer');
  if (!REVIEW_DECISION_ID_PATTERN.test(reviewer)) {
    throw new Error('Invalid reviewed plan reviewer');
  }
  const reviewedAt = canonicalIsoInstant(item.reviewedAt, 'reviewed plan reviewedAt');
  if (reviewedAt < sourceReviewedAt) throw new Error('Reviewed plan decision predates fixture review');
  return { reviewStatus: item.reviewStatus, reviewer, reviewedAt };
}

function publicIdentityKind(identity) {
  return identity.startsWith('auth-user:') ? 'authenticated_user' : 'synthetic_fixture';
}

function publicationIdentity(value) {
  const identity = nonemptyString(value, 'publication reviewer');
  if (!REVIEWER_ALIAS_PATTERN.test(identity) && !AUTH_REVIEWER_ID_PATTERN.test(identity)) {
    throw new Error('Invalid publication reviewer identity');
  }
  return { identity, kind: publicIdentityKind(identity) };
}

function expectedTranscript(cited, chunks) {
  return cited.map((uid) => chunks.get(uid));
}

/** Builds a public synthetic graph from a complete R2 reviewed plan and explicit publication approval. */
export function buildPublishedTranscriptReviewGraph({ fixtureText, reviewedPlan, publication }) {
  if (typeof fixtureText !== 'string') throw new Error('Invalid transcript fixture text');
  let fixture;
  try {
    fixture = JSON.parse(fixtureText);
  } catch (error) {
    throw new Error('Cannot parse transcript fixture JSON', { cause: error });
  }
  const baseGraph = buildReviewedTranscriptGraph(fixture);
  const source = reviewedPlanSource(fixture, fixtureText, reviewedPlan);
  if (!Array.isArray(reviewedPlan.nodes)
    || reviewedPlan.nodes.length !== fixture.expected.nodes.length
    || !Array.isArray(reviewedPlan.relations)
    || reviewedPlan.relations.length !== fixture.expected.relations.length) {
    throw new Error('Reviewed plan item set does not match its transcript fixture');
  }
  const planNodeUids = reviewedPlan.nodes.map((node) => isRecord(node) ? node.sourceUid : null);
  const planRelationUids = reviewedPlan.relations.map((relation) => isRecord(relation) ? relation.sourceUid : null);
  const fixtureNodeUids = fixture.expected.nodes.map((node) => node.uid);
  const fixtureRelationUids = fixture.expected.relations.map((relation) => relation.uid);
  if (new Set(planNodeUids).size !== planNodeUids.length
    || new Set(planRelationUids).size !== planRelationUids.length
    || canonicalJson([...planNodeUids].sort()) !== canonicalJson([...fixtureNodeUids].sort())
    || canonicalJson([...planRelationUids].sort()) !== canonicalJson([...fixtureRelationUids].sort())) {
    throw new Error('Reviewed plan item set does not match its transcript fixture');
  }
  if (!isRecord(publication)
    || publication.schemaVersion !== 1
    || publication.kind !== 'transcript-ontology-publication-approval'
    || publication.mode !== 'synthetic-reviewed-demo') {
    throw new Error('Synthetic reviewed plan publication approval is required');
  }
  const sourceId = opaqueId(publication.sourceId, 'publication source id');
  if (!/^live-[a-z0-9][a-z0-9._-]*$/.test(sourceId)) throw new Error('Invalid publication source id');
  if (publication.reviewedPlanSha256 !== reviewedTranscriptPlanSha256(reviewedPlan)) {
    throw new Error('Publication approval does not match the reviewed plan');
  }
  const { kind: publicationIdentityKind } = publicationIdentity(publication.approvedBy);
  const approvedAt = canonicalIsoInstant(publication.approvedAt, 'publication approvedAt');
  const chunks = new Map(fixture.chunks.map((chunk) => [chunk.uid, chunk]));
  const fixtureNodes = new Map(fixture.expected.nodes.map((node) => [node.uid, node]));
  const baseNodes = new Map(baseGraph.elements.nodes.map((node) => [node.data.id, node]));
  const activeNodeIds = new Set();
  let rejectedNodeCount = 0;
  let latestReviewedAt = source.reviewedAt;
  const nodes = reviewedPlan.nodes.map((node) => {
    if (!isRecord(node)) throw new Error('Invalid reviewed plan node');
    const sourceUid = opaqueId(node.sourceUid, 'reviewed plan node source uid');
    const fixtureNode = fixtureNodes.get(sourceUid);
    const baseNode = baseNodes.get(node.id);
    if (!fixtureNode || !baseNode
      || node.id !== `transcript-node:${sourceUid}`
      || node.kindCandidate !== fixtureNode.kind
      || node.sourceLabel !== fixtureNode.label
      || node.sourceText !== fixtureNode.text
      || canonicalJson(node.citedUids) !== canonicalJson(fixtureNode.citedUids)
      || canonicalJson(node.transcript) !== canonicalJson(expectedTranscript(fixtureNode.citedUids, chunks))) {
      throw new Error('Reviewed plan node provenance does not match its transcript fixture');
    }
    const audit = reviewAudit(node, source.reviewedAt);
    if (audit.reviewedAt > latestReviewedAt) latestReviewedAt = audit.reviewedAt;
    if (audit.reviewStatus === 'rejected') {
      rejectedNodeCount += 1;
      if (node.kind !== null || node.label !== fixtureNode.label || node.text !== fixtureNode.text) {
        throw new Error('Rejected reviewed plan node must preserve source content');
      }
      return null;
    }
    if (!NODE_KINDS.includes(node.kind)) throw new Error('Invalid reviewed plan node kind');
    const label = nonemptyString(node.label, 'reviewed plan node label');
    const nodeText = nonemptyString(node.text, 'reviewed plan node text');
    const changed = node.kind !== fixtureNode.kind || label !== fixtureNode.label || nodeText !== fixtureNode.text;
    if ((audit.reviewStatus === 'accepted' && changed) || (audit.reviewStatus === 'edited' && !changed)) {
      throw new Error('Reviewed plan node status does not match its content');
    }
    activeNodeIds.add(node.id);
    const publicMeta = { ...baseNode.data.meta };
    delete publicMeta.reviewer;
    return {
      data: {
        ...baseNode.data,
        label,
        kind: node.kind,
        kindKo: KIND_KO[node.kind],
        text: nodeText,
        review_state: audit.reviewStatus,
        is_public: true,
        meta: {
          ...publicMeta,
          review_identity_kind: publicIdentityKind(audit.reviewer),
          reviewed_at: audit.reviewedAt,
          publication_identity_kind: publicationIdentityKind,
          published_at: approvedAt,
        },
      },
    };
  }).filter(Boolean);
  const fixtureRelations = new Map(fixture.expected.relations.map((relation) => [relation.uid, relation]));
  const baseEdges = new Map(baseGraph.elements.edges.map((edge) => [edge.data.id, edge]));
  let rejectedEdgeCount = 0;
  const edges = reviewedPlan.relations.map((relation) => {
    if (!isRecord(relation)) throw new Error('Invalid reviewed plan relation');
    const sourceUid = opaqueId(relation.sourceUid, 'reviewed plan relation source uid');
    const fixtureRelation = fixtureRelations.get(sourceUid);
    const baseEdge = baseEdges.get(relation.id);
    if (!fixtureRelation || !baseEdge
      || relation.id !== `transcript-edge:${sourceUid}`
      || relation.source !== `transcript-node:${fixtureRelation.sourceUid}`
      || relation.target !== `transcript-node:${fixtureRelation.targetUid}`
      || relation.relationCandidate !== fixtureRelation.relation
      || canonicalJson(relation.citedUids) !== canonicalJson(fixtureRelation.citedUids)
      || canonicalJson(relation.transcript) !== canonicalJson(expectedTranscript(fixtureRelation.citedUids, chunks))) {
      throw new Error('Reviewed plan relation provenance does not match its transcript fixture');
    }
    const audit = reviewAudit(relation, source.reviewedAt);
    if (audit.reviewedAt > latestReviewedAt) latestReviewedAt = audit.reviewedAt;
    if (audit.reviewStatus === 'rejected') {
      rejectedEdgeCount += 1;
      if (relation.relation !== null) throw new Error('Rejected reviewed plan relation must clear its type');
      return null;
    }
    if (!activeNodeIds.has(relation.source) || !activeNodeIds.has(relation.target)) {
      throw new Error('Published reviewed relation requires published endpoint nodes');
    }
    if (!RELATIONS.includes(relation.relation)) throw new Error('Invalid reviewed plan relation type');
    const changed = relation.relation !== fixtureRelation.relation;
    if ((audit.reviewStatus === 'accepted' && changed) || (audit.reviewStatus === 'edited' && !changed)) {
      throw new Error('Reviewed plan relation status does not match its type');
    }
    const publicMeta = { ...baseEdge.data.meta };
    delete publicMeta.reviewer;
    return {
      data: {
        ...baseEdge.data,
        rel: relation.relation,
        relKo: RELATION_KO[relation.relation],
        review_state: audit.reviewStatus,
        is_public: true,
        meta: {
          ...publicMeta,
          review_identity_kind: publicIdentityKind(audit.reviewer),
          reviewed_at: audit.reviewedAt,
          publication_identity_kind: publicationIdentityKind,
          published_at: approvedAt,
        },
      },
    };
  }).filter(Boolean);
  if (approvedAt <= latestReviewedAt) throw new Error('Publication approval must follow all review decisions');
  return {
    elements: { nodes, edges },
    meta: {
      variant: 'transcript-live-reviewed-plan',
      advisory_notice: '합성 전사 사람 검수 결과 · 실제 시민 발언이나 회의 결과가 아닙니다.',
      live: true,
      publication_status: 'synthetic_reviewed_demo',
      source_review_status: 'reviewed',
      requires_publication_review: false,
      counts: { nodes: nodes.length, edges: edges.length },
      dropped: {
        rejected_nodes: rejectedNodeCount,
        rejected_edges: rejectedEdgeCount,
        uncited_candidates: 0,
      },
      source: {
        fixture_id: source.fixtureId,
        session_id: source.sessionId,
        language: source.language,
        chunk_count: chunks.size,
        fixture_checksum_sha256: source.fixtureSha256,
        source_id: sourceId,
      },
      publication: {
        mode: publication.mode,
        approved_identity_kind: publicationIdentityKind,
        approved_at: approvedAt,
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

/** Verifies a public live graph by rebuilding it from the approved synthetic fixture. */
export function verifyLiveTranscriptGraph({ fixture, graph }) {
  const expected = buildLiveTranscriptGraph(fixture);
  if (canonicalJson(graph) !== canonicalJson(expected)) {
    throw new Error('Live transcript ontology graph does not match its approved fixture');
  }
  return {
    nodeCount: expected.elements.nodes.length,
    edgeCount: expected.elements.edges.length,
    publicGraphVerified: true,
    databaseMutationExecuted: false,
  };
}

/** Verifies a published R2 graph by rebuilding it from the exact fixture, plan, and approval. */
export function verifyPublishedTranscriptReviewGraph({ fixtureText, reviewedPlan, publication, graph }) {
  const expected = buildPublishedTranscriptReviewGraph({ fixtureText, reviewedPlan, publication });
  if (canonicalJson(graph) !== canonicalJson(expected)) {
    throw new Error('Published transcript review graph does not match its approved plan');
  }
  return {
    nodeCount: expected.elements.nodes.length,
    edgeCount: expected.elements.edges.length,
    dropped: expected.meta.dropped,
    publicGraphVerified: true,
    databaseMutationExecuted: false,
  };
}

function parseJsonText(value, label) {
  if (typeof value !== 'string') throw new Error(`Cannot parse ${label} JSON`);
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Cannot parse ${label} JSON`, { cause: error });
  }
}

/** Builds a non-identifying verification report for the exact R2-to-R3 operator artifact bundle. */
export function buildReviewedTranscriptBundleReport({ fixtureText, reviewedPlanText, publicationText }) {
  const fixture = parseJsonText(fixtureText, 'transcript fixture');
  const reviewedPlan = parseJsonText(reviewedPlanText, 'reviewed transcript plan');
  const publication = parseJsonText(publicationText, 'publication approval');
  const graph = buildPublishedTranscriptReviewGraph({ fixtureText, reviewedPlan, publication });
  const handoff = fixture.source === undefined ? null : privateExtractionHandoff(fixture.source);
  return {
    schemaVersion: 1,
    kind: 'transcript-ontology-reviewed-bundle-report',
    artifacts: {
      fixtureBytesSha256: rawSha256(fixtureText),
      reviewedPlanBytesSha256: rawSha256(reviewedPlanText),
      reviewedPlanCanonicalSha256: reviewedTranscriptPlanSha256(reviewedPlan),
      publicationBytesSha256: rawSha256(publicationText),
    },
    binding: {
      sourceId: graph.meta.source.source_id,
      fixtureId: graph.meta.source.fixture_id,
      sessionId: graph.meta.source.session_id,
      reviewBatchSha256: handoff?.reviewBatchSha256 ?? null,
      candidateSetId: handoff?.candidateSetId ?? null,
    },
    counts: graph.meta.counts,
    dropped: graph.meta.dropped,
    safety: {
      databaseMutationExecuted: false,
      publicGraphWritten: false,
      bundleVerified: true,
    },
  };
}

export function verifyReviewedTranscriptBundleReport(input) {
  const expected = buildReviewedTranscriptBundleReport(input);
  if (canonicalJson(input.report) !== canonicalJson(expected)) {
    throw new Error('Transcript ontology reviewed bundle report does not match its artifacts');
  }
  return {
    fixtureBytesSha256: expected.artifacts.fixtureBytesSha256,
    reviewedPlanCanonicalSha256: expected.artifacts.reviewedPlanCanonicalSha256,
    publicationBytesSha256: expected.artifacts.publicationBytesSha256,
    sourceId: expected.binding.sourceId,
    nodeCount: expected.counts.nodes,
    edgeCount: expected.counts.edges,
    bundleReportVerified: true,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
  };
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot parse ${label} JSON`, { cause: error });
  }
}

function readText(path, label) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${label}`, { cause: error });
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
  const operations = [
    '--output-graph', '--verify-graph', '--output-live-graph', '--verify-live-graph',
    '--output-reviewed-live-graph', '--verify-reviewed-live-graph',
    '--output-reviewed-preview', '--verify-reviewed-preview',
    '--output-reviewed-bundle-report', '--verify-reviewed-bundle-report',
  ];
  const inputs = ['--fixture', '--reviewed-plan', '--publication', '--reviewed-preview'];
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (![...inputs, ...operations].includes(key) || !value) {
      throw new Error('Usage: --fixture <path> <graph operation> <path>');
    }
    if (values.has(key)) throw new Error('Duplicate CLI option');
    values.set(key, value);
  }
  if (!values.has('--fixture') || operations.filter((operation) => values.has(operation)).length !== 1) {
    throw new Error('Usage: --fixture <path> <graph operation> <path>');
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

function publicLiveGraphPath(path) {
  const resolved = resolvedOutputPath(path);
  const dataRoot = realpathSync.native(PUBLIC_GRAPH_DATA_ROOT);
  if (dirname(resolved) !== dataRoot || !LIVE_GRAPH_FILENAME_PATTERN.test(basename(resolved))) {
    throw new Error('Live graph output must be a live-*.json file in public/workshop-graph/data');
  }
  return resolved;
}

async function runCli(argv) {
  const values = parseCliArgs(argv);
  const fixturePath = resolve(values.get('--fixture'));
  const fixture = readJson(fixturePath, 'transcript fixture');
  const reviewedOperation = values.has('--output-reviewed-live-graph')
    || values.has('--verify-reviewed-live-graph')
    || values.has('--output-reviewed-preview')
    || values.has('--verify-reviewed-preview')
    || values.has('--output-reviewed-bundle-report')
    || values.has('--verify-reviewed-bundle-report');
  if (reviewedOperation) {
    if (!values.has('--reviewed-plan') || !values.has('--publication')) {
      throw new Error('Reviewed live graph requires --reviewed-plan and --publication');
    }
    const fixtureText = readText(fixturePath, 'transcript fixture');
    const reviewedPlanPath = resolve(values.get('--reviewed-plan'));
    const publicationPath = resolve(values.get('--publication'));
    const reviewedPlanText = readText(reviewedPlanPath, 'reviewed transcript plan');
    const publicationText = readText(publicationPath, 'publication approval');
    const reviewedPlan = parseJsonText(reviewedPlanText, 'reviewed transcript plan');
    const publication = parseJsonText(publicationText, 'publication approval');
    const operation = [
      '--output-reviewed-live-graph', '--verify-reviewed-live-graph',
      '--output-reviewed-preview', '--verify-reviewed-preview',
      '--output-reviewed-bundle-report', '--verify-reviewed-bundle-report',
    ].find((candidate) => values.has(candidate));
    if (operation === '--output-reviewed-bundle-report' || operation === '--verify-reviewed-bundle-report') {
      const reportPath = resolvedOutputPath(resolve(values.get(operation)));
      if (isInside(realpathSync.native(PUBLIC_ROOT), reportPath)) {
        throw new Error('Reviewed bundle report must remain outside public');
      }
      const reportInput = { fixtureText, reviewedPlanText, publicationText };
      if (operation === '--output-reviewed-bundle-report') {
        const report = buildReviewedTranscriptBundleReport(reportInput);
        writeJson(reportPath, report);
        return {
          fixtureBytesSha256: report.artifacts.fixtureBytesSha256,
          reviewedPlanCanonicalSha256: report.artifacts.reviewedPlanCanonicalSha256,
          publicationBytesSha256: report.artifacts.publicationBytesSha256,
          sourceId: report.binding.sourceId,
          nodeCount: report.counts.nodes,
          edgeCount: report.counts.edges,
          bundleReportWritten: true,
          databaseMutationExecuted: false,
          publicGraphWritten: false,
        };
      }
      const report = readJson(reportPath, 'reviewed transcript bundle report');
      return verifyReviewedTranscriptBundleReport({ ...reportInput, report });
    }
    const writesPublicGraph = operation === '--output-reviewed-live-graph';
    const verifiesPublicGraph = operation === '--verify-reviewed-live-graph';
    if (writesPublicGraph !== values.has('--reviewed-preview')) {
      throw new Error('Reviewed live graph output requires exactly one --reviewed-preview input');
    }
    const requestedPath = resolve(values.get(operation));
    const graphPath = writesPublicGraph || verifiesPublicGraph
      ? publicLiveGraphPath(requestedPath)
      : resolvedOutputPath(requestedPath);
    if ((writesPublicGraph || verifiesPublicGraph) && basename(graphPath, '.json') !== publication.sourceId) {
      throw new Error('Live graph filename must match its approved source id');
    }
    if (!writesPublicGraph && !verifiesPublicGraph
      && isInside(realpathSync.native(PUBLIC_ROOT), graphPath)) {
      throw new Error('Reviewed graph preview must not be written or verified under public');
    }
    if (writesPublicGraph) {
      const previewPath = resolvedOutputPath(resolve(values.get('--reviewed-preview')));
      if (isInside(realpathSync.native(PUBLIC_ROOT), previewPath)) {
        throw new Error('Reviewed graph preview input must remain outside public');
      }
      const graph = readJson(previewPath, 'reviewed transcript graph preview');
      const verification = verifyPublishedTranscriptReviewGraph({
        fixtureText, reviewedPlan, publication, graph,
      });
      writeJson(graphPath, graph);
      return {
        ...verification,
        publicGraphWritten: true,
        previewVerified: true,
      };
    }
    if (operation === '--output-reviewed-preview') {
      const graph = buildPublishedTranscriptReviewGraph({ fixtureText, reviewedPlan, publication });
      writeJson(graphPath, graph);
      return {
        nodeCount: graph.elements.nodes.length,
        edgeCount: graph.elements.edges.length,
        dropped: graph.meta.dropped,
        databaseMutationExecuted: false,
        publicGraphWritten: false,
        previewWritten: true,
      };
    }
    const graph = readJson(graphPath, 'published transcript review graph');
    return {
      ...verifyPublishedTranscriptReviewGraph({ fixtureText, reviewedPlan, publication, graph }),
      publicGraphWritten: false,
      previewVerified: !verifiesPublicGraph,
    };
  }
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
  if (values.has('--output-live-graph')) {
    const outputPath = publicLiveGraphPath(resolve(values.get('--output-live-graph')));
    const graph = buildLiveTranscriptGraph(fixture);
    writeJson(outputPath, graph);
    return {
      nodeCount: graph.elements.nodes.length,
      edgeCount: graph.elements.edges.length,
      databaseMutationExecuted: false,
      publicGraphWritten: true,
    };
  }
  if (values.has('--verify-live-graph')) {
    const graphPath = publicLiveGraphPath(resolve(values.get('--verify-live-graph')));
    const graph = readJson(graphPath, 'live transcript graph');
    return verifyLiveTranscriptGraph({ fixture, graph });
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
