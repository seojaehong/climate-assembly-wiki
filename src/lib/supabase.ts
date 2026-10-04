import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSafeBrowserStorage } from './safe-browser-storage';

export const PLATFORM_ORG_CONTEXT_KEY = 'climate_vote_platform_org_context';
export const PLATFORM_ORG_CONTEXT_HEADER = 'x-platform-org-context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PlatformOrgContextStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// 쿠키·사이트 데이터를 막은 기기에서는 `window.sessionStorage` 를 읽기만 해도 SecurityError 가
// 난다. 이 값이 platformFetch 의 기본 인자로 평가되므로, 그대로 두면 모든 REST 요청이
// fetch 전에 실패한다(운영 E2E N11). 안전 래퍼는 막히면 페이지 메모리로 내려간다.
const safeSessionStorage = createSafeBrowserStorage('sessionStorage');
const safeLocalStorage = createSafeBrowserStorage('localStorage');

function browserSessionStorage(): PlatformOrgContextStorage | null {
  return typeof window === 'undefined' ? null : safeSessionStorage;
}

export function readPlatformOrgContextToken(
  storage: PlatformOrgContextStorage | null = browserSessionStorage(),
): string | null {
  if (!storage) return null;
  try {
    const token = storage.getItem(PLATFORM_ORG_CONTEXT_KEY);
    if (!token) return null;
    if (UUID_RE.test(token)) return token;
    storage.removeItem(PLATFORM_ORG_CONTEXT_KEY);
    console.error('Discarded invalid platform organization context');
    return null;
  } catch (error: unknown) {
    console.error('Failed to read platform organization context', error);
    return null;
  }
}

export function storePlatformOrgContextToken(
  token: string,
  storage: PlatformOrgContextStorage | null = browserSessionStorage(),
): boolean {
  if (!UUID_RE.test(token) || !storage) return false;
  try {
    storage.setItem(PLATFORM_ORG_CONTEXT_KEY, token);
    return true;
  } catch (error: unknown) {
    console.error('Failed to store platform organization context', error);
    return false;
  }
}

export function clearPlatformOrgContextToken(
  storage: PlatformOrgContextStorage | null = browserSessionStorage(),
): boolean {
  if (!storage) return true;
  try {
    storage.removeItem(PLATFORM_ORG_CONTEXT_KEY);
    return true;
  } catch (error: unknown) {
    console.error('Failed to clear platform organization context', error);
    return false;
  }
}

export function platformOrgContextHeaders(
  initialHeaders?: HeadersInit,
  storage: PlatformOrgContextStorage | null = browserSessionStorage(),
): Headers {
  const headers = new Headers(initialHeaders);
  const contextToken = readPlatformOrgContextToken(storage);
  if (contextToken) headers.set(PLATFORM_ORG_CONTEXT_HEADER, contextToken);
  return headers;
}

/** Restricts the tab-scoped organization token to the configured Supabase REST origin. */
export function isPlatformRestRequest(
  input: RequestInfo | URL,
  platformUrl: string,
): boolean {
  const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!URL.canParse(target) || !URL.canParse(platformUrl)) return false;
  const targetUrl = new URL(target);
  const expectedUrl = new URL(platformUrl);
  return targetUrl.origin === expectedUrl.origin
    && targetUrl.username === ''
    && targetUrl.password === ''
    && targetUrl.pathname.startsWith('/rest/v1/');
}

async function platformFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = isPlatformRestRequest(input, url)
    ? platformOrgContextHeaders(init?.headers)
    : new Headers(init?.headers);
  return fetch(input, { ...init, headers });
}

// 공개(publishable) anon 키 + URL — 어차피 클라이언트 번들에 노출되는 공개 자격증명이며 RLS가 데이터를 보호한다.
// Cloudflare Build env var(PUBLIC_SUPABASE_*)가 있으면 그것이 우선, 없으면 아래 fallback으로 prod 동작 보장.
const FALLBACK_URL = 'https://pleyuknjnprsckssxvrh.supabase.co';
const FALLBACK_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsZXl1a25qbnByc2Nrc3N4dnJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzOTEyMjQsImV4cCI6MjA4ODk2NzIyNH0.fP_OG2ZpP7KDtPebY4Wp20mMWlVMn5KQad7UpJ4hx08';

const url = ((import.meta.env.PUBLIC_SUPABASE_URL as string) || FALLBACK_URL).trim();
const anon = ((import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string) || FALLBACK_ANON).trim();

let _client: SupabaseClient | null = null;

/** 브라우저용 anon 클라이언트. env 미설정 시 null (호출부에서 폴백 처리). */
export function getSupabase(): SupabaseClient | null {
  if (!url || !anon) return null;
  if (!_client) _client = createClient(url, anon, {
    // 저장소가 막힌 기기에서도 auth 세션은 페이지 메모리에 유지된다(새로고침하면 사라짐).
    auth: { storage: safeLocalStorage },
    global: { fetch: platformFetch },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return _client;
}
