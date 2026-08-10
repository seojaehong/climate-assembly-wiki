import type { ScopeLevel } from '../platform-nav-logic';
import type { ResultPageView } from '../../../lib/platform';
import { HQ_TOKEN_KEY, isValidHqToken } from '../../mod/hq-gate-logic';

export interface TokenStorage {
  getItem(key: string): string | null;
}

/** Reads the active HQ token and reports storage access failures without exposing the token. */
export function readStoredHqToken(
  getStorage: () => TokenStorage | null | undefined,
  onError: (error: unknown) => void,
): string {
  try {
    const storage = getStorage();
    if (!storage) return '';
    const saved = storage.getItem(HQ_TOKEN_KEY);
    return isValidHqToken(saved) ? saved : '';
  } catch (storageError) {
    onError(storageError);
    return '';
  }
}

export interface PublishInput {
  hqToken: string;
  title: string;
  scope: ScopeLevel | null;
  scopeId: string | null;
}

export interface ValidPublishInput {
  hqToken: string;
  title: string;
  scope: ScopeLevel;
  scopeId: string;
}

export type PublishInputValidation =
  | { ok: true; value: ValidPublishInput; error: null }
  | { ok: false; value: null; error: string };

/** Validates operator input and route scope before calling the publish RPC. */
export function validatePublishInput(input: PublishInput): PublishInputValidation {
  const hqToken = input.hqToken.trim();
  if (!hqToken) return { ok: false, value: null, error: 'HQ 인증 토큰을 입력하세요.' };

  const title = input.title.trim();
  if (!title) return { ok: false, value: null, error: '공개 결과 제목을 입력하세요.' };

  const scopeId = input.scopeId?.trim() ?? '';
  if (!input.scope || !scopeId) {
    return { ok: false, value: null, error: '공개할 스코프를 먼저 선택하세요.' };
  }

  return {
    ok: true,
    value: { hqToken, title, scope: input.scope, scopeId },
    error: null,
  };
}

/** Builds an absolute public result URL on the current deployment origin. */
export function buildPublicResultUrl(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/r/${encodeURIComponent(token)}`;
}

/** Changes whenever navigation selects a different publication scope, forcing state isolation. */
export function buildPublicationScopeKey(scope: ScopeLevel | null, scopeId: string | null): string {
  return scope && scopeId ? `${scope}:${scopeId}` : 'none';
}

export interface PublishedResultExpectation {
  scope: ScopeLevel;
  scopeId: string;
  title: string;
}

export type PublicationVerification =
  | { ok: true; error: null }
  | { ok: false; error: string };

/** Verifies that result_get returns the same snapshot immediately after publication. */
export function verifyPublishedResult(
  expected: PublishedResultExpectation,
  actual: ResultPageView | null,
): PublicationVerification {
  if (!actual) {
    return { ok: false, error: '발행한 결과가 공개 경로에서 조회되지 않습니다.' };
  }
  if (actual.scope !== expected.scope || actual.scope_id !== expected.scopeId || actual.title !== expected.title) {
    return { ok: false, error: '공개 조회 결과가 요청한 스코프·제목과 일치하지 않습니다.' };
  }
  return { ok: true, error: null };
}
