import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  canWriteCanvas,
  CanvasConnectionNotice,
  CanvasOperationNotice,
  retainCanvasOperationNotice,
} from './CanvasBoard';
import type { CanvasOperationResult } from './canvas/canvas-operation';

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
