import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createTranscriptOntologyReviewWorkspace,
  exportTranscriptOntologyReviewedPlan,
  reviewTranscriptOntologyCandidate,
  updateTranscriptOntologyCandidateDraft,
} from './transcript-ontology-review-workspace';

const fixtureText = readFileSync('automation/fixtures/transcript-ontology-review-candidates.example.json', 'utf8');
const fixture = JSON.parse(fixtureText) as Record<string, unknown>;

function decisionAt(minutes: number) {
  return `2026-08-01T02:${String(minutes).padStart(2, '0')}:00.000Z`;
}

describe('transcript ontology review workspace', () => {
  it('opens candidate nodes and relations with their cited transcript text and Habermas role', async () => {
    const workspace = await createTranscriptOntologyReviewWorkspace(fixtureText);

    expect(workspace.summary).toEqual({ nodes: 2, relations: 1, decided: 0, total: 3 });
    expect(workspace.nodes[0]).toMatchObject({
      id: 'transcript-node:candidate-issue',
      sourceUid: 'candidate-issue',
      kindCandidate: 'Issue',
      reviewStatus: 'proposed',
      citedUids: ['chunk-001', 'chunk-002'],
      transcript: [
        { uid: 'chunk-001', text: '재생에너지 전환 속도를 높여야 합니다.' },
        { uid: 'chunk-002', text: '지역별 전력망 여건도 함께 살펴야 합니다.' },
      ],
    });
    expect(workspace.relations[0]).toMatchObject({
      id: 'transcript-edge:candidate-relation-1',
      source: 'transcript-node:candidate-claim',
      target: 'transcript-node:candidate-issue',
      relationCandidate: 'isAbout',
      reviewStatus: 'proposed',
      transcript: [{ uid: 'chunk-001', text: '재생에너지 전환 속도를 높여야 합니다.' }],
    });
    expect(workspace.safety).toEqual({
      localOnly: true,
      databaseMutationExecuted: false,
      publicGraphWritten: false,
      requiresHumanReview: true,
    });
  });

  it('keeps accept edit and reject decisions local and exports only a completed private review plan', async () => {
    let workspace = await createTranscriptOntologyReviewWorkspace(fixtureText);
    await expect(exportTranscriptOntologyReviewedPlan(workspace)).rejects.toThrow('Transcript ontology review is incomplete');

    workspace = reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'node',
      id: 'transcript-node:candidate-issue',
      status: 'edited',
      kind: 'Issue',
      label: '재생에너지 전환의 속도와 조건',
      text: '전환 속도와 지역 전력망 조건을 함께 검토한다.',
      reviewer: 'moderator-role-1',
      reviewedAt: '2026-08-01T02:00:00.000Z',
    });
    workspace = reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'node',
      id: 'transcript-node:candidate-claim',
      status: 'rejected',
      reviewer: 'moderator-role-1',
      reviewedAt: '2026-08-01T02:01:00.000Z',
    });
    workspace = reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'relation',
      id: 'transcript-edge:candidate-relation-1',
      status: 'rejected',
      reviewer: 'moderator-role-1',
      reviewedAt: '2026-08-01T02:02:00.000Z',
    });

    expect(workspace.summary.decided).toBe(3);
    const plan = JSON.parse(await exportTranscriptOntologyReviewedPlan(workspace)) as Record<string, unknown>;
    expect(plan).toMatchObject({
      schemaVersion: 1,
      kind: 'transcript-ontology-reviewed-plan',
      dryRun: true,
      databaseMutationExecuted: false,
      publicGraphWritten: false,
      requiresPublicationReview: true,
      nodes: [
        {
          id: 'transcript-node:candidate-issue',
          reviewStatus: 'edited',
          kind: 'Issue',
          label: '재생에너지 전환의 속도와 조건',
          citedUids: ['chunk-001', 'chunk-002'],
        },
        {
          id: 'transcript-node:candidate-claim',
          reviewStatus: 'rejected',
          kind: null,
        },
      ],
      relations: [{
        id: 'transcript-edge:candidate-relation-1',
        reviewStatus: 'rejected',
        relation: null,
      }],
    });

    const tampered = structuredClone(workspace);
    tampered.source.fixtureSha256 = '0'.repeat(64);
    await expect(exportTranscriptOntologyReviewedPlan(tampered))
      .rejects.toThrow('Transcript ontology review workspace integrity check failed');

    const invalidStatus = structuredClone(workspace);
    (invalidStatus.nodes[0] as { reviewStatus: string }).reviewStatus = 'approved';
    await expect(exportTranscriptOntologyReviewedPlan(invalidStatus))
      .rejects.toThrow('Invalid transcript ontology review status');

    workspace = updateTranscriptOntologyCandidateDraft(workspace, {
      itemType: 'node', id: 'transcript-node:candidate-issue', label: '판단 뒤 다시 수정한 표시 이름',
    });
    expect(workspace.summary.decided).toBe(2);
    expect(workspace.nodes[0]).toMatchObject({
      reviewStatus: 'proposed', reviewer: null, reviewedAt: null,
      kind: 'Issue', label: '판단 뒤 다시 수정한 표시 이름',
    });
    await expect(exportTranscriptOntologyReviewedPlan(workspace)).rejects.toThrow('Transcript ontology review is incomplete');

    const forgedSummary = await createTranscriptOntologyReviewWorkspace(fixtureText);
    forgedSummary.summary.decided = forgedSummary.summary.total;
    await expect(exportTranscriptOntologyReviewedPlan(forgedSummary))
      .rejects.toThrow('Transcript ontology review is incomplete');
  });

  it('enforces relation endpoint decisions in either review order', async () => {
    let workspace = await createTranscriptOntologyReviewWorkspace(fixtureText);
    for (const [index, node] of workspace.nodes.entries()) {
      workspace = reviewTranscriptOntologyCandidate(workspace, {
        itemType: 'node', id: node.id, status: 'accepted', kind: node.kindCandidate,
        label: node.sourceLabel, text: node.sourceText, reviewer: 'moderator-role-1',
        reviewedAt: decisionAt(index),
      });
    }
    workspace = reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'relation', id: workspace.relations[0].id, status: 'accepted',
      relation: workspace.relations[0].relationCandidate, reviewer: 'moderator-role-1',
      reviewedAt: decisionAt(2),
    });
    expect(() => reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'node', id: workspace.nodes[0].id, status: 'rejected',
      reviewer: 'moderator-role-1', reviewedAt: decisionAt(3),
    })).toThrow('Reject dependent reviewed relations before rejecting this node');

    let rejectedEndpoint = await createTranscriptOntologyReviewWorkspace(fixtureText);
    rejectedEndpoint = reviewTranscriptOntologyCandidate(rejectedEndpoint, {
      itemType: 'node', id: rejectedEndpoint.nodes[0].id, status: 'rejected',
      reviewer: 'moderator-role-1', reviewedAt: decisionAt(4),
    });
    expect(() => reviewTranscriptOntologyCandidate(rejectedEndpoint, {
      itemType: 'relation', id: rejectedEndpoint.relations[0].id, status: 'edited',
      relation: 'supports', reviewer: 'moderator-role-1', reviewedAt: decisionAt(5),
    })).toThrow('Reviewed relation requires non-rejected endpoint nodes');
  });

  it('rejects non-synthetic fixture provenance before opening the workspace', async () => {
    const identifyingReviewer = structuredClone(fixture);
    identifyingReviewer.reviewedBy = 'person-name';
    await expect(createTranscriptOntologyReviewWorkspace(JSON.stringify(identifyingReviewer)))
      .rejects.toThrow('Invalid fixture reviewer alias');

    const invalidLanguage = structuredClone(fixture);
    invalidLanguage.language = '한국어';
    await expect(createTranscriptOntologyReviewWorkspace(JSON.stringify(invalidLanguage)))
      .rejects.toThrow('Invalid fixture language');
  });
});
