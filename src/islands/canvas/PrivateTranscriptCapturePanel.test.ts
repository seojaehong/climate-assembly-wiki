import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PrivateTranscriptCapturePanel } from './PrivateTranscriptCapturePanel';

describe('PrivateTranscriptCapturePanel', () => {
  it('starts as a consent-gated, session-memory-only MediaRecorder surface', () => {
    const html = renderToStaticMarkup(createElement(PrivateTranscriptCapturePanel));

    expect(html).toContain('R4 로컬 음성·전사 검수');
    expect(html).toContain('브라우저 세션 메모리에만');
    expect(html).toContain('DB·서버·public 경로로 전송하지 않습니다.');
    expect(html).toContain('새 녹음을 시작하거나 페이지를 닫으면 기존 음성은 폐기됩니다.');
    expect(html).toContain('실제 시민 발언을 녹음하지 마세요.');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('마이크 사용과 로컬 메모리 처리에 동의합니다.');
    expect(html).toContain('녹음 시작');
    expect(html).toContain('disabled=""');
    expect(html).toContain('전사 chunk 검수 완료 전에는 extraction handoff를 만들 수 없습니다.');
    expect(html).toContain('aria-live="polite"');
  });
});
