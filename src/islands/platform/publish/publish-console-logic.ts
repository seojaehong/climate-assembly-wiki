import type { ScopeLevel } from '../platform-nav-logic';
import type { ResultPageView } from '../../../lib/platform';
import { HQ_TOKEN_KEY, isValidHqToken } from '../../mod/hq-gate-logic';

export interface TokenStorage {
  getItem(key: string): string | null;
}

export interface PublicationOperationLock {
  current: boolean;
}

export type PublicationOperationResult<T> =
  | { started: false; value: null }
  | { started: true; value: T };

/** Acquires a synchronous lock before the first await so rapid clicks cannot duplicate a mutation. */
export async function runExclusivePublicationOperation<T>(
  lock: PublicationOperationLock,
  action: () => Promise<T>,
  onBusyChange: (busy: boolean) => void,
): Promise<PublicationOperationResult<T>> {
  if (lock.current) return { started: false, value: null };
  lock.current = true;
  onBusyChange(true);
  try {
    return { started: true, value: await action() };
  } finally {
    lock.current = false;
    onBusyChange(false);
  }
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

const PUBLIC_RESULT_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export type PublicResultTokenValidation =
  | { ok: true; token: string; error: null }
  | { ok: false; token: null; error: string };

/** Accepts a canonical token or a same-origin /r/<token> URL without forwarding arbitrary URLs. */
export function parsePublicResultToken(input: string, currentOrigin: string): PublicResultTokenValidation {
  const normalized = input.trim();
  const directToken = normalized.toLowerCase();
  if (PUBLIC_RESULT_TOKEN_PATTERN.test(directToken)) return { ok: true, token: directToken, error: null };

  let candidate: URL;
  let origin: URL;
  try {
    candidate = new URL(normalized);
    origin = new URL(currentOrigin);
  } catch {
    return { ok: false, token: null, error: '공개 결과 토큰 또는 URL 형식을 확인해 주세요.' };
  }
  if (candidate.origin !== origin.origin || candidate.username || candidate.password) {
    return { ok: false, token: null, error: '현재 사이트의 공개 결과 URL만 사용할 수 있습니다.' };
  }
  if (candidate.search || candidate.hash) {
    return { ok: false, token: null, error: '공개 결과 URL 형식을 확인해 주세요.' };
  }
  const match = candidate.pathname.match(/^\/r\/([0-9a-f]{32})\/?$/i);
  if (!match) return { ok: false, token: null, error: '공개 결과 토큰 또는 URL 형식을 확인해 주세요.' };
  return { ok: true, token: match[1].toLowerCase(), error: null };
}

export interface AttachedPublication {
  id: null;
  token: string;
  title: string;
  url: string;
  publishedAt: string;
  reviewedCount: number;
  verified: true;
  body: unknown;
}

/** Converts a public read into editor state only when it belongs to the selected platform scope. */
export function buildAttachedPublication(
  token: string,
  origin: string,
  scope: ScopeLevel | null,
  scopeId: string | null,
  actual: ResultPageView | null,
): AttachedPublication {
  if (!scope || !scopeId) throw new Error('기존 결과를 불러올 스코프를 먼저 선택해 주세요.');
  if (!actual) throw new Error('공개 결과가 조회되지 않습니다.');
  if (actual.scope !== scope || actual.scope_id !== scopeId) {
    throw new Error('공개 결과가 현재 선택한 스코프와 일치하지 않습니다.');
  }
  const title = actual.title.trim();
  if (!title) throw new Error('공개 결과 제목을 확인할 수 없습니다.');
  const publishedAt = new Date(actual.published_at);
  if (Number.isNaN(publishedAt.getTime())) throw new Error('공개 결과 발행 시각을 확인할 수 없습니다.');
  const body = typeof actual.body === 'object' && actual.body !== null ? actual.body as Record<string, unknown> : {};
  const reviewedCount = body.reviewed_count;
  if (!Number.isSafeInteger(reviewedCount) || (reviewedCount as number) < 0) {
    throw new Error('공개 결과의 검수 완료 건수를 확인할 수 없습니다.');
  }
  return {
    id: null,
    token,
    title,
    url: buildPublicResultUrl(token, origin),
    publishedAt: actual.published_at,
    reviewedCount: reviewedCount as number,
    verified: true,
    body: actual.body,
  };
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
