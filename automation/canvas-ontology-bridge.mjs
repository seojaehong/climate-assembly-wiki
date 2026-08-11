import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = resolve(REPOSITORY_ROOT, 'public');

export const CANVAS_ONTOLOGY_NODE_KINDS = [
  'Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence',
];

export const CANVAS_ONTOLOGY_RELATIONS = [
  'supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
  'modifies', 'isAbout', 'raisesIssue', 'implements',
];

const KIND_KO = {
  Issue: '쟁점', Claim: '주장', Proposal: '제안', Concern: '우려',
  Condition: '조건', Value: '가치', Evidence: '근거',
};

const RELATION_KO = {
  supports: '지지', opposes: '반대', hasConcern: '우려', requiresCondition: '조건필요',
  hasEvidence: '근거', modifies: '수정', isAbout: '관련', raisesIssue: '쟁점제기',
  implements: '실행',
};

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function optionalString(value, label) {
  if (value === null || value === undefined) return null;
  return nonemptyString(value, label);
}

function validateSnapshot(snapshot) {
  if (!isRecord(snapshot) || !isRecord(snapshot.payload)) {
    throw new Error('Invalid Canvas snapshot');
  }
  if (!Array.isArray(snapshot.payload.agenda) || !Array.isArray(snapshot.payload.agenda_link)) {
    throw new Error('Canvas snapshot is missing agenda collections');
  }
  return snapshot;
}

function reviewNode(row) {
  if (!isRecord(row)) throw new Error('Invalid Canvas agenda row');
  const id = nonemptyString(row.id, 'agenda id');
  const sourceKind = row.kind === 'action' ? 'action' : row.kind === 'agenda' || row.kind == null ? 'agenda' : null;
  if (!sourceKind) throw new Error('Invalid agenda kind');
  if (row.status !== 'active') throw new Error('Canvas review plan accepts active agenda rows only');
  const text = nonemptyString(row.text, 'agenda text');
  return {
    id: `canvas-agenda:${id}`,
    sourceAgendaId: id,
    sourceSessionId: nonemptyString(row.session_id, 'agenda session id'),
    label: text,
    text,
    sourceText: text,
    groupId: optionalString(row.group_id, 'agenda group id'),
    parentAgendaId: optionalString(row.parent_id, 'agenda parent id'),
    sourceKind,
    kind: null,
    kindCandidates: [...CANVAS_ONTOLOGY_NODE_KINDS],
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  };
}

function validateAgendaRow(row) {
  if (!isRecord(row)) throw new Error('Invalid Canvas agenda row');
  const status = row.status;
  if (!['active', 'archived'].includes(status)) throw new Error('Invalid agenda status');
  if (!['agenda', 'action', null, undefined].includes(row.kind)) throw new Error('Invalid agenda kind');
  return {
    ...row,
    id: nonemptyString(row.id, 'agenda id'),
    session_id: nonemptyString(row.session_id, 'agenda session id'),
    text: nonemptyString(row.text, 'agenda text'),
    status,
  };
}

function validateAgendaLinkRow(row) {
  if (!isRecord(row)) throw new Error('Invalid Canvas agenda link row');
  return {
    ...row,
    id: nonemptyString(row.id, 'agenda link id'),
    session_id: nonemptyString(row.session_id, 'agenda link session id'),
    source_id: nonemptyString(row.source_id, 'agenda link source'),
    target_id: nonemptyString(row.target_id, 'agenda link target'),
  };
}

function reviewLink(row, nodeIds) {
  if (!isRecord(row)) throw new Error('Invalid Canvas agenda link row');
  const id = nonemptyString(row.id, 'agenda link id');
  const source = `canvas-agenda:${nonemptyString(row.source_id, 'agenda link source')}`;
  const target = `canvas-agenda:${nonemptyString(row.target_id, 'agenda link target')}`;
  if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error('Agenda link references a missing active agenda');
  return {
    id: `canvas-link:${id}`,
    source,
    target,
    sourceType: 'agenda_link',
    sourceLinkId: id,
    relation: null,
    relationCandidates: [...CANVAS_ONTOLOGY_RELATIONS],
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  };
}

/** Builds a local review plan without publishing graph data or mutating a database. */
export function buildCanvasOntologyReviewPlan(input) {
  const snapshot = validateSnapshot(input);
  const agendaRows = snapshot.payload.agenda.map(validateAgendaRow);
  const linkRows = snapshot.payload.agenda_link.map(validateAgendaLinkRow);
  if (new Set(agendaRows.map((row) => row.id)).size !== agendaRows.length) {
    throw new Error('Duplicate agenda id');
  }
  if (new Set(linkRows.map((row) => row.id)).size !== linkRows.length) {
    throw new Error('Duplicate agenda link id');
  }
  const agendaById = new Map(agendaRows.map((row) => [row.id, row]));
  for (const row of agendaRows) {
    if (row.kind === 'action' && !optionalString(row.parent_id, 'agenda parent id')) {
      throw new Error('Action agenda requires a parent');
    }
    if ((row.kind === 'agenda' || row.kind == null) && optionalString(row.parent_id, 'agenda parent id')) {
      throw new Error('Non-action agenda must not have a parent');
    }
    if (row.parent_id) {
      const parent = agendaById.get(row.parent_id);
      if (!parent) throw new Error('Action parent references a missing agenda');
      if (parent.session_id !== row.session_id) throw new Error('Cross-session agenda relation is not allowed');
    }
  }
  const nodes = agendaRows.filter((row) => row.status === 'active').map(reviewNode);
  if (nodes.length === 0) throw new Error('Canvas snapshot has no active agenda rows');
  const nodeIds = new Set(nodes.map((node) => node.id));
  const allAgendaIds = new Set(agendaRows.map((row) => row.id));
  const excludedRelations = [];
  const relations = [];
  for (const row of linkRows) {
    const source = `canvas-agenda:${row.source_id}`;
    const target = `canvas-agenda:${row.target_id}`;
    if (!allAgendaIds.has(row.source_id) || !allAgendaIds.has(row.target_id)) {
      throw new Error('Agenda link references a missing agenda');
    }
    const sourceRow = agendaById.get(row.source_id);
    const targetRow = agendaById.get(row.target_id);
    if (sourceRow.session_id !== row.session_id || targetRow.session_id !== row.session_id) {
      throw new Error('Cross-session agenda relation is not allowed');
    }
    if (row.source_id === row.target_id) throw new Error('Self-referencing agenda link is not allowed');
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      excludedRelations.push({
        sourceLinkId: row.id,
        sourceAgendaId: row.source_id,
        targetAgendaId: row.target_id,
        reason: 'inactive_endpoint',
      });
      continue;
    }
    relations.push(reviewLink(row, nodeIds));
  }

  for (const node of nodes) {
    if (!node.parentAgendaId) continue;
    const source = `canvas-agenda:${node.parentAgendaId}`;
    if (!nodeIds.has(source)) throw new Error('Action parent references a missing active agenda');
    relations.push({
      id: `canvas-parent:${node.sourceAgendaId}`,
      source,
      target: node.id,
      sourceType: 'action_parent',
      sourceLinkId: null,
      relation: null,
      relationCandidates: [...CANVAS_ONTOLOGY_RELATIONS],
      reviewStatus: 'proposed',
      reviewer: null,
      reviewedAt: null,
    });
  }

  const groups = new Map();
  for (const node of nodes) {
    if (!node.groupId) continue;
    const clusterKey = `${node.sourceSessionId}\u0000${node.groupId}`;
    const members = groups.get(clusterKey) ?? [];
    members.push(node.id);
    groups.set(clusterKey, members);
  }
  const clusters = [...groups.entries()].map(([clusterKey, memberNodeIds]) => {
    const separatorIndex = clusterKey.indexOf('\u0000');
    return {
      sourceSessionId: clusterKey.slice(0, separatorIndex),
      groupId: clusterKey.slice(separatorIndex + 1),
      memberNodeIds,
      reviewStatus: 'proposed',
      issueNodeId: null,
      reviewer: null,
      reviewedAt: null,
    };
  });
  const sessionIds = [...new Set(nodes.map((node) => node.sourceSessionId))].sort();

  return {
    schemaVersion: 1,
    kind: 'canvas-ontology-review-plan',
    dryRun: true,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
    requiresHumanReview: true,
    source: {
      snapshotId: snapshot.id ?? null,
      snapshotSource: snapshot.source ?? null,
      takenAt: snapshot.taken_at ?? null,
      sessionIds,
    },
    nodes,
    relations,
    clusters,
    excluded: {
      agendas: agendaRows.filter((row) => row.status === 'archived').map((row) => ({
        sourceAgendaId: row.id,
        sourceSessionId: row.session_id,
        sourceStatus: row.status,
        reason: 'archived_agenda',
      })),
      relations: excludedRelations,
    },
  };
}

/** Adds exact-input and canonical-plan checksums for accidental-change detection. */
export function sealCanvasOntologyReviewPlan({ plan, snapshotSource }) {
  const { integrity: _integrity, ...unsignedPlan } = plan;
  const integrity = {
    kind: 'self-checksum',
    algorithm: 'sha256',
    snapshotSha256: sha256(snapshotSource),
  };
  return {
    ...unsignedPlan,
    integrity: {
      ...integrity,
      planSha256: sha256(canonicalJson({ ...unsignedPlan, integrity })),
    },
  };
}

/** Verifies checksums and reconstructs the plan from the same snapshot input. */
export function verifyCanvasOntologyReviewPlan({ plan, snapshot, snapshotSource }) {
  if (!isRecord(plan) || plan.schemaVersion !== 1 || plan.kind !== 'canvas-ontology-review-plan') {
    throw new Error('Unsupported Canvas ontology review plan');
  }
  if (plan.integrity?.kind !== 'self-checksum' || plan.integrity?.algorithm !== 'sha256') {
    throw new Error('Unsupported Canvas ontology integrity contract');
  }
  const { planSha256, ...integrityWithoutPlanHash } = plan.integrity;
  if (typeof planSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(planSha256)) {
    throw new Error('Invalid Canvas ontology review plan checksum');
  }
  const unsigned = { ...plan, integrity: integrityWithoutPlanHash };
  if (sha256(canonicalJson(unsigned)) !== planSha256) {
    throw new Error('Canvas ontology review plan checksum mismatch');
  }
  if (plan.integrity.snapshotSha256 !== sha256(snapshotSource)) {
    throw new Error('Canvas snapshot input hash mismatch');
  }
  const expected = sealCanvasOntologyReviewPlan({
    plan: buildCanvasOntologyReviewPlan(snapshot),
    snapshotSource,
  });
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error('Canvas ontology review plan does not match its snapshot input');
  }
  return {
    nodeCount: plan.nodes.length,
    relationCount: plan.relations.length,
    databaseMutationExecuted: false,
  };
}

function proposedSourceShape(plan) {
  if (!isRecord(plan) || !Array.isArray(plan.nodes) || !Array.isArray(plan.relations) || !Array.isArray(plan.clusters)) {
    throw new Error('Invalid reviewed Canvas ontology plan');
  }
  const copy = structuredClone(plan);
  delete copy.integrity;
  copy.nodes = copy.nodes.map((node) => ({
    ...node,
    label: node.sourceText,
    text: node.sourceText,
    kind: null,
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  }));
  copy.relations = copy.relations.map((relation) => ({
    ...relation,
    relation: null,
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  }));
  copy.clusters = copy.clusters.map((cluster) => ({
    ...cluster,
    reviewStatus: 'proposed',
    issueNodeId: null,
    reviewer: null,
    reviewedAt: null,
  }));
  return copy;
}

function validateReviewAudit(item) {
  nonemptyString(item.reviewer, 'reviewer');
  const reviewedAt = nonemptyString(item.reviewedAt, 'reviewedAt');
  if (new Date(reviewedAt).toISOString() !== reviewedAt) throw new Error('Invalid reviewedAt');
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** Converts an explicitly reviewed local plan to the current graph JSON schema. */
export function exportReviewedCanvasOntology({ reviewedPlan, snapshot, snapshotSource }) {
  const expected = buildCanvasOntologyReviewPlan(snapshot);
  if (reviewedPlan.integrity?.snapshotSha256 !== sha256(snapshotSource)) {
    throw new Error('Reviewed Canvas ontology plan snapshot hash mismatch');
  }
  if (canonicalJson(proposedSourceShape(reviewedPlan)) !== canonicalJson(expected)) {
    throw new Error('Reviewed Canvas ontology plan does not match its snapshot input');
  }
  if (sha256(snapshotSource) !== sha256(JSON.stringify(snapshot))) {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.isBuffer(snapshotSource) ? snapshotSource.toString('utf8') : snapshotSource);
    } catch {
      throw new Error('Canvas snapshot source is invalid');
    }
    if (canonicalJson(parsed) !== canonicalJson(snapshot)) {
      throw new Error('Canvas snapshot source does not match parsed input');
    }
  }
  const snapshotId = reviewedPlan.source?.snapshotId;
  if ((typeof snapshotId !== 'string' && typeof snapshotId !== 'number') || String(snapshotId).length === 0) {
    throw new Error('Reviewed Canvas export requires a snapshot id');
  }

  const acceptedNodes = new Map();
  for (const node of reviewedPlan.nodes) {
    if (!['accepted', 'edited', 'rejected'].includes(node.reviewStatus)) {
      throw new Error('Canvas ontology review is incomplete');
    }
    validateReviewAudit(node);
    if (node.reviewStatus === 'rejected') {
      if (node.kind !== null) throw new Error('Rejected Canvas ontology node must not have a kind');
      continue;
    }
    if (!CANVAS_ONTOLOGY_NODE_KINDS.includes(node.kind)) throw new Error('Invalid reviewed ontology node kind');
    const label = nonemptyString(node.label, 'reviewed ontology node label');
    const text = nonemptyString(node.text, 'reviewed ontology node text');
    if (label.length > 200) throw new Error('Reviewed ontology node label exceeds 200 characters');
    const contentEdited = label !== node.sourceText || text !== node.sourceText;
    if (contentEdited && node.reviewStatus !== 'edited') {
      throw new Error('Edited Canvas ontology content requires edited review status');
    }
    if (!contentEdited && node.reviewStatus === 'edited') {
      throw new Error('Unchanged Canvas ontology content must use accepted review status');
    }
    acceptedNodes.set(node.id, node);
  }

  const acceptedRelations = [];
  for (const relation of reviewedPlan.relations) {
    if (!['accepted', 'rejected'].includes(relation.reviewStatus)) {
      throw new Error('Canvas ontology review is incomplete');
    }
    validateReviewAudit(relation);
    if (relation.reviewStatus === 'rejected') {
      if (relation.relation !== null) throw new Error('Rejected Canvas ontology relation must not have a type');
      continue;
    }
    if (!CANVAS_ONTOLOGY_RELATIONS.includes(relation.relation)) throw new Error('Invalid reviewed ontology relation type');
    if (!acceptedNodes.has(relation.source) || !acceptedNodes.has(relation.target)) {
      throw new Error('Accepted relation requires accepted endpoint nodes');
    }
    acceptedRelations.push(relation);
  }

  const clusterIssueByMember = new Map();
  for (const cluster of reviewedPlan.clusters) {
    if (!['accepted', 'rejected'].includes(cluster.reviewStatus)) {
      throw new Error('Canvas ontology review is incomplete');
    }
    validateReviewAudit(cluster);
    if (cluster.reviewStatus === 'rejected') {
      if (cluster.issueNodeId !== null) throw new Error('Rejected Canvas cluster must not select an issue node');
      continue;
    }
    const issueNode = acceptedNodes.get(cluster.issueNodeId);
    if (!issueNode || issueNode.kind !== 'Issue' || !cluster.memberNodeIds.includes(cluster.issueNodeId)) {
      throw new Error('Accepted Canvas cluster requires an accepted member Issue node');
    }
    for (const memberNodeId of cluster.memberNodeIds) {
      if (acceptedNodes.has(memberNodeId)) clusterIssueByMember.set(memberNodeId, cluster.issueNodeId);
    }
  }

  const degree = new Map([...acceptedNodes.keys()].map((id) => [id, 0]));
  for (const relation of acceptedRelations) {
    degree.set(relation.source, (degree.get(relation.source) ?? 0) + 1);
    degree.set(relation.target, (degree.get(relation.target) ?? 0) + 1);
  }
  const graphNodes = [...acceptedNodes.values()].map((node) => {
    const citation = `canvas-snapshot:${snapshotId}:agenda:${node.sourceAgendaId}`;
    return {
      data: {
        id: node.id,
        node_id: node.id,
        label: node.label,
        kind: node.kind,
        kindKo: KIND_KO[node.kind],
        text: node.text,
        cited: [citation],
        cited_uids: [citation],
        session: node.sourceSessionId,
        review_state: node.reviewStatus,
        is_public: false,
        synthesized: false,
        deg: degree.get(node.id) ?? 0,
        isolated: (degree.get(node.id) ?? 0) === 0,
        meta: {
          source_snapshot_id: snapshotId,
          source_agenda_id: node.sourceAgendaId,
          source_text_sha256: sha256(node.sourceText),
          content_edited: node.label !== node.sourceText || node.text !== node.sourceText,
          source_kind: node.sourceKind,
          canvas_group_id: node.groupId,
          cluster_issue_node_id: clusterIssueByMember.get(node.id) ?? null,
          reviewer: node.reviewer,
          reviewed_at: node.reviewedAt,
        },
      },
    };
  });
  const graphEdges = acceptedRelations.map((relation) => ({
    data: {
      id: relation.id,
      source: relation.source,
      target: relation.target,
      rel: relation.relation,
      relKo: RELATION_KO[relation.relation],
      meta: {
        source_type: relation.sourceType,
        source_link_id: relation.sourceLinkId,
        reviewer: relation.reviewer,
        reviewed_at: relation.reviewedAt,
      },
    },
  }));
  const reviewedTimes = [
    ...acceptedNodes.values(), ...acceptedRelations,
    ...reviewedPlan.clusters.filter((cluster) => cluster.reviewStatus === 'accepted'),
  ].map((item) => item.reviewedAt).sort();

  return {
    elements: { nodes: graphNodes, edges: graphEdges },
    meta: {
      variant: 'canvas-reviewed-export',
      generated_at: reviewedTimes.at(-1) ?? null,
      counts: {
        nodes: graphNodes.length,
        edges: graphEdges.length,
        by_kind: countValues(graphNodes.map((node) => node.data.kind)),
        by_rel: countValues(graphEdges.map((edge) => edge.data.rel)),
      },
      kinds: countValues(graphNodes.map((node) => node.data.kind)),
      advisory_notice: '사람이 검수한 내부 export이며 공개 승인을 뜻하지 않습니다.',
      live: false,
      publication_status: 'internal_reviewed_export',
      requires_publication_review: true,
      source: {
        snapshot_id: snapshotId,
        snapshot_source: reviewedPlan.source.snapshotSource,
        taken_at: reviewedPlan.source.takenAt,
        snapshot_sha256: sha256(snapshotSource),
      },
    },
  };
}

function readJsonFile(path, label) {
  try {
    const source = readFileSync(path);
    return { source, data: JSON.parse(source.toString('utf8')) };
  } catch (error) {
    throw new Error(`Cannot parse ${label} JSON`, { cause: error });
  }
}

function writeJsonFile(path, value, force) {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: force ? 'w' : 'wx',
    });
  } catch (error) {
    if (!force && isRecord(error) && error.code === 'EEXIST') {
      throw new Error('Output already exists; use --force to replace it');
    }
    throw error;
  }
}

function parseCliArgs(argv) {
  const values = new Map();
  let force = false;
  const valueOptions = new Set(['--snapshot', '--output-plan', '--verify-plan', '--reviewed-plan', '--output-graph']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') {
      force = true;
      continue;
    }
    if (!valueOptions.has(argument)) throw new Error('Unknown Canvas ontology bridge argument');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  if (!values.has('--snapshot')) throw new Error('Missing required argument: --snapshot');
  const create = values.has('--output-plan');
  const verify = values.has('--verify-plan');
  const exportGraph = values.has('--reviewed-plan') || values.has('--output-graph');
  if ([create, verify, exportGraph].filter(Boolean).length !== 1) {
    throw new Error('Select exactly one Canvas ontology bridge mode');
  }
  if (exportGraph && (!values.has('--reviewed-plan') || !values.has('--output-graph'))) {
    throw new Error('Reviewed export requires --reviewed-plan and --output-graph');
  }
  if (verify && force) throw new Error('--force is not valid when verifying a plan');
  return {
    snapshotPath: values.get('--snapshot'),
    outputPlanPath: values.get('--output-plan'),
    verifyPlanPath: values.get('--verify-plan'),
    reviewedPlanPath: values.get('--reviewed-plan'),
    outputGraphPath: values.get('--output-graph'),
    force,
  };
}

function isInsidePublicDirectory(path) {
  const pathFromPublic = relative(PUBLIC_ROOT, resolve(path));
  return pathFromPublic === ''
    || (!pathFromPublic.startsWith('..') && !isAbsolute(pathFromPublic));
}

export function runCanvasOntologyBridgeCli(argv) {
  const options = parseCliArgs(argv);
  const outputPath = options.outputPlanPath ?? options.outputGraphPath;
  if (outputPath && isInsidePublicDirectory(outputPath)) {
    throw new Error('Canvas ontology output must stay outside the repository public directory');
  }
  const snapshotFile = readJsonFile(options.snapshotPath, 'Canvas snapshot');
  if (options.outputPlanPath) {
    const plan = sealCanvasOntologyReviewPlan({
      plan: buildCanvasOntologyReviewPlan(snapshotFile.data),
      snapshotSource: snapshotFile.source,
    });
    writeJsonFile(options.outputPlanPath, plan, options.force);
    return `${plan.nodes.length} nodes; ${plan.relations.length} relations; database mutation: false; public graph written: false`;
  }
  if (options.verifyPlanPath) {
    const planFile = readJsonFile(options.verifyPlanPath, 'Canvas ontology review plan');
    const result = verifyCanvasOntologyReviewPlan({
      plan: planFile.data,
      snapshot: snapshotFile.data,
      snapshotSource: snapshotFile.source,
    });
    return `Canvas ontology review plan verified (${result.nodeCount} nodes; ${result.relationCount} relations; database mutation: false)`;
  }
  const reviewedPlanFile = readJsonFile(options.reviewedPlanPath, 'reviewed Canvas ontology plan');
  const graph = exportReviewedCanvasOntology({
    reviewedPlan: reviewedPlanFile.data,
    snapshot: snapshotFile.data,
    snapshotSource: snapshotFile.source,
  });
  writeJsonFile(options.outputGraphPath, graph, options.force);
  return `${graph.meta.counts.nodes} nodes; ${graph.meta.counts.edges} edges; database mutation: false; public graph written: false`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    console.log(runCanvasOntologyBridgeCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Canvas ontology bridge failed');
    process.exitCode = 1;
  }
}
