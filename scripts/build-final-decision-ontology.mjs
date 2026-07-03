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
  Proposal: '정책대안',
  Evidence: '근거',
  Concern: '우려',
  Value: '가치',
  Clause: '조항',
  Issue: '쟁점',
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
};

const regulationSource = dataPath('public', 'workshop-graph', 'data', 'regulation-2026-06-13.json');
const workshopSource = dataPath('public', 'workshop-graph', 'data', 'workshop-2026-06-13.json');
const agendaVoteSource = dataPath('public', 'agenda-vote-0704', 'data.json');
const decisionVoteSource = dataPath('public', '0704-admin', 'decision-votes-report.json');

const regulationGraph = readJson(regulationSource);
const workshopGraph = readJson(workshopSource);
const agendaVote = readJson(agendaVoteSource);
const decisionVote = readJson(decisionVoteSource);

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
    addNode(elements, voteId, 'Evidence', `${item.vote} 표결 근거`, item.vote, {
      cited: [scenarioRefs.regulation, 'public/workshop-graph/inputs/06b_조숙의_통합_토론4.md'],
      evidence_type: 'vote_result',
      decision_id: item.id,
    });
    addEdge(elements, 'reg-final-set', decisionId, 'resolves');
    addEdge(elements, decisionId, voteId, 'hasEvidence');

    for (const match of matches.slice(0, 5)) {
      const contextId = `ctx_${item.id}_${match.data.id}`;
      addNode(elements, contextId, match.data.kind || 'Evidence', match.data.label, match.data.text, {
        cited: match.data.cited || match.data.cited_uids || [],
        source_node_id: match.data.id,
        source_graph: 'regulation-2026-06-13',
        evidence_type: 'discussion_context',
        synthesized: false,
      });
      addEdge(elements, contextId, decisionId, 'supports');
    }
    rows.push({
      id: item.id,
      decision: item.label,
      result: item.result,
      vote: item.vote,
      existing_context_matches: matches.length,
      discussion_signal: strength,
      reflected_in_existing_regulation_graph: matches.some((m) => nodeText(m).includes(item.result) || containsAny(nodeText(m), [item.label])),
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
    addEdge(elements, 'agenda-final-set', decisionId, item.status === 'integrated_into_selected' ? 'integrates' : 'resolves');
    addEdge(elements, decisionId, voteId, 'hasEvidence');
    addEdge(elements, voteRootId, voteId, 'mapsTo');

    for (const match of matches.slice(0, 6)) {
      const contextId = `ctx_${item.id}_${match.data.id}`;
      addNode(elements, contextId, match.data.kind || 'Evidence', match.data.label, match.data.text, {
        cited: match.data.cited || match.data.cited_uids || [],
        source_node_id: match.data.id,
        source_graph: 'workshop-2026-06-13',
        evidence_type: 'discussion_context',
        synthesized: false,
      });
      addEdge(elements, contextId, decisionId, 'supports');
    }

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

const regulation = buildRegulationSet();
const agenda = buildAgendaSet();

const regulationOut = dataPath('public', 'workshop-graph', 'data', 'final-regulation-decisions-0704.json');
const agendaOut = dataPath('public', 'workshop-graph', 'data', 'final-agenda-decisions-0704.json');
writeJson(regulationOut, regulation.graph);
writeJson(agendaOut, agenda.graph);

const report = {
  generated_at: new Date().toISOString(),
  outputs: {
    regulation: 'public/workshop-graph/data/final-regulation-decisions-0704.json',
    agenda: 'public/workshop-graph/data/final-agenda-decisions-0704.json',
  },
  inputs: {
    regulation_graph: 'public/workshop-graph/data/regulation-2026-06-13.json',
    workshop_graph: 'public/workshop-graph/data/workshop-2026-06-13.json',
    agenda_vote: 'public/agenda-vote-0704/data.json',
    decision_vote: 'public/0704-admin/decision-votes-report.json',
    scenarios: scenarioRefs,
  },
  coverage: {
    regulation: regulation.rows,
    agenda: agenda.rows,
  },
  caveats: [
    'PPT text extracted through markitdown was garbled for Korean text, so the sibling presentation scenario Markdown files are used as readable deck-text evidence.',
    'public/0704-admin/decision-votes-report.json currently has zero responses in V0/V1A/V1B, so conditional final-decision votes are not treated as proven final outcomes.',
    'The agenda v6 scenario still contains [7.4 당일 확정 후 수정] markers for the new agenda slot; this is represented as a caveat node, not as a final selected agenda.',
  ],
};
writeJson(dataPath('evaluation', 'ontology-final-decisions', 'final-decision-ontology-report.json'), report);

console.log(`wrote ${regulationOut}: nodes=${regulation.graph.elements.nodes.length} edges=${regulation.graph.elements.edges.length}`);
console.log(`wrote ${agendaOut}: nodes=${agenda.graph.elements.nodes.length} edges=${agenda.graph.elements.edges.length}`);
console.log('wrote evaluation/ontology-final-decisions/final-decision-ontology-report.json');
