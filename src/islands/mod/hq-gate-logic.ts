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

/** 서버측 attendance_hq_unlock RPC의 rate limit 정책(5회 실패 → 15분 잠금)과 맞춘 안내 상수. */
export const HQ_UNLOCK_MAX_ATTEMPTS = 5;
export const HQ_UNLOCK_LOCK_MINUTES = 15;

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
