#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pathFromRoot = (...parts) => join(root, ...parts);

function readJson(relativePath) {
  return JSON.parse(readFileSync(pathFromRoot(relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  const outPath = pathFromRoot(relativePath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(relativePath, value) {
  const outPath = pathFromRoot(relativePath);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, value);
}

function graphNodes(graph) {
  return graph.elements?.nodes || [];
}

function graphEdges(graph) {
  return graph.elements?.edges || [];
}

function countBySession(graph) {
  const counts = new Map();
  for (const node of graphNodes(graph)) {
    const id = String(node.data?.id || '');
    const session = node.data?.session || id.split('__')[0] || 'unknown';
    counts.set(session, (counts.get(session) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko')));
}

function nodeKind(node) {
  return String(node.data?.kind || '');
}

function nodeText(node) {
  return String(node.data?.text || '');
}

function statusFromText(text) {
  const status = text.match(/종합 상태: ([^\n]+)/)?.[1] || '';
  const transcript = text.match(/전사 상태: ([^\n]+)/)?.[1] || '';
  const graphNodesText = text.match(/그래프 노드: ([^\n]+)/)?.[1] || '';
  const graphStatus = text.match(/그래프 상태: ([^\n]+)/)?.[1] || '';
  return {
    status,
    transcript,
    graphNodes: Number.parseInt(graphNodesText, 10) || 0,
    graphStatus,
  };
}

function listInputMarkdown() {
  const dir = pathFromRoot('public', 'workshop-graph', 'inputs');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.md')
    .filter((entry) => !/^readme\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

function classifySourceMenu(sources) {
  return {
    default: sources.default,
    categories: sources.categories,
    exposedSourceIds: sources.sources.map((source) => source.id),
    hasAOnlyLivePublicSource: sources.sources.some((source) => source.id === 'live-A_t1' || /A조/.test(source.label || '')),
    finalProcessIsDefault: sources.default === 'final-process-to-conclusion-0704',
  };
}

const sourceCoverage = readJson('public/workshop-graph/data/source-coverage-2026-06-13.json');
const workshop = readJson('public/workshop-graph/data/workshop-2026-06-13.json');
const regulation = readJson('public/workshop-graph/data/regulation-2026-06-13.json');
const process = readJson('public/workshop-graph/data/final-process-to-conclusion-0704.json');
const agenda = readJson('public/workshop-graph/data/final-agenda-decisions-0704.json');
const finalRegulation = readJson('public/workshop-graph/data/final-regulation-decisions-0704.json');
const agendaVote = readJson('public/agenda-vote-0704/data.json');
const decisionVote = readJson('public/0704-admin/decision-votes-report.json');
const sources = readJson('public/workshop-graph/sources.json');

const coverageNodes = graphNodes(sourceCoverage);
const originalNodes = coverageNodes.filter((node) => String(node.data?.id || '').startsWith('original::'));
const sessionNodes = coverageNodes.filter((node) => String(node.data?.id || '').startsWith('session::'));
const textNodes = coverageNodes.filter((node) => String(node.data?.id || '').startsWith('text::'));
const issueNodes = coverageNodes.filter((node) => String(node.data?.id || '').startsWith('issue::'));

const sessions = sessionNodes.map((node) => {
  const parsed = statusFromText(nodeText(node));
  return {
    id: node.data.id,
    label: node.data.label,
    kind: nodeKind(node),
    session: node.data.session,
    ...parsed,
  };
});

const partialOrGap = sessions.filter((session) => ['Concern', 'Condition'].includes(session.kind) || session.status !== 'ready');
const readySessions = sessions.filter((session) => !partialOrGap.some((item) => item.id === session.id));
const workshopSessionCounts = countBySession(workshop);
const processNodeLabels = graphNodes(process).map((node) => node.data?.label || '');

const expectedPublicSources = [
  'final-process-to-conclusion-0704',
  'final-regulation-decisions-0704',
  'final-agenda-decisions-0704',
  'workshop-2026-06-13',
  'source-coverage-2026-06-13',
  'regulation-2026-06-13',
];
const missingPublicSources = expectedPublicSources.filter((id) => !sources.sources.some((source) => source.id === id));

const report = {
  generated_at: new Date().toISOString(),
  conclusion: {
    allDataCompletelyReflected: false,
    aOnlyDataClaimIsFalse: true,
    publicMenuAOnlyRiskResolved: !classifySourceMenu(sources).hasAOnlyLivePublicSource,
    processOntologyLinksConclusionPath: process.meta?.variant === 'final-process-to-conclusion-0704'
      && processNodeLabels.some((label) => /원본자료/.test(label))
      && processNodeLabels.some((label) => /통합 워크숍 그래프/.test(label))
      && processNodeLabels.some((label) => /7\.4 투표/.test(label))
      && processNodeLabels.some((label) => /최종 운영규정·의제 결론/.test(label)),
  },
  inventory: {
    sourceCoverage: {
      nodes: graphNodes(sourceCoverage).length,
      edges: graphEdges(sourceCoverage).length,
      originalFiles: originalNodes.length,
      audioOrDocumentSessions: sessionNodes.length,
      textInputsInCoverageGraph: textNodes.length,
      reviewIssueNodes: issueNodes.length,
    },
    workflowInputMarkdownFiles: listInputMarkdown(),
    graphs: {
      workshop: { nodes: graphNodes(workshop).length, edges: graphEdges(workshop).length, sessionCounts: workshopSessionCounts },
      regulation: { nodes: graphNodes(regulation).length, edges: graphEdges(regulation).length },
      process: { nodes: graphNodes(process).length, edges: graphEdges(process).length },
      finalAgenda: { nodes: graphNodes(agenda).length, edges: graphEdges(agenda).length },
      finalRegulation: { nodes: graphNodes(finalRegulation).length, edges: graphEdges(finalRegulation).length },
    },
    votes: {
      agendaVoteCandidates: agendaVote.agendas?.length || 0,
      agendaVoteRespondents: agendaVote.meta?.n_voters || 0,
      decisionVoteSlots: decisionVote.slots?.map((slot) => ({ code: slot.code, responseCount: slot.responseCount })) || [],
    },
    publicMenu: classifySourceMenu(sources),
  },
  coverage: {
    includedReadySessions: readySessions.map((session) => ({
      label: session.label,
      tag: session.session,
      graphNodes: session.graphNodes,
    })),
    partialOrGapSessions: partialOrGap.map((session) => ({
      label: session.label,
      tag: session.session,
      status: session.status,
      transcript: session.transcript,
      graphNodes: session.graphNodes,
      graphStatus: session.graphStatus,
    })),
    reviewIssues: issueNodes.map((node) => ({
      label: node.data.label,
      session: node.data.session,
      text: node.data.text,
    })),
    missingPublicSources,
  },
  caveats: [
    'This audit does not re-transcribe audio or mutate database records; it validates current repository artifacts.',
    'B_t2 is represented in the workshop graph but remains transcript_partial in the source coverage graph.',
    '토론4통합 has source/chunk evidence but no current workshop graph nodes.',
    '음성002 has transcript evidence but no current workshop graph nodes.',
  ],
};

writeJson('evaluation/input-coverage/input-coverage-report.json', report);

const lines = [
  '# 입력 데이터 누락 감사',
  '',
  `생성 시각: ${report.generated_at}`,
  '',
  '## 판정',
  '',
  '- A조만 들어간 것은 아니다. 통합 워크숍 그래프에는 A조, B조, 통합 텍스트 세션이 함께 들어 있다.',
  '- 모든 데이터가 완전 반영된 것도 아니다. B_t2, 토론4통합, 음성002는 부분 반영 또는 그래프 갭이다.',
  `- 공개 메뉴 A조 라이브 부각 위험: ${report.conclusion.publicMenuAOnlyRiskResolved ? '해소됨' : '남아 있음'}`,
  `- 결론 도출 과정 그래프 연결: ${report.conclusion.processOntologyLinksConclusionPath ? '확인됨' : '미확인'}`,
  '',
  '## 검증된 입력 인벤토리',
  '',
  `- 원본 파일 노드: ${report.inventory.sourceCoverage.originalFiles}건`,
  `- 음성/문서 세션 노드: ${report.inventory.sourceCoverage.audioOrDocumentSessions}건`,
  `- 텍스트 입력 노드: ${report.inventory.sourceCoverage.textInputsInCoverageGraph}건`,
  `- 워크플로 입력 Markdown 파일: ${report.inventory.workflowInputMarkdownFiles.length}건`,
  `- 통합 워크숍 그래프: ${report.inventory.graphs.workshop.nodes}노드 / ${report.inventory.graphs.workshop.edges}엣지`,
  `- 의제투표 후보: ${report.inventory.votes.agendaVoteCandidates}건, 응답자: ${report.inventory.votes.agendaVoteRespondents}명`,
  '',
  '## 부분 반영 또는 갭',
  '',
  '| 항목 | 태그 | 상태 | 전사 | 그래프 노드 | 그래프 상태 |',
  '| --- | --- | --- | --- | ---: | --- |',
  ...report.coverage.partialOrGapSessions.map((item) => `| ${item.label} | ${item.tag} | ${item.status} | ${item.transcript} | ${item.graphNodes} | ${item.graphStatus} |`),
  '',
  '## 공개 메뉴 검증',
  '',
  `- 기본 소스: \`${report.inventory.publicMenu.default}\``,
  `- 공개 소스: ${report.inventory.publicMenu.exposedSourceIds.map((id) => `\`${id}\``).join(', ')}`,
  `- A조 전용 LIVE 공개 노출: ${report.inventory.publicMenu.hasAOnlyLivePublicSource ? '있음' : '없음'}`,
  '',
  '## 결론',
  '',
  '현재 저장소 증거 기준으로는 “전체 반영 상태를 공개하고, 미완/갭 항목을 같이 보여주는 상태”가 정확하다. 따라서 산출물 표현은 완료 선언보다 반영 상태 감사와 결론 도출 경로를 함께 제시하는 방식이어야 한다.',
  '',
];

writeText('evaluation/input-coverage/input-coverage-audit.md', `${lines.join('\n')}\n`);

console.log('wrote evaluation/input-coverage/input-coverage-report.json');
console.log('wrote evaluation/input-coverage/input-coverage-audit.md');
console.log(`partial/gap sessions: ${partialOrGap.map((item) => item.session).join(', ')}`);
