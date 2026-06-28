#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const wikiRoot = resolve(__dirname, '..');
const reportPath = join(wikiRoot, 'evaluation', 'graph-source-coverage-report.json');
const outPath = join(wikiRoot, 'public', 'workshop-graph', 'data', 'source-coverage-2026-06-13.json');

const KIND_KO = {
  Issue: '쟁점',
  Claim: '주장',
  Proposal: '정책대안',
  Concern: '우려',
  Condition: '조건',
  Value: '가치',
  Evidence: '근거',
};

const REL_KO = {
  isAbout: '관련',
  hasEvidence: '근거',
  supports: '지지',
  hasConcern: '우려',
  requiresCondition: '조건필요',
};

function slug(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'unknown';
}

function addNode(nodes, data) {
  const node = {
    data: {
      kindKo: KIND_KO[data.kind] || data.kind,
      cited: data.cited || [],
      cited_uids: data.cited || [],
      synthesized: false,
      is_public: true,
      deg: 0,
      isolated: true,
      ...data,
    },
  };
  nodes.push(node);
  return node.data.id;
}

function addEdge(edges, source, target, rel, meta = {}) {
  edges.push({
    data: {
      id: `e_${edges.length}`,
      source,
      target,
      rel,
      relKo: REL_KO[rel] || rel,
      opposes: rel === 'hasConcern' || undefined,
      meta,
    },
  });
}

function applyDegree(nodes, edges) {
  const degree = new Map();
  for (const edge of edges) {
    degree.set(edge.data.source, (degree.get(edge.data.source) || 0) + 1);
    degree.set(edge.data.target, (degree.get(edge.data.target) || 0) + 1);
  }
  for (const node of nodes) {
    const deg = degree.get(node.data.id) || 0;
    node.data.deg = deg;
    node.data.isolated = deg === 0;
  }
}

function bytesText(bytes) {
  if (bytes === null || bytes === undefined) return 'n/a';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function main() {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const nodes = [];
  const edges = [];

  const hub = addNode(nodes, {
    id: 'coverage::hub',
    label: '6/13-14 원본자료 연결상태',
    kind: 'Issue',
    session: 'coverage',
    text: `원본 ${report.original_file_count}건, 텍스트 ${report.text_file_count}건, 그래프 세션 반영 상태를 함께 점검합니다. 이 화면은 AI가 내용을 새로 판단한 것이 아니라 원본-전사-그래프 연결상태를 표시합니다.`,
  });

  const originalHub = addNode(nodes, {
    id: 'coverage::originals',
    label: `원본자료 ${report.original_file_count}건`,
    kind: 'Evidence',
    session: 'coverage',
    text: report.original_dir,
  });
  addEdge(edges, hub, originalHub, 'hasEvidence');

  for (const file of report.original_files || []) {
    const id = `original::${slug(file.name)}`;
    addNode(nodes, {
      id,
      label: file.name,
      kind: 'Evidence',
      session: 'original',
      text: `${file.rel}\n크기: ${bytesText(file.bytes)}\n수정: ${file.modified}`,
      cited: [file.rel],
    });
    addEdge(edges, originalHub, id, 'hasEvidence');
  }

  const graphHub = addNode(nodes, {
    id: 'coverage::graphs',
    label: '공개 그래프 데이터',
    kind: 'Claim',
    session: 'coverage',
    text: Object.entries(report.graph_summaries || {})
      .map(([file, summary]) => `${file}: ${summary.nodes} nodes / ${summary.edges} edges`)
      .join('\n'),
  });
  addEdge(edges, hub, graphHub, 'supports');

  const issueHub = addNode(nodes, {
    id: 'coverage::issues',
    label: `재확인 필요 ${report.issues?.length || 0}건`,
    kind: report.issues?.length ? 'Concern' : 'Claim',
    session: 'coverage',
    text: (report.issues || []).map(issue => `${issue.tag}: ${issue.note}`).join('\n') || '특이사항 없음',
  });
  addEdge(edges, hub, issueHub, report.issues?.length ? 'hasConcern' : 'supports');

  for (const session of report.sessions || []) {
    const status = session.status;
    const id = `session::${session.tag}`;
    const isReady = status === 'ready';
    const isGap = status === 'ui_or_graph_gap';
    const kind = isReady ? 'Claim' : isGap ? 'Condition' : 'Concern';
    addNode(nodes, {
      id,
      label: session.label,
      kind,
      session: session.tag,
      text: [
        `태그: ${session.tag}`,
        `종합 상태: ${session.status}`,
        `전사 상태: ${session.transcription?.status}`,
        `전사 chunk/json: ${session.transcription?.chunks_transcript_json}/${session.transcription?.chunks_mp3}`,
        `txt/srt: ${bytesText(session.transcription?.txt_bytes)} / ${bytesText(session.transcription?.srt_bytes)}`,
        `그래프 노드: ${session.graph_nodes}`,
        `그래프 상태: ${session.graph_status}`,
        `폴더: ${session.folder}`,
      ].join('\n'),
    });
    addEdge(edges, hub, id, isReady ? 'supports' : 'hasConcern');

    const transcriptId = `transcript::${session.tag}`;
    addNode(nodes, {
      id: transcriptId,
      label: `${session.label} 전사`,
      kind: session.transcription?.status === 'transcript_ready' ? 'Evidence' : 'Concern',
      session: session.tag,
      text: [
        session.transcription?.dir,
        `main json: ${bytesText(session.transcription?.main_json_bytes)}`,
        `txt: ${bytesText(session.transcription?.txt_bytes)}`,
        `srt: ${bytesText(session.transcription?.srt_bytes)}`,
        `tmp: ${(session.transcription?.chunks_tmp || []).join(', ') || '없음'}`,
      ].join('\n'),
    });
    addEdge(edges, id, transcriptId, session.transcription?.status === 'transcript_ready' ? 'hasEvidence' : 'hasConcern');

    const graphId = `graph::${session.tag}`;
    addNode(nodes, {
      id: graphId,
      label: `${session.tag} 그래프 반영 ${session.graph_nodes}`,
      kind: session.graph_nodes > 0 ? 'Claim' : 'Concern',
      session: session.tag,
      text: `${session.graph}: ${session.graph_nodes} nodes\n${session.graph_status}`,
    });
    addEdge(edges, id, graphId, session.graph_nodes > 0 ? 'supports' : 'hasConcern');
  }

  for (const text of report.text_sessions || []) {
    const id = `text::${text.tag}`;
    addNode(nodes, {
      id,
      label: text.label,
      kind: text.status === 'ready' ? 'Evidence' : 'Concern',
      session: text.tag,
      text: [
        `파일: ${text.file}`,
        `경로: ${text.path}`,
        `크기: ${bytesText(text.bytes)}`,
        `그래프 노드: ${text.graph_nodes}`,
        `상태: ${text.status}`,
      ].join('\n'),
      cited: [text.path],
    });
    addEdge(edges, hub, id, text.status === 'ready' ? 'hasEvidence' : 'hasConcern');
  }

  for (const issue of report.issues || []) {
    const id = `issue::${issue.tag}`;
    addNode(nodes, {
      id,
      label: `${issue.label} 재확인`,
      kind: 'Concern',
      session: issue.tag,
      text: [
        `상태: ${issue.status}`,
        `전사: ${issue.transcription_status}`,
        `그래프: ${issue.graph_status}`,
        issue.note,
      ].join('\n'),
    });
    addEdge(edges, issueHub, id, 'hasConcern');
    addEdge(edges, `session::${issue.tag}`, id, 'hasConcern');
  }

  applyDegree(nodes, edges);

  const out = {
    elements: { nodes, edges },
    meta: {
      variant: 'source-coverage',
      generated_at: new Date().toISOString(),
      counts: {
        nodes: nodes.length,
        edges: edges.length,
        source_original_files: report.original_file_count,
        issues: report.issues?.length || 0,
      },
      kinds: Object.fromEntries(Object.keys(KIND_KO).map(kind => [kind, nodes.filter(node => node.data.kind === kind).length])),
      advisory_notice: '원본-전사-그래프 연결상태 표시용입니다. 내용 판단이나 합의 생성이 아니라 누락/부분반영 점검을 돕습니다.',
    },
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(`wrote ${outPath}`);
  console.log(`nodes=${nodes.length} edges=${edges.length} originals=${report.original_file_count} issues=${report.issues?.length || 0}`);
}

main();
