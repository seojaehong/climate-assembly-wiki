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
