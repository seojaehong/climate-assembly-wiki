import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 운영 E2E N11 — 쿠키·사이트 데이터를 막은 기기에서는 `window.sessionStorage` 를 읽기만 해도
// SecurityError 가 난다. platformFetch 의 기본 인자가 그 값을 읽으므로 모든 REST 요청이
// fetch 전에 실패했다. 이 테스트는 그 경로가 예외 없이 헤더를 만드는지만 본다.
const g = globalThis as Record<string, unknown>;

function blockStorage(name: 'localStorage' | 'sessionStorage') {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

describe('supabase platform org context on a storage-blocked device', () => {
  let hadWindow: boolean;

  beforeEach(() => {
    vi.resetModules();
    hadWindow = 'window' in g;
    if (!hadWindow) g.window = globalThis;
    blockStorage('sessionStorage');
    blockStorage('localStorage');
  });

  afterEach(() => {
    delete g.sessionStorage;
    delete g.localStorage;
    if (!hadWindow) delete g.window;
    vi.restoreAllMocks();
  });

  it('builds request headers without throwing when sessionStorage access throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { platformOrgContextHeaders, PLATFORM_ORG_CONTEXT_HEADER } = await import('./supabase');

    const headers = platformOrgContextHeaders({ apikey: 'anon' });

    expect(headers.get('apikey')).toBe('anon');
    expect(headers.has(PLATFORM_ORG_CONTEXT_HEADER)).toBe(false);
  });

  it('keeps a stored org context for the page lifetime in memory', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const mod = await import('./supabase');
    const token = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

    expect(mod.storePlatformOrgContextToken(token)).toBe(true);
    expect(mod.readPlatformOrgContextToken()).toBe(token);
    expect(mod.platformOrgContextHeaders().get(mod.PLATFORM_ORG_CONTEXT_HEADER)).toBe(token);
  });
});
