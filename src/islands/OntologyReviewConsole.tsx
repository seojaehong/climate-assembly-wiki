import { useRef, useState, type CSSProperties } from 'react';
import {
  createCanvasOntologyReviewWorkspace,
  exportCanvasOntologyReviewedPlan,
  reviewCanvasOntologyItem,
  type CanvasOntologyCluster,
  type CanvasOntologyNode,
  type CanvasOntologyRelation,
  type CanvasOntologyReviewDecision,
  type CanvasOntologyReviewWorkspace,
} from './canvas/ontology-review-workspace';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CONTROL_BORDER = '#2F6F7E';
const PANEL = '#F3F8FA';
const INK = '#102A43';
const MUTED = '#526777';

const controlStyle: CSSProperties = {
  border: `2px solid ${CONTROL_BORDER}`,
  borderRadius: 8,
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

function DecisionButtons({ onAccept, onReject, acceptLabel = '승인' }: {
  onAccept: () => void;
  onReject: () => void;
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
    </div>
  );
}

function NodeReviewCard({ node, reviewer, onDecision }: {
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
    <article style={cardStyle} aria-label={`노드 검수 ${node.id}`}>
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

export default function OntologyReviewConsole() {
  const [planFile, setPlanFile] = useState<File | null>(null);
  const [snapshotFile, setSnapshotFile] = useState<File | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [workspace, setWorkspace] = useState<CanvasOntologyReviewWorkspace | null>(null);
  const [notice, setNotice] = useState('검수 계획과 원 snapshot을 선택해 주세요.');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestGeneration = useRef(0);

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
    if (reviewer.trim().length === 0) {
      setError('검수자 역할 ID를 먼저 입력해 주세요.');
      return;
    }
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
    <main id="ontology-review-content" tabIndex={-1} style={{ background: '#E9F1F5', color: INK, minHeight: '100%', padding: 24 }}>
      <div style={{ margin: '0 auto', maxWidth: 1180 }}>
        <header style={{ marginBottom: 20 }}>
          <h1 style={{ marginBottom: 8 }}>Canvas 온톨로지 검수 큐</h1>
          <p style={{ color: MUTED, lineHeight: 1.6, margin: 0 }}>
            sealed 검수 계획과 원 snapshot을 브라우저 메모리에서만 대조합니다. DB에 저장하지 않습니다.
            {' '}공개 그래프에 반영하지 않습니다.
          </p>
        </header>

        <form onSubmit={(event) => { event.preventDefault(); void loadWorkspace(); }} aria-busy={busy} style={{ ...cardStyle, background: PANEL, marginBottom: 20 }}>
          <label>검수 계획 JSON
            <input type="file" accept="application/json,.json" onChange={(event) => replaceInputFile('plan', event.currentTarget.files?.[0] ?? null)} style={{ display: 'block', marginTop: 6 }} />
          </label>
          <label>Canvas snapshot JSON
            <input type="file" accept="application/json,.json" onChange={(event) => replaceInputFile('snapshot', event.currentTarget.files?.[0] ?? null)} style={{ display: 'block', marginTop: 6 }} />
          </label>
          <label>검수자 역할 ID
            <input value={reviewer} onChange={(event) => setReviewer(event.currentTarget.value)} minLength={3} maxLength={80} pattern="[a-zA-Z][a-zA-Z0-9._:-]{2,79}" autoComplete="off" placeholder="예: moderator-role-1" style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
          </label>
          <button type="submit" disabled={busy || planFile === null || snapshotFile === null || reviewer.trim().length < 3} style={{ ...controlStyle, background: '#0B4F6C', color: '#FFFFFF', fontWeight: 800 }}>
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

            <section aria-labelledby="node-review-heading" style={{ display: 'grid', gap: 14, marginBottom: 28 }}>
              <h2 id="node-review-heading">1. 노드 역할·문구 검수</h2>
              {workspace.plan.nodes.map((node) => <NodeReviewCard key={`${workspace.plan.integrity.planSha256}:${node.id}`} node={node} reviewer={reviewer} onDecision={decide} />)}
            </section>
            <section aria-labelledby="relation-review-heading" style={{ display: 'grid', gap: 14, marginBottom: 28 }}>
              <h2 id="relation-review-heading">2. 관계 검수</h2>
              {workspace.plan.relations.map((relation) => <RelationReviewCard key={`${workspace.plan.integrity.planSha256}:${relation.id}`} relation={relation} reviewer={reviewer} onDecision={decide} />)}
            </section>
            <section aria-labelledby="cluster-review-heading" style={{ display: 'grid', gap: 14, marginBottom: 28 }}>
              <h2 id="cluster-review-heading">3. 군집 대표 Issue 검수</h2>
              {workspace.plan.clusters.map((cluster) => (
                <ClusterReviewCard key={`${workspace.plan.integrity.planSha256}:${cluster.sourceSessionId}:${cluster.groupId}`} cluster={cluster} nodes={workspace.plan.nodes} reviewer={reviewer} onDecision={decide} />
              ))}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
