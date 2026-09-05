import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HQ_ACTOR_KEY,
  HQ_NEW_PASSWORD_MAX_BYTES,
  HQ_NEW_PASSWORD_MIN_CHARACTERS,
  HQ_TOKEN_KEY,
  HQ_UNLOCK_LOCK_MINUTES,
  HQ_UNLOCK_MAX_ATTEMPTS,
  classifyHqAuthorizationError,
  gateFailureMessage,
  isValidHqToken,
  normalizeActorLabel,
  utf8ByteLength,
  validateHqNewPassword,
} from './hq-gate-logic';

const hqGateSource = readFileSync(new URL('./HqGate.tsx', import.meta.url), 'utf8');

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

  it('잠금 정책 상수는 named HQ unlock 정책과 일치한다', () => {
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

describe('validateHqNewPassword', () => {
  it('ASCII 72바이트는 허용하고 73바이트는 저장 전 거부한다', () => {
    const atLimit = 'a'.repeat(HQ_NEW_PASSWORD_MAX_BYTES);
    const overLimit = `${atLimit}a`;

    expect(utf8ByteLength(atLimit)).toBe(72);
    expect(validateHqNewPassword(atLimit, atLimit)).toBeNull();
    expect(utf8ByteLength(overLimit)).toBe(73);
    expect(validateHqNewPassword(overLimit, overLimit)).toContain('72바이트');
  });

  it('UTF-8 다중 바이트 문자도 72/73바이트 경계로 판단한다', () => {
    const atLimit = '가'.repeat(24);
    const overLimit = `${atLimit}a`;

    expect(utf8ByteLength(atLimit)).toBe(72);
    expect(validateHqNewPassword(atLimit, atLimit)).toBeNull();
    expect(utf8ByteLength(overLimit)).toBe(73);
    expect(validateHqNewPassword(overLimit, overLimit)).toContain('72바이트');
  });

  it('확인 불일치와 최소 길이를 서로 다른 안내로 거부한다', () => {
    expect(validateHqNewPassword('abcdefgh', 'abcdefgi')).toContain('서로 다릅니다');
    expect(validateHqNewPassword('abcdefg', 'abcdefg')).toContain(
      `${HQ_NEW_PASSWORD_MIN_CHARACTERS}자 이상`,
    );
  });

  it('새 비밀번호 두 입력만 maxlength를 적용하고 현재 비밀번호는 legacy 복구를 위해 제한하지 않는다', () => {
    expect(hqGateSource.match(/maxLength=\{HQ_NEW_PASSWORD_MAX_BYTES\}/g)).toHaveLength(2);

    const currentInputStart = hqGateSource.indexOf('ref={currentPasswordRef}');
    const newInputStart = hqGateSource.indexOf('autoComplete="new-password"', currentInputStart);
    expect(currentInputStart).toBeGreaterThan(-1);
    expect(newInputStart).toBeGreaterThan(currentInputStart);
    expect(hqGateSource.slice(currentInputStart, newInputStart)).not.toContain('maxLength=');
  });
});

describe('classifyHqAuthorizationError', () => {
  it('확정적인 HQ bearer 만료/폐기 응답만 expired로 분류한다', () => {
    expect(classifyHqAuthorizationError({ message: 'workshop authorization expired or revoked' }))
      .toBe('expired');
    expect(classifyHqAuthorizationError(new Error('P0001: workshop authorization expired or revoked')))
      .toBe('expired');
    expect(classifyHqAuthorizationError(new Error('active named HQ authorization required')))
      .toBe('expired');
    expect(classifyHqAuthorizationError(new Error('P0001: HQ authorization session mismatch')))
      .toBe('expired');
    expect(classifyHqAuthorizationError({ message: 'attendance authorization expired' }))
      .toBe('expired');
  });

  it('HQ 용도로 사용할 수 없음이 확정된 scope/required 응답도 expired로 분류한다', () => {
    expect(classifyHqAuthorizationError(new Error('HQ authorization required'))).toBe('expired');
    expect(classifyHqAuthorizationError(new Error('workshop authorization required'))).toBe('expired');
    expect(classifyHqAuthorizationError(new Error('attendance authorization required'))).toBe('expired');
  });

  it('네트워크·timeout·5xx·ACL·함수 미적용·알 수 없는 오류에는 토큰을 보존한다', () => {
    const transientErrors: unknown[] = [
      new Error('Failed to fetch'),
      new Error('request timeout'),
      new Error('PGRST202: Could not find the function'),
      { code: '42501', message: 'permission denied for function workshop_hq_status' },
      { status: 403, message: 'Forbidden' },
      { status: 503, message: 'Service unavailable' },
      'workshop authorization expired or revoked',
      null,
    ];
    for (const error of transientErrors) {
      expect(classifyHqAuthorizationError(error)).toBe('transient');
    }
  });

  it('문구 일부가 우연히 포함된 업무 오류를 만료로 오인하지 않는다', () => {
    expect(classifyHqAuthorizationError(
      new Error('audit note says workshop authorization expired or revoked yesterday'),
    )).toBe('transient');
    expect(classifyHqAuthorizationError(
      new Error('P0001: active named HQ authorization required for export review'),
    )).toBe('transient');
  });
});
