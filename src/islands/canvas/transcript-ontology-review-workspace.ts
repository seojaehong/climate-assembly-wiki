import { isAuthenticatedReviewerId } from './useAuth';

type DecidedReviewStatus = 'accepted' | 'edited' | 'merged' | 'rejected';
type PendingReviewStatus = 'deferred' | 'follow_up';
type ReviewStatus = 'proposed' | PendingReviewStatus | DecidedReviewStatus;

export interface TranscriptCitation {
  uid: string;
  startMs: number;
  endMs: number;
  speakerLabelPseudonym: string;
  text: string;
  sourceReview?: {
    reviewStatus: 'accepted' | 'edited';
    reviewer: string;
    reviewedAt: string;
    sourceText: string;
    candidateSetId: string | null;
    candidateSourceUid: string | null;
  };
}

export interface PrivateTranscriptExtractionHandoff {
  kind: 'private-transcript-extraction-handoff';
  reviewBatchSha256: string;
  captureId: string;
  roomId: string;
  language: string;
  captureMethod: 'browser-media-recorder' | 'table-recorder-file';
  audioSha256: string;
  candidateSetId: string;
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
  followUpQuestion: string | null;
  minorityConcern: boolean;
  mergeTargetId: string | null;
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
  followUpQuestion: string | null;
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
    handoff: PrivateTranscriptExtractionHandoff | null;
  };
  nodes: TranscriptOntologyReviewNode[];
  relations: TranscriptOntologyReviewRelation[];
  summary: {
    nodes: number;
    relations: number;
    decided: number;
    deferred: number;
    followUp: number;
    total: number;
  };
  safety: {
    localOnly: true;
    databaseMutationExecuted: false;
    publicGraphWritten: false;
    requiresHumanReview: true;
  };
}

export interface TranscriptOntologyModeratorDraftNode {
  id: string;
  kind: string;
  label: string;
  text: string;
  sourceUid: string;
  mergedSourceUids: string[];
  citedUids: string[];
  minorityConcern: boolean;
}

export interface TranscriptOntologyModeratorDraftRelation {
  id: string;
  source: string;
  target: string;
  relation: string;
  sourceUid: string;
  citedUids: string[];
}

export interface TranscriptOntologyModeratorDraftGraph {
  schemaVersion: 1;
  mode: 'moderator_draft';
  markedDraft: true;
  source: {
    fixtureId: string;
    fixtureSha256: string;
    sessionId: string;
  };
  nodes: TranscriptOntologyModeratorDraftNode[];
  relations: TranscriptOntologyModeratorDraftRelation[];
  summary: {
    nodes: number;
    relations: number;
    pending: number;
  };
  safety: {
    localOnly: true;
    databaseMutationExecuted: false;
    publicGraphWritten: false;
    requiresPublicationReview: true;
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
    status: 'follow_up';
    followUpQuestion: string;
  }
  | {
    itemType: 'node';
    id: string;
    status: 'merged';
    mergeTargetId: string;
  }
  | {
    itemType: 'node';
    id: string;
    status: 'deferred' | Exclude<DecidedReviewStatus, 'merged'>;
    kind?: string;
    label?: string;
    text?: string;
    minorityConcern?: boolean;
  }
  | {
    itemType: 'relation';
    id: string;
    status: 'follow_up';
    followUpQuestion: string;
  }
  | {
    itemType: 'relation';
    id: string;
    status: 'deferred' | Exclude<DecidedReviewStatus, 'merged'>;
    relation?: string;
  }
);

export type TranscriptOntologyReviewDraft =
  | { itemType: 'node'; id: string; kind?: string; label?: string; text?: string; minorityConcern?: boolean }
  | { itemType: 'relation'; id: string; relation?: string };

export const TRANSCRIPT_ONTOLOGY_NODE_KINDS = [
  'Issue', 'Claim', 'Proposal', 'Concern', 'Condition', 'Value', 'Evidence',
] as const;
export const TRANSCRIPT_ONTOLOGY_RELATIONS = [
  'supports', 'opposes', 'hasConcern', 'requiresCondition', 'hasEvidence',
  'modifies', 'isAbout', 'raisesIssue', 'impacts',
] as const;
const TRANSCRIPT_CANDIDATE_FACILITATION_PROMPTS: Record<string, string> = {
  Issue: '이 쟁점의 범위와 서로 다른 관점을 함께 확인해 보세요.',
  Claim: '이 주장에 연결할 근거나 경험이 있는지 함께 확인해 보세요.',
  Proposal: '이 제안이 성립하려면 필요한 조건이 무엇인지 함께 확인해 보세요.',
  Concern: '이 우려가 어떤 쟁점과 연결되는지 함께 확인해 보세요.',
  Condition: '이 조건을 실제로 확인할 기준이 무엇인지 함께 확인해 보세요.',
  Value: '이 발화가 드러내는 가치와 다른 가치 사이의 긴장을 함께 확인해 보세요.',
  Evidence: '이 근거가 뒷받침하는 주장과 추가 확인이 필요한 부분을 함께 확인해 보세요.',
};
const NODE_KINDS = new Set<string>(TRANSCRIPT_ONTOLOGY_NODE_KINDS);
const RELATIONS = new Set<string>(TRANSCRIPT_ONTOLOGY_RELATIONS);
const DECISION_STATUSES = new Set<string>(['accepted', 'edited', 'merged', 'rejected']);
const REVIEW_STATUSES = new Set<string>(['deferred', 'follow_up', ...DECISION_STATUSES]);
const WORKSPACE_REVIEW_STATUSES = new Set<string>(['proposed', ...REVIEW_STATUSES]);
const OPAQUE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SPEAKER_PATTERN = /^speaker-(?:[a-z]{1,3}|unknown)$/;
const FIXTURE_REVIEWER_PATTERN = /^(moderator|reviewer)-(fixture|test)$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const TRANSCRIPT_PUBLICATION_SOURCE_PATTERN = /^live-[a-z0-9][a-z0-9._-]*$/;

export function transcriptCandidateFacilitationPrompt(kind: string): string {
  const prompt = TRANSCRIPT_CANDIDATE_FACILITATION_PROMPTS[kind];
  if (!prompt) throw new Error('Invalid transcript ontology node kind');
  return prompt;
}

export function transcriptRelationFollowUpPrompt(relation: string): string {
  if (!RELATIONS.has(relation)) throw new Error('Invalid transcript ontology relation type');
  return `두 후보 사이 ${relation} 연결의 근거와 성립 조건을 함께 확인해 보세요.`;
}

function isDecidedReviewStatus(status: string): status is DecidedReviewStatus {
  return DECISION_STATUSES.has(status);
}

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

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`Invalid ${label} fields`);
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

function privateCaptureMethod(value: unknown): PrivateTranscriptExtractionHandoff['captureMethod'] {
  if (value !== 'browser-media-recorder' && value !== 'table-recorder-file') {
    throw new Error('Invalid capture method');
  }
  return value;
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

async function canonicalSha256(value: unknown): Promise<string> {
  return sha256(JSON.stringify(canonicalize(value)));
}

function privateHandoff(value: unknown): PrivateTranscriptExtractionHandoff | null {
  if (value === undefined) return null;
  if (!isRecord(value)) throw new Error('Invalid private transcript extraction handoff');
  exactKeys(value, ['kind', 'reviewBatchSha256', 'captureId', 'roomId', 'language', 'captureMethod', 'audioSha256', 'candidateSetId'], 'private transcript extraction handoff');
  if (value.kind !== 'private-transcript-extraction-handoff') {
    throw new Error('Invalid private transcript extraction handoff');
  }
  const reviewBatchSha256 = text(value.reviewBatchSha256, 'review batch SHA-256');
  const audioSha256 = text(value.audioSha256, 'audio SHA-256');
  if (!SHA256_PATTERN.test(reviewBatchSha256) || !SHA256_PATTERN.test(audioSha256)) {
    throw new Error('Invalid private transcript extraction hash');
  }
  return {
    kind: 'private-transcript-extraction-handoff',
    reviewBatchSha256,
    captureId: opaqueId(value.captureId, 'capture id'),
    roomId: opaqueId(value.roomId, 'room id'),
    language: text(value.language, 'capture language'),
    captureMethod: privateCaptureMethod(value.captureMethod),
    audioSha256,
    candidateSetId: opaqueId(value.candidateSetId, 'candidate set id'),
  };
}

/** Binds a reviewed private transcript batch to provider-neutral ontology candidates. */
export async function buildPrivateTranscriptOntologyFixture(input: {
  reviewBatchText: string;
  extractionCandidatesText: string;
}): Promise<string> {
  const reviewBatch = parseJson(input.reviewBatchText);
  const candidates = parseJson(input.extractionCandidatesText);
  if (!isRecord(reviewBatch)) throw new Error('Invalid private transcript review batch');
  exactKeys(reviewBatch, ['schemaVersion', 'kind', 'source', 'chunks', 'summary', 'safety'], 'private transcript review batch');
  if (reviewBatch.schemaVersion !== 2 || reviewBatch.kind !== 'private-transcript-review-batch'
    || !isRecord(reviewBatch.source) || !Array.isArray(reviewBatch.chunks)
    || reviewBatch.chunks.length === 0 || !isRecord(reviewBatch.summary) || !isRecord(reviewBatch.safety)) {
    throw new Error('Invalid private transcript review batch');
  }
  const source = reviewBatch.source;
  exactKeys(source, ['captureId', 'sessionId', 'roomId', 'language', 'captureMethod', 'audioSha256', 'mimeType', 'byteLength', 'startedAt', 'stoppedAt', 'durationMs', 'storage'], 'private transcript source');
  const captureId = opaqueId(source.captureId, 'capture id');
  const sessionId = opaqueId(source.sessionId, 'session id');
  const roomId = opaqueId(source.roomId, 'room id');
  const captureLanguage = text(source.language, 'capture language');
  if (!LANGUAGE_PATTERN.test(captureLanguage)) throw new Error('Invalid capture language');
  const captureMethod = source.captureMethod;
  if (captureMethod !== 'browser-media-recorder' && captureMethod !== 'table-recorder-file') {
    throw new Error('Invalid capture method');
  }
  const audioSha256 = text(source.audioSha256, 'audio SHA-256');
  if (!SHA256_PATTERN.test(audioSha256) || source.storage !== 'browser-memory'
    || typeof source.mimeType !== 'string' || !source.mimeType.startsWith('audio/')
    || !Number.isSafeInteger(source.byteLength) || Number(source.byteLength) <= 0
    || !Number.isSafeInteger(source.durationMs) || Number(source.durationMs) <= 0) {
    throw new Error('Invalid private transcript source');
  }
  const startedAt = canonicalInstant(source.startedAt, 'capture startedAt');
  const stoppedAt = canonicalInstant(source.stoppedAt, 'capture stoppedAt');
  if (new Date(stoppedAt).valueOf() - new Date(startedAt).valueOf() !== source.durationMs) {
    throw new Error('Invalid private transcript duration');
  }
  exactKeys(reviewBatch.safety, ['localOnly', 'audioIncluded', 'databaseMutationExecuted', 'publicGraphWritten', 'extractionExecuted', 'requiresExtractionReview'], 'private transcript safety');
  if (reviewBatch.safety.localOnly !== true || reviewBatch.safety.audioIncluded !== false
    || reviewBatch.safety.databaseMutationExecuted !== false || reviewBatch.safety.publicGraphWritten !== false
    || reviewBatch.safety.extractionExecuted !== false || reviewBatch.safety.requiresExtractionReview !== true) {
    throw new Error('Invalid private transcript safety boundary');
  }
  exactKeys(reviewBatch.summary, ['included', 'rejected', 'total'], 'private transcript summary');
  if (reviewBatch.summary.included !== reviewBatch.chunks.length
    || !Number.isSafeInteger(reviewBatch.summary.rejected) || Number(reviewBatch.summary.rejected) < 0
    || reviewBatch.summary.total !== Number(reviewBatch.summary.included) + Number(reviewBatch.summary.rejected)) {
    throw new Error('Invalid private transcript summary');
  }
  const chunkIds = new Set<string>();
  let reviewedBy: string | null = null;
  let reviewedAt = stoppedAt;
  const chunks = reviewBatch.chunks.map((value): Record<string, unknown> => {
    if (!isRecord(value)) throw new Error('Invalid reviewed transcript chunk');
    exactKeys(value, ['uid', 'candidateSetId', 'candidateSourceUid', 'startMs', 'endMs', 'speakerLabelPseudonym', 'sourceText', 'text', 'reviewStatus', 'reviewer', 'reviewedAt'], 'reviewed transcript chunk');
    const uid = opaqueId(value.uid, 'reviewed transcript chunk uid');
    if (chunkIds.has(uid) || !uid.startsWith(`${captureId}:chunk:`)) throw new Error('Invalid reviewed transcript chunk uid');
    chunkIds.add(uid);
    if (!Number.isSafeInteger(value.startMs) || !Number.isSafeInteger(value.endMs)
      || Number(value.startMs) < 0 || Number(value.endMs) <= Number(value.startMs)
      || Number(value.endMs) > Number(source.durationMs)) {
      throw new Error('Invalid reviewed transcript chunk time range');
    }
    const speakerLabelPseudonym = text(value.speakerLabelPseudonym, 'speaker pseudonym');
    if (!SPEAKER_PATTERN.test(speakerLabelPseudonym)) throw new Error('Invalid speaker pseudonym');
    const sourceText = text(value.sourceText, 'reviewed transcript source text');
    const reviewedText = text(value.text, 'reviewed transcript text');
    if (!['accepted', 'edited'].includes(String(value.reviewStatus))
      || (value.reviewStatus === 'accepted' && reviewedText !== sourceText)
      || (value.reviewStatus === 'edited' && reviewedText === sourceText)
      || typeof value.reviewer !== 'string' || !isAuthenticatedReviewerId(value.reviewer)) {
      throw new Error('Invalid reviewed transcript decision');
    }
    const chunkReviewedAt = canonicalInstant(value.reviewedAt, 'transcript reviewedAt');
    if (chunkReviewedAt < stoppedAt) throw new Error('Transcript review predates capture completion');
    if (reviewedBy !== null && reviewedBy !== value.reviewer) {
      throw new Error('Private transcript handoff requires one authenticated reviewer');
    }
    reviewedBy = value.reviewer;
    if (chunkReviewedAt > reviewedAt) reviewedAt = chunkReviewedAt;
    const candidateSetId = value.candidateSetId === null ? null : opaqueId(value.candidateSetId, 'STT candidate set id');
    const candidateSourceUid = value.candidateSourceUid === null ? null : opaqueId(value.candidateSourceUid, 'STT candidate source uid');
    if ((candidateSetId === null) !== (candidateSourceUid === null)) throw new Error('Invalid STT candidate provenance');
    return {
      uid,
      startMs: value.startMs,
      endMs: value.endMs,
      speakerLabelPseudonym,
      text: reviewedText,
      sourceReview: {
        reviewStatus: value.reviewStatus,
        reviewer: value.reviewer,
        reviewedAt: chunkReviewedAt,
        sourceText,
        candidateSetId,
        candidateSourceUid,
      },
    };
  });
  if (reviewedBy === null) throw new Error('Private transcript review batch has no reviewer');

  if (!isRecord(candidates)) throw new Error('Invalid private transcript ontology candidates');
  exactKeys(candidates, ['schemaVersion', 'kind', 'candidateSetId', 'source', 'language', 'nodes', 'relations', 'safety'], 'private transcript ontology candidates');
  if (candidates.schemaVersion !== 1 || candidates.kind !== 'private-transcript-ontology-candidates'
    || !isRecord(candidates.source) || !Array.isArray(candidates.nodes) || candidates.nodes.length === 0
    || !Array.isArray(candidates.relations) || !isRecord(candidates.safety)) {
    throw new Error('Invalid private transcript ontology candidates');
  }
  const candidateSetId = opaqueId(candidates.candidateSetId, 'candidate set id');
  const language = text(candidates.language, 'candidate language');
  if (!LANGUAGE_PATTERN.test(language) || language !== captureLanguage) {
    throw new Error('Extraction candidate language does not match the reviewed transcript batch');
  }
  exactKeys(candidates.source, ['reviewBatchSha256', 'captureId', 'sessionId', 'audioSha256'], 'private extraction source');
  const reviewBatchSha256 = await sha256(input.reviewBatchText);
  if (candidates.source.reviewBatchSha256 !== reviewBatchSha256
    || candidates.source.captureId !== captureId || candidates.source.sessionId !== sessionId
    || candidates.source.audioSha256 !== audioSha256) {
    throw new Error('Extraction candidates do not match the reviewed transcript batch');
  }
  exactKeys(candidates.safety, ['localOnly', 'databaseMutationExecuted', 'publicGraphWritten', 'requiresHumanReview'], 'private extraction safety');
  if (candidates.safety.localOnly !== true || candidates.safety.databaseMutationExecuted !== false
    || candidates.safety.publicGraphWritten !== false || candidates.safety.requiresHumanReview !== true) {
    throw new Error('Invalid private extraction safety boundary');
  }
  const nodes = candidates.nodes.map((value) => {
    if (!isRecord(value)) throw new Error('Invalid private ontology node candidate');
    exactKeys(value, ['uid', 'kind', 'label', 'text', 'citedUids'], 'private ontology node candidate');
    return value;
  });
  const relations = candidates.relations.map((value) => {
    if (!isRecord(value)) throw new Error('Invalid private ontology relation candidate');
    exactKeys(value, ['uid', 'sourceUid', 'targetUid', 'relation', 'citedUids'], 'private ontology relation candidate');
    return value;
  });
  const fixture = {
    schemaVersion: 1,
    kind: 'transcript-ontology-fixture',
    fixtureId: candidateSetId,
    sessionId,
    language,
    reviewedBy,
    reviewedAt,
    source: {
      kind: 'private-transcript-extraction-handoff',
      reviewBatchSha256,
      captureId,
      roomId,
      language: captureLanguage,
      captureMethod,
      audioSha256,
      candidateSetId,
    },
    chunks,
    expected: { nodes, relations },
  };
  const fixtureText = `${JSON.stringify(fixture, null, 2)}\n`;
  await createTranscriptOntologyReviewWorkspace(fixtureText);
  return fixtureText;
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
  if (!FIXTURE_REVIEWER_PATTERN.test(reviewedBy) && !isAuthenticatedReviewerId(reviewedBy)) {
    throw new Error('Invalid fixture reviewer identity');
  }
  const handoff = privateHandoff(input.source);
  if (handoff !== null && handoff.language !== language) {
    throw new Error('Transcript extraction handoff language does not match fixture');
  }
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
    const citation: TranscriptCitation = {
      uid,
      startMs: Number(value.startMs),
      endMs: Number(value.endMs),
      speakerLabelPseudonym,
      text: text(value.text, 'transcript chunk text'),
    };
    if (value.sourceReview !== undefined) {
      if (!isRecord(value.sourceReview)) throw new Error('Invalid transcript source review');
      exactKeys(value.sourceReview, ['reviewStatus', 'reviewer', 'reviewedAt', 'sourceText', 'candidateSetId', 'candidateSourceUid'], 'transcript source review');
      if (!['accepted', 'edited'].includes(String(value.sourceReview.reviewStatus))
        || typeof value.sourceReview.reviewer !== 'string'
        || !isAuthenticatedReviewerId(value.sourceReview.reviewer)) {
        throw new Error('Invalid transcript source review');
      }
      citation.sourceReview = {
        reviewStatus: value.sourceReview.reviewStatus as 'accepted' | 'edited',
        reviewer: value.sourceReview.reviewer,
        reviewedAt: canonicalInstant(value.sourceReview.reviewedAt, 'transcript source reviewedAt'),
        sourceText: text(value.sourceReview.sourceText, 'transcript source text'),
        candidateSetId: value.sourceReview.candidateSetId === null ? null : opaqueId(value.sourceReview.candidateSetId, 'STT candidate set id'),
        candidateSourceUid: value.sourceReview.candidateSourceUid === null ? null : opaqueId(value.sourceReview.candidateSourceUid, 'STT candidate source uid'),
      };
      if ((citation.sourceReview.candidateSetId === null) !== (citation.sourceReview.candidateSourceUid === null)) {
        throw new Error('Invalid STT candidate provenance');
      }
      if (citation.sourceReview.reviewer !== reviewedBy
        || citation.sourceReview.reviewedAt > reviewedAt
        || (citation.sourceReview.reviewStatus === 'accepted' && citation.text !== citation.sourceReview.sourceText)
        || (citation.sourceReview.reviewStatus === 'edited' && citation.text === citation.sourceReview.sourceText)) {
        throw new Error('Transcript source review does not match the fixture audit');
      }
    }
    chunks.set(uid, citation);
  }
  const reviewedChunks = [...chunks.values()].filter((chunk) => chunk.sourceReview !== undefined);
  if ((handoff === null && reviewedChunks.length > 0)
    || (handoff !== null && reviewedChunks.length !== chunks.size)
    || (handoff !== null && reviewedChunks.every((chunk) => chunk.sourceReview?.reviewedAt !== reviewedAt))) {
    throw new Error('Transcript source review does not match the extraction handoff');
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
      followUpQuestion: null,
      minorityConcern: false,
      mergeTargetId: null,
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
      followUpQuestion: null,
      reviewStatus: 'proposed',
      reviewer: null,
      reviewedAt: null,
    };
  });
  return {
    source: {
      fixtureId, sessionId, language, reviewedBy, reviewedAt,
      fixtureSha256: await sha256(fixtureText), fixtureText, handoff,
    },
    nodes,
    relations,
    summary: {
      nodes: nodes.length,
      relations: relations.length,
      decided: 0,
      deferred: 0,
      followUp: 0,
      total: nodes.length + relations.length,
    },
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
    decided: [...nodes, ...relations].filter((item) => isDecidedReviewStatus(item.reviewStatus)).length,
    deferred: [...nodes, ...relations].filter((item) => item.reviewStatus === 'deferred').length,
    followUp: [...nodes, ...relations].filter((item) => item.reviewStatus === 'follow_up').length,
    total: nodes.length + relations.length,
  };
}

function invalidateReviewedRelationsForNode(
  relations: TranscriptOntologyReviewRelation[],
  nodeId: string,
): TranscriptOntologyReviewRelation[] {
  return relations.map((relation) => (
    (relation.source === nodeId || relation.target === nodeId)
    && (relation.reviewStatus === 'accepted' || relation.reviewStatus === 'edited' || relation.reviewStatus === 'follow_up')
      ? {
        ...relation,
        reviewStatus: 'proposed' as const,
        reviewer: null,
        reviewedAt: null,
        followUpQuestion: null,
      }
      : relation
  ));
}

function resolvedTranscriptNode(
  nodes: TranscriptOntologyReviewNode[],
  nodeId: string,
): TranscriptOntologyReviewNode | null {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  if (node.reviewStatus !== 'merged') return node;
  if (!node.mergeTargetId) return null;
  const target = nodes.find((candidate) => candidate.id === node.mergeTargetId);
  return target?.reviewStatus === 'accepted' || target?.reviewStatus === 'edited' ? target : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/** Builds the moderator-only partial graph shown during review. */
export function buildTranscriptOntologyModeratorDraftGraph(
  workspace: TranscriptOntologyReviewWorkspace,
): TranscriptOntologyModeratorDraftGraph {
  const reviewedNodes = workspace.nodes.filter((node) => (
    node.reviewStatus === 'accepted' || node.reviewStatus === 'edited'
  ));
  const nodes = reviewedNodes.map((node) => {
    if (!node.kind || !NODE_KINDS.has(node.kind)) throw new Error('Reviewed draft node is missing a valid kind');
    const mergedNodes = workspace.nodes.filter((candidate) => (
      candidate.reviewStatus === 'merged' && candidate.mergeTargetId === node.id
    ));
    for (const merged of mergedNodes) {
      if (merged.kind !== node.kind) throw new Error('Merged draft node kind does not match its target');
    }
    return {
      id: node.id,
      kind: node.kind,
      label: node.label,
      text: node.text,
      sourceUid: node.sourceUid,
      mergedSourceUids: mergedNodes.map((candidate) => candidate.sourceUid),
      citedUids: uniqueStrings([...node.citedUids, ...mergedNodes.flatMap((candidate) => candidate.citedUids)]),
      minorityConcern: node.minorityConcern,
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const relations = workspace.relations
    .filter((relation) => relation.reviewStatus === 'accepted' || relation.reviewStatus === 'edited')
    .map((relation) => {
      const source = resolvedTranscriptNode(workspace.nodes, relation.source);
      const target = resolvedTranscriptNode(workspace.nodes, relation.target);
      if (!source || !target || !nodeIds.has(source.id) || !nodeIds.has(target.id)) {
        throw new Error('Reviewed draft relation requires reviewed node endpoints');
      }
      if (source.id === target.id) throw new Error('Merged draft relation cannot become a self-loop');
      if (!relation.relation || !RELATIONS.has(relation.relation)) {
        throw new Error('Reviewed draft relation is missing a valid relation type');
      }
      return {
        id: relation.id,
        source: source.id,
        target: target.id,
        relation: relation.relation,
        sourceUid: relation.sourceUid,
        citedUids: uniqueStrings(relation.citedUids),
      };
    });
  return {
    schemaVersion: 1,
    mode: 'moderator_draft',
    markedDraft: true,
    source: {
      fixtureId: workspace.source.fixtureId,
      fixtureSha256: workspace.source.fixtureSha256,
      sessionId: workspace.source.sessionId,
    },
    nodes,
    relations,
    summary: {
      nodes: nodes.length,
      relations: relations.length,
      pending: workspace.summary.total - workspace.summary.decided,
    },
    safety: {
      localOnly: true,
      databaseMutationExecuted: false,
      publicGraphWritten: false,
      requiresPublicationReview: true,
    },
  };
}

function invalidateMergedNodesForTarget(
  nodes: TranscriptOntologyReviewNode[],
  targetId: string,
): { nodes: TranscriptOntologyReviewNode[]; invalidatedIds: string[] } {
  const invalidatedIds: string[] = [];
  const next = nodes.map((node) => {
    if (node.reviewStatus !== 'merged' || node.mergeTargetId !== targetId) return node;
    invalidatedIds.push(node.id);
    return {
      ...node,
      kind: node.kindCandidate,
      label: node.sourceLabel,
      text: node.sourceText,
      minorityConcern: false,
      mergeTargetId: null,
      reviewStatus: 'proposed' as const,
      reviewer: null,
      reviewedAt: null,
      followUpQuestion: null,
    };
  });
  return { nodes: next, invalidatedIds };
}

/** Applies one local human decision without persistence or publication. */
export function reviewTranscriptOntologyCandidate(
  workspace: TranscriptOntologyReviewWorkspace,
  decision: TranscriptOntologyReviewDecision,
): TranscriptOntologyReviewWorkspace {
  if (decision.itemType !== 'node' && decision.itemType !== 'relation') {
    throw new Error('Invalid transcript ontology review item type');
  }
  if (!REVIEW_STATUSES.has(decision.status)) throw new Error('Invalid transcript ontology review status');
  const audit = decisionAudit(workspace, decision);
  if (decision.itemType === 'node') {
    const target = workspace.nodes.find((node) => node.id === decision.id);
    if (!target) throw new Error('Transcript ontology node candidate was not found');
    let replacement: TranscriptOntologyReviewNode;
    if (decision.status === 'follow_up') {
      replacement = {
        ...target,
        reviewStatus: 'follow_up',
        followUpQuestion: text(decision.followUpQuestion, 'follow-up question'),
        mergeTargetId: null,
        ...audit,
      };
    } else if (decision.status === 'deferred') {
      replacement = {
        ...target,
        reviewStatus: 'deferred',
        followUpQuestion: null,
        mergeTargetId: null,
        ...audit,
      };
    } else if (decision.status === 'merged') {
      const mergeTarget = workspace.nodes.find((node) => node.id === decision.mergeTargetId);
      const sourceKind = target.kind ?? target.kindCandidate;
      if (!mergeTarget || mergeTarget.id === target.id
        || (mergeTarget.reviewStatus !== 'accepted' && mergeTarget.reviewStatus !== 'edited')
        || mergeTarget.kind !== sourceKind) {
        throw new Error('Merge target must be a reviewed node with the same kind');
      }
      replacement = {
        ...target,
        kind: sourceKind,
        label: target.sourceLabel,
        text: target.sourceText,
        minorityConcern: false,
        mergeTargetId: mergeTarget.id,
        reviewStatus: 'merged',
        followUpQuestion: null,
        ...audit,
      };
    } else if (decision.status === 'rejected') {
      if (workspace.nodes.some((node) => node.reviewStatus === 'merged' && node.mergeTargetId === target.id)) {
        throw new Error('Unmerge dependent nodes before rejecting this node');
      }
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
        minorityConcern: false,
        mergeTargetId: null,
        reviewStatus: 'rejected',
        followUpQuestion: null,
        ...audit,
      };
    } else {
      const kind = text(decision.kind, 'reviewed node kind');
      if (!NODE_KINDS.has(kind)) throw new Error('Invalid reviewed node kind');
      const label = text(decision.label, 'reviewed node label');
      const reviewedText = text(decision.text, 'reviewed node text');
      const minorityConcern = decision.minorityConcern ?? target.minorityConcern;
      if (typeof minorityConcern !== 'boolean') throw new Error('Invalid minority concern marker');
      if (minorityConcern && kind !== 'Concern') {
        throw new Error('Minority concern marker requires Concern node kind');
      }
      const changed = label !== target.sourceLabel || reviewedText !== target.sourceText
        || kind !== target.kindCandidate || minorityConcern;
      if (decision.status === 'accepted' && changed) throw new Error('Edited node content requires edited status');
      if (decision.status === 'edited' && !changed) throw new Error('Edited node decision requires a change');
      replacement = {
        ...target,
        kind,
        label,
        text: reviewedText,
        minorityConcern,
        mergeTargetId: null,
        reviewStatus: decision.status,
        followUpQuestion: null,
        ...audit,
      };
    }
    let nodes = workspace.nodes.map((node) => node.id === target.id ? replacement : node);
    let invalidatedIds: string[] = [];
    const mergeMeaningChanged = target.reviewStatus === 'merged'
      || replacement.kind !== target.kind
      || replacement.label !== target.label
      || replacement.text !== target.text
      || replacement.reviewStatus === 'deferred'
      || replacement.reviewStatus === 'follow_up';
    if (mergeMeaningChanged) {
      const invalidated = invalidateMergedNodesForTarget(nodes, target.id);
      nodes = invalidated.nodes;
      invalidatedIds = invalidated.invalidatedIds;
    }
    const relations = mergeMeaningChanged || decision.status === 'merged'
      ? [target.id, ...invalidatedIds].reduce(
        (items, id) => invalidateReviewedRelationsForNode(items, id), workspace.relations,
      )
      : workspace.relations;
    return { ...workspace, nodes, relations, summary: summarize(nodes, relations) };
  }
  const target = workspace.relations.find((relation) => relation.id === decision.id);
  if (!target) throw new Error('Transcript ontology relation candidate was not found');
  if (decision.status === 'follow_up') {
    const replacement: TranscriptOntologyReviewRelation = {
      ...target,
      reviewStatus: 'follow_up',
      followUpQuestion: text(decision.followUpQuestion, 'follow-up question'),
      ...audit,
    };
    const relations = workspace.relations.map((item) => item.id === target.id ? replacement : item);
    return { ...workspace, relations, summary: summarize(workspace.nodes, relations) };
  }
  if (decision.status === 'deferred') {
    const replacement: TranscriptOntologyReviewRelation = {
      ...target,
      reviewStatus: 'deferred',
      followUpQuestion: null,
      ...audit,
    };
    const relations = workspace.relations.map((item) => item.id === target.id ? replacement : item);
    return { ...workspace, relations, summary: summarize(workspace.nodes, relations) };
  }
  const relation = decision.status === 'rejected' ? null : text(decision.relation, 'reviewed relation type');
  if (relation !== null && !RELATIONS.has(relation)) throw new Error('Invalid reviewed relation type');
  if (decision.status !== 'rejected') {
    const source = resolvedTranscriptNode(workspace.nodes, target.source);
    const destination = resolvedTranscriptNode(workspace.nodes, target.target);
    if (!source || !destination
      || !isDecidedReviewStatus(source.reviewStatus)
      || !isDecidedReviewStatus(destination.reviewStatus)
      || source.reviewStatus === 'rejected'
      || destination.reviewStatus === 'rejected') {
      throw new Error('Reviewed relation requires accepted or edited endpoint nodes');
    }
    if (source.id === destination.id) throw new Error('Reviewed relation cannot become a self-loop after merge');
    const changed = relation !== target.relationCandidate;
    if (decision.status === 'accepted' && changed) throw new Error('Edited relation requires edited status');
    if (decision.status === 'edited' && !changed) throw new Error('Edited relation decision requires a change');
  }
  const replacement: TranscriptOntologyReviewRelation = {
    ...target,
    relation,
    reviewStatus: decision.status,
    followUpQuestion: null,
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
    const minorityConcern = item.minorityConcern ?? target.minorityConcern;
    if (!NODE_KINDS.has(kind)) throw new Error('Invalid reviewed node kind');
    if (typeof minorityConcern !== 'boolean') throw new Error('Invalid minority concern marker');
    if (minorityConcern && kind !== 'Concern') {
      throw new Error('Minority concern marker requires Concern node kind');
    }
    text(label, 'reviewed node label');
    text(draftText, 'reviewed node text');
    let nodes = workspace.nodes.map((node) => node.id === target.id ? {
      ...node,
      kind,
      label,
      text: draftText,
      minorityConcern,
      mergeTargetId: null,
      reviewStatus: 'proposed' as const,
      reviewer: null,
      reviewedAt: null,
      followUpQuestion: null,
    } : node);
    const invalidated = invalidateMergedNodesForTarget(nodes, target.id);
    nodes = invalidated.nodes;
    const relations = [target.id, ...invalidated.invalidatedIds].reduce(
      (items, id) => invalidateReviewedRelationsForNode(items, id), workspace.relations,
    );
    return { ...workspace, nodes, relations, summary: summarize(nodes, relations) };
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
    followUpQuestion: null,
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
  const replayNodes = [
    ...workspace.nodes.filter((node) => node.reviewStatus !== 'merged'),
    ...workspace.nodes.filter((node) => node.reviewStatus === 'merged'),
  ];
  for (const node of replayNodes) {
    if (!WORKSPACE_REVIEW_STATUSES.has(node.reviewStatus)) {
      throw new Error('Invalid transcript ontology review status');
    }
    if (!isDecidedReviewStatus(node.reviewStatus) || !node.reviewer || !node.reviewedAt) {
      throw new Error('Transcript ontology review is incomplete');
    }
    if (node.reviewStatus === 'merged') {
      rebuilt = updateTranscriptOntologyCandidateDraft(rebuilt, {
        itemType: 'node', id: node.id, kind: node.kind ?? undefined,
      });
      rebuilt = reviewTranscriptOntologyCandidate(rebuilt, {
        itemType: 'node', id: node.id, status: 'merged',
        mergeTargetId: node.mergeTargetId ?? '', reviewer: node.reviewer, reviewedAt: node.reviewedAt,
      });
    } else {
      rebuilt = reviewTranscriptOntologyCandidate(rebuilt, {
        itemType: 'node', id: node.id, status: node.reviewStatus,
        kind: node.kind ?? undefined, label: node.label, text: node.text,
        minorityConcern: node.minorityConcern,
        reviewer: node.reviewer, reviewedAt: node.reviewedAt,
      });
    }
  }
  for (const relation of workspace.relations) {
    if (!WORKSPACE_REVIEW_STATUSES.has(relation.reviewStatus)) {
      throw new Error('Invalid transcript ontology review status');
    }
    if (!isDecidedReviewStatus(relation.reviewStatus) || !relation.reviewer || !relation.reviewedAt) {
      throw new Error('Transcript ontology review is incomplete');
    }
    if (relation.reviewStatus === 'merged') throw new Error('Relations cannot be merged into nodes');
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
    ...(workspace.source.handoff ? { handoff: workspace.source.handoff } : {}),
  };
  const nodes = workspace.nodes.map(({ followUpQuestion: _followUpQuestion, ...node }) => node);
  const relations = workspace.relations.map(({ followUpQuestion: _followUpQuestion, ...relation }) => relation);
  return `${JSON.stringify({
    schemaVersion: 1,
    kind: 'transcript-ontology-reviewed-plan',
    dryRun: true,
    databaseMutationExecuted: false,
    publicGraphWritten: false,
    requiresPublicationReview: true,
    source,
    nodes,
    relations,
  }, null, 2)}\n`;
}

/** Builds a local approval artifact without publishing or persisting the reviewed plan. */
export async function buildTranscriptOntologyPublicationApproval(input: {
  reviewedPlanText: string;
  sourceId: string;
  approvedBy: string;
  approvedAt: string;
}): Promise<string> {
  const reviewedPlan = parseJson(input.reviewedPlanText);
  if (!isRecord(reviewedPlan)
    || reviewedPlan.schemaVersion !== 1
    || reviewedPlan.kind !== 'transcript-ontology-reviewed-plan'
    || reviewedPlan.dryRun !== true
    || reviewedPlan.databaseMutationExecuted !== false
    || reviewedPlan.publicGraphWritten !== false
    || reviewedPlan.requiresPublicationReview !== true
    || !Array.isArray(reviewedPlan.nodes)
    || !Array.isArray(reviewedPlan.relations)) {
    throw new Error('Invalid transcript ontology reviewed plan');
  }
  const sourceId = text(input.sourceId, 'publication source id');
  if (!TRANSCRIPT_PUBLICATION_SOURCE_PATTERN.test(sourceId)) {
    throw new Error('Invalid publication source id');
  }
  const approvedBy = text(input.approvedBy, 'publication approver id');
  if (!isAuthenticatedReviewerId(approvedBy)) throw new Error('Invalid publication approver id');
  const approvedAt = canonicalInstant(input.approvedAt, 'publication approvedAt');
  if (!isRecord(reviewedPlan.source)) throw new Error('Invalid reviewed plan source');
  let latestReviewedAt = canonicalInstant(reviewedPlan.source.reviewedAt, 'reviewed plan source reviewedAt');
  for (const item of [...reviewedPlan.nodes, ...reviewedPlan.relations]) {
    if (!isRecord(item)
      || !DECISION_STATUSES.has(String(item.reviewStatus))
      || typeof item.reviewer !== 'string'
      || !isAuthenticatedReviewerId(item.reviewer)) {
      throw new Error('Invalid reviewed plan decision audit');
    }
    const reviewedAt = canonicalInstant(item.reviewedAt, 'reviewed plan decision reviewedAt');
    if (reviewedAt > latestReviewedAt) latestReviewedAt = reviewedAt;
  }
  if (approvedAt <= latestReviewedAt) {
    throw new Error('Publication approval must follow every review decision');
  }
  return `${JSON.stringify({
    schemaVersion: 1,
    kind: 'transcript-ontology-publication-approval',
    mode: 'synthetic-reviewed-demo',
    sourceId,
    reviewedPlanSha256: await canonicalSha256(reviewedPlan),
    approvedBy,
    approvedAt,
  }, null, 2)}\n`;
}
