import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import {
  canWriteCanvas,
  completeCanvasOperationForGeneration,
  CanvasConnectionNotice,
  CanvasOperationNotice,
  retainCanvasOperationNotice,
  runExclusiveCanvasAuthOperation,
} from './CanvasBoard';
import type { CanvasOperationResult } from './canvas/canvas-operation';
import { completeCanvasAuthSessionLoad } from './canvas/useAuth';

const authSession = (id: string) => ({ user: { id, email: `${id}@example.test` } }) as Session;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('CanvasOperationNotice', () => {
  it('announces failures and exposes the failed operation retry', () => {
    const html = renderToStaticMarkup(createElement(CanvasOperationNotice, {
      result: {
        ok: false,
        kind: 'alert',
        message: '의제 이동에 실패했습니다. 다시 시도해 주세요.',
        retry: async (): Promise<CanvasOperationResult> => ({
          ok: true,
          kind: 'status',
          message: '의제 이동 완료',
        }),
      },
      retrying: false,
      retryAllowed: true,
      onRetry: vi.fn(),
      onRefresh: vi.fn(),
      onDismiss: vi.fn(),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('의제 이동에 실패했습니다. 다시 시도해 주세요.');
    expect(html).toContain('다시 시도');
  });

  it('announces successful writes without a retry control', () => {
    const html = renderToStaticMarkup(createElement(CanvasOperationNotice, {
      result: { ok: true, kind: 'status', message: '의제 추가 완료' },
      retrying: false,
      retryAllowed: true,
      onRetry: vi.fn(),
      onRefresh: vi.fn(),
      onDismiss: vi.fn(),
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('다시 시도');
  });

  it('keeps a failure visible when a concurrent success completes later', () => {
    const failure: CanvasOperationResult = {
      ok: false,
      kind: 'alert',
      message: '의제 이동 실패',
    };
    const success: CanvasOperationResult = {
      ok: true,
      kind: 'status',
      message: '의제 추가 완료',
    };

    expect(retainCanvasOperationNotice(failure, success)).toBe(failure);
    expect(retainCanvasOperationNotice(success, failure)).toBe(failure);
  });

  it('disables a stored retry while the canvas is read-only', () => {
    const html = renderToStaticMarkup(createElement(CanvasOperationNotice, {
      result: {
        ok: false,
        kind: 'alert',
        message: '의제 이동 실패',
        retry: async (): Promise<CanvasOperationResult> => ({
          ok: true,
          kind: 'status',
          message: '의제 이동 완료',
        }),
      },
      retrying: false,
      retryAllowed: false,
      onRetry: vi.fn(),
      onRefresh: vi.fn(),
      onDismiss: vi.fn(),
    }));

    expect(html).toContain('disabled=""');
    expect(html).toContain('연결 후 재시도');
  });

  it('offers state reconciliation instead of repeating a non-idempotent write', () => {
    const html = renderToStaticMarkup(createElement(CanvasOperationNotice, {
      result: {
        ok: false,
        kind: 'alert',
        message: '의제 추가 결과를 확인하지 못했습니다.',
      },
      retrying: false,
      retryAllowed: true,
      onRetry: vi.fn(),
      onRefresh: vi.fn(),
      onDismiss: vi.fn(),
    }));

    expect(html).toContain('상태 새로고침');
    expect(html).not.toContain('다시 시도');
  });
});

describe('CanvasConnectionNotice', () => {
  it('announces degraded mode as read-only and offers retry for load errors', () => {
    const degraded = renderToStaticMarkup(createElement(CanvasConnectionNotice, {
      connection: {
        status: 'degraded',
        message: '데이터 연결을 사용할 수 없어 읽기 전용 안내만 표시합니다.',
      },
      onRetry: vi.fn(),
    }));
    const failed = renderToStaticMarkup(createElement(CanvasConnectionNotice, {
      connection: {
        status: 'error',
        message: '캔버스 데이터를 불러오지 못했습니다. 다시 시도해 주세요.',
      },
      onRetry: vi.fn(),
    }));

    expect(degraded).toContain('role="alert"');
    expect(degraded).toContain('읽기 전용');
    expect(degraded).not.toContain('다시 연결');
    expect(failed).toContain('다시 연결');
  });

  it('keeps the board read-only until both auth and realtime are ready', () => {
    expect(canWriteCanvas(true, 'ready')).toBe(true);
    expect(canWriteCanvas(false, 'ready')).toBe(false);
    expect(canWriteCanvas(true, 'loading')).toBe(false);
    expect(canWriteCanvas(true, 'degraded')).toBe(false);
    expect(canWriteCanvas(true, 'error')).toBe(false);
  });
});

describe('Canvas auth session freshness', () => {
  it('discards an operation result after the auth generation changes', async () => {
    const gate = deferred<CanvasOperationResult>();
    const applied: CanvasOperationResult[] = [];
    let generation = 1;
    const pending = completeCanvasOperationForGeneration(
      gate.promise,
      () => generation === 1,
      (result) => applied.push(result),
    );

    generation = 2;
    const staleResult: CanvasOperationResult = {
      ok: false,
      kind: 'alert',
      message: 'stale canvas write failure',
      retry: async () => ({ ok: true, kind: 'status', message: 'stale retry' }),
    };
    gate.resolve(staleResult);

    await expect(pending).resolves.toBe(staleResult);
    expect(applied).toEqual([]);
  });

  it('applies an operation result while the auth generation is current', async () => {
    const applied: CanvasOperationResult[] = [];
    const result: CanvasOperationResult = { ok: true, kind: 'status', message: 'current write' };

    await expect(completeCanvasOperationForGeneration(
      Promise.resolve(result),
      () => true,
      (current) => applied.push(current),
    )).resolves.toBe(result);

    expect(applied).toEqual([result]);
  });

  it('locks an auth operation before the first await and rejects a duplicate submission', async () => {
    const lock = { current: false };
    const gate = deferred<void>();
    const busyChanges: boolean[] = [];
    let actionCount = 0;
    const action = async () => {
      actionCount += 1;
      await gate.promise;
    };

    const first = runExclusiveCanvasAuthOperation(lock, action, (busy) => busyChanges.push(busy));
    const duplicate = await runExclusiveCanvasAuthOperation(lock, action, (busy) => busyChanges.push(busy));

    expect(duplicate).toBe(false);
    expect(actionCount).toBe(1);
    expect(lock.current).toBe(true);
    expect(busyChanges).toEqual([true]);

    gate.resolve();
    await expect(first).resolves.toBe(true);
    expect(lock.current).toBe(false);
    expect(busyChanges).toEqual([true, false]);
  });

  it('releases the auth operation lock after an unexpected failure', async () => {
    const lock = { current: false };
    const busyChanges: boolean[] = [];

    await expect(runExclusiveCanvasAuthOperation(
      lock,
      async () => { throw new Error('synthetic auth failure'); },
      (busy) => busyChanges.push(busy),
    )).rejects.toThrow('synthetic auth failure');

    expect(lock.current).toBe(false);
    expect(busyChanges).toEqual([true, false]);
  });

  it('wires login and logout to the shared synchronous auth lock', () => {
    const source = readFileSync(new URL('./CanvasBoard.tsx', import.meta.url), 'utf8');

    expect(source.match(/runExclusiveCanvasAuthOperation\(authOperationLock/g)).toHaveLength(2);
    expect(source).toContain('operationState?.generation === authGeneration');
    expect(source).toContain('authGenerationRef.current === generation');
    expect(source).toContain('}, [authGeneration, setNodes]);');
    expect(source).toContain('disabled={loggingIn}');
    expect(source).toContain('disabled={loggingOut}');
    expect(source).toContain("loggingOut ? '로그아웃 중…' : '로그아웃'");
    expect(source).toContain("setLoginEmail('');");
    expect(source).toContain("setLoginPw('');");
  });

  it('discards an initial session response after a newer auth event invalidates it', async () => {
    let resolveSession!: (value: { data: { session: Session | null }; error: Error | null }) => void;
    const pending = new Promise<{ data: { session: Session | null }; error: Error | null }>((resolve) => {
      resolveSession = resolve;
    });
    const sessions: Array<Session | null> = [];
    const errors: Array<string | null> = [];
    let generation = 1;
    const load = completeCanvasAuthSessionLoad(
      () => pending,
      () => generation === 1,
      (session) => sessions.push(session),
      (error) => errors.push(error),
    );

    generation = 2;
    resolveSession({ data: { session: authSession('stale-user') }, error: null });
    await load;

    expect(sessions).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('applies the current session and exposes current load failures', async () => {
    const sessions: Array<Session | null> = [];
    const errors: Array<string | null> = [];
    const current = authSession('current-user');

    await completeCanvasAuthSessionLoad(
      async () => ({ data: { session: current }, error: null }),
      () => true,
      (session) => sessions.push(session),
      (error) => errors.push(error),
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await completeCanvasAuthSessionLoad(
        async () => ({ data: { session: null }, error: new Error('fixture auth failure') }),
        () => true,
        (session) => sessions.push(session),
        (error) => errors.push(error),
      );
      expect(errorLog).toHaveBeenCalledOnce();
    } finally {
      errorLog.mockRestore();
    }

    expect(sessions).toEqual([current, null]);
    expect(errors).toEqual([null, '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.']);
  });

  it('does not surface an obsolete initial session failure after auth changes', async () => {
    const sessions: Array<Session | null> = [];
    const errors: Array<string | null> = [];
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await completeCanvasAuthSessionLoad(
        async () => { throw new Error('stale fixture auth failure'); },
        () => false,
        (session) => sessions.push(session),
        (error) => errors.push(error),
      );
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }

    expect(sessions).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('invalidates the initial read on auth events and unmount cleanup', () => {
    const source = readFileSync(new URL('./canvas/useAuth.ts', import.meta.url), 'utf8');

    expect(source).toContain('const generation = authGeneration.current + 1;');
    expect(source).toContain('() => active && authGeneration.current === generation');
    expect(source).toContain("sb.auth.onAuthStateChange((_event, s) => {");
    expect(source).toContain('authGeneration.current += 1;');
    expect(source).toContain('setSessionGeneration(authGeneration.current);');
    expect(source).toContain('active = false;');
  });
});

describe('CanvasBoard development runtime', () => {
  it('pins the Astro integrations to the shared Vite 6 runtime', () => {
    const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(packageJson.dependencies.astro).toBe('5.18.2');
    expect(packageJson.dependencies['@astrojs/react']).toBe('4.4.2');
    expect(packageJson.dependencies['@tailwindcss/vite']).toBe('4.1.6');
  });

  it('keeps JSON data islands out of the Vite dependency scanner', () => {
    const groups = readFileSync(
      new URL('../pages/[lang]/moderator/insights/groups.astro', import.meta.url),
      'utf8',
    );
    const heatmap = readFileSync(
      new URL('../pages/[lang]/moderator/insights/heatmap.astro', import.meta.url),
      'utf8',
    );

    expect(groups).toContain('<script is:inline id="groups-viz-data" type="application/json"');
    expect(groups).toContain('<script is:inline id="groups-agendas-data" type="application/json"');
    expect(groups).not.toContain('client <script>');
    expect(heatmap).toContain('<script is:inline id="hm-agendas" type="application/json"');
    expect(heatmap).toContain('<script is:inline id="hm-matrix" type="application/json"');
    expect(heatmap).not.toContain('client <script>');
  });

  it('loads the official Pretendard subset stylesheet instead of a missing font file', () => {
    const globalStyles = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    expect(globalStyles).toContain('pretendardvariable-dynamic-subset.min.css');
    expect(globalStyles).not.toContain('pretendardvariable-dynamic-subset.woff2');
  });
});
