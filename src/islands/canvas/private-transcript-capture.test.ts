import { describe, expect, it } from 'vitest';
import {
  appendPrivateTranscriptChunk,
  createPrivateTranscriptCaptureSession,
  exportPrivateTranscriptReviewBatch,
  reviewPrivateTranscriptChunk,
  updatePrivateTranscriptChunkDraft,
  type PrivateTranscriptCaptureSession,
} from './private-transcript-capture';

const capture = () => createPrivateTranscriptCaptureSession({
  captureId: 'capture-20260829-a',
  sessionId: 'session-20260829',
  audioSha256: 'a'.repeat(64),
  mimeType: 'audio/webm;codecs=opus',
  byteLength: 2048,
  startedAt: '2026-08-29T01:00:00.000Z',
  stoppedAt: '2026-08-29T01:00:12.000Z',
});

describe('private transcript capture', () => {
  it('blocks extraction handoff until every local transcript chunk is reviewed', () => {
    const session = appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 12_000,
      speakerLabelPseudonym: 'speaker-a',
      text: '재생에너지 전환 속도를 높여야 합니다.',
    });

    expect(session.summary).toEqual({ chunks: 1, decided: 0 });
    expect(() => exportPrivateTranscriptReviewBatch(session)).toThrow(
      'Every transcript chunk must be reviewed before extraction handoff',
    );

    const reviewed = reviewPrivateTranscriptChunk(session, {
      uid: 'capture-20260829-a:chunk:1',
      status: 'accepted',
      text: '재생에너지 전환 속도를 높여야 합니다.',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-29T01:05:00.000Z',
    });
    const batch = exportPrivateTranscriptReviewBatch(reviewed);

    expect(batch.chunks).toEqual([expect.objectContaining({
      uid: 'capture-20260829-a:chunk:1',
      reviewStatus: 'accepted',
      text: '재생에너지 전환 속도를 높여야 합니다.',
    })]);
    expect(batch.safety).toEqual({
      localOnly: true,
      audioIncluded: false,
      databaseMutationExecuted: false,
      publicGraphWritten: false,
      extractionExecuted: false,
      requiresExtractionReview: true,
    });
  });

  it('exports edited chunks, drops rejected chunks, and binds the in-memory audio hash without audio bytes', () => {
    let session = appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 5_000,
      speakerLabelPseudonym: 'speaker-a',
      text: '전환 속도를 높여야 합니디.',
    });
    session = appendPrivateTranscriptChunk(session, {
      startMs: 5_000,
      endMs: 12_000,
      speakerLabelPseudonym: 'speaker-b',
      text: '검증하지 않을 구간입니다.',
    });
    session = reviewPrivateTranscriptChunk(session, {
      uid: 'capture-20260829-a:chunk:1',
      status: 'edited',
      text: '전환 속도를 높여야 합니다.',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-29T01:05:00.000Z',
    });
    session = reviewPrivateTranscriptChunk(session, {
      uid: 'capture-20260829-a:chunk:2',
      status: 'rejected',
      text: '검증하지 않을 구간입니다.',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-29T01:06:00.000Z',
    });

    const batch = exportPrivateTranscriptReviewBatch(session);

    expect(batch.source).toMatchObject({
      audioSha256: 'a'.repeat(64),
      byteLength: 2048,
      storage: 'browser-memory',
    });
    expect(batch.chunks).toHaveLength(1);
    expect(batch.chunks[0]).toMatchObject({
      reviewStatus: 'edited',
      sourceText: '전환 속도를 높여야 합니디.',
      text: '전환 속도를 높여야 합니다.',
    });
    expect(batch.summary).toEqual({ included: 1, rejected: 1, total: 2 });
    expect(JSON.stringify(batch)).not.toContain('audioBytes');
  });

  it('reopens a reviewed chunk when its visible transcript draft changes', () => {
    let session = appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 12_000,
      speakerLabelPseudonym: 'speaker-a',
      text: '최초 전사입니다.',
    });
    session = reviewPrivateTranscriptChunk(session, {
      uid: 'capture-20260829-a:chunk:1',
      status: 'accepted',
      text: '최초 전사입니다.',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-29T01:05:00.000Z',
    });

    const reopened = updatePrivateTranscriptChunkDraft(
      session,
      'capture-20260829-a:chunk:1',
      '화면에서 다시 수정한 전사입니다.',
    );

    expect(reopened.chunks[0]).toMatchObject({
      text: '화면에서 다시 수정한 전사입니다.',
      reviewStatus: 'proposed',
      reviewer: null,
      reviewedAt: null,
    });
    expect(reopened.summary.decided).toBe(0);
    expect(() => exportPrivateTranscriptReviewBatch(reopened)).toThrow(
      'Every transcript chunk must be reviewed before extraction handoff',
    );
  });

  it('recomputes the review summary and rejects a proposed chunk disguised as decided', () => {
    const proposed = appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 12_000,
      speakerLabelPseudonym: 'speaker-a',
      text: '아직 검수하지 않은 전사입니다.',
    });
    const forged = {
      ...proposed,
      summary: { chunks: 1, decided: 1 },
    };

    expect(() => exportPrivateTranscriptReviewBatch(forged)).toThrow(
      'Private transcript summary does not match chunks',
    );
  });

  it('rejects free-form reviewer aliases in decisions and tampered exports', () => {
    const proposed = appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 12_000,
      speakerLabelPseudonym: 'speaker-a',
      text: '검수할 전사입니다.',
    });
    expect(() => reviewPrivateTranscriptChunk(proposed, {
      uid: 'capture-20260829-a:chunk:1',
      status: 'accepted',
      text: '검수할 전사입니다.',
      reviewer: 'moderator-r4-test',
      reviewedAt: '2026-08-29T01:05:00.000Z',
    })).toThrow('Invalid authenticated transcript reviewer');

    const reviewed = reviewPrivateTranscriptChunk(proposed, {
      uid: 'capture-20260829-a:chunk:1',
      status: 'accepted',
      text: '검수할 전사입니다.',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-29T01:05:00.000Z',
    });
    const tampered = structuredClone(reviewed);
    tampered.chunks[0].reviewer = 'moderator-r4-test';
    expect(() => exportPrivateTranscriptReviewBatch(tampered)).toThrow(
      'Invalid reviewed transcript metadata',
    );
  });

  it('rejects changed accepted text and invalid review audit metadata at export time', () => {
    const proposed = appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 12_000,
      speakerLabelPseudonym: 'speaker-a',
      text: '검수할 전사입니다.',
    });
    const reviewed = reviewPrivateTranscriptChunk(proposed, {
      uid: 'capture-20260829-a:chunk:1',
      status: 'accepted',
      text: '검수할 전사입니다.',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-29T01:05:00.000Z',
    });
    const changedText = structuredClone(reviewed);
    changedText.chunks[0].text = '판단 이후 바뀐 전사입니다.';
    expect(() => exportPrivateTranscriptReviewBatch(changedText)).toThrow(
      'Accepted or rejected transcript chunk must preserve source text',
    );

    const earlyAudit = structuredClone(reviewed);
    earlyAudit.chunks[0].reviewedAt = '2026-08-29T00:59:59.000Z';
    expect(() => exportPrivateTranscriptReviewBatch(earlyAudit)).toThrow(
      'Invalid reviewed transcript metadata',
    );
  });

  it('rejects source metadata that no longer describes the browser-memory capture', () => {
    const reviewed = reviewPrivateTranscriptChunk(appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 12_000,
      speakerLabelPseudonym: 'speaker-a',
      text: '검수 완료 전사입니다.',
    }), {
      uid: 'capture-20260829-a:chunk:1',
      status: 'accepted',
      text: '검수 완료 전사입니다.',
      reviewer: 'auth-user:00000000-0000-4000-8000-000000000091',
      reviewedAt: '2026-08-29T01:05:00.000Z',
    });
    const wrongStorage = {
      ...reviewed,
      source: { ...reviewed.source, storage: 'server' },
    } as unknown as PrivateTranscriptCaptureSession;

    expect(() => exportPrivateTranscriptReviewBatch(wrongStorage)).toThrow(
      'Invalid private transcript capture source',
    );
  });
});
