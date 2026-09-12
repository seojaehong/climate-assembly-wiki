import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  archiveRecommendation,
  createAgenda,
  createRecommendation,
  fetchAgendaBoard,
  reviseRecommendation,
  setAgendaAssignment,
  writeRecommendationProgress,
  type AgendaAssignment,
  type AgendaBoardItem,
  type AgendaBoardPayload,
  type AgendaRecommendation,
  type AgendaTeam,
} from '../../lib/agenda-progress';
import {
  AGENDA_STATUSES,
  AGENDA_STATUS_LABELS,
  AGENDA_STATUS_STYLES,
  EMPTY_RECOMMENDATION_DRAFT,
  agendaBoardPendingStorageKey,
  canEditRecommendation,
  canWriteActiveAgendaStage,
  canSaveRecommendation,
  dirtyMapForRecoveredDrafts,
  emptyAgendaBoardPendingState,
  hasRecommendationContent,
  isRevisionConflictMessage,
  isWorkflowStageConflictMessage,
  mutationRequestId,
  mutationPayloadFingerprint,
  nextAgendaStatus,
  pendingMutationMatches,
  pendingRecommendationSaveDrafts,
  pendingRecordAfterMutationFailure,
  parseAgendaBoardPendingState,
  recommendationMatchesSearch,
  recommendationProgressBlockMessage,
  recommendationSaveLabel,
  similarAgendaTitles,
  statusCounts,
  subgroupSortKey,
  topicIdForPendingMutation,
  withoutRecordKey,
  type AgendaProgressAction,
  type AgendaStatus,
  type AgendaBoardPendingState,
  type RecommendationDraft,
} from './agenda-progress-logic';

type Props = {
  token?: string;
  mode: 'hq' | 'team';
  teamId?: string;
  subgroup?: string | null;
  fixturePayload?: AgendaBoardPayload;
  onAuthorizationExpired?: () => void;
};

type Connection = 'server' | 'retrying' | 'offline';

const POLL_INTERVAL_MS = 5_000;
const GUIDE_URL = '/mod-help/agenda-progress/index.html';

export function findProjectedAgenda<T extends { id: string }>(
  agendas: readonly T[],
  agendaId: string | null,
): T | null {
  if (!agendaId) return null;
  return agendas.find((agenda) => agenda.id === agendaId) ?? null;
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

function localDraftKey(teamId: string, recommendationId: string): string {
  return `climate_recommendation_draft:${teamId}:${recommendationId}`;
}

function readLocalDraft(key: string): RecommendationDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object'
      || parsed === null
      || !('title' in parsed)
      || !('problemRecognition' in parsed)
      || !('recommendationContent' in parsed)
    ) return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.title !== 'string'
      || typeof candidate.problemRecognition !== 'string'
      || typeof candidate.recommendationContent !== 'string'
    ) return null;
    return {
      title: candidate.title,
      problemRecognition: candidate.problemRecognition,
      recommendationContent: candidate.recommendationContent,
    };
  } catch (error) {
    console.warn('[recommendation board] local draft read failed', error);
    return null;
  }
}

function storeLocalDraft(key: string, draft: RecommendationDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch (error) {
    console.error('[recommendation board] local draft write failed', error);
  }
}

function removeLocalDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error('[recommendation board] local draft removal failed', error);
  }
}

function readPendingState(key: string, fallbackSubgroup: string): AgendaBoardPendingState {
  try {
    return parseAgendaBoardPendingState(window.localStorage.getItem(key), fallbackSubgroup);
  } catch (error) {
    console.warn('[recommendation board] pending state read failed', error);
    return emptyAgendaBoardPendingState(fallbackSubgroup);
  }
}

function storePendingState(key: string, state: AgendaBoardPendingState): void {
  try {
    const hasPendingRequest = Object.keys(state.requestIds).length > 0;
    const hasAgendaForm = state.agendaForm.open
      || Boolean(state.agendaForm.title || state.agendaForm.sourceUtterance);
    if (!hasPendingRequest && !hasAgendaForm && state.recommendationForm === null) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.error('[recommendation board] pending state write failed', error);
  }
}

function archiveReasonFromFingerprint(fingerprint: string | undefined): string | null {
  if (!fingerprint) return null;
  try {
    const parsed: unknown = JSON.parse(fingerprint);
    if (typeof parsed !== 'object' || parsed === null || !('reason' in parsed)) return null;
    const reason = (parsed as { reason?: unknown }).reason;
    return typeof reason === 'string' && reason.trim() ? reason : null;
  } catch {
    return null;
  }
}

function snapshotFromFingerprint(fingerprint: string | undefined): Record<string, unknown> | null {
  if (!fingerprint) return null;
  try {
    const parsed: unknown = JSON.parse(fingerprint);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
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
  if (assignments.length === 0) {
    return <span className="text-[14px] font-bold text-[#94A3B8]">미배정</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {assignments.map((assignment) => (
        <span key={assignment.teamId} className="rounded-xl border border-[#DCE7EE] bg-white px-2 py-1 text-[13px] font-extrabold text-[#334E5C]">
          {assignment.teamName}
        </span>
      ))}
    </div>
  );
}

function RecommendationFields({
  value,
  disabled,
  prefix,
  onChange,
}: {
  value: RecommendationDraft;
  disabled?: boolean;
  prefix: string;
  onChange: (next: RecommendationDraft) => void;
}) {
  return (
    <div className="grid gap-4">
      <label className="text-[14px] font-extrabold text-[#334E5C]">
        권고안 제목 <span className="text-[#B91C1C]">초안 저장 필수</span>
        <input
          aria-label={`${prefix} 권고안 제목`}
          value={value.title}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
          placeholder="한눈에 이해되는 권고안 제목"
          className="mt-2 min-h-12 w-full rounded-xl border border-[#C4D8E4] px-4 text-[16px] disabled:bg-[#F1F5F9]"
        />
      </label>
      <label className="text-[14px] font-extrabold text-[#334E5C]">
        배경·문제 인식 <span className="text-[#B91C1C]">조 확인 전 필수</span>
        <textarea
          aria-label={`${prefix} 배경·문제 인식`}
          rows={3}
          value={value.problemRecognition}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, problemRecognition: event.target.value })}
          placeholder="무엇이 문제이고 왜 바꿔야 하는지 적어 주세요."
          className="mt-2 w-full rounded-xl border border-[#C4D8E4] p-4 text-[16px] leading-relaxed disabled:bg-[#F1F5F9]"
        />
      </label>
      <label className="text-[14px] font-extrabold text-[#334E5C]">
        권고 내용 <span className="text-[#B91C1C]">조 확인 전 필수</span>
        <textarea
          aria-label={`${prefix} 권고 내용`}
          rows={5}
          value={value.recommendationContent}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, recommendationContent: event.target.value })}
          placeholder="누가 무엇을 어떻게 해야 하는지 구체적으로 적어 주세요."
          className="mt-2 w-full rounded-xl border border-[#C4D8E4] p-4 text-[16px] leading-relaxed disabled:bg-[#F1F5F9]"
        />
      </label>
    </div>
  );
}

function ProjectorView({ item, onClose }: { item: AgendaBoardItem; onClose: () => void }) {
  const recommendations = item.recommendations.filter((recommendation) => !recommendation.archived);
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#F5F8FB] p-6 text-[#1F2933] sm:p-10" role="dialog" aria-modal="true" aria-label={`${item.title} 송출 화면`}>
      <header className="mx-auto flex max-w-7xl items-start gap-4 border-b-4 border-[#23B2C3] pb-6">
        <div className="min-w-0 flex-1">
          <p className="text-[22px] font-extrabold text-[#137586]">{item.subgroup} · 주제 {item.ordinal}</p>
          <h2 className="mt-2 text-[38px] font-black leading-tight sm:text-[54px]">{item.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="min-h-12 rounded-xl border-2 border-[#1F4E79] bg-white px-5 text-[17px] font-extrabold text-[#1F4E79]">
          운영 화면으로
        </button>
      </header>
      <div className="mx-auto mt-8 grid max-w-7xl gap-8 lg:grid-cols-[.8fr_1.2fr]">
        <section className="rounded-3xl border border-[#C4D8E4] bg-white p-7 shadow-sm">
          <h3 className="text-[26px] font-black text-[#1F4E79]">연결된 시민 원문</h3>
          {item.sourceUtterances.length === 0 ? <p className="mt-5 text-[22px] text-[#64748B]">연결 원문 정리 중</p> : null}
          <ul className="mt-5 space-y-4 text-[22px] font-semibold leading-[1.55]">
            {item.sourceUtterances.map((utterance, index) => <li key={index}>“{utterance}”</li>)}
          </ul>
        </section>
        <section className="rounded-3xl border border-[#C4D8E4] bg-white p-7 shadow-sm">
          <h3 className="text-[26px] font-black text-[#1F4E79]">조별 현재 권고안</h3>
          <div className="mt-5 space-y-5">
            {recommendations.length === 0 ? <p className="text-[24px] text-[#64748B]">작성된 권고안이 없습니다.</p> : null}
            {recommendations.map((recommendation) => (
              <article key={recommendation.id} className="rounded-2xl bg-[#F1F7FA] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[18px] font-extrabold text-[#137586]">{recommendation.authorTeamName}</p>
                  <StatusBadge status={recommendation.status} />
                </div>
                <h4 className="mt-2 text-[27px] font-black">{recommendation.title}</h4>
                <p className="mt-3 whitespace-pre-wrap text-[21px] font-semibold leading-[1.55]">{recommendation.recommendationContent}</p>
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
  agendas,
  onClose,
}: {
  division: string;
  agendas: AgendaBoardItem[];
  onClose: () => void;
}) {
  const recommendationCount = agendas.reduce(
    (count, agenda) => count + agenda.recommendations.filter((item) => !item.archived).length,
    0,
  );
  const pageSize = 2;
  const pageCount = Math.max(1, Math.ceil(agendas.length / pageSize));
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);
  const visibleAgendas = agendas.slice(page * pageSize, (page + 1) * pageSize);
  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#F5F8FB] p-6 text-[#1F2933] sm:p-10" role="dialog" aria-modal="true" aria-label={`${division} 권고안 현황 송출 화면`}>
      <header className="mx-auto flex w-full items-start gap-4 border-b-4 border-[#23B2C3] pb-6">
        <div className="min-w-0 flex-1">
          <p className="text-[22px] font-extrabold text-[#137586]">9/12–13 시민참여단 워크숍</p>
          <h2 className="mt-2 text-[38px] font-black leading-tight sm:text-[54px]">{division} 권고안 진행상황</h2>
          <p className="mt-2 text-[20px] font-bold text-[#5A6B73]">주제 {agendas.length}개 · 권고안 {recommendationCount}건 · {page + 1}/{pageCount}쪽</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} className="min-h-12 rounded-xl border-2 border-[#1F4E79] bg-white px-4 text-[17px] font-extrabold text-[#1F4E79] disabled:cursor-not-allowed disabled:opacity-40">이전</button>
          <button type="button" onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page >= pageCount - 1} className="min-h-12 rounded-xl border-2 border-[#1F4E79] bg-white px-4 text-[17px] font-extrabold text-[#1F4E79] disabled:cursor-not-allowed disabled:opacity-40">다음</button>
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border-2 border-[#1F4E79] bg-white px-5 text-[17px] font-extrabold text-[#1F4E79]">운영 화면으로</button>
        </div>
      </header>
      <div className="mx-auto mt-8 grid w-full gap-5 lg:grid-cols-2">
        {visibleAgendas.map((agenda) => {
          const recommendations = agenda.recommendations.filter((item) => !item.archived);
          return (
            <section key={agenda.id} className="rounded-3xl border border-[#C4D8E4] bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-[27px] font-black"><span className="mr-2 text-[18px] text-[#137586]">주제 {agenda.ordinal}</span>{agenda.title}</h3>
                <span className="text-[17px] font-extrabold text-[#475569]">권고안 {recommendations.length}건</span>
              </div>
              {recommendations.length === 0 ? <p className="mt-4 text-[19px] font-bold text-[#94A3B8]">작성 전</p> : null}
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {recommendations.map((recommendation) => (
                  <article key={recommendation.id} className="rounded-2xl bg-[#F1F7FA] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-[17px] text-[#137586]">{recommendation.authorTeamName}</strong>
                      <StatusBadge status={recommendation.status} />
                    </div>
                    <h4 className="mt-2 text-[22px] font-black">{recommendation.title}</h4>
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[17px] font-semibold leading-relaxed">{recommendation.recommendationContent || '권고 내용 작성 중'}</p>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {pageCount > 1 ? <nav className="mx-auto mt-6 flex w-full items-center justify-center gap-2" aria-label="송출 화면 페이지">
        {Array.from({ length: pageCount }, (_, index) => <button key={index} type="button" onClick={() => setPage(index)} aria-current={index === page ? 'page' : undefined} className={`min-h-10 min-w-10 rounded-full border-2 px-3 text-[16px] font-extrabold ${index === page ? 'border-[#137586] bg-[#137586] text-white' : 'border-[#C4D8E4] bg-white text-[#1F4E79]'}`}>{index + 1}</button>)}
      </nav> : null}
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
  const pendingStorageKey = agendaBoardPendingStorageKey(mode, teamId, subgroup);
  const [restoredPending] = useState<AgendaBoardPendingState>(() => (
    fixturePayload
      ? emptyAgendaBoardPendingState(subgroup ?? '1분과')
      : readPendingState(pendingStorageKey, subgroup ?? '1분과')
  ));
  const [restoredPendingSaveDrafts] = useState<Record<string, RecommendationDraft>>(() => (
    pendingRecommendationSaveDrafts(
      restoredPending.requestIds,
      restoredPending.requestFingerprints,
    )
  ));
  const [payload, setPayload] = useState<AgendaBoardPayload | null>(fixturePayload ?? null);
  const [loading, setLoading] = useState(!fixturePayload);
  const [connection, setConnection] = useState<Connection>(fixturePayload ? 'server' : 'retrying');
  const [message, setMessage] = useState<string | null>(null);
  const [divisionFilter, setDivisionFilter] = useState(mode === 'team' ? (subgroup ?? '전체') : '전체');
  const [statusFilter, setStatusFilter] = useState<'all' | AgendaStatus>('all');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedAgendaId, setSelectedAgendaId] = useState('');
  const [projectingAgendaId, setProjectingAgendaId] = useState<string | null>(null);
  const [projectingDivision, setProjectingDivision] = useState<string | null>(null);
  const [agendaFormOpen, setAgendaFormOpen] = useState(restoredPending.agendaForm.open);
  const [newAgendaTitle, setNewAgendaTitle] = useState(restoredPending.agendaForm.title);
  const [newAgendaSource, setNewAgendaSource] = useState(restoredPending.agendaForm.sourceUtterance);
  const [newAgendaSubgroup, setNewAgendaSubgroup] = useState(restoredPending.agendaForm.subgroup);
  const [recommendationFormOpen, setRecommendationFormOpen] = useState(restoredPending.recommendationForm?.open ?? false);
  const [recommendationFormAgendaId, setRecommendationFormAgendaId] = useState<string | null>(restoredPending.recommendationForm?.agendaId ?? null);
  const [recommendationTeamId, setRecommendationTeamId] = useState(restoredPending.recommendationForm?.teamId ?? teamId ?? '');
  const [newRecommendation, setNewRecommendation] = useState<RecommendationDraft>(restoredPending.recommendationForm?.draft ?? { ...EMPTY_RECOMMENDATION_DRAFT });
  const [edits, setEdits] = useState<Record<string, RecommendationDraft>>(restoredPendingSaveDrafts);
  const [dirty, setDirty] = useState<Record<string, boolean>>(
    dirtyMapForRecoveredDrafts(restoredPendingSaveDrafts),
  );
  const [feedbacks, setFeedbacks] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pendingRequestIds, setPendingRequestIds] = useState<Record<string, string>>(restoredPending.requestIds);
  const [pendingRequestFingerprints, setPendingRequestFingerprints] = useState<Record<string, string>>(restoredPending.requestFingerprints);

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
      console.error('[recommendation board] refresh failed', error);
      setConnection(navigator.onLine ? 'retrying' : 'offline');
      if (!quiet) setMessage('서버 상태를 받지 못했습니다. 마지막 서버 상태와 이 기기의 미전송 초안을 구분해 유지합니다.');
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
    if (fixturePayload) return;
    storePendingState(pendingStorageKey, {
      requestIds: pendingRequestIds,
      requestFingerprints: pendingRequestFingerprints,
      agendaForm: {
        open: agendaFormOpen,
        title: newAgendaTitle,
        sourceUtterance: newAgendaSource,
        subgroup: newAgendaSubgroup,
      },
      recommendationForm: recommendationFormAgendaId ? {
        open: recommendationFormOpen,
        agendaId: recommendationFormAgendaId,
        teamId: recommendationTeamId,
        draft: newRecommendation,
      } : null,
    });
  }, [
    agendaFormOpen,
    fixturePayload,
    newAgendaSource,
    newAgendaSubgroup,
    newAgendaTitle,
    newRecommendation,
    pendingRequestIds,
    pendingRequestFingerprints,
    pendingStorageKey,
    recommendationFormAgendaId,
    recommendationFormOpen,
    recommendationTeamId,
  ]);

  useEffect(() => {
    if (!payload || mode !== 'team' || !teamId) return;
    const recovered: Record<string, RecommendationDraft> = {};
    for (const agenda of payload.agendas) {
      for (const recommendation of agenda.recommendations) {
        if (recommendation.authorTeamId !== teamId) continue;
        const local = readLocalDraft(localDraftKey(teamId, recommendation.id));
        if (local) recovered[recommendation.id] = local;
      }
    }
    setEdits((current) => ({ ...recovered, ...current }));
    setDirty((current) => ({ ...current, ...dirtyMapForRecoveredDrafts(recovered) }));
  }, [mode, payload, teamId]);

  const divisions = useMemo(() => (
    [...new Set((payload?.agendas ?? []).map((agenda) => agenda.subgroup))]
      .sort((left, right) => subgroupSortKey(left) - subgroupSortKey(right))
  ), [payload]);
  const projecting = useMemo(
    () => findProjectedAgenda(payload?.agendas ?? [], projectingAgendaId),
    [payload, projectingAgendaId],
  );

  useEffect(() => {
    if (mode === 'team' && subgroup) setNewAgendaSubgroup(subgroup);
  }, [mode, subgroup]);

  const visibleAgendas = useMemo(() => {
    if (!payload) return [];
    return payload.agendas.filter((agenda) => {
      if (!showArchived && agenda.archived) return false;
      if (divisionFilter !== '전체' && agenda.subgroup !== divisionFilter) return false;
      const activeRecommendations = agenda.recommendations.filter((recommendation) => !recommendation.archived);
      if (statusFilter !== 'all' && !activeRecommendations.some((recommendation) => recommendation.status === statusFilter)) return false;
      if (!search.trim()) return true;
      return recommendationMatchesSearch(search, [
        agenda.title,
        ...agenda.sourceUtterances,
        ...activeRecommendations.flatMap((recommendation) => [
          recommendation.title,
          recommendation.problemRecognition,
          recommendation.recommendationContent,
          recommendation.authorTeamName,
        ]),
      ]);
    });
  }, [divisionFilter, payload, search, showArchived, statusFilter]);

  useEffect(() => {
    if (mode !== 'team' || visibleAgendas.length === 0) return;
    if (!visibleAgendas.some((agenda) => agenda.id === selectedAgendaId)) {
      setSelectedAgendaId(visibleAgendas[0].id);
    }
  }, [mode, selectedAgendaId, visibleAgendas]);

  const displayedAgendas = mode === 'team'
    ? visibleAgendas.filter((agenda) => agenda.id === selectedAgendaId)
    : visibleAgendas;
  const countScopeAgendas = (payload?.agendas ?? []).filter((agenda) => (
    !agenda.archived
    && (divisionFilter === '전체' || agenda.subgroup === divisionFilter)
  ));
  const countScopeRecommendations = countScopeAgendas.flatMap((agenda) => (
    agenda.recommendations.filter((recommendation) => !recommendation.archived)
  ));
  const counts = statusCounts(countScopeRecommendations.map((recommendation) => recommendation.status));
  const unsentCount = Object.values(dirty).filter(Boolean).length;
  const agendaCreatePending = Boolean(pendingRequestIds['agenda:create']);
  const activeTopicId = payload?.activeStage?.id ?? null;
  const topicWritesEnabled = canWriteActiveAgendaStage(
    payload?.activeStage,
    payload?.stageIntegrity,
  );
  const anyRecommendationCreatePending = Object.keys(pendingRequestIds)
    .some((key) => key.startsWith('recommendation:create:'));
  const similarTitles = similarAgendaTitles(newAgendaTitle, (payload?.agendas ?? []).map((agenda) => agenda.title));

  const runMutation = async (
    key: string,
    fingerprint: string,
    operation: (requestId: string) => Promise<void>,
  ) => {
    if (fixturePayload) {
      setMessage('검증용 fixture에서는 입력 화면만 확인하며 서버 저장은 실행하지 않습니다.');
      return false;
    }
    setBusyKey(key);
    setMessage(null);
    if (!pendingMutationMatches(pendingRequestIds, pendingRequestFingerprints, key, fingerprint)) {
      setBusyKey(null);
      setMessage('응답을 확인하지 못한 이전 요청과 입력 내용이 다릅니다. 잠긴 기존 입력으로 다시 시도해 주세요.');
      return false;
    }
    const requestId = mutationRequestId(pendingRequestIds, key, () => crypto.randomUUID());
    setPendingRequestIds((current) => ({ ...current, [key]: requestId }));
    setPendingRequestFingerprints((current) => ({ ...current, [key]: fingerprint }));
    try {
      await operation(requestId);
      await refresh(true);
      setConnection('server');
      setPendingRequestIds((current) => {
        return withoutRecordKey(current, key);
      });
      setPendingRequestFingerprints((current) => withoutRecordKey(current, key));
      return true;
    } catch (error) {
      console.error('[recommendation board] mutation failed', error);
      setConnection(navigator.onLine ? 'retrying' : 'offline');
      const errorMessage = error instanceof Error ? error.message : '저장하지 못했습니다. 이 기기의 입력 내용은 유지됩니다.';
      const revisionConflict = isRevisionConflictMessage(errorMessage);
      const workflowStageConflict = isWorkflowStageConflictMessage(errorMessage);
      if (revisionConflict || workflowStageConflict) {
        setPendingRequestIds((current) => pendingRecordAfterMutationFailure(current, key, errorMessage));
        setPendingRequestFingerprints((current) => pendingRecordAfterMutationFailure(current, key, errorMessage));
        await refresh(true);
      }
      setMessage(
        revisionConflict
          ? '다른 운영자가 이 권고안을 먼저 수정했습니다. 서버 최신 상태를 불러왔습니다. 기기 초안과 최신 문안을 다시 확인한 뒤 새 요청으로 저장해 주세요.'
          : workflowStageConflict
            ? '요청을 시작한 작업단계가 이미 바뀌었습니다. 이전 요청을 종료하고 최신 단계를 불러왔습니다. 기기 초안을 확인한 뒤 새 요청으로 저장해 주세요.'
            : errorMessage,
      );
      if (isAuthorizationError(error)) onAuthorizationExpired?.();
      return false;
    } finally {
      setBusyKey(null);
    }
  };

  const submitAgenda = async () => {
    if (!topicWritesEnabled) {
      setMessage('현재 작업단계를 하나로 확정할 수 없어 읽기 전용입니다. 작업단계를 정리한 뒤 다시 시도해 주세요.');
      return;
    }
    const title = newAgendaTitle.trim();
    const sourceUtterance = newAgendaSource.trim();
    if (!title || !sourceUtterance) {
      setMessage('새 주제 제목과 연결 시민 원문을 모두 입력해 주세요.');
      return;
    }
    const targetSubgroup = mode === 'team' ? (subgroup ?? newAgendaSubgroup) : newAgendaSubgroup;
    const snapshot = { subgroup: targetSubgroup, title, sourceUtterance };
    const saved = await runMutation('agenda:create', mutationPayloadFingerprint(snapshot), (requestId) => createAgenda({
      token: token ?? '', subgroup: targetSubgroup,
      title, sourceUtterance, requestId,
    }));
    if (saved) {
      setNewAgendaTitle('');
      setNewAgendaSource('');
      setAgendaFormOpen(false);
    }
  };

  const openRecommendationForm = (agenda: AgendaBoardItem) => {
    if (!topicWritesEnabled) {
      setMessage('현재 작업단계를 하나로 확정할 수 없어 새 권고안을 작성할 수 없습니다.');
      return;
    }
    if (anyRecommendationCreatePending) {
      setMessage('응답을 확인하지 못한 새 권고안 요청이 있습니다. 잠긴 폼에서 같은 내용으로 다시 확인해 주세요.');
      return;
    }
    setRecommendationFormOpen(true);
    setRecommendationFormAgendaId(agenda.id);
    setNewRecommendation({ ...EMPTY_RECOMMENDATION_DRAFT });
    setRecommendationTeamId(mode === 'team' ? (teamId ?? '') : (agenda.assignments[0]?.teamId ?? ''));
    setExpanded((current) => ({ ...current, [agenda.id]: true }));
  };

  const submitRecommendation = async (agenda: AgendaBoardItem) => {
    if (!topicWritesEnabled || !activeTopicId) {
      setMessage('현재 작업단계를 하나로 확정할 수 없어 새 권고안을 저장할 수 없습니다.');
      return;
    }
    if (!newRecommendation.title.trim()) {
      setMessage('초안을 저장하려면 권고안 제목을 입력해 주세요. 배경·문제 인식과 권고 내용은 조 확인 전까지 채우면 됩니다.');
      return;
    }
    if (!recommendationTeamId) {
      setMessage('권고안을 작성할 조를 먼저 배정하고 선택해 주세요.');
      return;
    }
    const key = `recommendation:create:${agenda.id}`;
    const topicId = topicIdForPendingMutation(
      pendingRequestFingerprints,
      key,
      activeTopicId,
    );
    if (!topicId) {
      setMessage('권고안을 연결할 작업단계를 확인할 수 없습니다. 새로고침해 주세요.');
      return;
    }
    const snapshot = {
      agendaId: agenda.id,
      teamId: recommendationTeamId,
      draft: newRecommendation,
      expectedEffect: null,
      topicId,
    };
    const saved = await runMutation(key, mutationPayloadFingerprint(snapshot), (requestId) => createRecommendation({
      token: token ?? '', agendaId: agenda.id, teamId: recommendationTeamId,
      draft: newRecommendation, topicId, requestId,
    }));
    if (saved) {
      setNewRecommendation({ ...EMPTY_RECOMMENDATION_DRAFT });
      setRecommendationFormOpen(false);
      setRecommendationFormAgendaId(null);
      setRecommendationTeamId(teamId ?? '');
    }
  };

  const currentDraft = (recommendation: AgendaRecommendation): RecommendationDraft => (
    edits[recommendation.id] ?? {
      title: recommendation.title,
      problemRecognition: recommendation.problemRecognition,
      recommendationContent: recommendation.recommendationContent,
    }
  );

  const updateDraft = (recommendation: AgendaRecommendation, next: RecommendationDraft) => {
    setEdits((current) => ({ ...current, [recommendation.id]: next }));
    setDirty((current) => ({ ...current, [recommendation.id]: true }));
    if (teamId) storeLocalDraft(localDraftKey(teamId, recommendation.id), next);
  };

  const saveRecommendation = async (recommendation: AgendaRecommendation) => {
    if (!topicWritesEnabled || !activeTopicId) {
      setMessage('현재 작업단계를 하나로 확정할 수 없어 권고안 문안을 저장할 수 없습니다.');
      return;
    }
    const draft = currentDraft(recommendation);
    if (!draft.title.trim()) {
      setMessage('초안을 저장하려면 권고안 제목을 입력해 주세요.');
      return;
    }
    if (fixturePayload) {
      const nextStatus = nextAgendaStatus(
        recommendation.status,
        'save',
        hasRecommendationContent(draft),
      );
      if (!nextStatus) {
        setMessage('현재 단계에서는 초안을 저장할 수 없습니다.');
        return;
      }
      setPayload((current) => current ? {
        ...current,
        agendas: current.agendas.map((agenda) => ({
          ...agenda,
          recommendations: agenda.recommendations.map((item) => item.id === recommendation.id ? {
            ...item,
            ...draft,
            status: nextStatus,
            updatedAt: new Date().toISOString(),
            revisionVersion: item.revisionVersion + 1,
            revisionCount: item.revisionCount + 1,
            progressCount: item.progressCount + 1,
          } : item),
        })),
      } : current);
      setDirty((current) => withoutRecordKey(current, recommendation.id));
      setEdits((current) => withoutRecordKey(current, recommendation.id));
      if (teamId) removeLocalDraft(localDraftKey(teamId, recommendation.id));
      setMessage('검증용 fixture에서 초안 저장과 단계 전이를 재현했습니다. 서버 요청은 보내지 않았습니다.');
      return;
    }
    const key = `recommendation:save:${recommendation.id}`;
    const topicId = topicIdForPendingMutation(
      pendingRequestFingerprints,
      key,
      activeTopicId,
    );
    if (!topicId) {
      setMessage('권고안을 연결할 작업단계를 확인할 수 없습니다. 새로고침해 주세요.');
      return;
    }
    const storedSnapshot = snapshotFromFingerprint(pendingRequestFingerprints[key]);
    const storedExpectedVersion = storedSnapshot?.expectedVersion;
    const expectedVersion = typeof storedExpectedVersion === 'number'
      ? storedExpectedVersion
      : recommendation.revisionVersion;
    const snapshot = {
      recommendationId: recommendation.id,
      draft,
      expectedEffect: recommendation.expectedEffect,
      expectedVersion,
      topicId,
    };
    const saved = await runMutation(key, mutationPayloadFingerprint(snapshot), (requestId) => reviseRecommendation({
      token: token ?? '', recommendationId: recommendation.id, draft,
      expectedEffect: recommendation.expectedEffect,
      expectedVersion,
      topicId,
      requestId,
    }));
    if (saved) {
      setDirty((current) => withoutRecordKey(current, recommendation.id));
      setEdits((current) => withoutRecordKey(current, recommendation.id));
      if (teamId) removeLocalDraft(localDraftKey(teamId, recommendation.id));
    }
  };

  const act = (recommendation: AgendaRecommendation, action: AgendaProgressAction) => {
    if (!topicWritesEnabled || !activeTopicId) {
      setMessage('현재 작업단계를 하나로 확정할 수 없어 권고안 상태를 변경할 수 없습니다.');
      return Promise.resolve(false);
    }
    const blockMessage = recommendationProgressBlockMessage(
      action,
      currentDraft(recommendation),
      dirty[recommendation.id] === true,
    );
    if (blockMessage) {
      setMessage(blockMessage);
      return Promise.resolve(false);
    }
    if (fixturePayload) {
      const nextStatus = nextAgendaStatus(
        recommendation.status,
        action,
        hasRecommendationContent(currentDraft(recommendation)),
      );
      if (!nextStatus) {
        setMessage('현재 단계에서는 이 상태 변경을 수행할 수 없습니다.');
        return Promise.resolve(false);
      }
      setPayload((current) => current ? {
        ...current,
        agendas: current.agendas.map((agenda) => ({
          ...agenda,
          recommendations: agenda.recommendations.map((item) => item.id === recommendation.id ? {
            ...item,
            status: nextStatus,
            feedback: action === 'revision_request'
              ? feedbacks[recommendation.id] ?? item.feedback
              : item.feedback,
            updatedAt: new Date().toISOString(),
            progressCount: item.progressCount + 1,
          } : item),
        })),
      } : current);
      setMessage(`검증용 fixture에서 ${AGENDA_STATUS_LABELS[nextStatus]} 단계로 전환했습니다. 서버 요청은 보내지 않았습니다.`);
      return Promise.resolve(true);
    }
    const key = `${action}:${recommendation.id}`;
    const topicId = topicIdForPendingMutation(
      pendingRequestFingerprints,
      key,
      activeTopicId,
    );
    if (!topicId) {
      setMessage('권고안 상태를 연결할 작업단계를 확인할 수 없습니다. 새로고침해 주세요.');
      return Promise.resolve(false);
    }
    const storedSnapshot = snapshotFromFingerprint(pendingRequestFingerprints[key]);
    const storedFeedback = storedSnapshot?.feedback;
    const feedback = typeof storedFeedback === 'string' || storedFeedback === null
      ? storedFeedback
      : feedbacks[recommendation.id] ?? null;
    const snapshot = { recommendationId: recommendation.id, action, feedback: action === 'revision_request' ? feedback : null, topicId };
    return runMutation(key, mutationPayloadFingerprint(snapshot), (requestId) => writeRecommendationProgress({
      token: token ?? '', recommendationId: recommendation.id, action,
      feedback: action === 'revision_request' ? feedback : null, topicId, requestId,
    }));
  };

  const archiveRecommendationItem = (recommendation: AgendaRecommendation) => {
    const key = `recommendation:archive:${recommendation.id}`;
    const storedReason = archiveReasonFromFingerprint(pendingRequestFingerprints[key]);
    const reason = storedReason ?? window.prompt(
      `“${recommendation.title}” 권고안을 보관합니다. 보관 사유를 입력해 주세요.`,
      '',
    )?.trim();
    if (!reason) {
      setMessage('보관을 취소했습니다. 보관하려면 구체적인 사유를 입력해 주세요.');
      return;
    }
    const snapshot = { recommendationId: recommendation.id, reason };
    void runMutation(key, mutationPayloadFingerprint(snapshot), (requestId) => archiveRecommendation({
      token: token ?? '', recommendationId: recommendation.id, reason, requestId,
    }));
  };

  if (loading && !payload) {
    return <div className="grid min-h-[420px] place-items-center text-[18px] font-bold text-[#5A6B73]">권고안 진행상황판을 불러오는 중…</div>;
  }

  return (
    <section className="min-h-[70vh] bg-[#F5F8FB] p-4 sm:p-6" aria-labelledby="agenda-progress-title">
      <div className="w-full">
        <header className="rounded-2xl border border-[#C4D8E4] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1 basis-full sm:min-w-[240px] sm:basis-auto">
              <p className="text-[13px] font-extrabold uppercase tracking-[.12em] text-[#137586]">9/12–13 시민참여단 워크숍</p>
              <h2 id="agenda-progress-title" className="mt-1 text-[29px] font-black text-[#1F4E79]">
                {mode === 'hq' ? '분과별 권고안 진행상황판' : '우리 조 권고안 작성'}
              </h2>
              <p className="mt-2 text-[15px] font-semibold text-[#5A6B73]">
                {payload?.activeStage ? `${payload.activeStage.ordinal}. ${payload.activeStage.prompt}` : '현재 열린 작업단계 없음'}
                {' · '}화면은 5초마다 자동 갱신됩니다.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={GUIDE_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-xl border border-[#137586] bg-white px-4 text-[14px] font-extrabold text-[#137586]">
                기록 방법 보기
              </a>
              <span className={`rounded-full px-3 py-2 text-[13px] font-extrabold ${connection === 'server' ? 'bg-[#D1FAE5] text-[#065F46]' : 'bg-[#FFF4D6] text-[#6B4B00]'}`}>
                {connection === 'server' ? '서버 연결됨' : connection === 'offline' ? '오프라인 · 마지막 서버 상태' : '재연결 중 · 마지막 서버 상태'}
              </span>
              <button type="button" onClick={() => void refresh()} className="min-h-11 rounded-xl border border-[#1F4E79] bg-white px-4 text-[14px] font-extrabold text-[#1F4E79]">지금 새로고침</button>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-[#EAF8FA] px-4 py-3 text-[14px] font-bold leading-relaxed text-[#135C73]">
            {mode === 'team'
              ? `배정된 주제를 고른 뒤 권고안을 여러 건 작성할 수 있습니다. 오늘은 제목·배경 및 문제 인식·권고 내용만 입력합니다. 미전송 기기 초안 ${unsentCount}건.`
              : '진행상태는 주제가 아니라 각 조의 권고안별로 집계됩니다. 권고안은 삭제하지 않고 이력을 남깁니다.'}
          </div>
          {payload && !topicWritesEnabled ? (
            <p role="status" className="mt-4 rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[15px] font-extrabold leading-relaxed text-[#991B1B]">
              읽기 전용: 현재 열린 작업단계를 하나로 확정할 수 없습니다. 새 주제·권고안 작성과 권고안 문안·상태 변경은 잠겼습니다. HQ의 조 배정 기능은 계속 사용할 수 있습니다.
            </p>
          ) : null}
          {message ? <p role="alert" className="mt-4 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[14px] font-bold text-[#6B4B00]">{message}</p> : null}
        </header>

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-[#DCE7EE] bg-white p-4">
          {mode === 'hq' ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="분과 필터">
                {['전체', ...divisions].map((division) => (
                  <button key={division} type="button" role="tab" aria-selected={divisionFilter === division} onClick={() => setDivisionFilter(division)}
                    className={`min-h-11 rounded-xl px-4 text-[14px] font-extrabold ${divisionFilter === division ? 'bg-[#1F4E79] text-white' : 'border border-[#C4D8E4] text-[#334E5C]'}`}>
                    {division} {division === '전체' ? payload?.agendas.filter((agenda) => !agenda.archived).length : payload?.agendas.filter((agenda) => !agenda.archived && agenda.subgroup === division).length}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="분과별 전체화면 송출">
                {divisions.map((division) => (
                  <button key={division} type="button" onClick={() => setProjectingDivision(division)} className="min-h-11 rounded-xl border border-[#137586] bg-[#EAF8FA] px-4 text-[14px] font-extrabold text-[#135C73]">
                    {division} 현황 송출
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <label className="min-w-0 flex-1 basis-full text-[14px] font-extrabold text-[#334E5C] sm:min-w-[280px] sm:basis-auto">
              작성할 주제
              <select aria-label="작성할 주제 선택" disabled={anyRecommendationCreatePending} value={selectedAgendaId} onChange={(event) => setSelectedAgendaId(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-[#C4D8E4] bg-white px-3 text-[16px] disabled:bg-[#F1F5F9]">
                {visibleAgendas.map((agenda) => <option key={agenda.id} value={agenda.id}>{agenda.subgroup} · {agenda.title}</option>)}
              </select>
            </label>
          )}
          <label className="min-w-0 flex-1 basis-full text-[14px] font-extrabold text-[#334E5C] sm:min-w-[220px] sm:basis-auto">
            주제·권고안 검색
            <input type="search" aria-label="주제와 권고안 검색" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="제목, 내용, 조 이름" className="mt-1 min-h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px]" />
          </label>
          {mode === 'hq' ? (
            <label className="text-[14px] font-extrabold text-[#334E5C]">
              권고안 상태
              <select aria-label="권고안 상태 필터" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | AgendaStatus)} className="mt-1 min-h-12 rounded-xl border border-[#C4D8E4] bg-white px-3">
                <option value="all">전체 상태</option>
                {AGENDA_STATUSES.map((status) => <option key={status} value={status}>{AGENDA_STATUS_LABELS[status]}</option>)}
              </select>
            </label>
          ) : null}
          <button type="button" disabled={!topicWritesEnabled} onClick={() => setAgendaFormOpen(true)} className="min-h-12 rounded-xl bg-[#137586] px-5 text-[15px] font-extrabold text-white disabled:opacity-40">
            + 새 주제 추가
          </button>
          {mode === 'hq' ? (
            <details className="rounded-xl border border-[#C4D8E4] bg-white px-3 py-2 text-[14px] font-bold text-[#475569]">
              <summary className="cursor-pointer list-none">고급 관리</summary>
              <label className="mt-2 flex items-center gap-2 border-t border-[#E5EDF2] pt-2 font-semibold">
                <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
                보관된 주제·권고안 보기
              </label>
              <p className="mt-1 text-[12px] font-medium text-[#5A6B73]">보관은 삭제가 아니라 중복·오류 항목을 기본 화면에서 숨기고 이력을 남기는 기능입니다.</p>
            </details>
          ) : null}
        </div>

        {agendaFormOpen ? (
          <section className="mt-4 rounded-2xl border-2 border-[#137586] bg-white p-5" aria-labelledby="new-agenda-title">
            <div className="flex items-center justify-between gap-3">
              <h3 id="new-agenda-title" className="text-[21px] font-black text-[#1F4E79]">새 주제 추가</h3>
              <button type="button" disabled={agendaCreatePending} onClick={() => setAgendaFormOpen(false)} className="min-h-11 rounded-lg border border-[#C4D8E4] px-3 font-bold disabled:opacity-40">닫기</button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
              {mode === 'hq' ? (
                <label className="text-[14px] font-extrabold text-[#334E5C]">분과
                  <select aria-label="새 주제 분과" disabled={!topicWritesEnabled || agendaCreatePending} value={newAgendaSubgroup} onChange={(event) => setNewAgendaSubgroup(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-[#C4D8E4] bg-white px-3 disabled:bg-[#F1F5F9]">
                    {divisions.map((division) => <option key={division}>{division}</option>)}
                  </select>
                </label>
              ) : <p className="self-end pb-3 text-[15px] font-extrabold text-[#137586]">{subgroup}에 추가</p>}
              <label className="text-[14px] font-extrabold text-[#334E5C]">주제 제목 <span className="text-[#B91C1C]">필수</span>
                <input autoFocus aria-label="새 주제 제목" disabled={!topicWritesEnabled || agendaCreatePending} value={newAgendaTitle} onChange={(event) => setNewAgendaTitle(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px] disabled:bg-[#F1F5F9]" />
              </label>
              <label className="text-[14px] font-extrabold text-[#334E5C] sm:col-span-2">연결 시민 원문 <span className="text-[#B91C1C]">필수</span>
                <textarea aria-label="새 주제 연결 시민 원문" disabled={!topicWritesEnabled || agendaCreatePending} rows={4} maxLength={2000} value={newAgendaSource} onChange={(event) => setNewAgendaSource(event.target.value)} placeholder="이 주제와 연결되는 시민 발언 원문을 그대로 붙여 넣어 주세요." className="mt-1 w-full rounded-xl border border-[#C4D8E4] p-3 text-[16px] leading-relaxed disabled:bg-[#F1F5F9]" />
              </label>
              <div className="flex justify-end sm:col-span-2">
                <button type="button" disabled={!topicWritesEnabled || busyKey === 'agenda:create'} onClick={() => void submitAgenda()} className="min-h-12 rounded-xl bg-[#1F4E79] px-6 font-extrabold text-white disabled:opacity-50">주제 추가</button>
              </div>
            </div>
            {similarTitles.length > 0 ? (
              <p role="status" className="mt-3 rounded-xl border border-[#F59E0B] bg-[#FEF3C7] px-4 py-3 text-[14px] font-bold text-[#92400E]">
                비슷한 기존 주제가 있습니다: {similarTitles.slice(0, 3).join(' · ')}. 중복인지 확인한 뒤 추가해 주세요.
              </p>
            ) : null}
          </section>
        ) : null}

        <p className="mt-5 text-[13px] font-extrabold text-[#5A6B73]">권고안 진행건수 · 분과 전체</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label="권고안 진행건수 요약">
          {AGENDA_STATUSES.map((status) => mode === 'hq' ? (
            <button key={status} type="button" aria-pressed={statusFilter === status} onClick={() => setStatusFilter((current) => current === status ? 'all' : status)} className={`rounded-xl border-2 p-3 text-center ${AGENDA_STATUS_STYLES[status]} ${statusFilter === status ? 'ring-4 ring-[#137586] ring-offset-2' : ''}`}>
              {statusFilter === status ? <span aria-hidden="true">✓ </span> : null}
              <span className="text-[13px] font-extrabold">{AGENDA_STATUS_LABELS[status]}</span>
              <strong className="mt-1 block text-[24px] font-black">{counts[status]}</strong>
            </button>
          ) : (
            <div key={status} className={`rounded-xl border p-3 text-center ${AGENDA_STATUS_STYLES[status]}`}>
              <span className="text-[13px] font-extrabold">{AGENDA_STATUS_LABELS[status]}</span>
              <strong className="mt-1 block text-[24px] font-black">{counts[status]}</strong>
            </div>
          ))}
        </div>
        {mode === 'hq' && statusFilter !== 'all' ? <button type="button" onClick={() => setStatusFilter('all')} className="mt-3 min-h-11 rounded-xl border-2 border-[#137586] bg-white px-4 font-extrabold text-[#137586]">전체 보기 · 상태 필터 해제</button> : null}

        <div className="mt-5 space-y-4">
          {displayedAgendas.length === 0 ? (
            <div className="rounded-2xl border border-[#C4D8E4] bg-white p-10 text-center text-[18px] font-bold text-[#64748B]">
              {mode === 'team' ? '배정된 주제가 아직 없습니다. 필요하면 새 주제를 추가해 주세요.' : '조건에 맞는 주제가 없습니다.'}
            </div>
          ) : null}
          {displayedAgendas.map((agenda) => {
            const agendaExpanded = mode === 'team' || expanded[agenda.id] === true;
            const teams = (payload?.teams ?? []).filter((team) => team.subgroup === agenda.subgroup);
            const recommendations = agenda.recommendations.filter((recommendation) =>
              (showArchived || !recommendation.archived)
              && (statusFilter === 'all' || recommendation.status === statusFilter),
            );
            const recommendationCreateKey = `recommendation:create:${agenda.id}`;
            const recommendationCreatePending = Boolean(pendingRequestIds[recommendationCreateKey]);
            const agendaCounts = statusCounts(recommendations.filter((recommendation) => !recommendation.archived).map((recommendation) => recommendation.status));
            return (
              <article data-agenda-subgroup={agenda.subgroup} key={agenda.id} className={`rounded-2xl border bg-white p-4 shadow-sm sm:p-5 ${agenda.archived ? 'border-[#CBD5E1] opacity-75' : 'border-[#DCE7EE]'}`}>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1 basis-full text-left sm:min-w-[260px] sm:basis-auto">
                    <p className="text-[13px] font-extrabold text-[#137586]">{agenda.subgroup} · 주제 {agenda.ordinal}{agenda.archived ? ' · 보관됨' : ''}</p>
                    <h3 className="mt-1 text-[22px] font-black leading-snug text-[#1F2933]">{agenda.title}</h3>
                    <div className="mt-3"><AssignmentSummary assignments={agenda.assignments} /></div>
                    <div className="mt-3 flex flex-wrap gap-1 text-[12px] font-extrabold text-[#5A6B73]">
                      <span className="rounded-lg bg-[#F1F5F9] px-2 py-1">권고안 {recommendations.filter((item) => !item.archived).length}건</span>
                      {AGENDA_STATUSES.filter((status) => agendaCounts[status] > 0).map((status) => <span key={status} className="rounded-lg bg-[#F1F5F9] px-2 py-1">{AGENDA_STATUS_LABELS[status]} {agendaCounts[status]}</span>)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mode === 'hq' ? <button type="button" aria-expanded={agendaExpanded} onClick={() => setExpanded((current) => ({ ...current, [agenda.id]: !agendaExpanded }))} className="min-h-11 rounded-xl border border-[#1F4E79] px-4 text-[14px] font-extrabold text-[#1F4E79]">권고안 {agendaExpanded ? '접기' : '펼치기'}</button> : null}
                    {!agenda.archived ? <button type="button" disabled={!topicWritesEnabled || anyRecommendationCreatePending} onClick={() => openRecommendationForm(agenda)} className="min-h-11 rounded-xl bg-[#137586] px-4 text-[14px] font-extrabold text-white disabled:opacity-40">+ 권고안 추가</button> : null}
                    {mode === 'hq' ? <button type="button" onClick={() => setProjectingAgendaId(agenda.id)} className="min-h-11 rounded-xl bg-[#087986] px-4 text-[14px] font-extrabold text-white">이 주제 송출</button> : null}
                  </div>
                </div>

                {mode === 'hq' && !agenda.archived ? (
                  <div className="mt-4 border-t border-[#E2E8F0] pt-4">
                    <p className="mb-2 text-[13px] font-extrabold text-[#5A6B73]">조 배정 · 여러 조 선택 가능</p>
                    <div className="flex flex-wrap gap-2">
                      {teams.map((team) => {
                        const assigned = agenda.assignments.some((item) => item.teamId === team.id);
                        const key = `assign:${agenda.id}:${team.id}`;
                        return (
                          <button key={team.id} type="button" disabled={busyKey === key} aria-pressed={assigned}
                            onClick={() => {
                              const snapshot = { agendaId: agenda.id, teamId: team.id, assigned: !assigned };
                              void runMutation(key, mutationPayloadFingerprint(snapshot), (requestId) => setAgendaAssignment({ token: token ?? '', agendaId: agenda.id, teamId: team.id, assigned: !assigned, requestId }));
                            }}
                            className={`min-h-11 rounded-xl border-2 px-4 text-[14px] font-extrabold ${assigned ? 'border-[#137586] bg-[#EAF8FA] text-[#135C73]' : 'border-[#CBD5E1] bg-white text-[#475569]'}`}>
                            {assigned ? '✓ ' : ''}{teamNumber(team)}조
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {!agenda.archived && recommendationFormOpen && recommendationFormAgendaId === agenda.id ? (
                  <section className="mt-4 rounded-2xl border-2 border-[#23B2C3] bg-[#F8FCFD] p-4" aria-labelledby={`new-recommendation-${agenda.id}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h4 id={`new-recommendation-${agenda.id}`} className="text-[19px] font-black text-[#1F4E79]">새 권고안 작성 · {agenda.title}</h4>
                      <button type="button" disabled={recommendationCreatePending} onClick={() => setRecommendationFormOpen(false)} className="min-h-11 rounded-lg border border-[#C4D8E4] bg-white px-3 font-bold disabled:opacity-40">닫기</button>
                    </div>
                    {mode === 'hq' ? (
                      <label className="mt-4 block max-w-sm text-[14px] font-extrabold text-[#334E5C]">작성 조
                        <select aria-label="새 권고안 작성 조" disabled={!topicWritesEnabled || recommendationCreatePending} value={recommendationTeamId} onChange={(event) => setRecommendationTeamId(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-[#C4D8E4] bg-white px-3 disabled:bg-[#F1F5F9]">
                          <option value="">배정 조 선택</option>
                          {agenda.assignments.map((assignment) => <option key={assignment.teamId} value={assignment.teamId}>{assignment.teamName}</option>)}
                        </select>
                      </label>
                    ) : <p className="mt-3 text-[14px] font-bold text-[#137586]">로그인한 조의 권고안으로 저장됩니다.</p>}
                    <div className="mt-4"><RecommendationFields value={newRecommendation} disabled={!topicWritesEnabled || recommendationCreatePending} prefix="새 권고안" onChange={setNewRecommendation} /></div>
                    <div className="mt-4 flex justify-end">
                      <button type="button" disabled={!topicWritesEnabled || busyKey === recommendationCreateKey} onClick={() => void submitRecommendation(agenda)} className="min-h-12 rounded-xl bg-[#1F4E79] px-6 font-extrabold text-white disabled:opacity-50">{recommendationCreatePending ? '같은 내용으로 다시 확인' : '새 권고안 저장'}</button>
                    </div>
                  </section>
                ) : null}

                {agendaExpanded ? (
                  <div className="mt-4 space-y-4 border-t border-[#E2E8F0] pt-4">
                    {recommendations.length === 0 ? <p className="rounded-xl bg-[#F8FAFC] p-5 text-center font-bold text-[#64748B]">아직 작성된 권고안이 없습니다. 위의 ‘+ 권고안 추가’를 눌러 시작하세요.</p> : null}
                    {recommendations.map((recommendation) => {
                      const notArchived = !agenda.archived && !recommendation.archived;
                      const recommendationEditable = canEditRecommendation({
                        agendaArchived: agenda.archived,
                        recommendationArchived: recommendation.archived,
                        status: recommendation.status,
                        mode,
                        teamId,
                        authorTeamId: recommendation.authorTeamId,
                      });
                      const baseEditable = topicWritesEnabled && recommendationEditable;
                      const saveKey = `recommendation:save:${recommendation.id}`;
                      const relatedPendingKeys = Object.keys(pendingRequestIds)
                        .filter((key) => key.endsWith(`:${recommendation.id}`));
                      const hasPendingMutation = relatedPendingKeys.length > 0;
                      const savePending = Boolean(pendingRequestIds[saveKey]);
                      const draft = currentDraft(recommendation);
                      return (
                        <section key={recommendation.id} data-recommendation-id={recommendation.id} data-recommendation-status={recommendation.status} className={`rounded-2xl border p-4 ${recommendation.archived ? 'border-[#CBD5E1] bg-[#F8FAFC]' : 'border-[#C4D8E4] bg-white'}`} aria-labelledby={`recommendation-${recommendation.id}`}>
                          <div className="flex flex-wrap items-start gap-3">
                            <div className="min-w-0 flex-1 basis-full sm:min-w-[220px] sm:basis-auto">
                              <p className="text-[13px] font-extrabold text-[#137586]">권고안 {recommendation.sortOrder} · {recommendation.authorTeamName}{recommendation.archived ? ' · 보관됨' : ''}</p>
                              <h4 id={`recommendation-${recommendation.id}`} className="mt-1 text-[20px] font-black text-[#1F2933]">{recommendation.title || '제목 작성 중'}</h4>
                            </div>
                            <StatusBadge status={recommendation.status} />
                          </div>
                          <ol aria-label="권고안 5단계 진행" className="mt-3 flex flex-wrap gap-2 text-[13px] font-extrabold">
                            {AGENDA_STATUSES.map((status, index) => <li key={status} aria-current={status === recommendation.status ? 'step' : undefined} className={`rounded-lg border px-3 py-2 ${status === recommendation.status ? 'border-[#137586] bg-[#EAF8FA] text-[#135C73]' : 'border-[#DCE7EE] text-[#64748B]'}`}>
                              {index < AGENDA_STATUSES.indexOf(recommendation.status) ? '✓ ' : `${index + 1}. `}{AGENDA_STATUS_LABELS[status]}
                            </li>)}
                          </ol>
                          {mode === 'team' && notArchived ? <p className="mt-2 text-[14px] font-bold text-[#334E5C]">
                            현재 {AGENDA_STATUS_LABELS[recommendation.status]} · {recommendation.status === 'waiting' ? '논의 시작을 눌러 주세요.' : recommendation.status === 'discussing' ? '문안을 작성하고 초안 작성 완료를 눌러 주세요.' : recommendation.status === 'drafting' ? '세 입력값을 확인한 뒤 조 확인 완료를 눌러 주세요.' : recommendation.status === 'team_confirmed' ? '조가 확인한 문안을 최종 제출해 주세요.' : '제출이 완료되었습니다.'}
                          </p> : null}
                          {recommendation.feedback ? <p className="mt-3 rounded-xl border-2 border-[#F59E0B] bg-[#FEF3C7] p-3 text-[15px] font-bold text-[#92400E]">HQ 보완 요청: {recommendation.feedback}</p> : null}
                          <div data-recommendation-actions className="mt-3 flex flex-wrap items-center gap-2">
                            {recommendationEditable && (mode === 'hq' || recommendation.status !== 'waiting') ? <button type="button" disabled={!topicWritesEnabled || !canSaveRecommendation({ editable: baseEditable, dirty: dirty[recommendation.id] === true, mode, status: recommendation.status }) || (hasPendingMutation && !savePending) || busyKey === saveKey} onClick={() => void saveRecommendation(recommendation)} className="min-h-11 rounded-xl bg-[#B45309] px-4 font-extrabold text-white disabled:opacity-40">{savePending ? '같은 초안으로 다시 확인' : recommendationSaveLabel(mode, recommendation.status)}</button> : null}
                            {notArchived && mode === 'team' && recommendation.status === 'waiting' ? <button type="button" disabled={!topicWritesEnabled || (hasPendingMutation && !pendingRequestIds[`start:${recommendation.id}`]) || busyKey === `start:${recommendation.id}`} onClick={() => void act(recommendation, 'start')} className="min-h-11 rounded-xl bg-[#0369A1] px-4 font-extrabold text-white disabled:opacity-40">{pendingRequestIds[`start:${recommendation.id}`] ? '논의 시작 다시 확인' : '논의 시작'}</button> : null}
                            {notArchived && mode === 'team' && recommendation.status === 'drafting' ? <button type="button" disabled={!topicWritesEnabled || (hasPendingMutation && !pendingRequestIds[`confirm:${recommendation.id}`]) || busyKey === `confirm:${recommendation.id}`} onClick={() => void act(recommendation, 'confirm')} className="min-h-11 rounded-xl bg-[#7E22CE] px-4 font-extrabold text-white disabled:opacity-40">{pendingRequestIds[`confirm:${recommendation.id}`] ? '조 확인 다시 확인' : '조 확인 완료'}</button> : null}
                            {notArchived && mode === 'team' && recommendation.status === 'team_confirmed' ? <button type="button" disabled={!topicWritesEnabled || (hasPendingMutation && !pendingRequestIds[`submit:${recommendation.id}`]) || busyKey === `submit:${recommendation.id}`} onClick={() => void act(recommendation, 'submit')} className="min-h-11 rounded-xl bg-[#047857] px-4 font-extrabold text-white disabled:opacity-40">{pendingRequestIds[`submit:${recommendation.id}`] ? '최종 제출 다시 확인' : '최종 제출'}</button> : null}
                            {notArchived && mode === 'hq' && (recommendation.status === 'team_confirmed' || recommendation.status === 'submitted') ? (
                              <>
                                <input aria-label={`${recommendation.title} 보완 요청`} disabled={!topicWritesEnabled || hasPendingMutation} value={feedbacks[recommendation.id] ?? ''} onChange={(event) => setFeedbacks((current) => ({ ...current, [recommendation.id]: event.target.value }))} placeholder="구체적인 보완 요청" className="min-h-11 min-w-0 flex-1 basis-full rounded-xl border border-[#C4D8E4] px-3 disabled:bg-[#F1F5F9] sm:min-w-[220px] sm:basis-auto" />
                                <button type="button" disabled={!topicWritesEnabled || (!feedbacks[recommendation.id]?.trim() && !pendingRequestIds[`revision_request:${recommendation.id}`]) || (hasPendingMutation && !pendingRequestIds[`revision_request:${recommendation.id}`])} onClick={() => void act(recommendation, 'revision_request')} className="min-h-11 rounded-xl bg-[#B45309] px-4 font-extrabold text-white disabled:opacity-40">{pendingRequestIds[`revision_request:${recommendation.id}`] ? '보완 요청 다시 확인' : '보완 요청'}</button>
                                <button type="button" disabled={!topicWritesEnabled || (hasPendingMutation && !pendingRequestIds[`reopen:${recommendation.id}`])} onClick={() => void act(recommendation, 'reopen')} className="min-h-11 rounded-xl border border-[#1F4E79] px-4 font-extrabold text-[#1F4E79] disabled:opacity-40">{pendingRequestIds[`reopen:${recommendation.id}`] ? '재열기 다시 확인' : '재열기'}</button>
                              </>
                            ) : null}
                            {notArchived && mode === 'hq' ? <button type="button" disabled={hasPendingMutation && !pendingRequestIds[`recommendation:archive:${recommendation.id}`]} onClick={() => archiveRecommendationItem(recommendation)} className="min-h-11 rounded-xl border border-[#9A3412] px-4 font-extrabold text-[#9A3412] disabled:opacity-40">{pendingRequestIds[`recommendation:archive:${recommendation.id}`] ? '권고안 보관 다시 확인' : '권고안 보관'}</button> : null}
                            <span className="ml-auto text-[13px] font-bold text-[#64748B]">서버 갱신 {formatUpdatedAt(recommendation.updatedAt)} · 수정이력 {recommendation.revisionCount}건{dirty[recommendation.id] ? ' · 기기 초안 미전송' : ''}</span>
                          </div>
                          <div className="mt-4">
                            <RecommendationFields value={draft} disabled={!baseEditable || hasPendingMutation} prefix={`${recommendation.authorTeamName} 권고안 ${recommendation.sortOrder}`} onChange={(next) => updateDraft(recommendation, next)} />
                          </div>
                          {recommendation.expectedEffect ? (
                            <details className="mt-4 rounded-xl border border-[#DCE7EE] bg-[#F8FAFC] p-3">
                              <summary className="cursor-pointer text-[14px] font-extrabold text-[#475569]">기존 기대효과 보기 · 지금은 입력하지 않음</summary>
                              <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-[#475569]">{recommendation.expectedEffect}</p>
                            </details>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
      {projecting ? <ProjectorView item={projecting} onClose={() => setProjectingAgendaId(null)} /> : null}
      {projectingDivision ? (
        <DivisionProjectorView
          division={projectingDivision}
          agendas={(payload?.agendas ?? []).filter((agenda) => !agenda.archived && agenda.subgroup === projectingDivision)}
          onClose={() => setProjectingDivision(null)}
        />
      ) : null}
    </section>
  );
}
