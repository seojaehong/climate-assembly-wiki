import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAgendaBoard,
  setAgendaAssignment,
  writeAgendaProgress,
  type AgendaAssignment,
  type AgendaBoardItem,
  type AgendaBoardPayload,
  type AgendaTeam,
} from '../../lib/agenda-progress';
import {
  AGENDA_STATUSES,
  AGENDA_STATUS_LABELS,
  AGENDA_STATUS_STYLES,
  statusCounts,
  subgroupSortKey,
  type AgendaProgressAction,
  type AgendaStatus,
} from './agenda-progress-logic';

type Props = {
  token?: string;
  mode: 'hq' | 'team';
  teamId?: string;
  subgroup?: string | null;
  fixturePayload?: AgendaBoardPayload;
  onAuthorizationExpired?: () => void;
};

const POLL_INTERVAL_MS = 5_000;

function draftKey(teamId: string, stageId: string, agendaId: string): string {
  return `climate_agenda_draft:${teamId}:${stageId}:${agendaId}`;
}

function readLocalDraft(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch (error) {
    console.warn('[agenda progress] local draft read failed', error);
    return '';
  }
}

function storeLocalDraft(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.error('[agenda progress] local draft write failed', error);
  }
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return '아직 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '시각 확인 필요'
    : new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function isAuthorizationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /authorization|token|session|로그인|만료/i.test(message);
}

function StatusBadge({ status }: { status: AgendaStatus }) {
  return (
    <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[13px] font-extrabold ${AGENDA_STATUS_STYLES[status]}`}>
      {AGENDA_STATUS_LABELS[status]}
    </span>
  );
}

function teamNumber(team: AgendaTeam): string {
  const match = team.name.match(/(\d+)\s*조/);
  return match?.[1] ?? team.name;
}

function AssignmentSummary({ assignments }: { assignments: AgendaAssignment[] }) {
  if (assignments.length === 0) return <span className="text-[14px] font-bold text-[#94A3B8]">미배정</span>;
  return (
    <div className="flex flex-wrap gap-2">
      {assignments.map((assignment) => (
        <span key={assignment.teamId} className="inline-flex items-center gap-2 rounded-xl border border-[#DCE7EE] bg-white px-2 py-1">
          <strong className="text-[13px] text-[#334E5C]">{assignment.teamName}</strong>
          <StatusBadge status={assignment.status} />
        </span>
      ))}
    </div>
  );
}

function ProjectorView({ item, onClose }: { item: AgendaBoardItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#F5F8FB] p-6 text-[#1F2933] sm:p-10" role="dialog" aria-modal="true" aria-label="분과 송출 화면">
      <header className="mx-auto flex max-w-7xl items-start gap-4 border-b-4 border-[#23B2C3] pb-6">
        <div className="min-w-0 flex-1">
          <p className="text-[22px] font-extrabold text-[#137586]">{item.subgroup} · 의제 {item.ordinal}</p>
          <h2 className="mt-2 text-[38px] font-black leading-tight sm:text-[54px]">{item.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="min-h-12 rounded-xl border-2 border-[#1F4E79] bg-white px-5 text-[17px] font-extrabold text-[#1F4E79]">
          운영 화면으로
        </button>
      </header>
      <div className="mx-auto mt-8 grid max-w-7xl gap-8 lg:grid-cols-2">
        <section className="rounded-3xl border border-[#C4D8E4] bg-white p-7 shadow-sm">
          <h3 className="text-[26px] font-black text-[#1F4E79]">연결된 시민 원문</h3>
          <ul className="mt-5 space-y-4 text-[24px] font-semibold leading-[1.55]">
            {item.sourceUtterances.map((utterance, index) => <li key={index}>“{utterance}”</li>)}
          </ul>
        </section>
        <section className="rounded-3xl border border-[#C4D8E4] bg-white p-7 shadow-sm">
          <h3 className="text-[26px] font-black text-[#1F4E79]">조별 현재 공유문안</h3>
          <div className="mt-5 space-y-5">
            {item.assignments.length === 0 ? <p className="text-[24px] text-[#64748B]">아직 배정된 조가 없습니다.</p> : null}
            {item.assignments.map((assignment) => (
              <article key={assignment.teamId} className="rounded-2xl bg-[#F1F7FA] p-5">
                <div className="flex items-center justify-between gap-4">
                  <h4 className="text-[23px] font-black">{assignment.teamName}</h4>
                  <StatusBadge status={assignment.status} />
                </div>
                <p className="mt-3 whitespace-pre-wrap text-[23px] font-semibold leading-[1.55]">
                  {assignment.publicDraft || '공유문안 작성 전'}
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function DivisionProjectorView({
  division,
  items,
  onClose,
}: {
  division: string;
  items: AgendaBoardItem[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#F5F8FB] p-6 text-[#1F2933] sm:p-10" role="dialog" aria-modal="true" aria-label={`${division} 진행상황 송출 화면`}>
      <header className="mx-auto flex max-w-7xl items-start gap-4 border-b-4 border-[#23B2C3] pb-6">
        <div className="min-w-0 flex-1">
          <p className="text-[22px] font-extrabold text-[#137586]">9/12–13 시민참여단 워크숍</p>
          <h2 className="mt-2 text-[38px] font-black leading-tight sm:text-[54px]">{division} 의제 진행상황</h2>
          <p className="mt-2 text-[20px] font-bold text-[#5A6B73]">의제 {items.length}개 · 배정 조와 현재 상태</p>
        </div>
        <button type="button" onClick={onClose} className="min-h-12 rounded-xl border-2 border-[#1F4E79] bg-white px-5 text-[17px] font-extrabold text-[#1F4E79]">
          운영 화면으로
        </button>
      </header>
      <div className="mx-auto mt-8 grid max-w-7xl gap-4 lg:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-2xl border border-[#C4D8E4] bg-white p-5 shadow-sm">
            <p className="text-[16px] font-extrabold text-[#137586]">의제 {item.ordinal}</p>
            <h3 className="mt-1 text-[25px] font-black leading-snug text-[#1F2933]">{item.title}</h3>
            <div className="mt-4"><AssignmentSummary assignments={item.assignments} /></div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function AgendaProgressBoard({
  token,
  mode,
  teamId,
  subgroup,
  fixturePayload,
  onAuthorizationExpired,
}: Props) {
  const [payload, setPayload] = useState<AgendaBoardPayload | null>(fixturePayload ?? null);
  const [loading, setLoading] = useState(!fixturePayload);
  const [connection, setConnection] = useState<'server' | 'retrying' | 'offline'>(fixturePayload ? 'server' : 'retrying');
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>(mode === 'team' ? (subgroup ?? '전체') : '전체');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgendaBoardItem | null>(null);
  const [projecting, setProjecting] = useState<AgendaBoardItem | null>(null);
  const [projectingDivision, setProjectingDivision] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [pendingRequestIds, setPendingRequestIds] = useState<Record<string, string>>({});

  const refresh = useCallback(async (quiet = false) => {
    if (fixturePayload) {
      setPayload(fixturePayload);
      setConnection('server');
      return;
    }
    if (!token) return;
    if (!quiet) setLoading(true);
    try {
      const next = await fetchAgendaBoard(token);
      setPayload(next);
      setConnection('server');
      if (!quiet) setMessage(null);
    } catch (error) {
      console.error('[agenda progress] refresh failed', error);
      setConnection(navigator.onLine ? 'retrying' : 'offline');
      if (!quiet) setMessage('서버 상태를 새로 받지 못했습니다. 화면의 마지막 서버 상태와 기기 저장 초안은 유지됩니다.');
      if (isAuthorizationError(error)) onAuthorizationExpired?.();
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [fixturePayload, onAuthorizationExpired, token]);

  useEffect(() => {
    void refresh();
    if (fixturePayload) return;
    const interval = window.setInterval(() => void refresh(true), POLL_INTERVAL_MS);
    const online = () => void refresh(false);
    const offline = () => setConnection('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [fixturePayload, refresh]);

  useEffect(() => {
    if (mode !== 'team' || !payload?.activeStage || !teamId) return;
    const recovered: Record<string, string> = {};
    for (const agenda of payload.agendas) {
      const assignment = agenda.assignments.find((item) => item.teamId === teamId);
      if (!assignment) continue;
      const local = readLocalDraft(draftKey(teamId, payload.activeStage.id, agenda.id));
      recovered[agenda.id] = local || assignment.publicDraft || '';
    }
    setDrafts((current) => ({ ...recovered, ...current }));
  }, [mode, payload?.activeStage?.id, payload?.agendas, teamId]);

  const visibleAgendas = useMemo(() => {
    if (!payload) return [];
    return payload.agendas.filter((agenda) => {
      if (filter !== '전체' && agenda.subgroup !== filter) return false;
      return mode === 'hq' || agenda.assignments.some((assignment) => assignment.teamId === teamId);
    });
  }, [filter, mode, payload, teamId]);

  const allStatuses = useMemo(
    () => visibleAgendas.flatMap((agenda) => agenda.assignments.map((assignment) => assignment.status)),
    [visibleAgendas],
  );
  const counts = statusCounts(allStatuses);
  const unsentCount = Object.values(dirty).filter(Boolean).length;

  const runMutation = async (key: string, operation: (requestId: string) => Promise<void>) => {
    if (fixturePayload) {
      setMessage('검증용 fixture에서는 서버 저장을 실행하지 않습니다.');
      return;
    }
    setBusyKey(key);
    setMessage(null);
    const requestId = pendingRequestIds[key] ?? crypto.randomUUID();
    setPendingRequestIds((current) => ({ ...current, [key]: requestId }));
    try {
      await operation(requestId);
      await refresh(true);
      setConnection('server');
      setPendingRequestIds((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (error) {
      console.error('[agenda progress] mutation failed', error);
      setConnection(navigator.onLine ? 'retrying' : 'offline');
      setMessage(error instanceof Error ? error.message : '저장하지 못했습니다. 기기 초안은 유지됩니다.');
      if (isAuthorizationError(error)) onAuthorizationExpired?.();
    } finally {
      setBusyKey(null);
    }
  };

  const toggleAssignment = (agenda: AgendaBoardItem, team: AgendaTeam) => {
    const assigned = agenda.assignments.some((item) => item.teamId === team.id);
    return runMutation(`assign:${agenda.id}:${team.id}`, (requestId) => setAgendaAssignment({
      token: token ?? '', agendaId: agenda.id, teamId: team.id, assigned: !assigned,
      requestId,
    }));
  };

  const act = (agenda: AgendaBoardItem, assignment: AgendaAssignment, action: AgendaProgressAction) => {
    if (!payload?.activeStage) {
      setMessage('현재 열린 작업단계가 없어 진행기록을 저장할 수 없습니다.');
      return Promise.resolve();
    }
    const currentDraft = drafts[agenda.id] ?? assignment.publicDraft ?? '';
    const feedback = feedbacks[`${agenda.id}:${assignment.teamId}`] ?? null;
    return runMutation(`${action}:${agenda.id}:${assignment.teamId}`, async (requestId) => {
      await writeAgendaProgress({
        token: token ?? '', topicId: payload.activeStage?.id ?? '', agendaId: agenda.id,
        teamId: assignment.teamId, action, publicDraft: currentDraft || null,
        feedback: action === 'revision_request' ? feedback : null,
        requestId,
      });
      if (action === 'save' && teamId) {
        storeLocalDraft(draftKey(teamId, payload.activeStage?.id ?? '', agenda.id), currentDraft);
        setDirty((current) => ({ ...current, [agenda.id]: false }));
      }
    });
  };

  const divisions = [...new Set((payload?.agendas ?? []).map((agenda) => agenda.subgroup))]
    .sort((left, right) => subgroupSortKey(left) - subgroupSortKey(right));

  if (loading && !payload) {
    return <div className="grid min-h-[420px] place-items-center text-[18px] font-bold text-[#5A6B73]">9·8·8 진행상황판을 불러오는 중…</div>;
  }

  return (
    <section className="min-h-[70vh] bg-[#F5F8FB] p-4 sm:p-6" aria-labelledby="agenda-progress-title">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border border-[#C4D8E4] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-[240px] flex-1">
              <p className="text-[13px] font-extrabold uppercase tracking-[.12em] text-[#137586]">9/12–13 시민참여단 워크숍</p>
              <h2 id="agenda-progress-title" className="mt-1 text-[29px] font-black text-[#1F4E79]">
                {mode === 'hq' ? '분과별 의제 진행상황판' : '우리 조 의제 기록'}
              </h2>
              <p className="mt-2 text-[15px] font-semibold text-[#5A6B73]">
                현재 작업단계: {payload?.activeStage ? `${payload.activeStage.ordinal}. ${payload.activeStage.prompt}` : '열린 단계 없음'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-2 text-[13px] font-extrabold ${connection === 'server' ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#FFF4D6] text-[#6B4B00]'}`}>
                {connection === 'server' ? '서버 연결됨' : connection === 'offline' ? '오프라인 · 마지막 서버 상태' : '재연결 중 · 마지막 서버 상태'}
              </span>
              <button type="button" onClick={() => void refresh()} className="min-h-11 rounded-xl border border-[#1F4E79] bg-white px-4 text-[14px] font-extrabold text-[#1F4E79]">새로고침</button>
            </div>
          </div>
          {mode === 'team' ? (
            <div className="mt-4 rounded-xl bg-[#EAF8FA] px-4 py-3 text-[15px] font-bold text-[#135C73]">
              <p>배정된 의제만 보입니다. 분과와 조는 로그인 정보에 고정되어 있어 다시 고를 필요가 없습니다. 미전송 기기 초안 {unsentCount}건.</p>
              <p className="mt-1 text-[14px]">여기에는 진행상태와 시민 공유문안만 씁니다. 발언자별 원문·근거·다른 의견은 기존 기록 탭에 계속 남겨 주세요.</p>
            </div>
          ) : null}
          {message ? <p role="alert" className="mt-4 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[14px] font-bold text-[#6B4B00]">{message}</p> : null}
        </header>

        {mode === 'hq' ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="분과 필터">
              {['전체', ...divisions].map((division) => (
                <button key={division} type="button" role="tab" aria-selected={filter === division} onClick={() => setFilter(division)}
                  className={`min-h-11 rounded-xl px-5 text-[15px] font-extrabold ${filter === division ? 'bg-[#1F4E79] text-white' : 'border border-[#C4D8E4] bg-white text-[#334E5C]'}`}>
                  {division}{division === '전체' ? ' 25개' : ` ${payload?.agendas.filter((item) => item.subgroup === division).length ?? 0}개`}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2" aria-label="분과별 송출">
              {divisions.map((division) => (
                <button key={division} type="button" onClick={() => setProjectingDivision(division)}
                  className="min-h-11 rounded-xl bg-[#137586] px-4 text-[14px] font-extrabold text-white">
                  {division} 현황 송출
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <p className="mt-4 text-[13px] font-extrabold text-[#5A6B73]">조별 진행건수 · 한 의제를 여러 조에 배정하면 조별로 각각 집계됩니다.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {AGENDA_STATUSES.map((status) => (
            <div key={status} className={`rounded-xl border p-3 ${AGENDA_STATUS_STYLES[status]}`}>
              <p className="text-[13px] font-extrabold">{AGENDA_STATUS_LABELS[status]}</p>
              <p className="mt-1 text-[24px] font-black">{counts[status]}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 space-y-3">
          {visibleAgendas.length === 0 ? (
            <div className="rounded-2xl border border-[#C4D8E4] bg-white p-10 text-center text-[18px] font-bold text-[#64748B]">
              {mode === 'team' ? 'HQ에서 이 조에 배정한 의제가 아직 없습니다.' : '표시할 의제가 없습니다.'}
            </div>
          ) : null}
          {visibleAgendas.map((agenda) => {
            const teams = (payload?.teams ?? []).filter((team) => team.subgroup === agenda.subgroup);
            const myAssignment = agenda.assignments.find((assignment) => assignment.teamId === teamId);
            return (
              <article key={agenda.id} className="rounded-2xl border border-[#DCE7EE] bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <button type="button" onClick={() => setSelected(selected?.id === agenda.id ? null : agenda)} className="min-w-[260px] flex-1 text-left">
                    <p className="text-[13px] font-extrabold text-[#137586]">{agenda.subgroup} · 의제 {agenda.ordinal}</p>
                    <h3 className="mt-1 text-[21px] font-black leading-snug text-[#1F2933]">{agenda.title}</h3>
                    <div className="mt-3"><AssignmentSummary assignments={agenda.assignments} /></div>
                  </button>
                  {mode === 'hq' ? (
                    <button type="button" onClick={() => setProjecting(agenda)} className="min-h-11 rounded-xl bg-[#23B2C3] px-4 text-[14px] font-extrabold text-white">이 의제 송출</button>
                  ) : myAssignment ? <StatusBadge status={myAssignment.status} /> : null}
                </div>

                {mode === 'hq' ? (
                  <div className="mt-4 border-t border-[#E2E8F0] pt-4">
                    <p className="mb-2 text-[13px] font-extrabold text-[#5A6B73]">조 배정 · 여러 조 선택 가능</p>
                    <div className="flex flex-wrap gap-2">
                      {teams.map((team) => {
                        const assigned = agenda.assignments.some((item) => item.teamId === team.id);
                        const key = `assign:${agenda.id}:${team.id}`;
                        return (
                          <button key={team.id} type="button" disabled={busyKey === key} onClick={() => void toggleAssignment(agenda, team)}
                            aria-pressed={assigned}
                            className={`min-h-11 rounded-xl border-2 px-4 text-[14px] font-extrabold ${assigned ? 'border-[#137586] bg-[#EAF8FA] text-[#135C73]' : 'border-[#CBD5E1] bg-white text-[#475569]'}`}>
                            {assigned ? '✓ ' : ''}{teamNumber(team)}조
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : myAssignment ? (
                  <div className="mt-4 border-t border-[#E2E8F0] pt-4">
                    {myAssignment.feedback ? <p className="mb-3 rounded-xl border-2 border-[#F59E0B] bg-[#FEF3C7] p-3 text-[15px] font-bold text-[#92400E]">HQ 보완 요청: {myAssignment.feedback}</p> : null}
                    <label className="block text-[14px] font-extrabold text-[#334E5C]">
                      시민에게 공유할 현재 문안
                      <textarea rows={5} value={drafts[agenda.id] ?? myAssignment.publicDraft ?? ''}
                        onChange={(event) => {
                          const next = event.target.value;
                          setDrafts((current) => ({ ...current, [agenda.id]: next }));
                          setDirty((current) => ({ ...current, [agenda.id]: true }));
                          if (teamId && payload?.activeStage) storeLocalDraft(draftKey(teamId, payload.activeStage.id, agenda.id), next);
                        }}
                        disabled={myAssignment.status === 'submitted'}
                        className="mt-2 w-full rounded-xl border border-[#C4D8E4] p-4 text-[17px] leading-relaxed disabled:bg-[#F1F5F9]" />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {myAssignment.status === 'waiting' ? <button type="button" onClick={() => void act(agenda, myAssignment, 'start')} className="min-h-11 rounded-xl bg-[#0369A1] px-4 font-extrabold text-white">논의 시작</button> : null}
                      {myAssignment.status !== 'submitted' ? <button type="button" onClick={() => void act(agenda, myAssignment, 'save')} className="min-h-11 rounded-xl bg-[#B45309] px-4 font-extrabold text-white">초안 저장</button> : null}
                      {myAssignment.status === 'drafting' ? <button type="button" onClick={() => void act(agenda, myAssignment, 'confirm')} className="min-h-11 rounded-xl bg-[#7E22CE] px-4 font-extrabold text-white">조 확인 완료</button> : null}
                      {myAssignment.status === 'team_confirmed' ? <button type="button" onClick={() => void act(agenda, myAssignment, 'submit')} className="min-h-11 rounded-xl bg-[#047857] px-4 font-extrabold text-white">최종 제출</button> : null}
                      <span className="self-center text-[13px] font-bold text-[#64748B]">서버 갱신 {formatUpdatedAt(myAssignment.updatedAt)}{dirty[agenda.id] ? ' · 기기 초안 미전송' : ''}</span>
                    </div>
                  </div>
                ) : null}

                {selected?.id === agenda.id ? (
                  <div className="mt-4 grid gap-4 rounded-xl bg-[#F8FAFC] p-4 lg:grid-cols-2">
                    <div>
                      <h4 className="text-[15px] font-black text-[#1F4E79]">연결 시민 원문</h4>
                      <ul className="mt-2 space-y-2 text-[15px] leading-relaxed text-[#334155]">{agenda.sourceUtterances.map((text, index) => <li key={index}>“{text}”</li>)}</ul>
                    </div>
                    <div>
                      <h4 className="text-[15px] font-black text-[#1F4E79]">조별 공유문안·보완</h4>
                      <div className="mt-2 space-y-3">
                        {agenda.assignments.map((assignment) => {
                          const feedbackKey = `${agenda.id}:${assignment.teamId}`;
                          return <div key={assignment.teamId} className="rounded-xl border border-[#DCE7EE] bg-white p-3">
                            <div className="flex items-center gap-2"><strong>{assignment.teamName}</strong><StatusBadge status={assignment.status} /></div>
                            <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed">{assignment.publicDraft || '공유문안 작성 전'}</p>
                            {mode === 'hq' && (assignment.status === 'team_confirmed' || assignment.status === 'submitted') ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <input value={feedbacks[feedbackKey] ?? ''} onChange={(event) => setFeedbacks((current) => ({ ...current, [feedbackKey]: event.target.value }))}
                                  placeholder="구체적인 보완 요청" className="min-h-11 min-w-[220px] flex-1 rounded-lg border border-[#C4D8E4] px-3" />
                                <button type="button" onClick={() => void act(agenda, assignment, 'revision_request')} className="min-h-11 rounded-lg bg-[#B45309] px-3 font-bold text-white">보완 요청</button>
                                <button type="button" onClick={() => void act(agenda, assignment, 'reopen')} className="min-h-11 rounded-lg border border-[#1F4E79] px-3 font-bold text-[#1F4E79]">피드백 없이 재열기</button>
                              </div>
                            ) : null}
                          </div>;
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
      {projecting ? <ProjectorView item={projecting} onClose={() => setProjecting(null)} /> : null}
      {projectingDivision ? (
        <DivisionProjectorView
          division={projectingDivision}
          items={(payload?.agendas ?? []).filter((item) => item.subgroup === projectingDivision)}
          onClose={() => setProjectingDivision(null)}
        />
      ) : null}
    </section>
  );
}
