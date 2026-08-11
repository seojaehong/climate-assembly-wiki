type ReviewStatus = 'proposed' | 'accepted' | 'edited' | 'rejected';
type DecidedStatus = Exclude<ReviewStatus, 'proposed'>;

interface CanvasOntologyAudit {
  reviewStatus: ReviewStatus;
  reviewer: string | null;
  reviewedAt: string | null;
}

export interface CanvasOntologyNode extends CanvasOntologyAudit, Record<string, unknown> {
  id: string;
  sourceAgendaId: string;
  sourceSessionId: string;
  sourceText: string;
  label: string;
  text: string;
  kind: string | null;
  kindCandidates: string[];
}

export interface CanvasOntologyRelation extends CanvasOntologyAudit, Record<string, unknown> {
  id: string;
  source: string;
  target: string;
  relation: string | null;
  relationCandidates: string[];
}

export interface CanvasOntologyCluster extends CanvasOntologyAudit, Record<string, unknown> {
  sourceSessionId: string;
  groupId: string;
  memberNodeIds: string[];
  issueNodeId: string | null;
}

interface CanvasOntologyReviewPlan extends Record<string, unknown> {
  schemaVersion: 1;
  kind: 'canvas-ontology-review-plan';
  dryRun: true;
  databaseMutationExecuted: false;
  publicGraphWritten: false;
  requiresHumanReview: true;
  source: {
    snapshotId: string | number;
    snapshotSource: string | null;
    takenAt: string | null;
    sessionIds: string[];
  };
  nodes: CanvasOntologyNode[];
  relations: CanvasOntologyRelation[];
  clusters: CanvasOntologyCluster[];
  integrity: {
    kind: 'self-checksum';
    algorithm: 'sha256';
    snapshotSha256: string;
    planSha256: string;
  };
}

export interface CanvasOntologyReviewWorkspace {
  plan: CanvasOntologyReviewPlan;
  source: CanvasOntologyReviewPlan['source'];
  summary: {
    nodes: number;
    relations: number;
    clusters: number;
    decided: number;
    total: number;
  };
}

interface ReviewAuditInput {
  reviewer: string;
  reviewedAt: string;
}

export type CanvasOntologyReviewDecision =
  | (ReviewAuditInput & {
    itemType: 'node';
    id: string;
    status: DecidedStatus;
    kind?: string;
    label?: string;
    text?: string;
  })
  | (ReviewAuditInput & {
    itemType: 'relation';
    id: string;
    status: 'accepted' | 'rejected';
    relation?: string;
  })
  | (ReviewAuditInput & {
    itemType: 'cluster';
    id: string;
    status: 'accepted' | 'rejected';
    issueNodeId?: string;
  });

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REVIEWER_ALIAS_PATTERN = /^[a-zA-Z][a-zA-Z0-9._:-]{2,79}$/;
const CANVAS_ONTOLOGY_NODE_KINDS = [
  'Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence',
];
const CANVAS_ONTOLOGY_RELATIONS = [
  'supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
  'modifies', 'isAbout', 'raisesIssue', 'implements',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function nonemptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid ${label}`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonemptyString(value, label);
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(`Invalid ${label}`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) throw new Error(`Duplicate ${label}`);
  return [...result];
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function validateAudit(value: Record<string, unknown>, label: string): CanvasOntologyAudit {
  if (!['proposed', 'accepted', 'edited', 'rejected'].includes(String(value.reviewStatus))) {
    throw new Error(`Invalid ${label} review status`);
  }
  const reviewStatus = value.reviewStatus as ReviewStatus;
  const reviewer = nullableString(value.reviewer, `${label} reviewer`);
  const reviewedAt = nullableString(value.reviewedAt, `${label} reviewedAt`);
  if (reviewStatus === 'proposed' && (reviewer !== null || reviewedAt !== null)) {
    throw new Error(`Invalid proposed ${label} audit state`);
  }
  if (reviewStatus !== 'proposed' && (reviewer === null || reviewedAt === null)) {
    throw new Error(`Invalid decided ${label} audit state`);
  }
  return { reviewStatus, reviewer, reviewedAt };
}

function validateNode(value: unknown): CanvasOntologyNode {
  if (!isRecord(value)) throw new Error('Invalid Canvas ontology node');
  const audit = validateAudit(value, 'node');
  const kind = nullableString(value.kind, 'node kind');
  const sourceText = nonemptyString(value.sourceText, 'node source text');
  return {
    ...value,
    ...audit,
    id: nonemptyString(value.id, 'node id'),
    sourceAgendaId: nonemptyString(value.sourceAgendaId, 'node source agenda id'),
    sourceSessionId: nonemptyString(value.sourceSessionId, 'node source session id'),
    sourceText,
    label: nonemptyString(value.label, 'node label'),
    text: nonemptyString(value.text, 'node text'),
    kind,
    kindCandidates: stringArray(value.kindCandidates, 'node kind candidates'),
  };
}

function validateRelation(value: unknown): CanvasOntologyRelation {
  if (!isRecord(value)) throw new Error('Invalid Canvas ontology relation');
  return {
    ...value,
    ...validateAudit(value, 'relation'),
    id: nonemptyString(value.id, 'relation id'),
    source: nonemptyString(value.source, 'relation source'),
    target: nonemptyString(value.target, 'relation target'),
    relation: nullableString(value.relation, 'relation type'),
    relationCandidates: stringArray(value.relationCandidates, 'relation candidates'),
  };
}

function validateCluster(value: unknown): CanvasOntologyCluster {
  if (!isRecord(value)) throw new Error('Invalid Canvas ontology cluster');
  return {
    ...value,
    ...validateAudit(value, 'cluster'),
    sourceSessionId: nonemptyString(value.sourceSessionId, 'cluster session id'),
    groupId: nonemptyString(value.groupId, 'cluster group id'),
    memberNodeIds: stringArray(value.memberNodeIds, 'cluster members'),
    issueNodeId: nullableString(value.issueNodeId, 'cluster issue node id'),
  };
}

function validateSource(value: unknown): CanvasOntologyReviewPlan['source'] {
  if (!isRecord(value)) throw new Error('Invalid Canvas ontology source');
  if (!['string', 'number'].includes(typeof value.snapshotId) || String(value.snapshotId).trim().length === 0) {
    throw new Error('Invalid Canvas ontology snapshot id');
  }
  return {
    snapshotId: value.snapshotId as string | number,
    snapshotSource: nullableString(value.snapshotSource, 'snapshot source'),
    takenAt: nullableString(value.takenAt, 'snapshot timestamp'),
    sessionIds: stringArray(value.sessionIds, 'source sessions'),
  };
}

function validatePlan(value: unknown): CanvasOntologyReviewPlan {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.kind !== 'canvas-ontology-review-plan') {
    throw new Error('Unsupported Canvas ontology review plan');
  }
  if (value.dryRun !== true || value.databaseMutationExecuted !== false
    || value.publicGraphWritten !== false || value.requiresHumanReview !== true) {
    throw new Error('Canvas ontology review plan safety contract is invalid');
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.relations) || !Array.isArray(value.clusters)) {
    throw new Error('Canvas ontology review plan collections are invalid');
  }
  if (!isRecord(value.integrity) || value.integrity.kind !== 'self-checksum'
    || value.integrity.algorithm !== 'sha256'
    || typeof value.integrity.snapshotSha256 !== 'string' || !SHA256_PATTERN.test(value.integrity.snapshotSha256)
    || typeof value.integrity.planSha256 !== 'string' || !SHA256_PATTERN.test(value.integrity.planSha256)) {
    throw new Error('Canvas ontology review plan integrity contract is invalid');
  }
  const nodes = value.nodes.map(validateNode);
  const relations = value.relations.map(validateRelation);
  const clusters = value.clusters.map(validateCluster);
  if (nodes.length === 0 || new Set(nodes.map((node) => node.id)).size !== nodes.length) {
    throw new Error('Canvas ontology review plan node identities are invalid');
  }
  if (new Set(relations.map((relation) => relation.id)).size !== relations.length) {
    throw new Error('Canvas ontology review plan relation identities are invalid');
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (relations.some((relation) => !nodeIds.has(relation.source) || !nodeIds.has(relation.target))) {
    throw new Error('Canvas ontology relation references a missing node');
  }
  if (clusters.some((cluster) => cluster.memberNodeIds.length === 0
    || cluster.memberNodeIds.some((nodeId) => !nodeIds.has(nodeId)))) {
    throw new Error('Canvas ontology cluster references a missing node');
  }
  return {
    ...value,
    schemaVersion: 1,
    kind: 'canvas-ontology-review-plan',
    dryRun: true,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
    requiresHumanReview: true,
    source: validateSource(value.source),
    nodes,
    relations,
    clusters,
    integrity: {
      kind: 'self-checksum',
      algorithm: 'sha256',
      snapshotSha256: value.integrity.snapshotSha256,
      planSha256: value.integrity.planSha256,
    },
  };
}

function summarize(plan: CanvasOntologyReviewPlan): CanvasOntologyReviewWorkspace['summary'] {
  const items: CanvasOntologyAudit[] = [...plan.nodes, ...plan.relations, ...plan.clusters];
  return {
    nodes: plan.nodes.length,
    relations: plan.relations.length,
    clusters: plan.clusters.length,
    decided: items.filter((item) => item.reviewStatus !== 'proposed').length,
    total: items.length,
  };
}

function optionalSnapshotString(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : nonemptyString(value, label);
}

function validateSnapshot(plan: CanvasOntologyReviewPlan, value: unknown): void {
  if (!isRecord(value) || !isRecord(value.payload)
    || !Array.isArray(value.payload.agenda) || !Array.isArray(value.payload.agenda_link)) {
    throw new Error('Invalid Canvas snapshot');
  }
  if (value.id !== plan.source.snapshotId || (value.source ?? null) !== plan.source.snapshotSource
    || (value.taken_at ?? null) !== plan.source.takenAt) {
    throw new Error('Canvas snapshot provenance does not match the review plan');
  }
  const agendaRows = value.payload.agenda.map((row) => {
    if (!isRecord(row)) throw new Error('Invalid Canvas snapshot agenda');
    const status = row.status;
    if (status !== 'active' && status !== 'archived') throw new Error('Invalid Canvas snapshot agenda status');
    const sourceKind = row.kind === 'action'
      ? 'action'
      : (row.kind === 'agenda' || row.kind === null || row.kind === undefined ? 'agenda' : null);
    if (!sourceKind) throw new Error('Invalid Canvas snapshot agenda kind');
    return {
      id: nonemptyString(row.id, 'snapshot agenda id'),
      sessionId: nonemptyString(row.session_id, 'snapshot agenda session'),
      text: nonemptyString(row.text, 'snapshot agenda text'),
      status,
      sourceKind,
      groupId: optionalSnapshotString(row.group_id, 'snapshot agenda group'),
      parentAgendaId: optionalSnapshotString(row.parent_id, 'snapshot agenda parent'),
    };
  });
  if (new Set(agendaRows.map((row) => row.id)).size !== agendaRows.length) {
    throw new Error('Duplicate Canvas snapshot agenda id');
  }
  const agendaById = new Map(agendaRows.map((row) => [row.id, row]));
  for (const row of agendaRows) {
    if (row.sourceKind === 'action' && row.parentAgendaId === null) {
      throw new Error('Canvas snapshot action requires a parent');
    }
    if (row.sourceKind === 'agenda' && row.parentAgendaId !== null) {
      throw new Error('Canvas snapshot non-action must not have a parent');
    }
    if (row.parentAgendaId !== null) {
      if (row.parentAgendaId === row.id) throw new Error('Canvas snapshot action must not reference itself');
      const parent = agendaById.get(row.parentAgendaId);
      if (!parent) throw new Error('Canvas snapshot action parent is missing');
      if (parent.sessionId !== row.sessionId) throw new Error('Canvas snapshot relation crosses sessions');
    }
  }
  const activeRows = agendaRows.filter((row) => row.status === 'active');
  if (activeRows.length === 0) throw new Error('Canvas snapshot has no active agenda rows');
  const nodes = activeRows.map((row) => ({
    id: `canvas-agenda:${row.id}`,
    sourceAgendaId: row.id,
    sourceSessionId: row.sessionId,
    label: row.text,
    text: row.text,
    sourceText: row.text,
    groupId: row.groupId,
    parentAgendaId: row.parentAgendaId,
    sourceKind: row.sourceKind,
    kind: null,
    kindCandidates: [...CANVAS_ONTOLOGY_NODE_KINDS],
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  }));
  const activeNodeIds = new Set(nodes.map((node) => node.id));
  const linkRows = value.payload.agenda_link.map((row) => {
    if (!isRecord(row)) throw new Error('Invalid Canvas snapshot agenda link');
    return {
      id: nonemptyString(row.id, 'snapshot agenda link id'),
      sessionId: nonemptyString(row.session_id, 'snapshot agenda link session'),
      sourceAgendaId: nonemptyString(row.source_id, 'snapshot agenda link source'),
      targetAgendaId: nonemptyString(row.target_id, 'snapshot agenda link target'),
    };
  });
  if (new Set(linkRows.map((row) => row.id)).size !== linkRows.length) {
    throw new Error('Duplicate Canvas snapshot agenda link id');
  }
  const relations: Array<Record<string, unknown>> = [];
  const excludedRelations: Array<Record<string, unknown>> = [];
  for (const row of linkRows) {
    const sourceRow = agendaById.get(row.sourceAgendaId);
    const targetRow = agendaById.get(row.targetAgendaId);
    if (!sourceRow || !targetRow) throw new Error('Canvas snapshot agenda link endpoint is missing');
    if (row.sourceAgendaId === row.targetAgendaId) throw new Error('Canvas snapshot agenda link references itself');
    if (sourceRow.sessionId !== row.sessionId || targetRow.sessionId !== row.sessionId) {
      throw new Error('Canvas snapshot relation crosses sessions');
    }
    const source = `canvas-agenda:${row.sourceAgendaId}`;
    const target = `canvas-agenda:${row.targetAgendaId}`;
    if (!activeNodeIds.has(source) || !activeNodeIds.has(target)) {
      excludedRelations.push({
        sourceType: 'agenda_link', sourceLinkId: row.id, sourceSessionId: row.sessionId,
        sourceAgendaId: row.sourceAgendaId, targetAgendaId: row.targetAgendaId,
        reason: 'inactive_endpoint',
      });
    } else {
      relations.push({
        id: `canvas-link:${row.id}`, source, target, sourceType: 'agenda_link', sourceLinkId: row.id,
        relation: null, relationCandidates: [...CANVAS_ONTOLOGY_RELATIONS],
        reviewStatus: 'proposed', reviewer: null, reviewedAt: null,
      });
    }
  }
  for (const row of agendaRows) {
    if (row.status === 'archived' && row.sourceKind === 'action' && row.parentAgendaId !== null) {
      excludedRelations.push({
        sourceType: 'action_parent', sourceLinkId: null, sourceSessionId: row.sessionId,
        sourceAgendaId: row.parentAgendaId, targetAgendaId: row.id, reason: 'inactive_endpoint',
      });
    }
  }
  for (const node of nodes) {
    if (node.parentAgendaId === null) continue;
    const source = `canvas-agenda:${node.parentAgendaId}`;
    if (!activeNodeIds.has(source)) throw new Error('Canvas snapshot action parent is not active');
    relations.push({
      id: `canvas-parent:${node.sourceAgendaId}`, source, target: node.id,
      sourceType: 'action_parent', sourceLinkId: null, relation: null,
      relationCandidates: [...CANVAS_ONTOLOGY_RELATIONS], reviewStatus: 'proposed',
      reviewer: null, reviewedAt: null,
    });
  }
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.groupId === null) continue;
    const key = `${node.sourceSessionId}\u0000${node.groupId}`;
    groups.set(key, [...(groups.get(key) ?? []), node.id]);
  }
  const clusters = [...groups.entries()].map(([key, memberNodeIds]) => {
    const separatorIndex = key.indexOf('\u0000');
    return {
      sourceSessionId: key.slice(0, separatorIndex), groupId: key.slice(separatorIndex + 1),
      memberNodeIds, reviewStatus: 'proposed', issueNodeId: null, reviewer: null, reviewedAt: null,
    };
  });
  const sessions = [...new Set(agendaRows.map((row) => row.sessionId))].sort();
  const expected = {
    schemaVersion: 1,
    kind: 'canvas-ontology-review-plan',
    dryRun: true,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
    requiresHumanReview: true,
    source: {
      snapshotId: value.id ?? null,
      snapshotSource: value.source ?? null,
      takenAt: value.taken_at ?? null,
      sessionIds: sessions,
    },
    nodes,
    relations,
    clusters,
    excluded: {
      agendas: agendaRows.filter((row) => row.status === 'archived').map((row) => ({
        sourceAgendaId: row.id, sourceSessionId: row.sessionId,
        sourceStatus: row.status, reason: 'archived_agenda',
      })),
      relations: excludedRelations,
    },
    integrity: plan.integrity,
  };
  if (JSON.stringify(canonicalize(plan)) !== JSON.stringify(canonicalize(expected))) {
    throw new Error('Canvas ontology review plan does not match its snapshot input');
  }
}

/** Opens a local-only human review workspace from a sealed plan and its exact Canvas snapshot bytes. */
export async function createCanvasOntologyReviewWorkspace(input: {
  planText: string;
  snapshotText: string;
}): Promise<CanvasOntologyReviewWorkspace> {
  const parsedPlan = parseJson(input.planText, 'Canvas ontology review plan');
  const plan = validatePlan(parsedPlan);
  if (summarize(plan).decided !== 0) {
    throw new Error('Canvas ontology review plan must start with proposed items');
  }
  const { planSha256, ...integrityWithoutPlanHash } = plan.integrity;
  const expectedPlanHash = await sha256(JSON.stringify(canonicalize({
    ...plan,
    integrity: integrityWithoutPlanHash,
  })));
  if (expectedPlanHash !== planSha256) throw new Error('Canvas ontology review plan checksum mismatch');
  if (await sha256(input.snapshotText) !== plan.integrity.snapshotSha256) {
    throw new Error('Canvas snapshot does not match the sealed review plan');
  }
  validateSnapshot(plan, parseJson(input.snapshotText, 'Canvas snapshot'));
  return { plan, source: plan.source, summary: summarize(plan) };
}

function validateReviewAuditInput(input: ReviewAuditInput): void {
  const reviewer = nonemptyString(input.reviewer, 'reviewer alias');
  if (!REVIEWER_ALIAS_PATTERN.test(reviewer)) throw new Error('Reviewer alias format is invalid');
  const reviewedAt = nonemptyString(input.reviewedAt, 'review timestamp');
  if (new Date(reviewedAt).toISOString() !== reviewedAt) throw new Error('Invalid review timestamp');
}

/** Applies one explicit moderator decision without writing to a database or browser storage. */
export function reviewCanvasOntologyItem(
  workspace: CanvasOntologyReviewWorkspace,
  decision: CanvasOntologyReviewDecision,
): CanvasOntologyReviewWorkspace {
  validateReviewAuditInput(decision);
  const plan = structuredClone(workspace.plan);
  if (decision.itemType === 'node') {
    const index = plan.nodes.findIndex((node) => node.id === decision.id);
    if (index < 0) throw new Error('Canvas ontology review node was not found');
    const node = plan.nodes[index];
    let nextNode: CanvasOntologyNode;
    if (decision.status === 'rejected') {
      nextNode = {
        ...node, kind: null, label: node.sourceText, text: node.sourceText,
        reviewStatus: 'rejected', reviewer: decision.reviewer, reviewedAt: decision.reviewedAt,
      };
    } else {
      const kind = nonemptyString(decision.kind, 'reviewed node kind');
      if (!node.kindCandidates.includes(kind)) throw new Error('Reviewed node kind is not an allowed candidate');
      const label = decision.label?.trim() || node.label;
      const text = decision.text?.trim() || node.text;
      const contentEdited = label !== node.sourceText || text !== node.sourceText;
      if (decision.status === 'accepted' && contentEdited) {
        throw new Error('Edited Canvas ontology content requires edited review status');
      }
      if (decision.status === 'edited' && !contentEdited) {
        throw new Error('Unchanged Canvas ontology content must use accepted review status');
      }
      nextNode = {
        ...node, kind, label, text, reviewStatus: decision.status,
        reviewer: decision.reviewer, reviewedAt: decision.reviewedAt,
      };
    }
    const remainsAccepted = nextNode.reviewStatus === 'accepted' || nextNode.reviewStatus === 'edited';
    if (!remainsAccepted && plan.relations.some((relation) => relation.reviewStatus === 'accepted'
      && (relation.source === nextNode.id || relation.target === nextNode.id))) {
      throw new Error('Reject dependent relations before rejecting their endpoint node');
    }
    if ((!remainsAccepted || nextNode.kind !== 'Issue')
      && plan.clusters.some((cluster) => cluster.reviewStatus === 'accepted'
        && cluster.issueNodeId === nextNode.id)) {
      throw new Error('Reject the dependent cluster before changing its representative Issue node');
    }
    plan.nodes[index] = nextNode;
  } else if (decision.itemType === 'relation') {
    const index = plan.relations.findIndex((relation) => relation.id === decision.id);
    if (index < 0) throw new Error('Canvas ontology review relation was not found');
    const relation = plan.relations[index];
    const relationType = decision.status === 'accepted'
      ? nonemptyString(decision.relation, 'reviewed relation type')
      : null;
    if (relationType !== null && !relation.relationCandidates.includes(relationType)) {
      throw new Error('Reviewed relation type is not an allowed candidate');
    }
    if (decision.status === 'accepted') {
      const acceptedNodeIds = new Set(plan.nodes
        .filter((node) => node.reviewStatus === 'accepted' || node.reviewStatus === 'edited')
        .map((node) => node.id));
      if (!acceptedNodeIds.has(relation.source) || !acceptedNodeIds.has(relation.target)) {
        throw new Error('Accepted relation requires accepted endpoint nodes');
      }
    }
    plan.relations[index] = {
      ...relation, relation: relationType, reviewStatus: decision.status,
      reviewer: decision.reviewer, reviewedAt: decision.reviewedAt,
    };
  } else {
    const index = plan.clusters.findIndex(
      (cluster) => `${cluster.sourceSessionId}\u0000${cluster.groupId}` === decision.id,
    );
    if (index < 0) throw new Error('Canvas ontology review cluster was not found');
    const cluster = plan.clusters[index];
    const issueNodeId = decision.status === 'accepted'
      ? nonemptyString(decision.issueNodeId, 'cluster issue node id')
      : null;
    if (issueNodeId !== null && !cluster.memberNodeIds.includes(issueNodeId)) {
      throw new Error('Cluster issue node must be one of its members');
    }
    if (issueNodeId !== null) {
      const issueNode = plan.nodes.find((node) => node.id === issueNodeId);
      if (!issueNode || (issueNode.reviewStatus !== 'accepted' && issueNode.reviewStatus !== 'edited')
        || issueNode.kind !== 'Issue') {
        throw new Error('Accepted cluster requires an accepted member Issue node');
      }
    }
    plan.clusters[index] = {
      ...cluster, issueNodeId, reviewStatus: decision.status,
      reviewer: decision.reviewer, reviewedAt: decision.reviewedAt,
    };
  }
  return { plan, source: plan.source, summary: summarize(plan) };
}

/** Serializes a fully reviewed internal plan for the existing CLI graph-export verification path. */
export function exportCanvasOntologyReviewedPlan(workspace: CanvasOntologyReviewWorkspace): string {
  const { plan } = workspace;
  if (summarize(plan).decided !== summarize(plan).total) throw new Error('Canvas ontology review is incomplete');
  const acceptedNodeIds = new Set(
    plan.nodes.filter((node) => node.reviewStatus === 'accepted' || node.reviewStatus === 'edited')
      .map((node) => node.id),
  );
  for (const relation of plan.relations) {
    if (relation.reviewStatus === 'accepted'
      && (!acceptedNodeIds.has(relation.source) || !acceptedNodeIds.has(relation.target))) {
      throw new Error('Accepted relation requires accepted endpoint nodes');
    }
  }
  for (const cluster of plan.clusters) {
    if (cluster.reviewStatus !== 'accepted') continue;
    const issueNode = plan.nodes.find((node) => node.id === cluster.issueNodeId);
    if (!issueNode || !acceptedNodeIds.has(issueNode.id) || issueNode.kind !== 'Issue') {
      throw new Error('Accepted cluster requires an accepted member Issue node');
    }
  }
  return `${JSON.stringify(plan, null, 2)}\n`;
}
