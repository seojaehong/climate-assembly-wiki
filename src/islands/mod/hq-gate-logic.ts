/**
 * /hq 본부 게이트의 순수 로직 — 토큰 유효성 판단·실패 메시지 생성.
 * React·storage 의존이 없어 vitest로 그대로 검증한다(hq-gate-logic.test.ts).
 */

/**
 * HqAttendanceAdmin.tsx의 TOKEN_KEY와 반드시 같은 값이어야 한다.
 * 게이트가 이 키에 토큰을 심으면 안쪽 출석 관리(HqAttendanceAdmin)의
 * useEffect 복원 경로가 그대로 통과해 이중 로그인이 생기지 않는다.
 */
export const HQ_TOKEN_KEY = 'climate_vote_hq_attendance_token';

/** 로그인 바에 표시할 운영자명 보관 키(게이트 전용 — 출석 관리는 이 키를 읽지 않는다). */
export const HQ_ACTOR_KEY = 'climate_vote_hq_gate_actor';

/** 서버측 named HQ unlock의 rate-limit 정책과 맞춘 안내 상수. */
export const HQ_UNLOCK_MAX_ATTEMPTS = 5;
export const HQ_UNLOCK_LOCK_MINUTES = 15;

/** PostgreSQL pgcrypto bcrypt accepts at most 72 UTF-8 bytes. */
export const HQ_NEW_PASSWORD_MAX_BYTES = 72;
export const HQ_NEW_PASSWORD_MIN_CHARACTERS = 8;

/** Return the encoded byte length used by the server-side octet_length guard. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/**
 * Validate a new HQ password before sending it to the password-rotation RPC.
 * The current password is deliberately not checked here: an existing legacy
 * credential must remain enterable even when it predates the new bcrypt limit.
 */
export function validateHqNewPassword(
  password: string,
  confirmation: string,
): string | null {
  if (password !== confirmation) {
    return '새 비밀번호 두 칸이 서로 다릅니다.';
  }
  if (Array.from(password).length < HQ_NEW_PASSWORD_MIN_CHARACTERS) {
    return `새 비밀번호는 ${HQ_NEW_PASSWORD_MIN_CHARACTERS}자 이상이어야 합니다.`;
  }
  if (utf8ByteLength(password) > HQ_NEW_PASSWORD_MAX_BYTES) {
    return `새 비밀번호는 UTF-8 기준 ${HQ_NEW_PASSWORD_MAX_BYTES}바이트 이하로 입력해 주세요.`;
  }
  return null;
}

/** sessionStorage에서 읽은 값이 통과 가능한 HQ 토큰인지 판단한다. */
export function isValidHqToken(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export type GateFailure = 'missing-input' | 'wrong-password' | 'request-failed';

/** 실패 종류별 안내 문구. 잘못된 비밀번호에는 서버 잠금 정책을 함께 안내한다. */
export function gateFailureMessage(kind: GateFailure): string {
  switch (kind) {
    case 'missing-input':
      return '운영자 이름과 본부 비밀번호를 모두 입력해 주세요.';
    case 'wrong-password':
      return `비밀번호가 올바르지 않습니다 (${HQ_UNLOCK_MAX_ATTEMPTS}회 실패 시 ${HQ_UNLOCK_LOCK_MINUTES}분 잠금).`;
    case 'request-failed':
      return '로그인 요청을 처리하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
  }
}

/** 운영자 표시 이름 정규화 — 앞뒤 공백 제거. 빈 문자열이면 입력 누락으로 취급한다. */
export function normalizeActorLabel(value: string): string {
  return value.trim();
}

export type HqAuthorizationErrorKind = 'expired' | 'transient';

/**
 * Decide whether an HQ RPC proved that the locally cached bearer is unusable.
 *
 * The bearer is deliberately retained for transport failures, 5xx responses,
 * missing migrations, and ACL mistakes. Clearing it for those failures would
 * turn a recoverable venue-network problem into a forced login. Conversely,
 * the exact server authorization messages below can only be produced after an
 * RPC has rejected the bearer or its bound operator/session.
 */
export function classifyHqAuthorizationError(error: unknown): HqAuthorizationErrorKind {
  if (error == null || typeof error !== 'object') return 'transient';
  const source = error as { message?: unknown };
  if (typeof source.message !== 'string') return 'transient';
  const message = source.message.trim();
  return /^(?:[A-Z0-9]+:\s*)?(?:workshop authorization (?:required|expired or revoked)|active named HQ authorization required|HQ authorization (?:required|session mismatch)|attendance authorization (?:required|expired|session mismatch))$/i.test(message)
    ? 'expired'
    : 'transient';
}
