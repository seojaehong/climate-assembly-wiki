import { describe, expect, it } from 'vitest';
import { HQ_TOKEN_KEY } from '../../mod/hq-gate-logic';
import {
  buildPublicationScopeKey,
  buildPublicResultUrl,
  readStoredHqToken,
  validatePublishInput,
  verifyPublishedResult,
} from './publish-console-logic';

describe('readStoredHqToken', () => {
  it('동일 브라우저의 HQ 세션 저장소에서 유효한 토큰을 복원한다', () => {
    const requestedKeys: string[] = [];
    const storage = {
      getItem(key: string) {
        requestedKeys.push(key);
        return 'hq-session-token';
      },
    };

    expect(readStoredHqToken(() => storage, () => undefined)).toBe('hq-session-token');
    expect(requestedKeys).toEqual([HQ_TOKEN_KEY]);
    expect(readStoredHqToken(() => ({ getItem: () => '   ' }), () => undefined)).toBe('');
    expect(readStoredHqToken(() => null, () => undefined)).toBe('');
  });

  it('storage getter 또는 getItem 실패를 기록하고 빈 토큰으로 대체한다', () => {
    const errors: unknown[] = [];
    const recordError = (error: unknown) => errors.push(error);
    const getterError = new DOMException('Storage blocked', 'SecurityError');
    const itemError = new DOMException('Storage read blocked', 'SecurityError');

    expect(readStoredHqToken(() => { throw getterError; }, recordError)).toBe('');
    expect(readStoredHqToken(() => ({ getItem: () => { throw itemError; } }), recordError)).toBe('');
    expect(errors).toEqual([getterError, itemError]);
  });
});

describe('validatePublishInput', () => {
  it('HQ 토큰·제목·스코프가 모두 유효해야 공개 요청을 허용한다', () => {
    expect(validatePublishInput({
      hqToken: '  hq-session-token  ',
      title: '  2026 기후시민회의 결과  ',
      scope: 'topic',
      scopeId: 'topic-1',
    })).toEqual({
      ok: true,
      value: {
        hqToken: 'hq-session-token',
        title: '2026 기후시민회의 결과',
        scope: 'topic',
        scopeId: 'topic-1',
      },
      error: null,
    });

    expect(validatePublishInput({ hqToken: '', title: '결과', scope: 'topic', scopeId: 'topic-1' }).error)
      .toContain('HQ');
    expect(validatePublishInput({ hqToken: 'token', title: '   ', scope: 'topic', scopeId: 'topic-1' }).error)
      .toContain('제목');
    expect(validatePublishInput({ hqToken: 'token', title: '결과', scope: null, scopeId: null }).error)
      .toContain('스코프');
  });
});

describe('buildPublicResultUrl', () => {
  it('호스트 마지막 슬래시와 관계없이 /r/<token> 절대 URL을 만든다', () => {
    expect(buildPublicResultUrl('abc123', 'https://climate-assembly.org/'))
      .toBe('https://climate-assembly.org/r/abc123');
    expect(buildPublicResultUrl('abc123', 'https://preview.example'))
      .toBe('https://preview.example/r/abc123');
  });
});

describe('buildPublicationScopeKey', () => {
  it('스코프가 바뀌면 콘솔을 재마운트할 고유 키를 만든다', () => {
    expect(buildPublicationScopeKey('topic', 'topic-1')).toBe('topic:topic-1');
    expect(buildPublicationScopeKey('topic', 'topic-2')).toBe('topic:topic-2');
    expect(buildPublicationScopeKey(null, null)).toBe('none');
  });
});

describe('verifyPublishedResult', () => {
  it('공개 조회가 같은 스코프·제목을 돌려줘야 검증 완료로 판정한다', () => {
    const expected = { scope: 'topic' as const, scopeId: 'topic-1', title: '기후시민회의 결과' };
    const actual = {
      scope: 'topic',
      scope_id: 'topic-1',
      title: '기후시민회의 결과',
      published_at: '2026-08-10T12:00:00Z',
      body: {},
      hitl_notice: '검수 안내',
    };

    expect(verifyPublishedResult(expected, actual)).toEqual({ ok: true, error: null });
    expect(verifyPublishedResult(expected, null).error).toContain('조회되지');
    expect(verifyPublishedResult(expected, { ...actual, scope_id: 'other-topic' }).error).toContain('일치하지');
  });
});
