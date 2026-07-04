import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function edgeKey(source, target, rel) {
  return `${source}->${target}:${rel}`;
}

function edgeSet(graph) {
  return new Set((graph.elements?.edges || []).map((edge) => {
    const data = edge.data || {};
    return edgeKey(data.source, data.target, data.rel);
  }));
}

function nodeIds(graph) {
  return new Set((graph.elements?.nodes || []).map((node) => node.data?.id));
}

describe('final decision ontology lineage', () => {
  it('renders lineage relation labels in the graph UI', () => {
    const html = readFileSync(join(root, 'public/workshop-graph/index.html'), 'utf8');

    expect(html).toContain("emergesAsAgenda: '의제로 도출'");
    expect(html).toContain("advancedToVote: '투표상정'");
  });

  it('keeps citizen agenda discussion edges before the final agenda node', () => {
    const graph = readJson('public/workshop-graph/data/final-agenda-decisions-0704.json');
    const edges = edgeSet(graph);

    expect(edges.has(edgeKey(
      'ctx_agenda-education-citizen-participation_B_t1__Value_001',
      'ctx_agenda-education-citizen-participation_B_t1__Issue_007',
      'supports',
    ))).toBe(true);
    expect(edges.has(edgeKey(
      'ctx_agenda-education-citizen-participation_B_t2__Proposal_001',
      'ctx_agenda-education-citizen-participation_B_t2__Concern_001',
      'supports',
    ))).toBe(true);
    expect(edges.has(edgeKey(
      'ctx_agenda-education-citizen-participation_B_t2__Proposal_001',
      'decision_agenda-education-citizen-participation',
      'emergesAsAgenda',
    ))).toBe(true);
  });

  it('keeps regulation discussion and clause edges before vote-bound decisions', () => {
    const graph = readJson('public/workshop-graph/data/final-regulation-decisions-0704.json');
    const nodes = nodeIds(graph);
    const edges = edgeSet(graph);

    expect(nodes.has('ctx_reg-division-yes_Clause_08')).toBe(true);
    expect(nodes.has('ctx_reg-planning-quorum_Clause_16')).toBe(true);
    expect(edges.has(edgeKey(
      'ctx_reg-division-yes_Claim_05',
      'ctx_reg-division-yes_Clause_08',
      'supports',
    ))).toBe(true);
    expect(edges.has(edgeKey(
      'ctx_reg-planning-quorum_Proposal_02',
      'ctx_reg-planning-quorum_Clause_16',
      'proposesEditTo',
    ))).toBe(true);
    expect(edges.has(edgeKey(
      'ctx_reg-planning-quorum_Proposal_02',
      'vote_reg-planning-quorum',
      'advancedToVote',
    ))).toBe(true);
  });
});
