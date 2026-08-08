import { describe, expect, it } from 'vitest';
import {
  HQ_ACTOR_KEY,
  HQ_TOKEN_KEY,
  HQ_UNLOCK_LOCK_MINUTES,
  HQ_UNLOCK_MAX_ATTEMPTS,
  gateFailureMessage,
  isValidHqToken,
  normalizeActorLabel,
} from './hq-gate-logic';

describe('HQ_TOKEN_KEY', () => {
  it('HqAttendanceAdmin의 TOKEN_KEY와 동일한 키를 공유한다(이중 로그인 방지의 전제)', () => {
    expect(HQ_TOKEN_KEY).toBe('climate_vote_hq_attendance_token');
  });

  it('운영자명 키는 토큰 키와 다른 키를 쓴다(토큰 복원 경로 오염 금지)', () => {
    expect(HQ_ACTOR_KEY).not.toBe(HQ_TOKEN_KEY);
  });
});

describe('isValidHqToken', () => {
  it('비어 있지 않은 문자열 토큰만 통과시킨다', () => {
    expect(isValidHqToken('token-abc')).toBe(true);
  });

  it('null(저장된 토큰 없음)은 거부한다', () => {
    expect(isValidHqToken(null)).toBe(false);
  });

  it('빈 문자열·공백만 있는 값은 거부한다', () => {
    expect(isValidHqToken('')).toBe(false);
    expect(isValidHqToken('   ')).toBe(false);
  });

  it('문자열이 아닌 값(undefined·숫자·객체)은 거부한다', () => {
    expect(isValidHqToken(undefined)).toBe(false);
    expect(isValidHqToken(123)).toBe(false);
    expect(isValidHqToken({ token: 'x' })).toBe(false);
  });
});

describe('gateFailureMessage', () => {
  it('잘못된 비밀번호에는 서버 잠금 정책(5회/15분)을 함께 안내한다', () => {
    const message = gateFailureMessage('wrong-password');
    expect(message).toContain('비밀번호가 올바르지 않습니다');
    expect(message).toContain(`${HQ_UNLOCK_MAX_ATTEMPTS}회`);
    expect(message).toContain(`${HQ_UNLOCK_LOCK_MINUTES}분`);
  });

  it('입력 누락과 요청 실패는 각각 다른 문구를 낸다', () => {
    expect(gateFailureMessage('missing-input')).toContain('모두 입력');
    expect(gateFailureMessage('request-failed')).toContain('처리하지 못했습니다');
    expect(gateFailureMessage('missing-input')).not.toBe(gateFailureMessage('request-failed'));
  });

  it('잠금 정책 상수는 attendance_hq_unlock RPC 정책과 일치한다', () => {
    expect(HQ_UNLOCK_MAX_ATTEMPTS).toBe(5);
    expect(HQ_UNLOCK_LOCK_MINUTES).toBe(15);
  });
});

describe('normalizeActorLabel', () => {
  it('앞뒤 공백을 제거한다', () => {
    expect(normalizeActorLabel('  본부 운영자  ')).toBe('본부 운영자');
  });

  it('공백만 있는 입력은 빈 문자열(입력 누락)이 된다', () => {
    expect(normalizeActorLabel('   ')).toBe('');
  });
});
