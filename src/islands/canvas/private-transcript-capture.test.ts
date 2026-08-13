import { describe, expect, it } from 'vitest';
import {
  appendPrivateTranscriptChunk,
  createPrivateTranscriptCaptureSession,
  createPrivateTranscriptFileCaptureSession,
  exportPrivateTranscriptReviewBatch,
  importPrivateSttCandidates,
  reviewPrivateTranscriptChunk,
  updatePrivateTranscriptChunkDraft,
  type PrivateTranscriptCaptureSession,
} from './private-transcript-capture';

const sourceContext = {
  roomId: 'table-a',
  language: 'ko-KR',
};

const capture = () => createPrivateTranscriptCaptureSession({
  captureId: 'capture-20260829-a',
  sessionId: 'session-20260829',
  ...sourceContext,
  captureMethod: 'browser-media-recorder',
  audioSha256: 'a'.repeat(64),
  mimeType: 'audio/webm;codecs=opus',
  byteLength: 2048,
  startedAt: '2026-08-29T01:00:00.000Z',
  stoppedAt: '2026-08-29T01:00:12.000Z',
});

const sttCandidates = () => ({
  schemaVersion: 2,
  kind: 'private-stt-candidates',
  candidateSetId: 'stt-candidates-browser-1',
  source: {
    captureId: 'capture-20260829-a',
    sessionId: 'session-20260829',
    ...sourceContext,
    captureMethod: 'browser-media-recorder',
    audioSha256: 'a'.repeat(64),
    durationMs: 12_000,
  },
  chunks: [
    { sourceUid: 'stt-1', startMs: 0, endMs: 5_000, speakerLabelPseudonym: 'speaker-unknown', text: '첫 번째 STT 후보입니다.' },
    { sourceUid: 'stt-2', startMs: 5_000, endMs: 12_000, speakerLabelPseudonym: 'speaker-b', text: '두 번째 STT 후보입니다.' },
  ],
  safety: { localOnly: true, audioIncluded: false, databaseMutationExecuted: false },
});

describe('private transcript capture', () => {
  it('creates an exact browser-memory capture from a local recorder file without retaining its name or bytes', () => {
    const session = createPrivateTranscriptFileCaptureSession({
      captureId: 'capture-file-20260829-a',
      sessionId: 'session-20260829',
      ...sourceContext,
      audioSha256: 'c'.repeat(64),
      mimeType: 'audio/wav',
      byteLength: 16_044,
      startedAt: '2026-08-29T01:10:00.000Z',
      durationMs: 1_000,
      importedAt: '2026-08-29T01:10:02.000Z',
    });

    expect(session.source).toEqual({
      captureId: 'capture-file-20260829-a',
      sessionId: 'session-20260829',
      ...sourceContext,
      captureMethod: 'table-recorder-file',
      audioSha256: 'c'.repeat(64),
      mimeType: 'audio/wav',
      byteLength: 16_044,
      startedAt: '2026-08-29T01:10:00.000Z',
      stoppedAt: '2026-08-29T01:10:01.000Z',
      durationMs: 1_000,
      storage: 'browser-memory',
    });
    expect(JSON.stringify(session)).not.toContain('filename');
    expect(JSON.stringify(session)).not.toContain('audioBytes');
  });

  it('rejects invalid local recorder duration before creating a capture', () => {
    expect(() => createPrivateTranscriptFileCaptureSession({
      captureId: 'capture-file-20260829-a',
      sessionId: 'session-20260829',
      ...sourceContext,
      audioSha256: 'c'.repeat(64),
      mimeType: 'audio/wav',
      byteLength: 16_044,
      startedAt: '2026-08-29T01:10:00.000Z',
      durationMs: 0,
      importedAt: '2026-08-29T01:10:02.000Z',
    })).toThrow('Invalid audio duration');
  });

  it('rejects missing source context and unapproved capture methods', () => {
    const base = {
      captureId: 'capture-context-invalid',
      sessionId: 'session-20260829',
      roomId: 'table-a',
      language: 'ko-KR',
      captureMethod: 'browser-media-recorder' as const,
      audioSha256: 'c'.repeat(64),
      mimeType: 'audio/wav',
      byteLength: 16_044,
      startedAt: '2026-08-29T01:10:00.000Z',
      stoppedAt: '2026-08-29T01:10:01.000Z',
    };
    expect(() => createPrivateTranscriptCaptureSession({ ...base, roomId: '' })).toThrow('Invalid room id');
    expect(() => createPrivateTranscriptCaptureSession({ ...base, language: 'korean' })).toThrow('Invalid capture language');
    expect(() => createPrivateTranscriptCaptureSession({
      ...base,
      captureMethod: 'external-webhook' as unknown as 'browser-media-recorder',
    })).toThrow('Invalid capture method');
  });

  it('rejects a local recorder timeline that ends after the file import', () => {
    expect(() => createPrivateTranscriptFileCaptureSession({
      captureId: 'capture-file-20260829-a',
      sessionId: 'session-20260829',
      ...sourceContext,
      audioSha256: 'c'.repeat(64),
      mimeType: 'audio/wav',
      byteLength: 16_044,
      startedAt: '2026-08-29T01:10:00.000Z',
      durationMs: 2_000,
      importedAt: '2026-08-29T01:10:01.999Z',
    })).toThrow('Local audio capture cannot end in the future');
  });

  it('replaces local drafts with audio-bound provider-neutral STT candidates that still require review', () => {
    const imported = importPrivateSttCandidates(capture(), sttCandidates());

    expect(imported.summary).toEqual({ chunks: 2, decided: 0 });
    expect(imported.chunks).toEqual([
      expect.objectContaining({
        uid: 'capture-20260829-a:chunk:1',
        candidateSetId: 'stt-candidates-browser-1',
        candidateSourceUid: 'stt-1',
        sourceText: '첫 번째 STT 후보입니다.',
        reviewStatus: 'proposed',
        reviewer: null,
      }),
      expect.objectContaining({
        uid: 'capture-20260829-a:chunk:2',
        candidateSourceUid: 'stt-2',
      }),
    ]);
    expect(() => exportPrivateTranscriptReviewBatch(imported)).toThrow(
      'Every transcript chunk must be reviewed before extraction handoff',
    );
  });

  it('rejects STT candidates bound to another capture and raw audio or unknown metadata fields', () => {
    const wrongCapture = sttCandidates();
    wrongCapture.source.captureId = 'capture-other';
    expect(() => importPrivateSttCandidates(capture(), wrongCapture)).toThrow(
      'STT candidates do not match the current private capture',
    );

    const rawAudio = { ...sttCandidates(), audioBytes: 'not-allowed' };
    expect(() => importPrivateSttCandidates(capture(), rawAudio)).toThrow('Invalid STT candidate file fields');

    const wrongRoom = sttCandidates();
    wrongRoom.source.roomId = 'table-b';
    expect(() => importPrivateSttCandidates(capture(), wrongRoom)).toThrow(
      'STT candidates do not match the current private capture',
    );

    const wrongLanguage = sttCandidates();
    wrongLanguage.source.language = 'en-US';
    expect(() => importPrivateSttCandidates(capture(), wrongLanguage)).toThrow(
      'STT candidates do not match the current private capture',
    );
  });

  it('rejects duplicate source IDs and invalid candidate ranges before replacing local drafts', () => {
    const duplicate = sttCandidates();
    duplicate.chunks[1].sourceUid = 'stt-1';
    expect(() => importPrivateSttCandidates(capture(), duplicate)).toThrow('Duplicate STT candidate source uid');

    const outsideAudio = sttCandidates();
    outsideAudio.chunks[1].endMs = 12_001;
    expect(() => importPrivateSttCandidates(capture(), outsideAudio)).toThrow('Invalid STT candidate time range');
  });

  it('blocks extraction handoff until every local transcript chunk is reviewed', () => {
    const session = appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 12_000,
      speakerLabelPseudonym: 'speaker-unknown',
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
      speakerLabelPseudonym: 'speaker-unknown',
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

  it('accepts only short pseudonyms or the explicit unknown speaker marker', () => {
    expect(appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 1_000,
      speakerLabelPseudonym: 'speaker-unknown',
      text: '화자를 구분할 수 없는 전사입니다.',
    }).chunks[0].speakerLabelPseudonym).toBe('speaker-unknown');

    expect(() => appendPrivateTranscriptChunk(capture(), {
      startMs: 0,
      endMs: 1_000,
      speakerLabelPseudonym: 'unknown',
      text: '허용되지 않은 화자 표기입니다.',
    })).toThrow('Invalid speaker pseudonym');
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
      roomId: 'table-a',
      language: 'ko-KR',
      captureMethod: 'browser-media-recorder',
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
