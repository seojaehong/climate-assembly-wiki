#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const dataPath = (...parts) => join(root, ...parts);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const KIND_KO = {
  Decision: '결정',
  Claim: '주장',
  Proposal: '정책대안',
  Evidence: '근거',
  Concern: '우려',
  Condition: '조건',
  Value: '가치',
  Clause: '조항',
  Issue: '쟁점',
  Group: '영향집단',
};

const REL_KO = {
  resolves: '확정',
  hasEvidence: '근거',
  supports: '지지',
  raisesConcernOn: '우려제기',
  mapsTo: '연결',
  narrowsTo: '압축',
  integrates: '통합',
  comparesWith: '비교',
  modifies: '수정',
  raisesIssue: '쟁점제기',
  hasConcern: '우려',
  requiresCondition: '조건필요',
  proposesEditTo: '수정제안',
  emergesAsAgenda: '의제로 도출',
  advancedToVote: '투표상정',
  settledInDeliberation: '숙의정리',
};

const regulationSource = dataPath('public', 'workshop-graph', 'data', 'regulation-2026-06-13.json');
const workshopSource = dataPath('public', 'workshop-graph', 'data', 'workshop-2026-06-13.json');
const sourceCoverageSource = dataPath('public', 'workshop-graph', 'data', 'source-coverage-2026-06-13.json');
const agendaVoteSource = dataPath('public', 'agenda-vote-0704', 'data.json');
const decisionVoteSource = dataPath('public', '0704-admin', 'decision-votes-report.json');
const inputCoverageAuditSource = dataPath('evaluation', 'input-coverage', 'input-coverage-report.json');

const regulationGraph = readJson(regulationSource);
const workshopGraph = readJson(workshopSource);
const sourceCoverageGraph = readJson(sourceCoverageSource);
const agendaVote = readJson(agendaVoteSource);
const decisionVote = readJson(decisionVoteSource);
const inputCoverageAudit = readJson(inputCoverageAuditSource);

const scenarioRefs = {
  regulation: '10_작업산출물/7.4_발표덱/운영규정_v6/발표시나리오_운영규정_이대진.md',
  agenda: '10_작업산출물/7.4_발표덱/의제결과_v6/발표시나리오_의제선정결과_김영현.md',
  regulationPpt: '10_작업산출물/7.4_발표덱/운영규정_v6/20260704_운영규정_v6.pptx',
  agendaPpt: '10_작업산출물/7.4_발표덱/의제결과_v6/20260704_의제선정결과_v6.pptx',
};

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function nodeText(node) {
  return normalize(`${node?.data?.label || ''} ${node?.data?.text || ''}`);
}

function containsAny(text, terms) {
  const haystack = normalize(text).toLowerCase();
  return terms.some((term) => haystack.includes(String(term).toLowerCase()));
}

function graphNodes(graph) {
  return graph.elements?.nodes || [];
}

function graphEdges(graph) {
  return graph.elements?.edges || [];
}

function findNodes(graph, terms, limit = 8) {
  return graphNodes(graph)
    .filter((node) => containsAny(nodeText(node), terms))
    .sort((a, b) => (b.data.deg || 0) - (a.data.deg || 0))
    .slice(0, limit);
}

function voteRankings() {
  return [...agendaVote.agendas]
    .map((agenda) => ({ ...agenda, score: Number(agenda.scores?.c1 ?? 0) }))
    .sort((a, b) => b.score - a.score)
    .map((agenda, index) => ({ ...agenda, rank: index + 1 }));
}

const agendaRankings = voteRankings();
const agendaRankBySlot = new Map(agendaRankings.map((item) => [item.slot, item]));

function addNode(elements, id, kind, label, text, meta = {}) {
  elements.nodes.push({
    data: {
      id,
      node_id: id,
      label,
      kind,
      kindKo: KIND_KO[kind] || kind,
      text,
      cited: meta.cited || [],
      cited_uids: meta.cited || [],
      meta,
      session: meta.session || '',
      evidence_type: meta.evidence_type || null,
      review_state: meta.review_state || null,
      is_public: true,
      synthesized: meta.synthesized ?? true,
    },
  });
}

function addEdge(elements, source, target, rel, meta = {}) {
  elements.edges.push({
    data: {
      id: `e_${elements.edges.length}`,
      source,
      target,
      src: source,
      dst: target,
      rel,
      relKo: REL_KO[rel] || rel,
      cited: meta.cited || [],
      cited_uids: meta.cited || [],
      meta,
    },
  });
}

function hasNode(elements, id) {
  return elements.nodes.some((node) => node.data?.id === id);
}

function hasEdge(elements, source, target, rel) {
  return elements.edges.some((edge) => edge.data?.source === source && edge.data?.target === target && edge.data?.rel === rel);
}

function addSourceEdge(elements, source, target, edge) {
  const data = edge.data || {};
  const rel = data.rel || 'supports';
  if (hasEdge(elements, source, target, rel)) return;
  elements.edges.push({
    data: {
      id: `e_${elements.edges.length}`,
      source,
      target,
      src: source,
      dst: target,
      rel,
      relKo: data.relKo || REL_KO[rel] || rel,
      cited: data.cited || data.cited_uids || [],
      cited_uids: data.cited_uids || data.cited || [],
      opposes: data.opposes || undefined,
      meta: {
        ...(data.meta || {}),
        source_edge_id: data.id || null,
        source_rel: rel,
      },
    },
  });
}

function cloneContextNode(elements, sourceNode, decisionId, sourceGraph) {
  const sourceId = sourceNode?.data?.id;
  if (!sourceId) return null;
  const contextId = `ctx_${decisionId}_${sourceId}`;
  if (!hasNode(elements, contextId)) {
    addNode(elements, contextId, sourceNode.data.kind || 'Evidence', sourceNode.data.label, sourceNode.data.text, {
      cited: sourceNode.data.cited || sourceNode.data.cited_uids || [],
      source_node_id: sourceId,
      source_graph: sourceGraph,
      evidence_type: 'discussion_context',
      synthesized: false,
      session: sourceNode.data.session || '',
    });
  }
  return contextId;
}

function addDiscussionLineage(elements, sourceGraph, sourceGraphName, decisionId, matches, options = {}) {
  const sourceNodes = graphNodes(sourceGraph);
  const sourceEdges = graphEdges(sourceGraph);
  const byId = new Map(sourceNodes.map((node) => [node.data?.id, node]));
  const seedIds = new Set(matches.map((node) => node.data?.id).filter(Boolean));
  const clonedBySourceId = new Map();
  const allowedRels = new Set([
    'supports',
    'opposes',
    'hasConcern',
    'raisesConcernOn',
    'requiresCondition',
    'modifies',
    'raisesIssue',
    'proposesEditTo',
    'resolves',
  ]);
  const includeKinds = new Set(options.includeNeighborKinds || ['Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence', 'Clause', 'Decision']);

  function ensureClone(sourceId) {
    if (clonedBySourceId.has(sourceId)) return clonedBySourceId.get(sourceId);
    const sourceNode = byId.get(sourceId);
    if (!sourceNode || !includeKinds.has(sourceNode.data?.kind || '')) return null;
    const clonedId = cloneContextNode(elements, sourceNode, decisionId, sourceGraphName);
    if (clonedId) clonedBySourceId.set(sourceId, clonedId);
    return clonedId;
  }

  for (const sourceId of seedIds) ensureClone(sourceId);

  for (const edge of sourceEdges) {
    const data = edge.data || {};
    if (!allowedRels.has(data.rel)) continue;
    const touchesSeed = seedIds.has(data.source) || seedIds.has(data.target);
    if (!touchesSeed) continue;
    const source = ensureClone(data.source);
    const target = ensureClone(data.target);
    if (!source || !target) continue;
    addSourceEdge(elements, source, target, edge);
  }

  return clonedBySourceId;
}

function linkAgendaEmergence(elements, clonedBySourceId, matches, decisionId) {
  const preferred = matches.filter((node) => ['Proposal', 'Issue'].includes(node.data?.kind));
  const fallback = matches.filter((node) => ['Claim', 'Value', 'Concern', 'Condition'].includes(node.data?.kind));
  for (const sourceNode of [...preferred, ...fallback].slice(0, 5)) {
    const contextId = clonedBySourceId.get(sourceNode.data.id);
    if (contextId) addEdge(elements, contextId, decisionId, 'emergesAsAgenda', {
      source_node_id: sourceNode.data.id,
      source_graph: 'workshop-2026-06-13',
    });
  }
}

function linkRegulationVotePath(elements, clonedBySourceId, matches, voteId, decisionId) {
  for (const sourceNode of matches) {
    const contextId = clonedBySourceId.get(sourceNode.data.id);
    if (!contextId) continue;
    if (sourceNode.data.kind === 'Decision') {
      addEdge(elements, contextId, decisionId, 'settledInDeliberation', {
        source_node_id: sourceNode.data.id,
        source_graph: 'regulation-2026-06-13',
      });
    } else if (['Proposal', 'Claim', 'Concern', 'Condition', 'Value', 'Clause'].includes(sourceNode.data.kind)) {
      addEdge(elements, contextId, voteId, 'advancedToVote', {
        source_node_id: sourceNode.data.id,
        source_graph: 'regulation-2026-06-13',
      });
    }
  }
  addEdge(elements, voteId, decisionId, 'resolves');
}

function finalizeElements(elements) {
  const degree = new Map();
  for (const edge of elements.edges) {
    degree.set(edge.data.source, (degree.get(edge.data.source) || 0) + 1);
    degree.set(edge.data.target, (degree.get(edge.data.target) || 0) + 1);
  }
  for (const node of elements.nodes) {
    node.data.deg = degree.get(node.data.id) || 0;
    node.data.isolated = node.data.deg === 0;
  }
  return elements;
}

function supportStrength(matchCount, voteScore = null) {
  if (matchCount >= 10 || (voteScore !== null && voteScore >= 3.9 && matchCount >= 3)) return 'strong';
  if (matchCount >= 4 || (voteScore !== null && voteScore >= 3.5 && matchCount >= 2)) return 'medium';
  if (matchCount > 0) return 'weak';
  return 'missing';
}

function decisionTopic(label) {
  return normalize(label).split('=')[0].trim();
}

const regulationDecisions = [
  {
    id: 'reg-planning-quorum',
    label: '기획참여단 의결정족수 = 출석 2/3',
    result: '출석 2/3',
    vote: '2차 투표 14/18',
    terms: ['기획참여단 의결정족수 = 출석 2/3', '정족수: 출석 2/3', '참석자 2/3', '출석 2/3'],
    scenario: '6쪽: 출석 2/3, 18명 중 14명 찬성',
  },
  {
    id: 'reg-division-yes',
    label: '숙의참여단 분과 구성 = 분과를 둠',
    result: '분과를 둠',
    vote: '1차 투표 13/18',
    terms: ['숙의참여단 분과 구성 = 분과를 둠', '분과 찬성', '분과를 둠', '논의범위 압축', '전문성 함양'],
    scenario: '7쪽: 18명 중 13명 찬성, 분과 운영 채택',
  },
  {
    id: 'reg-division-three',
    label: '분과 개수 = 3개 분과(감축1·감축2·적응)',
    result: '3개 분과',
    vote: '결선 13/18',
    terms: ['분과 개수 = 3개 분과', '3개 분과', '감축1·감축2·적응', '감축 1·감축 2·적응'],
    scenario: '7쪽: 3:3:3 동률 이후 결선으로 감축1·감축2·적응 세 개 채택',
  },
  {
    id: 'reg-division-quorum',
    label: '숙의참여단 분과 의결정족수 = 출석 2/3',
    result: '출석 2/3',
    vote: '결선 15/18',
    terms: ['분과 의결정족수 = 출석 2/3', '숙의참여단 분과 의결 정족수', '분과 의결정족수'],
    scenario: '8쪽: 분과 안 결정 기준도 출석 2/3, 18명 중 15명 찬성',
  },
  {
    id: 'reg-full-quorum',
    label: '숙의참여단 전체 의결정족수 = 출석 2/3',
    result: '출석 2/3',
    vote: '2차 투표 14/18',
    terms: ['전체 의결정족수 = 출석 2/3', '숙의참여단 전체 의결정족수', '기획·분과·전체'],
    scenario: '9쪽: 전체회의 기준도 출석 2/3, 14명 찬성',
  },
  {
    id: 'reg-article14-direct-indirect',
    label: '의제 기준 14조 1항 = 직·간접 관련으로 확장',
    result: '직·간접 관련',
    vote: '17/18',
    terms: ['의제기준 14조1항 = 직간접으로 확장', '직·간접', '직간접', '직접 관련', '간접적'],
    scenario: '10쪽: 직접 관련을 직·간접 관련으로 확장, 17명 찬성',
  },
  {
    id: 'reg-article14-everyday-life',
    label: '의제 기준 14조 3항 = 시민의 삶·일상 실천 유지',
    result: '현행 유지',
    vote: '16/18',
    terms: ['의제기준 14조3항 = 시민의 삶 표현 유지', '시민의 삶', '일상 실천', '일상에 닿아야'],
    scenario: '11쪽: 시민의 삶과 일상 실천 표현 유지, 16명 찬성',
  },
];

const agendaDecisions = [
  {
    slot: '2',
    id: 'agenda-education-citizen-participation',
    label: '생애주기 탄소중립 교육 및 시민의식 개선',
    result: 'PPT 시나리오상 1위 교육 의제와 시민의식 개선 통합',
    terms: ['전 생애주기 탄소중립 교육', '탄소중립 교육', '시민의식 개선', '참여 활성화', '교육 체계'],
    scenario: '8쪽: 4.06점 1위, 시민의식 개선·참여 활성화를 교육 의제에 통합',
    status: 'selected_in_deck_narrative',
  },
  {
    slot: '5',
    id: 'agenda-resource-circulation',
    label: '자원순환·생활폐기물 감축',
    result: 'PPT 시나리오상 공동 2위 의제',
    terms: ['자원순환', '생활폐기물', '배달 문화', '과대포장', '일회용품'],
    scenario: '9쪽: 평균 3.89점, A조 자원순환형 배달 문화와 B조 생활폐기물 감축을 통합',
    status: 'selected_in_deck_narrative',
  },
  {
    slot: '3',
    id: 'agenda-citizen-participation-original',
    label: '시민의식 개선 및 참여 활성화',
    result: '투표 공동 2위였으나 교육 의제에 통합된 원 후보',
    terms: ['시민의식 개선', '참여 활성화', '시민참여 활성화', '참여'],
    scenario: '8쪽·11쪽: 공동 2위였지만 교육 의제와 방향이 맞닿아 통합',
    status: 'integrated_into_selected',
  },
  {
    slot: '8',
    id: 'agenda-transit-transition',
    label: '대중교통 친환경 교통전환',
    result: '투표 4위 후보',
    terms: ['대중교통', '친환경 교통', '교통전환', '교통 감축', '교통'],
    scenario: '11쪽: 대중교통 친환경 전환이 후순위 후보로 언급',
    status: 'candidate_discussed',
  },
  {
    slot: '7',
    id: 'agenda-green-city-adaptation',
    label: '친환경 도시 인프라·에너지 전환 및 기후위기 적응',
    result: '투표 5위 후보',
    terms: ['친환경 도시', '도시 인프라', '에너지 전환', '기후위기 적응형 도시', '취약계층 보호'],
    scenario: '11쪽: 기후위기 적응형 도시·취약계층 보호가 후순위 후보로 언급',
    status: 'candidate_discussed',
  },
  {
    slot: '1',
    id: 'agenda-climate-finance-local',
    label: '기후재정 확보와 지자체 자발적 참여',
    result: '투표 6위 후보',
    terms: ['기후재정', '지자체', '자발적 참여'],
    scenario: '11쪽: 기후재정 확보와 지자체 참여가 후순위 후보로 언급',
    status: 'candidate_discussed',
  },
  {
    slot: '4',
    id: 'agenda-governance',
    label: '시민참여 기반 기후 거버넌스 강화',
    result: '투표 7위 후보',
    terms: ['기후 거버넌스', '시민참여 기반', '거버넌스'],
    scenario: '11쪽: 시민참여 기반 거버넌스 강화가 후순위 후보로 언급',
    status: 'candidate_discussed',
  },
  {
    slot: '6',
    id: 'agenda-energy-saving-ghg',
    label: '에너지 절약 및 온실가스 배출 감축',
    result: '투표 8위 후보',
    terms: ['에너지 절약', '온실가스 배출 감축', '온실가스', '배출 감축'],
    scenario: '11쪽: 에너지 절약과 온실가스 감축이 후순위 후보로 언급',
    status: 'candidate_discussed',
  },
];

function buildRegulationSet() {
  const elements = { nodes: [], edges: [] };
  const rows = [];
  addNode(
    elements,
    'reg-final-set',
    'Decision',
    '운영규정 최종 결정 세트',
    '2026-07-04 운영규정 발표자료와 6/13~14 운영규정·통합토론 데이터를 연결한 별도 결정 온톨로지 세트.',
    { cited: [scenarioRefs.regulation, scenarioRefs.regulationPpt], decision_set: 'regulation_final_0704' },
  );

  for (const item of regulationDecisions) {
    const matches = findNodes(regulationGraph, item.terms, 10);
    const strength = supportStrength(matches.length);
    const decisionId = `decision_${item.id}`;
    const voteId = `vote_${item.id}`;
    addNode(elements, decisionId, 'Decision', item.label, `${item.result}. ${item.scenario}`, {
      cited: [scenarioRefs.regulation, scenarioRefs.regulationPpt, 'public/workshop-graph/data/regulation-2026-06-13.json'],
      decision_id: item.id,
      result: item.result,
      vote: item.vote,
      discussion_signal: strength,
      matched_context_count: matches.length,
    });
    addNode(elements, voteId, 'Evidence', `${decisionTopic(item.label)} 표결 근거`, `${item.label}. 표결 결과: ${item.vote}. ${item.scenario}`, {
      cited: [scenarioRefs.regulation, 'public/workshop-graph/inputs/06b_조숙의_통합_토론4.md'],
      evidence_type: 'vote_result',
      decision_id: item.id,
    });
    addEdge(elements, decisionId, 'reg-final-set', 'integrates');

    const lineage = addDiscussionLineage(elements, regulationGraph, 'regulation-2026-06-13', item.id, matches.slice(0, 6));
    linkRegulationVotePath(elements, lineage, matches.slice(0, 6), voteId, decisionId);
    rows.push({
      id: item.id,
      decision: item.label,
      result: item.result,
      vote: item.vote,
      existing_context_matches: matches.length,
      discussion_signal: strength,
      reflected_in_existing_regulation_graph: matches.length > 0,
    });
  }

  return {
    graph: {
      elements: finalizeElements(elements),
      meta: {
        variant: 'final-regulation-decisions-0704',
        title: '운영규정 최종 결정 온톨로지',
        generated_at: new Date().toISOString(),
        source_files: [scenarioRefs.regulation, scenarioRefs.regulationPpt, 'public/workshop-graph/data/regulation-2026-06-13.json'],
        counts: { nodes: elements.nodes.length, edges: elements.edges.length },
        quality: {
          conclusion: 'current regulation graph already contains final decision nodes; this file extracts and connects them as a compact decision set',
        },
      },
    },
    rows,
  };
}

function buildAgendaSet() {
  const elements = { nodes: [], edges: [] };
  const rows = [];
  addNode(
    elements,
    'agenda-final-set',
    'Decision',
    '의제 선정 결론·후보 온톨로지 세트',
    '2026-07-04 의제선정결과 발표자료, agenda vote 점수, 기존 워크숍 그래프의 후보 논의 맥락을 연결한 별도 세트.',
    { cited: [scenarioRefs.agenda, scenarioRefs.agendaPpt, 'public/agenda-vote-0704/data.json'], decision_set: 'agenda_final_0704' },
  );

  const voteRootId = 'agenda-vote-result-0704';
  addNode(elements, voteRootId, 'Evidence', '7.4 의제투표 점수표', `투표자 ${agendaVote.meta.n_voters}명 기준 8개 후보 5점 척도 평균 점수.`, {
    cited: ['public/agenda-vote-0704/data.json'],
    evidence_type: 'vote_result',
    n_voters: agendaVote.meta.n_voters,
  });
  addEdge(elements, 'agenda-final-set', voteRootId, 'hasEvidence');

  for (const item of agendaDecisions) {
    const vote = agendaRankBySlot.get(item.slot);
    const matches = findNodes(workshopGraph, item.terms, 12);
    const strength = supportStrength(matches.length, vote?.score ?? null);
    const decisionId = `decision_${item.id}`;
    const voteId = `vote_${item.id}`;
    addNode(elements, decisionId, item.status.includes('selected') ? 'Decision' : 'Proposal', item.label, item.result, {
      cited: [scenarioRefs.agenda, scenarioRefs.agendaPpt, 'public/agenda-vote-0704/data.json'],
      decision_id: item.id,
      slot: item.slot,
      status: item.status,
      vote_rank: vote?.rank ?? null,
      vote_score: vote?.score ?? null,
      discussion_signal: strength,
      matched_context_count: matches.length,
    });
    addNode(elements, voteId, 'Evidence', `${item.label} 투표 근거`, `순위 ${vote?.rank ?? '미확인'}, 평균 ${vote?.score ?? '미확인'}.`, {
      cited: ['public/agenda-vote-0704/data.json'],
      evidence_type: 'vote_result',
      slot: item.slot,
    });
    addEdge(elements, decisionId, 'agenda-final-set', item.status === 'integrated_into_selected' ? 'integrates' : 'resolves');
    addEdge(elements, voteId, decisionId, 'resolves');
    addEdge(elements, voteRootId, voteId, 'mapsTo');

    const lineage = addDiscussionLineage(elements, workshopGraph, 'workshop-2026-06-13', item.id, matches.slice(0, 7));
    linkAgendaEmergence(elements, lineage, matches.slice(0, 7), decisionId);

    rows.push({
      id: item.id,
      agenda: item.label,
      slot: item.slot,
      status: item.status,
      vote_rank: vote?.rank ?? null,
      vote_score: vote?.score ?? null,
      existing_context_matches: matches.length,
      discussion_signal: strength,
      caveat: item.id === 'agenda-education-citizen-participation'
        ? 'citizen participation was a separate vote option and is represented here as an integrated narrative conclusion'
        : null,
    });
  }

  const unresolvedId = 'agenda-new-slot-caveat';
  addNode(elements, unresolvedId, 'Concern', '감축2 새 의제 확정 증거 부족', '의제결과 v6 발표시나리오에는 7쪽·10쪽에 [7.4 당일 확정 후 수정] 표시가 남아 있어, 현재 repo evidence만으로 별도 새 의제가 최종 확정됐다고 단정할 수 없다.', {
    cited: [scenarioRefs.agenda, 'docs/0704-dashboard-handoff.md', 'public/0704-admin/decision-votes-report.json'],
    evidence_type: 'scope_caveat',
    decision_vote_response_counts: decisionVote.slots.map((slot) => ({ code: slot.code, responseCount: slot.responseCount })),
  });
  addEdge(elements, unresolvedId, 'agenda-final-set', 'raisesConcernOn');

  return {
    graph: {
      elements: finalizeElements(elements),
      meta: {
        variant: 'final-agenda-decisions-0704',
        title: '의제 선정 결론·후보 온톨로지',
        generated_at: new Date().toISOString(),
        source_files: [scenarioRefs.agenda, scenarioRefs.agendaPpt, 'public/agenda-vote-0704/data.json', 'public/workshop-graph/data/workshop-2026-06-13.json'],
        counts: { nodes: elements.nodes.length, edges: elements.edges.length },
        quality: {
          conclusion: '7/4 vote data and workshop discussion context are now connected; the deck still contains an unresolved new-agenda placeholder in current evidence',
        },
      },
    },
    rows,
  };
}

function countWorkshopSessions() {
  const counts = new Map();
  for (const node of graphNodes(workshopGraph)) {
    const session = node.data.session || String(node.data.id || '').split('__')[0] || 'unknown';
    counts.set(session, (counts.get(session) || 0) + 1);
  }
  return [...counts.entries()].map(([session, nodes]) => ({ session, nodes }));
}

function cloneCoverageNode(elements, sourceNode, idPrefix = 'coverage_ctx') {
  const id = `${idPrefix}_${sourceNode.data.id}`;
  addNode(elements, id, sourceNode.data.kind || 'Evidence', sourceNode.data.label, sourceNode.data.text, {
    cited: sourceNode.data.cited || sourceNode.data.cited_uids || [],
    source_node_id: sourceNode.data.id,
    source_graph: 'source-coverage-2026-06-13',
    evidence_type: 'source_coverage',
    synthesized: false,
    session: sourceNode.data.session || 'coverage',
  });
  return id;
}

function buildProcessSet() {
  const elements = { nodes: [], edges: [] };
  const sessionCounts = countWorkshopSessions();
  const originalNodes = graphNodes(sourceCoverageGraph).filter((node) => String(node.data.id || '').startsWith('original::'));
  const sessionNodes = graphNodes(sourceCoverageGraph).filter((node) => String(node.data.id || '').startsWith('session::'));
  const issueNodes = graphNodes(sourceCoverageGraph).filter((node) => String(node.data.id || '').startsWith('issue::'));
  const readySessions = sessionNodes.filter((node) => !['Concern', 'Condition'].includes(node.data.kind));
  const partialSessions = sessionNodes.filter((node) => ['Concern', 'Condition'].includes(node.data.kind));
  const topAgendaVotes = voteRankings().slice(0, 5);

  addNode(
    elements,
    'process-final-map',
    'Decision',
    '전체 과정에서 최종 결론으로 이어지는 지도',
    '원본자료, 전사, 조별·통합 숙의, 후보 압축, 7.4 투표·발표자료, 최종 운영규정·의제 결론을 한 흐름으로 연결한다.',
    {
      cited: [
        'public/workshop-graph/data/source-coverage-2026-06-13.json',
        'public/workshop-graph/data/workshop-2026-06-13.json',
        'evaluation/input-coverage/input-coverage-report.json',
        'public/agenda-vote-0704/data.json',
        scenarioRefs.regulation,
        scenarioRefs.agenda,
      ],
      decision_set: 'process_to_conclusion_0704',
    },
  );

  addNode(elements, 'stage-raw-data', 'Evidence', `원본자료 ${originalNodes.length}건`, '6/13~14 원본 음성·문서 파일 묶음. 모든 결론 연결의 시작점이다.', {
    cited: ['public/workshop-graph/data/source-coverage-2026-06-13.json'],
    original_count: inputCoverageAudit.inventory?.sourceCoverage?.originalFiles ?? originalNodes.length,
  });
  addNode(elements, 'stage-transcripts', 'Evidence', `음성·문서 세션 ${readySessions.length + partialSessions.length}건 + 텍스트 세션 ${inputCoverageAudit.inventory?.sourceCoverage?.textInputsInCoverageGraph ?? 0}건`, `${readySessions.length}건은 ready, ${partialSessions.length}건은 재확인 또는 부분 반영 상태다. 별도 텍스트 입력 세션은 ${inputCoverageAudit.inventory?.sourceCoverage?.textInputsInCoverageGraph ?? 0}건이다.`, {
    cited: ['docs/graph-source-coverage-audit-2026-06-25.md', 'public/workshop-graph/data/source-coverage-2026-06-13.json', 'evaluation/input-coverage/input-coverage-report.json'],
    ready_sessions: readySessions.length,
    partial_or_review_sessions: partialSessions.length,
  });
  addNode(elements, 'stage-workshop-graph', 'Claim', `통합 워크숍 그래프 ${graphNodes(workshopGraph).length}노드`, `워크숍 통합 그래프는 ${graphNodes(workshopGraph).length}노드 / ${graphEdges(workshopGraph).length}엣지이며 A조, B조, 통합 텍스트 세션을 함께 포함한다.`, {
    cited: ['public/workshop-graph/data/workshop-2026-06-13.json'],
    session_counts: sessionCounts,
  });
  addNode(elements, 'stage-final-votes', 'Evidence', '7.4 투표·발표자료', `의제투표는 ${agendaVote.meta.n_voters}명 응답 기준 8개 후보를 집계했고, 운영규정 결론은 발표시나리오와 운영규정 그래프의 결정 노드로 확인했다.`, {
    cited: ['public/agenda-vote-0704/data.json', scenarioRefs.regulation, scenarioRefs.agenda],
    n_voters: agendaVote.meta.n_voters,
  });
  addNode(elements, 'stage-final-conclusions', 'Decision', '최종 운영규정·의제 결론', '운영규정 최종 결정 세트와 의제 선정 결론·후보 세트로 분리해 결론을 확인한다.', {
    cited: ['public/workshop-graph/data/final-regulation-decisions-0704.json', 'public/workshop-graph/data/final-agenda-decisions-0704.json'],
  });

  addEdge(elements, 'stage-raw-data', 'stage-transcripts', 'mapsTo');
  addEdge(elements, 'stage-transcripts', 'stage-workshop-graph', 'mapsTo');
  addEdge(elements, 'stage-workshop-graph', 'stage-final-votes', 'narrowsTo');
  addEdge(elements, 'stage-final-votes', 'stage-final-conclusions', 'resolves');
  addEdge(elements, 'stage-final-conclusions', 'process-final-map', 'supports');

  const coverageHub = graphNodes(sourceCoverageGraph).find((node) => node.data.id === 'coverage::hub');
  if (coverageHub) {
    const coverageHubId = cloneCoverageNode(elements, coverageHub);
    addEdge(elements, coverageHubId, 'stage-raw-data', 'hasEvidence');
    addEdge(elements, coverageHubId, 'stage-transcripts', 'hasEvidence');
  }

  addNode(elements, 'process-input-coverage-audit', 'Evidence', '입력 데이터 누락 감사', '현재 저장소 증거 기준으로 A조만 반영된 것은 아니지만, B_t2·토론4통합·음성002는 부분 반영 또는 그래프 갭으로 남아 있음을 검증했다.', {
    cited: ['evaluation/input-coverage/input-coverage-report.json', 'evaluation/input-coverage/input-coverage-audit.md'],
    evidence_type: 'coverage_audit',
    allDataCompletelyReflected: inputCoverageAudit.conclusion?.allDataCompletelyReflected,
    aOnlyDataClaimIsFalse: inputCoverageAudit.conclusion?.aOnlyDataClaimIsFalse,
  });
  addEdge(elements, 'process-input-coverage-audit', 'stage-raw-data', 'hasEvidence');
  addEdge(elements, 'process-input-coverage-audit', 'stage-transcripts', 'hasEvidence');
  addEdge(elements, 'process-input-coverage-audit', 'process-final-map', 'raisesConcernOn');

  for (const node of partialSessions) {
    const id = cloneCoverageNode(elements, node, 'partial_session');
    addEdge(elements, id, 'stage-transcripts', 'raisesConcernOn');
  }
  for (const node of issueNodes) {
    const id = cloneCoverageNode(elements, node, 'coverage_issue');
    addEdge(elements, id, 'process-final-map', 'raisesConcernOn');
  }

  for (const [index, agenda] of topAgendaVotes.entries()) {
    const id = `process_agenda_vote_${agenda.slot}`;
    addNode(elements, id, index < 3 ? 'Decision' : 'Proposal', `${index + 1}순위 후보: ${agenda.name}`, `${agenda.short}: 평균 ${agenda.score}, 슬롯 ${agenda.slot}.`, {
      cited: ['public/agenda-vote-0704/data.json'],
      slot: agenda.slot,
      vote_rank: index + 1,
      vote_score: agenda.score,
      evidence_type: 'vote_result',
    });
    addEdge(elements, 'stage-final-votes', id, 'hasEvidence');
    addEdge(elements, id, 'stage-final-conclusions', index < 3 ? 'supports' : 'comparesWith');
  }

  addNode(elements, 'process-regulation-link', 'Decision', '운영규정 결론 세트로 연결', '기획참여단·숙의참여단 정족수, 분과 구성, 의제 기준 수정 결론을 별도 세트에서 확인한다.', {
    cited: ['public/workshop-graph/data/final-regulation-decisions-0704.json'],
  });
  addNode(elements, 'process-agenda-link', 'Decision', '의제선정 결론 세트로 연결', '탄소중립 교육, 자원순환·폐기물, 시민의식·참여 통합 관계와 후순위 후보를 별도 세트에서 확인한다.', {
    cited: ['public/workshop-graph/data/final-agenda-decisions-0704.json'],
  });
  addEdge(elements, 'stage-final-conclusions', 'process-regulation-link', 'mapsTo');
  addEdge(elements, 'stage-final-conclusions', 'process-agenda-link', 'mapsTo');
  addEdge(elements, 'process-regulation-link', 'process-final-map', 'supports');
  addEdge(elements, 'process-agenda-link', 'process-final-map', 'supports');

  return {
    graph: {
      elements: finalizeElements(elements),
      meta: {
        variant: 'final-process-to-conclusion-0704',
        title: '전체 과정에서 최종 결론으로 이어지는 온톨로지',
        generated_at: new Date().toISOString(),
        source_files: [
          'public/workshop-graph/data/source-coverage-2026-06-13.json',
          'public/workshop-graph/data/workshop-2026-06-13.json',
          'evaluation/input-coverage/input-coverage-report.json',
          'public/agenda-vote-0704/data.json',
          scenarioRefs.regulation,
          scenarioRefs.agenda,
        ],
        counts: { nodes: elements.nodes.length, edges: elements.edges.length },
        quality: {
          conclusion: 'A/B/통합 세션은 통합 그래프에 함께 들어 있으나, B_t2·토론4통합·음성002는 부분 반영 또는 그래프 갭으로 표시해야 한다.',
          public_menu_guidance: 'A조 live sample should not be the public entry point; the process map and source coverage should lead.',
        },
      },
    },
    coverage: {
      original_files: originalNodes.length,
      source_coverage_nodes: graphNodes(sourceCoverageGraph).length,
      source_coverage_edges: graphEdges(sourceCoverageGraph).length,
      workshop_graph_nodes: graphNodes(workshopGraph).length,
      workshop_graph_edges: graphEdges(workshopGraph).length,
      ready_sessions: readySessions.length,
      partial_or_review_sessions: partialSessions.length,
      partial_or_review_labels: partialSessions.map((node) => node.data.label),
      issue_labels: issueNodes.map((node) => node.data.label),
      session_counts: sessionCounts,
    },
  };
}

const regulation = buildRegulationSet();
const agenda = buildAgendaSet();
const process = buildProcessSet();

const regulationOut = dataPath('public', 'workshop-graph', 'data', 'final-regulation-decisions-0704.json');
const agendaOut = dataPath('public', 'workshop-graph', 'data', 'final-agenda-decisions-0704.json');
const processOut = dataPath('public', 'workshop-graph', 'data', 'final-process-to-conclusion-0704.json');
writeJson(regulationOut, regulation.graph);
writeJson(agendaOut, agenda.graph);
writeJson(processOut, process.graph);

const report = {
  generated_at: new Date().toISOString(),
  outputs: {
    regulation: 'public/workshop-graph/data/final-regulation-decisions-0704.json',
    agenda: 'public/workshop-graph/data/final-agenda-decisions-0704.json',
    process: 'public/workshop-graph/data/final-process-to-conclusion-0704.json',
  },
  inputs: {
    regulation_graph: 'public/workshop-graph/data/regulation-2026-06-13.json',
    workshop_graph: 'public/workshop-graph/data/workshop-2026-06-13.json',
    source_coverage_graph: 'public/workshop-graph/data/source-coverage-2026-06-13.json',
    input_coverage_audit: 'evaluation/input-coverage/input-coverage-report.json',
    agenda_vote: 'public/agenda-vote-0704/data.json',
    decision_vote: 'public/0704-admin/decision-votes-report.json',
    scenarios: scenarioRefs,
  },
  coverage: {
    regulation: regulation.rows,
    agenda: agenda.rows,
    process: process.coverage,
  },
  caveats: [
    'PPT text extracted through markitdown was garbled for Korean text, so the sibling presentation scenario Markdown files are used as readable deck-text evidence.',
    'The integrated workshop graph includes A, B, and combined text sessions, but the source coverage audit still marks B_t2, 토론4통합, and 음성002 as partial/review/gap items.',
    'public/0704-admin/decision-votes-report.json currently has zero responses in V0/V1A/V1B, so conditional final-decision votes are not treated as proven final outcomes.',
    'The agenda v6 scenario still contains [7.4 당일 확정 후 수정] markers for the new agenda slot; this is represented as a caveat node, not as a final selected agenda.',
  ],
};
writeJson(dataPath('evaluation', 'ontology-final-decisions', 'final-decision-ontology-report.json'), report);

console.log(`wrote ${regulationOut}: nodes=${regulation.graph.elements.nodes.length} edges=${regulation.graph.elements.edges.length}`);
console.log(`wrote ${agendaOut}: nodes=${agenda.graph.elements.nodes.length} edges=${agenda.graph.elements.edges.length}`);
console.log(`wrote ${processOut}: nodes=${process.graph.elements.nodes.length} edges=${process.graph.elements.edges.length}`);
console.log('wrote evaluation/ontology-final-decisions/final-decision-ontology-report.json');
