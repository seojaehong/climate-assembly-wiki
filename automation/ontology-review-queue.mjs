import { createHash } from 'node:crypto';

const HEX_SHA256 = /^[0-9a-f]{64}$/;

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

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function nullableString(value, label) {
  if (value === null) return null;
  return nonemptyString(value, label);
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    throw new Error(`Invalid ${label}`);
  }
  if (new Set(value).size !== value.length) throw new Error(`Duplicate ${label}`);
  return [...value];
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function snapshotUid(snapshotId, type, sourceId) {
  return `canvas-snapshot:${snapshotId}:${type}:${sourceId}`;
}

function validateProposedAudit(item, label) {
  if (item.reviewStatus !== 'proposed' || item.reviewer !== null || item.reviewedAt !== null) {
    throw new Error(`Invalid proposed ${label} audit state`);
  }
}

function nodeItem(node, snapshotId) {
  if (!isRecord(node)) throw new Error('Invalid ontology review node');
  validateProposedAudit(node, 'node');
  const id = nonemptyString(node.id, 'ontology review node id');
  const sourceAgendaId = nonemptyString(node.sourceAgendaId, 'ontology review source agenda id');
  if (id !== `canvas-agenda:${sourceAgendaId}`) throw new Error('Ontology review node source identity mismatch');
  if (node.kind !== null) throw new Error('Proposed ontology review node must not select a kind');
  const sourceText = nonemptyString(node.sourceText, 'ontology review source text');
  if (node.label !== sourceText || node.text !== sourceText) {
    throw new Error('Proposed ontology review node content must match its source');
  }
  const sourceUid = snapshotUid(snapshotId, 'agenda', sourceAgendaId);
  return {
    id,
    itemType: 'node',
    sourceUid,
    transcriptChunkId: null,
    nodeKind: null,
    label: nonemptyString(node.label, 'ontology review node label'),
    text: nonemptyString(node.text, 'ontology review node text'),
    sourceText,
    relationType: null,
    sourceNodeId: null,
    targetNodeId: null,
    citedUids: [sourceUid],
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
    moderatorMetadata: {
      visibility: 'moderator_only',
      confidence: null,
      sourceAgendaId,
      sourceSessionId: nonemptyString(node.sourceSessionId, 'ontology review node session id'),
      sourceKind: nonemptyString(node.sourceKind, 'ontology review source kind'),
      sourceText,
      groupId: nullableString(node.groupId, 'ontology review group id'),
      parentAgendaId: nullableString(node.parentAgendaId, 'ontology review parent agenda id'),
      kindCandidates: stringArray(node.kindCandidates, 'ontology review kind candidates'),
    },
  };
}

function relationItem(relation, snapshotId, nodeById) {
  if (!isRecord(relation)) throw new Error('Invalid ontology review relation');
  validateProposedAudit(relation, 'relation');
  const id = nonemptyString(relation.id, 'ontology review relation id');
  const sourceNodeId = nonemptyString(relation.source, 'ontology review relation source');
  const targetNodeId = nonemptyString(relation.target, 'ontology review relation target');
  const sourceNode = nodeById.get(sourceNodeId);
  const targetNode = nodeById.get(targetNodeId);
  if (!sourceNode || !targetNode) throw new Error('Ontology review relation references a missing node');
  if (sourceNodeId === targetNodeId) throw new Error('Ontology review relation must not reference itself');
  if (sourceNode.moderatorMetadata.sourceSessionId !== targetNode.moderatorMetadata.sourceSessionId) {
    throw new Error('Ontology review relation crosses sessions');
  }
  const sourceType = nonemptyString(relation.sourceType, 'ontology review relation source type');
  if (relation.relation !== null) throw new Error('Proposed ontology review relation must not select a type');
  let sourceUid;
  if (sourceType === 'agenda_link') {
    const sourceLinkId = nonemptyString(relation.sourceLinkId, 'ontology review source link id');
    if (id !== `canvas-link:${sourceLinkId}`) throw new Error('Ontology review relation source identity mismatch');
    sourceUid = snapshotUid(snapshotId, 'agenda-link', sourceLinkId);
  } else if (sourceType === 'action_parent' && relation.sourceLinkId === null) {
    const targetAgendaId = targetNode.moderatorMetadata.sourceAgendaId;
    if (id !== `canvas-parent:${targetAgendaId}`
      || targetNode.moderatorMetadata.sourceKind !== 'action'
      || targetNode.moderatorMetadata.parentAgendaId !== sourceNode.moderatorMetadata.sourceAgendaId) {
      throw new Error('Ontology action-parent relation does not match source provenance');
    }
    sourceUid = snapshotUid(snapshotId, 'action-parent', targetAgendaId);
  } else {
    throw new Error('Invalid ontology review relation provenance');
  }
  return {
    id,
    itemType: 'relation',
    sourceUid,
    transcriptChunkId: null,
    nodeKind: null,
    label: null,
    text: null,
    sourceText: null,
    relationType: null,
    sourceNodeId,
    targetNodeId,
    citedUids: [sourceUid, sourceNode.sourceUid, targetNode.sourceUid],
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
    moderatorMetadata: {
      visibility: 'moderator_only',
      confidence: null,
      sourceType,
      relationCandidates: stringArray(relation.relationCandidates, 'ontology review relation candidates'),
    },
  };
}

function clusterItem(cluster, snapshotId, nodeById) {
  if (!isRecord(cluster)) throw new Error('Invalid ontology review cluster');
  validateProposedAudit(cluster, 'cluster');
  const sourceSessionId = nonemptyString(cluster.sourceSessionId, 'ontology review cluster session id');
  const groupId = nonemptyString(cluster.groupId, 'ontology review cluster group id');
  const memberNodeIds = stringArray(cluster.memberNodeIds, 'ontology review cluster members');
  if (memberNodeIds.length === 0) throw new Error('Ontology review cluster requires members');
  const memberNodes = memberNodeIds.map((nodeId) => {
    const node = nodeById.get(nodeId);
    if (!node) throw new Error('Ontology review cluster references a missing node');
    if (node.moderatorMetadata.sourceSessionId !== sourceSessionId) {
      throw new Error('Ontology review cluster crosses sessions');
    }
    return node;
  });
  if (cluster.issueNodeId !== null) throw new Error('Proposed ontology review cluster must not select an issue node');
  const clusterHash = sha256(`${sourceSessionId}\0${groupId}`);
  return {
    id: `canvas-cluster:${clusterHash}`,
    itemType: 'cluster',
    sourceUid: snapshotUid(snapshotId, 'cluster', clusterHash),
    transcriptChunkId: null,
    nodeKind: null,
    label: null,
    text: null,
    sourceText: null,
    relationType: null,
    sourceNodeId: null,
    targetNodeId: null,
    citedUids: memberNodes.map((node) => node.sourceUid),
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
    moderatorMetadata: {
      visibility: 'moderator_only',
      confidence: null,
      sourceSessionId,
      groupId,
      memberNodeIds,
      issueNodeId: null,
    },
  };
}

function excludedProvenance(excluded, snapshotId) {
  if (!isRecord(excluded) || !Array.isArray(excluded.agendas) || !Array.isArray(excluded.relations)) {
    throw new Error('Invalid ontology review exclusions');
  }
  return [
    ...excluded.agendas.map((entry) => {
      if (!isRecord(entry)) throw new Error('Invalid excluded ontology agenda');
      const sourceAgendaId = nonemptyString(entry.sourceAgendaId, 'excluded agenda id');
      return {
        sourceKind: 'agenda',
        sourceUid: snapshotUid(snapshotId, 'agenda', sourceAgendaId),
        sessionId: nonemptyString(entry.sourceSessionId, 'excluded agenda session id'),
        reason: nonemptyString(entry.reason, 'excluded agenda reason'),
        moderatorMetadata: {
          visibility: 'moderator_only',
          sourceAgendaId,
          sourceStatus: nonemptyString(entry.sourceStatus, 'excluded agenda status'),
        },
      };
    }),
    ...excluded.relations.map((entry) => {
      if (!isRecord(entry)) throw new Error('Invalid excluded ontology relation');
      const sourceType = nonemptyString(entry.sourceType, 'excluded relation source type');
      const sourceAgendaId = nonemptyString(entry.sourceAgendaId, 'excluded relation source agenda id');
      const targetAgendaId = nonemptyString(entry.targetAgendaId, 'excluded relation target agenda id');
      if (sourceType === 'action_parent' && entry.sourceLinkId === null) {
        return {
          sourceKind: sourceType,
          sourceUid: snapshotUid(snapshotId, 'action-parent', targetAgendaId),
          sessionId: nonemptyString(entry.sourceSessionId, 'excluded relation session id'),
          reason: nonemptyString(entry.reason, 'excluded relation reason'),
          moderatorMetadata: {
            visibility: 'moderator_only',
            sourceAgendaId,
            targetAgendaId,
            sourceActionAgendaId: targetAgendaId,
          },
        };
      }
      if (sourceType !== 'agenda_link') throw new Error('Invalid excluded relation provenance');
      const sourceLinkId = nonemptyString(entry.sourceLinkId, 'excluded relation id');
      return {
        sourceKind: sourceType,
        sourceUid: snapshotUid(snapshotId, 'agenda-link', sourceLinkId),
        sessionId: nonemptyString(entry.sourceSessionId, 'excluded relation session id'),
        reason: nonemptyString(entry.reason, 'excluded relation reason'),
        moderatorMetadata: {
          visibility: 'moderator_only',
          sourceLinkId,
          sourceAgendaId,
          targetAgendaId,
        },
      };
    }),
  ];
}

/** Converts a sealed local Canvas plan into a future DB seed plan without mutating data. */
export function buildOntologyReviewQueueSeed(plan) {
  if (!isRecord(plan) || plan.schemaVersion !== 1 || plan.kind !== 'canvas-ontology-review-plan') {
    throw new Error('Unsupported Canvas ontology review plan');
  }
  if (plan.dryRun !== true || plan.databaseMutationExecuted !== false || plan.requiresHumanReview !== true) {
    throw new Error('Canvas ontology review plan safety contract is invalid');
  }
  if (!isRecord(plan.source) || !isRecord(plan.integrity)) {
    throw new Error('Canvas ontology review plan provenance is missing');
  }
  if (plan.integrity.kind !== 'self-checksum' || plan.integrity.algorithm !== 'sha256') {
    throw new Error('Canvas ontology review plan integrity contract is invalid');
  }
  const snapshotId = plan.source.snapshotId;
  if (!['string', 'number'].includes(typeof snapshotId) || String(snapshotId).trim().length === 0) {
    throw new Error('Canvas ontology review plan requires a snapshot id');
  }
  if (!HEX_SHA256.test(plan.integrity.snapshotSha256) || !HEX_SHA256.test(plan.integrity.planSha256)) {
    throw new Error('Canvas ontology review plan checksums are invalid');
  }
  const { planSha256, ...integrityWithoutPlanHash } = plan.integrity;
  if (sha256(canonicalJson({ ...plan, integrity: integrityWithoutPlanHash })) !== planSha256) {
    throw new Error('Canvas ontology review plan checksum mismatch');
  }
  if (!Array.isArray(plan.nodes) || !Array.isArray(plan.relations) || !Array.isArray(plan.clusters)) {
    throw new Error('Canvas ontology review plan collections are invalid');
  }
  const nodes = plan.nodes.map((node) => nodeItem(node, snapshotId));
  if (nodes.length === 0) throw new Error('Ontology review queue seed requires nodes');
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (nodeById.size !== nodes.length) throw new Error('Duplicate ontology review node id');
  const excluded = excludedProvenance(plan.excluded, snapshotId);
  const sessionIds = stringArray(plan.source.sessionIds, 'ontology review source sessions').sort();
  const actualSessionIds = [...new Set([
    ...nodes.map((node) => node.moderatorMetadata.sourceSessionId),
    ...excluded.map((entry) => entry.sessionId),
  ])].sort();
  if (JSON.stringify(sessionIds) !== JSON.stringify(actualSessionIds)) {
    throw new Error('Ontology review plan session provenance mismatch');
  }
  const relations = plan.relations.map((relation) => relationItem(relation, snapshotId, nodeById));
  const clusters = plan.clusters.map((cluster) => clusterItem(cluster, snapshotId, nodeById));
  const items = [...nodes, ...relations, ...clusters];
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error('Duplicate ontology review queue item id');
  }
  const itemSourceUids = new Set(items.map((item) => item.sourceUid));
  if (itemSourceUids.size !== items.length) throw new Error('Duplicate ontology review item source UID');
  const exclusionSourceUids = new Set(excluded.map((entry) => entry.sourceUid));
  if (exclusionSourceUids.size !== excluded.length) {
    throw new Error('Duplicate ontology review exclusion source UID');
  }
  if (excluded.some((entry) => itemSourceUids.has(entry.sourceUid))) {
    throw new Error('Ontology review source cannot be both queued and excluded');
  }
  const seed = {
    schemaVersion: 1,
    kind: 'ontology-review-queue-seed-plan',
    dryRun: true,
    databaseMutationExecuted: false,
    requiresApproval: true,
    contractStatus: 'draft',
    contract: {
      itemTypes: ['node', 'relation', 'cluster'],
      reviewStatuses: ['proposed', 'accepted', 'edited', 'rejected'],
      moderatorMetadataVisibility: 'moderator_only',
    },
    source: {
      kind: plan.kind,
      sourceKind: 'canvas_snapshot',
      sourceUid: `canvas-snapshot:${snapshotId}`,
      snapshotId,
      snapshotSource: plan.source.snapshotSource ?? null,
      takenAt: plan.source.takenAt ?? null,
      sessionIds,
      snapshotSha256: plan.integrity.snapshotSha256,
      planSha256: plan.integrity.planSha256,
    },
    counts: {
      node: nodes.length,
      relation: relations.length,
      cluster: clusters.length,
      total: items.length,
    },
    items,
    excluded,
  };
  return {
    ...seed,
    integrity: {
      kind: 'self-checksum',
      algorithm: 'sha256',
      seedSha256: sha256(canonicalJson(seed)),
    },
  };
}

/** Verifies accidental-change integrity for a generated local seed artifact. */
export function verifyOntologyReviewQueueSeed(seed) {
  if (!isRecord(seed) || seed.schemaVersion !== 1 || seed.kind !== 'ontology-review-queue-seed-plan') {
    throw new Error('Unsupported ontology review queue seed');
  }
  if (seed.dryRun !== true || seed.databaseMutationExecuted !== false || seed.requiresApproval !== true) {
    throw new Error('Ontology review queue seed safety contract is invalid');
  }
  if (!isRecord(seed.integrity) || seed.integrity.kind !== 'self-checksum'
    || seed.integrity.algorithm !== 'sha256' || !HEX_SHA256.test(seed.integrity.seedSha256)) {
    throw new Error('Ontology review queue seed integrity contract is invalid');
  }
  const { integrity, ...unsignedSeed } = seed;
  if (sha256(canonicalJson(unsignedSeed)) !== integrity.seedSha256) {
    throw new Error('Ontology review queue seed checksum mismatch');
  }
  if (!Array.isArray(seed.items) || !Array.isArray(seed.excluded) || !isRecord(seed.counts)) {
    throw new Error('Ontology review queue seed collections are invalid');
  }
  if (seed.counts.total !== seed.items.length) throw new Error('Ontology review queue seed count mismatch');
  return { itemCount: seed.items.length, excludedCount: seed.excluded.length };
}
