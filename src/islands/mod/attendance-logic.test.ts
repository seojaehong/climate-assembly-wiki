import { describe, expect, it } from 'vitest';
import {
  applyAttendanceAction,
  formatCheckTime,
  attendanceSummary,
  classifyAttendanceError,
  isEligibleDuringRound,
  mergeAttendanceRosterSnapshot,
  nextAttendanceValue,
  type AttendanceValue,
} from './attendance-logic';
import { createResourceRequestCoordinator } from './resource-request-coordinator';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

describe('applyAttendanceAction — 낙관적 반영 (서버 attendance_set과 같은 규칙)', () => {
  const base = {
    assignment_id: 'a1', member_id: 'm1', official_id: 'C-001', member_name: 'X',
    team_id: 't1', team_name: '1분과 1조', active: true,
    base_status: 'unconfirmed' as const, checked_in_at: null, is_late: false,
    checked_out_at: null, is_early_leave: false, updated_at: '2026-08-29T00:00:00Z',
  };
  const AT = '2026-08-29T01:00:00Z';

  it('출석은 지각·조퇴 표시를 모두 지우고 입장 시각을 새로 찍는다', () => {
    const r = applyAttendanceAction({ ...base, is_late: true, is_early_leave: true, checked_out_at: AT }, 'present', AT);
    expect(r.base_status).toBe('present');
    expect(r.checked_in_at).toBe(AT);
    expect(r.is_late).toBe(false);
    expect(r.checked_out_at).toBeNull();
    expect(r.is_early_leave).toBe(false);
  });

  it('지각은 출석과 같되 is_late만 켠다', () => {
    const r = applyAttendanceAction(base, 'late', AT);
    expect(r.base_status).toBe('present');
    expect(r.is_late).toBe(true);
    expect(r.checked_in_at).toBe(AT);
  });

  it('결석은 모든 시각·표시를 지운다', () => {
    const r = applyAttendanceAction({ ...base, base_status: 'present', checked_in_at: AT, is_late: true }, 'absent', AT);
    expect(r.base_status).toBe('absent');
    expect(r.checked_in_at).toBeNull();
    expect(r.is_late).toBe(false);
    expect(r.is_early_leave).toBe(false);
  });

  it('조퇴는 present를 유지하고 기존 입장 시각을 보존한다(coalesce)', () => {
    const earlier = '2026-08-29T00:30:00Z';
    const r = applyAttendanceAction({ ...base, base_status: 'present', checked_in_at: earlier }, 'early_leave', AT);
    expect(r.base_status).toBe('present');
    expect(r.checked_in_at).toBe(earlier);
    expect(r.checked_out_at).toBe(AT);
    expect(r.is_early_leave).toBe(true);
  });

  it('입장 기록 없이 조퇴하면 조퇴 시각이 입장 시각으로도 들어간다', () => {
    const r = applyAttendanceAction(base, 'early_leave', AT);
    expect(r.checked_in_at).toBe(AT);
    expect(r.checked_out_at).toBe(AT);
  });

  it('지각 후 조퇴는 두 표시가 함께 남는다 — 서버와 같은 동작', () => {
    const late = applyAttendanceAction(base, 'late', '2026-08-29T00:30:00Z');
    const r = applyAttendanceAction(late, 'early_leave', AT);
    expect(r.is_late).toBe(true);
    expect(r.is_early_leave).toBe(true);
  });

  it('원본 객체를 변형하지 않는다 — 실패 시 되돌릴 원본이 필요하다', () => {
    const original = { ...base };
    applyAttendanceAction(original, 'present', AT);
    expect(original.base_status).toBe('unconfirmed');
    expect(original.checked_in_at).toBeNull();
  });

  it('preserves optimistic pending rows when a roster snapshot was fetched before the mutation', () => {
    const optimistic = applyAttendanceAction(base, 'present', AT);
    const merged = mergeAttendanceRosterSnapshot(
      [optimistic],
      [base],
      new Set([base.assignment_id]),
    );

    expect(merged[0]).toBe(optimistic);
    expect(merged[0]?.base_status).toBe('present');
  });

  it('does not let a slow pre-mutation poll roll an optimistic success back', async () => {
    const coordinator = createResourceRequestCoordinator();
    const slowRoster = deferred<typeof base[]>();
    let rows = [base];
    const ticket = coordinator.begin('attendance:team-1', 'background');
    expect(ticket).not.toBeNull();
    const polling = (async () => {
      const next = await slowRoster.promise;
      if (ticket && coordinator.isCurrent(ticket)) {
        rows = mergeAttendanceRosterSnapshot(rows, next, new Set());
      }
      if (ticket) coordinator.finish(ticket);
    })();

    rows = [applyAttendanceAction(base, 'present', AT)];
    coordinator.invalidate();
    slowRoster.resolve([base]);
    await polling;

    expect(rows[0]?.base_status).toBe('present');
    expect(rows[0]?.checked_in_at).toBe(AT);
  });
});

describe('formatCheckTime — 행에 붙는 시각 표기', () => {
  it('오전·오후와 분을 사람이 읽는 형태로 낸다', () => {
    expect(formatCheckTime(new Date(2026, 7, 29, 15, 52).toISOString())).toBe('오후 3:52');
    expect(formatCheckTime(new Date(2026, 7, 29, 9, 5).toISOString())).toBe('오전 9:05');
  });

  it('자정과 정오를 12시로 쓴다 — 0시로 쓰면 현장에서 오독한다', () => {
    expect(formatCheckTime(new Date(2026, 7, 29, 0, 30).toISOString())).toBe('오전 12:30');
    expect(formatCheckTime(new Date(2026, 7, 29, 12, 0).toISOString())).toBe('오후 12:00');
  });

  it('값이 없거나 깨졌으면 빈 문자열 — 화면에 Invalid Date를 띄우지 않는다', () => {
    expect(formatCheckTime(null)).toBe('');
    expect(formatCheckTime('not-a-date')).toBe('');
  });
});
