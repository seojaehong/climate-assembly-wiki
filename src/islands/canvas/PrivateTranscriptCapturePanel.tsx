import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  appendPrivateTranscriptChunk,
  createPrivateTranscriptFileCaptureSession,
  createPrivateTranscriptCaptureSession,
  exportPrivateTranscriptReviewBatch,
  importPrivateSttCandidates,
  reviewPrivateTranscriptChunk,
  updatePrivateTranscriptChunkDraft,
  type PrivateTranscriptCaptureSession,
} from './private-transcript-capture';
import { isAuthenticatedReviewerId } from './useAuth';

const BORDER = '#2F6F7E';
const INK = '#102A43';
const MUTED = '#526777';
const PANEL = '#F3F8FA';
const MAX_PRIVATE_AUDIO_BYTES = 256 * 1024 * 1024;

const controlStyle: CSSProperties = {
  background: '#FFFFFF',
  border: `2px solid ${BORDER}`,
  borderRadius: 8,
  color: INK,
  colorScheme: 'light',
  minHeight: 44,
  padding: '8px 10px',
};

const cardStyle: CSSProperties = {
  background: '#FFFFFF',
  border: `2px solid ${BORDER}`,
  borderRadius: 12,
  display: 'grid',
  gap: 12,
  padding: 16,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '로컬 음성·전사 검수를 처리하지 못했습니다.';
}

async function blobSha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface PrivateMediaStream {
  getTracks(): Array<{ stop(): void }>;
}

interface PrivateSttImportCallbacks {
  capture: PrivateTranscriptCaptureSession;
  readText: () => Promise<string>;
  isCurrent: () => boolean;
  onImported: (capture: PrivateTranscriptCaptureSession) => void;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}

interface PrivateAudioFileImportCallbacks {
  blob: Blob;
  captureId: string;
  sessionId: string;
  roomId: string;
  language: string;
  startedAt: string;
  readImportedAt: () => string;
  readDurationMs: () => Promise<number>;
  readSha256: () => Promise<string>;
  isCurrent: () => boolean;
  onImported: (capture: PrivateTranscriptCaptureSession) => void;
  onError: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}

/** Reads and validates a local STT candidate file without applying stale async results. */
export async function completePrivateSttCandidateImport(callbacks: PrivateSttImportCallbacks): Promise<void> {
  try {
    const text = await callbacks.readText();
    if (!callbacks.isCurrent()) return;
    const parsed: unknown = JSON.parse(text);
    const imported = importPrivateSttCandidates(callbacks.capture, parsed);
    if (callbacks.isCurrent()) callbacks.onImported(imported);
  } catch (error: unknown) {
    if (!callbacks.isCurrent()) return;
    console.error('Failed to import private STT candidates', error);
    callbacks.onError(errorMessage(error));
  } finally {
    if (callbacks.isCurrent()) callbacks.onBusyChange(false);
  }
}

/** Reads local audio metadata without retaining its file name or bytes in the capture contract. */
export async function completePrivateAudioFileImport(callbacks: PrivateAudioFileImportCallbacks): Promise<void> {
  try {
    if (callbacks.blob.size <= 0 || callbacks.blob.size > MAX_PRIVATE_AUDIO_BYTES) {
      throw new Error('로컬 녹음 파일은 비어 있지 않은 256MB 이하 파일이어야 합니다.');
    }
    if (!callbacks.blob.type.startsWith('audio/')) {
      throw new Error('브라우저가 음성 형식으로 확인한 로컬 파일만 가져올 수 있습니다.');
    }
    const durationMs = await callbacks.readDurationMs();
    if (!callbacks.isCurrent()) return;
    const audioSha256 = await callbacks.readSha256();
    if (!callbacks.isCurrent()) return;
    const capture = createPrivateTranscriptFileCaptureSession({
      captureId: callbacks.captureId,
      sessionId: callbacks.sessionId,
      roomId: callbacks.roomId,
      language: callbacks.language,
      audioSha256,
      mimeType: callbacks.blob.type,
      byteLength: callbacks.blob.size,
      startedAt: callbacks.startedAt,
      durationMs,
      importedAt: callbacks.readImportedAt(),
    });
    if (callbacks.isCurrent()) callbacks.onImported(capture);
  } catch (error: unknown) {
    if (!callbacks.isCurrent()) return;
    console.error('Failed to import a private local audio file', error);
    callbacks.onError(errorMessage(error));
  } finally {
    if (callbacks.isCurrent()) callbacks.onBusyChange(false);
  }
}

/** Resolves local audio duration from browser metadata with a bounded wait. */
export function readPrivateAudioDurationMs(blob: Blob, timeoutMs = 20_000): Promise<number> {
  return new Promise((resolveDuration, rejectDuration) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement('audio');
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      audio.removeAttribute('src');
      audio.load();
      URL.revokeObjectURL(url);
      callback();
    };
    const timeout = window.setTimeout(() => settle(() => {
      rejectDuration(new Error('로컬 녹음 파일의 재생 길이를 20초 안에 확인하지 못했습니다.'));
    }), timeoutMs);
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => {
      const durationMs = Math.round(audio.duration * 1_000);
      settle(() => {
        if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
          rejectDuration(new Error('로컬 녹음 파일의 재생 길이가 올바르지 않습니다.'));
          return;
        }
        resolveDuration(durationMs);
      });
    }, { once: true });
    audio.addEventListener('error', () => settle(() => {
      rejectDuration(new Error('로컬 녹음 파일의 음성 메타데이터를 읽지 못했습니다.'));
    }), { once: true });
    audio.src = url;
  });
}

/** Stops every acquired media track, including streams that fail before recorder setup completes. */
export function stopPrivateMediaStream(stream: PrivateMediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Creates a recorder without leaking the acquired microphone stream if construction fails. */
export function createPrivateMediaRecorder(
  stream: MediaStream,
  factory: (source: MediaStream) => MediaRecorder = (source) => new MediaRecorder(source),
): MediaRecorder {
  try {
    return factory(stream);
  } catch (error: unknown) {
    stopPrivateMediaStream(stream);
    throw error;
  }
}

function downloadReviewBatch(session: PrivateTranscriptCaptureSession): void {
  const batch = exportPrivateTranscriptReviewBatch(session);
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(batch, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${session.source.captureId}-reviewed-transcript.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PrivateTranscriptCapturePanel({ reviewerId }: { reviewerId: string }) {
  const [consented, setConsented] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [language, setLanguage] = useState('ko-KR');
  const [recording, setRecording] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [capture, setCapture] = useState<PrivateTranscriptCaptureSession | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [startMs, setStartMs] = useState('0');
  const [endMs, setEndMs] = useState('');
  const [speaker, setSpeaker] = useState('speaker-unknown');
  const [chunkText, setChunkText] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recordedStartedAt, setRecordedStartedAt] = useState('');
  const [importingAudio, setImportingAudio] = useState(false);
  const [sttCandidateFile, setSttCandidateFile] = useState<File | null>(null);
  const [importingStt, setImportingStt] = useState(false);
  const [notice, setNotice] = useState('동의 후 합성 음성으로 브라우저 녹음 proof of concept를 시작하세요.');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const partsRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<string | null>(null);
  const captureSessionIdRef = useRef<string | null>(null);
  const captureRoomIdRef = useRef<string | null>(null);
  const captureLanguageRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);
  const recordingLockRef = useRef(false);
  const captureRef = useRef<PrivateTranscriptCaptureSession | null>(null);
  const sttImportGenerationRef = useRef(0);
  const sttInputRef = useRef<HTMLInputElement | null>(null);
  const audioImportGenerationRef = useRef(0);
  const audioImportLockRef = useRef(false);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  captureRef.current = capture;

  const replaceAudioUrl = (next: string | null) => {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = next;
    setAudioUrl(next);
  };

  const stopCurrentStream = () => {
    stopPrivateMediaStream(streamRef.current);
    streamRef.current = null;
  };

  useEffect(() => () => {
    generationRef.current += 1;
    sttImportGenerationRef.current += 1;
    audioImportGenerationRef.current += 1;
    audioImportLockRef.current = false;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    stopCurrentStream();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  const finalizeRecording = async (
    recorder: MediaRecorder,
    stream: MediaStream,
    generation: number,
    stoppedAt: string,
  ) => {
    try {
      if (generationRef.current !== generation) return;
      const mimeType = recorder.mimeType || partsRef.current[0]?.type || 'audio/webm';
      const blob = new Blob(partsRef.current, { type: mimeType });
      const startedAt = startedAtRef.current;
      if (!startedAt) throw new Error('녹음 시작 시각을 확인하지 못했습니다.');
      const next = createPrivateTranscriptCaptureSession({
        captureId: `capture-${crypto.randomUUID()}`,
        sessionId: captureSessionIdRef.current ?? '',
        roomId: captureRoomIdRef.current ?? '',
        language: captureLanguageRef.current ?? '',
        captureMethod: 'browser-media-recorder',
        audioSha256: await blobSha256(blob),
        mimeType,
        byteLength: blob.size,
        startedAt,
        stoppedAt,
      });
      if (generationRef.current !== generation) return;
      setCapture(next);
      setSttCandidateFile(null);
      if (sttInputRef.current) sttInputRef.current.value = '';
      setStartMs('0');
      setEndMs(String(next.source.durationMs));
      replaceAudioUrl(URL.createObjectURL(blob));
      setError(null);
      setNotice('녹음은 이 브라우저 세션 메모리에만 있습니다. 전사 chunk를 작성하고 전부 검수하세요.');
    } catch (caught: unknown) {
      if (generationRef.current !== generation) return;
      console.error('Failed to finalize the private browser recording', caught);
      setError(errorMessage(caught));
    } finally {
      if (generationRef.current === generation) {
        setRecording(false);
        setFinalizing(false);
        recordingLockRef.current = false;
      }
      stopPrivateMediaStream(stream);
      if (streamRef.current === stream) streamRef.current = null;
      if (recorderRef.current === recorder) recorderRef.current = null;
    }
  };

  const startRecording = async () => {
    if (!consented || sessionId.trim().length === 0 || roomId.trim().length === 0 || language.trim().length === 0
      || recordingLockRef.current || audioImportLockRef.current) return;
    recordingLockRef.current = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let acquiredStream: MediaStream | null = null;
    let recorderCreated = false;
    setError(null);
    setFinalizing(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        throw new Error('이 브라우저는 MediaRecorder 음성 캡처를 지원하지 않습니다.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = stream;
      if (generationRef.current !== generation) {
        stopPrivateMediaStream(stream);
        return;
      }
      const recorder = createPrivateMediaRecorder(stream);
      recorderCreated = true;
      streamRef.current = stream;
      recorderRef.current = recorder;
      partsRef.current = [];
      startedAtRef.current = new Date().toISOString();
      captureSessionIdRef.current = sessionId.trim();
      captureRoomIdRef.current = roomId.trim();
      captureLanguageRef.current = language.trim();
      setCapture(null);
      audioImportGenerationRef.current += 1;
      audioImportLockRef.current = false;
      setImportingAudio(false);
      setAudioFile(null);
      setRecordedStartedAt('');
      if (audioInputRef.current) audioInputRef.current.value = '';
      sttImportGenerationRef.current += 1;
      setSttCandidateFile(null);
      if (sttInputRef.current) sttInputRef.current.value = '';
      replaceAudioUrl(null);
      recorder.addEventListener('dataavailable', (event) => {
        if (generationRef.current === generation && event.data.size > 0) partsRef.current.push(event.data);
      });
      recorder.addEventListener('error', (event) => {
        console.error('Private browser MediaRecorder failed', event.error);
        if (generationRef.current !== generation) return;
        generationRef.current += 1;
        stopPrivateMediaStream(stream);
        if (streamRef.current === stream) streamRef.current = null;
        if (recorderRef.current === recorder) recorderRef.current = null;
        recordingLockRef.current = false;
        setRecording(false);
        setFinalizing(false);
        setError('브라우저 녹음 중 오류가 발생했습니다.');
        setNotice('녹음을 중단하고 마이크를 해제했습니다. 다시 시도해 주세요.');
      });
      recorder.addEventListener('stop', () => {
        void finalizeRecording(recorder, stream, generation, new Date().toISOString());
      }, { once: true });
      recorder.start();
      setRecording(true);
      setFinalizing(false);
      setNotice('녹음 중입니다. 음성은 서버로 전송되지 않습니다.');
    } catch (caught: unknown) {
      if (generationRef.current !== generation) {
        if (recorderCreated) stopPrivateMediaStream(acquiredStream);
        console.info('Ignored stale private browser recording start failure');
        return;
      }
      console.error('Failed to start the private browser recording', caught);
      if (recorderCreated) stopPrivateMediaStream(acquiredStream);
      if (streamRef.current === acquiredStream) streamRef.current = null;
      recorderRef.current = null;
      recordingLockRef.current = false;
      setError(errorMessage(caught));
      setFinalizing(false);
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    setFinalizing(true);
    setNotice('녹음을 로컬 메모리에서 정리하고 있습니다.');
    recorder.stop();
  };

  const discardPrivateCapture = () => {
    const recorder = recorderRef.current;
    generationRef.current += 1;
    recordingLockRef.current = false;
    recorderRef.current = null;
    if (recorder?.state === 'recording') {
      try {
        recorder.stop();
      } catch (caught: unknown) {
        console.error('Failed to stop private browser recorder after consent withdrawal', caught);
      }
    }
    stopCurrentStream();
    partsRef.current = [];
    startedAtRef.current = null;
    captureSessionIdRef.current = null;
    captureRoomIdRef.current = null;
    captureLanguageRef.current = null;
    setRecording(false);
    setFinalizing(false);
    setCapture(null);
    audioImportGenerationRef.current += 1;
    audioImportLockRef.current = false;
    setImportingAudio(false);
    setAudioFile(null);
    setRecordedStartedAt('');
    if (audioInputRef.current) audioInputRef.current.value = '';
    sttImportGenerationRef.current += 1;
    setImportingStt(false);
    setSttCandidateFile(null);
    if (sttInputRef.current) sttInputRef.current.value = '';
    setChunkText('');
    setStartMs('0');
    setEndMs('');
    replaceAudioUrl(null);
    setError(null);
    setNotice('동의를 철회해 마이크와 로컬 음성·전사 초안을 폐기했습니다.');
  };

  const updateConsent = (next: boolean) => {
    setConsented(next);
    if (!next) discardPrivateCapture();
  };

  const importAudioFile = async () => {
    const file = audioFile;
    if (!consented || !file || sessionId.trim().length === 0 || roomId.trim().length === 0
      || language.trim().length === 0 || recordedStartedAt.length === 0
      || audioImportLockRef.current || recording || finalizing) return;
    let startedAt: string;
    try {
      startedAt = new Date(recordedStartedAt).toISOString();
    } catch (caught: unknown) {
      console.error('Failed to parse the private local audio start time', caught);
      setError('녹음 시작 시각을 확인해 주세요.');
      return;
    }
    audioImportLockRef.current = true;
    const generation = audioImportGenerationRef.current + 1;
    audioImportGenerationRef.current = generation;
    const captureId = `capture-${crypto.randomUUID()}`;
    const currentSessionId = sessionId.trim();
    const currentRoomId = roomId.trim();
    const currentLanguage = language.trim();
    setImportingAudio(true);
    setError(null);
    setNotice('로컬 녹음 파일의 길이와 SHA-256을 브라우저에서 확인하고 있습니다.');
    await completePrivateAudioFileImport({
      blob: file,
      captureId,
      sessionId: currentSessionId,
      roomId: currentRoomId,
      language: currentLanguage,
      startedAt,
      readImportedAt: () => new Date().toISOString(),
      readDurationMs: () => readPrivateAudioDurationMs(file),
      readSha256: () => blobSha256(file),
      isCurrent: () => audioImportGenerationRef.current === generation,
      onImported: (next) => {
        generationRef.current += 1;
        sttImportGenerationRef.current += 1;
        setCapture(next);
        setSttCandidateFile(null);
        if (sttInputRef.current) sttInputRef.current.value = '';
        setStartMs('0');
        setEndMs(String(next.source.durationMs));
        setChunkText('');
        replaceAudioUrl(URL.createObjectURL(file));
        setAudioFile(null);
        setRecordedStartedAt('');
        if (audioInputRef.current) audioInputRef.current.value = '';
        setError(null);
        setNotice('녹음 파일은 브라우저 세션 메모리에만 있습니다. 전사 chunk를 작성하고 전부 검수하세요.');
      },
      onError: setError,
      onBusyChange: (busy) => {
        audioImportLockRef.current = busy;
        setImportingAudio(busy);
      },
    });
  };

  const appendChunk = () => {
    if (!capture) return;
    try {
      const next = appendPrivateTranscriptChunk(capture, {
        startMs: Number(startMs),
        endMs: Number(endMs),
        speakerLabelPseudonym: speaker,
        text: chunkText,
      });
      const added = next.chunks.at(-1);
      if (!added) throw new Error('전사 chunk를 만들지 못했습니다.');
      setCapture(next);
      setChunkText('');
      setStartMs(endMs);
      setNotice(`전사 chunk ${next.summary.chunks}개 · 검수 완료 ${next.summary.decided}개`);
      setError(null);
    } catch (caught: unknown) {
      console.error('Failed to append a private transcript chunk', caught);
      setError(errorMessage(caught));
    }
  };

  const importSttCandidates = async () => {
    const currentCapture = captureRef.current;
    const file = sttCandidateFile;
    if (!currentCapture || !file || importingStt) return;
    if (file.size > 1_000_000) {
      const message = 'STT 후보 JSON은 1MB 이하여야 합니다.';
      console.error('Failed to import private STT candidates', new Error(message));
      setError(message);
      return;
    }
    const generation = sttImportGenerationRef.current + 1;
    sttImportGenerationRef.current = generation;
    setImportingStt(true);
    setError(null);
    await completePrivateSttCandidateImport({
      capture: currentCapture,
      readText: () => file.text(),
      isCurrent: () => sttImportGenerationRef.current === generation && captureRef.current === currentCapture,
      onImported: (next) => {
        setCapture(next);
        setNotice(`로컬 STT 후보 ${next.summary.chunks}개를 가져왔습니다. 모든 후보를 사람 검수하세요.`);
        setError(null);
      },
      onError: setError,
      onBusyChange: setImportingStt,
    });
  };

  const decideChunk = (uid: string, status: 'accepted' | 'edited' | 'rejected') => {
    if (!capture) return;
    const current = capture.chunks.find((chunk) => chunk.uid === uid);
    if (!current) return;
    try {
      const next = reviewPrivateTranscriptChunk(capture, {
        uid,
        status,
        text: status === 'rejected' ? current.sourceText : current.text,
        reviewer: reviewerId,
        reviewedAt: new Date().toISOString(),
      });
      setCapture(next);
      setError(null);
      setNotice(`전사 chunk 검수 진행 ${next.summary.decided}/${next.summary.chunks}`);
    } catch (caught: unknown) {
      console.error('Failed to review a private transcript chunk', caught);
      setError(errorMessage(caught));
    }
  };

  const updateChunkDraft = (uid: string, value: string) => {
    if (!capture) return;
    try {
      const next = updatePrivateTranscriptChunkDraft(capture, uid, value);
      setCapture(next);
      setError(null);
      if (next.summary.decided !== capture.summary.decided) {
        setNotice('전사 문구가 바뀌어 해당 chunk 판단을 다시 열었습니다. 재검수해 주세요.');
      }
    } catch (caught: unknown) {
      console.error('Failed to update a private transcript chunk draft', caught);
      setError(errorMessage(caught));
    }
  };

  const exportBatch = () => {
    if (!capture) return;
    try {
      downloadReviewBatch(capture);
      setError(null);
      setNotice('검수 완료 전사 batch를 내려받았습니다. extraction은 실행하지 않았습니다.');
    } catch (caught: unknown) {
      console.error('Failed to export the private transcript review batch', caught);
      setError(errorMessage(caught));
    }
  };

  const reviewerValid = isAuthenticatedReviewerId(reviewerId);
  const exportReady = capture !== null
    && capture.summary.chunks > 0
    && capture.summary.decided === capture.summary.chunks
    && capture.chunks.some((chunk) => chunk.reviewStatus !== 'rejected');

  return (
    <section aria-labelledby="private-transcript-capture-heading" style={{ marginBottom: 36 }}>
      <header style={{ marginBottom: 12 }}>
        <h2 id="private-transcript-capture-heading">R4 로컬 음성·전사 검수</h2>
        <p style={{ color: MUTED, lineHeight: 1.6 }}>
          MediaRecorder와 테이블 녹음 파일의 local-only proof of concept입니다. 음성은 브라우저 세션 메모리에만 두며 DB·서버·public 경로로 전송하지 않습니다.
          {' '}새 녹음·파일을 가져오거나 페이지를 닫으면 기존 음성은 폐기됩니다. 승인된 consent·retention 정책 전에는 실제 시민 발언을 사용하지 마세요.
        </p>
        <p style={{ color: MUTED, lineHeight: 1.6 }}>
          전사 chunk 검수 완료 전에는 extraction handoff를 만들 수 없습니다. 외부 STT 호출과 extraction은 실행하지 않으며,
          {' '}현재 녹음에 결속된 provider-neutral 후보 JSON만 로컬에서 가져올 수 있습니다.
        </p>
        <p style={{ color: MUTED, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
          인증 검수자 ID <code>{reviewerId}</code>
        </p>
      </header>
      <div style={{ ...cardStyle, background: PANEL, marginBottom: 16 }}>
        <label style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
          <input type="checkbox" checked={consented} onChange={(event) => updateConsent(event.currentTarget.checked)} />
          마이크 또는 로컬 녹음 파일의 세션 메모리 처리에 동의합니다.
        </label>
        <label>회차 ID
          <input value={sessionId} onChange={(event) => setSessionId(event.currentTarget.value)} disabled={recording || finalizing || importingAudio} autoComplete="off" placeholder="예: session-20260829" style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
        </label>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <label>테이블·분과 ID
            <input value={roomId} onChange={(event) => setRoomId(event.currentTarget.value)} disabled={recording || finalizing || importingAudio} autoComplete="off" placeholder="예: table-a" pattern="[A-Za-z0-9][A-Za-z0-9._:-]{0,127}" style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
          </label>
          <label>전사 언어
            <input value={language} onChange={(event) => setLanguage(event.currentTarget.value)} disabled={recording || finalizing || importingAudio} autoComplete="off" placeholder="예: ko-KR" pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*" style={{ ...controlStyle, display: 'block', marginTop: 6, width: '100%' }} />
          </label>
        </div>
        <section aria-label="테이블 녹음 파일 로컬 가져오기" style={{ display: 'grid', gap: 8 }}>
          <p style={{ color: MUTED, margin: 0 }}>
            파일명·경로·음성 bytes는 검수 batch에 넣지 않습니다. 운영자가 확인한 녹음 시작 시각과 브라우저가 읽은 길이·SHA-256만 결속합니다. 최대 256MB입니다.
          </p>
          <label>로컬 녹음 파일
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg"
              onChange={(event) => setAudioFile(event.currentTarget.files?.[0] ?? null)}
              disabled={recording || finalizing || importingAudio}
              style={{ ...controlStyle, display: 'block', width: '100%' }}
            />
          </label>
          <label>파일 녹음 시작 시각 (이 장치의 현지 시각)
            <input type="datetime-local" value={recordedStartedAt} onChange={(event) => setRecordedStartedAt(event.currentTarget.value)} disabled={recording || finalizing || importingAudio} style={{ ...controlStyle, display: 'block', width: '100%' }} />
          </label>
          <button type="button" onClick={() => { void importAudioFile(); }} disabled={!consented || !audioFile || sessionId.trim().length === 0 || roomId.trim().length === 0 || language.trim().length === 0 || recordedStartedAt.length === 0 || recording || finalizing || importingAudio} style={{ ...controlStyle, fontWeight: 800 }}>
            {importingAudio ? '녹음 파일 확인 중…' : '녹음 파일 로컬 가져오기'}
          </button>
        </section>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" onClick={() => { void startRecording(); }} disabled={!consented || sessionId.trim().length === 0 || roomId.trim().length === 0 || language.trim().length === 0 || recording || finalizing || importingAudio} style={{ ...controlStyle, background: '#0B4F6C', color: '#FFFFFF', fontWeight: 800 }}>
            녹음 시작
          </button>
          <button type="button" onClick={stopRecording} disabled={!recording || finalizing} style={{ ...controlStyle, background: '#8A1C1C', color: '#FFFFFF', fontWeight: 800 }}>
            녹음 정지
          </button>
        </div>
        {audioUrl ? <audio controls src={audioUrl} aria-label="세션 메모리 녹음 미리듣기" /> : null}
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" style={{ color: '#174A36' }}>{notice}</p>
      {error ? <p role="alert" style={{ color: '#8A1C1C', fontWeight: 700 }}>{error}</p> : null}
      {capture ? (
        <>
          <section aria-label="로컬 전사 chunk 작성" style={{ ...cardStyle, marginBottom: 16 }}>
            <strong>로컬 음성 {capture.source.durationMs}ms · {capture.source.byteLength} bytes</strong>
            <span style={{ color: MUTED, overflowWrap: 'anywhere' }}>capture ID <code data-private-capture-id>{capture.source.captureId}</code></span>
            <span style={{ color: MUTED, overflowWrap: 'anywhere' }}>출처 {capture.source.sessionId} · {capture.source.roomId} · {capture.source.language} · {capture.source.captureMethod}</span>
            <span style={{ color: MUTED, overflowWrap: 'anywhere' }}>audio SHA-256 {capture.source.audioSha256}</span>
            <p style={{ color: MUTED, margin: 0, overflowWrap: 'anywhere' }}>
              인증 검수자 ID <code>{reviewerId}</code>
            </p>
            <section aria-label="로컬 STT 후보 가져오기" style={{ display: 'grid', gap: 8 }}>
              <p style={{ color: MUTED, margin: 0 }}>
                현재 capture ID·회차·audio SHA-256·길이가 모두 일치하는 JSON만 기존 전사 초안을 교체합니다. 파일은 업로드하거나 저장하지 않습니다.
              </p>
              <label>provider-neutral STT 후보 JSON
                <input
                  ref={sttInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => setSttCandidateFile(event.currentTarget.files?.[0] ?? null)}
                  disabled={importingStt}
                  style={{ ...controlStyle, display: 'block', width: '100%' }}
                />
              </label>
              <button type="button" onClick={() => { void importSttCandidates(); }} disabled={!sttCandidateFile || importingStt} style={{ ...controlStyle, fontWeight: 800 }}>
                {importingStt ? 'STT 후보 확인 중…' : 'STT 후보 로컬 가져오기'}
              </button>
            </section>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
              <label>시작 ms<input type="number" min="0" value={startMs} onChange={(event) => setStartMs(event.currentTarget.value)} style={{ ...controlStyle, display: 'block', width: '100%' }} /></label>
              <label>종료 ms<input type="number" min="1" value={endMs} onChange={(event) => setEndMs(event.currentTarget.value)} style={{ ...controlStyle, display: 'block', width: '100%' }} /></label>
              <label>화자 가명 또는 미식별 표기
                <input value={speaker} onChange={(event) => setSpeaker(event.currentTarget.value)} pattern="speaker-([a-z]{1,3}|unknown)" aria-describedby="private-speaker-help" style={{ ...controlStyle, display: 'block', width: '100%' }} />
              </label>
              <small id="private-speaker-help" style={{ color: MUTED }}>화자를 구분할 수 없으면 speaker-unknown을 유지하세요.</small>
            </div>
            <label>수동 전사 원문
              <textarea value={chunkText} onChange={(event) => setChunkText(event.currentTarget.value)} rows={3} style={{ ...controlStyle, display: 'block', resize: 'vertical', width: '100%' }} />
            </label>
            <button type="button" onClick={appendChunk} disabled={chunkText.trim().length === 0} style={{ ...controlStyle, fontWeight: 800 }}>전사 chunk 추가</button>
          </section>
          <section aria-label="전사 chunk 검수 목록" style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
            {capture.chunks.map((chunk) => {
              const edited = chunk.text !== chunk.sourceText;
              return (
                <article key={chunk.uid} aria-label={`전사 chunk 검수 ${chunk.uid}`} style={cardStyle}>
                  <strong>{chunk.uid} · {chunk.reviewStatus === 'proposed' ? '미검수' : chunk.reviewStatus}</strong>
                  <span style={{ color: MUTED }}>{chunk.startMs}–{chunk.endMs}ms · {chunk.speakerLabelPseudonym}</span>
                  <label>검수 전사
                    <textarea value={chunk.text} onChange={(event) => updateChunkDraft(chunk.uid, event.currentTarget.value)} rows={3} style={{ ...controlStyle, display: 'block', resize: 'vertical', width: '100%' }} />
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button type="button" onClick={() => decideChunk(chunk.uid, edited ? 'edited' : 'accepted')} disabled={!reviewerValid} style={{ ...controlStyle, background: '#165B33', color: '#FFFFFF', fontWeight: 800 }}>
                      {edited ? '수정 승인' : '원문 승인'}
                    </button>
                    <button type="button" onClick={() => decideChunk(chunk.uid, 'rejected')} disabled={!reviewerValid} style={{ ...controlStyle, color: '#8A1C1C', fontWeight: 800 }}>반려</button>
                  </div>
                </article>
              );
            })}
          </section>
          <section aria-label="전사 검수 extraction handoff" style={cardStyle}>
            <strong>검수 진행 {capture.summary.decided}/{capture.summary.chunks}</strong>
            <button type="button" onClick={exportBatch} disabled={!exportReady} style={{ ...controlStyle, background: '#553C9A', color: '#FFFFFF', fontWeight: 800 }}>
              검수 완료 전사 batch 다운로드
            </button>
          </section>
        </>
      ) : null}
    </section>
  );
}
