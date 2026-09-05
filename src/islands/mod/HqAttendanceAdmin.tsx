import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchAttendanceAudit,
  fetchAttendanceRoster,
  saveRosterMember,
  setTeamAttendancePin,
  setTeamTableNo,
  type AttendanceAuditRow,
  type AttendanceRosterRow,
} from '../../lib/attendance';
import { CURRENT_SESSION_SLUG } from '../../lib/hq-submissions';
import type { HqTeam } from '../../lib/mod-console';
import { classifyAttendanceError } from './attendance-logic';
import { TABLE_NO_MAX_LENGTH, normalizeTableNo, tableNoLabel } from './table-no';

function csvCell(value: string | boolean): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function downloadCsv(rows: AttendanceRosterRow[]): void {
  const header = [
    '공식 ID',
    '이름',
    '조',
    '상태',
    '입실 시각',
    '지각 여부',
    '퇴실 시각',
    '조퇴 여부',
    '활성 여부',
    '최종 수정 시각',
  ];
  const lines = rows.map((row) =>
    [
      row.official_id,
      row.member_name,
      row.team_name,
      row.base_status,
      row.checked_in_at ?? '',
      row.is_late,
      row.checked_out_at ?? '',
      row.is_early_leave,
      row.active,
      row.updated_at,
    ]
      .map(csvCell)
      .join(','),
  );
  const blob = new Blob([`\uFEFF${header.map(csvCell).join(',')}\r\n${lines.join('\r\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `기후시민회의_출석명부_${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatAuditValue(value: unknown): string {
  if (value == null) return '없음';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.error('[HQ attendance] audit value formatting failed', error);
    return '표시할 수 없는 값';
  }
}

export default function HqAttendanceAdmin({
  teams,
  token,
  onAuthorizationExpired,
}: {
  teams: HqTeam[];
  token: string;
  onAuthorizationExpired: () => void;
}) {
  const [rows, setRows] = useState<AttendanceRosterRow[]>([]);
  const [audit, setAudit] = useState<AttendanceAuditRow[]>([]);
  const [tab, setTab] = useState<'roster' | 'audit'>('roster');
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<AttendanceRosterRow | null>(null);
  const [newMember, setNewMember] = useState({ officialId: '', name: '', teamId: teams[0]?.id ?? '' });
  const [pinTeamId, setPinTeamId] = useState(teams[0]?.id ?? '');
  const [newPin, setNewPin] = useState('');
  // 조별 테이블 번호 초안. 키가 없는 조는 teams prop의 값을 그대로 읽는다(아래 tableValue).
  // 30초마다 갱신되는 prop이 사용자가 치고 있는 값을 덮지 않게 하는 유일한 방법이다.
  const [tableDrafts, setTableDrafts] = useState<Record<string, string>>({});
  const [tableSavingId, setTableSavingId] = useState<string | null>(null);
  // 저장 실패는 조별로 남긴다 — 공용 message 채널은 15초 폴링 성공이 지워 버린다.
  const [tableErrors, setTableErrors] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const tokenRef = useRef<string>(token);
  const loadRequestSequence = useRef(0);
  const loadInFlightRef = useRef<{ token: string; requestId: number; promise: Promise<void> } | null>(null);

  const load = useCallback((sessionToken: string): Promise<void> => {
    const currentRequest = loadInFlightRef.current;
    if (currentRequest?.token === sessionToken) return currentRequest.promise;

    setRefreshBusy(true);
    const requestId = loadRequestSequence.current + 1;
    loadRequestSequence.current = requestId;
    const request = (async () => {
      try {
        const [nextRows, nextAudit] = await Promise.all([
          fetchAttendanceRoster(sessionToken, CURRENT_SESSION_SLUG),
          fetchAttendanceAudit(sessionToken, CURRENT_SESSION_SLUG),
        ]);
        if (tokenRef.current !== sessionToken) return;
        setRows(nextRows);
        setAudit(nextAudit);
        setRefreshError(null);
        setLastRefreshAt(Date.now());
        setMessage(null);
      } catch (error) {
        console.error('[HQ attendance] admin refresh failed', error);
        if (tokenRef.current !== sessionToken) return;
        if (classifyAttendanceError(error) === 'transient') {
          setRefreshError('연결이 잠시 끊겼습니다. 마지막으로 확인한 명단과 수정이력을 유지하고 자동으로 다시 연결합니다.');
          return;
        }
        setRows([]);
        setAudit([]);
        setRefreshError(null);
        onAuthorizationExpired();
      } finally {
        if (loadInFlightRef.current?.requestId === requestId) {
          loadInFlightRef.current = null;
          setRefreshBusy(false);
        }
      }
    })();
    loadInFlightRef.current = { token: sessionToken, requestId, promise: request };
    return request;
  }, [onAuthorizationExpired]);

  useEffect(() => {
    tokenRef.current = token;
    loadRequestSequence.current += 1;
    loadInFlightRef.current = null;
    setRows([]);
    setAudit([]);
    setRefreshError(null);
    void load(token);
  }, [load, token]);

  useEffect(() => {
    if (!token) return undefined;
    const interval = window.setInterval(() => void load(token), 15000);
    return () => window.clearInterval(interval);
  }, [load, token]);

  useEffect(() => {
    if (!newMember.teamId && teams[0]) setNewMember((current) => ({ ...current, teamId: teams[0].id }));
    if (!pinTeamId && teams[0]) setPinTeamId(teams[0].id);
  }, [newMember.teamId, pinTeamId, teams]);

  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ko-KR');
    return rows.filter(
      (row) =>
        (teamFilter === 'all' || row.team_id === teamFilter) &&
        (!normalized ||
          row.member_name.toLocaleLowerCase('ko-KR').includes(normalized) ||
          row.official_id.toLocaleLowerCase('ko-KR').includes(normalized)),
    );
  }, [query, rows, teamFilter]);

  const saveExisting = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !editing) return;
    setBusy(true);
    try {
      await saveRosterMember(token, CURRENT_SESSION_SLUG, {
        assignmentId: editing.assignment_id,
        officialId: editing.official_id,
        name: editing.member_name,
        teamId: editing.team_id,
        active: editing.active,
      });
      setEditing(null);
      await load(token);
      setMessage('명단 변경을 저장하고 수정이력에 기록했습니다.');
    } catch (error) {
      console.error('[HQ attendance] roster update failed', error);
      setMessage('명단 변경을 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !newMember.teamId) return;
    setBusy(true);
    try {
      await saveRosterMember(token, CURRENT_SESSION_SLUG, {
        officialId: newMember.officialId,
        name: newMember.name,
        teamId: newMember.teamId,
        active: true,
      });
      setNewMember((current) => ({ ...current, officialId: '', name: '' }));
      await load(token);
      setMessage('신규 명단을 추가하고 수정이력에 기록했습니다.');
    } catch (error) {
      console.error('[HQ attendance] roster create failed', error);
      setMessage('신규 명단을 추가하지 못했습니다. 공식 ID 중복 여부를 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const rotatePin = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !pinTeamId || !/^\d{6,10}$/.test(newPin)) {
      setMessage('조 운영 PIN은 숫자 6~10자리로 입력해 주세요.');
      return;
    }
    setBusy(true);
    try {
      await setTeamAttendancePin(token, CURRENT_SESSION_SLUG, pinTeamId, newPin);
      setNewPin('');
      setMessage('조 운영 PIN을 새 값으로 교체했습니다. 화면에는 다시 표시되지 않습니다.');
      await load(token);
    } catch (error) {
      console.error('[HQ attendance] PIN rotation failed', error);
      setMessage('조 운영 PIN을 변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const tableValue = (team: HqTeam): string => tableDrafts[team.id] ?? team.table_no ?? '';

  const saveTableNo = async (team: HqTeam) => {
    if (!token) return;
    const value = normalizeTableNo(tableValue(team));
    setTableSavingId(team.id);
    setTableErrors((current) => {
      const { [team.id]: _removed, ...rest } = current;
      return rest;
    });
    try {
      await setTeamTableNo(token, CURRENT_SESSION_SLUG, team.id, value);
      // 초안을 지우지 않는다. teams prop은 /hq 폴링(최대 30초) 뒤에야 새 값을 싣고 오므로,
      // 여기서 지우면 입력창이 옛 값으로 되돌아가 저장이 실패한 것처럼 보인다.
      setTableDrafts((current) => ({ ...current, [team.id]: value ?? '' }));
      setMessage(
        value
          ? `${team.name} 좌석을 ${tableNoLabel(value)}로 저장했습니다. 대형 화면에는 30초 안에 반영됩니다.`
          : `${team.name} 테이블 번호를 지웠습니다.`,
      );
    } catch (error) {
      console.error('[HQ attendance] table number save failed', error);
      setTableErrors((current) => ({
        ...current,
        [team.id]: '저장하지 못했습니다. 연결을 확인한 뒤 저장을 다시 눌러 주세요.',
      }));
    } finally {
      setTableSavingId(null);
    }
  };

  return (
    <section className="rounded-2xl border-2 border-[#1F4E79] bg-white p-4 shadow-sm sm:p-5" aria-labelledby="hq-admin-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="hq-admin-title" className="text-[22px] font-extrabold text-[#1F2933]">HQ 명단 관리</h2>
          <p className="mt-1 text-[13px] text-[#5A6B73]">변경은 삭제되지 않는 수정이력에 운영자 이름과 함께 기록됩니다.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadCsv(rows)} className="min-h-11 rounded-xl border border-[#1F4E79] px-4 text-[14px] font-bold text-[#1F4E79]">
            CSV 다운로드
          </button>
        </div>
      </div>

      {message ? <p className="mt-3 rounded-lg bg-[#EEF4F8] px-3 py-2 text-[13px] font-bold text-[#1F4E79]">{message}</p> : null}
      {refreshError ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border-2 border-[#B5651D] bg-[#FFF4D6] px-3 py-2" role="alert">
          <p className="min-w-[220px] flex-1 text-[13px] font-bold leading-relaxed text-[#6B4B00]">
            {refreshError}{' '}
            {lastRefreshAt == null ? '아직 정상 확인된 시각이 없습니다.' : `마지막 정상 확인 ${new Date(lastRefreshAt).toLocaleTimeString('ko-KR')}`}
          </p>
          <button
            type="button"
            onClick={() => token && void load(token)}
            disabled={refreshBusy}
            className="min-h-11 rounded-lg border-2 border-[#6B4B00] bg-white px-3 text-[13px] font-extrabold text-[#6B4B00] disabled:opacity-50"
          >
            {refreshBusy ? '다시 연결 중…' : '지금 다시 연결'}
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2 border-b border-[#DCE7EE]">
        {(['roster', 'audit'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
            className={`min-h-11 border-b-4 px-4 text-[15px] font-extrabold ${
              tab === value ? 'border-[#23B2C3] text-[#0A4A52]' : 'border-transparent text-[#5A6B73]'
            }`}
          >
            {value === 'roster' ? `명단 ${rows.length}명` : `수정이력 ${audit.length}건`}
          </button>
        ))}
      </div>

      {tab === 'roster' ? (
        <div className="mt-4 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="search"
              aria-label="명단 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름 또는 공식 ID 검색"
              className="min-h-11 rounded-xl border border-[#C4D8E4] px-3"
            />
            <select aria-label="명단 조 필터" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} className="min-h-11 rounded-xl border border-[#C4D8E4] px-3">
              <option value="all">전체 조</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>

          <form onSubmit={addMember} className="grid gap-2 rounded-xl bg-[#EEF4F8] p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input aria-label="신규 공식 ID" required value={newMember.officialId} onChange={(event) => setNewMember((current) => ({ ...current, officialId: event.target.value }))} placeholder="공식 ID" className="min-h-11 rounded-lg border border-[#C4D8E4] px-3" />
            <input aria-label="신규 참여자 이름" required value={newMember.name} onChange={(event) => setNewMember((current) => ({ ...current, name: event.target.value }))} placeholder="이름" className="min-h-11 rounded-lg border border-[#C4D8E4] px-3" />
            <select aria-label="신규 참여자 조" required value={newMember.teamId} onChange={(event) => setNewMember((current) => ({ ...current, teamId: event.target.value }))} className="min-h-11 rounded-lg border border-[#C4D8E4] px-3">
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            <button disabled={busy} className="min-h-11 rounded-lg bg-[#1F4E79] px-4 font-bold text-white disabled:opacity-50">명단 추가</button>
          </form>

          <form onSubmit={rotatePin} className="grid gap-2 rounded-xl border border-[#F0D28A] bg-[#FFF9E8] p-3 sm:grid-cols-[1fr_1fr_auto]">
            <select aria-label="운영 PIN을 교체할 조" value={pinTeamId} onChange={(event) => setPinTeamId(event.target.value)} className="min-h-11 rounded-lg border border-[#D8BE79] px-3">
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name} 운영 PIN</option>)}
            </select>
            <input aria-label="새 조 운영 PIN" type="password" inputMode="numeric" value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ''))} placeholder="새 숫자 PIN 6~10자리" className="min-h-11 rounded-lg border border-[#D8BE79] px-3" />
            <button disabled={busy} className="min-h-11 rounded-lg bg-[#6B4B00] px-4 font-bold text-white disabled:opacity-50">PIN 교체</button>
          </form>

          <section className="rounded-xl border border-[#C4D8E4] bg-[#F8FAFC] p-3" aria-labelledby="hq-table-no-title">
            <h3 id="hq-table-no-title" className="text-[16px] font-extrabold text-[#1F2933]">조 테이블 번호</h3>
            <p className="mt-1 text-[13px] font-bold text-[#5A6B73]">
              현장 좌석 번호입니다. 숫자가 아니어도 됩니다(예: A-3). 비우고 저장하면 번호가 지워집니다.
              저장한 값은 대형 화면과 각 조 화면에 30초 안에 반영됩니다.
            </p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {teams.map((team) => (
                <li key={team.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[92px] text-[14px] font-bold text-[#33393F]">{team.name}</span>
                  <input
                    aria-label={`${team.name} 테이블 번호`}
                    value={tableValue(team)}
                    maxLength={TABLE_NO_MAX_LENGTH}
                    placeholder="예: 15"
                    onChange={(event) => {
                      const next = event.target.value;
                      setTableDrafts((current) => ({ ...current, [team.id]: next }));
                      setTableErrors((current) => {
                        const { [team.id]: _removed, ...rest } = current;
                        return rest;
                      });
                    }}
                    className="min-h-11 min-w-[80px] flex-1 rounded-lg border border-[#C4D8E4] px-3 text-[15px]"
                  />
                  <button
                    type="button"
                    disabled={tableSavingId === team.id}
                    onClick={() => void saveTableNo(team)}
                    className="min-h-11 shrink-0 rounded-lg border-2 border-[#1F4E79] px-3 text-[14px] font-bold text-[#1F4E79] disabled:opacity-50"
                  >
                    {tableSavingId === team.id ? '저장 중…' : '저장'}
                  </button>
                  {tableErrors[team.id] ? (
                    <p className="w-full rounded-lg border-2 border-[#F5A623] bg-[#F5A623]/10 px-3 py-2 text-[13px] font-extrabold text-[#B5651D]">
                      {tableErrors[team.id]}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          {visibleRows.length === 0 ? (
            <p role="status" className="rounded-xl border border-[#DCE7EE] bg-[#F8FAFC] p-4 text-[14px] font-bold text-[#5A6B73]">
              표시할 출석 명단이 없습니다. 검색어와 조 필터를 확인해 주세요.
            </p>
          ) : (
            <ul aria-label="출석 명단" className="space-y-3 md:hidden">
              {visibleRows.map((row) => (
                <li key={row.assignment_id} className="rounded-xl border border-[#DCE7EE] bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[17px] font-extrabold text-[#1F2933]">{row.member_name}</p>
                      <p className="mt-1 font-mono text-[13px] font-bold text-[#526975]">{row.official_id}</p>
                    </div>
                    <span className="rounded-full bg-[#EEF4F8] px-3 py-1 text-[12px] font-extrabold text-[#334E5C]">
                      {row.active ? '활성' : '비활성'}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-[72px_1fr] gap-x-3 gap-y-2 text-[14px]">
                    <dt className="font-bold text-[#526975]">조</dt>
                    <dd className="font-bold text-[#1F2933]">{row.team_name}</dd>
                    <dt className="font-bold text-[#526975]">상태</dt>
                    <dd>{row.base_status}{row.is_late ? ' · 지각' : ''}{row.is_early_leave ? ' · 조퇴' : ''}</dd>
                    <dt className="font-bold text-[#526975]">입실</dt>
                    <dd>{row.checked_in_at ? new Date(row.checked_in_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—'}</dd>
                    <dt className="font-bold text-[#526975]">퇴실</dt>
                    <dd>{row.checked_out_at ? new Date(row.checked_out_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—'}</dd>
                  </dl>
                  <button
                    type="button"
                    onClick={() => setEditing(row)}
                    className="mt-4 min-h-11 w-full rounded-lg border-2 border-[#1F4E79] px-3 font-bold text-[#1F4E79]"
                  >
                    {row.member_name} 수정
                  </button>
                </li>
              ))}
            </ul>
          )}

          {visibleRows.length > 0 ? (
          <div
            role="region"
            aria-label="출석 명단 표"
            tabIndex={0}
            className="hidden overflow-x-auto rounded-xl border border-[#DCE7EE] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] md:block"
          >
            <table className="min-w-[920px] w-full text-left text-[14px]">
              <caption className="sr-only">공식 ID, 이름, 조, 출석 상태와 관리 기능이 있는 출석 명단</caption>
              <thead className="bg-[#EEF4F8] text-[#334E5C]">
                <tr>
                  {['공식 ID', '이름', '조', '상태', '입실', '퇴실', '활성', '관리'].map((label) => (
                    <th key={label} scope="col" className="px-3 py-3">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.assignment_id} className="border-t border-[#DCE7EE]">
                    <td className="px-3 py-3 font-mono">{row.official_id}</td>
                    <td className="px-3 py-3 font-bold">{row.member_name}</td>
                    <td className="px-3 py-3">{row.team_name}</td>
                    <td className="px-3 py-3">{row.base_status}{row.is_late ? ' · 지각' : ''}{row.is_early_leave ? ' · 조퇴' : ''}</td>
                    <td className="px-3 py-3">{row.checked_in_at ? new Date(row.checked_in_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="px-3 py-3">{row.checked_out_at ? new Date(row.checked_out_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td className="px-3 py-3">{row.active ? '활성' : '비활성'}</td>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => setEditing(row)} className="min-h-11 rounded-lg border border-[#1F4E79] px-3 font-bold text-[#1F4E79]">수정</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          ) : null}
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {audit.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-[#DCE7EE] bg-[#F8FAFC] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[#1F2933]">{entry.actor_label} · {entry.action}</strong>
                <time className="text-[12px] font-bold text-[#5A6B73]">{new Date(entry.created_at).toLocaleString('ko-KR')}</time>
              </div>
              <p className="mt-1 text-[13px] text-[#5A6B73]">{entry.team_name ?? '전체 명단'}</p>
              <div className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2">
                <div className="rounded-lg bg-white p-2"><strong>변경 전</strong><div className="mt-1 break-all">{formatAuditValue(entry.before_value)}</div></div>
                <div className="rounded-lg bg-white p-2"><strong>변경 후</strong><div className="mt-1 break-all">{formatAuditValue(entry.after_value)}</div></div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {editing ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-[#132646]/55 p-4" role="presentation">
          <form onSubmit={saveExisting} role="dialog" aria-modal="true" aria-labelledby="edit-member-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <h3 id="edit-member-title" className="text-[22px] font-extrabold text-[#1F2933]">명단 수정</h3>
            <div className="mt-4 grid gap-3">
              <label className="text-[13px] font-bold">공식 ID<input required value={editing.official_id} onChange={(event) => setEditing({ ...editing, official_id: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[#C4D8E4] px-3" /></label>
              <label className="text-[13px] font-bold">이름<input required value={editing.member_name} onChange={(event) => setEditing({ ...editing, member_name: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[#C4D8E4] px-3" /></label>
              <label className="text-[13px] font-bold">조<select value={editing.team_id} onChange={(event) => setEditing({ ...editing, team_id: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-[#C4D8E4] px-3">{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
              <label className="flex min-h-11 items-center gap-2 font-bold"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} />활성 명단</label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="min-h-11 rounded-lg border border-[#C4D8E4] px-4 font-bold">취소</button>
              <button disabled={busy} className="min-h-11 rounded-lg bg-[#1F4E79] px-5 font-bold text-white disabled:opacity-50">저장</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
