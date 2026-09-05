import { describe, expect, it } from 'vitest';
import {
  buildPublicationScopeKey,
  buildPublicResultUrl,
  buildAttachedPublication,
  parsePublicResultToken,
  runExclusivePublicationOperation,
  validatePublishInput,
  verifyPublishedResult,
} from './publish-console-logic';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('runExclusivePublicationOperation', () => {
  it('첫 await 전에 lock을 잡아 같은 이벤트 루프의 중복 mutation을 차단한다', async () => {
    const lock = { current: false };
    const busy: boolean[] = [];
    const gate = deferred<string>();
    let actionCount = 0;
    const action = async () => {
      actionCount += 1;
      return gate.promise;
    };

    const first = runExclusivePublicationOperation(lock, action, (value) => busy.push(value));
    const duplicate = await runExclusivePublicationOperation(lock, action, (value) => busy.push(value));

    expect(lock.current).toBe(true);
    expect(actionCount).toBe(1);
    expect(duplicate).toEqual({ started: false, value: null });
    expect(busy).toEqual([true]);

    gate.resolve('published');
    await expect(first).resolves.toEqual({ started: true, value: 'published' });
    expect(lock.current).toBe(false);
    expect(busy).toEqual([true, false]);
  });

  it('예외가 발생해도 lock과 busy를 해제해 운영자가 다시 시도할 수 있다', async () => {
    const lock = { current: false };
    const busy: boolean[] = [];

    await expect(runExclusivePublicationOperation(
      lock,
      async () => { throw new Error('fixture failure'); },
      (value) => busy.push(value),
    )).rejects.toThrow('fixture failure');

    expect(lock.current).toBe(false);
    expect(busy).toEqual([true, false]);
    await expect(runExclusivePublicationOperation(lock, async () => 'retry', () => undefined))
      .resolves.toEqual({ started: true, value: 'retry' });
  });
});

describe('validatePublishInput', () => {
  it('staff session id·제목·스코프가 모두 유효해야 공개 요청을 허용한다', () => {
    expect(validatePublishInput({
      sessionId: '  session-1  ',
      title: '  2026 기후시민회의 결과  ',
      scope: 'topic',
      scopeId: 'topic-1',
    })).toEqual({
      ok: true,
      value: {
        sessionId: 'session-1',
        title: '2026 기후시민회의 결과',
        scope: 'topic',
        scopeId: 'topic-1',
      },
      error: null,
    });

    expect(validatePublishInput({ sessionId: null, title: '결과', scope: 'topic', scopeId: 'topic-1' }).error)
      .toContain('회차');
    expect(validatePublishInput({ sessionId: 'session-1', title: '   ', scope: 'topic', scopeId: 'topic-1' }).error)
      .toContain('제목');
    expect(validatePublishInput({ sessionId: 'session-1', title: '결과', scope: null, scopeId: null }).error)
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

describe('parsePublicResultToken', () => {
  const token = '0123456789abcdef0123456789abcdef';

  it('accepts a canonical token or same-origin public result URL', () => {
    expect(parsePublicResultToken(`  ${token.toUpperCase()}  `, 'https://climate-assembly.org')).toEqual({
      ok: true,
      token,
      error: null,
    });
    expect(parsePublicResultToken(`https://climate-assembly.org/r/${token}`, 'https://climate-assembly.org')).toEqual({
      ok: true,
      token,
      error: null,
    });
  });

  it('rejects foreign origins, credentials, query strings and malformed tokens', () => {
    expect(parsePublicResultToken(`https://evil.example/r/${token}`, 'https://climate-assembly.org').error).toContain('현재 사이트');
    expect(parsePublicResultToken(`https://user:secret@climate-assembly.org/r/${token}`, 'https://climate-assembly.org').error).toContain('현재 사이트');
    expect(parsePublicResultToken(`https://climate-assembly.org/r/${token}?leak=1`, 'https://climate-assembly.org').error).toContain('형식');
    expect(parsePublicResultToken('not-a-token', 'https://climate-assembly.org').error).toContain('형식');
  });
});

describe('buildAttachedPublication', () => {
  const token = '0123456789abcdef0123456789abcdef';
  const actual = {
    scope: 'session',
    scope_id: 'session-1',
    title: '기후시민회의 결과',
    published_at: '2026-09-03T01:30:00.000Z',
    body: { reviewed_count: 2, issues: [] },
    hitl_notice: '검수 안내',
  };

  it('binds an existing public snapshot to the currently selected scope', () => {
    expect(buildAttachedPublication(token, 'https://climate-assembly.org', 'session', 'session-1', actual)).toEqual({
      id: null,
      token,
      title: '기후시민회의 결과',
      url: `https://climate-assembly.org/r/${token}`,
      publishedAt: '2026-09-03T01:30:00.000Z',
      reviewedCount: 2,
      verified: true,
      body: actual.body,
    });
  });

  it('rejects a snapshot from another scope or malformed publication metadata', () => {
    expect(() => buildAttachedPublication(token, 'https://climate-assembly.org', 'session', 'other', actual)).toThrow('스코프');
    expect(() => buildAttachedPublication(token, 'https://climate-assembly.org', 'session', 'session-1', { ...actual, published_at: 'invalid' })).toThrow('발행 시각');
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
