import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  buildCanvasOntologyReviewPlan,
  exportReviewedCanvasOntology,
  sealCanvasOntologyReviewPlan,
  verifyCanvasOntologyReviewPlan,
} from '../canvas-ontology-bridge.mjs';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

const SNAPSHOT = {
  id: 42,
  source: 'cron',
  taken_at: '2026-08-29T00:00:00.000Z',
  payload: {
    agenda: [
      {
        id: 'agenda-1', session_id: 'session-1', text: '지역 에너지 자립을 논의한다.',
        jo: 'A조', zone: '감축', status: 'active', kind: 'agenda', group_id: 'group-1',
        parent_id: null, x: 10, y: 20,
      },
      {
        id: 'action-1', session_id: 'session-1', text: '공공건물 태양광을 확대한다.',
        jo: 'A조', zone: '감축', status: 'active', kind: 'action', group_id: 'group-1',
        parent_id: 'agenda-1', x: 30, y: 40,
      },
    ],
    agenda_link: [
      { id: 'link-1', session_id: 'session-1', source_id: 'agenda-1', target_id: 'action-1' },
    ],
  },
};

test('builds a non-public human-review plan that preserves Canvas provenance', () => {
  const plan = buildCanvasOntologyReviewPlan(SNAPSHOT);

  expect(plan).toMatchObject({
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
  });
  expect(plan.nodes).toEqual([
    expect.objectContaining({
      id: 'canvas-agenda:agenda-1',
      sourceAgendaId: 'agenda-1',
      sourceSessionId: 'session-1',
      text: '지역 에너지 자립을 논의한다.',
      groupId: 'group-1',
      sourceKind: 'agenda',
      kind: null,
      reviewStatus: 'proposed',
    }),
    expect.objectContaining({
      id: 'canvas-agenda:action-1',
      sourceAgendaId: 'action-1',
      sourceKind: 'action',
      kind: null,
      reviewStatus: 'proposed',
    }),
  ]);
  expect(plan.relations).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'canvas-link:link-1',
      source: 'canvas-agenda:agenda-1',
      target: 'canvas-agenda:action-1',
      sourceType: 'agenda_link',
      relation: null,
      reviewStatus: 'proposed',
    }),
    expect.objectContaining({
      id: 'canvas-parent:action-1',
      source: 'canvas-agenda:agenda-1',
      target: 'canvas-agenda:action-1',
      sourceType: 'action_parent',
      relation: null,
      reviewStatus: 'proposed',
    }),
  ]));
  expect(plan.clusters).toEqual([{
    sourceSessionId: 'session-1',
    groupId: 'group-1',
    memberNodeIds: ['canvas-agenda:agenda-1', 'canvas-agenda:action-1'],
    reviewStatus: 'proposed',
    issueNodeId: null,
    reviewer: null,
    reviewedAt: null,
  }]);
});

test('exports only fully reviewed items to the current graph schema without publishing them', () => {
  const snapshotSource = JSON.stringify(SNAPSHOT);
  const plan = sealCanvasOntologyReviewPlan({
    plan: buildCanvasOntologyReviewPlan(SNAPSHOT),
    snapshotSource,
  });
  const reviewedAt = '2026-08-29T01:00:00.000Z';
  plan.nodes[0] = {
    ...plan.nodes[0], kind: 'Issue', label: '지역 에너지 자립', text: '지역 에너지 자립의 조건을 논의한다.',
    reviewStatus: 'edited', reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt,
  };
  plan.nodes[1] = { ...plan.nodes[1], kind: 'Proposal', reviewStatus: 'accepted', reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt };
  plan.relations[0] = { ...plan.relations[0], relation: 'supports', reviewStatus: 'accepted', reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt };
  plan.relations[1] = { ...plan.relations[1], relation: 'implements', reviewStatus: 'accepted', reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt };
  plan.clusters[0] = {
    ...plan.clusters[0], reviewStatus: 'accepted', issueNodeId: 'canvas-agenda:agenda-1',
    reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt,
  };

  const graph = exportReviewedCanvasOntology({
    reviewedPlan: plan,
    snapshot: SNAPSHOT,
    snapshotSource,
  });

  expect(graph.meta).toMatchObject({
    variant: 'canvas-reviewed-export',
    live: false,
    publication_status: 'internal_reviewed_export',
    requires_publication_review: true,
    counts: { nodes: 2, edges: 2 },
    source: {
      snapshot_id: 42,
      snapshot_source: 'cron',
      taken_at: '2026-08-29T00:00:00.000Z',
      snapshot_sha256: createHash('sha256').update(snapshotSource).digest('hex'),
    },
  });
  expect(graph.meta.source).toEqual({
    snapshot_id: 42,
    snapshot_source: 'cron',
    taken_at: '2026-08-29T00:00:00.000Z',
    snapshot_sha256: createHash('sha256').update(snapshotSource).digest('hex'),
  });
  expect(graph.elements.nodes[0].data).toMatchObject({
    id: 'canvas-agenda:agenda-1',
    label: '지역 에너지 자립',
    text: '지역 에너지 자립의 조건을 논의한다.',
    kind: 'Issue',
    kindKo: '쟁점',
    cited: ['canvas-snapshot:42:agenda:agenda-1'],
    cited_uids: ['canvas-snapshot:42:agenda:agenda-1'],
    review_state: 'edited',
    is_public: false,
    meta: {
      source_snapshot_id: 42,
      source_agenda_id: 'agenda-1',
      source_text_sha256: createHash('sha256').update('지역 에너지 자립을 논의한다.').digest('hex'),
      content_edited: true,
      canvas_group_id: 'group-1',
      cluster_issue_node_id: 'canvas-agenda:agenda-1',
    },
  });
  expect(graph.elements.edges.map((edge) => edge.data.rel)).toEqual(['supports', 'implements']);

  plan.nodes[0] = { ...plan.nodes[0], reviewer: 'moderator-1' };
  expect(() => exportReviewedCanvasOntology({
    reviewedPlan: plan,
    snapshot: SNAPSHOT,
    snapshotSource,
  })).toThrow('Invalid authenticated reviewer id');
  plan.nodes[0] = {
    ...plan.nodes[0], reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
  };

  plan.nodes[0] = { ...plan.nodes[0], reviewStatus: 'accepted' };
  expect(() => exportReviewedCanvasOntology({
    reviewedPlan: plan,
    snapshot: SNAPSHOT,
    snapshotSource,
  })).toThrow('Edited Canvas ontology content requires edited review status');
  plan.nodes[0] = { ...plan.nodes[0], reviewStatus: 'edited' };

  plan.nodes[1] = { ...plan.nodes[1], reviewStatus: 'edited' };
  expect(() => exportReviewedCanvasOntology({
    reviewedPlan: plan,
    snapshot: SNAPSHOT,
    snapshotSource,
  })).toThrow('Unchanged Canvas ontology content must use accepted review status');
  plan.nodes[1] = { ...plan.nodes[1], reviewStatus: 'accepted' };

  plan.relations[0] = { ...plan.relations[0], relation: null, reviewStatus: 'proposed', reviewer: null, reviewedAt: null };
  expect(() => exportReviewedCanvasOntology({
    reviewedPlan: plan,
    snapshot: SNAPSHOT,
    snapshotSource,
  })).toThrow('Canvas ontology review is incomplete');
});

test('seals the review plan to the exact snapshot bytes and detects tampering', () => {
  const snapshotSource = JSON.stringify(SNAPSHOT);
  const sealed = sealCanvasOntologyReviewPlan({
    plan: buildCanvasOntologyReviewPlan(SNAPSHOT),
    snapshotSource,
  });

  expect(sealed.integrity).toMatchObject({
    kind: 'self-checksum',
    algorithm: 'sha256',
    snapshotSha256: createHash('sha256').update(snapshotSource).digest('hex'),
    planSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(verifyCanvasOntologyReviewPlan({
    plan: sealed,
    snapshot: SNAPSHOT,
    snapshotSource,
  })).toEqual({ nodeCount: 2, relationCount: 2, databaseMutationExecuted: false });

  sealed.nodes[0].label = '검수 전 계획을 변조한 값';
  expect(() => verifyCanvasOntologyReviewPlan({
    plan: sealed,
    snapshot: SNAPSHOT,
    snapshotSource,
  })).toThrow('Canvas ontology review plan checksum mismatch');
});

test('records archived Canvas rows and their links as explicit exclusions', () => {
  const snapshot = structuredClone(SNAPSHOT);
  snapshot.payload.agenda.push({
    id: 'agenda-archived', session_id: 'session-1', text: '이전 검토안', jo: 'A조', zone: '감축',
    status: 'archived', kind: 'agenda', group_id: null, parent_id: null, x: 0, y: 0,
  });
  snapshot.payload.agenda.push({
    id: 'action-archived', session_id: 'session-1', text: '이전 실천안', jo: 'A조', zone: '감축',
    status: 'archived', kind: 'action', group_id: null, parent_id: 'agenda-1', x: 0, y: 0,
  });
  snapshot.payload.agenda_link.push({
    id: 'link-archived', session_id: 'session-1', source_id: 'agenda-archived', target_id: 'agenda-1',
  });

  const plan = buildCanvasOntologyReviewPlan(snapshot);

  expect(plan.nodes).toHaveLength(2);
  expect(plan.relations).toHaveLength(2);
  expect(plan.excluded).toEqual({
    agendas: [
      {
        sourceAgendaId: 'agenda-archived',
        sourceSessionId: 'session-1',
        sourceStatus: 'archived',
        reason: 'archived_agenda',
      },
      {
        sourceAgendaId: 'action-archived',
        sourceSessionId: 'session-1',
        sourceStatus: 'archived',
        reason: 'archived_agenda',
      },
    ],
    relations: [
      {
        sourceType: 'agenda_link',
        sourceLinkId: 'link-archived',
        sourceSessionId: 'session-1',
        sourceAgendaId: 'agenda-archived',
        targetAgendaId: 'agenda-1',
        reason: 'inactive_endpoint',
      },
      {
        sourceType: 'action_parent',
        sourceLinkId: null,
        sourceSessionId: 'session-1',
        sourceAgendaId: 'agenda-1',
        targetAgendaId: 'action-archived',
        reason: 'inactive_endpoint',
      },
    ],
  });
});

test('fails closed on duplicate or cross-session Canvas topology', () => {
  const duplicateAgenda = structuredClone(SNAPSHOT);
  duplicateAgenda.payload.agenda.push({ ...duplicateAgenda.payload.agenda[0] });
  expect(() => buildCanvasOntologyReviewPlan(duplicateAgenda)).toThrow('Duplicate agenda id');

  const duplicateLink = structuredClone(SNAPSHOT);
  duplicateLink.payload.agenda_link.push({ ...duplicateLink.payload.agenda_link[0] });
  expect(() => buildCanvasOntologyReviewPlan(duplicateLink)).toThrow('Duplicate agenda link id');

  const crossSession = structuredClone(SNAPSHOT);
  crossSession.payload.agenda[1].session_id = 'session-2';
  crossSession.payload.agenda_link[0].session_id = 'session-1';
  expect(() => buildCanvasOntologyReviewPlan(crossSession)).toThrow('Cross-session agenda relation is not allowed');

  const reusedGroup = structuredClone(SNAPSHOT);
  reusedGroup.payload.agenda_link = [];
  reusedGroup.payload.agenda[1] = {
    ...reusedGroup.payload.agenda[1],
    id: 'agenda-2',
    session_id: 'session-2',
    kind: 'agenda',
    parent_id: null,
  };
  expect(buildCanvasOntologyReviewPlan(reusedGroup).clusters).toEqual([
    expect.objectContaining({ sourceSessionId: 'session-1', groupId: 'group-1' }),
    expect.objectContaining({ sourceSessionId: 'session-2', groupId: 'group-1' }),
  ]);
});

test('fails closed on invalid action parent topology', () => {
  const missingParent = structuredClone(SNAPSHOT);
  missingParent.payload.agenda[1].parent_id = 'missing-agenda';
  expect(() => buildCanvasOntologyReviewPlan(missingParent)).toThrow('Action parent references a missing agenda');

  const nonActionParent = structuredClone(SNAPSHOT);
  nonActionParent.payload.agenda[0].parent_id = 'action-1';
  expect(() => buildCanvasOntologyReviewPlan(nonActionParent)).toThrow('Non-action agenda must not have a parent');

  const selfParent = structuredClone(SNAPSHOT);
  selfParent.payload.agenda[1].parent_id = 'action-1';
  expect(() => buildCanvasOntologyReviewPlan(selfParent)).toThrow('Action agenda must not reference itself as parent');

  const archivedSelfParent = structuredClone(SNAPSHOT);
  archivedSelfParent.payload.agenda[1] = {
    ...archivedSelfParent.payload.agenda[1],
    status: 'archived',
    parent_id: 'action-1',
  };
  expect(() => buildCanvasOntologyReviewPlan(archivedSelfParent)).toThrow(
    'Action agenda must not reference itself as parent',
  );
});

test('rejects an empty active Canvas instead of producing an empty success plan', () => {
  const snapshot = structuredClone(SNAPSHOT);
  snapshot.payload.agenda = snapshot.payload.agenda.map((row) => ({ ...row, status: 'archived' }));
  snapshot.payload.agenda_link = [];

  expect(() => buildCanvasOntologyReviewPlan(snapshot)).toThrow('Canvas snapshot has no active agenda rows');
});

test('runs the local create, verify, and reviewed graph export CLI without database access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'canvas-ontology-bridge-'));
  try {
    const snapshotPath = join(directory, 'snapshot.json');
    const planPath = join(directory, 'review-plan.json');
    const seedPath = join(directory, 'review-seed.json');
    const graphPath = join(directory, 'reviewed-graph.json');
    const publicGraphPath = fileURLToPath(new URL(
      '../../public/__canvas_bridge_test_output__.json', import.meta.url,
    ));
    const publicPlanPath = fileURLToPath(new URL(
      '../../public/__canvas_bridge_test_plan__.json', import.meta.url,
    ));
    const publicSeedPath = fileURLToPath(new URL(
      '../../public/__canvas_bridge_test_seed__.json', import.meta.url,
    ));
    writeFileSync(snapshotPath, JSON.stringify(SNAPSHOT), 'utf8');
    const modulePath = fileURLToPath(new URL('../canvas-ontology-bridge.mjs', import.meta.url));

    const created = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--output-plan', planPath,
    ], { encoding: 'utf8', env: {} });
    expect(created.status).toBe(0);
    expect(created.stdout).toContain('2 nodes; 2 relations; database mutation: false; public graph written: false');

    const verified = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--verify-plan', planPath,
    ], { encoding: 'utf8', env: {} });
    expect(verified.status).toBe(0);
    expect(verified.stdout).toContain('Canvas ontology review plan verified');

    const seeded = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--seed-plan', planPath, '--output-seed', seedPath,
    ], { encoding: 'utf8', env: {} });
    expect(seeded.status).toBe(0);
    expect(seeded.stdout).toContain('5 review queue items; database mutation: false; approval required: true');
    expect(JSON.parse(readFileSync(seedPath, 'utf8'))).toMatchObject({
      kind: 'ontology-review-queue-seed-plan',
      counts: { node: 2, relation: 2, cluster: 1, total: 5 },
      databaseMutationExecuted: false,
      requiresApproval: true,
    });

    const verifiedSeed = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--seed-plan', planPath, '--verify-seed', seedPath,
    ], { encoding: 'utf8', env: {} });
    expect(verifiedSeed.status).toBe(0);
    expect(verifiedSeed.stdout).toContain('Ontology review queue seed verified (5 items; database mutation: false)');

    const tamperedSeedFile = JSON.parse(readFileSync(seedPath, 'utf8'));
    tamperedSeedFile.items[0].label = '변조된 seed 파일';
    writeFileSync(seedPath, JSON.stringify(tamperedSeedFile), 'utf8');
    const invalidSeed = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--seed-plan', planPath, '--verify-seed', seedPath,
    ], { encoding: 'utf8', env: {} });
    expect(invalidSeed.status).toBe(1);
    expect(invalidSeed.stderr).toContain('Ontology review queue seed checksum mismatch');

    const resealedDifferentSeed = JSON.parse(readFileSync(seedPath, 'utf8'));
    resealedDifferentSeed.items[0].label = '재서명했지만 source plan과 다른 seed';
    const { integrity: _seedIntegrity, ...unsignedDifferentSeed } = resealedDifferentSeed;
    resealedDifferentSeed.integrity.seedSha256 = createHash('sha256')
      .update(JSON.stringify(canonicalize(unsignedDifferentSeed)))
      .digest('hex');
    writeFileSync(seedPath, JSON.stringify(resealedDifferentSeed), 'utf8');
    const mismatchedSeed = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--seed-plan', planPath, '--verify-seed', seedPath,
    ], { encoding: 'utf8', env: {} });
    expect(mismatchedSeed.status).toBe(1);
    expect(mismatchedSeed.stderr).toContain('Ontology review queue seed does not match its source plan');

    const restoredSeed = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--seed-plan', planPath, '--output-seed', seedPath, '--force',
    ], { encoding: 'utf8', env: {} });
    expect(restoredSeed.status).toBe(0);

    const tamperedPlan = JSON.parse(readFileSync(planPath, 'utf8'));
    tamperedPlan.nodes[0].label = '검수 계획 변조값';
    writeFileSync(planPath, JSON.stringify(tamperedPlan), 'utf8');
    const tamperedSeedPath = join(directory, 'tampered-seed.json');
    const tamperedSeed = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--seed-plan', planPath, '--output-seed', tamperedSeedPath,
    ], { encoding: 'utf8', env: {} });
    expect(tamperedSeed.status).toBe(1);
    expect(tamperedSeed.stderr).toContain('Canvas ontology review plan checksum mismatch');
    expect(existsSync(tamperedSeedPath)).toBe(false);
    writeFileSync(planPath, JSON.stringify(sealCanvasOntologyReviewPlan({
      plan: buildCanvasOntologyReviewPlan(SNAPSHOT),
      snapshotSource: JSON.stringify(SNAPSHOT),
    })), 'utf8');

    const reviewedPlan = JSON.parse(readFileSync(planPath, 'utf8'));
    const reviewedAt = '2026-08-29T01:00:00.000Z';
    reviewedPlan.nodes[0] = { ...reviewedPlan.nodes[0], kind: 'Issue', reviewStatus: 'accepted', reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt };
    reviewedPlan.nodes[1] = { ...reviewedPlan.nodes[1], kind: 'Proposal', reviewStatus: 'accepted', reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt };
    reviewedPlan.relations = reviewedPlan.relations.map((relation, index) => ({
      ...relation,
      relation: index === 0 ? 'supports' : 'implements',
      reviewStatus: 'accepted',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt,
    }));
    reviewedPlan.clusters[0] = {
      ...reviewedPlan.clusters[0], reviewStatus: 'accepted', issueNodeId: reviewedPlan.nodes[0].id,
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt,
    };
    writeFileSync(planPath, JSON.stringify(reviewedPlan), 'utf8');

    const exported = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--reviewed-plan', planPath, '--output-graph', graphPath,
    ], { encoding: 'utf8', env: {} });
    expect(exported.status).toBe(0);
    expect(exported.stdout).toContain('2 nodes; 2 edges; database mutation: false; public graph written: false');
    expect(JSON.parse(readFileSync(graphPath, 'utf8')).meta.publication_status).toBe('internal_reviewed_export');

    const publicOutput = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--reviewed-plan', planPath, '--output-graph', publicGraphPath,
    ], { encoding: 'utf8', env: {} });
    expect(publicOutput.status).toBe(1);
    expect(publicOutput.stderr).toContain('must stay outside the repository public directory');
    expect(existsSync(publicGraphPath)).toBe(false);

    const publicPlanOutput = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--output-plan', publicPlanPath,
    ], { encoding: 'utf8', env: {} });
    expect(publicPlanOutput.status).toBe(1);
    expect(publicPlanOutput.stderr).toContain('must stay outside the repository public directory');
    expect(existsSync(publicPlanPath)).toBe(false);

    const publicSeedOutput = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--seed-plan', planPath, '--output-seed', publicSeedPath,
    ], { encoding: 'utf8', env: {} });
    expect(publicSeedOutput.status).toBe(1);
    expect(publicSeedOutput.stderr).toContain('must stay outside the repository public directory');
    expect(existsSync(publicSeedPath)).toBe(false);

    const overwrite = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--output-plan', planPath,
    ], { encoding: 'utf8', env: {} });
    expect(overwrite.status).toBe(1);
    expect(overwrite.stderr).toContain('Output already exists; use --force to replace it');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);

test('does not echo malformed participant content through the CLI error channel', () => {
  const directory = mkdtempSync(join(tmpdir(), 'canvas-ontology-private-error-'));
  try {
    const snapshotPath = join(directory, 'snapshot.json');
    const planPath = join(directory, 'plan.json');
    const privateText = 'private-participant-content-must-not-echo';
    writeFileSync(snapshotPath, JSON.stringify({
      ...SNAPSHOT,
      payload: {
        agenda: [{ ...SNAPSHOT.payload.agenda[0], status: privateText }],
        agenda_link: [],
      },
    }), 'utf8');
    const modulePath = fileURLToPath(new URL('../canvas-ontology-bridge.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [
      modulePath, '--snapshot', snapshotPath, '--output-plan', planPath,
    ], { encoding: 'utf8', env: {} });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid agenda status');
    expect(result.stderr).not.toContain(privateText);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
