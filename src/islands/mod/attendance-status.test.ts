import { describe, expect, it } from 'vitest';
import { isActionActive, statusKey, type AttendanceValue } from './attendance-logic';

function row(over: Partial<AttendanceValue> = {}): AttendanceValue {
  return {
    base_status: 'present',
    is_late: false,
    is_early_leave: false,
    checked_in_at: null,
    checked_out_at: null,
    ...over,
  } as AttendanceValue;
}

describe('statusKey — 훑을 때 눈으로 구분되게', () => {
  it('여섯 상태를 갈라낸다', () => {
    expect(statusKey(row({ base_status: 'unconfirmed' }))).toBe('unconfirmed');
    expect(statusKey(row({ base_status: 'absent' }))).toBe('absent');
    expect(statusKey(row())).toBe('present');
    expect(statusKey(row({ is_late: true }))).toBe('late');
    expect(statusKey(row({ is_early_leave: true }))).toBe('early_leave');
    expect(statusKey(row({ is_late: true, is_early_leave: true }))).toBe('late_early');
  });

  it('★ 미확인이 결석과 섞이지 않는다 — 아직 안 본 사람과 안 온 사람은 다르다', () => {
    expect(statusKey(row({ base_status: 'unconfirmed' }))).not.toBe(
      statusKey(row({ base_status: 'absent' })),
    );
  });
});

describe('isActionActive — 지금 눌린 버튼', () => {
  it('상태마다 해당 버튼 하나가 켜진다', () => {
    expect(isActionActive(row(), 'present')).toBe(true);
    expect(isActionActive(row(), 'late')).toBe(false);
    expect(isActionActive(row({ base_status: 'absent' }), 'absent')).toBe(true);
    expect(isActionActive(row({ base_status: 'unconfirmed' }), 'unconfirmed')).toBe(true);
  });

  it('★ 「지각 · 조퇴」는 두 버튼이 함께 켜진다', () => {
    const both = row({ is_late: true, is_early_leave: true });
    expect(isActionActive(both, 'late')).toBe(true);
    expect(isActionActive(both, 'early_leave')).toBe(true);
    expect(isActionActive(both, 'present')).toBe(false);
  });

  it('미확인일 때는 상태 버튼 넷 중 어느 것도 켜지지 않는다', () => {
    const u = row({ base_status: 'unconfirmed' });
    for (const a of ['present', 'late', 'absent', 'early_leave'] as const) {
      expect(isActionActive(u, a)).toBe(false);
    }
  });
});
