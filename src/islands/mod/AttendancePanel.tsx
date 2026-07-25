import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bulkPresent,
  fetchAttendanceRoster,
  finalizeAbsent,
  saveRosterMember,
  setAttendance,
  unlockTeamAttendance,
  type AttendanceRosterRow,
} from '../../lib/attendance';
import { attendanceSummary, classifyAttendanceError, type AttendanceAction } from './attendance-logic';

function localDateTimeNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function statusLabel(row: AttendanceRosterRow): string {
  if (row.base_status === 'unconfirmed') return '미확인';
  if (row.base_status === 'absent') return '결석';
  if (row.is_late && row.is_early_leave) return '지각 · 조퇴';
  if (row.is_early_leave) return '조퇴';
  if (row.is_late) return '지각';
  return '출석';
}

export default function AttendancePanel({
  teamId,
  teamName,
  joinCode,
}: {
  teamId: string;
  teamName: string;
  joinCode: string | null;
}) {
  const tokenKey = `attendance_team_token:${teamId}`;
  const [token, setToken] = useState<string | null>(() =>
    typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(tokenKey),
  );
  const [pin, setPin] = useState('');
  const [rows, setRows] = useState<AttendanceRosterRow[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timeEdit, setTimeEdit] = useState<{ row: AttendanceRosterRow; action: 'late' | 'early_leave' } | null>(null);
  const [timeValue, setTimeValue] = useState(localDateTimeNow);
  const [memberEdit, setMemberEdit] = useState<AttendanceRosterRow | null>(null);
  const [memberId, setMemberId] = useState('');
  const [memberName, setMemberName] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const next = await fetchAttendanceRoster(token);
      setRows(next);
      setMessage(null);
      setLoadError(null);
    } catch (error) {
      console.error('[attendance] team roster load failed', error);
      if (classifyAttendanceError(error) === 'transient') {
        // 네트워크 순단·5xx: 토큰과 기존 명단을 그대로 두고 15초 뒤 자동 재시도한다.
        setLoadError('연결이 잠시 끊겼습니다. 출석부는 그대로 유지됩니다. 15초마다 자동으로 다시 연결하니 그대로 계속 체크하세요.');
        return;
      }
      sessionStorage.removeItem(tokenKey);
      setToken(null);
      setRows([]);
      setLoadError(null);
      setMessage('출석부 잠금이 만료되었습니다. PIN을 다시 입력해 주세요.');
    }
  }, [token, tokenKey]);

  useEffect(() => {
    void load();
    if (!token) return;
    const interval = setInterval(() => void load(), 15_000);
    return () => clearInterval(interval);
  }, [load, token]);

  const activeRows = rows.filter((row) => row.active);
  const summary = attendanceSummary(activeRows);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ko-KR');
    if (!query) return activeRows;
    return activeRows.filter(
      (row) => row.member_name.toLocaleLowerCase('ko-KR').includes(query) || row.official_id.includes(query),
    );
  }, [activeRows, search]);

  const unlock = async () => {
    if (!joinCode || !/^\d{6,10}$/.test(pin)) return;
    setBusy(true);
    try {
      const nextToken = await unlockTeamAttendance(joinCode, pin);
      if (!nextToken) {
        setMessage('PIN이 올바르지 않거나 잠시 잠겼습니다.');
        return;
      }
      sessionStorage.setItem(tokenKey, nextToken);
      setToken(nextToken);
      setPin('');
      setMessage('출석부 잠금이 해제되었습니다.');
    } catch (error) {
      console.error('[attendance] team unlock failed', error);
      setMessage('출석부 연결에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (row: AttendanceRosterRow, action: AttendanceAction, occurredAt?: string) => {
    if (!token) return;
    setBusy(true);
    try {
      await setAttendance(token, row.assignment_id, action, occurredAt);
      await load();
      setMessage(`${row.member_name} · ${action === 'present' ? '출석' : action === 'absent' ? '결석' : action === 'late' ? '지각' : '조퇴'} 저장`);
    } catch (error) {
      console.error('[attendance] status update failed', error);
      setMessage('출석 상태를 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const saveTimeAction = async () => {
    if (!timeEdit || !timeValue) return;
    await runAction(timeEdit.row, timeEdit.action, new Date(timeValue).toISOString());
    setTimeEdit(null);
  };

  const saveMember = async () => {
    if (!token || !memberId.trim() || !memberName.trim()) return;
    setBusy(true);
    try {
      await saveRosterMember(token, {
        assignmentId: memberEdit?.assignment_id,
        officialId: memberId.trim(),
        name: memberName.trim(),
        active: true,
      });
      setMemberEdit(null);
      setMemberId('');
      setMemberName('');
      await load();
      setMessage('명단을 저장했습니다.');
    } catch (error) {
      console.error('[attendance] member save failed', error);
      setMessage('명단을 저장하지 못했습니다. ID 중복 여부를 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <section className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 bg-[#4F9D3A]/8 border-b border-[#DCE7EE]">
          <span className="w-11 h-11 rounded-xl bg-[#4F9D3A] grid place-items-center text-white text-xl" aria-hidden="true">✓</span>
          <div>
            <h3 className="text-[22px] font-extrabold text-[#1F4E79]">출석 체크</h3>
            <p className="text-[13px] text-[#5A6B73]">{teamName} 실명 명단은 별도 PIN으로 보호됩니다.</p>
          </div>
        </div>
        <div className="p-6">
          <label htmlFor="attendance-pin" className="block text-[13px] font-bold text-[#5A6B73] mb-2">출석부 운영 PIN</label>
          <div className="flex gap-2">
            <input
              id="attendance-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 10))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void unlock();
              }}
              className="min-w-0 flex-1 h-14 rounded-xl border border-[#C4D8E4] px-4 text-[20px] tracking-[.2em] outline-none focus:border-[#4F9D3A]"
            />
            <button type="button" onClick={() => void unlock()} disabled={busy || pin.length < 6} className="min-h-14 rounded-xl bg-[#1F4E79] px-5 text-white font-bold disabled:opacity-40">
              열기
            </button>
          </div>
          {message ? <p className="mt-3 text-[14px] text-[#8B1A1A]" role="status">{message}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="lg:col-span-2 rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-[#4F9D3A]/8 border-b border-[#DCE7EE]">
        <div>
          <h3 className="text-[22px] font-extrabold text-[#1F4E79]">출석 체크 · {teamName}</h3>
          <p className="text-[13px] text-[#5A6B73]">지각과 조퇴는 동시에 기록할 수 있습니다.</p>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-[#9CB7C8] bg-white px-3 text-[13px] font-bold text-[#1F4E79]"
          onClick={() => {
            sessionStorage.removeItem(tokenKey);
            setToken(null);
            setRows([]);
          }}
        >
          출석부 잠금
        </button>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            ['현재 출석', summary.current_present],
            ['전체', summary.roster_total],
            ['지각', summary.late],
            ['결석', summary.absent],
            ['조퇴', summary.early_leave],
            ['미확인', summary.unconfirmed],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-[#F1F7FA] px-3 py-2 text-center">
              <div className="text-[12px] font-bold text-[#5A6B73]">{label}</div>
              <div className="text-[24px] font-extrabold text-[#1F4E79] tr-num">{value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름 또는 ID 검색" className="min-h-12 min-w-[220px] flex-1 rounded-xl border border-[#C4D8E4] px-4 outline-none focus:border-[#23B2C3]" />
          <button
            type="button"
            className="min-h-12 rounded-xl border border-[#1F4E79] px-4 font-bold text-[#1F4E79] disabled:opacity-40"
            disabled={selected.length === 0 || busy}
            onClick={async () => {
              if (!token) return;
              setBusy(true);
              try {
                const count = await bulkPresent(token, selected);
                setSelected([]);
                await load();
                setMessage(`${count}명을 출석 처리했습니다.`);
              } catch (error) {
                console.error('[attendance] bulk present failed', error);
                setMessage('일괄 출석 처리에 실패했습니다.');
              } finally {
                setBusy(false);
              }
            }}
          >
            선택 출석 ({selected.length})
          </button>
          <button
            type="button"
            className="min-h-12 rounded-xl border border-[#9CB7C8] px-4 font-bold text-[#1F4E79]"
            onClick={() => {
              setMemberEdit(null);
              setMemberId('');
              setMemberName('');
            }}
          >
            명단 추가
          </button>
        </div>

        {loadError ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3" role="status">
            <span className="text-[16px] font-extrabold text-[#B5651D] flex-1 min-w-[200px]">{loadError}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="min-h-11 rounded-lg border-2 border-[#B5651D] px-4 text-[15px] font-bold text-[#B5651D]"
            >
              지금 다시 시도
            </button>
          </div>
        ) : null}

        {message ? <div className="rounded-lg bg-[#F1F7FA] px-3 py-2 text-[14px] font-semibold text-[#135C73]" role="status">{message}</div> : null}

        <div className="rounded-xl border border-[#DCE7EE] p-3">
          <div className="grid sm:grid-cols-[130px_1fr_auto] gap-2">
            <input value={memberId} onChange={(event) => setMemberId(event.target.value.slice(0, 40))} placeholder="공식 ID" className="min-h-11 rounded-lg border border-[#C4D8E4] px-3" />
            <input value={memberName} onChange={(event) => setMemberName(event.target.value.slice(0, 100))} placeholder="이름" className="min-h-11 rounded-lg border border-[#C4D8E4] px-3" />
            <button type="button" onClick={() => void saveMember()} disabled={busy || !memberId.trim() || !memberName.trim()} className="min-h-11 rounded-lg bg-[#1F4E79] px-4 text-white font-bold disabled:opacity-40">
              {memberEdit ? '정정 저장' : '추가'}
            </button>
          </div>
        </div>

        {timeEdit ? (
          <div className="rounded-xl border-2 border-[#23B2C3] bg-[#F2FCFD] p-4">
            <div className="font-extrabold text-[#1F4E79]">{timeEdit.row.member_name} · {timeEdit.action === 'late' ? '입실' : '퇴실'} 시각</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input type="datetime-local" value={timeValue} onChange={(event) => setTimeValue(event.target.value)} className="min-h-12 rounded-lg border border-[#9CB7C8] px-3" />
              <button type="button" onClick={() => void saveTimeAction()} className="min-h-12 rounded-lg bg-[#23B2C3] px-4 text-white font-bold">저장</button>
              <button type="button" onClick={() => setTimeEdit(null)} className="min-h-12 rounded-lg border border-[#9CB7C8] px-4 font-bold">취소</button>
            </div>
          </div>
        ) : null}

        <div className="max-h-[520px] overflow-y-auto rounded-xl border border-[#DCE7EE]">
          {visibleRows.map((row) => (
            <div key={row.assignment_id} className="border-b border-[#E6EBF3] p-3 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(row.assignment_id)}
                  aria-label={`${row.member_name} 선택`}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, row.assignment_id]
                        : current.filter((id) => id !== row.assignment_id),
                    )
                  }
                  className="h-5 w-5"
                />
                <div className="min-w-[130px] flex-1">
                  <span className="font-extrabold text-[#1F2933]">{row.member_name}</span>
                  <span className="ml-2 text-[13px] font-mono text-[#5A6B73]">#{row.official_id}</span>
                </div>
                <span className="rounded-full bg-[#EEF4F8] px-3 py-1 text-[13px] font-bold text-[#1F4E79]">{statusLabel(row)}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 pl-7">
                <button type="button" onClick={() => void runAction(row, 'present')} className="min-h-10 rounded-lg bg-[#4F9D3A] px-3 text-[13px] font-bold text-white">출석</button>
                <button type="button" onClick={() => { setTimeEdit({ row, action: 'late' }); setTimeValue(localDateTimeNow()); }} className="min-h-10 rounded-lg bg-[#F5A623] px-3 text-[13px] font-bold text-white">지각</button>
                <button type="button" onClick={() => void runAction(row, 'absent')} className="min-h-10 rounded-lg bg-[#DC2626] px-3 text-[13px] font-bold text-white">결석</button>
                <button type="button" onClick={() => { setTimeEdit({ row, action: 'early_leave' }); setTimeValue(localDateTimeNow()); }} className="min-h-10 rounded-lg bg-[#2E75B6] px-3 text-[13px] font-bold text-white">조퇴</button>
                <button type="button" onClick={() => { setMemberEdit(row); setMemberId(row.official_id); setMemberName(row.member_name); }} className="min-h-10 rounded-lg border border-[#9CB7C8] px-3 text-[13px] font-bold text-[#1F4E79]">명단 정정</button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!token || !window.confirm(`${row.member_name} 님을 이 조 명단에서 비활성화할까요?`)) return;
                    setBusy(true);
                    try {
                      await saveRosterMember(token, { assignmentId: row.assignment_id, officialId: row.official_id, name: row.member_name, active: false });
                      await load();
                      setMessage(`${row.member_name} 님을 현재 조 명단에서 비활성화했습니다.`);
                    } catch (error) {
                      console.error('[attendance] member deactivation failed', error);
                      setMessage('명단 비활성화를 저장하지 못했습니다.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  className="min-h-10 rounded-lg border border-[#DC2626] px-3 text-[13px] font-bold text-[#B91C1C]"
                >
                  비활성화
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          disabled={summary.unconfirmed === 0 || busy}
          onClick={async () => {
            if (!token || !window.confirm(`미확인 ${summary.unconfirmed}명을 결석 처리할까요?`)) return;
            setBusy(true);
            try {
              const count = await finalizeAbsent(token);
              await load();
              setMessage(`${count}명을 결석 처리했습니다.`);
            } finally {
              setBusy(false);
            }
          }}
          className="w-full min-h-12 rounded-xl border border-[#DC2626] text-[#B91C1C] font-bold disabled:opacity-40"
        >
          남은 미확인 {summary.unconfirmed}명 결석 처리
        </button>
      </div>
    </section>
  );
}
