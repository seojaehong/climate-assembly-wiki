// 공론화 SaaS 플랫폼 — 데이터 레이어 (BUILD_SPEC §4-2 "데이터 연결")
//
// Tenant invariant: domain RPCs never accept org_id. org_select is the only
// selection exception and validates the authenticated session and membership.
//
// ★ 런타임 흡수(BUILD_SPEC §4 산출물 6): 플랫폼 스키마(platform_p1/p2)는 아직 어느 DB에도
//   미적용이라 대부분의 경로가 살아 있지 않다. 모든 데이터 호출을 단 하나의 오류 흡수 헬퍼
//   guard() 로 감싸 { data, notice } 를 돌려준다 — 화면은 예외 대신 안내 문구를 띄운다.
//   빌드는 언제나 통과한다.

import { getSupabase } from './supabase';
import { type TreeNode } from '../islands/platform/platform-nav-logic';
import type { BallotListRow, BallotResults } from './deliberation';

const SCHEMA = 'climate_vote';

/** 모든 플랫폼 데이터 호출의 반환형 — 예외 대신 notice 로 실패를 전달. */
export interface PlatformResult<T> {
  data: T | null;
  notice: string | null;
}

export interface PlatformAuditEvent {
  id: string;
  occurred_at: string;
  transaction_id: string;
  actor_user_id: string | null;
  actor_role: string;
  operation: 'insert' | 'update' | 'delete';
  resource_type: string;
  resource_id: string;
  changed_fields: string[];
}

export interface PlatformAuditPage {
  events: PlatformAuditEvent[];
  next_after_id: string | null;
}

/** Selected-organization audit metadata. The server derives org_id from the Auth context. */
export async function platformAuditList(
  afterId: string | null = null,
  limit = 100,
): Promise<PlatformResult<PlatformAuditPage>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_audit_list', {
      p_after_id: afterId,
      p_limit: limit,
    });
    if (error) throw error;
    return data as PlatformAuditPage;
  });
}

/** Supabase/PostgREST 오류를 한국어 안내로 번역(스키마 미적용·다중 org 등). */
function describeError(e: unknown, missingFunctionNotice?: string): string {
  const err = e as { code?: string; message?: string } | null;
  const msg = err?.message ?? '';
  const code = err?.code ?? '';
  // PostgREST: 함수/스키마 미적용
  if (code === 'PGRST202' || /Could not find the function|schema cache/i.test(msg)) {
    if (missingFunctionNotice) return missingFunctionNotice;
    return '플랫폼 스키마가 아직 적용되지 않았습니다(platform_p1/p2 미적용). 병합 후 동작합니다.';
  }
  if (/organization selection required|organization context/i.test(msg)) {
    return '여러 기관에 소속되어 있습니다. 사용할 기관을 선택해 주세요.';
  }
  // 권한(휴면 RLS·revoke) — staff GRANT 미활성
  if (code === '42501' || /permission denied/i.test(msg)) {
    return '접근 권한이 없습니다(staff 세션 RLS 휴면 — 활성화 GRANT 미적용).';
  }
  return msg || '요청을 처리하지 못했습니다.';
}

/**
 * 단일 오류 흡수 지점. Supabase 클라이언트가 없거나(env 미설정) 호출이 실패하면
 * notice 로 감싸 돌려준다. 어떤 패널도 자체 try/catch 를 두지 않는다.
 */
async function guard<T>(
  fn: (sb: NonNullable<ReturnType<typeof getSupabase>>) => Promise<T>,
  missingFunctionNotice?: string,
): Promise<PlatformResult<T>> {
  const sb = getSupabase();
  if (!sb) return { data: null, notice: '연결 설정이 없습니다(PUBLIC_SUPABASE_* 미설정).' };
  try {
    const data = await fn(sb);
    return { data, notice: null };
  } catch (e) {
    return { data: null, notice: describeError(e, missingFunctionNotice) };
  }
}

// ── 인증 (Supabase Auth staff 세션) ─────────────────────────────────────
// BUILD_SPEC §2: staff(운영자·기관관리자·본부)는 Supabase Auth 계정 + membership.
// Auth 미설정 DB 에서도 빌드·마운트는 통과하고, 실패는 notice 로 흡수한다.

export interface AuthSessionInfo {
  userId: string;
  email: string | null;
}

/** 이메일·비밀번호 로그인. 성공 시 세션 정보, 실패 시 notice. */
export async function platformSignIn(email: string, password: string): Promise<PlatformResult<AuthSessionInfo>> {
  return guard(async (sb) => {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const u = data.user;
    if (!u) throw new Error('로그인에 실패했습니다.');
    return { userId: u.id, email: u.email ?? null };
  });
}

/** 로그아웃. */
export async function signOut(): Promise<PlatformResult<true>> {
  return guard(async (sb) => {
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    return true as const;
  });
}

/** 현재 세션 조회 — 미로그인이면 data=null, notice=null(오류 아님). */
export async function getSession(): Promise<PlatformResult<AuthSessionInfo | null>> {
  return guard(async (sb) => {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    const u = data.session?.user;
    return u ? { userId: u.id, email: u.email ?? null } : null;
  });
}

/** 세션 변화 구독(로그인/로그아웃 시 셸 재렌더). 반환값 호출 시 해제. */
export function onAuthChange(cb: () => void): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange(() => cb());
  return () => data.subscription.unsubscribe();
}

// Organization discovery and validated tab-scoped selection.

export interface OrgRef {
  id: string;
  name: string;
  slug: string;
  selected: boolean;
}

export async function myOrgs(): Promise<PlatformResult<OrgRef[]>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('my_orgs');
    if (error) throw error;
    return ((data ?? []) as Array<{ id: string; name: string; slug: string; selected: boolean }>).map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      selected: org.selected,
    }));
  });
}

interface OrgSelectionResponse {
  org_id: string;
  context_token: string;
}

export interface OrgSelection {
  orgId: string;
  contextToken: string;
}

export async function selectOrg(orgId: string): Promise<PlatformResult<OrgSelection>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('org_select', { p_org: orgId });
    if (error) throw error;
    const selection = data as OrgSelectionResponse | null;
    if (!selection || selection.org_id !== orgId || !selection.context_token) {
      throw new Error('Organization selection response is invalid');
    }
    return { orgId: selection.org_id, contextToken: selection.context_token };
  });
}

// ── orgTree: 좌측 데이터 트리 — assembly→session→topic 재귀 조회 ───────

interface AssemblyRow { id: string; slug: string | null; title: string; archived_at: string | null }
interface SessionRow { id: string; slug: string | null; ordinal: number | null; held_on: string | null; assembly_id: string }
interface TopicRow { id: string; ordinal: number; prompt: string; session_id: string; archived_at: string | null }

/** 회차 라벨: ordinal 있으면 "제N차", 없으면 held_on, 둘 다 없으면 slug/id 꼬리. */
function sessionLabel(s: SessionRow): string {
  if (s.ordinal != null) return `제${s.ordinal}차 회의`;
  if (s.held_on) return s.held_on;
  return s.slug ?? s.id.slice(0, 8);
}

/**
 * org 스코프의 도메인 트리를 만든다. **메뉴 하드코딩 없음** — DB 위계를 그대로 읽어 렌더한다.
 *
 * 경계는 staff 세션 RLS(P1 §5, 현재 휴면). orgId 는 RPC 인자가 아니라 .from() 표시용 필터로만
 * 쓴다 — RLS 가 이미 소속 org 로 한정하므로 중복이지만 무해하고, 미적용 상태에선 어차피 0행이다.
 * 노드 id: assembly=slug(없으면 uuid) · session=slug(없으면 uuid) · topic=uuid(discussion_topic엔 slug 없음).
 */
export async function orgTree(orgId: string): Promise<PlatformResult<TreeNode>> {
  return guard(async (sb) => {
    const cv = sb.schema(SCHEMA);

    const { data: aData, error: aErr } = await cv
      .from('assembly')
      .select('id, slug, title, archived_at, org_id')
      .eq('org_id', orgId)
      .is('archived_at', null);
    if (aErr) throw aErr;
    const assemblies = (aData ?? []) as AssemblyRow[];

    const assemblyIds = assemblies.map((a) => a.id);
    let sessions: SessionRow[] = [];
    if (assemblyIds.length > 0) {
      const { data: sData, error: sErr } = await cv
        .from('session')
        .select('id, slug, ordinal, held_on, assembly_id')
        .in('assembly_id', assemblyIds);
      if (sErr) throw sErr;
      sessions = (sData ?? []) as SessionRow[];
    }

    const sessionIds = sessions.map((s) => s.id);
    let topics: TopicRow[] = [];
    if (sessionIds.length > 0) {
      const { data: tData, error: tErr } = await cv
        .from('discussion_topic')
        .select('id, ordinal, prompt, session_id, archived_at')
        .in('session_id', sessionIds)
        .is('archived_at', null);
      if (tErr) throw tErr;
      topics = (tData ?? []) as TopicRow[];
    }

    const topicNodes = (sessionId: string): TreeNode[] =>
      topics
        .filter((t) => t.session_id === sessionId)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((t) => ({ kind: 'topic' as const, id: t.id, dataId: t.id, label: t.prompt, children: [] }));

    const sessionNodes = (assemblyId: string): TreeNode[] =>
      sessions
        .filter((s) => s.assembly_id === assemblyId)
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
        .map((s) => ({
          kind: 'session' as const,
          id: s.slug ?? s.id,
          dataId: s.id,
          label: sessionLabel(s),
          children: topicNodes(s.id),
        }));

    const assemblyNodes: TreeNode[] = assemblies.map((a) => ({
      kind: 'assembly' as const,
      id: a.slug ?? a.id,
      dataId: a.id,
      label: a.title,
      children: sessionNodes(a.id),
    }));

    return {
      kind: 'org',
      id: orgId,
      dataId: orgId,
      label: orgId,
      children: assemblyNodes,
    };
  });
}

export interface ReadinessCheck {
  key: string;
  pass: boolean;
  detail: string;
}

export interface ReadinessResult {
  ok: boolean;
  checks: ReadinessCheck[];
}

/** Read-only readiness scoped to the authenticated staff member's selected organization. */
export async function readinessCheck(sessionId: string): Promise<PlatformResult<ReadinessResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_readiness_check_v2', {
      p_session_id: sessionId,
    });
    if (error) throw error;
    return data as ReadinessResult;
  });
}

// ── Staff 검수·공개 RPC 래퍼 ──────────────────────────────────────────
// Every call is anchored to a workshop session selected from the authenticated
// organization tree. The server validates both staff membership and that the
// requested topic/result scope belongs to that session. Reusable join/HQ codes
// never cross this production adapter boundary.

export interface IssueRow {
  id: string;
  label: string;
  stance: string | null;
  frequency_class: string | null;
  summary: string | null;
  origin: string;
  review_status: 'draft' | 'reviewed' | 'archived';
  reviewed_by: string | null;
  reviewed_at: string | null;
  archived_at: string | null;
  linked_item_count: number;
  consensus_denominator: number;
  /** Server-computed CAS over the issue fields and its exact ordered links. */
  snapshot_hash?: string;
}

export interface IssueListResult {
  topic_id: string;
  issues: IssueRow[];
  unclassified_count: number;
  reviewed_count: number;
}

/** 주제의 issue 목록 + 미분류·검수 카운트. */
export async function issueList(sessionId: string, topicId: string): Promise<PlatformResult<IssueListResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_issue_list_v2', {
      p_session_id: sessionId,
      p_topic_id: topicId,
    });
    if (error) throw error;
    return data as IssueListResult;
  });
}

// ── 검수용 주제 횡단 원문(P2 issue_items) — 미분류함 본문·재분류의 데이터 소스 ──
// issue_list 는 카운트만 준다. 검수 콘솔의 본문 노출·재분류는 주제의 전 submission_item 본문 +
// 현재 issue_link 가 필요하다. 한 원문이 복수 issue 에 링크될 수 있어 links 는 배열(multi-label).

export interface IssueItemLink {
  issue_id: string;
  cluster_id: string | null;
  linked_by: string;
}

export interface IssueItemRow {
  id: string;
  content: string;
  rationale: string | null;
  kind: string;
  ordinal: number;
  team_id: string;
  team_name: string | null;
  submission_id: string;
  links: IssueItemLink[];
  unclassified: boolean;
}

export interface IssueItemsResult {
  topic_id: string;
  items: IssueItemRow[];
}

/** 주제의 전 조 원문 + 현재 링크. 검수 콘솔의 미분류함·재분류 데이터 소스. */
export async function issueItems(sessionId: string, topicId: string): Promise<PlatformResult<IssueItemsResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_issue_items_v2', {
      p_session_id: sessionId,
      p_topic_id: topicId,
    });
    if (error) throw error;
    return data as IssueItemsResult;
  });
}

/** Authenticated staff ballot list, scoped by membership and the selected session on the server. */
export async function platformBallotList(sessionId: string): Promise<PlatformResult<BallotListRow[]>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_ballot_list_v2', {
      p_session_id: sessionId,
    });
    if (error) throw error;
    return (data ?? []) as BallotListRow[];
  });
}

/** Authenticated staff aggregate, including non-published ballots in the selected session. */
export async function platformBallotResults(
  token: string,
  sessionId: string,
): Promise<PlatformResult<BallotResults | null>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_ballot_results_v2', {
      p_ballot_token: token,
      p_session_id: sessionId,
    });
    if (error) throw error;
    return (data as BallotResults | null) ?? null;
  });
}

export interface IssueUpsertInput {
  /** Client-generated stable UUID. It is reused for an ambiguous create retry. */
  id: string;
  label: string;
  stance?: string;
  frequency?: string;
  summary?: string;
}

export type IssueUpsertResult =
  | {
      status: 'applied';
      id: string;
      created: boolean;
      snapshot_hash: string;
    }
  | {
      status: 'conflict';
      id: string;
      current_snapshot_hash: string;
    };

/**
 * Create or edit an issue with compare-and-swap and idempotency protection.
 * New issues use a client UUID and a null expected hash; edits require the hash
 * captured when the operator selected the issue.
 */
export async function issueUpsert(
  sessionId: string,
  topicId: string,
  issue: IssueUpsertInput,
  expectedSnapshotHash: string | null,
  idempotencyKey: string,
): Promise<PlatformResult<IssueUpsertResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_issue_upsert_v3', {
      p_session_id: sessionId,
      p_topic_id: topicId,
      p_issue: issue,
      p_expected_snapshot_hash: expectedSnapshotHash,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return data as IssueUpsertResult;
  });
}

export interface IssueReclassifyExpectedLinkInput {
  itemId: string;
  clusterId: string | null;
  linkedBy: string;
}

export interface IssueReclassifyCallInput {
  issueId: string;
  itemIds: string[];
  clusterId: string | null;
  expectedLinks: IssueReclassifyExpectedLinkInput[];
  role: 'target' | 'source';
}

export interface IssueReclassifyResult {
  status: 'applied' | 'conflict';
  affected_issues?: number;
  linked_count?: number;
  issue_ids?: string[];
  conflict_issue_id?: string;
}

/**
 * Applies a complete reclassification plan in one database transaction.
 * expectedLinks is the browser's read snapshot and acts as the server CAS.
 */
export async function issueReclassify(
  sessionId: string,
  topicId: string,
  calls: IssueReclassifyCallInput[],
  idempotencyKey: string,
): Promise<PlatformResult<IssueReclassifyResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_issue_reclassify_v2', {
      p_session_id: sessionId,
      p_topic_id: topicId,
      p_plan: {
        calls: calls.map((call) => ({
          issue_id: call.issueId,
          item_ids: call.itemIds,
          cluster_id: call.clusterId,
          expected_links: call.expectedLinks.map((link) => ({
            item_id: link.itemId,
            cluster_id: link.clusterId,
            linked_by: link.linkedBy,
          })),
          role: call.role,
        })),
      },
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return data as IssueReclassifyResult;
  });
}

export interface IssueMergeResult {
  status: 'applied' | 'conflict';
  src?: string;
  dst?: string;
  moved?: number;
  conflict_issue_id?: string;
  current_snapshot_hash?: string;
  dst_snapshot_hash?: string;
}

/** issue 병합 — 두 issue의 화면 스냅샷이 그대로일 때만 src → dst를 적용. */
export async function issueMerge(
  sessionId: string,
  srcIssueId: string,
  dstIssueId: string,
  expectedSrcSnapshotHash: string,
  expectedDstSnapshotHash: string,
  idempotencyKey: string,
): Promise<PlatformResult<IssueMergeResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_issue_merge_v3', {
      p_session_id: sessionId,
      p_src_issue_id: srcIssueId,
      p_dst_issue_id: dstIssueId,
      p_expected_src_snapshot_hash: expectedSrcSnapshotHash,
      p_expected_dst_snapshot_hash: expectedDstSnapshotHash,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return data as IssueMergeResult;
  });
}

export interface IssueReviewResult {
  status: 'applied' | 'conflict';
  id?: string;
  review_status?: string;
  current_snapshot_hash?: string;
  snapshot_hash?: string;
}

/** 검수 확정 — 화면에서 읽은 issue+원문 링크가 그대로일 때만 draft → reviewed. */
export async function issueReview(
  sessionId: string,
  issueId: string,
  expectedSnapshotHash: string,
  idempotencyKey: string,
): Promise<PlatformResult<IssueReviewResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_issue_review_v3', {
      p_session_id: sessionId,
      p_issue_id: issueId,
      p_expected_snapshot_hash: expectedSnapshotHash,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return data as IssueReviewResult;
  });
}

/** Staff 결과 공개. 스코프 내 reviewed ≥1 필수. */
export async function resultPublish(
  sessionId: string,
  scope: 'topic' | 'session' | 'assembly',
  scopeId: string,
  title: string,
): Promise<PlatformResult<{ id: string; token: string; published_at: string; reviewed_count: number }>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_result_publish_v2', {
      p_session_id: sessionId,
      p_scope: scope,
      p_scope_id: scopeId,
      p_title: title,
    });
    if (error) throw error;
    return data as { id: string; token: string; published_at: string; reviewed_count: number };
  });
}

/** Staff 결과 공개 해제. */
export async function resultUnpublish(sessionId: string, resultId: string): Promise<PlatformResult<{ id: string; published_at: null }>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_result_unpublish_v2', {
      p_session_id: sessionId,
      p_result_id: resultId,
    });
    if (error) throw error;
    return data as { id: string; published_at: null };
  });
}

export interface ResultImplementationInput {
  status: 'under_review' | 'planned' | 'in_progress' | 'implemented' | 'not_pursued';
  responsible_body: string;
  updated_at: string;
  summary: string;
  evidence_url: string | null;
}

export type ResultImplementationUpsertResult =
  | {
      status: 'applied';
      result_id: string;
      issue_id: string;
      event_id: number;
      updated_at: string;
      snapshot_hash: string;
    }
  | {
      status: 'conflict';
      result_id: string;
      issue_id: string;
      current_snapshot_hash: string;
    };

export interface ResultImplementationUpsertIntentInput {
  sessionId: string;
  resultToken: string;
  issueId: string;
  implementation: ResultImplementationInput;
  expectedSnapshotHash: string | null;
}

export interface ResultImplementationUpsertIntent {
  fingerprint: string;
  idempotencyKey: string;
}

/** Canonical fingerprint of the exact mutation request except its generated UUID. */
export function resultImplementationUpsertIntentFingerprint(
  input: ResultImplementationUpsertIntentInput,
): string {
  return JSON.stringify([
    'platform_result_implementation_upsert_v3',
    input.sessionId,
    input.resultToken,
    input.issueId,
    input.implementation.status,
    input.implementation.responsible_body,
    input.implementation.updated_at,
    input.implementation.summary,
    input.implementation.evidence_url,
    input.expectedSnapshotHash,
  ]);
}

/** Reuses the UUID only while every user-intent and CAS field is unchanged. */
export function ensureResultImplementationUpsertIntent(
  current: ResultImplementationUpsertIntent | null,
  input: ResultImplementationUpsertIntentInput,
  createId: () => string = () => crypto.randomUUID(),
): ResultImplementationUpsertIntent {
  const fingerprint = resultImplementationUpsertIntentFingerprint(input);
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, idempotencyKey: createId() };
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactJsonKeys(value: JsonRecord, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function parseResultImplementationUpsertResult(value: unknown): ResultImplementationUpsertResult {
  if (!isJsonRecord(value)
    || typeof value.result_id !== 'string'
    || !value.result_id
    || typeof value.issue_id !== 'string'
    || !value.issue_id) {
    throw new Error('이행조치 저장 응답 형식을 확인하지 못했습니다.');
  }
  if (value.status === 'applied'
    && hasExactJsonKeys(value, [
      'status', 'result_id', 'issue_id', 'event_id', 'updated_at', 'snapshot_hash',
    ])
    && Number.isSafeInteger(value.event_id)
    && Number(value.event_id) > 0
    && typeof value.updated_at === 'string'
    && !Number.isNaN(Date.parse(value.updated_at))
    && typeof value.snapshot_hash === 'string'
    && value.snapshot_hash.length > 0) {
    return value as ResultImplementationUpsertResult;
  }
  if (value.status === 'conflict'
    && hasExactJsonKeys(value, [
      'status', 'result_id', 'issue_id', 'current_snapshot_hash',
    ])
    && typeof value.current_snapshot_hash === 'string'
    && value.current_snapshot_hash.length > 0) {
    return value as ResultImplementationUpsertResult;
  }
  throw new Error('이행조치 저장 응답 형식을 확인하지 못했습니다.');
}

/**
 * 발행 결과의 권고별 기관 이행조치를 직접 등록한다.
 * RPC migration 미적용 시 화면은 명시적인 승인 대기 상태로 퇴화한다.
 */
export async function resultImplementationUpsert(
  sessionId: string,
  resultToken: string,
  issueId: string,
  implementation: ResultImplementationInput,
  expectedSnapshotHash: string | null,
  idempotencyKey: string,
): Promise<PlatformResult<ResultImplementationUpsertResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('platform_result_implementation_upsert_v3', {
      p_session_id: sessionId,
      p_result_token: resultToken,
      p_issue_id: issueId,
      p_implementation: implementation,
      p_expected_snapshot_hash: expectedSnapshotHash,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return parseResultImplementationUpsertResult(data);
  }, '이행조치 v3 저장 RPC가 아직 승인·적용되지 않았습니다. P1a migration 승인 후 사용할 수 있습니다.');
}

export interface ResultPageView {
  scope: string;
  scope_id: string;
  title: string;
  published_at: string;
  body: unknown;
  hitl_notice: string;
}

/** 공개 결과 페이지 read(P2 result_get, token). 비공개/미존재면 data=null. */
export async function resultGet(token: string): Promise<PlatformResult<ResultPageView | null>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('result_get', { p_token: token });
    if (error) throw error;
    return (data as ResultPageView | null) ?? null;
  });
}
