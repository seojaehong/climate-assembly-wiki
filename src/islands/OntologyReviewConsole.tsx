import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  canvasFacilitationPrompts,
  CANVAS_FACILITATION_RULES,
  createCanvasOntologyReviewWorkspace,
  exportCanvasOntologyReviewedPlan,
  reviewCanvasOntologyItem,
  type CanvasOntologyCluster,
  type CanvasFacilitationPrompt,
  type CanvasOntologyNode,
  type CanvasOntologyRelation,
  type CanvasOntologyReviewDecision,
  type CanvasOntologyReviewWorkspace,
} from './canvas/ontology-review-workspace';
import {
  buildTranscriptOntologyPublicationApproval,
  buildPrivateTranscriptOntologyFixture,
  createTranscriptOntologyReviewWorkspace,
  exportTranscriptOntologyReviewedPlan,
  reviewTranscriptOntologyCandidate,
  updateTranscriptOntologyCandidateDraft,
  TRANSCRIPT_ONTOLOGY_NODE_KINDS,
  TRANSCRIPT_ONTOLOGY_RELATIONS,
  TRANSCRIPT_PUBLICATION_SOURCE_PATTERN,
  type TranscriptCitation,
  type TranscriptOntologyReviewDecision,
  type TranscriptOntologyReviewDraft,
  type TranscriptOntologyReviewNode,
  type TranscriptOntologyReviewRelation,
  type TranscriptOntologyReviewWorkspace,
  transcriptCandidateFacilitationPrompt,
  transcriptRelationFollowUpPrompt,
} from './canvas/transcript-ontology-review-workspace';
import { PrivateTranscriptCapturePanel } from './canvas/PrivateTranscriptCapturePanel';
import { authenticatedReviewerId, runExclusiveCanvasAuthOperation, useAuth } from './canvas/useAuth';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CONTROL_BORDER = '#2F6F7E';
const PANEL = '#F3F8FA';
const INK = '#102A43';
const MUTED = '#526777';

const controlStyle: CSSProperties = {
  background: '#FFFFFF',
  border: `2px solid ${CONTROL_BORDER}`,
  borderRadius: 8,
  boxSizing: 'border-box',
  color: INK,
  colorScheme: 'light',
  minHeight: 44,
  padding: '8px 10px',
};

const cardStyle: CSSProperties = {
  background: '#FFFFFF',
  border: `2px solid ${CONTROL_BORDER}`,
  borderRadius: 12,
  display: 'grid',
  gap: 12,
  padding: 16,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '검수 파일을 처리하지 못했습니다.';
}

export async function completeOntologyWorkspaceLoad(input: {
  load: () => Promise<CanvasOntologyReviewWorkspace>;
  isCurrent: () => boolean;
  setWorkspace: (workspace: CanvasOntologyReviewWorkspace) => void;
  setNotice: (notice: string) => void;
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
}): Promise<void> {
  try {
    const workspace = await input.load();
    if (!input.isCurrent()) return;
    input.setWorkspace(workspace);
    input.setNotice(`검수 항목 ${workspace.summary.total}개를 불러왔습니다.`);
    input.setError(null);
  } catch (caught: unknown) {
    if (!input.isCurrent()) return;
    console.error('Failed to load the local Canvas ontology review workspace', caught);
    input.setError(errorMessage(caught));
  } finally {
    if (input.isCurrent()) input.setBusy(false);
  }
}

export async function completeTranscriptOntologyExport(input: {
  build: () => Promise<string>;
  isCurrent: () => boolean;
  download: (content: string) => void;
  setNotice: (notice: string) => void;
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
}): Promise<void> {
  try {
    const content = await input.build();
    if (!input.isCurrent()) {
      input.setNotice('검수 입력이 바뀌어 이전 plan 다운로드를 취소했습니다.');
      return;
    }
    input.download(content);
    input.setError(null);
    input.setNotice('전사 후보 검수 plan을 내려받았습니다. 공개 반영은 수행하지 않았습니다.');
  } catch (caught: unknown) {
    if (!input.isCurrent()) return;
    console.error('Failed to export the local transcript ontology reviewed plan', caught);
    input.setError(errorMessage(caught));
  } finally {
    input.setBusy(false);
  }
}

export async function completeTranscriptPublicationApprovalExport(input: {
  build: () => Promise<string>;
  isCurrent: () => boolean;
  download: (content: string) => void;
  setNotice: (notice: string) => void;
  setError: (error: string | null) => void;
  setBusy: (busy: boolean) => void;
}): Promise<void> {
  try {
    const content = await input.build();
    if (!input.isCurrent()) {
      input.setNotice('검수 plan 또는 공개 source ID가 바뀌어 이전 승인 파일 다운로드를 취소했습니다.');
      return;
    }
    input.download(content);
    input.setError(null);
    input.setNotice('공개 승인 artifact를 내려받았습니다. DB 저장과 공개 graph 반영은 수행하지 않았습니다.');
  } catch (caught: unknown) {
    if (!input.isCurrent()) return;
    console.error('Failed to export the local transcript publication approval artifact', caught);
    input.setError(errorMessage(caught));
  } finally {
    input.setBusy(false);
  }
}

async function readLocalJson(file: File | null, label: string): Promise<string> {
  if (!file) throw new Error(`${label}을 선택해 주세요.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${label}은 5MB 이하여야 합니다.`);
  return file.text();
}

function downloadReviewedPlan(content: string, snapshotId: string | number): void {
  const safeId = String(snapshotId).replaceAll(/[^a-zA-Z0-9_-]/g, '_');
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `canvas-ontology-reviewed-${safeId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadTranscriptReviewedPlan(content: string, fixtureId: string): void {
  const safeId = fixtureId.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `transcript-ontology-reviewed-${safeId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function transcriptHandoffFixtureArtifact(source: TranscriptOntologyReviewWorkspace['source']): {
  content: string;
  fileName: string;
} {
  if (!source.handoff) throw new Error('R4 extraction handoff fixture is unavailable');
  const safeId = source.handoff.candidateSetId.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
  return {
    content: source.fixtureText,
    fileName: `private-transcript-ontology-fixture-${safeId}.json`,
  };
}

function downloadTranscriptHandoffFixture(source: TranscriptOntologyReviewWorkspace['source']): void {
  const artifact = transcriptHandoffFixtureArtifact(source);
  const url = URL.createObjectURL(new Blob([artifact.content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadTranscriptPublicationApproval(content: string, sourceId: string): void {
  const safeId = sourceId.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `transcript-ontology-publication-approval-${safeId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function DecisionButtons({ onAccept, onReject, onFollowUp, onDefer, acceptLabel = '승인' }: {
  onAccept: () => void;
  onReject: () => void;
  onFollowUp?: () => void;
  onDefer?: () => void;
  acceptLabel?: string;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" onClick={onAccept} style={{ ...controlStyle, background: '#165B33', color: '#FFFFFF', fontWeight: 800 }}>
        {acceptLabel}
      </button>
      <button type="button" onClick={onReject} style={{ ...controlStyle, background: '#FFFFFF', color: '#8A1C1C', fontWeight: 800 }}>
        반려
      </button>
      {onFollowUp ? (
        <button type="button" onClick={onFollowUp} style={{ ...controlStyle, background: '#FFF8E7', color: '#5F4B00', fontWeight: 800 }}>
          후속 확인 요청
        </button>
      ) : null}
      {onDefer ? (
        <button type="button" onClick={onDefer} style={{ ...controlStyle, background: '#FFFFFF', color: '#5F4B00', fontWeight: 800 }}>
          나중에 검수
        </button>
      ) : null}
    </div>
  );
}

export function FacilitationPromptPanel({ prompts }: { prompts: CanvasFacilitationPrompt[] }) {
  return (
    <section aria-labelledby="facilitation-prompt-heading" style={{ ...cardStyle, marginBottom: 28 }}>
      <h2 id="facilitation-prompt-heading" style={{ margin: 0 }}>진행 질문</h2>
      <p style={{ color: MUTED, lineHeight: 1.6, margin: 0 }}>
        사람 검수 결과에서 빠진 연결을 확인하기 위한 진행 보조 질문입니다. 회의의 결정이나 진실 판정을 대신하지 않습니다.
      </p>
      <p role="status" aria-live="polite" aria-atomic="true" style={{ margin: 0 }}>
        현재 규칙으로 확인된 진행 질문 {prompts.length}개
      </p>
      <details>
        <summary>적용 중인 질문 규칙 5개</summary>
        <ul aria-label="R5 진행 질문 규칙" style={{ marginBottom: 0 }}>
          {CANVAS_FACILITATION_RULES.map((rule) => <li key={rule.kind}>{rule.label}</li>)}
        </ul>
      </details>
      {prompts.length > 0 ? (
        <ol style={{ display: 'grid', gap: 12, margin: 0, paddingLeft: 24 }}>
          {prompts.map((prompt) => {
            const relatedNodeIds = [...new Set(prompt.relatedNodeIds.filter((nodeId) => nodeId !== prompt.nodeId))];
            return (
              <li key={prompt.id}>
                <strong>{prompt.question}</strong>
                <div style={{ color: MUTED, lineHeight: 1.5, marginTop: 4 }}>{prompt.reason}</div>
                <div style={{ color: MUTED, fontSize: 13, overflowWrap: 'anywhere' }}>
                  출처 세션 {prompt.sourceSessionId} · 원 agenda {prompt.sourceAgendaId} · 노드 {prompt.nodeId}
                </div>
                {prompt.relatedNodeIds.length > 0 ? (
                  <div style={{ color: MUTED, fontSize: 13, overflowWrap: 'anywhere' }}>
                    관련 노드 {prompt.relatedNodeIds.join(' · ')}
                  </div>
                ) : null}
                <div style={{ color: MUTED, fontSize: 13, marginTop: 2 }}>원문: {prompt.sourceText}</div>
                <div aria-label="진행 질문 관련 검수 카드" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                  {[prompt.nodeId, ...relatedNodeIds].map((nodeId, index) => {
                    const anchorId = ontologyReviewNodeAnchorId(nodeId);
                    return (
                      <a
                        key={nodeId}
                        href={`#${anchorId}`}
                        onClick={(event) => {
                          const target = document.getElementById(anchorId);
                          if (!target) {
                            console.error('Ontology review node anchor is missing', { nodeId, anchorId });
                            return;
                          }
                          event.preventDefault();
                          target.focus();
                          target.scrollIntoView({ block: 'center' });
                          window.history.replaceState(null, '', `#${anchorId}`);
                        }}
                        style={{ color: '#0B4F6C', fontWeight: 800, textDecoration: 'underline', textUnderlineOffset: 3 }}
                      >
                        {index === 0 ? '출처 노드 보기' : `관련 노드 ${index} 보기`}
                      </a>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p style={{ margin: 0 }}>현재 검수 상태에서 추가 진행 질문이 없습니다.</p>}
    </section>
  );
}

export function ontologyReviewNodeAnchorId(nodeId: string): string {
  const encodedNodeId = Array.from(nodeId, (character) =>
    (character.codePointAt(0) ?? 0).toString(16).padStart(6, '0')).join('');
  return `ontology-review-node-${encodedNodeId}`;
}

export function NodeReviewCard({ node, reviewer, onDecision }: {
  node: CanvasOntologyNode;
  reviewer: string;
  onDecision: (decision: CanvasOntologyReviewDecision) => void;
}) {
  const [kind, setKind] = useState(node.kindCandidates[0] ?? '');
  const [label, setLabel] = useState(node.label);
  const [text, setText] = useState(node.text);
  const decide = (status: 'accepted' | 'edited' | 'rejected') => onDecision({
    itemType: 'node', id: node.id, status, kind, label, text, reviewer,
    reviewedAt: new Date().toISOString(),
  });
  const edited = label !== node.sourceText || text !== node.sourceText;
  return (
    <article id={ontologyReviewNodeAnchorId(node.id)} tabIndex={-1} style={cardStyle} aria-label={`노드 검수 ${node.id}`}>
      <header>
        <strong>노드 · {node.reviewStatus === 'proposed' ? '미검수' : node.reviewStatus}</strong>
        <div style={{ color: MUTED, fontSize: 13, overflowWrap: 'anywhere' }}>{node.id}</div>
      </header>
      <p style={{ margin: 0 }}><strong>원문</strong><br />{node.sourceText}</p>
      <label>온톨로지 역할
        <select value={kind} onChange={(event) => setKind(event.currentTarget.value)} style={{ ...controlStyle, display: 'block', width: '100%' }}>
          {node.kindCandidates.map((candidate) => <option key={candidate}>{candidate}</option>)}
        </select>
      </label>
      <label>표시 이름
        <input value={label} onChange={(event) => setLabel(event.currentTarget.value)} style={{ ...controlStyle, display: 'block', width: '100%' }} />
      </label>
      <label>검수 내용
        <textarea value={text} onChange={(event) => setText(event.currentTarget.value)} rows={4} style={{ ...controlStyle, display: 'block', resize: 'vertical', width: '100%' }} />
      </label>
      <DecisionButtons
        acceptLabel={edited ? '수정 승인' : '원문 승인'}
        onAccept={() => decide(edited ? 'edited' : 'accepted')}
        onReject={() => decide('rejected')}
      />
    </article>
  );
}

function RelationReviewCard({ relation, reviewer, onDecision }: {
  relation: CanvasOntologyRelation;
  reviewer: string;
  onDecision: (decision: CanvasOntologyReviewDecision) => void;
}) {
  const [relationType, setRelationType] = useState(relation.relationCandidates[0] ?? '');
  const decide = (status: 'accepted' | 'rejected') => onDecision({
    itemType: 'relation', id: relation.id, status, relation: relationType, reviewer,
    reviewedAt: new Date().toISOString(),
  });
  return (
    <article style={cardStyle} aria-label={`관계 검수 ${relation.id}`}>
      <header><strong>관계 · {relation.reviewStatus === 'proposed' ? '미검수' : relation.reviewStatus}</strong></header>
      <p style={{ color: MUTED, margin: 0, overflowWrap: 'anywhere' }}>{relation.source} → {relation.target}</p>
      <label>관계 유형
        <select value={relationType} onChange={(event) => setRelationType(event.currentTarget.value)} style={{ ...controlStyle, display: 'block', width: '100%' }}>
          {relation.relationCandidates.map((candidate) => <option key={candidate}>{candidate}</option>)}
        </select>
      </label>
      <DecisionButtons onAccept={() => decide('accepted')} onReject={() => decide('rejected')} />
    </article>
  );
}

function ClusterReviewCard({ cluster, nodes, reviewer, onDecision }: {
  cluster: CanvasOntologyCluster;
  nodes: CanvasOntologyNode[];
  reviewer: string;
  onDecision: (decision: CanvasOntologyReviewDecision) => void;
}) {
  const issueCandidates = nodes.filter((node) => cluster.memberNodeIds.includes(node.id)
    && (node.reviewStatus === 'accepted' || node.reviewStatus === 'edited')
    && node.kind === 'Issue');
  const [issueNodeId, setIssueNodeId] = useState(issueCandidates[0]?.id ?? '');
  const selectedIssueNodeId = issueCandidates.some((node) => node.id === issueNodeId)
    ? issueNodeId
    : (issueCandidates[0]?.id ?? '');
  const id = `${cluster.sourceSessionId}\u0000${cluster.groupId}`;
  const decide = (status: 'accepted' | 'rejected') => onDecision({
    itemType: 'cluster', id, status, issueNodeId: selectedIssueNodeId,
    reviewer, reviewedAt: new Date().toISOString(),
  });
  return (
    <article style={cardStyle} aria-label={`군집 검수 ${cluster.groupId}`}>
      <header><strong>군집 {cluster.groupId} · {cluster.reviewStatus === 'proposed' ? '미검수' : cluster.reviewStatus}</strong></header>
      <p style={{ color: MUTED, margin: 0 }}>멤버 {cluster.memberNodeIds.length}개</p>
      <label>대표 Issue 노드
        <select value={selectedIssueNodeId} onChange={(event) => setIssueNodeId(event.currentTarget.value)} disabled={issueCandidates.length === 0} style={{ ...controlStyle, display: 'block', width: '100%' }}>
          {issueCandidates.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
        </select>
      </label>
      {issueCandidates.length === 0 ? <p style={{ color: MUTED, margin: 0 }}>먼저 이 군집의 노드 하나를 Issue로 승인해 주세요.</p> : null}
      <DecisionButtons onAccept={() => decide('accepted')} onReject={() => decide('rejected')} />
    </article>
  );
}

function TranscriptEvidence({ transcript }: { transcript: TranscriptCitation[] }) {
  return (
    <section aria-label="인용 전사 구간" style={{ background: PANEL, borderRadius: 8, display: 'grid', gap: 8, padding: 12 }}>
      <strong>인용 전사 구간</strong>
      {transcript.map((chunk) => (
        <blockquote key={chunk.uid} style={{ borderLeft: `4px solid ${CONTROL_BORDER}`, margin: 0, paddingLeft: 12 }}>
          <div>{chunk.text}</div>
          <footer style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>
            {chunk.uid} · {chunk.speakerLabelPseudonym} · {chunk.startMs}–{chunk.endMs}ms
          </footer>
        </blockquote>
      ))}
    </section>
  );
}

export function TranscriptCandidatePrompt({ kind }: { kind: string }) {
  return (
    <section aria-label="후보 진행 질문 제안" style={{ background: '#FFF8E7', border: `2px solid ${CONTROL_BORDER}`, borderRadius: 8, padding: 12 }}>
      <strong>함께 확인할 진행 질문</strong>
      <p style={{ margin: '6px 0 0' }}>{transcriptCandidateFacilitationPrompt(kind)}</p>
      <small style={{ color: MUTED }}>검수 전 확인을 돕는 제안이며 회의의 결정이나 진실 판정을 대신하지 않습니다.</small>
    </section>
  );
}

function transcriptReviewStatusLabel(status: TranscriptOntologyReviewNode['reviewStatus']): string {
  if (status === 'proposed') return '미검수';
  if (status === 'deferred') return '보류';
  if (status === 'follow_up') return '후속 확인 중';
  if (status === 'merged') return '기존 node에 병합됨';
  return status;
}

function FollowUpRequest({ question }: { question: string | null }) {
  return question ? (
    <section aria-label="요청한 후속 확인" style={{ background: '#FFF8E7', border: `2px solid ${CONTROL_BORDER}`, borderRadius: 8, padding: 12 }}>
      <strong>요청한 후속 확인</strong>
      <p style={{ margin: '6px 0 0' }}>{question}</p>
      <small style={{ color: MUTED }}>응답이나 추가 근거를 확인한 뒤 이 후보를 다시 판단해야 합니다.</small>
    </section>
  ) : null;
}

export function TranscriptNodeReviewCard({ node, mergeTargets = [], reviewer, onDecision, onDraft }: {
  node: TranscriptOntologyReviewNode;
  mergeTargets?: TranscriptOntologyReviewNode[];
  reviewer: string;
  onDecision: (decision: TranscriptOntologyReviewDecision) => void;
  onDraft: (draft: TranscriptOntologyReviewDraft) => void;
}) {
  const kind = node.kind ?? node.kindCandidate;
  const edited = kind !== node.kindCandidate || node.label !== node.sourceLabel
    || node.text !== node.sourceText || node.minorityConcern;
  const decide = (status: 'deferred' | 'accepted' | 'edited' | 'rejected') => onDecision({
    itemType: 'node', id: node.id, status, kind, label: node.label, text: node.text,
    minorityConcern: node.minorityConcern, reviewer,
    reviewedAt: new Date().toISOString(),
  });
  const requestFollowUp = () => onDecision({
    itemType: 'node', id: node.id, status: 'follow_up',
    followUpQuestion: transcriptCandidateFacilitationPrompt(kind), reviewer,
    reviewedAt: new Date().toISOString(),
  });
  const eligibleMergeTargets = mergeTargets.filter((target) => (
    target.id !== node.id
    && (target.reviewStatus === 'accepted' || target.reviewStatus === 'edited')
    && target.kind === kind
  ));
  return (
    <article style={cardStyle} aria-label={`전사 노드 후보 검수 ${node.id}`}>
      <header>
        <strong>candidate node · {transcriptReviewStatusLabel(node.reviewStatus)}</strong>
        <div style={{ color: MUTED, fontSize: 13, overflowWrap: 'anywhere' }}>{node.sourceUid}</div>
      </header>
      <TranscriptEvidence transcript={node.transcript} />
      <label>Habermas 발화 역할
        <select value={kind} onChange={(event) => onDraft({ itemType: 'node', id: node.id, kind: event.currentTarget.value })} style={{ ...controlStyle, display: 'block', width: '100%' }}>
          {TRANSCRIPT_ONTOLOGY_NODE_KINDS.map((candidate) => <option key={candidate}>{candidate}</option>)}
        </select>
      </label>
      <TranscriptCandidatePrompt kind={kind} />
      <FollowUpRequest question={node.followUpQuestion} />
      <section aria-label="소수 우려 보존" style={{ background: node.minorityConcern ? '#FFF2E8' : '#F6F8FA', border: `2px solid ${CONTROL_BORDER}`, borderRadius: 8, padding: 12 }}>
        <strong>{node.minorityConcern ? '소수 우려로 표시됨' : '소수 우려 표시 안 됨'}</strong>
        <p style={{ color: MUTED, margin: '6px 0' }}>다수 의견에 흡수하지 않고 별도 Concern 신호로 보존합니다.</p>
        <button type="button" onClick={() => onDraft({
          itemType: 'node', id: node.id,
          kind: node.minorityConcern ? kind : 'Concern',
          minorityConcern: !node.minorityConcern,
        })} style={controlStyle}>
          {node.minorityConcern ? '소수 우려 표시 해제' : '소수 우려로 표시'}
        </button>
      </section>
      <section aria-label="기존 node 병합" style={{ background: '#F6F8FA', border: `2px solid ${CONTROL_BORDER}`, borderRadius: 8, padding: 12 }}>
        <strong>{node.reviewStatus === 'merged' ? `병합 대상 ${node.mergeTargetId}` : '중복 후보 병합'}</strong>
        <p style={{ color: MUTED, margin: '6px 0' }}>같은 역할로 먼저 검수한 node에 원 발화와 인용을 보존해 합칩니다.</p>
        {node.reviewStatus === 'merged' ? (
          <button type="button" onClick={() => onDraft({ itemType: 'node', id: node.id, kind })} style={controlStyle}>
            병합 해제 후 재검수
          </button>
        ) : eligibleMergeTargets.length ? eligibleMergeTargets.map((target) => (
          <button key={target.id} type="button" onClick={() => onDecision({
            itemType: 'node', id: node.id, status: 'merged', mergeTargetId: target.id,
            reviewer, reviewedAt: new Date().toISOString(),
          })} style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }}>
            {target.label}에 병합
          </button>
        )) : <small style={{ color: MUTED }}>먼저 같은 역할의 다른 node를 승인해 주세요.</small>}
      </section>
      <label>표시 이름
        <input value={node.label} onChange={(event) => onDraft({ itemType: 'node', id: node.id, label: event.currentTarget.value })} style={{ ...controlStyle, display: 'block', width: '100%' }} />
      </label>
      <label>검수 내용
        <textarea value={node.text} onChange={(event) => onDraft({ itemType: 'node', id: node.id, text: event.currentTarget.value })} rows={4} style={{ ...controlStyle, display: 'block', resize: 'vertical', width: '100%' }} />
      </label>
      <DecisionButtons
        acceptLabel={edited ? '수정 승인' : '원문 승인'}
        onAccept={() => decide(edited ? 'edited' : 'accepted')}
        onReject={() => decide('rejected')}
        onFollowUp={requestFollowUp}
        onDefer={() => decide('deferred')}
      />
    </article>
  );
}

export function TranscriptRelationReviewCard({ relation, reviewer, onDecision, onDraft }: {
  relation: TranscriptOntologyReviewRelation;
  reviewer: string;
  onDecision: (decision: TranscriptOntologyReviewDecision) => void;
  onDraft: (draft: TranscriptOntologyReviewDraft) => void;
}) {
  const relationType = relation.relation ?? relation.relationCandidate;
  const edited = relationType !== relation.relationCandidate;
  const decide = (status: 'deferred' | 'accepted' | 'edited' | 'rejected') => onDecision({
    itemType: 'relation', id: relation.id, status, relation: relationType, reviewer,
    reviewedAt: new Date().toISOString(),
  });
  const requestFollowUp = () => onDecision({
    itemType: 'relation', id: relation.id, status: 'follow_up',
    followUpQuestion: transcriptRelationFollowUpPrompt(relationType), reviewer,
    reviewedAt: new Date().toISOString(),
  });
  return (
    <article style={cardStyle} aria-label={`전사 관계 후보 검수 ${relation.id}`}>
      <header><strong>candidate relation · {transcriptReviewStatusLabel(relation.reviewStatus)}</strong></header>
      <p style={{ color: MUTED, margin: 0, overflowWrap: 'anywhere' }}>{relation.source} → {relation.target}</p>
      <TranscriptEvidence transcript={relation.transcript} />
      <FollowUpRequest question={relation.followUpQuestion} />
      <label>논증 관계
        <select value={relationType} onChange={(event) => {
          onDraft({ itemType: 'relation', id: relation.id, relation: event.currentTarget.value });
        }} style={{ ...controlStyle, display: 'block', width: '100%' }}>
          {TRANSCRIPT_ONTOLOGY_RELATIONS.map((candidate) => <option key={candidate}>{candidate}</option>)}
        </select>
      </label>
      <DecisionButtons
        acceptLabel={edited ? '수정 승인' : '승인'}
        onAccept={() => decide(edited ? 'edited' : 'accepted')}
        onReject={() => decide('rejected')}
        onFollowUp={requestFollowUp}
        onDefer={() => decide('deferred')}
      />
    </article>
  );
}

export function TranscriptOntologyReviewPanel({ reviewerId }: { reviewerId: string }) {
  const [fixtureFile, setFixtureFile] = useState<File | null>(null);
  const [reviewBatchFile, setReviewBatchFile] = useState<File | null>(null);
  const [extractionCandidatesFile, setExtractionCandidatesFile] = useState<File | null>(null);
  const [workspace, setWorkspace] = useState<TranscriptOntologyReviewWorkspace | null>(null);
  const [notice, setNotice] = useState('합성 전사 fixture를 선택해 주세요.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [publicationSourceId, setPublicationSourceId] = useState('live-transcript-r2-reviewed');
  const [exportedPlan, setExportedPlan] = useState<{
    workspace: TranscriptOntologyReviewWorkspace;
    content: string;
  } | null>(null);
  const requestGeneration = useRef(0);
  const workspaceRef = useRef<TranscriptOntologyReviewWorkspace | null>(null);
  const exportedPlanRef = useRef<typeof exportedPlan>(null);
  const publicationSourceIdRef = useRef(publicationSourceId);

  const invalidateExportedPlan = () => {
    exportedPlanRef.current = null;
    setExportedPlan(null);
  };

  const replaceFixture = (file: File | null) => {
    requestGeneration.current += 1;
    setFixtureFile(file);
    workspaceRef.current = null;
    invalidateExportedPlan();
    setWorkspace(null);
    setBusy(false);
    setError(null);
    setNotice('입력 fixture가 바뀌었습니다. 다시 검증해 주세요.');
  };

  const replaceHandoffFile = (kind: 'batch' | 'candidates', file: File | null) => {
    requestGeneration.current += 1;
    if (kind === 'batch') setReviewBatchFile(file);
    else setExtractionCandidatesFile(file);
    workspaceRef.current = null;
    invalidateExportedPlan();
    setWorkspace(null);
    setBusy(false);
    setError(null);
    setNotice('R4 handoff 입력이 바뀌었습니다. 두 파일을 다시 검증해 주세요.');
  };

  const loadWorkspace = async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setBusy(true);
    setError(null);
    try {
      const fixtureText = await readLocalJson(fixtureFile, '전사 ontology fixture JSON');
      const next = await createTranscriptOntologyReviewWorkspace(fixtureText);
      if (requestGeneration.current !== generation) return;
      workspaceRef.current = next;
      invalidateExportedPlan();
      setWorkspace(next);
      setNotice(`전사 후보 ${next.summary.total}개를 불러왔습니다.`);
    } catch (caught: unknown) {
      if (requestGeneration.current !== generation) return;
      console.error('Failed to load the local transcript ontology review workspace', caught);
      setError(errorMessage(caught));
    } finally {
      if (requestGeneration.current === generation) setBusy(false);
    }
  };

  const loadHandoffWorkspace = async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setBusy(true);
    setError(null);
    try {
      const [reviewBatchText, extractionCandidatesText] = await Promise.all([
        readLocalJson(reviewBatchFile, 'R4 검수 완료 전사 batch JSON'),
        readLocalJson(extractionCandidatesFile, 'provider-neutral ontology 후보 JSON'),
      ]);
      const fixtureText = await buildPrivateTranscriptOntologyFixture({ reviewBatchText, extractionCandidatesText });
      const next = await createTranscriptOntologyReviewWorkspace(fixtureText);
      if (requestGeneration.current !== generation) return;
      workspaceRef.current = next;
      invalidateExportedPlan();
      setWorkspace(next);
      setNotice(`R4 전사 provenance에 결속된 ontology 후보 ${next.summary.total}개를 불러왔습니다.`);
    } catch (caught: unknown) {
      if (requestGeneration.current !== generation) return;
      console.error('Failed to load the private transcript extraction handoff', caught);
      setError(errorMessage(caught));
    } finally {
      if (requestGeneration.current === generation) setBusy(false);
    }
  };

  const decide = (decision: TranscriptOntologyReviewDecision) => {
    if (!workspace) return;
    try {
      const next = reviewTranscriptOntologyCandidate(workspace, decision);
      workspaceRef.current = next;
      invalidateExportedPlan();
      setWorkspace(next);
      setError(null);
      setNotice(`전사 후보 검수 진행 ${next.summary.decided}/${next.summary.total}`);
    } catch (caught: unknown) {
      console.error('Failed to apply a local transcript ontology review decision', caught);
      setError(errorMessage(caught));
    }
  };

  const updateDraft = (draft: TranscriptOntologyReviewDraft) => {
    if (!workspace) return;
    try {
      const next = updateTranscriptOntologyCandidateDraft(workspace, draft);
      workspaceRef.current = next;
      invalidateExportedPlan();
      setWorkspace(next);
      setError(null);
      setNotice('화면 입력이 바뀌어 해당 판단을 다시 열었습니다. 현재 내용을 재판단해 주세요.');
    } catch (caught: unknown) {
      console.error('Failed to update a local transcript ontology review draft', caught);
      setError(errorMessage(caught));
    }
  };

  const exportPlan = async () => {
    if (!workspace) return;
    const target = workspace;
    setExporting(true);
    await completeTranscriptOntologyExport({
      build: () => exportTranscriptOntologyReviewedPlan(target),
      isCurrent: () => workspaceRef.current === target,
      download: (content) => {
        const exported = { workspace: target, content };
        exportedPlanRef.current = exported;
        setExportedPlan(exported);
        downloadTranscriptReviewedPlan(content, target.source.fixtureId);
      },
      setNotice,
      setError,
      setBusy: setExporting,
    });
  };

  const exportHandoffFixture = () => {
    if (!workspace?.source.handoff) return;
    try {
      downloadTranscriptHandoffFixture(workspace.source);
      setError(null);
      setNotice('R4 provenance에 결속된 R2 입력 fixture를 내려받았습니다. DB와 공개 graph는 변경하지 않았습니다.');
    } catch (caught: unknown) {
      console.error('Failed to download the private transcript ontology handoff fixture', caught);
      setError(errorMessage(caught));
    }
  };

  const exportPublicationApproval = async () => {
    const target = exportedPlanRef.current;
    if (!target) return;
    const sourceId = publicationSourceId.trim();
    setApproving(true);
    await completeTranscriptPublicationApprovalExport({
      build: () => buildTranscriptOntologyPublicationApproval({
        reviewedPlanText: target.content,
        sourceId,
        approvedBy: reviewerId,
        approvedAt: new Date().toISOString(),
      }),
      isCurrent: () => exportedPlanRef.current === target
        && workspaceRef.current === target.workspace
        && publicationSourceIdRef.current.trim() === sourceId,
      download: (content) => downloadTranscriptPublicationApproval(content, sourceId),
      setNotice,
      setError,
      setBusy: setApproving,
    });
  };

  return (
    <section aria-labelledby="transcript-review-heading" style={{ marginBottom: 36 }}>
      <header style={{ marginBottom: 12 }}>
        <h2 id="transcript-review-heading">전사 ontology 후보 검수</h2>
        <p style={{ color: MUTED, lineHeight: 1.6 }}>
          candidate node와 relation을 브라우저 메모리에서만 검수합니다. DB 저장·공개 graph 반영은 없습니다.
          {' '}승인된 consent·retention 정책 전에는 실제 시민 발언 파일을 넣지 마세요.
        </p>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); void loadHandoffWorkspace(); }} aria-busy={busy} style={{ ...cardStyle, background: PANEL, marginBottom: 16 }}>
        <strong>R4 검수 batch → provider-neutral extraction handoff</strong>
        <p style={{ color: MUTED, margin: 0 }}>
          검수 완료 batch의 exact SHA-256과 capture·session·audio provenance가 일치하는 후보만 R2 사람 검수 큐로 엽니다. 외부 extraction은 호출하지 않습니다.
        </p>
        <label>R4 검수 완료 전사 batch JSON
          <input type="file" accept="application/json,.json" onChange={(event) => replaceHandoffFile('batch', event.currentTarget.files?.[0] ?? null)} style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
        </label>
        <label>provider-neutral ontology 후보 JSON
          <input type="file" accept="application/json,.json" onChange={(event) => replaceHandoffFile('candidates', event.currentTarget.files?.[0] ?? null)} style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
        </label>
        <button type="submit" disabled={busy || reviewBatchFile === null || extractionCandidatesFile === null} style={{ ...controlStyle, background: '#0B4F6C', color: '#FFFFFF', fontWeight: 800 }}>
          {busy ? '검증 중…' : 'R4 handoff 로컬 검수 시작'}
        </button>
      </form>
      <form onSubmit={(event) => { event.preventDefault(); void loadWorkspace(); }} aria-busy={busy} style={{ ...cardStyle, background: PANEL, marginBottom: 16 }}>
        <strong>기존 synthetic fixture 검증</strong>
        <label>전사 ontology fixture JSON
          <input type="file" accept="application/json,.json" onChange={(event) => replaceFixture(event.currentTarget.files?.[0] ?? null)} style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
        </label>
        <p style={{ color: MUTED, margin: 0, overflowWrap: 'anywhere' }}>
          인증 검수자 ID <code>{reviewerId}</code>
        </p>
        <button type="submit" disabled={busy || fixtureFile === null} style={{ ...controlStyle, background: '#0B4F6C', color: '#FFFFFF', fontWeight: 800 }}>
          {busy ? '검증 중…' : '전사 후보 로컬 검수 시작'}
        </button>
      </form>
      <p role="status" aria-live="polite" aria-atomic="true" style={{ color: '#174A36' }}>{notice}</p>
      {error ? <p role="alert" style={{ color: '#8A1C1C', fontWeight: 700 }}>{error}</p> : null}
      {workspace ? (
        <>
          <section aria-label="전사 후보 검수 진행 요약" role="status" aria-live="polite" aria-atomic="true" style={{ ...cardStyle, marginBottom: 20 }}>
            <strong>진행 {workspace.summary.decided}/{workspace.summary.total} · 후속 확인 {workspace.summary.followUp} · 보류 {workspace.summary.deferred}</strong>
            <span>candidate node {workspace.summary.nodes} · relation {workspace.summary.relations}</span>
            {workspace.source.handoff ? (
              <>
                <span style={{ color: MUTED, overflowWrap: 'anywhere' }}>
                  R4 batch SHA-256 {workspace.source.handoff.reviewBatchSha256} · candidate set {workspace.source.handoff.candidateSetId}
                </span>
                <button type="button" onClick={exportHandoffFixture} style={{ ...controlStyle, background: '#FFFFFF', color: '#0B4F6C', fontWeight: 800 }}>
                  R4 결속 fixture 다운로드
                </button>
              </>
            ) : null}
            <button type="button" onClick={() => { void exportPlan(); }} disabled={exporting || workspace.summary.decided !== workspace.summary.total} style={{ ...controlStyle, background: '#553C9A', color: '#FFFFFF', fontWeight: 800 }}>
              {exporting ? 'plan 검증 중…' : '전사 후보 검수 plan 다운로드'}
            </button>
            <label>공개 source ID
              <input
                type="text"
                value={publicationSourceId}
                pattern="live-[a-z0-9][a-z0-9._-]*"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  publicationSourceIdRef.current = value;
                  setPublicationSourceId(value);
                }}
                style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }}
              />
            </label>
            <p style={{ color: MUTED, margin: 0 }}>
              먼저 현재 검수 plan을 내려받아 고정한 뒤 승인 artifact를 만듭니다. 이 작업은 DB와 공개 graph를 쓰지 않습니다.
            </p>
            <button
              type="button"
              onClick={() => { void exportPublicationApproval(); }}
              disabled={approving || exportedPlan === null || !TRANSCRIPT_PUBLICATION_SOURCE_PATTERN.test(publicationSourceId.trim())}
              style={{ ...controlStyle, background: '#165B33', color: '#FFFFFF', fontWeight: 800 }}
            >
              {approving ? '승인 artifact 검증 중…' : '공개 승인 artifact 다운로드'}
            </button>
          </section>
          <section aria-labelledby="transcript-node-heading" style={{ display: 'grid', gap: 14, marginBottom: 28 }}>
            <h3 id="transcript-node-heading">1. candidate node · 전사·Habermas 역할 검수</h3>
            {workspace.nodes.map((node) => (
              <TranscriptNodeReviewCard key={`${workspace.source.fixtureSha256}:${node.id}`} node={node} mergeTargets={workspace.nodes} reviewer={reviewerId} onDecision={decide} onDraft={updateDraft} />
            ))}
          </section>
          <section aria-labelledby="transcript-relation-heading" style={{ display: 'grid', gap: 14, marginBottom: 28 }}>
            <h3 id="transcript-relation-heading">2. candidate relation · 전사·논증 관계 검수</h3>
            {workspace.relations.map((relation) => (
              <TranscriptRelationReviewCard key={`${workspace.source.fixtureSha256}:${relation.id}`} relation={relation} reviewer={reviewerId} onDecision={decide} onDraft={updateDraft} />
            ))}
          </section>
        </>
      ) : null}
    </section>
  );
}

export function AuthenticatedOntologyReviewWorkspace({
  email,
  reviewerId,
  loggingOut,
  logoutError,
  onLogout,
}: {
  email: string | null;
  reviewerId: string;
  loggingOut: boolean;
  logoutError: string | null;
  onLogout: () => void;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [snapshotFile, setSnapshotFile] = useState<File | null>(null);
  const [workspace, setWorkspace] = useState<CanvasOntologyReviewWorkspace | null>(null);
  const [notice, setNotice] = useState('검수 계획과 원 snapshot을 선택해 주세요.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);

  useEffect(() => setHydrated(true), []);

  const loadWorkspace = async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    setBusy(true);
    setError(null);
    await completeOntologyWorkspaceLoad({
      load: async () => {
        const [planText, snapshotText] = await Promise.all([
          readLocalJson(planFile, '검수 계획 JSON'),
          readLocalJson(snapshotFile, 'Canvas snapshot JSON'),
        ]);
        return createCanvasOntologyReviewWorkspace({ planText, snapshotText });
      },
      isCurrent: () => requestGeneration.current === generation,
      setWorkspace,
      setNotice,
      setError,
      setBusy,
    });
  };

  const replaceInputFile = (kind: 'plan' | 'snapshot', file: File | null) => {
    requestGeneration.current += 1;
    setBusy(false);
    setWorkspace(null);
    setError(null);
    setNotice('입력 파일이 바뀌었습니다. 두 파일을 다시 검증해 주세요.');
    if (kind === 'plan') setPlanFile(file);
    else setSnapshotFile(file);
  };

  const decide = (decision: CanvasOntologyReviewDecision) => {
    if (!workspace) return;
    try {
      const next = reviewCanvasOntologyItem(workspace, decision);
      setWorkspace(next);
      setError(null);
      setNotice(`검수 진행 ${next.summary.decided}/${next.summary.total}`);
    } catch (caught: unknown) {
      console.error('Failed to apply a local Canvas ontology review decision', caught);
      setError(errorMessage(caught));
    }
  };

  const exportPlan = () => {
    if (!workspace) return;
    try {
      downloadReviewedPlan(exportCanvasOntologyReviewedPlan(workspace), workspace.source.snapshotId);
      setError(null);
      setNotice('검수 완료 plan을 내려받았습니다. 공개 반영은 별도 검증이 필요합니다.');
    } catch (caught: unknown) {
      console.error('Failed to export the local Canvas ontology reviewed plan', caught);
      setError(errorMessage(caught));
    }
  };

  return (
    <main
      id="ontology-review-content"
      data-ontology-review-ready={hydrated ? 'true' : undefined}
      tabIndex={-1}
      style={{ background: '#E9F1F5', color: INK, minHeight: '100%', padding: 24 }}
    >
      <div style={{ margin: '0 auto', maxWidth: 1180 }}>
        <header style={{ marginBottom: 20 }}>
          <h1 style={{ marginBottom: 8 }}>Canvas 온톨로지 검수 큐</h1>
          <p style={{ color: MUTED, lineHeight: 1.6, margin: 0 }}>
            sealed 검수 계획과 원 snapshot을 브라우저 메모리에서만 대조합니다. DB에 저장하지 않습니다.
            {' '}공개 그래프에 반영하지 않습니다.
          </p>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', marginTop: 12 }}>
            <span style={{ color: MUTED, fontSize: 14, overflowWrap: 'anywhere' }}>
              인증된 진행자 {email ?? '이메일 미표시 계정'} · 검수 기록 <code>{reviewerId}</code>
            </span>
            <button type="button" onClick={onLogout} disabled={loggingOut} style={{ ...controlStyle, fontWeight: 800 }}>
              {loggingOut ? '로그아웃 중…' : '로그아웃'}
            </button>
          </div>
          {logoutError ? <p role="alert" style={{ color: '#8A1C1C', fontWeight: 700 }}>{logoutError}</p> : null}
        </header>

        <PrivateTranscriptCapturePanel reviewerId={reviewerId} />

        <TranscriptOntologyReviewPanel reviewerId={reviewerId} />

        <section aria-labelledby="canvas-review-heading">
          <h2 id="canvas-review-heading">Canvas 검수 계획</h2>

        <form onSubmit={(event) => { event.preventDefault(); void loadWorkspace(); }} aria-busy={busy} style={{ ...cardStyle, background: PANEL, marginBottom: 20 }}>
          <label>검수 계획 JSON
            <input type="file" accept="application/json,.json" onChange={(event) => replaceInputFile('plan', event.currentTarget.files?.[0] ?? null)} style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
          </label>
          <label>Canvas snapshot JSON
            <input type="file" accept="application/json,.json" onChange={(event) => replaceInputFile('snapshot', event.currentTarget.files?.[0] ?? null)} style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
          </label>
          <p style={{ color: MUTED, margin: 0, overflowWrap: 'anywhere' }}>
            인증 검수자 ID <code>{reviewerId}</code>
          </p>
          <button type="submit" disabled={busy || planFile === null || snapshotFile === null} style={{ ...controlStyle, background: '#0B4F6C', color: '#FFFFFF', fontWeight: 800 }}>
            {busy ? '검증 중…' : '로컬 검수 시작'}
          </button>
        </form>

        <p role="status" aria-live="polite" aria-atomic="true" style={{ color: '#174A36' }}>{notice}</p>
        {error ? <p role="alert" style={{ color: '#8A1C1C', fontWeight: 700 }}>{error}</p> : null}

        {workspace ? (
          <>
            <section aria-label="검수 진행 요약" style={{ ...cardStyle, marginBottom: 20 }}>
              <strong>진행 {workspace.summary.decided}/{workspace.summary.total}</strong>
              <span>노드 {workspace.summary.nodes} · 관계 {workspace.summary.relations} · 군집 {workspace.summary.clusters}</span>
              <button type="button" onClick={exportPlan} disabled={workspace.summary.decided !== workspace.summary.total} style={{ ...controlStyle, background: '#553C9A', color: '#FFFFFF', fontWeight: 800 }}>
                검수 완료 plan 다운로드
              </button>
            </section>

            <FacilitationPromptPanel prompts={canvasFacilitationPrompts(workspace)} />

            <section aria-labelledby="node-review-heading" style={{ display: 'grid', gap: 14, marginBottom: 28 }}>
              <h2 id="node-review-heading">1. 노드 역할·문구 검수</h2>
              {workspace.plan.nodes.map((node) => <NodeReviewCard key={`${workspace.plan.integrity.planSha256}:${node.id}`} node={node} reviewer={reviewerId} onDecision={decide} />)}
            </section>
            <section aria-labelledby="relation-review-heading" style={{ display: 'grid', gap: 14, marginBottom: 28 }}>
              <h2 id="relation-review-heading">2. 관계 검수</h2>
              {workspace.plan.relations.map((relation) => <RelationReviewCard key={`${workspace.plan.integrity.planSha256}:${relation.id}`} relation={relation} reviewer={reviewerId} onDecision={decide} />)}
            </section>
            <section aria-labelledby="cluster-review-heading" style={{ display: 'grid', gap: 14, marginBottom: 28 }}>
              <h2 id="cluster-review-heading">3. 군집 대표 Issue 검수</h2>
              {workspace.plan.clusters.map((cluster) => (
                <ClusterReviewCard key={`${workspace.plan.integrity.planSha256}:${cluster.sourceSessionId}:${cluster.groupId}`} cluster={cluster} nodes={workspace.plan.nodes} reviewer={reviewerId} onDecision={decide} />
              ))}
            </section>
          </>
        ) : null}
        </section>
      </div>
    </main>
  );
}

export function OntologyReviewLoginBoundary({
  email,
  password,
  busy,
  error,
  hydrated,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: {
  email: string;
  password: string;
  busy: boolean;
  error: string | null;
  hydrated: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <main data-ontology-review-auth-ready={hydrated ? 'true' : 'false'} id="ontology-review-content" tabIndex={-1} style={{ alignItems: 'center', background: '#E9F1F5', color: INK, display: 'flex', minHeight: '70vh', padding: 24 }}>
      <form
        aria-busy={busy}
        onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
        style={{ ...cardStyle, margin: '0 auto', maxWidth: 440, width: '100%' }}
      >
        <h1 style={{ margin: 0 }}>온톨로지 검수 진행자 로그인</h1>
        <p style={{ color: MUTED, lineHeight: 1.6, margin: 0 }}>
          마이크·전사·검수 파일은 인증 후에만 브라우저 메모리에서 처리합니다.
        </p>
        <label>이메일 주소
          <input
            aria-label="온톨로지 검수 이메일 주소"
            autoComplete="username"
            disabled={busy}
            onChange={(event) => onEmailChange(event.currentTarget.value)}
            type="email"
            value={email}
            style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }}
          />
        </label>
        <label>비밀번호
          <input
            aria-label="온톨로지 검수 비밀번호"
            autoComplete="current-password"
            disabled={busy}
            onChange={(event) => onPasswordChange(event.currentTarget.value)}
            type="password"
            value={password}
            style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }}
          />
        </label>
        <button type="submit" disabled={busy || email.trim().length === 0 || password.length === 0} style={{ ...controlStyle, background: '#0B4F6C', color: '#FFFFFF', fontWeight: 800 }}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        {error ? <p role="alert" style={{ color: '#8A1C1C', fontWeight: 700, margin: 0 }}>{error}</p> : null}
      </form>
    </main>
  );
}

export default function OntologyReviewConsole() {
  const { session, email: authenticatedEmail, initializationError, signIn, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authHydrated, setAuthHydrated] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const authOperationLock = useRef(false);

  useEffect(() => { setAuthHydrated(true); }, []);

  const submitLogin = async () => {
    if (email.trim().length === 0 || password.length === 0 || authOperationLock.current) return;
    await runExclusiveCanvasAuthOperation(authOperationLock, async () => {
      setAuthError(null);
      const { error } = await signIn(email.trim(), password);
      if (error) {
        console.error('Ontology review sign-in failed', error);
        setAuthError(error.message);
        return;
      }
      setEmail('');
      setPassword('');
    }, setLoggingIn);
  };

  const submitLogout = async () => {
    if (authOperationLock.current) return;
    await runExclusiveCanvasAuthOperation(authOperationLock, async () => {
      setAuthError(null);
      const { error } = await signOut();
      if (error) {
        console.error('Ontology review sign-out failed', error);
        setAuthError(error.message);
      }
    }, setLoggingOut);
  };

  if (!session) {
    return (
      <OntologyReviewLoginBoundary
        email={email}
        password={password}
        busy={loggingIn}
        error={authError ?? initializationError}
        hydrated={authHydrated}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={() => void submitLogin()}
      />
    );
  }

  const reviewerId = authenticatedReviewerId(session.user.id);
  if (reviewerId === null) {
    console.error('Ontology review auth user ID is not a valid Supabase UUID');
    return (
      <main id="ontology-review-content" tabIndex={-1} style={{ background: '#E9F1F5', color: INK, minHeight: '70vh', padding: 24 }}>
        <h1>온톨로지 검수 사용자 확인 실패</h1>
        <p role="alert">인증 사용자 식별자를 확인할 수 없습니다. 로그아웃 후 승인된 계정으로 다시 로그인해 주세요.</p>
        <button type="button" onClick={() => void submitLogout()} disabled={loggingOut} style={{ ...controlStyle, fontWeight: 800 }}>로그아웃</button>
      </main>
    );
  }

  return (
    <AuthenticatedOntologyReviewWorkspace
      key={session.user.id}
      email={authenticatedEmail}
      reviewerId={reviewerId}
      loggingOut={loggingOut}
      logoutError={authError}
      onLogout={() => void submitLogout()}
    />
  );
}
