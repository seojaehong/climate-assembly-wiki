import { getSupabase } from './supabase';
import type { AgendaProgressAction, AgendaStatus } from '../islands/mod/agenda-progress-logic';

export const AGENDA_SESSION_SLUG = '0912-deliberation';

export type AgendaStage = {
  id: string;
  ordinal: number;
  prompt: string;
  status: 'open' | 'closed';
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
  status: AgendaStatus;
  publicDraft: string | null;
  feedback: string | null;
  updatedAt: string;
};

export type AgendaBoardItem = {
  id: string;
  subgroup: string;
  ordinal: number;
  title: string;
  suggestedTeamNumbers: number[];
  sourceUtterances: string[];
  assignments: AgendaAssignment[];
};

export type AgendaBoardPayload = {
  sessionSlug: string;
  scope: 'hq' | 'team';
  teamId: string | null;
  activeStage: AgendaStage | null;
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

export async function fetchAgendaBoard(
  token: string,
  sessionSlug: string = AGENDA_SESSION_SLUG,
): Promise<AgendaBoardPayload> {
  const { data, error } = await client().schema('climate_vote').rpc('agenda_board_v1', {
    p_token: token,
    p_session_slug: sessionSlug,
  });
  if (error) throw readableError(error, '진행상황판을 불러오지 못했습니다.');
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('진행상황판 서버 응답 형식이 올바르지 않습니다.');
  }
  return data as AgendaBoardPayload;
}

export async function setAgendaAssignment(input: {
  token: string;
  agendaId: string;
  teamId: string;
  assigned: boolean;
  requestId: string;
  sessionSlug?: string;
}): Promise<void> {
  const { error } = await client().schema('climate_vote').rpc('agenda_assignment_set_v1', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_agenda_id: input.agendaId,
    p_team_id: input.teamId,
    p_assigned: input.assigned,
    p_request_id: input.requestId,
  });
  if (error) throw readableError(error, '조 배정을 저장하지 못했습니다.');
}

export async function writeAgendaProgress(input: {
  token: string;
  topicId: string;
  agendaId: string;
  teamId: string;
  action: AgendaProgressAction;
  publicDraft: string | null;
  feedback: string | null;
  requestId: string;
  sessionSlug?: string;
}): Promise<void> {
  const { error } = await client().schema('climate_vote').rpc('agenda_progress_write_v1', {
    p_token: input.token,
    p_session_slug: input.sessionSlug ?? AGENDA_SESSION_SLUG,
    p_topic_id: input.topicId,
    p_agenda_id: input.agendaId,
    p_team_id: input.teamId,
    p_action: input.action,
    p_public_draft: input.publicDraft,
    p_feedback: input.feedback,
    p_request_id: input.requestId,
  });
  if (error) throw readableError(error, '진행상태를 저장하지 못했습니다.');
}
