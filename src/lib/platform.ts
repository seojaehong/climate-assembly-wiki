// 공론화 SaaS 플랫폼 — 데이터 레이어 (BUILD_SPEC §4-2 "데이터 연결")
//
// ★ 격리 불변식(BUILD_SPEC §2-2): 어떤 RPC 래퍼도 org_id 를 인자로 받지 않는다.
//   서버가 auth.uid()·join_code·token 에서 파생한다. 클라이언트는 org 를 주장하지 못한다.
//   (orgTree(orgId) 의 orgId 는 RPC 인자가 아니라 .from() 테이블 조회의 표시용 필터이며,
//    실제 경계는 staff 세션 RLS 다 — 아래 orgTree 주석 참조.)
//
// ★ 런타임 흡수(BUILD_SPEC §4 산출물 6): 플랫폼 스키마(platform_p1/p2)는 아직 어느 DB에도
//   미적용이라 대부분의 경로가 살아 있지 않다. 모든 데이터 호출을 단 하나의 오류 흡수 헬퍼
//   guard() 로 감싸 { data, notice } 를 돌려준다 — 화면은 예외 대신 안내 문구를 띄운다.
//   빌드는 언제나 통과한다.

import { getSupabase } from './supabase';
import { type TreeNode } from '../islands/platform/platform-nav-logic';

const SCHEMA = 'climate_vote';

/** 모든 플랫폼 데이터 호출의 반환형 — 예외 대신 notice 로 실패를 전달. */
export interface PlatformResult<T> {
  data: T | null;
  notice: string | null;
}

/** Supabase/PostgREST 오류를 한국어 안내로 번역(스키마 미적용·다중 org 등). */
function describeError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  const msg = err?.message ?? '';
  const code = err?.code ?? '';
  // PostgREST: 함수/스키마 미적용
  if (code === 'PGRST202' || /Could not find the function|schema cache/i.test(msg)) {
    return '플랫폼 스키마가 아직 적용되지 않았습니다(platform_p1/p2 미적용). 병합 후 동작합니다.';
  }
  // org_of_uid 다중 소속 예외(P1 §4-2)
  if (/multiple orgs/i.test(msg)) {
    return '여러 기관에 소속되어 있습니다 — 기관 선택이 필요합니다(Phase 2 org_select 미구현).';
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
): Promise<PlatformResult<T>> {
  const sb = getSupabase();
  if (!sb) return { data: null, notice: '연결 설정이 없습니다(PUBLIC_SUPABASE_* 미설정).' };
  try {
    const data = await fn(sb);
    return { data, notice: null };
  } catch (e) {
    return { data: null, notice: describeError(e) };
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

// ── org: 서버 파생(org_of_uid) — 클라이언트가 org 를 주장하지 않는다 ────

export interface OrgRef {
  id: string;
  /** 표시명 — org 테이블은 revoke 상태라 slug/name 을 읽을 수 없다(미결). uuid 로 대체. */
  name: string;
}

/**
 * 내 소속 org. org_of_uid() RPC 가 유일한 경로다(membership 테이블 직접 read 는 P1 에서
 * revoke + 정책 휴면 → dead path). 함수는 uuid 하나 또는 null 을 돌려주고, 다중 소속이면
 * **예외**를 던진다(격리 불변식: 임의 org 선택 금지). 그 예외는 notice 로 흡수한다.
 * ★ 미결: org 이름/slug 표시는 org 테이블 read GRANT(또는 전용 RPC) 도입 전까지 불가.
 */
export async function myOrgs(): Promise<PlatformResult<OrgRef[]>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('org_of_uid');
    if (error) throw error;
    const id = data as string | null;
    if (!id) return [];
    return [{ id, name: '내 기관' }];
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
        .map((t) => ({ kind: 'topic' as const, id: t.id, label: t.prompt, children: [] }));

    const sessionNodes = (assemblyId: string): TreeNode[] =>
      sessions
        .filter((s) => s.assembly_id === assemblyId)
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
        .map((s) => ({
          kind: 'session' as const,
          id: s.slug ?? s.id,
          label: sessionLabel(s),
          children: topicNodes(s.id),
        }));

    const assemblyNodes: TreeNode[] = assemblies.map((a) => ({
      kind: 'assembly' as const,
      id: a.slug ?? a.id,
      label: a.title,
      children: sessionNodes(a.id),
    }));

    return {
      kind: 'org',
      id: orgId,
      label: '내 기관',
      children: assemblyNodes,
    };
  });
}

// ── P2 검수·공개 RPC 래퍼 (전부 p_code = join_code capability) ──────────
// ★ org_id 를 받는 래퍼는 하나도 없다(불변식). ★ 병합 시 재확인 미결:
//   P2 헤더의 DIVERGENCE — 검수/공개가 join_code(운영자) 서명이다. Auth 셸이라도
//   실제 issue CRUD·공개에는 조 join_code 가 필요하다. 이 code seam 은 Phase 2 에서
//   HQ/staff 토큰 RPC 로 전환 예정(현재는 스코프 뷰에 code 입력 자리만 둔다).

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
}

export interface IssueListResult {
  topic_id: string;
  issues: IssueRow[];
  unclassified_count: number;
  reviewed_count: number;
}

/** 주제의 issue 목록 + 미분류·검수 카운트(P2 issue_list). */
export async function issueList(code: string, topicId: string): Promise<PlatformResult<IssueListResult>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('issue_list', { p_code: code, p_topic_id: topicId });
    if (error) throw error;
    return data as IssueListResult;
  });
}

/** issue 생성/수정(P2 issue_upsert). id 있으면 수정, 없으면 생성. */
export async function issueUpsert(
  code: string,
  topicId: string,
  issue: { id?: string; label: string; stance?: string; frequency?: string; summary?: string },
): Promise<PlatformResult<{ id: string; created: boolean }>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('issue_upsert', {
      p_code: code,
      p_topic_id: topicId,
      p_issue: issue,
    });
    if (error) throw error;
    return data as { id: string; created: boolean };
  });
}

/** issue 의 원문 연결 교체(P2 issue_link_set). cluster_id 는 nullable. */
export async function issueLinkSet(
  code: string,
  issueId: string,
  itemIds: string[],
  clusterId: string | null,
): Promise<PlatformResult<{ issue_id: string; linked: number }>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('issue_link_set', {
      p_code: code,
      p_issue_id: issueId,
      p_item_ids: itemIds,
      p_cluster_id: clusterId,
    });
    if (error) throw error;
    return data as { issue_id: string; linked: number };
  });
}

/** issue 병합(P2 issue_merge) — src → dst 링크 이전 후 src archive. */
export async function issueMerge(
  code: string,
  srcIssueId: string,
  dstIssueId: string,
): Promise<PlatformResult<{ src: string; dst: string; moved: number }>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('issue_merge', {
      p_code: code,
      p_src_issue_id: srcIssueId,
      p_dst_issue_id: dstIssueId,
    });
    if (error) throw error;
    return data as { src: string; dst: string; moved: number };
  });
}

/** 검수 확정(P2 issue_review) — draft → reviewed. */
export async function issueReview(code: string, issueId: string): Promise<PlatformResult<{ id: string; review_status: string }>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('issue_review', { p_code: code, p_issue_id: issueId });
    if (error) throw error;
    return data as { id: string; review_status: string };
  });
}

/** 공개(P2 result_publish) — 스코프 내 reviewed ≥1 필수. token 반환. */
export async function resultPublish(
  code: string,
  scope: 'topic' | 'session' | 'assembly',
  scopeId: string,
  title: string,
): Promise<PlatformResult<{ id: string; token: string; published_at: string; reviewed_count: number }>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('result_publish', {
      p_code: code,
      p_scope: scope,
      p_scope_id: scopeId,
      p_title: title,
    });
    if (error) throw error;
    return data as { id: string; token: string; published_at: string; reviewed_count: number };
  });
}

/** 공개 해제(P2 result_unpublish). */
export async function resultUnpublish(code: string, resultId: string): Promise<PlatformResult<{ id: string; published_at: null }>> {
  return guard(async (sb) => {
    const { data, error } = await sb.schema(SCHEMA).rpc('result_unpublish', { p_code: code, p_result_id: resultId });
    if (error) throw error;
    return data as { id: string; published_at: null };
  });
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
