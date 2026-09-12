import { getSupabase } from './supabase';
import type {
  AgendaProgressAction,
  AgendaStatus,
  RecommendationDraft,
} from '../islands/mod/agenda-progress-logic';

export const AGENDA_SESSION_SLUG = '0912-deliberation';

export type AgendaStage = {
  id: string;
  ordinal: number;
  prompt: string;
  status: 'draft' | 'open' | 'closed';
};

export type AgendaTeam = {
  id: string;
  name: string;
  subgroup: string;
  tableNo: string | null;
};

export type AgendaAssignment = {
  teamId: string;
  teamName: string;
  assignedAt: string;
};

export type RecommendationRevision = RecommendationDraft & {
  id: number;
  version: number;
  topicId: string;
  expectedEffect: string | null;
  createdAt: string;
  actorLabel: string | null;
};

export type RecommendationProgress = {
  id: number;
  topicId: string;
  action: AgendaProgressAction;
  status: AgendaStatus;
  feedback: string | null;
  createdAt: string;
  actorLabel: string | null;
};

export type AgendaRecommendation = Omit<RecommendationDraft, 'expectedEffect'> & {
  id: string;
  authorTeamId: string;
  authorTeamName: string;
  sortOrder: number;
  expectedEffect: string | null;
  status: AgendaStatus;
  feedback: string | null;
  updatedAt: string;
  archived: boolean;
  revisionVersion: number;
  revisionCount: number;
  progressCount: number;
};

export type AgendaBoardItem = {
  id: string;
  subgroup: string;
  ordinal: number;
  title: string;
  archived: boolean;
  createdAt: string;
  sourceUtterances: string[];
  assignments: AgendaAssignment[];
  recommendations: AgendaRecommendation[];
};

export type AgendaBoardPayload = {
  version: 3;
  sessionSlug: string;
  scope: 'hq' | 'team';
  teamId: string | null;
  teamSubgroup: string | null;
  activeStage: AgendaStage | null;
  stageIntegrity: {
    openStageCount: number;
    writable: boolean;
  };
  stages: AgendaStage[];
  teams: AgendaTeam[];
  agendas: AgendaBoardItem[];
};

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('진행상황판 서버 연결을 초기화하지 못했습니다.');
  return supabase;
}

function readableError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}

async function mutation(name: string, args: Record<string, unknown>, fallback: string): Promise<void> {
  const { error } = await client().schema('climate_vote').rpc(name, args);
  if (error) throw readableError(error, fallback);
}

export async function fetchAgendaBoard(
  token: string,
  sessionSlug: string = AGENDA_SESSION_SLUG,
): Promise<AgendaBoardPayload> {
  const { data, error } = await client().schema('climate_vote').rpc('agenda_board_v2', {
    p_token: token,
    p_session_slug: sessionSlug,
  });
  if (error) throw readableError(error, '진행상황판을 불러오지 못했습니다.');
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('진행상황판 서버 응답 형식이 올바르지 않습니다.');
  }
  return data as AgendaBoardPayload;
}

export async function createAgenda(input: {
  token: string; subgroup: string; title: string; sourceUtterance: string;
  requestId: string; sessionSlug?: string;
}): Promise<void> {
  return mutation('agenda_create_v2', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_subgroup: input.subgroup,
    p_title: input.title,
    p_source_utterance: input.sourceUtterance,
    p_request_id: input.requestId,
  }, '새 의제를 추가하지 못했습니다.');
}

export async function updateAgenda(input: {
  token: string; agendaId: string; title: string; sourceUtterance: string;
  requestId: string; sessionSlug?: string;
}): Promise<void> {
  return mutation('agenda_update_v2', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_agenda_id: input.agendaId,
    p_title: input.title,
    p_source_utterance: input.sourceUtterance,
    p_request_id: input.requestId,
  }, '주제 수정을 저장하지 못했습니다.');
}

export async function archiveAgenda(input: {
  token: string; agendaId: string; reason: string; requestId: string; sessionSlug?: string;
}): Promise<void> {
  return mutation('agenda_archive_v2', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_agenda_id: input.agendaId,
    p_reason: input.reason,
    p_request_id: input.requestId,
  }, '의제를 보관하지 못했습니다.');
}

export async function setAgendaAssignment(input: {
  token: string; agendaId: string; teamId: string; assigned: boolean;
  requestId: string; sessionSlug?: string;
}): Promise<void> {
  return mutation('agenda_assignment_set_v2', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_agenda_id: input.agendaId,
    p_team_id: input.teamId,
    p_assigned: input.assigned,
    p_request_id: input.requestId,
  }, '조 배정을 저장하지 못했습니다.');
}

export async function createRecommendation(input: {
  token: string; agendaId: string; teamId: string; draft: RecommendationDraft;
  expectedEffect?: string | null; topicId: string; requestId: string; sessionSlug?: string;
}): Promise<void> {
  return mutation('recommendation_create_v2', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_agenda_id: input.agendaId,
    p_team_id: input.teamId,
    p_title: input.draft.title,
    p_problem_recognition: input.draft.problemRecognition,
    p_recommendation_content: input.draft.recommendationContent,
    p_expected_effect: input.expectedEffect ?? null,
    p_request_id: input.requestId,
    p_topic_id: input.topicId,
  }, '권고안을 추가하지 못했습니다.');
}

export async function reviseRecommendation(input: {
  token: string; recommendationId: string; draft: RecommendationDraft;
  expectedEffect?: string | null; expectedVersion: number;
  topicId: string; requestId: string; sessionSlug?: string;
}): Promise<void> {
  return mutation('recommendation_revise_v2', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_recommendation_id: input.recommendationId,
    p_title: input.draft.title,
    p_problem_recognition: input.draft.problemRecognition,
    p_recommendation_content: input.draft.recommendationContent,
    p_expected_effect: input.expectedEffect ?? null,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
    p_topic_id: input.topicId,
  }, '권고안을 저장하지 못했습니다.');
}

export async function archiveRecommendation(input: {
  token: string; recommendationId: string; reason: string; requestId: string; sessionSlug?: string;
}): Promise<void> {
  return mutation('recommendation_archive_v2', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_recommendation_id: input.recommendationId,
    p_reason: input.reason,
    p_request_id: input.requestId,
  }, '권고안을 보관하지 못했습니다.');
}

export async function writeRecommendationProgress(input: {
  token: string; recommendationId: string; action: AgendaProgressAction;
  feedback?: string | null; topicId: string; requestId: string; sessionSlug?: string;
}): Promise<void> {
  return mutation('recommendation_progress_v2', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_recommendation_id: input.recommendationId,
    p_action: input.action,
    p_feedback: input.feedback ?? null,
    p_request_id: input.requestId,
    p_topic_id: input.topicId,
  }, '권고안 진행상태를 저장하지 못했습니다.');
}
