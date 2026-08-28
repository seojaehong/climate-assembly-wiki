import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOntologyReviewQueueSeed,
  verifyOntologyReviewQueueSeed,
} from './ontology-review-queue.mjs';
import {
  buildCanvasOntologyReviewPlan,
  CANVAS_ONTOLOGY_NODE_KINDS,
  CANVAS_ONTOLOGY_RELATIONS,
  canonicalJson,
  canonicalPlanForHash,
  attachPlanIntegrity,
  isRecord,
  nonemptyString,
  optionalString,
  unsignedPlanOf,
  validateAgendaLinkRow,
  validateAgendaRow,
  validateSnapshot,
} from './canvas-ontology-plan.mjs';

export { buildCanvasOntologyReviewPlan, CANVAS_ONTOLOGY_NODE_KINDS, CANVAS_ONTOLOGY_RELATIONS };

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_ROOT = resolve(REPOSITORY_ROOT, 'public');
const AUTH_REVIEWER_ID = /^auth-user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;


const KIND_KO = {
  Issue: '쟁점', Claim: '주장', Proposal: '제안', Concern: '우려',
  Condition: '조건', Value: '가치', Evidence: '근거',
};

const RELATION_KO = {
  supports: '지지', opposes: '반대', hasConcern: '우려', requiresCondition: '조건필요',
  hasEvidence: '근거', modifies: '수정', isAbout: '관련', raisesIssue: '쟁점제기',
  implements: '실행',
};

/**
 * 순수 로직은 canvas-ontology-plan.mjs 에 있다 — 화면(브라우저)도 같은 코드를 써야 하기
 * 때문이다. 여기에는 Node 전용인 것(파일 입출력·createHash·CLI)만 남긴다.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** 정확한 입력과 계획 본문에 체크섬을 붙인다(우발적 변경 감지). */
export function sealCanvasOntologyReviewPlan({ plan, snapshotSource }) {
  const unsignedPlan = unsignedPlanOf(plan);
  const snapshotSha256 = sha256(snapshotSource);
  return attachPlanIntegrity(
    unsignedPlan,
    snapshotSha256,
    sha256(canonicalPlanForHash(unsignedPlan, snapshotSha256)),
  );
}


export function verifyCanvasOntologyReviewPlan({ plan, snapshot, snapshotSource }) {
  if (!isRecord(plan) || plan.schemaVersion !== 1 || plan.kind !== 'canvas-ontology-review-plan') {
    throw new Error('Unsupported Canvas ontology review plan');
  }
  if (plan.integrity?.kind !== 'self-checksum' || plan.integrity?.algorithm !== 'sha256') {
    throw new Error('Unsupported Canvas ontology integrity contract');
  }
  const { planSha256, ...integrityWithoutPlanHash } = plan.integrity;
  if (typeof planSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(planSha256)) {
    throw new Error('Invalid Canvas ontology review plan checksum');
  }
  const unsigned = { ...plan, integrity: integrityWithoutPlanHash };
  if (sha256(canonicalJson(unsigned)) !== planSha256) {
    throw new Error('Canvas ontology review plan checksum mismatch');
  }
  if (plan.integrity.snapshotSha256 !== sha256(snapshotSource)) {
    throw new Error('Canvas snapshot input hash mismatch');
  }
  const expected = sealCanvasOntologyReviewPlan({
    plan: buildCanvasOntologyReviewPlan(snapshot),
    snapshotSource,
  });
  if (canonicalJson(plan) !== canonicalJson(expected)) {
    throw new Error('Canvas ontology review plan does not match its snapshot input');
  }
  return {
    nodeCount: plan.nodes.length,
    relationCount: plan.relations.length,
    databaseMutationExecuted: false,
  };
}

function proposedSourceShape(plan) {
  if (!isRecord(plan) || !Array.isArray(plan.nodes) || !Array.isArray(plan.relations) || !Array.isArray(plan.clusters)) {
    throw new Error('Invalid reviewed Canvas ontology plan');
  }
  const copy = structuredClone(plan);
  delete copy.integrity;
  copy.nodes = copy.nodes.map((node) => ({
    ...node,
    label: node.sourceText,
    text: node.sourceText,
    kind: null,
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  }));
  copy.relations = copy.relations.map((relation) => ({
    ...relation,
    relation: null,
    reviewStatus: 'proposed',
    reviewer: null,
    reviewedAt: null,
  }));
  copy.clusters = copy.clusters.map((cluster) => ({
    ...cluster,
    reviewStatus: 'proposed',
    issueNodeId: null,
    reviewer: null,
    reviewedAt: null,
  }));
  return copy;
}

function validateReviewAudit(item) {
  const reviewer = nonemptyString(item.reviewer, 'authenticated reviewer id');
  if (!AUTH_REVIEWER_ID.test(reviewer)) throw new Error('Invalid authenticated reviewer id');
  const reviewedAt = nonemptyString(item.reviewedAt, 'reviewedAt');
  if (new Date(reviewedAt).toISOString() !== reviewedAt) throw new Error('Invalid reviewedAt');
}

function countValues(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/** Converts an explicitly reviewed local plan to the current graph JSON schema. */
export function exportReviewedCanvasOntology({ reviewedPlan, snapshot, snapshotSource }) {
  const expected = buildCanvasOntologyReviewPlan(snapshot);
  if (reviewedPlan.integrity?.snapshotSha256 !== sha256(snapshotSource)) {
    throw new Error('Reviewed Canvas ontology plan snapshot hash mismatch');
  }
  if (canonicalJson(proposedSourceShape(reviewedPlan)) !== canonicalJson(expected)) {
    throw new Error('Reviewed Canvas ontology plan does not match its snapshot input');
  }
  if (sha256(snapshotSource) !== sha256(JSON.stringify(snapshot))) {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.isBuffer(snapshotSource) ? snapshotSource.toString('utf8') : snapshotSource);
    } catch {
      throw new Error('Canvas snapshot source is invalid');
    }
    if (canonicalJson(parsed) !== canonicalJson(snapshot)) {
      throw new Error('Canvas snapshot source does not match parsed input');
    }
  }
  const snapshotId = reviewedPlan.source?.snapshotId;
  if ((typeof snapshotId !== 'string' && typeof snapshotId !== 'number') || String(snapshotId).length === 0) {
    throw new Error('Reviewed Canvas export requires a snapshot id');
  }

  const acceptedNodes = new Map();
  for (const node of reviewedPlan.nodes) {
    if (!['accepted', 'edited', 'rejected'].includes(node.reviewStatus)) {
      throw new Error('Canvas ontology review is incomplete');
    }
    validateReviewAudit(node);
    if (node.reviewStatus === 'rejected') {
      if (node.kind !== null) throw new Error('Rejected Canvas ontology node must not have a kind');
      continue;
    }
    if (!CANVAS_ONTOLOGY_NODE_KINDS.includes(node.kind)) throw new Error('Invalid reviewed ontology node kind');
    const label = nonemptyString(node.label, 'reviewed ontology node label');
    const text = nonemptyString(node.text, 'reviewed ontology node text');
    if (label.length > 200) throw new Error('Reviewed ontology node label exceeds 200 characters');
    const contentEdited = label !== node.sourceText || text !== node.sourceText;
    if (contentEdited && node.reviewStatus !== 'edited') {
      throw new Error('Edited Canvas ontology content requires edited review status');
    }
    if (!contentEdited && node.reviewStatus === 'edited') {
      throw new Error('Unchanged Canvas ontology content must use accepted review status');
    }
    acceptedNodes.set(node.id, node);
  }

  const acceptedRelations = [];
  for (const relation of reviewedPlan.relations) {
    if (!['accepted', 'rejected'].includes(relation.reviewStatus)) {
      throw new Error('Canvas ontology review is incomplete');
    }
    validateReviewAudit(relation);
    if (relation.reviewStatus === 'rejected') {
      if (relation.relation !== null) throw new Error('Rejected Canvas ontology relation must not have a type');
      continue;
    }
    if (!CANVAS_ONTOLOGY_RELATIONS.includes(relation.relation)) throw new Error('Invalid reviewed ontology relation type');
    if (!acceptedNodes.has(relation.source) || !acceptedNodes.has(relation.target)) {
      throw new Error('Accepted relation requires accepted endpoint nodes');
    }
    acceptedRelations.push(relation);
  }

  const clusterIssueByMember = new Map();
  for (const cluster of reviewedPlan.clusters) {
    if (!['accepted', 'rejected'].includes(cluster.reviewStatus)) {
      throw new Error('Canvas ontology review is incomplete');
    }
    validateReviewAudit(cluster);
    if (cluster.reviewStatus === 'rejected') {
      if (cluster.issueNodeId !== null) throw new Error('Rejected Canvas cluster must not select an issue node');
      continue;
    }
    const issueNode = acceptedNodes.get(cluster.issueNodeId);
    if (!issueNode || issueNode.kind !== 'Issue' || !cluster.memberNodeIds.includes(cluster.issueNodeId)) {
      throw new Error('Accepted Canvas cluster requires an accepted member Issue node');
    }
    for (const memberNodeId of cluster.memberNodeIds) {
      if (acceptedNodes.has(memberNodeId)) clusterIssueByMember.set(memberNodeId, cluster.issueNodeId);
    }
  }

  const degree = new Map([...acceptedNodes.keys()].map((id) => [id, 0]));
  for (const relation of acceptedRelations) {
    degree.set(relation.source, (degree.get(relation.source) ?? 0) + 1);
    degree.set(relation.target, (degree.get(relation.target) ?? 0) + 1);
  }
  const graphNodes = [...acceptedNodes.values()].map((node) => {
    const citation = `canvas-snapshot:${snapshotId}:agenda:${node.sourceAgendaId}`;
    return {
      data: {
        id: node.id,
        node_id: node.id,
        label: node.label,
        kind: node.kind,
        kindKo: KIND_KO[node.kind],
        text: node.text,
        cited: [citation],
        cited_uids: [citation],
        session: node.sourceSessionId,
        review_state: node.reviewStatus,
        is_public: false,
        synthesized: false,
        deg: degree.get(node.id) ?? 0,
        isolated: (degree.get(node.id) ?? 0) === 0,
        meta: {
          source_snapshot_id: snapshotId,
          source_agenda_id: node.sourceAgendaId,
          source_text_sha256: sha256(node.sourceText),
          content_edited: node.label !== node.sourceText || node.text !== node.sourceText,
          source_kind: node.sourceKind,
          canvas_group_id: node.groupId,
          cluster_issue_node_id: clusterIssueByMember.get(node.id) ?? null,
          reviewer: node.reviewer,
          reviewed_at: node.reviewedAt,
        },
      },
    };
  });
  const graphEdges = acceptedRelations.map((relation) => ({
    data: {
      id: relation.id,
      source: relation.source,
      target: relation.target,
      rel: relation.relation,
      relKo: RELATION_KO[relation.relation],
      meta: {
        source_type: relation.sourceType,
        source_link_id: relation.sourceLinkId,
        reviewer: relation.reviewer,
        reviewed_at: relation.reviewedAt,
      },
    },
  }));
  const reviewedTimes = [
    ...acceptedNodes.values(), ...acceptedRelations,
    ...reviewedPlan.clusters.filter((cluster) => cluster.reviewStatus === 'accepted'),
  ].map((item) => item.reviewedAt).sort();

  return {
    elements: { nodes: graphNodes, edges: graphEdges },
    meta: {
      variant: 'canvas-reviewed-export',
      generated_at: reviewedTimes.at(-1) ?? null,
      counts: {
        nodes: graphNodes.length,
        edges: graphEdges.length,
        by_kind: countValues(graphNodes.map((node) => node.data.kind)),
        by_rel: countValues(graphEdges.map((edge) => edge.data.rel)),
      },
      kinds: countValues(graphNodes.map((node) => node.data.kind)),
      advisory_notice: '사람이 검수한 내부 export이며 공개 승인을 뜻하지 않습니다.',
      live: false,
      publication_status: 'internal_reviewed_export',
      requires_publication_review: true,
      source: {
        snapshot_id: snapshotId,
        snapshot_source: reviewedPlan.source.snapshotSource,
        taken_at: reviewedPlan.source.takenAt,
        snapshot_sha256: sha256(snapshotSource),
      },
    },
  };
}

function readJsonFile(path, label) {
  try {
    const source = readFileSync(path);
    return { source, data: JSON.parse(source.toString('utf8')) };
  } catch (error) {
    throw new Error(`Cannot parse ${label} JSON`, { cause: error });
  }
}

function writeJsonFile(path, value, force) {
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: force ? 'w' : 'wx',
    });
  } catch (error) {
    if (!force && isRecord(error) && error.code === 'EEXIST') {
      throw new Error('Output already exists; use --force to replace it');
    }
    throw error;
  }
}

function parseCliArgs(argv) {
  const values = new Map();
  let force = false;
  const valueOptions = new Set([
    '--snapshot', '--output-plan', '--verify-plan', '--seed-plan', '--output-seed', '--verify-seed',
    '--reviewed-plan', '--output-graph',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') {
      force = true;
      continue;
    }
    if (!valueOptions.has(argument)) throw new Error('Unknown Canvas ontology bridge argument');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  if (!values.has('--snapshot')) throw new Error('Missing required argument: --snapshot');
  const create = values.has('--output-plan');
  const verify = values.has('--verify-plan');
  const createSeed = values.has('--output-seed');
  const verifySeed = values.has('--verify-seed');
  const seed = values.has('--seed-plan') || createSeed || verifySeed;
  const exportGraph = values.has('--reviewed-plan') || values.has('--output-graph');
  if ([create, verify, seed, exportGraph].filter(Boolean).length !== 1) {
    throw new Error('Select exactly one Canvas ontology bridge mode');
  }
  if (seed && (!values.has('--seed-plan') || [createSeed, verifySeed].filter(Boolean).length !== 1)) {
    throw new Error('Review queue seed requires --seed-plan and exactly one of --output-seed or --verify-seed');
  }
  if (exportGraph && (!values.has('--reviewed-plan') || !values.has('--output-graph'))) {
    throw new Error('Reviewed export requires --reviewed-plan and --output-graph');
  }
  if ((verify || verifySeed) && force) throw new Error('--force is not valid when verifying an artifact');
  return {
    snapshotPath: values.get('--snapshot'),
    outputPlanPath: values.get('--output-plan'),
    verifyPlanPath: values.get('--verify-plan'),
    seedPlanPath: values.get('--seed-plan'),
    outputSeedPath: values.get('--output-seed'),
    verifySeedPath: values.get('--verify-seed'),
    reviewedPlanPath: values.get('--reviewed-plan'),
    outputGraphPath: values.get('--output-graph'),
    force,
  };
}

function isInsidePublicDirectory(path) {
  const pathFromPublic = relative(PUBLIC_ROOT, resolve(path));
  return pathFromPublic === ''
    || (!pathFromPublic.startsWith('..') && !isAbsolute(pathFromPublic));
}

export function runCanvasOntologyBridgeCli(argv) {
  const options = parseCliArgs(argv);
  const outputPath = options.outputPlanPath ?? options.outputSeedPath ?? options.outputGraphPath;
  if (outputPath && isInsidePublicDirectory(outputPath)) {
    throw new Error('Canvas ontology output must stay outside the repository public directory');
  }
  const snapshotFile = readJsonFile(options.snapshotPath, 'Canvas snapshot');
  if (options.outputPlanPath) {
    const plan = sealCanvasOntologyReviewPlan({
      plan: buildCanvasOntologyReviewPlan(snapshotFile.data),
      snapshotSource: snapshotFile.source,
    });
    writeJsonFile(options.outputPlanPath, plan, options.force);
    return `${plan.nodes.length} nodes; ${plan.relations.length} relations; database mutation: false; public graph written: false`;
  }
  if (options.verifyPlanPath) {
    const planFile = readJsonFile(options.verifyPlanPath, 'Canvas ontology review plan');
    const result = verifyCanvasOntologyReviewPlan({
      plan: planFile.data,
      snapshot: snapshotFile.data,
      snapshotSource: snapshotFile.source,
    });
    return `Canvas ontology review plan verified (${result.nodeCount} nodes; ${result.relationCount} relations; database mutation: false)`;
  }
  if (options.outputSeedPath || options.verifySeedPath) {
    const planFile = readJsonFile(options.seedPlanPath, 'Canvas ontology review plan');
    verifyCanvasOntologyReviewPlan({
      plan: planFile.data,
      snapshot: snapshotFile.data,
      snapshotSource: snapshotFile.source,
    });
    const seed = buildOntologyReviewQueueSeed(planFile.data);
    if (options.outputSeedPath) {
      writeJsonFile(options.outputSeedPath, seed, options.force);
      return `${seed.counts.total} review queue items; database mutation: false; approval required: true`;
    }
    const seedFile = readJsonFile(options.verifySeedPath, 'ontology review queue seed');
    const result = verifyOntologyReviewQueueSeed(seedFile.data);
    if (canonicalJson(seedFile.data) !== canonicalJson(seed)) {
      throw new Error('Ontology review queue seed does not match its source plan');
    }
    return `Ontology review queue seed verified (${result.itemCount} items; database mutation: false)`;
  }
  const reviewedPlanFile = readJsonFile(options.reviewedPlanPath, 'reviewed Canvas ontology plan');
  const graph = exportReviewedCanvasOntology({
    reviewedPlan: reviewedPlanFile.data,
    snapshot: snapshotFile.data,
    snapshotSource: snapshotFile.source,
  });
  writeJsonFile(options.outputGraphPath, graph, options.force);
  return `${graph.meta.counts.nodes} nodes; ${graph.meta.counts.edges} edges; database mutation: false; public graph written: false`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    console.log(runCanvasOntologyBridgeCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Canvas ontology bridge failed');
    process.exitCode = 1;
  }
}
