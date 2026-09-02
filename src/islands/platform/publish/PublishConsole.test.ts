import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PublishConsole, { CopyAnnouncement } from './PublishConsole';
import ImplementationConsole from './ImplementationConsole';

describe('PublishConsole', () => {
  it('선택한 스코프와 공개 입력·HITL 안내를 한 화면에 렌더한다', () => {
    const html = renderToStaticMarkup(createElement(PublishConsole, { scope: 'topic', scopeId: 'topic-1' }));

    expect(html).toContain('HQ 인증 토큰');
    expect(html).toContain('공개 결과 제목');
    expect(html).toContain('검수 결과 발행');
    expect(html).toContain('topic-1');
    expect(html).toContain('AI는 초안을 만들고');
  });

  it('공개 설정의 입력과 동작 컨트롤은 2px 고대비 경계를 사용한다', () => {
    const html = renderToStaticMarkup(createElement(PublishConsole, { scope: 'topic', scopeId: 'topic-1' }));
    const copiedHtml = renderToStaticMarkup(createElement(CopyAnnouncement, { copied: true }));

    expect(html).toContain('border:2px solid #6B7D88');
    expect(html).not.toMatch(/border:(?:1|1\.5)px/);
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(copiedHtml).toContain('aria-atomic="true"');
    expect(copiedHtml).toContain('공개 결과 URL을 클립보드에 복사했습니다.');
  });

  it('발행과 공개 해제가 같은 동기 operation lock을 공유한다', () => {
    const source = readFileSync(new URL('./PublishConsole.tsx', import.meta.url), 'utf8');

    expect(source.match(/runExclusivePublicationOperation\(operationLock/g)).toHaveLength(2);
    expect(source.match(/operationLock\.current/g)).toHaveLength(2);
    expect(source).toContain('disabled={busy}');
  });

  it('검수 완료 권고의 기관 이행조치 직접 등록 폼을 렌더한다', () => {
    const html = renderToStaticMarkup(createElement(ImplementationConsole, {
      hqToken: 'hq-token',
      resultId: 'result-1',
      resultToken: 'public-token',
      resultBody: {
        issues: [{
          id: '31111111-1111-4111-8111-111111111111',
          label: '대중교통 확대',
          review_status: 'reviewed',
        }],
      },
      onVerified: () => undefined,
    }));

    expect(html).toContain('기관 이행조치 직접 등록');
    expect(html).toContain('대중교통 확대');
    expect(html).toContain('이행조치 저장 및 공개 확인');
    expect(html).toContain('이행 완료·미이행 사유 공개는 HTTPS 근거가 필수');
    expect(html).toContain('border:2px solid #135C73');
  });

  it('이행조치 저장은 동기 operation lock으로 중복 제출을 막는다', () => {
    const source = readFileSync(new URL('./ImplementationConsole.tsx', import.meta.url), 'utf8');

    expect(source).toContain('busy || operationLock.current');
    expect(source).toContain('runExclusivePublicationOperation(operationLock');
  });
});
