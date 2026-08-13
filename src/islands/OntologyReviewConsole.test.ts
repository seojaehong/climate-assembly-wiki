import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import OntologyReviewConsole, {
  AuthenticatedOntologyReviewWorkspace,
  completeOntologyWorkspaceLoad,
  completeTranscriptPublicationApprovalExport,
  completeTranscriptOntologyExport,
  FacilitationPromptPanel,
  NodeReviewCard,
  OntologyReviewLoginBoundary,
  ontologyReviewNodeAnchorId,
  TranscriptCandidatePrompt,
  TranscriptNodeReviewCard,
  TranscriptRelationReviewCard,
  transcriptHandoffFixtureArtifact,
} from './OntologyReviewConsole';
import type { CanvasOntologyNode, CanvasOntologyReviewWorkspace } from './canvas/ontology-review-workspace';
import type {
  TranscriptOntologyReviewNode,
  TranscriptOntologyReviewRelation,
  TranscriptOntologyReviewWorkspace,
} from './canvas/transcript-ontology-review-workspace';
import { authenticatedReviewerId } from './canvas/useAuth';

const AUTH_REVIEWER_ID = 'auth-user:00000000-0000-4000-8000-000000000091';

describe('OntologyReviewConsole', () => {
  it('keeps microphone and review-file controls behind the moderator auth boundary', () => {
    const html = renderToStaticMarkup(createElement(OntologyReviewConsole));

    expect(html).toContain('온톨로지 검수 진행자 로그인');
    expect(html).toContain('마이크·전사·검수 파일은 인증 후에만');
    expect(html).toContain('온톨로지 검수 이메일 주소');
    expect(html).toContain('온톨로지 검수 비밀번호');
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('R4 로컬 음성·전사 검수');
  });

  it('renders the local-only workspace only for an authenticated moderator', () => {
    const html = renderToStaticMarkup(createElement(AuthenticatedOntologyReviewWorkspace, {
      email: 'moderator@example.test',
      reviewerId: AUTH_REVIEWER_ID,
      loggingOut: false,
      logoutError: null,
      onLogout: () => undefined,
    }));

    expect(html).toContain('Canvas 온톨로지 검수 큐');
    expect(html).toContain('인증된 진행자 moderator@example.test');
    expect(html).toContain('로그아웃');
    expect(html).toContain('type="file"');
    expect(html).toContain('검수 계획 JSON');
    expect(html).toContain('Canvas snapshot JSON');
    expect(html).toContain('인증 검수자 ID');
    expect(html.match(new RegExp(AUTH_REVIEWER_ID, 'g'))).toHaveLength(4);
    expect(html).toContain('type="submit" disabled=""');
    expect(html).toContain('DB에 저장하지 않습니다.');
    expect(html).toContain('공개 그래프에 반영하지 않습니다.');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('전사 ontology 후보 검수');
    expect(html).toContain('R4 검수 완료 전사 batch JSON');
    expect(html).toContain('provider-neutral ontology 후보 JSON');
    expect(html).toContain('R4 handoff 로컬 검수 시작');
    expect(html).toContain('전사 ontology fixture JSON');
    expect(html).toContain('candidate node와 relation을 브라우저 메모리에서만 검수합니다.');
    expect(html).toContain('승인된 consent·retention 정책 전에는 실제 시민 발언 파일을 넣지 마세요.');
    expect(html).toContain('R4 로컬 음성·전사 검수');
    expect(html).toContain('MediaRecorder와 테이블 녹음 파일의 local-only proof of concept');
    expect(html).toContain('브라우저 세션 메모리에만');
    expect(html).toContain('전사 chunk 검수 완료 전에는 extraction handoff를 만들 수 없습니다.');
  });

  it('renders every upload control on an explicit opaque high-contrast surface', () => {
    const html = renderToStaticMarkup(createElement(AuthenticatedOntologyReviewWorkspace, {
      email: 'moderator@example.test',
      reviewerId: AUTH_REVIEWER_ID,
      loggingOut: false,
      logoutError: null,
      onLogout: () => undefined,
    }));
    const inputTags = html.match(/<input\b[^>]*>/g) ?? [];

    expect(inputTags).toHaveLength(11);
    for (const input of inputTags.filter((input) => !input.includes('type="checkbox"'))) {
      expect(input).toContain('background:#FFFFFF');
      expect(input).toContain('color:#102A43');
    }
  });

  it('derives the private review audit identity from a valid authenticated user UUID only', () => {
    expect(authenticatedReviewerId('00000000-0000-4000-8000-000000000091')).toBe(AUTH_REVIEWER_ID);
    expect(authenticatedReviewerId('NOT-A-UUID')).toBeNull();
    expect(authenticatedReviewerId('')).toBeNull();
  });

  it('preserves the exact generated R4 handoff fixture as a local operator artifact', () => {
    const fixtureText = '{"kind":"transcript-ontology-fixture"}\n';
    const source: TranscriptOntologyReviewWorkspace['source'] = {
      fixtureId: 'candidate-set-1',
      sessionId: 'session-1',
      language: 'ko',
      reviewedBy: AUTH_REVIEWER_ID,
      reviewedAt: '2026-08-14T01:00:00.000Z',
      fixtureSha256: 'a'.repeat(64),
      fixtureText,
      handoff: {
        kind: 'private-transcript-extraction-handoff',
        reviewBatchSha256: 'b'.repeat(64),
        captureId: 'capture-1',
        roomId: 'table-a',
        language: 'ko-KR',
        captureMethod: 'table-recorder-file',
        audioSha256: 'c'.repeat(64),
        candidateSetId: 'candidate/set 1',
      },
    };

    expect(transcriptHandoffFixtureArtifact(source)).toEqual({
      content: fixtureText,
      fileName: 'private-transcript-ontology-fixture-candidate_set_1.json',
    });
    expect(() => transcriptHandoffFixtureArtifact({ ...source, handoff: null })).toThrow(
      'R4 extraction handoff fixture is unavailable',
    );
  });

  it('announces auth failures and locks the login form while a request is running', () => {
    const html = renderToStaticMarkup(createElement(OntologyReviewLoginBoundary, {
      email: 'moderator@example.test',
      password: 'synthetic-password',
      busy: true,
      error: 'Synthetic authentication failure',
      hydrated: true,
      onEmailChange: () => undefined,
      onPasswordChange: () => undefined,
      onSubmit: () => undefined,
    }));

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-ontology-review-auth-ready="true"');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('로그인 중…');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Synthetic authentication failure');
  });

  it('keys the authenticated workspace by user identity so local files and audio unmount at session boundaries', () => {
    const source = readFileSync(new URL('./OntologyReviewConsole.tsx', import.meta.url), 'utf8');

    expect(source).toContain('key={session.user.id}');
    expect(source.match(/runExclusiveCanvasAuthOperation\(authOperationLock/g)).toHaveLength(2);
    expect(source).toContain("setEmail('');");
    expect(source).toContain("setPassword('');");
  });

  it('renders advisory facilitation questions with provenance and a live count', () => {
    const html = renderToStaticMarkup(createElement(FacilitationPromptPanel, { prompts: [{
      id: 'missing-condition:node-1',
      nodeId: 'node-1',
      sourceAgendaId: 'agenda-1',
      sourceSessionId: 'session-1',
      sourceText: '원래 제안 문구',
      relatedNodeIds: ['condition-1'],
      kind: 'missing-condition',
      question: '이 제안을 실행하려면 어떤 조건이 필요한가요?',
      reason: '검수된 Proposal에 연결된 Condition이 없습니다.',
    }] }));

    expect(html).toContain('진행 질문');
    expect(html).toContain('현재 규칙으로 확인된 진행 질문 1개');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('출처 세션 session-1 · 원 agenda agenda-1 · 노드 node-1');
    expect(html).toContain('관련 노드 condition-1');
    expect(html).toContain('원문: 원래 제안 문구');
    expect(html).toContain('회의의 결정이나 진실 판정을 대신하지 않습니다.');
    expect(html).toContain('적용 중인 질문 규칙 5개');
    expect(html).toContain('근거가 연결되지 않은 주장');
    expect(html).toContain('이름 붙이지 않은 가치 긴장');
  });

  it('renders a non-decision facilitation suggestion inside a transcript candidate card', () => {
    const html = renderToStaticMarkup(createElement(TranscriptCandidatePrompt, { kind: 'Claim' }));

    expect(html).toContain('aria-label="후보 진행 질문 제안"');
    expect(html).toContain('함께 확인할 진행 질문');
    expect(html).toContain('이 주장에 연결할 근거나 경험이 있는지 함께 확인해 보세요.');
    expect(html).toContain('회의의 결정이나 진실 판정을 대신하지 않습니다.');
  });

  it('offers a defer action without presenting it as a completed transcript decision', () => {
    const node: TranscriptOntologyReviewNode = {
      id: 'transcript-node:candidate-issue', sourceUid: 'candidate-issue',
      kindCandidate: 'Issue', kind: 'Issue', sourceLabel: '전환 속도', sourceText: '전환 속도를 논의합니다.',
      label: '전환 속도', text: '전환 속도를 논의합니다.', citedUids: ['chunk-1'],
      transcript: [{ uid: 'chunk-1', startMs: 0, endMs: 1000, speakerLabelPseudonym: 'speaker-unknown', text: '전환 속도를 논의합니다.' }],
      followUpQuestion: null,
      reviewStatus: 'deferred', reviewer: AUTH_REVIEWER_ID, reviewedAt: '2026-08-29T01:00:00.000Z',
    };
    const html = renderToStaticMarkup(createElement(TranscriptNodeReviewCard, {
      node, reviewer: AUTH_REVIEWER_ID, onDecision: () => undefined, onDraft: () => undefined,
    }));

    expect(html).toContain('candidate node · 보류');
    expect(html).toContain('나중에 검수');
    expect(html).toContain('후속 확인 요청');
    expect(html).toContain('원문 승인');
  });

  it('renders an audited follow-up request as incomplete moderator work', () => {
    const question = '이 쟁점의 범위와 서로 다른 관점을 함께 확인해 보세요.';
    const node: TranscriptOntologyReviewNode = {
      id: 'transcript-node:candidate-issue', sourceUid: 'candidate-issue',
      kindCandidate: 'Issue', kind: 'Issue', sourceLabel: '전환 속도', sourceText: '전환 속도를 논의합니다.',
      label: '전환 속도', text: '전환 속도를 논의합니다.', citedUids: ['chunk-1'],
      transcript: [{ uid: 'chunk-1', startMs: 0, endMs: 1000, speakerLabelPseudonym: 'speaker-unknown', text: '전환 속도를 논의합니다.' }],
      followUpQuestion: question,
      reviewStatus: 'follow_up', reviewer: AUTH_REVIEWER_ID, reviewedAt: '2026-08-29T01:00:00.000Z',
    };
    const html = renderToStaticMarkup(createElement(TranscriptNodeReviewCard, {
      node, reviewer: AUTH_REVIEWER_ID, onDecision: () => undefined, onDraft: () => undefined,
    }));

    expect(html).toContain('candidate node · 후속 확인 중');
    expect(html).toContain('aria-label="요청한 후속 확인"');
    expect(html).toContain(question);
    expect(html).toContain('응답이나 추가 근거를 확인한 뒤 이 후보를 다시 판단해야 합니다.');
  });

  it('renders a relation follow-up request with its exact pending question', () => {
    const question = '두 후보 사이 supports 연결의 근거와 성립 조건을 함께 확인해 보세요.';
    const relation: TranscriptOntologyReviewRelation = {
      id: 'transcript-edge:candidate-relation', sourceUid: 'candidate-relation',
      source: 'transcript-node:claim', target: 'transcript-node:issue',
      relationCandidate: 'supports', relation: 'supports', citedUids: ['chunk-1'],
      transcript: [{ uid: 'chunk-1', startMs: 0, endMs: 1000, speakerLabelPseudonym: 'speaker-unknown', text: '근거를 확인합니다.' }],
      followUpQuestion: question,
      reviewStatus: 'follow_up', reviewer: AUTH_REVIEWER_ID, reviewedAt: '2026-08-29T01:00:00.000Z',
    };
    const html = renderToStaticMarkup(createElement(TranscriptRelationReviewCard, {
      relation, reviewer: AUTH_REVIEWER_ID, onDecision: () => undefined, onDraft: () => undefined,
    }));

    expect(html).toContain('candidate relation · 후속 확인 중');
    expect(html).toContain(question);
    expect(html).toContain('후속 확인 요청');
    expect(html).toContain('나중에 검수');
  });

  it('links every facilitation prompt provenance node to a focusable review card', () => {
    const promptHtml = renderToStaticMarkup(createElement(FacilitationPromptPanel, { prompts: [{
      id: 'value-conflict:relation-1',
      nodeId: 'canvas-agenda:value-a',
      sourceAgendaId: 'value-a',
      sourceSessionId: 'session-1',
      sourceText: '형평성을 우선한다.',
      relatedNodeIds: ['canvas-agenda:value-a', 'canvas-agenda:value-b', 'canvas-agenda:value-b'],
      kind: 'value-conflict',
      question: '두 가치의 긴장을 어떤 말로 이름 붙이면 좋을까요?',
      reason: '검수된 Value가 opposes 관계입니다.',
    }] }));
    const node: CanvasOntologyNode = {
      id: 'canvas-agenda:value-a',
      sourceAgendaId: 'value-a',
      sourceSessionId: 'session-1',
      sourceText: '형평성을 우선한다.',
      label: '형평성',
      text: '형평성을 우선한다.',
      kind: 'Value',
      kindCandidates: ['Value'],
      reviewStatus: 'accepted',
      reviewer: 'moderator-role-1',
      reviewedAt: '2026-08-29T01:00:00.000Z',
    };
    const cardHtml = renderToStaticMarkup(createElement(NodeReviewCard, {
      node,
      reviewer: 'moderator-role-1',
      onDecision: () => undefined,
    }));
    const sourceAnchor = ontologyReviewNodeAnchorId(node.id);
    const relatedAnchor = ontologyReviewNodeAnchorId('canvas-agenda:value-b');

    expect(promptHtml).toContain(`href="#${sourceAnchor}"`);
    expect(promptHtml).toContain(`href="#${relatedAnchor}"`);
    expect(promptHtml.match(new RegExp(`href="#${relatedAnchor}"`, 'g'))).toHaveLength(1);
    expect(promptHtml).toContain('출처 노드 보기');
    expect(promptHtml).toContain('관련 노드 1 보기');
    expect(cardHtml).toContain(`id="${sourceAnchor}"`);
    expect(cardHtml).toContain('tabindex="-1"');
  });

  it('renders all five R5 facilitation prompt kinds as questions rather than decisions', () => {
    const promptKinds = [
      'missing-evidence',
      'missing-condition',
      'isolated-concern',
      'evidence-cluster-clarification',
      'value-conflict',
    ] as const;
    const html = renderToStaticMarkup(createElement(FacilitationPromptPanel, {
      prompts: promptKinds.map((kind, index) => ({
        id: `${kind}:node-${index}`,
        nodeId: `node-${index}`,
        relatedNodeIds: [`related-${index}`],
        sourceAgendaId: `agenda-${index}`,
        sourceSessionId: 'session-1',
        sourceText: `원문 ${index}`,
        kind,
        question: `${kind}을 함께 확인해 보면 어떨까요?`,
        reason: `${kind} 검토 근거`,
      })),
    }));

    expect(html.match(/<li>/g)).toHaveLength(10);
    expect(html).toContain('현재 규칙으로 확인된 진행 질문 5개');
    for (const kind of promptKinds) expect(html).toContain(`${kind}을 함께 확인해 보면 어떨까요?`);
    expect(html).not.toContain('자동 확정');
  });

  it('discards a stale asynchronous workspace load without changing visible state', async () => {
    const workspaceChanges: unknown[] = [];
    const notices: string[] = [];
    const errors: Array<string | null> = [];
    const busyChanges: boolean[] = [];
    let current = true;
    let resolveLoad: () => void = () => { throw new Error('Deferred load was not initialized'); };
    const load = new Promise<CanvasOntologyReviewWorkspace>((resolve) => {
      resolveLoad = () => resolve({} as CanvasOntologyReviewWorkspace);
    });
    const completion = completeOntologyWorkspaceLoad({
      load: () => load,
      isCurrent: () => current,
      setWorkspace: (workspace) => workspaceChanges.push(workspace),
      setNotice: (notice) => notices.push(notice),
      setError: (error) => errors.push(error),
      setBusy: (busy) => busyChanges.push(busy),
    });

    current = false;
    resolveLoad();
    await completion;

    expect(workspaceChanges).toEqual([]);
    expect(notices).toEqual([]);
    expect(errors).toEqual([]);
    expect(busyChanges).toEqual([]);
  });

  it('discards a transcript export when the reviewed workspace changes while rebuilding', async () => {
    const downloads: string[] = [];
    const notices: string[] = [];
    const errors: Array<string | null> = [];
    const busyChanges: boolean[] = [];
    let current = true;
    let resolveBuild: () => void = () => { throw new Error('Deferred export was not initialized'); };
    const build = new Promise<string>((resolve) => {
      resolveBuild = () => resolve('{"schemaVersion":2}');
    });
    const completion = completeTranscriptOntologyExport({
      build: () => build,
      isCurrent: () => current,
      download: (content) => downloads.push(content),
      setNotice: (notice) => notices.push(notice),
      setError: (error) => errors.push(error),
      setBusy: (busy) => busyChanges.push(busy),
    });

    current = false;
    resolveBuild();
    await completion;

    expect(downloads).toEqual([]);
    expect(notices).toEqual(['검수 입력이 바뀌어 이전 plan 다운로드를 취소했습니다.']);
    expect(errors).toEqual([]);
    expect(busyChanges).toEqual([false]);
  });

  it('discards a publication approval download when its reviewed plan or source changes', async () => {
    const downloads: string[] = [];
    const notices: string[] = [];
    const busyChanges: boolean[] = [];
    let current = true;
    let resolveBuild: () => void = () => { throw new Error('Deferred approval export was not initialized'); };
    const build = new Promise<string>((resolve) => {
      resolveBuild = () => resolve('{"kind":"transcript-ontology-publication-approval"}');
    });
    const completion = completeTranscriptPublicationApprovalExport({
      build: () => build,
      isCurrent: () => current,
      download: (content) => downloads.push(content),
      setNotice: (notice) => notices.push(notice),
      setError: () => undefined,
      setBusy: (busy) => busyChanges.push(busy),
    });

    current = false;
    resolveBuild();
    await completion;

    expect(downloads).toEqual([]);
    expect(notices).toEqual(['검수 plan 또는 공개 source ID가 바뀌어 이전 승인 파일 다운로드를 취소했습니다.']);
    expect(busyChanges).toEqual([false]);
  });
});
