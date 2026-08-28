/**
 * 캔버스 온톨로지 검수 계획 — **순수 로직**. Node API를 하나도 쓰지 않는다.
 *
 * 왜 갈라놓았나 — 이 로직은 두 곳에서 돌아야 한다.
 *   · CLI  automation/canvas-ontology-bridge.mjs (스냅샷 파일 → 계획 파일)
 *   · 화면 src/islands/mod/ontology-plan.ts (본부 보드에서 바로 내려받기)
 * 두 벌로 복사해두면 한쪽만 고쳐지고, 그때 계획의 체크섬이 서로 안 맞는다.
 *
 * 해시만 바깥에서 주입한다. Node는 createHash로 동기, 브라우저는 Web Crypto라 비동기다.
 * 그래서 seal을 한 함수로 두지 않고 「정본 문자열을 만드는 것」과 「해시를 붙이는 것」으로 나눈다.
 */

export const CANVAS_ONTOLOGY_NODE_KINDS = [
  'Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence',
];

export const CANVAS_ONTOLOGY_RELATIONS = [
  'supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
  'modifies', 'isAbout', 'raisesIssue', 'implements',
];

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
      if (row.parent_id === row.id) throw new Error('Action agenda must not reference itself as parent');
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
        sourceType: 'agenda_link',
        sourceLinkId: row.id,
        sourceSessionId: row.session_id,
        sourceAgendaId: row.source_id,
        targetAgendaId: row.target_id,
        reason: 'inactive_endpoint',
      });
      continue;
    }
    relations.push(reviewLink(row, nodeIds));
  }

  for (const row of agendaRows) {
    if (row.status !== 'archived' || row.kind !== 'action' || !row.parent_id) continue;
    excludedRelations.push({
      sourceType: 'action_parent',
      sourceLinkId: null,
      sourceSessionId: row.session_id,
      sourceAgendaId: row.parent_id,
      targetAgendaId: row.id,
      reason: 'inactive_endpoint',
    });
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
  const sessionIds = [...new Set(agendaRows.map((row) => row.session_id))].sort();

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

// ── 봉인(무결성) — 해시는 호출부가 계산해 넣는다 ────────────────────

/** 서명 전 계획(체크섬 필드 제거본). */
export function unsignedPlanOf(plan) {
  const { integrity: _integrity, ...unsignedPlan } = plan;
  return unsignedPlan;
}

/**
 * 계획 해시의 입력이 되는 정본 문자열.
 * 스냅샷 해시를 먼저 구해 넣어야 계획 해시를 구할 수 있다(브리지의 순서와 같다).
 */
export function canonicalPlanForHash(unsignedPlan, snapshotSha256) {
  return canonicalJson({
    ...unsignedPlan,
    integrity: { kind: 'self-checksum', algorithm: 'sha256', snapshotSha256 },
  });
}

/** 두 해시를 붙여 봉인된 계획을 만든다. */
export function attachPlanIntegrity(unsignedPlan, snapshotSha256, planSha256) {
  return {
    ...unsignedPlan,
    integrity: { kind: 'self-checksum', algorithm: 'sha256', snapshotSha256, planSha256 },
  };
}

export { canonicalJson, canonicalize, isRecord, nonemptyString, optionalString, validateSnapshot, validateAgendaRow, validateAgendaLinkRow };
