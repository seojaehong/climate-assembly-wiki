import { describe, expect, it } from 'vitest';
import {
  attendanceSummary,
  classifyAttendanceError,
  isEligibleDuringRound,
  nextAttendanceValue,
  type AttendanceValue,
} from './attendance-logic';

const unconfirmed: AttendanceValue = {
  base_status: 'unconfirmed',
  checked_in_at: null,
  is_late: false,
  checked_out_at: null,
  is_early_leave: false,
};

describe('nextAttendanceValue', () => {
  it('지각은 출석 상태와 입실 시각을 함께 기록한다', () => {
    expect(nextAttendanceValue(unconfirmed, 'late', '2026-08-29T01:12:00.000Z')).toEqual({
      base_status: 'present',
      checked_in_at: '2026-08-29T01:12:00.000Z',
      is_late: true,
      checked_out_at: null,
      is_early_leave: false,
    });
  });

  it('지각 뒤 조퇴를 기록해 두 상태를 동시에 보존한다', () => {
    const late = nextAttendanceValue(unconfirmed, 'late', '2026-08-29T01:12:00.000Z');
    expect(nextAttendanceValue(late, 'early_leave', '2026-08-29T06:30:00.000Z')).toEqual({
      ...late,
      checked_out_at: '2026-08-29T06:30:00.000Z',
      is_early_leave: true,
    });
  });

  it('결석 처리 시 재실 시간과 지각·조퇴 표식을 제거한다', () => {
    const lateAndLeft: AttendanceValue = {
      base_status: 'present',
      checked_in_at: '2026-08-29T01:12:00.000Z',
      is_late: true,
      checked_out_at: '2026-08-29T06:30:00.000Z',
      is_early_leave: true,
    };
    expect(nextAttendanceValue(lateAndLeft, 'absent', '2026-08-29T02:00:00.000Z')).toEqual({
      base_status: 'absent',
      checked_in_at: null,
      is_late: false,
      checked_out_at: null,
      is_early_leave: false,
    });
  });
});

describe('attendanceSummary', () => {
  it('현재 출석과 지각·결석·조퇴·미확인을 별도로 집계한다', () => {
    const rows: AttendanceValue[] = [
      nextAttendanceValue(unconfirmed, 'present', '2026-08-29T01:00:00.000Z'),
      nextAttendanceValue(
        nextAttendanceValue(unconfirmed, 'late', '2026-08-29T01:15:00.000Z'),
        'early_leave',
        '2026-08-29T06:00:00.000Z',
      ),
      nextAttendanceValue(unconfirmed, 'absent', '2026-08-29T01:00:00.000Z'),
      unconfirmed,
    ];

    expect(attendanceSummary(rows)).toEqual({
      roster_total: 4,
      current_present: 1,
      late: 1,
      absent: 1,
      early_leave: 1,
      unconfirmed: 1,
    });
  });
});

describe('isEligibleDuringRound', () => {
  it('재실 시간이 라운드와 겹치면 조퇴 후에도 해당 라운드 분모에 포함한다', () => {
    expect(
      isEligibleDuringRound(
        {
          base_status: 'present',
          checked_in_at: '2026-08-29T01:15:00.000Z',
          is_late: true,
          checked_out_at: '2026-08-29T02:00:00.000Z',
          is_early_leave: true,
        },
        '2026-08-29T01:30:00.000Z',
        '2026-08-29T02:30:00.000Z',
      ),
    ).toBe(true);
  });

  it('입실 전 끝난 라운드와 결석자는 제외한다', () => {
    const present = nextAttendanceValue(unconfirmed, 'present', '2026-08-29T03:00:00.000Z');
    const absent = nextAttendanceValue(unconfirmed, 'absent', '2026-08-29T01:00:00.000Z');
    expect(isEligibleDuringRound(present, '2026-08-29T01:00:00.000Z', '2026-08-29T02:00:00.000Z')).toBe(false);
    expect(isEligibleDuringRound(absent, '2026-08-29T01:00:00.000Z', '2026-08-29T02:00:00.000Z')).toBe(false);
  });
});

describe('classifyAttendanceError', () => {
  it('토큰 만료 RPC 예외는 expired로 분류한다', () => {
    expect(classifyAttendanceError({ message: 'attendance authorization expired', code: 'P0001' })).toBe('expired');
  });

  it('토큰 누락 RPC 예외도 expired로 분류한다', () => {
    expect(classifyAttendanceError({ message: 'attendance authorization required', code: 'P0001' })).toBe('expired');
  });

  it('권한 거부 계열 코드는 expired로 분류한다', () => {
    expect(classifyAttendanceError({ message: 'permission denied for function', code: '42501' })).toBe('expired');
    expect(classifyAttendanceError({ message: 'JWT expired', code: 'PGRST301' })).toBe('expired');
    expect(classifyAttendanceError({ message: 'Forbidden', status: 403 })).toBe('expired');
  });

  it('같은 P0001이라도 인증과 무관한 예외는 transient다', () => {
    expect(classifyAttendanceError({ message: 'assignment outside attendance scope', code: 'P0001' })).toBe('transient');
    expect(classifyAttendanceError({ message: 'invalid attendance action', code: 'P0001' })).toBe('transient');
  });

  it('네트워크·타임아웃 오류는 transient다', () => {
    expect(classifyAttendanceError(new TypeError('Failed to fetch'))).toBe('transient');
    expect(classifyAttendanceError({ message: 'AbortError: signal timed out', name: 'AbortError' })).toBe('transient');
  });

  it('5xx 응답은 transient다', () => {
    expect(classifyAttendanceError({ message: 'Bad Gateway', status: 502 })).toBe('transient');
    expect(classifyAttendanceError({ message: 'Service Unavailable', status: 503 })).toBe('transient');
  });

  it('env 누락 오류는 transient다', () => {
    expect(classifyAttendanceError(new Error('Supabase client unavailable (missing env)'))).toBe('transient');
  });

  it('알 수 없는 형태는 안전한 쪽(transient)으로 떨어진다', () => {
    expect(classifyAttendanceError(null)).toBe('transient');
    expect(classifyAttendanceError(undefined)).toBe('transient');
    expect(classifyAttendanceError('attendance authorization expired')).toBe('transient');
    expect(classifyAttendanceError({})).toBe('transient');
  });
});
