// 검수 콘솔 — 순수 로직 (React·Supabase 의존 없음, vitest 대상)
//
// gongron 벤치마킹 §2-1의 4×6 코딩 스킴(빈도4 × 방향6)과 원문 재분류·병합·검수 게이트를
// 우리 데이터(P2 issue/issue_link)로 구현하기 위한 뷰모델·판정 로직. 화면(ReviewConsole)은
// 이 모듈의 순수 함수만 조합한다.
//
// ── 데이터 소스 ────────────────────────────────────────────────────────
// issue_list 는 카운트만(linked_item_count·consensus_denominator) 준다. 미분류함 본문 노출(B11
// 전수 역추적)과 원문 재분류(issue_link_set)는 주제 전체(조 횡단)의 submission_item 본문 + 현재
// 링크가 필요하다 — P2 issue_items(code,topicId) 가 이를 준다(toReviewItems 로 뷰모델화).
//   · issue_items 로드 성공 → 연결 원문 카드·미분류함 본문·재분류/끌어오기 전부 동작.
//   · 미로드(스키마 미적용·권한 오류) → 콘솔은 재분류/끌어오기를 **비활성**한다.
// 이유는 issue_link_set 이 replace-all(아래)이라, issue별 전체 item 집합을 모르는 채 부분 집합으로
// 호출하면 기존 링크를 **파괴**한다. gap 을 빈 패널이 아니라 데이터 유실 버그로 만들지 않기 위한 게이트.

import type {
  IssueRow,
  IssueListResult,
  IssueItemRow,
  IssueItemsResult,
  IssueReclassifyCallInput,
} from '../../../lib/platform';
import { resolveHitlStatus, type HitlStatus } from '../../../lib/hitl-status';

// ── 4×6 코딩 스킴 (gongron 채택분 그대로) ──────────────────────────────

/** 빈도 구분(합의도 축). issue.frequency_class 값. */
export type FrequencyClass = 'consensus' | 'majority' | 'minority' | 'mixed';
/** 방향(입장 축). issue.stance 값. */
export type Stance = 'pro' | 'con' | 'conditional' | 'concern' | 'proposal' | 'neutral';

/** 빈도 4종 — 값·한국어 라벨(드롭다운·배지 공용 원천). */
export const FREQUENCY_OPTIONS: ReadonlyArray<{ value: FrequencyClass; label: string }> = [
  { value: 'consensus', label: '합의' },
  { value: 'majority', label: '다수의견' },
  { value: 'minority', label: '소수의견' },
  { value: 'mixed', label: '혼재' },
];

/** 방향 6종 — 값·한국어 라벨. */
export const STANCE_OPTIONS: ReadonlyArray<{ value: Stance; label: string }> = [
  { value: 'pro', label: '찬성' },
  { value: 'con', label: '반대' },
  { value: 'conditional', label: '조건부' },
  { value: 'concern', label: '우려' },
  { value: 'proposal', label: '대안·제안' },
  { value: 'neutral', label: '중립·불명' },
];

const FREQ_LABEL: Record<string, string> = Object.fromEntries(FREQUENCY_OPTIONS.map((o) => [o.value, o.label]));
const STANCE_LABEL: Record<string, string> = Object.fromEntries(STANCE_OPTIONS.map((o) => [o.value, o.label]));

/** 빈도 배지 라벨. 미지정(null·미지의 값)은 '미지정'. */
export function frequencyLabel(fc: string | null | undefined): string {
  if (!fc) return '미지정';
  return FREQ_LABEL[fc] ?? '미지정';
}

/** 방향 배지 라벨. 미지정(null·미지의 값)은 '미지정'. */
export function stanceLabel(st: string | null | undefined): string {
  if (!st) return '미지정';
  return STANCE_LABEL[st] ?? '미지정';
}

// ── 검수 상태 라벨 (AI 초안 대기 vs 사람 검수 대기 vs 완료 vs 보관) ──────

export type ReviewStatus = 'draft' | 'reviewed' | 'archived';

// ── issue 뷰모델 (issue_list body → 화면용) ────────────────────────────

export interface IssueViewModel {
  id: string;
  label: string;
  stance: string | null;
  frequencyClass: string | null;
  summary: string | null;
  origin: string;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  /** 4×6 배지 한국어 라벨. */
  frequencyBadge: string;
  stanceBadge: string;
  hitl: HitlStatus;
  /** 연결 원문 수(issue_list linked_item_count). */
  linkedItemCount: number;
  /** 합의도 분모(cluster 보정, issue_list consensus_denominator). */
  consensusDenominator: number;
  reviewable: boolean;
  /** Empty only while an older server contract is still deployed. */
  snapshotHash: string;
}

/** IssueRow(issue_list 원소) → 화면 뷰모델. 배지·검수가능 판정을 실어 준다. */
export function toIssueViewModel(row: IssueRow): IssueViewModel {
  const status = (row.review_status as ReviewStatus) ?? 'draft';
  return {
    id: row.id,
    label: row.label,
    stance: row.stance,
    frequencyClass: row.frequency_class,
    summary: row.summary,
    origin: row.origin,
    reviewStatus: status,
    reviewedBy: row.reviewed_by,
    frequencyBadge: frequencyLabel(row.frequency_class),
    stanceBadge: stanceLabel(row.stance),
    hitl: resolveHitlStatus({ reviewStatus: status, origin: row.origin }),
    linkedItemCount: row.linked_item_count ?? 0,
    consensusDenominator: row.consensus_denominator ?? 0,
    reviewable: canReview(status),
    snapshotHash: row.snapshot_hash ?? '',
  };
}

/** issue_list 결과 전체 → 뷰모델 목록. issues 가 없으면 빈 배열(guard). */
export function toIssueViewModels(result: IssueListResult | null | undefined): IssueViewModel[] {
  if (!result || !Array.isArray(result.issues)) return [];
  return result.issues.map(toIssueViewModel);
}

// ── 검수/공개 게이트 판정 ──────────────────────────────────────────────

/** issue_review 는 draft 만 확정 가능(RPC 가 그 외엔 예외). 버튼 활성 판정. */
export function canReview(status: string): boolean {
  return status === 'draft';
}

/** 공개 게이트 — 스코프 내 reviewed 쟁점 ≥1(0이면 result_publish 가 공허참 방지로 거부). */
export function canPublish(reviewedCount: number): boolean {
  return reviewedCount >= 1;
}

/** 공개 게이트 안내 문구(검수 완료 수 기준). */
export function publishGateNotice(reviewedCount: number): string {
  if (reviewedCount >= 1) {
    return `검수 완료 ${reviewedCount}건 — 공개 게이트가 열렸습니다. 공개 뷰에서 결과 페이지를 발행할 수 있습니다.`;
  }
  return '검수 완료된 쟁점이 없습니다. 최소 1건을 「검수 완료」해야 공개할 수 있습니다.';
}

// ── 원문(submission_item) 뷰 + 미분류/재분류 로직 ──────────────────────

/** Review source item loaded through issue_items; issue links remain multi-label. */
export interface ReviewItem {
  itemId: string;
  submissionId: string;
  ordinal: number;
  teamName: string;
  kind: 'core' | 'extra';
  content: string;
  rationale: string | null;
  /** 이 원문이 연결된 issue id 들(issue_link). 비어 있으면 미분류. */
  issueIds: string[];
  links: ReviewItemLink[];
}

export interface ReviewItemLink {
  issueId: string;
  clusterId: string | null;
  linkedBy: string;
}

/** Maps an issue_items row without flattening per-link provenance. */
export function toReviewItem(row: IssueItemRow): ReviewItem {
  const links = Array.isArray(row.links) ? row.links : [];
  const reviewLinks = links.map((link) => ({
    issueId: link.issue_id,
    clusterId: link.cluster_id,
    linkedBy: link.linked_by,
  }));
  return {
    itemId: row.id,
    submissionId: row.submission_id,
    ordinal: row.ordinal,
    teamName: row.team_name ?? '(미상 조)',
    kind: row.kind === 'extra' ? 'extra' : 'core',
    content: row.content,
    rationale: row.rationale,
    issueIds: reviewLinks.map((link) => link.issueId),
    links: reviewLinks,
  };
}

/** issue_items 결과 전체 → ReviewItem 목록. null/누락은 빈 배열(guard). */
export function toReviewItems(result: IssueItemsResult | null | undefined): ReviewItem[] {
  if (!result || !Array.isArray(result.items)) return [];
  return result.items.map(toReviewItem);
}

/** 미분류 원문 = issue_link 가 하나도 없는 것(B11). */
export function isUnclassified(item: ReviewItem): boolean {
  return item.issueIds.length === 0;
}

/** 주제의 원문을 분류/미분류로 가른다. */
export function partitionItems(items: ReviewItem[]): { classified: ReviewItem[]; unclassified: ReviewItem[] } {
  const classified: ReviewItem[] = [];
  const unclassified: ReviewItem[] = [];
  for (const it of items) (isUnclassified(it) ? unclassified : classified).push(it);
  return { classified, unclassified };
}

/** 특정 issue 에 연결된 원문들(선택 issue 의 연결 원문 카드 목록). */
export function itemsForIssue(items: ReviewItem[], issueId: string): ReviewItem[] {
  return items.filter((it) => it.issueIds.includes(issueId));
}

export interface SourceReference {
  id: string;
  href: string;
  label: string;
  submissionId: string;
}

/** Builds the stable review-console reference shared by a source link and its source card. */
export function sourceReference(item: ReviewItem): SourceReference {
  const id = `source-item-${item.itemId}`;
  return {
    id,
    href: `#${id}`,
    label: `${item.teamName} · ${itemKindLabel(item.kind)} ${item.ordinal}번 원문`,
    submissionId: item.submissionId,
  };
}

/** 특정 issue 의 **전체** item id 집합(replace-all 호출용). 순서 안정(items 순). */
export function issueItemIds(items: ReviewItem[], issueId: string): string[] {
  return items.filter((it) => it.issueIds.includes(issueId)).map((it) => it.itemId);
}

interface ClusterResolution {
  clusterId: string | null;
  error: string | null;
}

function itemLink(item: ReviewItem, issueId: string): ReviewItemLink | null {
  const matches = item.links.filter((link) => link.issueId === issueId);
  return matches.length === 1 ? matches[0] : null;
}

function uniformIssueCluster(items: ReviewItem[], issueId: string, itemIds: string[]): ClusterResolution {
  if (itemIds.length === 0) return { clusterId: null, error: null };
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const clusters: Array<string | null> = [];
  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    const link = item ? itemLink(item, issueId) : null;
    if (!link) {
      return { clusterId: null, error: '쟁점 연결 정보를 정확히 확인할 수 없습니다. 원문을 다시 불러오세요.' };
    }
    clusters.push(link.clusterId);
  }
  const first = clusters[0];
  if (!clusters.every((cluster) => cluster === first)) {
    return {
      clusterId: null,
      error: '원문별 cluster_id가 서로 달라 현재 replace-all RPC로 안전하게 보존할 수 없습니다.',
    };
  }
  return { clusterId: first, error: null };
}

function plannedTargetCluster(
  items: ReviewItem[],
  targetIssueId: string,
  sourceIssueId: string | null,
  itemIds: string[],
): ClusterResolution {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const clusters: Array<string | null> = [];
  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    if (!item) {
      return { clusterId: null, error: '원문 연결 정보를 정확히 확인할 수 없습니다. 원문을 다시 불러오세요.' };
    }
    const targetLink = itemLink(item, targetIssueId);
    const sourceLink = sourceIssueId ? itemLink(item, sourceIssueId) : null;
    clusters.push(targetLink ? targetLink.clusterId : sourceLink ? sourceLink.clusterId : null);
  }
  if (clusters.length === 0) return { clusterId: null, error: null };
  const first = clusters[0];
  if (!clusters.every((cluster) => cluster === first)) {
    return {
      clusterId: null,
      error: '대상 원문의 cluster_id가 서로 다릅니다. 대상 전체에 적용할 cluster_id를 명시하세요.',
    };
  }
  return { clusterId: first, error: null };
}

/** 원자 계획 안의 issue별 replace-all 링크 집합. */
export interface ReclassifyCall extends IssueReclassifyCallInput {
  /** 'target'=끌어온/이동한 쪽, 'source'=원본에서 뺀 쪽. */
  role: 'target' | 'source';
}

export interface ReclassifyPlan {
  calls: ReclassifyCall[];
  error: string | null;
}

/**
 * The atomic RPC compares this complete per-issue snapshot before replacing
 * links. Include provenance as well as item/cluster so a concurrent human
 * relink cannot be silently overwritten by a stale browser tab.
 */
function expectedLinksForIssue(items: ReviewItem[], issueId: string): IssueReclassifyCallInput['expectedLinks'] {
  return items
    .flatMap((item) => item.links
      .filter((link) => link.issueId === issueId)
      .map((link) => ({
        itemId: item.itemId,
        clusterId: link.clusterId,
        linkedBy: link.linkedBy,
      })))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}

/** Stable identity for retaining one request UUID across an ambiguous retry. */
export function reclassifyPlanFingerprint(plan: ReclassifyPlan): string {
  return JSON.stringify(plan.calls
    .map((call) => ({
      issueId: call.issueId,
      role: call.role,
      clusterId: call.clusterId,
      itemIds: [...call.itemIds].sort(),
      expectedLinks: [...call.expectedLinks]
        .sort((left, right) => left.itemId.localeCompare(right.itemId)),
    }))
    .sort((left, right) => left.issueId.localeCompare(right.issueId)));
}

/**
 * 재분류/끌어오기 계획 — 서버가 issue별 링크를 **replace-all**(delete then insert)하므로 부분 집합은
 * 기존 링크를 파괴한다. 각 issue의 전체 결과 집합을 계산해 하나의 원자 계획에 최대 두 집합을 담는다.
 *   · targetIssueId 로 이동(∪ selected)
 *   · sourceIssueId 가 있으면 원본에서 뺀 나머지(\ selected)로 원본 재기록
 * 미분류에서 끌어오기는 sourceIssueId 를 비운다(target 한 번).
 * A replace-all call can preserve an implicit cluster only when every resulting link shares it.
 */
export function planReclassify(
  items: ReviewItem[],
  selectedItemIds: string[],
  targetIssueId: string | null,
  sourceIssueId: string | null,
  requestedClusterId: string | null,
): ReclassifyPlan {
  const selected = Array.from(new Set(selectedItemIds));
  if (selected.length === 0) return { calls: [], error: '이동할 원문을 선택하세요.' };
  if (!targetIssueId) return { calls: [], error: '이동 대상 쟁점을 선택하세요.' };
  if (sourceIssueId && sourceIssueId === targetIssueId) {
    return { calls: [], error: '같은 쟁점입니다 — 이동할 수 없습니다.' };
  }
  const known = new Set(items.map((it) => it.itemId));
  const missing = selected.filter((id) => !known.has(id));
  if (missing.length > 0) return { calls: [], error: `원문 ${missing.length}건을 찾을 수 없습니다(재로드 필요).` };
  if (sourceIssueId) {
    const sourceMismatch = selected.some((id) => {
      const sourceItem = items.find((item) => item.itemId === id);
      return !sourceItem || !itemLink(sourceItem, sourceIssueId);
    });
    if (sourceMismatch) {
      return { calls: [], error: '선택 원문의 원본 쟁점 연결을 확인할 수 없습니다. 원문을 다시 불러오세요.' };
    }
  }

  const targetSet = Array.from(new Set([...issueItemIds(items, targetIssueId), ...selected]));
  const targetCluster = requestedClusterId === null
    ? plannedTargetCluster(items, targetIssueId, sourceIssueId, targetSet)
    : { clusterId: requestedClusterId, error: null };
  if (targetCluster.error) return { calls: [], error: targetCluster.error };

  let sourceCall: ReclassifyCall | null = null;
  if (sourceIssueId) {
    const remaining = issueItemIds(items, sourceIssueId).filter((id) => !selected.includes(id));
    const sourceCluster = uniformIssueCluster(items, sourceIssueId, remaining);
    if (sourceCluster.error) return { calls: [], error: sourceCluster.error };
    sourceCall = {
      issueId: sourceIssueId,
      itemIds: remaining,
      clusterId: sourceCluster.clusterId,
      expectedLinks: expectedLinksForIssue(items, sourceIssueId),
      role: 'source',
    };
  }

  const calls: ReclassifyCall[] = [
    {
      issueId: targetIssueId,
      itemIds: targetSet,
      clusterId: targetCluster.clusterId,
      expectedLinks: expectedLinksForIssue(items, targetIssueId),
      role: 'target',
    },
  ];
  if (sourceCall) calls.push(sourceCall);
  return { calls, error: null };
}

/**
 * 선택 issue의 링크에서 원문을 제거(연결 해제) — 원자 계획으로 남은 집합만 재기록.
 * 되돌아간 원문은 미분류함으로 떨어진다. 빈 배열도 유효(전체 해제).
 */
export function planUnlink(items: ReviewItem[], issueId: string, removeItemIds: string[]): ReclassifyPlan {
  const remove = Array.from(new Set(removeItemIds));
  if (remove.length === 0) return { calls: [], error: '해제할 원문을 선택하세요.' };
  const byId = new Map(items.map((item) => [item.itemId, item]));
  if (remove.some((itemId) => {
    const item = byId.get(itemId);
    return !item || !itemLink(item, issueId);
  })) {
    return { calls: [], error: '선택 원문의 쟁점 연결을 확인할 수 없습니다. 원문을 다시 불러오세요.' };
  }
  const remaining = issueItemIds(items, issueId).filter((id) => !remove.includes(id));
  const sourceCluster = uniformIssueCluster(items, issueId, remaining);
  if (sourceCluster.error) return { calls: [], error: sourceCluster.error };
  return {
    calls: [{
      issueId,
      itemIds: remaining,
      clusterId: sourceCluster.clusterId,
      expectedLinks: expectedLinksForIssue(items, issueId),
      role: 'source',
    }],
    error: null,
  };
}

// ── 병합 유효성 (자기 자신·보관 방지) ──────────────────────────────────

export interface MergeValidity {
  ok: boolean;
  reason: string | null;
}

/**
 * issue_merge(src→dst) 유효성. src<>dst, 같은 topic(issue_list 는 한 topic 만 주므로 기본 충족),
 * 보관(archived) 방지. issue_list 는 archived 를 제외하지만 방어적으로 검사한다.
 */
export function validateMerge(
  srcId: string | null,
  dstId: string | null,
  issues: IssueViewModel[],
): MergeValidity {
  if (!srcId || !dstId) return { ok: false, reason: '병합할 원본·대상 쟁점을 모두 선택하세요.' };
  if (srcId === dstId) return { ok: false, reason: '같은 쟁점끼리는 병합할 수 없습니다.' };
  const src = issues.find((i) => i.id === srcId);
  const dst = issues.find((i) => i.id === dstId);
  if (!src) return { ok: false, reason: '원본 쟁점을 찾을 수 없습니다.' };
  if (!dst) return { ok: false, reason: '대상 쟁점을 찾을 수 없습니다.' };
  if (src.reviewStatus === 'archived') return { ok: false, reason: '이미 보관된 쟁점은 병합 원본이 될 수 없습니다.' };
  if (dst.reviewStatus === 'archived') return { ok: false, reason: '보관된 쟁점으로는 병합할 수 없습니다.' };
  return { ok: true, reason: null };
}

// ── 원문 카드 상세 라벨(kind 등) ───────────────────────────────────────

/** 원문 종류 라벨. core=핵심 산출, extra=부가. */
export function itemKindLabel(kind: string): string {
  return kind === 'extra' ? '부가' : '핵심';
}
