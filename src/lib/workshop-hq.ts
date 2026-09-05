import { getSupabase } from './supabase';

export type WorkshopHqStatus = {
  session_id: string;
  session_slug: string;
  session_title: string;
  org_name: string;
  topic_total: number;
  topic_open: number;
  topic_closed: number;
  next_topic_id: string | null;
  next_topic_ordinal: number | null;
  next_topic_prompt: string | null;
  teams_total: number;
  active_devices: number;
  teams_online: number;
  submissions_draft: number;
  submissions_final: number;
  last_activity_at: string | null;
  topics: Array<{
    id: string;
    ordinal: number;
    prompt: string;
    status: 'draft' | 'open' | 'closed';
    deadline_at: string | null;
  }>;
};

export type WorkshopDevice = {
  token_hash: string;
  team_id: string;
  team_name: string;
  device_id: string;
  device_label: string;
  last_seen_at: string;
  expires_at: string;
};

export type OpenTopicResult = {
  status: 'opened' | 'already_open';
  topic_id: string;
  ordinal: number;
  prompt: string;
  audit_id: number;
};

export type TopicStatusResult =
  | {
      status: 'updated';
      topic_id: string;
      previous_status: string;
      current_status: string;
      audit_id: number;
    }
  | {
      status: 'conflict';
      topic_id: string;
      current_status: string;
      expected_status: string;
    };

export class WorkshopHqConflictError extends Error {
  readonly result: Extract<TopicStatusResult, { status: 'conflict' }>;

  constructor(result: Extract<TopicStatusResult, { status: 'conflict' }>) {
    super('workshop_hq_state_conflict');
    this.name = 'WorkshopHqConflictError';
    this.result = result;
  }
}

export type DeadlineUpdateResult =
  | {
      status: 'updated';
      topic_id: string;
      previous_deadline_at: string | null;
      deadline_at: string | null;
      audit_id: number;
    }
  | {
      status: 'conflict';
      topic_id: string;
      deadline_at: string | null;
      expected_deadline_at: string | null;
    };

export class WorkshopHqDeadlineConflictError extends Error {
  readonly result: Extract<DeadlineUpdateResult, { status: 'conflict' }>;

  constructor(result: Extract<DeadlineUpdateResult, { status: 'conflict' }>) {
    super('workshop_hq_deadline_conflict');
    this.name = 'WorkshopHqDeadlineConflictError';
    this.result = result;
  }
}

function client() {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase client unavailable (missing env)');
  return sb;
}

function rpcError(error: { code?: string; message?: string }): Error {
  return new Error(`${error.code ?? 'rpc'}: ${error.message ?? '알 수 없는 오류'}`);
}

export async function fetchWorkshopHqStatus(token: string, sessionSlug: string): Promise<WorkshopHqStatus> {
  const { data, error } = await client().schema('climate_vote').rpc('workshop_hq_status', {
    p_token: token,
    p_session_slug: sessionSlug,
  });
  if (error) throw rpcError(error);
  return data as WorkshopHqStatus;
}

export async function fetchWorkshopDevices(token: string, sessionSlug: string): Promise<WorkshopDevice[]> {
  const { data, error } = await client().schema('climate_vote').rpc('workshop_hq_devices', {
    p_token: token,
    p_session_slug: sessionSlug,
  });
  if (error) throw rpcError(error);
  return (data ?? []) as WorkshopDevice[];
}

export async function openNextWorkshopTopic(
  token: string,
  sessionSlug: string,
  expectedOrdinal: number,
  idempotencyKey: string,
): Promise<OpenTopicResult> {
  const { data, error } = await client().schema('climate_vote').rpc('workshop_hq_open_next_topic', {
    p_token: token,
    p_session_slug: sessionSlug,
    p_expected_ordinal: expectedOrdinal,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw rpcError(error);
  return data as OpenTopicResult;
}

export async function setWorkshopTopicStatus(
  token: string,
  sessionSlug: string,
  topicId: string,
  expectedStatus: 'draft' | 'open' | 'closed',
  status: 'open' | 'closed',
  idempotencyKey: string,
): Promise<TopicStatusResult> {
  const { data, error } = await client().schema('climate_vote').rpc('workshop_hq_set_topic_status', {
    p_token: token,
    p_session_slug: sessionSlug,
    p_topic_id: topicId,
    p_expected_status: expectedStatus,
    p_status: status,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw rpcError(error);
  const result = data as TopicStatusResult;
  if (result?.status === 'conflict') throw new WorkshopHqConflictError(result);
  return result;
}

export async function revokeWorkshopDevice(
  token: string,
  sessionSlug: string,
  tokenHash: string,
  reason: string,
  idempotencyKey: string,
): Promise<void> {
  const { error } = await client().schema('climate_vote').rpc('workshop_hq_revoke_device', {
    p_token: token,
    p_session_slug: sessionSlug,
    p_token_hash: tokenHash,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw rpcError(error);
}

export async function setWorkshopDeadline(
  token: string,
  sessionSlug: string,
  topicId: string,
  expectedDeadlineAt: string | null,
  deadlineAt: string | null,
  idempotencyKey: string,
): Promise<DeadlineUpdateResult> {
  const { data, error } = await client().schema('climate_vote').rpc('workshop_hq_set_deadline', {
    p_token: token,
    p_session_slug: sessionSlug,
    p_topic_id: topicId,
    p_expected_deadline_at: expectedDeadlineAt,
    p_deadline_at: deadlineAt,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw rpcError(error);
  const result = data as DeadlineUpdateResult;
  if (result?.status === 'conflict') throw new WorkshopHqDeadlineConflictError(result);
  return result;
}
