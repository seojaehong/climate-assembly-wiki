export type AttendanceBaseStatus = 'unconfirmed' | 'present' | 'absent';
export type AttendanceAction = 'unconfirmed' | 'present' | 'late' | 'absent' | 'early_leave';

export type AttendanceValue = {
  base_status: AttendanceBaseStatus;
  checked_in_at: string | null;
  is_late: boolean;
  checked_out_at: string | null;
  is_early_leave: boolean;
};

export type AttendanceSummary = {
  roster_total: number;
  current_present: number;
  late: number;
  absent: number;
  early_leave: number;
  unconfirmed: number;
};

export type AttendanceErrorKind = 'expired' | 'transient';

/** 인증 만료로 확정할 수 있는 코드만 나열한다. 나머지는 전부 transient(토큰 유지). */
const AUTH_DENIED_CODES = new Set(['42501', 'PGRST301', 'PGRST302', '401', '403']);

/**
 * 출석부 RPC 실패를 '토큰을 버려야 하는 만료'와 '재시도하면 되는 일시 장애'로 가른다.
 * 인증 신호가 확실할 때만 'expired'. 네트워크·타임아웃·5xx·env 누락·알 수 없는 형태는
 * 모두 'transient'로 떨어져 sessionStorage 토큰과 기존 명단을 지킨다.
 * (SQLSTATE P0001은 'assignment outside attendance scope' 같은 업무 예외와 공유되므로 근거로 쓰지 않는다.)
 */
export function classifyAttendanceError(error: unknown): AttendanceErrorKind {
  if (error == null || typeof error !== 'object') return 'transient';
  const source = error as { message?: unknown; code?: unknown; status?: unknown };
  const message = typeof source.message === 'string' ? source.message.toLowerCase() : '';
  if (message.includes('attendance authorization')) return 'expired';
  const code = source.code == null ? '' : String(source.code).toUpperCase();
  if (AUTH_DENIED_CODES.has(code)) return 'expired';
  const status = Number(source.status);
  if (status === 401 || status === 403) return 'expired';
  return 'transient';
}

export function nextAttendanceValue(
  current: AttendanceValue,
  action: AttendanceAction,
  occurredAt: string,
): AttendanceValue {
  if (action === 'unconfirmed') {
    return {
      base_status: 'unconfirmed',
      checked_in_at: null,
      is_late: false,
      checked_out_at: null,
      is_early_leave: false,
    };
  }
  if (action === 'absent') {
    return {
      base_status: 'absent',
      checked_in_at: null,
      is_late: false,
      checked_out_at: null,
      is_early_leave: false,
    };
  }
  if (action === 'early_leave') {
    return {
      ...current,
      base_status: 'present',
      checked_in_at: current.checked_in_at ?? occurredAt,
      checked_out_at: occurredAt,
      is_early_leave: true,
    };
  }
  return {
    base_status: 'present',
    checked_in_at: occurredAt,
    is_late: action === 'late',
    checked_out_at: null,
    is_early_leave: false,
  };
}

export function attendanceSummary(rows: AttendanceValue[]): AttendanceSummary {
  return rows.reduce<AttendanceSummary>(
    (summary, row) => {
      summary.roster_total += 1;
      if (row.base_status === 'unconfirmed') summary.unconfirmed += 1;
      if (row.base_status === 'absent') summary.absent += 1;
      if (row.base_status === 'present' && row.checked_out_at == null) summary.current_present += 1;
      if (row.is_late) summary.late += 1;
      if (row.is_early_leave) summary.early_leave += 1;
      return summary;
    },
    { roster_total: 0, current_present: 0, late: 0, absent: 0, early_leave: 0, unconfirmed: 0 },
  );
}

export function isEligibleDuringRound(
  attendance: AttendanceValue,
  roundOpenedAt: string,
  roundClosedAt: string,
): boolean {
  if (attendance.base_status !== 'present' || attendance.checked_in_at == null) return false;
  const checkedIn = new Date(attendance.checked_in_at).getTime();
  const checkedOut = attendance.checked_out_at ? new Date(attendance.checked_out_at).getTime() : Number.POSITIVE_INFINITY;
  const opened = new Date(roundOpenedAt).getTime();
  const closed = new Date(roundClosedAt).getTime();
  return checkedIn <= closed && checkedOut >= opened;
}

/** 낙관적 반영이 다룰 최소 형태. AttendanceRosterRow가 이 모양을 만족한다. */
export type AttendanceStateFields = {
  base_status: AttendanceBaseStatus;
  checked_in_at: string | null;
  is_late: boolean;
  checked_out_at: string | null;
  is_early_leave: boolean;
};

/**
 * 탭한 즉시 화면에 반영할 상태를 만든다. **서버 attendance_set과 규칙이 같아야 한다**
 * (20260725_attendance_roster_hq.sql:283~305). 어긋나면 화면이 잠깐 거짓말을 하고
 * 다음 폴링에서 값이 튄다.
 *
 * 왜 필요한가: 탭 → RPC 왕복 → 명단 전체 재조회까지 기다리면 현장 와이파이에서
 * 수백 ms 동안 아무 변화가 없어 모더레이터가 두 번 누른다. 즉시 반영하고
 * 실패 시 되돌리는 편이 체감도 정확도도 낫다.
 *
 * 원본을 변형하지 않는다 — 실패했을 때 되돌릴 원본이 필요하기 때문이다.
 */
export function applyAttendanceAction<T extends AttendanceStateFields>(
  row: T,
  action: AttendanceAction,
  occurredAt: string,
): T {
  if (action === 'absent') {
    return { ...row, base_status: 'absent', checked_in_at: null, is_late: false, checked_out_at: null, is_early_leave: false };
  }
  if (action === 'early_leave') {
    // 서버는 checked_in_at을 coalesce로 보존한다 — 입장 기록이 없으면 조퇴 시각을 함께 쓴다.
    return { ...row, base_status: 'present', checked_in_at: row.checked_in_at ?? occurredAt, checked_out_at: occurredAt, is_early_leave: true };
  }
  // present · late: 입장 시각을 새로 찍고 조퇴 표시를 지운다. 지각 여부만 갈린다.
  return { ...row, base_status: 'present', checked_in_at: occurredAt, is_late: action === 'late', checked_out_at: null, is_early_leave: false };
}

/**
 * 행에 붙는 입실·퇴실 시각 표기. `오후 3:52` 형태.
 *
 * `toLocaleTimeString`을 쓰지 않는다 — 환경마다 '오후 3:52:00'·'3:52 PM'으로 갈린다.
 * 12시 표기를 0시로 쓰면 현장에서 오독하므로 12로 쓴다.
 * 값이 없거나 깨졌으면 빈 문자열이다(화면에 Invalid Date를 띄우지 않는다).
 */
export function formatCheckTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const h24 = at.getHours();
  const meridiem = h24 < 12 ? '오전' : '오후';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${meridiem} ${h12}:${String(at.getMinutes()).padStart(2, '0')}`;
}
