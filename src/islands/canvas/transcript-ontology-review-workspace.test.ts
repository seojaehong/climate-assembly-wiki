import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildTranscriptOntologyPublicationApproval,
  buildPrivateTranscriptOntologyFixture,
  createTranscriptOntologyReviewWorkspace,
  exportTranscriptOntologyReviewedPlan,
  reviewTranscriptOntologyCandidate,
  updateTranscriptOntologyCandidateDraft,
} from './transcript-ontology-review-workspace';

const fixtureText = readFileSync('automation/fixtures/transcript-ontology-review-candidates.example.json', 'utf8');
const fixture = JSON.parse(fixtureText) as Record<string, unknown>;

const privateReviewBatchText = () => `${JSON.stringify({
  schemaVersion: 2,
  kind: 'private-transcript-review-batch',
  source: {
    captureId: 'capture-r4-handoff',
    sessionId: 'session-r4-handoff',
    roomId: 'table-a',
    language: 'ko-KR',
    captureMethod: 'table-recorder-file',
    audioSha256: 'a'.repeat(64),
    mimeType: 'audio/webm',
    byteLength: 128,
    startedAt: '2026-08-29T01:00:00.000Z',
    stoppedAt: '2026-08-29T01:00:04.000Z',
    durationMs: 4_000,
    storage: 'browser-memory',
  },
  chunks: [{
    uid: 'capture-r4-handoff:chunk:1',
    candidateSetId: 'stt-set-1',
    candidateSourceUid: 'stt-source-1',
    startMs: 0,
    endMs: 4_000,
    speakerLabelPseudonym: 'speaker-unknown',
    sourceText: '전환 속도를 높여야 합니다.',
    text: '전환 속도를 높여야 합니다.',
    reviewStatus: 'accepted',
    reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
    reviewedAt: '2026-08-29T01:05:00.000Z',
  }],
  summary: { included: 1, rejected: 0, total: 1 },
  safety: {
    localOnly: true,
    audioIncluded: false,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
    extractionExecuted: false,
    requiresExtractionReview: true,
  },
}, null, 2)}\n`;

const privateCandidatesText = (reviewBatchText: string, reviewBatchSha256 = createHash('sha256')
  .update(reviewBatchText, 'utf8').digest('hex')) => `${JSON.stringify({
  schemaVersion: 1,
  kind: 'private-transcript-ontology-candidates',
  candidateSetId: 'ontology-candidates-r4-1',
  source: {
    reviewBatchSha256,
    captureId: 'capture-r4-handoff',
    sessionId: 'session-r4-handoff',
    audioSha256: 'a'.repeat(64),
  },
  language: 'ko-KR',
  nodes: [{
    uid: 'candidate-r4-issue',
    kind: 'Issue',
    label: '전환 속도',
    text: '전환 속도를 논의한다.',
    citedUids: ['capture-r4-handoff:chunk:1'],
  }],
  relations: [],
  safety: {
    localOnly: true,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
    requiresHumanReview: true,
  },
}, null, 2)}\n`;

function decisionAt(minutes: number) {
  return `2026-08-01T02:${String(minutes).padStart(2, '0')}:00.000Z`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

async function completedWorkspace() {
  let workspace = await createTranscriptOntologyReviewWorkspace(fixtureText);
  for (const [index, node] of workspace.nodes.entries()) {
    workspace = reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'node', id: node.id, status: 'accepted', kind: node.kindCandidate,
      label: node.sourceLabel, text: node.sourceText,
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt: decisionAt(index),
    });
  }
  workspace = reviewTranscriptOntologyCandidate(workspace, {
    itemType: 'relation', id: workspace.relations[0].id, status: 'accepted',
    relation: workspace.relations[0].relationCandidate,
    reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt: decisionAt(2),
  });
  return workspace;
}

describe('transcript ontology review workspace', () => {
  it('binds a reviewed R4 batch to provider-neutral candidates and preserves chunk audit provenance', async () => {
    const batchText = privateReviewBatchText();
    const generatedFixtureText = await buildPrivateTranscriptOntologyFixture({
      reviewBatchText: batchText,
      extractionCandidatesText: privateCandidatesText(batchText),
    });
    const generatedFixture = JSON.parse(generatedFixtureText) as Record<string, unknown>;
    const workspace = await createTranscriptOntologyReviewWorkspace(generatedFixtureText);

    expect(generatedFixture).toMatchObject({
      fixtureId: 'ontology-candidates-r4-1',
      sessionId: 'session-r4-handoff',
      reviewedBy: 'auth-user:00000000-0000-4000-8000-000000000091',
      source: {
        kind: 'private-transcript-extraction-handoff',
        reviewBatchSha256: createHash('sha256').update(batchText, 'utf8').digest('hex'),
        captureId: 'capture-r4-handoff',
        roomId: 'table-a',
        language: 'ko-KR',
        captureMethod: 'table-recorder-file',
      },
    });
    expect(workspace.source.handoff).toMatchObject({
      candidateSetId: 'ontology-candidates-r4-1',
      audioSha256: 'a'.repeat(64),
    });
    expect(workspace.nodes[0].transcript[0]).toMatchObject({
      uid: 'capture-r4-handoff:chunk:1',
      speakerLabelPseudonym: 'speaker-unknown',
      text: '전환 속도를 높여야 합니다.',
      sourceReview: {
        reviewStatus: 'accepted',
        reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
        candidateSetId: 'stt-set-1',
        candidateSourceUid: 'stt-source-1',
      },
    });
  });

  it('rejects extraction candidates when the reviewed batch bytes or source binding changes', async () => {
    const batchText = privateReviewBatchText();
    await expect(buildPrivateTranscriptOntologyFixture({
      reviewBatchText: `${batchText.trimEnd()} `,
      extractionCandidatesText: privateCandidatesText(batchText),
    })).rejects.toThrow('Extraction candidates do not match the reviewed transcript batch');

    const wrongSource = JSON.parse(privateCandidatesText(batchText)) as Record<string, unknown>;
    (wrongSource.source as Record<string, unknown>).audioSha256 = 'b'.repeat(64);
    await expect(buildPrivateTranscriptOntologyFixture({
      reviewBatchText: batchText,
      extractionCandidatesText: JSON.stringify(wrongSource),
    })).rejects.toThrow('Extraction candidates do not match the reviewed transcript batch');

    const wrongLanguage = JSON.parse(privateCandidatesText(batchText)) as Record<string, unknown>;
    wrongLanguage.language = 'en-US';
    await expect(buildPrivateTranscriptOntologyFixture({
      reviewBatchText: batchText,
      extractionCandidatesText: JSON.stringify(wrongLanguage),
    })).rejects.toThrow('Extraction candidate language does not match the reviewed transcript batch');
  });

  it('rejects a forged handoff fixture whose source review no longer matches its audit', async () => {
    const batchText = privateReviewBatchText();
    const generatedFixture = JSON.parse(await buildPrivateTranscriptOntologyFixture({
      reviewBatchText: batchText,
      extractionCandidatesText: privateCandidatesText(batchText),
    })) as Record<string, unknown>;
    const chunks = generatedFixture.chunks as Array<Record<string, unknown>>;
    const sourceReview = chunks[0].sourceReview as Record<string, unknown>;
    sourceReview.reviewStatus = 'edited';

    await expect(createTranscriptOntologyReviewWorkspace(JSON.stringify(generatedFixture)))
      .rejects.toThrow('Transcript source review does not match the fixture audit');
  });

  it('rejects a private handoff whose language differs from the fixture', async () => {
    const batchText = privateReviewBatchText();
    const generatedFixture = JSON.parse(await buildPrivateTranscriptOntologyFixture({
      reviewBatchText: batchText,
      extractionCandidatesText: privateCandidatesText(batchText),
    })) as Record<string, unknown>;
    generatedFixture.language = 'en-US';

    await expect(createTranscriptOntologyReviewWorkspace(JSON.stringify(generatedFixture)))
      .rejects.toThrow('Transcript extraction handoff language does not match fixture');
  });

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
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-01T02:00:00.000Z',
    });
    workspace = reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'node',
      id: 'transcript-node:candidate-claim',
      status: 'rejected',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-01T02:01:00.000Z',
    });
    workspace = reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'relation',
      id: 'transcript-edge:candidate-relation-1',
      status: 'rejected',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
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

  it('rejects a free-form reviewer alias before applying a transcript decision', async () => {
    const workspace = await createTranscriptOntologyReviewWorkspace(fixtureText);

    expect(() => reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'node', id: workspace.nodes[0].id, status: 'accepted',
      kind: workspace.nodes[0].kindCandidate, label: workspace.nodes[0].sourceLabel,
      text: workspace.nodes[0].sourceText, reviewer: 'moderator-role-1', reviewedAt: decisionAt(0),
    })).toThrow('Invalid authenticated reviewer id');
  });

  it('binds a completed reviewed plan to an authenticated local publication approval artifact', async () => {
    const reviewedPlanText = await exportTranscriptOntologyReviewedPlan(await completedWorkspace());
    const reviewedPlan = JSON.parse(reviewedPlanText) as unknown;
    const approval = JSON.parse(await buildTranscriptOntologyPublicationApproval({
      reviewedPlanText,
      sourceId: 'live-browser-reviewed',
      approvedBy: 'auth-user:00000000-0000-4000-8000-000000000091',
      approvedAt: decisionAt(3),
    })) as Record<string, unknown>;
    const expectedSha256 = createHash('sha256')
      .update(JSON.stringify(canonicalize(reviewedPlan)), 'utf8')
      .digest('hex');

    expect(approval).toEqual({
      schemaVersion: 1,
      kind: 'transcript-ontology-publication-approval',
      mode: 'synthetic-reviewed-demo',
      sourceId: 'live-browser-reviewed',
      reviewedPlanSha256: expectedSha256,
      approvedBy: 'auth-user:00000000-0000-4000-8000-000000000091',
      approvedAt: decisionAt(3),
    });
  });

  it('rejects incomplete, unauthenticated, invalid-source, and premature publication approvals', async () => {
    const incompletePlan = await createTranscriptOntologyReviewWorkspace(fixtureText);
    await expect(buildTranscriptOntologyPublicationApproval({
      reviewedPlanText: JSON.stringify({
        schemaVersion: 1, kind: 'transcript-ontology-reviewed-plan', dryRun: true,
        databaseMutationExecuted: false, publicGraphWritten: false, requiresPublicationReview: true,
        source: { reviewedAt: fixture.reviewedAt }, nodes: incompletePlan.nodes, relations: incompletePlan.relations,
      }),
      sourceId: 'live-incomplete',
      approvedBy: 'auth-user:00000000-0000-4000-8000-000000000091',
      approvedAt: decisionAt(3),
    })).rejects.toThrow('Invalid reviewed plan decision audit');

    const reviewedPlanText = await exportTranscriptOntologyReviewedPlan(await completedWorkspace());
    const base = { reviewedPlanText, sourceId: 'live-reviewed', approvedAt: decisionAt(3) };
    await expect(buildTranscriptOntologyPublicationApproval({ ...base, sourceId: 'public-reviewed', approvedBy: 'auth-user:00000000-0000-4000-8000-000000000091' }))
      .rejects.toThrow('Invalid publication source id');
    await expect(buildTranscriptOntologyPublicationApproval({ ...base, approvedBy: 'moderator-role-1' }))
      .rejects.toThrow('Invalid publication approver id');
    await expect(buildTranscriptOntologyPublicationApproval({ ...base, approvedBy: 'auth-user:00000000-0000-4000-8000-000000000091', approvedAt: decisionAt(2) }))
      .rejects.toThrow('Publication approval must follow every review decision');
  });

  it('enforces relation endpoint decisions in either review order', async () => {
    let workspace = await createTranscriptOntologyReviewWorkspace(fixtureText);
    for (const [index, node] of workspace.nodes.entries()) {
      workspace = reviewTranscriptOntologyCandidate(workspace, {
        itemType: 'node', id: node.id, status: 'accepted', kind: node.kindCandidate,
        label: node.sourceLabel, text: node.sourceText, reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
        reviewedAt: decisionAt(index),
      });
    }
    workspace = reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'relation', id: workspace.relations[0].id, status: 'accepted',
      relation: workspace.relations[0].relationCandidate, reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: decisionAt(2),
    });
    expect(() => reviewTranscriptOntologyCandidate(workspace, {
      itemType: 'node', id: workspace.nodes[0].id, status: 'rejected',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt: decisionAt(3),
    })).toThrow('Reject dependent reviewed relations before rejecting this node');

    let rejectedEndpoint = await createTranscriptOntologyReviewWorkspace(fixtureText);
    rejectedEndpoint = reviewTranscriptOntologyCandidate(rejectedEndpoint, {
      itemType: 'node', id: rejectedEndpoint.nodes[0].id, status: 'rejected',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt: decisionAt(4),
    });
    expect(() => reviewTranscriptOntologyCandidate(rejectedEndpoint, {
      itemType: 'relation', id: rejectedEndpoint.relations[0].id, status: 'edited',
      relation: 'supports', reviewer: 'auth-user:00000000-0000-4000-8000-000000000091', reviewedAt: decisionAt(5),
    })).toThrow('Reviewed relation requires non-rejected endpoint nodes');
  });

  it('rejects non-synthetic fixture provenance before opening the workspace', async () => {
    const identifyingReviewer = structuredClone(fixture);
    identifyingReviewer.reviewedBy = 'person-name';
    await expect(createTranscriptOntologyReviewWorkspace(JSON.stringify(identifyingReviewer)))
      .rejects.toThrow('Invalid fixture reviewer identity');

    const invalidLanguage = structuredClone(fixture);
    invalidLanguage.language = '한국어';
    await expect(createTranscriptOntologyReviewWorkspace(JSON.stringify(invalidLanguage)))
      .rejects.toThrow('Invalid fixture language');
  });
});
