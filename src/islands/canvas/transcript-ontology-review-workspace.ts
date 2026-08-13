import { isAuthenticatedReviewerId } from './useAuth';

type ReviewStatus = 'proposed' | 'accepted' | 'edited' | 'rejected';

export interface TranscriptCitation {
  uid: string;
  startMs: number;
  endMs: number;
  speakerLabelPseudonym: string;
  text: string;
}

interface ReviewAudit {
  reviewStatus: ReviewStatus;
  reviewer: string | null;
  reviewedAt: string | null;
}

export interface TranscriptOntologyReviewNode extends ReviewAudit {
  id: string;
  sourceUid: string;
  kindCandidate: string;
  kind: string | null;
  sourceLabel: string;
  sourceText: string;
  label: string;
  text: string;
  citedUids: string[];
  transcript: TranscriptCitation[];
}

export interface TranscriptOntologyReviewRelation extends ReviewAudit {
  id: string;
  sourceUid: string;
  source: string;
  target: string;
  relationCandidate: string;
  relation: string | null;
  citedUids: string[];
  transcript: TranscriptCitation[];
}

export interface TranscriptOntologyReviewWorkspace {
  source: {
    fixtureId: string;
    sessionId: string;
    language: string;
    reviewedBy: string;
    reviewedAt: string;
    fixtureSha256: string;
    fixtureText: string;
  };
  nodes: TranscriptOntologyReviewNode[];
  relations: TranscriptOntologyReviewRelation[];
  summary: {
    nodes: number;
    relations: number;
    decided: number;
    total: number;
  };
  safety: {
    localOnly: true;
    databaseMutationExecuted: false;
    publicGraphWritten: false;
    requiresHumanReview: true;
  };
}

interface DecisionAudit {
  reviewer: string;
  reviewedAt: string;
}

export type TranscriptOntologyReviewDecision = DecisionAudit & (
  | {
    itemType: 'node';
    id: string;
    status: 'accepted' | 'edited' | 'rejected';
    kind?: string;
    label?: string;
    text?: string;
  }
  | {
    itemType: 'relation';
    id: string;
    status: 'accepted' | 'edited' | 'rejected';
    relation?: string;
  }
);

export type TranscriptOntologyReviewDraft =
  | { itemType: 'node'; id: string; kind?: string; label?: string; text?: string }
  | { itemType: 'relation'; id: string; relation?: string };

export const TRANSCRIPT_ONTOLOGY_NODE_KINDS = [
  'Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence',
] as const;
export const TRANSCRIPT_ONTOLOGY_RELATIONS = [
  'supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
  'modifies', 'isAbout', 'raisesIssue', 'impacts',
] as const;
const NODE_KINDS = new Set<string>(TRANSCRIPT_ONTOLOGY_NODE_KINDS);
const RELATIONS = new Set<string>(TRANSCRIPT_ONTOLOGY_RELATIONS);
const DECISION_STATUSES = new Set<string>(['accepted', 'edited', 'rejected']);
const OPAQUE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SPEAKER_PATTERN = /^speaker-[a-z]{1,3}$/;
const FIXTURE_REVIEWER_PATTERN = /^(moderator|reviewer)-(fixture|test)$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Transcript ontology fixture is not valid JSON');
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Invalid ${label}`);
  return value;
}

function opaqueId(value: unknown, label: string): string {
  const result = text(value, label);
  if (!OPAQUE_ID_PATTERN.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function canonicalInstant(value: unknown, label: string): string {
  const result = text(value, label);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== result) throw new Error(`Invalid ${label}`);
  return result;
}

function citations(value: unknown, chunks: Map<string, TranscriptCitation>, label: string): {
  citedUids: string[];
  transcript: TranscriptCitation[];
} {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`Invalid ${label} citations`);
  const citedUids = value.map((entry) => opaqueId(entry, `${label} citation`));
  if (new Set(citedUids).size !== citedUids.length) throw new Error(`Duplicate ${label} citation`);
  const transcript = citedUids.map((uid) => chunks.get(uid));
  if (transcript.some((chunk) => chunk === undefined)) throw new Error(`${label} cites an unknown transcript chunk`);
  return { citedUids, transcript: transcript as TranscriptCitation[] };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Opens a local-only review workspace from a synthetic transcript ontology fixture. */
export async function createTranscriptOntologyReviewWorkspace(
  fixtureText: string,
): Promise<TranscriptOntologyReviewWorkspace> {
  const input = parseJson(fixtureText);
  if (!isRecord(input) || input.schemaVersion !== 1 || input.kind !== 'transcript-ontology-fixture') {
    throw new Error('Invalid transcript ontology fixture');
  }
  const fixtureId = opaqueId(input.fixtureId, 'fixture id');
  const sessionId = opaqueId(input.sessionId, 'session id');
  const language = text(input.language, 'fixture language');
  const reviewedBy = text(input.reviewedBy, 'fixture reviewer');
  const reviewedAt = canonicalInstant(input.reviewedAt, 'fixture reviewedAt');
  if (!LANGUAGE_PATTERN.test(language)) throw new Error('Invalid fixture language');
  if (!FIXTURE_REVIEWER_PATTERN.test(reviewedBy)) throw new Error('Invalid fixture reviewer alias');
  if (!Array.isArray(input.chunks) || input.chunks.length === 0) throw new Error('Invalid transcript chunks');
  const chunks = new Map<string, TranscriptCitation>();
  for (const value of input.chunks) {
    if (!isRecord(value)) throw new Error('Invalid transcript chunk');
    const uid = opaqueId(value.uid, 'transcript chunk uid');
    if (chunks.has(uid)) throw new Error('Duplicate transcript chunk uid');
    if (!Number.isSafeInteger(value.startMs) || !Number.isSafeInteger(value.endMs)
      || Number(value.startMs) < 0 || Number(value.endMs) <= Number(value.startMs)) {
      throw new Error('Invalid transcript chunk time range');
    }
    const speakerLabelPseudonym = text(value.speakerLabelPseudonym, 'speaker pseudonym');
    if (!SPEAKER_PATTERN.test(speakerLabelPseudonym)) throw new Error('Invalid speaker pseudonym');
    chunks.set(uid, {
      uid,
      startMs: Number(value.startMs),
      endMs: Number(value.endMs),
      speakerLabelPseudonym,
      text: text(value.text, 'transcript chunk text'),
    });
  }
  if (!isRecord(input.expected) || !Array.isArray(input.expected.nodes)
    || !Array.isArray(input.expected.relations) || input.expected.nodes.length === 0) {
    throw new Error('Invalid transcript ontology candidates');
  }
  const nodeIds = new Map<string, string>();
  const nodes = input.expected.nodes.map((value): TranscriptOntologyReviewNode => {
    if (!isRecord(value)) throw new Error('Invalid transcript ontology node candidate');
    const sourceUid = opaqueId(value.uid, 'node candidate uid');
    if (nodeIds.has(sourceUid)) throw new Error('Duplicate node candidate uid');
    const id = `transcript-node:${sourceUid}`;
    nodeIds.set(sourceUid, id);
    const kindCandidate = text(value.kind, 'node candidate kind');
    if (!NODE_KINDS.has(kindCandidate)) throw new Error('Invalid node candidate kind');
    const sourceLabel = text(value.label, 'node candidate label');
    const sourceText = text(value.text, 'node candidate text');
    return {
      id,
      sourceUid,
      kindCandidate,
      kind: kindCandidate,
      sourceLabel,
      sourceText,
      label: sourceLabel,
      text: sourceText,
      ...citations(value.citedUids, chunks, 'node candidate'),
      reviewStatus: 'proposed',
      reviewer: null,
      reviewedAt: null,
    };
  });
  const relationIds = new Set<string>();
  const relations = input.expected.relations.map((value): TranscriptOntologyReviewRelation => {
    if (!isRecord(value)) throw new Error('Invalid transcript ontology relation candidate');
    const sourceUid = opaqueId(value.uid, 'relation candidate uid');
    if (relationIds.has(sourceUid)) throw new Error('Duplicate relation candidate uid');
    relationIds.add(sourceUid);
    const source = nodeIds.get(opaqueId(value.sourceUid, 'relation source'));
    const target = nodeIds.get(opaqueId(value.targetUid, 'relation target'));
    if (!source || !target) throw new Error('Relation candidate references an unknown node');
    const relationCandidate = text(value.relation, 'relation candidate type');
    if (!RELATIONS.has(relationCandidate)) throw new Error('Invalid relation candidate type');
    return {
      id: `transcript-edge:${sourceUid}`,
      sourceUid,
      source,
      target,
      relationCandidate,
      relation: relationCandidate,
      ...citations(value.citedUids, chunks, 'relation candidate'),
      reviewStatus: 'proposed',
      reviewer: null,
      reviewedAt: null,
    };
  });
  return {
    source: {
      fixtureId, sessionId, language, reviewedBy, reviewedAt,
      fixtureSha256: await sha256(fixtureText), fixtureText,
    },
    nodes,
    relations,
    summary: { nodes: nodes.length, relations: relations.length, decided: 0, total: nodes.length + relations.length },
    safety: {
      localOnly: true,
      databaseMutationExecuted: false,
      publicGraphWritten: false,
      requiresHumanReview: true,
    },
  };
}

function decisionAudit(
  workspace: TranscriptOntologyReviewWorkspace,
  decision: DecisionAudit,
): Pick<ReviewAudit, 'reviewer' | 'reviewedAt'> {
  const reviewer = text(decision.reviewer, 'authenticated reviewer id');
  if (!isAuthenticatedReviewerId(reviewer)) throw new Error('Invalid authenticated reviewer id');
  const reviewedAt = canonicalInstant(decision.reviewedAt, 'decision reviewedAt');
  if (reviewedAt < workspace.source.reviewedAt) throw new Error('Decision predates fixture review');
  return { reviewer, reviewedAt };
}

function summarize(
  nodes: TranscriptOntologyReviewNode[],
  relations: TranscriptOntologyReviewRelation[],
): TranscriptOntologyReviewWorkspace['summary'] {
  return {
    nodes: nodes.length,
    relations: relations.length,
    decided: [...nodes, ...relations].filter((item) => DECISION_STATUSES.has(item.reviewStatus)).length,
    total: nodes.length + relations.length,
  };
}

/** Applies one local human decision without persistence or publication. */
export function reviewTranscriptOntologyCandidate(
  workspace: TranscriptOntologyReviewWorkspace,
  decision: TranscriptOntologyReviewDecision,
): TranscriptOntologyReviewWorkspace {
  if (decision.itemType !== 'node' && decision.itemType !== 'relation') {
    throw new Error('Invalid transcript ontology review item type');
  }
  if (!DECISION_STATUSES.has(decision.status)) throw new Error('Invalid transcript ontology review status');
  const audit = decisionAudit(workspace, decision);
  if (decision.itemType === 'node') {
    const target = workspace.nodes.find((node) => node.id === decision.id);
    if (!target) throw new Error('Transcript ontology node candidate was not found');
    let replacement: TranscriptOntologyReviewNode;
    if (decision.status === 'rejected') {
      if (workspace.relations.some((relation) => (
        (relation.source === target.id || relation.target === target.id)
        && (relation.reviewStatus === 'accepted' || relation.reviewStatus === 'edited')
      ))) {
        throw new Error('Reject dependent reviewed relations before rejecting this node');
      }
      replacement = {
        ...target,
        kind: null,
        label: target.sourceLabel,
        text: target.sourceText,
        reviewStatus: 'rejected',
        ...audit,
      };
    } else {
      const kind = text(decision.kind, 'reviewed node kind');
      if (!NODE_KINDS.has(kind)) throw new Error('Invalid reviewed node kind');
      const label = text(decision.label, 'reviewed node label');
      const reviewedText = text(decision.text, 'reviewed node text');
      const changed = label !== target.sourceLabel || reviewedText !== target.sourceText || kind !== target.kindCandidate;
      if (decision.status === 'accepted' && changed) throw new Error('Edited node content requires edited status');
      if (decision.status === 'edited' && !changed) throw new Error('Edited node decision requires a change');
      replacement = {
        ...target,
        kind,
        label,
        text: reviewedText,
        reviewStatus: decision.status,
        ...audit,
      };
    }
    const nodes = workspace.nodes.map((node) => node.id === target.id ? replacement : node);
    return { ...workspace, nodes, summary: summarize(nodes, workspace.relations) };
  }
  const target = workspace.relations.find((relation) => relation.id === decision.id);
  if (!target) throw new Error('Transcript ontology relation candidate was not found');
  const relation = decision.status === 'rejected' ? null : text(decision.relation, 'reviewed relation type');
  if (relation !== null && !RELATIONS.has(relation)) throw new Error('Invalid reviewed relation type');
  if (decision.status !== 'rejected') {
    const source = workspace.nodes.find((node) => node.id === target.source);
    const destination = workspace.nodes.find((node) => node.id === target.target);
    if (!source || !destination || source.reviewStatus === 'rejected' || destination.reviewStatus === 'rejected') {
      throw new Error('Reviewed relation requires non-rejected endpoint nodes');
    }
    const changed = relation !== target.relationCandidate;
    if (decision.status === 'accepted' && changed) throw new Error('Edited relation requires edited status');
    if (decision.status === 'edited' && !changed) throw new Error('Edited relation decision requires a change');
  }
  const replacement: TranscriptOntologyReviewRelation = {
    ...target,
    relation,
    reviewStatus: decision.status,
    ...audit,
  };
  const relations = workspace.relations.map((item) => item.id === target.id ? replacement : item);
  return { ...workspace, relations, summary: summarize(workspace.nodes, relations) };
}

/** Updates one visible draft and invalidates its prior decision. */
export function updateTranscriptOntologyCandidateDraft(
  workspace: TranscriptOntologyReviewWorkspace,
  item: TranscriptOntologyReviewDraft,
): TranscriptOntologyReviewWorkspace {
  if (item.itemType === 'node') {
    const target = workspace.nodes.find((node) => node.id === item.id);
    if (!target) throw new Error('Transcript ontology node candidate was not found');
    const kind = item.kind ?? target.kind ?? target.kindCandidate;
    const label = item.label ?? target.label;
    const draftText = item.text ?? target.text;
    if (!NODE_KINDS.has(kind)) throw new Error('Invalid reviewed node kind');
    text(label, 'reviewed node label');
    text(draftText, 'reviewed node text');
    const nodes = workspace.nodes.map((node) => node.id === target.id ? {
      ...node,
      kind,
      label,
      text: draftText,
      reviewStatus: 'proposed' as const,
      reviewer: null,
      reviewedAt: null,
    } : node);
    return { ...workspace, nodes, summary: summarize(nodes, workspace.relations) };
  }
  const target = workspace.relations.find((relation) => relation.id === item.id);
  if (!target) throw new Error('Transcript ontology relation candidate was not found');
  const relationType = item.relation ?? target.relation ?? target.relationCandidate;
  if (!RELATIONS.has(relationType)) throw new Error('Invalid reviewed relation type');
  const relations = workspace.relations.map((relation) => relation.id === target.id ? {
    ...relation,
    relation: relationType,
    reviewStatus: 'proposed' as const,
    reviewer: null,
    reviewedAt: null,
  } : relation);
  return { ...workspace, relations, summary: summarize(workspace.nodes, relations) };
}

/** Serializes a complete local review plan while preserving the no-publication boundary. */
export async function exportTranscriptOntologyReviewedPlan(
  workspace: TranscriptOntologyReviewWorkspace,
): Promise<string> {
  if (workspace.summary.decided !== workspace.summary.total) {
    throw new Error('Transcript ontology review is incomplete');
  }
  let rebuilt = await createTranscriptOntologyReviewWorkspace(workspace.source.fixtureText);
  for (const node of workspace.nodes) {
    if (node.reviewStatus === 'proposed' || !node.reviewer || !node.reviewedAt) {
      throw new Error('Transcript ontology review is incomplete');
    }
    rebuilt = reviewTranscriptOntologyCandidate(rebuilt, {
      itemType: 'node', id: node.id, status: node.reviewStatus,
      kind: node.kind ?? undefined, label: node.label, text: node.text,
      reviewer: node.reviewer, reviewedAt: node.reviewedAt,
    });
  }
  for (const relation of workspace.relations) {
    if (relation.reviewStatus === 'proposed' || !relation.reviewer || !relation.reviewedAt) {
      throw new Error('Transcript ontology review is incomplete');
    }
    rebuilt = reviewTranscriptOntologyCandidate(rebuilt, {
      itemType: 'relation', id: relation.id, status: relation.reviewStatus,
      relation: relation.relation ?? undefined,
      reviewer: relation.reviewer, reviewedAt: relation.reviewedAt,
    });
  }
  if (JSON.stringify(rebuilt) !== JSON.stringify(workspace)) {
    throw new Error('Transcript ontology review workspace integrity check failed');
  }
  const source = {
    fixtureId: workspace.source.fixtureId,
    sessionId: workspace.source.sessionId,
    language: workspace.source.language,
    reviewedBy: workspace.source.reviewedBy,
    reviewedAt: workspace.source.reviewedAt,
    fixtureSha256: workspace.source.fixtureSha256,
  };
  return `${JSON.stringify({
    schemaVersion: 1,
    kind: 'transcript-ontology-reviewed-plan',
    dryRun: true,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
    requiresPublicationReview: true,
    source,
    nodes: workspace.nodes,
    relations: workspace.relations,
  }, null, 2)}\n`;
}
