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
//   · 미로드(스키마 미적용·코드 무효) → 콘솔은 재분류/끌어오기를 **비활성**한다.
// 이유는 issue_link_set 이 replace-all(아래)이라, issue별 전체 item 집합을 모르는 채 부분 집합으로
// 호출하면 기존 링크를 **파괴**한다. gap 을 빈 패널이 아니라 데이터 유실 버그로 만들지 않기 위한 게이트.

import type { IssueRow, IssueListResult, IssueItemRow, IssueItemsResult } from '../../../lib/platform';

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

/**
 * 검수 상태 라벨. draft 는 origin 으로 갈라 표시한다 —
 *   origin='ai'  + draft → 'AI 초안'  (분석코어가 만든 미검수 쟁점)
 *   origin='human'+ draft → '검수 대기' (사람이 편집해 재검수 필요)
 *   reviewed → '검수 완료' · archived → '보관'
 */
export function reviewStatusLabel(status: string, origin: string): string {
  if (status === 'reviewed') return '검수 완료';
  if (status === 'archived') return '보관';
  return origin === 'ai' ? 'AI 초안' : '검수 대기';
}

/** draft 이며 AI 출처인가 — 화면에서 'AI 초안'을 눈에 띄게 표시(HITL 게이트 안내)하기 위한 판정. */
export function isAiDraft(status: string, origin: string): boolean {
  return status === 'draft' && origin === 'ai';
}

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
  statusBadge: string;
  aiDraft: boolean;
  /** 연결 원문 수(issue_list linked_item_count). */
  linkedItemCount: number;
  /** 합의도 분모(cluster 보정, issue_list consensus_denominator). */
  consensusDenominator: number;
  reviewable: boolean;
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
    statusBadge: reviewStatusLabel(status, row.origin),
    aiDraft: isAiDraft(status, row.origin),
    linkedItemCount: row.linked_item_count ?? 0,
    consensusDenominator: row.consensus_denominator ?? 0,
    reviewable: canReview(status),
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

/**
 * 검수용 원문 카드. **P2 에 주제 횡단 item RPC 가 없어** 라이브 로드 경로는 미결(콘솔은 items 를
 * 주입받는다). 링크는 M:N 이므로 issueIds 는 배열(한 원문이 여러 쟁점에 연결될 수 있다).
 */
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
  clusterId: string | null;
}

/**
 * issue_items 원소(IssueItemRow) → ReviewItem 뷰모델. 링크는 multi-label 이므로 issueIds 로 평탄화.
 * clusterId 는 링크 중 최초의 non-null(원문 군집 식별자 — 실무상 item 단위로 일관, per-link 편차는 미결).
 */
export function toReviewItem(row: IssueItemRow): ReviewItem {
  const links = Array.isArray(row.links) ? row.links : [];
  const firstCluster = links.map((l) => l.cluster_id).find((c) => c != null) ?? null;
  return {
    itemId: row.id,
    submissionId: row.submission_id,
    ordinal: row.ordinal,
    teamName: row.team_name ?? '(미상 조)',
    kind: row.kind === 'extra' ? 'extra' : 'core',
    content: row.content,
    rationale: row.rationale,
    issueIds: links.map((l) => l.issue_id),
    clusterId: firstCluster,
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

/** 주어진 item 집합이 공유하는 cluster_id — 전부 같으면 그 값, 아니면 null(재분류 시 보존 판정). */
export function dominantCluster(items: ReviewItem[], itemIds: string[]): string | null {
  const set = new Set(itemIds);
  const clusters = items.filter((it) => set.has(it.itemId)).map((it) => it.clusterId);
  if (clusters.length === 0) return null;
  const first = clusters[0];
  return clusters.every((c) => c === first) ? first : null;
}

/** issue_link_set 한 번의 호출(replace-all: issueId 의 링크를 itemIds 로 통째 교체). */
export interface LinkSetCall {
  issueId: string;
  itemIds: string[];
  clusterId: string | null;
  /** 'target'=끌어온/이동한 쪽, 'source'=원본에서 뺀 쪽. */
  role: 'target' | 'source';
}

export interface ReclassifyPlan {
  calls: LinkSetCall[];
  error: string | null;
}

/**
 * 재분류/끌어오기 계획 — issue_link_set 이 **replace-all**(delete then insert)이므로 부분 집합
 * 호출은 기존 링크를 파괴한다. 그래서 각 issue 의 **전체 결과 집합**을 계산해 최대 2번의 호출을 낸다.
 *   · targetIssueId 로 이동(∪ selected)
 *   · sourceIssueId 가 있으면 원본에서 뺀 나머지(\ selected)로 원본 재기록
 * 미분류에서 끌어오기는 sourceIssueId 를 비운다(target 한 번).
 * clusterId: RPC 는 한 호출의 모든 item 에 같은 값을 건다 → target 은 요청값을,
 *   source 재기록은 남은 item 이 공유하던 cluster 를 보존(uniform 아니면 null). ★ per-item cluster 보존 불가(미결).
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

  const targetSet = Array.from(new Set([...issueItemIds(items, targetIssueId), ...selected]));
  const calls: LinkSetCall[] = [
    { issueId: targetIssueId, itemIds: targetSet, clusterId: requestedClusterId, role: 'target' },
  ];
  if (sourceIssueId) {
    const remaining = issueItemIds(items, sourceIssueId).filter((id) => !selected.includes(id));
    calls.push({
      issueId: sourceIssueId,
      itemIds: remaining,
      clusterId: dominantCluster(items, remaining),
      role: 'source',
    });
  }
  return { calls, error: null };
}

/**
 * 선택 issue 의 링크에서 원문을 제거(연결 해제) — issue_link_set 으로 남은 집합만 재기록.
 * 되돌아간 원문은 미분류함으로 떨어진다. 빈 배열도 유효(전체 해제).
 */
export function planUnlink(items: ReviewItem[], issueId: string, removeItemIds: string[]): ReclassifyPlan {
  if (removeItemIds.length === 0) return { calls: [], error: '해제할 원문을 선택하세요.' };
  const remaining = issueItemIds(items, issueId).filter((id) => !removeItemIds.includes(id));
  return {
    calls: [{ issueId, itemIds: remaining, clusterId: dominantCluster(items, remaining), role: 'source' }],
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
