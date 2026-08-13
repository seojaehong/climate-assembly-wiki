import { isAuthenticatedReviewerId } from './useAuth';

export type PrivateTranscriptReviewStatus = 'proposed' | 'accepted' | 'edited' | 'rejected';

export interface PrivateTranscriptChunk {
  uid: string;
  startMs: number;
  endMs: number;
  speakerLabelPseudonym: string;
  sourceText: string;
  text: string;
  reviewStatus: PrivateTranscriptReviewStatus;
  reviewer: string | null;
  reviewedAt: string | null;
}

export interface PrivateTranscriptCaptureSession {
  source: {
    captureId: string;
    sessionId: string;
    audioSha256: string;
    mimeType: string;
    byteLength: number;
    startedAt: string;
    stoppedAt: string;
    durationMs: number;
    storage: 'browser-memory';
  };
  chunks: PrivateTranscriptChunk[];
  summary: { chunks: number; decided: number };
}

export interface PrivateTranscriptReviewBatch {
  schemaVersion: 1;
  kind: 'private-transcript-review-batch';
  source: PrivateTranscriptCaptureSession['source'];
  chunks: Array<Omit<PrivateTranscriptChunk, 'sourceText'> & { sourceText: string }>;
  summary: { included: number; rejected: number; total: number };
  safety: {
    localOnly: true;
    audioIncluded: false;
    databaseMutationExecuted: false;
    publicGraphWritten: false;
    extractionExecuted: false;
    requiresExtractionReview: true;
  };
}

interface CaptureInput {
  captureId: string;
  sessionId: string;
  audioSha256: string;
  mimeType: string;
  byteLength: number;
  startedAt: string;
  stoppedAt: string;
}

interface AppendChunkInput {
  startMs: number;
  endMs: number;
  speakerLabelPseudonym: string;
  text: string;
}

interface ReviewChunkInput {
  uid: string;
  status: 'accepted' | 'edited' | 'rejected';
  text: string;
  reviewer: string;
  reviewedAt: string;
}

const OPAQUE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SPEAKER = /^speaker-[a-z]{1,3}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function nonempty(value: string, label: string): string {
  const result = value.trim();
  if (result.length === 0) throw new Error(`Invalid ${label}`);
  return result;
}

function opaqueId(value: string, label: string): string {
  const result = nonempty(value, label);
  if (!OPAQUE_ID.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function canonicalInstant(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function summarize(chunks: PrivateTranscriptChunk[]): PrivateTranscriptCaptureSession['summary'] {
  return {
    chunks: chunks.length,
    decided: chunks.filter((chunk) => chunk.reviewStatus !== 'proposed').length,
  };
}

function validatePrivateTranscriptCaptureSession(session: PrivateTranscriptCaptureSession): void {
  const expectedSource = createPrivateTranscriptCaptureSession({
    captureId: session.source.captureId,
    sessionId: session.source.sessionId,
    audioSha256: session.source.audioSha256,
    mimeType: session.source.mimeType,
    byteLength: session.source.byteLength,
    startedAt: session.source.startedAt,
    stoppedAt: session.source.stoppedAt,
  }).source;
  if (session.source.durationMs !== expectedSource.durationMs || session.source.storage !== 'browser-memory') {
    throw new Error('Invalid private transcript capture source');
  }
  session.chunks.forEach((chunk, index) => {
    if (chunk.uid !== `${expectedSource.captureId}:chunk:${index + 1}`
      || !Number.isSafeInteger(chunk.startMs)
      || !Number.isSafeInteger(chunk.endMs)
      || chunk.startMs < 0
      || chunk.endMs <= chunk.startMs
      || chunk.endMs > expectedSource.durationMs
      || !SPEAKER.test(chunk.speakerLabelPseudonym)
      || chunk.sourceText.trim().length === 0
      || chunk.text.trim().length === 0) {
      throw new Error('Invalid private transcript chunk');
    }
    if (chunk.reviewStatus === 'proposed') {
      if (chunk.reviewer !== null || chunk.reviewedAt !== null) {
        throw new Error('Invalid proposed transcript review metadata');
      }
      return;
    }
    if (!['accepted', 'edited', 'rejected'].includes(chunk.reviewStatus)
      || chunk.reviewer === null
      || !isAuthenticatedReviewerId(chunk.reviewer)
      || chunk.reviewedAt === null
      || canonicalInstant(chunk.reviewedAt, 'transcript reviewedAt') < expectedSource.stoppedAt) {
      throw new Error('Invalid reviewed transcript metadata');
    }
    if ((chunk.reviewStatus === 'accepted' || chunk.reviewStatus === 'rejected')
      && chunk.text !== chunk.sourceText) {
      throw new Error('Accepted or rejected transcript chunk must preserve source text');
    }
    if (chunk.reviewStatus === 'edited' && chunk.text === chunk.sourceText) {
      throw new Error('Edited transcript chunk must change source text');
    }
  });
  const expectedSummary = summarize(session.chunks);
  if (session.summary.chunks !== expectedSummary.chunks || session.summary.decided !== expectedSummary.decided) {
    throw new Error('Private transcript summary does not match chunks');
  }
}

export function createPrivateTranscriptCaptureSession(input: CaptureInput): PrivateTranscriptCaptureSession {
  const captureId = opaqueId(input.captureId, 'capture id');
  const sessionId = opaqueId(input.sessionId, 'session id');
  if (!SHA256.test(input.audioSha256)) throw new Error('Invalid audio SHA-256');
  if (!input.mimeType.startsWith('audio/')) throw new Error('Invalid audio MIME type');
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength <= 0) throw new Error('Invalid audio byte length');
  const startedAt = canonicalInstant(input.startedAt, 'capture startedAt');
  const stoppedAt = canonicalInstant(input.stoppedAt, 'capture stoppedAt');
  const durationMs = new Date(stoppedAt).valueOf() - new Date(startedAt).valueOf();
  if (durationMs <= 0) throw new Error('Capture stop must follow start');
  return {
    source: {
      captureId,
      sessionId,
      audioSha256: input.audioSha256,
      mimeType: input.mimeType,
      byteLength: input.byteLength,
      startedAt,
      stoppedAt,
      durationMs,
      storage: 'browser-memory',
    },
    chunks: [],
    summary: { chunks: 0, decided: 0 },
  };
}

export function appendPrivateTranscriptChunk(
  session: PrivateTranscriptCaptureSession,
  input: AppendChunkInput,
): PrivateTranscriptCaptureSession {
  if (!Number.isSafeInteger(input.startMs) || !Number.isSafeInteger(input.endMs)
    || input.startMs < 0 || input.endMs <= input.startMs
    || input.endMs > session.source.durationMs) {
    throw new Error('Invalid transcript chunk time range');
  }
  const speakerLabelPseudonym = nonempty(input.speakerLabelPseudonym, 'speaker pseudonym');
  if (!SPEAKER.test(speakerLabelPseudonym)) throw new Error('Invalid speaker pseudonym');
  const sourceText = nonempty(input.text, 'transcript chunk text');
  const uid = `${session.source.captureId}:chunk:${session.chunks.length + 1}`;
  const chunks = [...session.chunks, {
    uid,
    startMs: input.startMs,
    endMs: input.endMs,
    speakerLabelPseudonym,
    sourceText,
    text: sourceText,
    reviewStatus: 'proposed' as const,
    reviewer: null,
    reviewedAt: null,
  }];
  return { ...session, chunks, summary: summarize(chunks) };
}

export function reviewPrivateTranscriptChunk(
  session: PrivateTranscriptCaptureSession,
  input: ReviewChunkInput,
): PrivateTranscriptCaptureSession {
  const index = session.chunks.findIndex((chunk) => chunk.uid === input.uid);
  if (index < 0) throw new Error('Unknown transcript chunk');
  const reviewer = nonempty(input.reviewer, 'transcript reviewer');
  if (!isAuthenticatedReviewerId(reviewer)) throw new Error('Invalid authenticated transcript reviewer');
  const reviewedAt = canonicalInstant(input.reviewedAt, 'transcript reviewedAt');
  if (reviewedAt < session.source.stoppedAt) throw new Error('Transcript review predates capture completion');
  const current = session.chunks[index];
  const text = nonempty(input.text, 'reviewed transcript text');
  if (input.status === 'accepted' && text !== current.sourceText) {
    throw new Error('Accepted transcript chunk must preserve source text');
  }
  if (input.status === 'edited' && text === current.sourceText) {
    throw new Error('Edited transcript chunk must change source text');
  }
  if (input.status === 'rejected' && text !== current.sourceText) {
    throw new Error('Rejected transcript chunk must preserve source text');
  }
  const chunks = session.chunks.map((chunk, chunkIndex) => chunkIndex === index ? {
    ...chunk,
    text,
    reviewStatus: input.status,
    reviewer,
    reviewedAt,
  } : chunk);
  return { ...session, chunks, summary: summarize(chunks) };
}

export function updatePrivateTranscriptChunkDraft(
  session: PrivateTranscriptCaptureSession,
  uid: string,
  value: string,
): PrivateTranscriptCaptureSession {
  const index = session.chunks.findIndex((chunk) => chunk.uid === uid);
  if (index < 0) throw new Error('Unknown transcript chunk');
  const text = value;
  const current = session.chunks[index];
  if (current.text === text) return session;
  const chunks = session.chunks.map((chunk, chunkIndex) => chunkIndex === index ? {
    ...chunk,
    text,
    reviewStatus: 'proposed' as const,
    reviewer: null,
    reviewedAt: null,
  } : chunk);
  return { ...session, chunks, summary: summarize(chunks) };
}

export function exportPrivateTranscriptReviewBatch(
  session: PrivateTranscriptCaptureSession,
): PrivateTranscriptReviewBatch {
  validatePrivateTranscriptCaptureSession(session);
  if (session.chunks.length === 0 || session.summary.decided !== session.summary.chunks) {
    throw new Error('Every transcript chunk must be reviewed before extraction handoff');
  }
  const chunks = session.chunks.filter((chunk) => chunk.reviewStatus !== 'rejected');
  if (chunks.length === 0) throw new Error('Extraction handoff requires a reviewed transcript chunk');
  return {
    schemaVersion: 1,
    kind: 'private-transcript-review-batch',
    source: session.source,
    chunks,
    summary: {
      included: chunks.length,
      rejected: session.chunks.length - chunks.length,
      total: session.chunks.length,
    },
    safety: {
      localOnly: true,
      audioIncluded: false,
      databaseMutationExecuted: false,
      publicGraphWritten: false,
      extractionExecuted: false,
      requiresExtractionReview: true,
    },
  };
}
