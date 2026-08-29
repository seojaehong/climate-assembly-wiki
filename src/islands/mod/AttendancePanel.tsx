import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ATTENDANCE_GUIDE } from './attendance-guide';
import {
  bulkPresent,
  fetchAttendanceRoster,
  finalizeAbsent,
  saveRosterMember,
  setAttendance,
  unlockTeamAttendanceByCode,
  type AttendanceRosterRow,
} from '../../lib/attendance';
import {
  applyAttendanceAction, attendanceSummary, classifyAttendanceError, formatCheckTime,
  type AttendanceAction,
} from './attendance-logic';

/** ISO 문자열을 datetime-local 입력이 받는 로컬 시각 문자열로 바꾼다. */
function toLocalInputValue(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return localDateTimeNow();
  return new Date(at.getTime() - at.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

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

/**
 * 출석 사용 안내 — 조별 산출물의 「작성 안내」와 같은 모양·같은 접힘 방식으로 둔다.
 * 화면이 스스로 설명하지 않으면 현장에서 사람이 물어보는 시간이 그대로 지연이 된다.
 */
function AttendanceGuide() {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem('climate_vote_attendance_guide_collapsed') !== '1';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      sessionStorage.setItem('climate_vote_attendance_guide_collapsed', next ? '0' : '1');
    } catch {
      /* 저장 못 해도 토글 자체는 된다 */
    }
  };

  return (
    <section className="rounded-2xl border border-[#C4D8E4] bg-[#F1F7FA] overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <span className="text-[22px]" aria-hidden="true">📖</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[19px] font-extrabold text-[#1F4E79]">출석 체크 사용법</span>
          <span className="block text-[14px] text-[#5A6B73]">처음 쓰신다면 한 번 읽어 주세요</span>
        </span>
        <span className="text-[20px] text-[#5A6B73]" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <ol className="px-5 pb-5 space-y-3">
          {ATTENDANCE_GUIDE.map((item, index) => (
            <li key={item.title} className="flex gap-3">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-white border border-[#C4D8E4] grid place-items-center text-[14px] font-bold text-[#1F4E79] tr-num">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[16px] font-bold text-[#1F2933]">{item.title}</span>
                <span className="block text-[15px] leading-[1.6] text-[#5A6B73]">{item.body}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
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
  // 지금 서버 응답을 기다리는 행. 전역 busy로 목록 전체를 얼리면 다음 사람을 못 찍는다.
  const [pendingRows, setPendingRows] = useState<Record<string, true>>({});

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
      setMessage('출석부 연결이 만료되었습니다. 아래 버튼으로 다시 열어 주세요.');
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

  /**
   * 조 접속코드로 출석부를 연다. 모더레이터는 /mod 입장에서 이미 같은 코드를 입력했으므로
   * 추가 입력이 없다 — 이 화면에 도달하면 자동으로 호출된다.
   */
  const unlock = useCallback(async () => {
    if (!joinCode) return;
    setBusy(true);
    try {
      const nextToken = await unlockTeamAttendanceByCode(joinCode);
      if (!nextToken) {
        setMessage('출석부를 열지 못했습니다. 조 코드를 확인하고 다시 시도해 주세요.');
        return;
      }
      sessionStorage.setItem(tokenKey, nextToken);
      setToken(nextToken);
      setMessage(null);
    } catch (error) {
      console.error('[attendance] team unlock failed', error);
      setMessage('연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }, [joinCode, tokenKey]);

  // 토큰이 없으면(첫 진입 또는 만료) 조 코드로 한 번 자동 개방한다.
  // 실패 시에는 재시도 버튼으로 넘겨 무한 재시도를 만들지 않는다.
  const autoUnlockTried = useRef(false);
  useEffect(() => {
    if (token || !joinCode || autoUnlockTried.current) return;
    autoUnlockTried.current = true;
    void unlock();
  }, [joinCode, token, unlock]);

  /**
   * 탭한 즉시 화면을 바꾸고 서버에는 뒤이어 보낸다.
   *
   * 이전에는 RPC 왕복 + 명단 전체 재조회를 기다린 뒤에야 화면이 바뀌어, 현장 와이파이에서
   * 수백 ms 동안 아무 반응이 없었다. 그 침묵이 "두 번 누르게" 만든다.
   * 실패하면 원본 행으로 정확히 되돌리고 사유를 남긴다.
   *
   * 성공 후 전체 재조회를 하지 않는다 — 15초 폴링이 어차피 정본으로 맞춘다.
   */
  const runAction = async (row: AttendanceRosterRow, action: AttendanceAction, occurredAt?: string) => {
    if (!token || pendingRows[row.assignment_id]) return;
    const at = occurredAt ?? new Date().toISOString();
    const before = row;
    setRows((current) =>
      current.map((r) => (r.assignment_id === row.assignment_id ? applyAttendanceAction(r, action, at) : r)),
    );
    setPendingRows((current) => ({ ...current, [row.assignment_id]: true }));
    setMessage(null);
    try {
      await setAttendance(token, row.assignment_id, action, at);
    } catch (error) {
      console.error('[attendance] status update failed', error);
      setRows((current) => current.map((r) => (r.assignment_id === before.assignment_id ? before : r)));
      setMessage(`${before.member_name} 님 저장에 실패했습니다. 다시 눌러 주세요.`);
    } finally {
      setPendingRows((current) => {
        const next = { ...current };
        delete next[row.assignment_id];
        return next;
      });
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
            <p className="text-[13px] text-[#5A6B73]">{teamName} 명단을 여는 중입니다.</p>
          </div>
        </div>
        <div className="p-6">
          {busy ? (
            <p className="text-[16px] font-bold text-[#1F4E79]" role="status">출석부를 여는 중…</p>
          ) : (
            <>
              <p className="text-[16px] text-[#33393F]" role="status">
                {message ?? '출석부를 열 준비가 되었습니다.'}
              </p>
              <button
                type="button"
                onClick={() => void unlock()}
                disabled={!joinCode}
                className="mt-4 min-h-14 w-full rounded-xl bg-[#1F4E79] px-5 text-white text-[18px] font-bold disabled:opacity-40"
              >
                {joinCode ? '출석부 열기' : '조 코드가 없어 열 수 없습니다'}
              </button>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="lg:col-span-2 rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-[#4F9D3A]/8 border-b border-[#DCE7EE]">
        <div>
          <h3 className="text-[22px] font-extrabold text-[#1F4E79]">출석 체크 · {teamName}</h3>
          <p className="text-[13px] text-[#5A6B73]">
            누르면 바로 저장됩니다 · 잘못 눌렀으면 「미확인」으로 되돌립니다
          </p>
        </div>
        {/* 예전 이름은 「출석부 잠금」이었다. 그런데 잠그는 것이 아니라 이 기기 화면에서
            명단을 감출 뿐이고, 「출석부 열기」로 비밀번호 없이 다시 열린다. 이름이 동작과
            달라 현장에서 「한 번 잠그면 못 고치나」로 읽혔다 — 이름을 동작에 맞춘다.
            기능은 남긴다: 태블릿을 놓고 자리를 뜰 때 이름·지역·성별이 화면에 남지 않는다. */}
        {/* 사용법 안내는 접을 수 있다. 그래서 이 한 줄은 접히지 않는 자리에 따로 둔다 —
            「닫기」가 기록을 잠그는 것으로 읽히면 현장에서 아무도 누르지 않는다. */}
        <div className="text-right">
          <button
            type="button"
            className="min-h-11 rounded-lg border border-[#9CB7C8] bg-white px-3 text-[13px] font-bold text-[#1F4E79]"
            onClick={() => {
              sessionStorage.removeItem(tokenKey);
              setToken(null);
              setRows([]);
            }}
          >
            출석부 닫기
          </button>
          <p className="mt-1 text-[12px] leading-snug text-[#5A6B73]">
            자리 비울 때만 — 화면에서 감출 뿐입니다
            <br />
            체크한 기록은 그대로 남고 다시 열 수 있습니다
          </p>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        <AttendanceGuide />
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

        <div className="max-h-[520px] overflow-y-auto rounded-xl border border-[#DCE7EE]">
          {visibleRows.map((row) => {
            // 이 행만 잠근다. 다른 행은 그대로 눌러 다음 사람을 계속 찍을 수 있다.
            const rowPending = Boolean(pendingRows[row.assignment_id]);
            const isEditingRow = timeEdit?.row.assignment_id === row.assignment_id;
            return (
            <div
              key={row.assignment_id}
              className={`border-b border-[#E6EBF3] p-3 last:border-0 transition-opacity ${rowPending ? 'opacity-60' : ''}`}
            >
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
              <div className="mt-2 flex flex-wrap gap-2 pl-7">
                <button type="button" onClick={() => void runAction(row, 'present')} disabled={rowPending} className="min-h-11 rounded-lg bg-[#4F9D3A] px-4 text-[15px] font-bold text-white active:scale-95 transition-transform duration-75 disabled:opacity-45">출석</button>
                <button type="button" onClick={() => void runAction(row, 'late')} disabled={rowPending} className="min-h-11 rounded-lg bg-[#F5A623] px-4 text-[15px] font-bold text-white active:scale-95 transition-transform duration-75 disabled:opacity-45">지각</button>
                <button type="button" onClick={() => void runAction(row, 'absent')} disabled={rowPending} className="min-h-11 rounded-lg bg-[#DC2626] px-4 text-[15px] font-bold text-white active:scale-95 transition-transform duration-75 disabled:opacity-45">결석</button>
                <button type="button" onClick={() => void runAction(row, 'early_leave')} disabled={rowPending} className="min-h-11 rounded-lg bg-[#2E75B6] px-4 text-[15px] font-bold text-white active:scale-95 transition-transform duration-75 disabled:opacity-45">조퇴</button>
                {/* 「미확인」 — 잘못 누른 체크를 **체크 안 한 처음 상태로** 되돌린다.
                    출석↔지각↔결석↔조퇴는 서로 덮어쓰면 되지만, 한 번 누르면 「아직
                    확인 안 한 사람」으로는 돌아갈 방법이 없었다. 명단을 훑다가 옆 사람을
                    잘못 누르면 그 사람은 영영 확인된 것으로 남는다.
                    RPC(attendance_set)는 처음부터 'unconfirmed' 를 받고 있었고 버튼만
                    없었다. 되돌리기라 다른 넷과 색을 달리해 실수로 눌리지 않게 한다. */}
                <button
                  type="button"
                  onClick={() => void runAction(row, 'unconfirmed')}
                  disabled={rowPending}
                  className="min-h-11 rounded-lg border-2 border-[#9CB7C8] bg-white px-4 text-[15px] font-bold text-[#5A6B73] active:scale-95 transition-transform duration-75 disabled:opacity-45"
                >
                  미확인
                </button>
                <button type="button" onClick={() => { setMemberEdit(row); setMemberId(row.official_id); setMemberName(row.member_name); }} className="min-h-11 rounded-lg border border-[#9CB7C8] px-4 text-[15px] font-bold text-[#1F4E79] active:scale-95 transition-transform duration-75">명단 정정</button>
              </div>

              {/* 기록된 시각은 그 행에서 바로 보이고, 고칠 때만 편집기가 이 자리에 열린다.
                  목록 맨 위 고정 패널은 누른 행에서 멀어 누구 것인지 잃게 만들었다. */}
              {(row.is_late || row.is_early_leave) && !isEditingRow ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-7 text-[14px]">
                  {row.is_late && row.checked_in_at ? (
                    <span className="font-bold text-[#6B4B00]">입실 {formatCheckTime(row.checked_in_at)}</span>
                  ) : null}
                  {row.is_early_leave && row.checked_out_at ? (
                    <span className="font-bold text-[#1F4E79]">퇴실 {formatCheckTime(row.checked_out_at)}</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      const action = row.is_early_leave ? 'early_leave' : 'late';
                      const current = action === 'early_leave' ? row.checked_out_at : row.checked_in_at;
                      setTimeEdit({ row, action });
                      setTimeValue(current ? toLocalInputValue(current) : localDateTimeNow());
                    }}
                    className="min-h-11 rounded-lg border border-[#9CB7C8] px-3 font-bold text-[#1F4E79] active:scale-95 transition-transform duration-75"
                  >
                    시각 수정
                  </button>
                </div>
              ) : null}

              {isEditingRow ? (
                <div className="mt-2 ml-7 rounded-xl border-2 border-[#23B2C3] bg-[#F2FCFD] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-extrabold text-[#1F4E79]">
                      {timeEdit?.action === 'late' ? '입실' : '퇴실'} 시각 수정
                    </div>
                    <button
                      type="button"
                      aria-label="시각 수정 닫기"
                      onClick={() => setTimeEdit(null)}
                      className="min-h-11 min-w-11 rounded-lg text-[22px] font-bold text-[#5A6B73]"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      type="datetime-local"
                      autoFocus
                      value={timeValue}
                      onChange={(event) => setTimeValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setTimeEdit(null);
                        if (event.key === 'Enter') void saveTimeAction();
                      }}
                      className="min-h-12 rounded-lg border border-[#9CB7C8] px-3"
                    />
                    <button type="button" onClick={() => void saveTimeAction()} className="min-h-12 rounded-lg bg-[#23B2C3] px-4 font-bold text-white active:scale-95 transition-transform duration-75">저장</button>
                  </div>
                </div>
              ) : null}

              {/* 2026-08-29: 「비활성화」 버튼을 뺀다.
                  이 버튼은 조원을 명단에서 내린다. 그런데 조 모더레이터가 명단을 고쳐야 할
                  이유가 없다 — **명단 정본은 본부가 쥔다.** 반면 상태 버튼(출석·지각·결석·
                  조퇴) 바로 아래 있어서 잘못 눌리기 쉬웠다. 확인 대화가 있긴 하지만,
                  현장에서 빠르게 명단을 훑는 중에는 확인창도 그대로 눌린다.
                  → 얻는 것 없이 잃을 것만 있는 버튼이라 화면에서 없앤다.

                  RPC(attendance_member_save)와 lib 의 saveRosterMember 는 그대로 둔다 —
                  「명단 정정」(이름·번호 고치기)이 같은 경로를 쓰고, 본부가 명단을 내려야 할
                  때는 SQL 로 처리한다. 되살릴 일이 생기면 이 블록만 복구하면 된다. */}
            </div>
            );
          })}
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
