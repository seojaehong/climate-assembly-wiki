import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  completePrivateAudioFileImport,
  completePrivateSttCandidateImport,
  createPrivateMediaRecorder,
  PrivateTranscriptCapturePanel,
  stopPrivateMediaStream,
} from './PrivateTranscriptCapturePanel';
import { createPrivateTranscriptCaptureSession } from './private-transcript-capture';

describe('PrivateTranscriptCapturePanel', () => {
  it('starts as a consent-gated, session-memory-only MediaRecorder surface', () => {
    const reviewerId = 'auth-user:00000000-0000-4000-8000-000000000091';
    const html = renderToStaticMarkup(createElement(PrivateTranscriptCapturePanel, {
      reviewerId,
    }));

    expect(html).toContain('R4 로컬 음성·전사 검수');
    expect(html).toContain('브라우저 세션 메모리에만');
    expect(html).toContain(`인증 검수자 ID <code>${reviewerId}</code>`);
    expect(html).not.toContain('검수자 역할 ID');
    expect(html).toContain('DB·서버·public 경로로 전송하지 않습니다.');
    expect(html).toContain('새 녹음·파일을 가져오거나 페이지를 닫으면 기존 음성은 폐기됩니다.');
    expect(html).toContain('승인된 consent·retention 정책 전에는 실제 시민 발언을 사용하지 마세요.');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('마이크 또는 로컬 녹음 파일의 세션 메모리 처리에 동의합니다.');
    expect(html).toContain('테이블 녹음 파일 로컬 가져오기');
    expect(html).toContain('파일명·경로·음성 bytes는 검수 batch에 넣지 않습니다.');
    expect(html).toContain('로컬 녹음 파일');
    expect(html).toContain('파일 녹음 시작 시각 (이 장치의 현지 시각)');
    expect(html).toContain('녹음 파일 로컬 가져오기');
    expect(html).toContain('녹음 시작');
    expect(html).toContain('disabled=""');
    expect(html).toContain('전사 chunk 검수 완료 전에는 extraction handoff를 만들 수 없습니다.');
    expect(html).toContain('provider-neutral 후보 JSON');
    expect(html).toContain('aria-live="polite"');
  });

  it('imports a local audio file with exact hash and duration while releasing its busy state', async () => {
    const imported: ReturnType<typeof createPrivateTranscriptCaptureSession>[] = [];
    const errors: string[] = [];
    const busy: boolean[] = [];
    await completePrivateAudioFileImport({
      blob: new Blob(['synthetic-audio'], { type: 'audio/wav' }),
      captureId: 'capture-file-browser',
      sessionId: 'session-file-browser',
      startedAt: '2026-08-29T01:00:00.000Z',
      readImportedAt: () => '2026-08-29T01:00:02.000Z',
      readDurationMs: async () => 1_250,
      readSha256: async () => 'd'.repeat(64),
      isCurrent: () => true,
      onImported: (capture) => imported.push(capture),
      onError: (message) => errors.push(message),
      onBusyChange: (value) => busy.push(value),
    });

    expect(imported).toHaveLength(1);
    expect(imported[0].source).toMatchObject({
      captureId: 'capture-file-browser',
      sessionId: 'session-file-browser',
      audioSha256: 'd'.repeat(64),
      mimeType: 'audio/wav',
      byteLength: 15,
      startedAt: '2026-08-29T01:00:00.000Z',
      stoppedAt: '2026-08-29T01:00:01.250Z',
      durationMs: 1_250,
      storage: 'browser-memory',
    });
    expect(errors).toEqual([]);
    expect(busy).toEqual([false]);
  });

  it('discards a local audio result when the selected file becomes stale before hashing', async () => {
    const imported: string[] = [];
    const errors: string[] = [];
    const busy: boolean[] = [];
    let current = true;
    let hashRead = false;
    await completePrivateAudioFileImport({
      blob: new Blob(['synthetic-audio'], { type: 'audio/wav' }),
      captureId: 'capture-file-stale',
      sessionId: 'session-file-stale',
      startedAt: '2026-08-29T01:00:00.000Z',
      readImportedAt: () => '2026-08-29T01:00:02.000Z',
      readDurationMs: async () => {
        current = false;
        return 1_000;
      },
      readSha256: async () => {
        hashRead = true;
        return 'e'.repeat(64);
      },
      isCurrent: () => current,
      onImported: (capture) => imported.push(capture.source.captureId),
      onError: (message) => errors.push(message),
      onBusyChange: (value) => busy.push(value),
    });

    expect(hashRead).toBe(false);
    expect(imported).toEqual([]);
    expect(errors).toEqual([]);
    expect(busy).toEqual([]);
  });

  it('rejects non-audio local files without reading their contents', async () => {
    const errors: string[] = [];
    const busy: boolean[] = [];
    let metadataRead = false;
    await completePrivateAudioFileImport({
      blob: new Blob(['private text'], { type: 'text/plain' }),
      captureId: 'capture-file-invalid',
      sessionId: 'session-file-invalid',
      startedAt: '2026-08-29T01:00:00.000Z',
      readImportedAt: () => '2026-08-29T01:00:02.000Z',
      readDurationMs: async () => {
        metadataRead = true;
        return 1_000;
      },
      readSha256: async () => 'f'.repeat(64),
      isCurrent: () => true,
      onImported: () => undefined,
      onError: (message) => errors.push(message),
      onBusyChange: (value) => busy.push(value),
    });

    expect(metadataRead).toBe(false);
    expect(errors).toEqual(['브라우저가 음성 형식으로 확인한 로컬 파일만 가져올 수 있습니다.']);
    expect(busy).toEqual([false]);
  });

  it('discards an STT file result when its capture becomes stale during the local read', async () => {
    const imported: string[] = [];
    const errors: string[] = [];
    const busy: boolean[] = [];
    let current = true;
    const capture = createPrivateTranscriptCaptureSession({
      captureId: 'capture-stale',
      sessionId: 'session-stale',
      audioSha256: 'a'.repeat(64),
      mimeType: 'audio/webm',
      byteLength: 16,
      startedAt: '2026-08-29T01:00:00.000Z',
      stoppedAt: '2026-08-29T01:00:01.000Z',
    });

    await completePrivateSttCandidateImport({
      capture,
      readText: async () => {
        current = false;
        return '{}';
      },
      isCurrent: () => current,
      onImported: (next) => imported.push(next.source.captureId),
      onError: (message) => errors.push(message),
      onBusyChange: (value) => busy.push(value),
    });

    expect(imported).toEqual([]);
    expect(errors).toEqual([]);
    expect(busy).toEqual([]);
  });

  it('stops every microphone track when recorder construction fails', () => {
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [
        { stop: () => stopped.push('audio-1') },
        { stop: () => stopped.push('audio-2') },
      ],
    } as unknown as MediaStream;

    expect(() => createPrivateMediaRecorder(stream, () => {
      throw new Error('synthetic recorder construction failure');
    })).toThrow('synthetic recorder construction failure');
    expect(stopped).toEqual(['audio-1', 'audio-2']);
  });

  it('does not stop a stream after successful recorder construction', () => {
    let stopCount = 0;
    const stream = {
      getTracks: () => [{ stop: () => { stopCount += 1; } }],
    } as unknown as MediaStream;
    const recorder = { state: 'inactive' } as unknown as MediaRecorder;

    expect(createPrivateMediaRecorder(stream, () => recorder)).toBe(recorder);
    expect(stopCount).toBe(0);

    stopPrivateMediaStream(stream);
    expect(stopCount).toBe(1);
  });
});
