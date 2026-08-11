import { describe, expect, it } from 'vitest';
import {
  canvasFacilitationPrompts,
  createCanvasOntologyReviewWorkspace,
  exportCanvasOntologyReviewedPlan,
  reviewCanvasOntologyItem,
} from './ontology-review-workspace';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function reseal(plan: Record<string, unknown>): Promise<string> {
  const integrity = plan.integrity as Record<string, unknown>;
  const { planSha256: _planSha256, ...integrityWithoutPlanHash } = integrity;
  const unsigned = { ...plan, integrity: integrityWithoutPlanHash };
  return JSON.stringify({
    ...plan,
    integrity: {
      ...integrityWithoutPlanHash,
      planSha256: await sha256(JSON.stringify(canonicalize(unsigned))),
    },
  });
}

async function fixture() {
  const snapshot = {
    id: 42,
    source: 'cron',
    taken_at: '2026-08-29T00:00:00.000Z',
    payload: {
      agenda: [
        {
          id: 'agenda-1', session_id: 'session-1', text: '지역 에너지 자립을 논의한다.',
          status: 'active', kind: 'agenda', group_id: 'group-1', parent_id: null,
        },
        {
          id: 'action-1', session_id: 'session-1', text: '공공건물 태양광을 확대한다.',
          status: 'active', kind: 'action', group_id: 'group-1', parent_id: 'agenda-1',
        },
      ],
      agenda_link: [
        { id: 'link-1', session_id: 'session-1', source_id: 'agenda-1', target_id: 'action-1' },
      ],
    },
  };
  const snapshotText = JSON.stringify(snapshot);
  const unsignedPlan = {
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
        id: 'canvas-agenda:agenda-1', sourceAgendaId: 'agenda-1', sourceSessionId: 'session-1',
        label: '지역 에너지 자립을 논의한다.', text: '지역 에너지 자립을 논의한다.',
        sourceText: '지역 에너지 자립을 논의한다.', groupId: 'group-1', parentAgendaId: null,
        sourceKind: 'agenda', kind: null,
        kindCandidates: ['Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence'],
        reviewStatus: 'proposed', reviewer: null, reviewedAt: null,
      },
      {
        id: 'canvas-agenda:action-1', sourceAgendaId: 'action-1', sourceSessionId: 'session-1',
        label: '공공건물 태양광을 확대한다.', text: '공공건물 태양광을 확대한다.',
        sourceText: '공공건물 태양광을 확대한다.', groupId: 'group-1', parentAgendaId: 'agenda-1',
        sourceKind: 'action', kind: null,
        kindCandidates: ['Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence'],
        reviewStatus: 'proposed', reviewer: null, reviewedAt: null,
      },
    ],
    relations: [
      {
        id: 'canvas-link:link-1', source: 'canvas-agenda:agenda-1', target: 'canvas-agenda:action-1',
        sourceType: 'agenda_link', sourceLinkId: 'link-1', relation: null,
        relationCandidates: ['supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
          'modifies', 'isAbout', 'raisesIssue', 'implements'],
        reviewStatus: 'proposed', reviewer: null, reviewedAt: null,
      },
      {
        id: 'canvas-parent:action-1', source: 'canvas-agenda:agenda-1', target: 'canvas-agenda:action-1',
        sourceType: 'action_parent', sourceLinkId: null, relation: null,
        relationCandidates: ['supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
          'modifies', 'isAbout', 'raisesIssue', 'implements'],
        reviewStatus: 'proposed', reviewer: null, reviewedAt: null,
      },
    ],
    clusters: [
      {
        sourceSessionId: 'session-1', groupId: 'group-1',
        memberNodeIds: ['canvas-agenda:agenda-1', 'canvas-agenda:action-1'],
        reviewStatus: 'proposed', issueNodeId: null, reviewer: null, reviewedAt: null,
      },
    ],
    excluded: { agendas: [], relations: [] },
  };
  const integrityWithoutPlanHash = {
    kind: 'self-checksum',
    algorithm: 'sha256',
    snapshotSha256: await sha256(snapshotText),
  };
  const planSha256 = await sha256(JSON.stringify(canonicalize({
    ...unsignedPlan,
    integrity: integrityWithoutPlanHash,
  })));
  const planText = JSON.stringify({
    ...unsignedPlan,
    integrity: { ...integrityWithoutPlanHash, planSha256 },
  });
  return { planText, snapshotText };
}

describe('Canvas ontology review workspace', () => {
  it('derives advisory questions only from reviewed nodes without required support', async () => {
    const workspace = await createCanvasOntologyReviewWorkspace(await fixture());
    const reviewedAt = '2026-08-29T01:00:00.000Z';
    const reviewer = 'moderator-role-1';
    let reviewed = reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'accepted', kind: 'Claim', reviewer, reviewedAt,
    });
    reviewed = reviewCanvasOntologyItem(reviewed, {
      itemType: 'node', id: 'canvas-agenda:action-1', status: 'accepted', kind: 'Proposal', reviewer, reviewedAt,
    });
    reviewed.plan.nodes.push({
      ...reviewed.plan.nodes[0],
      id: 'canvas-agenda:concern-1',
      sourceAgendaId: 'concern-1',
      sourceText: '비용 부담이 커질 수 있다.',
      label: '비용 부담',
      text: '비용 부담이 커질 수 있다.',
      kind: 'Concern',
    });

    expect(canvasFacilitationPrompts(reviewed)).toEqual([
      expect.objectContaining({ kind: 'missing-evidence', nodeId: 'canvas-agenda:agenda-1' }),
      expect.objectContaining({ kind: 'missing-condition', nodeId: 'canvas-agenda:action-1' }),
      expect.objectContaining({ kind: 'isolated-concern', nodeId: 'canvas-agenda:concern-1' }),
    ]);
    expect(canvasFacilitationPrompts(workspace)).toEqual([]);
  });

  it('removes prompts only when accepted reviewed support is connected', async () => {
    const workspace = await createCanvasOntologyReviewWorkspace(await fixture());
    const reviewedAt = '2026-08-29T01:00:00.000Z';
    const reviewer = 'moderator-role-1';
    let reviewed = reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'accepted', kind: 'Claim', reviewer, reviewedAt,
    });
    reviewed = reviewCanvasOntologyItem(reviewed, {
      itemType: 'node', id: 'canvas-agenda:action-1', status: 'accepted', kind: 'Proposal', reviewer, reviewedAt,
    });
    reviewed.plan.nodes.push(
      {
        ...reviewed.plan.nodes[0], id: 'canvas-agenda:evidence-1', sourceAgendaId: 'evidence-1',
        sourceText: '전환 사례 자료', label: '전환 사례 자료', text: '전환 사례 자료', kind: 'Evidence',
      },
      {
        ...reviewed.plan.nodes[0], id: 'canvas-agenda:condition-1', sourceAgendaId: 'condition-1',
        sourceText: '예산 확보', label: '예산 확보', text: '예산 확보', kind: 'Condition',
      },
    );
    reviewed.plan.relations.push(
      {
        ...reviewed.plan.relations[0], id: 'relation:evidence',
        source: 'canvas-agenda:evidence-1', target: 'canvas-agenda:agenda-1', relation: 'hasEvidence',
        reviewStatus: 'accepted', reviewer, reviewedAt,
      },
      {
        ...reviewed.plan.relations[0], id: 'relation:condition',
        source: 'canvas-agenda:action-1', target: 'canvas-agenda:condition-1', relation: 'requiresCondition',
        reviewStatus: 'rejected', reviewer, reviewedAt,
      },
    );

    expect(canvasFacilitationPrompts(reviewed).map((prompt) => prompt.kind)).toEqual(['missing-condition']);
    reviewed.plan.relations[reviewed.plan.relations.length - 1].reviewStatus = 'accepted';
    expect(canvasFacilitationPrompts(reviewed)).toEqual([]);

    reviewed.plan.nodes.push(
      {
        ...reviewed.plan.nodes[0], id: 'canvas-agenda:concern-1', sourceAgendaId: 'concern-1',
        sourceText: '비용 부담 우려', label: '비용 부담 우려', text: '비용 부담 우려', kind: 'Concern',
      },
      {
        ...reviewed.plan.nodes[0], id: 'canvas-agenda:issue-1', sourceAgendaId: 'issue-1',
        sourceText: '비용 쟁점', label: '비용 쟁점', text: '비용 쟁점', kind: 'Issue',
      },
    );
    reviewed.plan.relations.push({
      ...reviewed.plan.relations[0], id: 'relation:concern-evidence',
      source: 'canvas-agenda:concern-1', target: 'canvas-agenda:evidence-1', relation: 'hasEvidence',
      reviewStatus: 'accepted', reviewer, reviewedAt,
    });
    expect(canvasFacilitationPrompts(reviewed).map((prompt) => prompt.kind)).toEqual(['isolated-concern']);
    reviewed.plan.relations.push({
      ...reviewed.plan.relations[0], id: 'relation:concern-issue',
      source: 'canvas-agenda:issue-1', target: 'canvas-agenda:concern-1', relation: 'hasConcern',
      reviewStatus: 'accepted', reviewer, reviewedAt,
    });
    expect(canvasFacilitationPrompts(reviewed)).toEqual([]);
  });

  it('opens only a sealed plan that matches the exact Canvas snapshot bytes', async () => {
    const input = await fixture();
    const workspace = await createCanvasOntologyReviewWorkspace(input);

    expect(workspace.summary).toEqual({ nodes: 2, relations: 2, clusters: 1, decided: 0, total: 5 });
    expect(workspace.source).toMatchObject({ snapshotId: 42, sessionIds: ['session-1'] });

    await expect(createCanvasOntologyReviewWorkspace({
      ...input,
      snapshotText: `${input.snapshotText}\n`,
    })).rejects.toThrow('Canvas snapshot does not match the sealed review plan');
  });

  it('rejects checksum tampering and malformed JSON without echoing source content', async () => {
    const input = await fixture();
    const tampered = JSON.parse(input.planText) as { nodes: Array<{ label: string }> };
    tampered.nodes[0].label = 'tampered-label';

    await expect(createCanvasOntologyReviewWorkspace({
      ...input,
      planText: JSON.stringify(tampered),
    })).rejects.toThrow('Canvas ontology review plan checksum mismatch');

    const secret = 'private-participant-content';
    await expect(createCanvasOntologyReviewWorkspace({
      planText: `{${secret}`,
      snapshotText: input.snapshotText,
    })).rejects.not.toThrow(secret);
  });

  it('rejects a resealed plan whose relations or review state do not match the snapshot', async () => {
    const input = await fixture();
    const forgedRelation = JSON.parse(input.planText) as Record<string, unknown> & {
      relations: Array<{ source: string; target: string }>;
    };
    [forgedRelation.relations[0].source, forgedRelation.relations[0].target] = [
      forgedRelation.relations[0].target,
      forgedRelation.relations[0].source,
    ];
    await expect(createCanvasOntologyReviewWorkspace({
      ...input,
      planText: await reseal(forgedRelation),
    })).rejects.toThrow('Canvas ontology review plan does not match its snapshot input');

    const preDecided = JSON.parse(input.planText) as Record<string, unknown> & {
      nodes: Array<{ reviewStatus: string; reviewer: string | null; reviewedAt: string | null }>;
    };
    preDecided.nodes[0].reviewStatus = 'accepted';
    preDecided.nodes[0].reviewer = 'forged-reviewer';
    preDecided.nodes[0].reviewedAt = '2026-08-29T01:00:00.000Z';
    await expect(createCanvasOntologyReviewWorkspace({
      ...input,
      planText: await reseal(preDecided),
    })).rejects.toThrow('Canvas ontology review plan must start with proposed items');
  });

  it('rejects accepted edits and non-canonical review timestamps', async () => {
    const workspace = await createCanvasOntologyReviewWorkspace(await fixture());
    expect(() => reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'accepted', kind: 'Issue',
      text: '변경된 내용', reviewer: 'moderator-role-1', reviewedAt: '2026-08-29T01:00:00.000Z',
    })).toThrow('Edited Canvas ontology content requires edited review status');
    expect(() => reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'accepted', kind: 'Issue',
      reviewer: 'moderator-role-1', reviewedAt: '2026-08-29 10:00:00',
    })).toThrow('Invalid review timestamp');
    expect(() => reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'accepted', kind: 'Issue',
      reviewer: '010-1234-5678', reviewedAt: '2026-08-29T01:00:00.000Z',
    })).toThrow('Reviewer alias format is invalid');
  });

  it('requires explicit human decisions and preserves edited node semantics', async () => {
    let workspace = await createCanvasOntologyReviewWorkspace(await fixture());
    const reviewedAt = '2026-08-29T01:00:00.000Z';
    const reviewer = 'moderator-role-1';

    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'edited', kind: 'Issue',
      label: '지역 에너지 자립 조건', text: '지역 에너지 자립의 조건을 논의한다.', reviewer, reviewedAt,
    });
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:action-1', status: 'accepted', kind: 'Proposal', reviewer, reviewedAt,
    });
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'relation', id: 'canvas-link:link-1', status: 'accepted', relation: 'supports', reviewer, reviewedAt,
    });
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'relation', id: 'canvas-parent:action-1', status: 'accepted', relation: 'implements', reviewer, reviewedAt,
    });
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'cluster', id: 'session-1\u0000group-1', status: 'accepted',
      issueNodeId: 'canvas-agenda:agenda-1', reviewer, reviewedAt,
    });

    expect(workspace.summary.decided).toBe(5);
    const exported = JSON.parse(exportCanvasOntologyReviewedPlan(workspace)) as {
      nodes: Array<{ id: string; reviewStatus: string; sourceText: string; text: string }>;
      publicGraphWritten: boolean;
    };
    expect(exported.publicGraphWritten).toBe(false);
    expect(exported.nodes[0]).toMatchObject({
      id: 'canvas-agenda:agenda-1', reviewStatus: 'edited',
      sourceText: '지역 에너지 자립을 논의한다.', text: '지역 에너지 자립의 조건을 논의한다.',
    });
  });

  it('fails closed before accepting relations or clusters whose dependencies are not accepted', async () => {
    let workspace = await createCanvasOntologyReviewWorkspace(await fixture());
    expect(() => exportCanvasOntologyReviewedPlan(workspace)).toThrow('Canvas ontology review is incomplete');

    const reviewedAt = '2026-08-29T01:00:00.000Z';
    const reviewer = 'moderator-role-1';
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'rejected', reviewer, reviewedAt,
    });
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:action-1', status: 'accepted', kind: 'Proposal', reviewer, reviewedAt,
    });
    expect(() => reviewCanvasOntologyItem(workspace, {
      itemType: 'relation', id: 'canvas-link:link-1', status: 'accepted', relation: 'supports', reviewer, reviewedAt,
    })).toThrow('Accepted relation requires accepted endpoint nodes');

    expect(() => reviewCanvasOntologyItem(workspace, {
      itemType: 'cluster', id: 'session-1\u0000group-1', status: 'accepted',
      issueNodeId: 'canvas-agenda:action-1', reviewer, reviewedAt,
    })).toThrow('Accepted cluster requires an accepted member Issue node');
  });

  it('requires accepted dependencies to be rejected before changing their node', async () => {
    let workspace = await createCanvasOntologyReviewWorkspace(await fixture());
    const reviewedAt = '2026-08-29T01:00:00.000Z';
    const reviewer = 'moderator-role-1';
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'accepted', kind: 'Issue', reviewer, reviewedAt,
    });
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:action-1', status: 'accepted', kind: 'Proposal', reviewer, reviewedAt,
    });
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'relation', id: 'canvas-link:link-1', status: 'accepted', relation: 'supports', reviewer, reviewedAt,
    });
    workspace = reviewCanvasOntologyItem(workspace, {
      itemType: 'cluster', id: 'session-1\u0000group-1', status: 'accepted',
      issueNodeId: 'canvas-agenda:agenda-1', reviewer, reviewedAt,
    });

    expect(() => reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:action-1', status: 'rejected', reviewer, reviewedAt,
    })).toThrow('Reject dependent relations before rejecting their endpoint node');
    expect(() => reviewCanvasOntologyItem(workspace, {
      itemType: 'node', id: 'canvas-agenda:agenda-1', status: 'accepted', kind: 'Proposal', reviewer, reviewedAt,
    })).toThrow('Reject the dependent cluster before changing its representative Issue node');
  });
});
