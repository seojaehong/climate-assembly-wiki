export const AGENDA_STATUSES = [
  'waiting',
  'discussing',
  'drafting',
  'team_confirmed',
  'submitted',
] as const;

export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

export const AGENDA_STATUS_LABELS: Readonly<Record<AgendaStatus, string>> = {
  waiting: '대기',
  discussing: '논의 중',
  drafting: '초안 작성',
  team_confirmed: '조 확인',
  submitted: '제출 완료',
};

export const AGENDA_STATUS_STYLES: Readonly<Record<AgendaStatus, string>> = {
  waiting: 'border-[#CBD5E1] bg-[#F8FAFC] text-[#475569]',
  discussing: 'border-[#38BDF8] bg-[#E0F2FE] text-[#075985]',
  drafting: 'border-[#F59E0B] bg-[#FEF3C7] text-[#92400E]',
  team_confirmed: 'border-[#A78BFA] bg-[#F3E8FF] text-[#6B21A8]',
  submitted: 'border-[#34D399] bg-[#D1FAE5] text-[#065F46]',
};

export type AgendaProgressAction =
  | 'start'
  | 'save'
  | 'confirm'
  | 'submit'
  | 'revision_request'
  | 'reopen';

export function nextAgendaStatus(
  current: AgendaStatus,
  action: AgendaProgressAction,
  hasDraft: boolean,
): AgendaStatus | null {
  switch (action) {
    case 'start':
      return current === 'waiting' || current === 'discussing' ? 'discussing' : null;
    case 'save':
      return hasDraft && (current === 'discussing' || current === 'drafting') ? 'drafting' : null;
    case 'confirm':
      return hasDraft && current === 'drafting' ? 'team_confirmed' : null;
    case 'submit':
      return hasDraft && current === 'team_confirmed' ? 'submitted' : null;
    case 'revision_request':
      return current === 'team_confirmed' || current === 'submitted' ? 'drafting' : null;
    case 'reopen':
      return current === 'team_confirmed' || current === 'submitted' ? 'drafting' : null;
  }
}

export function statusCounts(statuses: readonly AgendaStatus[]): Record<AgendaStatus, number> {
  const counts: Record<AgendaStatus, number> = {
    waiting: 0,
    discussing: 0,
    drafting: 0,
    team_confirmed: 0,
    submitted: 0,
  };
  for (const status of statuses) counts[status] += 1;
  return counts;
}

export type RecommendationDraft = {
  title: string;
  problemRecognition: string;
  recommendationContent: string;
  // Missing on drafts saved before the evening-presentation editor existed.
  expectedEffect?: string;
};

export function recommendationExpectedEffect(
  draft: RecommendationDraft,
  serverValue: string | null,
): string | null {
  return draft.expectedEffect === undefined ? serverValue : draft.expectedEffect.trim() || null;
}

export type PendingAgendaForm = {
  open: boolean;
  title: string;
  sourceUtterance: string;
  subgroup: string;
};

export type PendingRecommendationForm = {
  open: boolean;
  agendaId: string;
  teamId: string;
  draft: RecommendationDraft;
};

export type AgendaBoardPendingState = {
  requestIds: Record<string, string>;
  requestFingerprints: Record<string, string>;
  agendaForm: PendingAgendaForm;
  recommendationForm: PendingRecommendationForm | null;
};

export const EMPTY_RECOMMENDATION_DRAFT: Readonly<RecommendationDraft> = {
  title: '',
  problemRecognition: '',
  recommendationContent: '',
};

export function emptyAgendaBoardPendingState(subgroup: string): AgendaBoardPendingState {
  return {
    requestIds: {},
    requestFingerprints: {},
    agendaForm: {
      open: false,
      title: '',
      sourceUtterance: '',
      subgroup,
    },
    recommendationForm: null,
  };
}

export function agendaBoardPendingStorageKey(
  mode: 'hq' | 'team',
  teamId: string | null | undefined,
  subgroup: string | null | undefined,
): string {
  const scope = mode === 'hq' ? 'hq' : (teamId?.trim() || subgroup?.trim() || 'team-unresolved');
  return `climate_agenda_board_pending_v2:${mode}:${scope}`;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}

function isRecommendationDraft(value: unknown): value is RecommendationDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.title === 'string'
    && typeof candidate.problemRecognition === 'string'
    && typeof candidate.recommendationContent === 'string'
    && (candidate.expectedEffect === undefined || typeof candidate.expectedEffect === 'string');
}

export function parseAgendaBoardPendingState(
  raw: string | null,
  fallbackSubgroup: string,
): AgendaBoardPendingState {
  const fallback = emptyAgendaBoardPendingState(fallbackSubgroup);
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return fallback;
    const candidate = parsed as Record<string, unknown>;
    const agenda = candidate.agendaForm;
    if (typeof agenda !== 'object' || agenda === null || Array.isArray(agenda)) return fallback;
    const agendaCandidate = agenda as Record<string, unknown>;
    if (
      typeof agendaCandidate.open !== 'boolean'
      || typeof agendaCandidate.title !== 'string'
      || typeof agendaCandidate.sourceUtterance !== 'string'
      || typeof agendaCandidate.subgroup !== 'string'
    ) return fallback;

    let recommendationForm: PendingRecommendationForm | null = null;
    if (candidate.recommendationForm !== null && candidate.recommendationForm !== undefined) {
      const recommendation = candidate.recommendationForm;
      if (typeof recommendation !== 'object' || Array.isArray(recommendation)) return fallback;
      const recommendationCandidate = recommendation as Record<string, unknown>;
      if (
        typeof recommendationCandidate.open !== 'boolean'
        || typeof recommendationCandidate.agendaId !== 'string'
        || typeof recommendationCandidate.teamId !== 'string'
        || !isRecommendationDraft(recommendationCandidate.draft)
      ) return fallback;
      recommendationForm = {
        open: recommendationCandidate.open,
        agendaId: recommendationCandidate.agendaId,
        teamId: recommendationCandidate.teamId,
        draft: recommendationCandidate.draft,
      };
    }

    const parsedRequestIds = isStringRecord(candidate.requestIds) ? candidate.requestIds : {};
    const parsedFingerprints = isStringRecord(candidate.requestFingerprints)
      ? candidate.requestFingerprints
      : {};
    const requestIds: Record<string, string> = {};
    const requestFingerprints: Record<string, string> = {};
    for (const [key, requestId] of Object.entries(parsedRequestIds)) {
      const fingerprint = parsedFingerprints[key];
      if (!fingerprint) continue;
      requestIds[key] = requestId;
      requestFingerprints[key] = fingerprint;
    }

    return {
      requestIds,
      requestFingerprints,
      agendaForm: {
        open: agendaCandidate.open,
        title: agendaCandidate.title,
        sourceUtterance: agendaCandidate.sourceUtterance,
        subgroup: agendaCandidate.subgroup,
      },
      recommendationForm,
    };
  } catch {
    return fallback;
  }
}

export function mutationRequestId(
  requestIds: Readonly<Record<string, string>>,
  mutationKey: string,
  createId: () => string,
): string {
  return requestIds[mutationKey] ?? createId();
}

export function mutationPayloadFingerprint(payload: unknown): string {
  return JSON.stringify(payload);
}

export function pendingMutationMatches(
  requestIds: Readonly<Record<string, string>>,
  requestFingerprints: Readonly<Record<string, string>>,
  mutationKey: string,
  fingerprint: string,
): boolean {
  return !requestIds[mutationKey] || requestFingerprints[mutationKey] === fingerprint;
}

export function pendingRecommendationSaveDrafts(
  requestIds: Readonly<Record<string, string>>,
  requestFingerprints: Readonly<Record<string, string>>,
): Record<string, RecommendationDraft> {
  const drafts: Record<string, RecommendationDraft> = {};
  for (const mutationKey of Object.keys(requestIds)) {
    const match = /^recommendation:save:(.+)$/.exec(mutationKey);
    if (!match) continue;
    const recommendationId = match[1];
    const fingerprint = requestFingerprints[mutationKey];
    if (!fingerprint) continue;
    try {
      const parsed: unknown = JSON.parse(fingerprint);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      const snapshot = parsed as Record<string, unknown>;
      if (
        snapshot.recommendationId !== recommendationId
        || !isRecommendationDraft(snapshot.draft)
        || !Number.isInteger(snapshot.expectedVersion)
        || (snapshot.expectedVersion as number) < 1
        || typeof snapshot.topicId !== 'string'
        || !snapshot.topicId.trim()
      ) continue;
      drafts[recommendationId] = { ...snapshot.draft };
    } catch {
      continue;
    }
  }
  return drafts;
}

export function topicIdForPendingMutation(
  requestFingerprints: Readonly<Record<string, string>>,
  mutationKey: string,
  activeTopicId: string | null,
): string | null {
  const fingerprint = requestFingerprints[mutationKey];
  if (!fingerprint) return activeTopicId;
  try {
    const parsed: unknown = JSON.parse(fingerprint);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return activeTopicId;
    const topicId = (parsed as Record<string, unknown>).topicId;
    return typeof topicId === 'string' && topicId.trim() ? topicId : activeTopicId;
  } catch {
    return activeTopicId;
  }
}

export function isRevisionConflictMessage(message: string): boolean {
  return /revision version conflict|expected revision|stale(?: recommendation)? revision|concurrent revision/i.test(message);
}

export function isWorkflowStageConflictMessage(message: string): boolean {
  return /workflow stage must be the single open stage|exactly one open workflow stage required/i.test(message);
}

export function withoutRecordKey<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function pendingRecordAfterMutationFailure<T>(
  record: Readonly<Record<string, T>>,
  mutationKey: string,
  errorMessage: string,
): Record<string, T> {
  return isRevisionConflictMessage(errorMessage) || isWorkflowStageConflictMessage(errorMessage)
    ? withoutRecordKey(record, mutationKey)
    : { ...record };
}

export function canEditRecommendation(input: {
  agendaArchived: boolean;
  recommendationArchived: boolean;
  status: AgendaStatus;
  mode: 'hq' | 'team';
  teamId: string | undefined;
  authorTeamId: string;
}): boolean {
  if (input.agendaArchived || input.recommendationArchived) return false;
  if (input.status !== 'discussing' && input.status !== 'drafting') return false;
  return input.mode === 'hq' || input.authorTeamId === input.teamId;
}

export function canWriteActiveAgendaStage(
  activeStage: { id: string } | null | undefined,
  stageIntegrity: { writable: boolean } | null | undefined,
): boolean {
  return Boolean(activeStage?.id.trim() && stageIntegrity?.writable === true);
}

export function canSaveRecommendation(input: {
  editable: boolean;
  dirty: boolean;
  mode: 'hq' | 'team';
  status: AgendaStatus;
}): boolean {
  if (!input.editable) return false;
  if (input.mode === 'hq') return input.dirty;
  if (input.status === 'discussing') return true;
  return input.status === 'drafting' && input.dirty;
}

export function recommendationSaveLabel(
  mode: 'hq' | 'team',
  status: AgendaStatus,
): string {
  if (mode === 'hq') return '수정 저장';
  return status === 'discussing' ? '초안 작성 완료' : '초안 저장';
}

export function hasRecommendationContent(draft: RecommendationDraft): boolean {
  return Boolean(
    draft.title.trim()
    && draft.problemRecognition.trim()
    && draft.recommendationContent.trim(),
  );
}

export function normalizeAgendaTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function similarAgendaTitles(
  candidate: string,
  titles: readonly string[],
): string[] {
  const normalizedCandidate = normalizeAgendaTitle(candidate);
  if (normalizedCandidate.length < 2) return [];
  const candidateWords = new Set(normalizedCandidate.split(' ').filter((word) => word.length >= 2));

  return titles.filter((title) => {
    const normalizedTitle = normalizeAgendaTitle(title);
    if (!normalizedTitle) return false;
    if (
      normalizedTitle === normalizedCandidate
      || normalizedTitle.includes(normalizedCandidate)
      || normalizedCandidate.includes(normalizedTitle)
    ) return true;
    const titleWords = normalizedTitle.split(' ').filter((word) => word.length >= 2);
    return titleWords.filter((word) => candidateWords.has(word)).length >= 2;
  });
}

export function recommendationMatchesSearch(
  search: string,
  values: readonly (string | null | undefined)[],
): boolean {
  const query = normalizeAgendaTitle(search);
  if (!query) return true;
  return values.some((value) => normalizeAgendaTitle(value ?? '').includes(query));
}

export function dirtyMapForRecoveredDrafts(
  drafts: Readonly<Record<string, RecommendationDraft>>,
): Record<string, boolean> {
  return Object.fromEntries(Object.keys(drafts).map((id) => [id, true]));
}

export function recommendationProgressBlockMessage(
  action: AgendaProgressAction,
  draft: RecommendationDraft,
  dirty: boolean,
): string | null {
  if ((action === 'confirm' || action === 'submit') && dirty) {
    return action === 'submit'
      ? '이 기기에 미전송 초안이 있어 최종 제출할 수 없습니다. HQ에 재열기를 요청한 뒤 초안을 저장해 주세요.'
      : '수정한 내용을 먼저 초안 저장한 뒤 조 확인을 완료해 주세요.';
  }
  if (action === 'confirm' && !hasRecommendationContent(draft)) {
    return '조 확인 전에는 권고안 제목, 배경·문제 인식, 권고 내용을 모두 작성해 주세요.';
  }
  return null;
}

export function subgroupSortKey(subgroup: string): number {
  const match = /^(\d+)분과$/.exec(subgroup.trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
