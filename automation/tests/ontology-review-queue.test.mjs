import { expect, test } from 'vitest';
import { sealCanvasOntologyReviewPlan } from '../canvas-ontology-bridge.mjs';
import {
  buildOntologyReviewQueueSeed,
  verifyOntologyReviewQueueSeed,
} from '../ontology-review-queue.mjs';

const REVIEW_PLAN_SOURCE = {
  schemaVersion: 1,
  kind: 'canvas-ontology-review-plan',
  dryRun: true,
  databaseMutationExecuted: false,
  publicGraphWritten: false,
  requiresHumanReview: true,
  source: {
    snapshotId: 42,
    snapshotSource: 'cron',
    takenAt: '2026-08-29T00:00:00.000Z',
    sessionIds: ['session-1'],
  },
  nodes: [
    {
      id: 'canvas-agenda:agenda-1',
      sourceAgendaId: 'agenda-1',
      sourceSessionId: 'session-1',
      label: '지역 에너지 자립을 논의한다.',
      text: '지역 에너지 자립을 논의한다.',
      sourceText: '지역 에너지 자립을 논의한다.',
      groupId: 'group-1',
      parentAgendaId: null,
      sourceKind: 'agenda',
      kind: null,
      kindCandidates: ['Issue', 'Claim', 'Proposal'],
      reviewStatus: 'proposed',
      reviewer: null,
      reviewedAt: null,
    },
    {
      id: 'canvas-agenda:agenda-2',
      sourceAgendaId: 'agenda-2',
      sourceSessionId: 'session-1',
      label: '공공건물 태양광을 확대한다.',
      text: '공공건물 태양광을 확대한다.',
      sourceText: '공공건물 태양광을 확대한다.',
      groupId: null,
      parentAgendaId: null,
      sourceKind: 'agenda',
      kind: null,
      kindCandidates: ['Issue', 'Claim', 'Proposal'],
      reviewStatus: 'proposed',
      reviewer: null,
      reviewedAt: null,
    },
  ],
  relations: [{
    id: 'canvas-link:link-1',
    source: 'canvas-agenda:agenda-1',
    target: 'canvas-agenda:agenda-2',
    sourceType: 'agenda_link',
    sourceLinkId: 'link-1',
    relation: null,
    relationCandidates: ['supports', 'opposes'],
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  }],
  clusters: [{
    sourceSessionId: 'session-1',
    groupId: 'group-1',
    memberNodeIds: ['canvas-agenda:agenda-1'],
    reviewStatus: 'proposed',
    issueNodeId: null,
    reviewer: null,
    reviewedAt: null,
  }],
  excluded: { agendas: [], relations: [] },
};

function sealPlan(plan) {
  const copy = structuredClone(plan);
  delete copy.integrity;
  return sealCanvasOntologyReviewPlan({ plan: copy, snapshotSource: 'snapshot-source' });
}

const REVIEW_PLAN = sealPlan(REVIEW_PLAN_SOURCE);

test('builds a non-mutating review queue seed that preserves every human decision and provenance field', () => {
  const seed = buildOntologyReviewQueueSeed(REVIEW_PLAN);

  expect(seed).toMatchObject({
    schemaVersion: 1,
    kind: 'ontology-review-queue-seed-plan',
    dryRun: true,
    databaseMutationExecuted: false,
    requiresApproval: true,
    contractStatus: 'draft',
    source: {
      kind: 'canvas-ontology-review-plan',
      sourceKind: 'canvas_snapshot',
      sourceUid: 'canvas-snapshot:42',
      snapshotId: 42,
      sessionIds: ['session-1'],
      snapshotSha256: REVIEW_PLAN.integrity.snapshotSha256,
      planSha256: REVIEW_PLAN.integrity.planSha256,
    },
    counts: { node: 2, relation: 1, cluster: 1, total: 4 },
    integrity: {
      kind: 'self-checksum',
      algorithm: 'sha256',
      seedSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
  });
  expect(seed.items).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'canvas-agenda:agenda-1',
      itemType: 'node',
      sourceUid: 'canvas-snapshot:42:agenda:agenda-1',
      transcriptChunkId: null,
      nodeKind: null,
      label: '지역 에너지 자립을 논의한다.',
      text: '지역 에너지 자립을 논의한다.',
      sourceText: '지역 에너지 자립을 논의한다.',
      relationType: null,
      citedUids: ['canvas-snapshot:42:agenda:agenda-1'],
      reviewStatus: 'proposed',
      reviewer: null,
      reviewedAt: null,
      moderatorMetadata: expect.objectContaining({
        visibility: 'moderator_only',
        sourceSessionId: 'session-1',
        sourceKind: 'agenda',
        kindCandidates: ['Issue', 'Claim', 'Proposal'],
      }),
    }),
    expect.objectContaining({
      id: 'canvas-link:link-1',
      itemType: 'relation',
      sourceUid: 'canvas-snapshot:42:agenda-link:link-1',
      sourceNodeId: 'canvas-agenda:agenda-1',
      targetNodeId: 'canvas-agenda:agenda-2',
      citedUids: [
        'canvas-snapshot:42:agenda-link:link-1',
        'canvas-snapshot:42:agenda:agenda-1',
        'canvas-snapshot:42:agenda:agenda-2',
      ],
      relationType: null,
      reviewStatus: 'proposed',
    }),
    expect.objectContaining({
      id: expect.stringMatching(/^canvas-cluster:[0-9a-f]{64}$/),
      itemType: 'cluster',
      sourceUid: expect.stringMatching(/^canvas-snapshot:42:cluster:[0-9a-f]{64}$/),
      citedUids: ['canvas-snapshot:42:agenda:agenda-1'],
      reviewStatus: 'proposed',
    }),
  ]));
});

test('rejects source plans that pre-decide ontology or review outcomes', () => {
  const decidedNode = structuredClone(REVIEW_PLAN);
  decidedNode.nodes[0].kind = 'Issue';
  expect(() => buildOntologyReviewQueueSeed(sealPlan(decidedNode))).toThrow(
    'Proposed ontology review node must not select a kind',
  );

  const decidedRelation = structuredClone(REVIEW_PLAN);
  decidedRelation.relations[0].relation = 'supports';
  expect(() => buildOntologyReviewQueueSeed(sealPlan(decidedRelation))).toThrow(
    'Proposed ontology review relation must not select a type',
  );

  const reviewedNode = structuredClone(REVIEW_PLAN);
  reviewedNode.nodes[0].reviewStatus = 'accepted';
  reviewedNode.nodes[0].reviewer = 'moderator-1';
  reviewedNode.nodes[0].reviewedAt = '2026-08-29T01:00:00.000Z';
  expect(() => buildOntologyReviewQueueSeed(sealPlan(reviewedNode))).toThrow(
    'Invalid proposed node audit state',
  );

  const mismatchedSessions = structuredClone(REVIEW_PLAN);
  mismatchedSessions.source.sessionIds = ['session-2'];
  expect(() => buildOntologyReviewQueueSeed(sealPlan(mismatchedSessions))).toThrow(
    'Ontology review plan session provenance mismatch',
  );
});

test('preserves review vocabulary, exclusions, and action-parent provenance without seeding excluded rows', () => {
  const plan = structuredClone(REVIEW_PLAN);
  plan.nodes[1] = {
    ...plan.nodes[1],
    sourceKind: 'action',
    parentAgendaId: 'agenda-1',
  };
  plan.relations.push({
    id: 'canvas-parent:agenda-2',
    source: 'canvas-agenda:agenda-1',
    target: 'canvas-agenda:agenda-2',
    sourceType: 'action_parent',
    sourceLinkId: null,
    relation: null,
    relationCandidates: ['implements'],
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  });
  plan.excluded = {
    agendas: [{
      sourceAgendaId: 'agenda-archived',
      sourceSessionId: 'session-1',
      sourceStatus: 'archived',
      reason: 'archived_agenda',
    }],
    relations: [{
      sourceType: 'agenda_link',
      sourceLinkId: 'link-archived',
      sourceSessionId: 'session-1',
      sourceAgendaId: 'agenda-archived',
      targetAgendaId: 'agenda-1',
      reason: 'inactive_endpoint',
    }, {
      sourceType: 'action_parent',
      sourceLinkId: null,
      sourceSessionId: 'session-1',
      sourceAgendaId: 'agenda-1',
      targetAgendaId: 'action-archived',
      reason: 'inactive_endpoint',
    }],
  };

  const seed = buildOntologyReviewQueueSeed(sealPlan(plan));

  expect(seed.contract).toEqual({
    itemTypes: ['node', 'relation', 'cluster'],
    reviewStatuses: ['proposed', 'accepted', 'edited', 'rejected'],
    moderatorMetadataVisibility: 'moderator_only',
  });
  expect(seed.excluded).toEqual([
    {
      sourceKind: 'agenda',
      sourceUid: 'canvas-snapshot:42:agenda:agenda-archived',
      sessionId: 'session-1',
      reason: 'archived_agenda',
      moderatorMetadata: {
        visibility: 'moderator_only',
        sourceAgendaId: 'agenda-archived',
        sourceStatus: 'archived',
      },
    },
    {
      sourceKind: 'agenda_link',
      sourceUid: 'canvas-snapshot:42:agenda-link:link-archived',
      sessionId: 'session-1',
      reason: 'inactive_endpoint',
      moderatorMetadata: {
        visibility: 'moderator_only',
        sourceLinkId: 'link-archived',
        sourceAgendaId: 'agenda-archived',
        targetAgendaId: 'agenda-1',
      },
    },
    {
      sourceKind: 'action_parent',
      sourceUid: 'canvas-snapshot:42:action-parent:action-archived',
      sessionId: 'session-1',
      reason: 'inactive_endpoint',
      moderatorMetadata: {
        visibility: 'moderator_only',
        sourceAgendaId: 'agenda-1',
        targetAgendaId: 'action-archived',
        sourceActionAgendaId: 'action-archived',
      },
    },
  ]);
  expect(seed.counts).toEqual({ node: 2, relation: 2, cluster: 1, total: 5 });
  expect(seed.items).toContainEqual(expect.objectContaining({
    id: 'canvas-parent:agenda-2',
    sourceUid: 'canvas-snapshot:42:action-parent:agenda-2',
    citedUids: [
      'canvas-snapshot:42:action-parent:agenda-2',
      'canvas-snapshot:42:agenda:agenda-1',
      'canvas-snapshot:42:agenda:agenda-2',
    ],
  }));
  expect(seed.items.some((item) => item.sourceUid.includes('archived'))).toBe(false);
});

test('rejects a tampered sealed plan through the exported builder interface', () => {
  const tampered = structuredClone(REVIEW_PLAN);
  tampered.nodes[0].label = '변조된 검수 라벨';

  expect(() => buildOntologyReviewQueueSeed(tampered)).toThrow(
    'Canvas ontology review plan checksum mismatch',
  );
});

test('verifies the generated seed checksum and rejects item tampering', () => {
  const seed = buildOntologyReviewQueueSeed(REVIEW_PLAN);

  expect(verifyOntologyReviewQueueSeed(seed)).toEqual({ itemCount: 4, excludedCount: 0 });
  seed.items[0].label = '변조된 seed 라벨';
  expect(() => verifyOntologyReviewQueueSeed(seed)).toThrow(
    'Ontology review queue seed checksum mismatch',
  );
});

test('rejects duplicate or contradictory source UIDs before future DB insertion', () => {
  const duplicateRelation = structuredClone(REVIEW_PLAN);
  duplicateRelation.relations.push({
    ...duplicateRelation.relations[0],
    id: 'canvas-link:duplicate-link-row',
  });
  expect(() => buildOntologyReviewQueueSeed(sealPlan(duplicateRelation))).toThrow(
    'Ontology review relation source identity mismatch',
  );

  const duplicateExclusion = structuredClone(REVIEW_PLAN);
  duplicateExclusion.excluded.agendas = [
    {
      sourceAgendaId: 'agenda-archived',
      sourceSessionId: 'session-1',
      sourceStatus: 'archived',
      reason: 'archived_agenda',
    },
    {
      sourceAgendaId: 'agenda-archived',
      sourceSessionId: 'session-1',
      sourceStatus: 'archived',
      reason: 'archived_agenda',
    },
  ];
  expect(() => buildOntologyReviewQueueSeed(sealPlan(duplicateExclusion))).toThrow(
    'Duplicate ontology review exclusion source UID',
  );

  const crossSessionRelation = structuredClone(REVIEW_PLAN);
  crossSessionRelation.nodes[1].sourceSessionId = 'session-2';
  crossSessionRelation.source.sessionIds = ['session-1', 'session-2'];
  expect(() => buildOntologyReviewQueueSeed(sealPlan(crossSessionRelation))).toThrow(
    'Ontology review relation crosses sessions',
  );

  const invalidActionParent = structuredClone(REVIEW_PLAN);
  invalidActionParent.relations[0] = {
    ...invalidActionParent.relations[0],
    id: 'canvas-parent:agenda-2',
    sourceType: 'action_parent',
    sourceLinkId: null,
  };
  expect(() => buildOntologyReviewQueueSeed(sealPlan(invalidActionParent))).toThrow(
    'Ontology action-parent relation does not match source provenance',
  );
});
