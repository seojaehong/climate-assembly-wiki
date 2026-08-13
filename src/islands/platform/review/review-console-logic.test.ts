import { describe, it, expect } from 'vitest';
import type { IssueRow, IssueListResult, IssueItemRow, IssueItemsResult } from '../../../lib/platform';
import {
  FREQUENCY_OPTIONS,
  STANCE_OPTIONS,
  frequencyLabel,
  stanceLabel,
  toIssueViewModel,
  toIssueViewModels,
  toReviewItem,
  toReviewItems,
  canReview,
  canPublish,
  publishGateNotice,
  isUnclassified,
  partitionItems,
  itemsForIssue,
  issueItemIds,
  planReclassify,
  planUnlink,
  validateMerge,
  itemKindLabel,
  sourceReference,
  type ReviewItem,
  type IssueViewModel,
} from './review-console-logic';

// ── 픽스처 ─────────────────────────────────────────────────────────────

function issueRow(over: Partial<IssueRow> = {}): IssueRow {
  return {
    id: 'i1',
    label: '재생에너지 확대',
    stance: 'pro',
    frequency_class: 'majority',
    summary: '요약',
    origin: 'ai',
    review_status: 'draft',
    reviewed_by: null,
    reviewed_at: null,
    archived_at: null,
    linked_item_count: 3,
    consensus_denominator: 2,
    ...over,
  };
}

function item(over: Partial<ReviewItem> = {}): ReviewItem {
  const links = over.links ?? (over.issueIds ?? []).map((issueId) => ({
    issueId,
    clusterId: null,
    linkedBy: 'ai',
  }));
  return {
    itemId: 'it1',
    submissionId: 'su1',
    ordinal: 1,
    teamName: '1분과 1조',
    kind: 'core',
    content: '재생에너지를 늘려야 한다',
    rationale: null,
    issueIds: over.issueIds ?? links.map((link) => link.issueId),
    links,
    ...over,
  };
}

// ── 4×6 코딩 스킴 라벨 ─────────────────────────────────────────────────

describe('4×6 코딩 스킴 라벨', () => {
  it('빈도 4종·방향 6종 옵션이 정확한 개수·값이다', () => {
    expect(FREQUENCY_OPTIONS.map((o) => o.value)).toEqual(['consensus', 'majority', 'minority', 'mixed']);
    expect(STANCE_OPTIONS.map((o) => o.value)).toEqual(['pro', 'con', 'conditional', 'concern', 'proposal', 'neutral']);
  });

  it('빈도 배지 한국어 라벨', () => {
    expect(frequencyLabel('consensus')).toBe('합의');
    expect(frequencyLabel('majority')).toBe('다수의견');
    expect(frequencyLabel('minority')).toBe('소수의견');
    expect(frequencyLabel('mixed')).toBe('혼재');
  });

  it('방향 배지 한국어 라벨', () => {
    expect(stanceLabel('pro')).toBe('찬성');
    expect(stanceLabel('con')).toBe('반대');
    expect(stanceLabel('conditional')).toBe('조건부');
    expect(stanceLabel('concern')).toBe('우려');
    expect(stanceLabel('proposal')).toBe('대안·제안');
    expect(stanceLabel('neutral')).toBe('중립·불명');
  });

  it('null·미지의 값은 미지정', () => {
    expect(frequencyLabel(null)).toBe('미지정');
    expect(frequencyLabel('nonsense')).toBe('미지정');
    expect(stanceLabel(undefined)).toBe('미지정');
    expect(stanceLabel('')).toBe('미지정');
  });
});

// ── 검수 상태 라벨 ─────────────────────────────────────────────────────

// ── issue 뷰모델 ───────────────────────────────────────────────────────

describe('toIssueViewModel', () => {
  it('배지·검수가능·카운트를 실어 준다', () => {
    const vm = toIssueViewModel(issueRow());
    expect(vm.frequencyBadge).toBe('다수의견');
    expect(vm.stanceBadge).toBe('찬성');
    expect(vm.hitl.state).toBe('ai-draft');
    expect(vm.hitl.label).toBe('검수 대기 · AI 초안');
    expect(vm.reviewable).toBe(true);
    expect(vm.linkedItemCount).toBe(3);
    expect(vm.consensusDenominator).toBe(2);
  });

  it('reviewed 는 검수 불가', () => {
    const vm = toIssueViewModel(issueRow({ review_status: 'reviewed', origin: 'human' }));
    expect(vm.reviewable).toBe(false);
    expect(vm.hitl.label).toBe('검수 완료');
  });

  it('toIssueViewModels 는 null/누락을 빈 배열로 흡수', () => {
    expect(toIssueViewModels(null)).toEqual([]);
    expect(toIssueViewModels({ topic_id: 't', issues: undefined as never, unclassified_count: 0, reviewed_count: 0 })).toEqual([]);
    const res: IssueListResult = { topic_id: 't', issues: [issueRow(), issueRow({ id: 'i2' })], unclassified_count: 5, reviewed_count: 0 };
    expect(toIssueViewModels(res)).toHaveLength(2);
  });
});

// ── 게이트 판정 ────────────────────────────────────────────────────────

describe('검수·공개 게이트', () => {
  it('canReview 는 draft 만', () => {
    expect(canReview('draft')).toBe(true);
    expect(canReview('reviewed')).toBe(false);
    expect(canReview('archived')).toBe(false);
  });
  it('canPublish 는 reviewed ≥1', () => {
    expect(canPublish(0)).toBe(false);
    expect(canPublish(1)).toBe(true);
    expect(canPublish(9)).toBe(true);
  });
  it('publishGateNotice 는 0/≥1 로 문구가 갈린다', () => {
    expect(publishGateNotice(0)).toContain('없습니다');
    expect(publishGateNotice(2)).toContain('2건');
    expect(publishGateNotice(2)).toContain('열렸습니다');
  });
});

// ── issue_items body → ReviewItem 매핑 ─────────────────────────────────

function itemRow(over: Partial<IssueItemRow> = {}): IssueItemRow {
  return {
    id: 'si1',
    content: '재생에너지를 늘려야 한다',
    rationale: '탄소중립 목표',
    kind: 'core',
    ordinal: 1,
    team_id: 'tm1',
    team_name: '1분과 1조',
    submission_id: 'su1',
    links: [],
    unclassified: true,
    ...over,
  };
}

describe('toReviewItem / toReviewItems', () => {
  it('링크별 cluster와 linkedBy provenance를 보존한다', () => {
    const vm = toReviewItem(itemRow({
      links: [
        { issue_id: 'i1', cluster_id: null, linked_by: 'ai' },
        { issue_id: 'i2', cluster_id: 'k9', linked_by: 'human' },
      ],
      unclassified: false,
    }));
    expect(vm.itemId).toBe('si1');
    expect(vm.submissionId).toBe('su1');
    expect(vm.teamName).toBe('1분과 1조');
    expect(vm.kind).toBe('core');
    expect(vm.content).toContain('재생에너지');
    expect(vm.issueIds).toEqual(['i1', 'i2']);
    expect(vm.links).toEqual([
      { issueId: 'i1', clusterId: null, linkedBy: 'ai' },
      { issueId: 'i2', clusterId: 'k9', linkedBy: 'human' },
    ]);
  });

  it('원문 참조가 제출 맥락을 보존하고 카드 앵커를 가리킨다', () => {
    const reference = sourceReference(toReviewItem(itemRow()));

    expect(reference).toEqual({
      id: 'source-item-si1',
      href: '#source-item-si1',
      label: '1분과 1조 · 핵심 1번 원문',
      submissionId: 'su1',
    });
  });

  it('링크 없으면 미분류(issueIds 빈 배열)', () => {
    const vm = toReviewItem(itemRow({ links: [], unclassified: true }));
    expect(vm.issueIds).toEqual([]);
    expect(vm.links).toEqual([]);
    expect(isUnclassified(vm)).toBe(true);
  });

  it('team_name null·kind 미지 값 방어', () => {
    const vm = toReviewItem(itemRow({ team_name: null, kind: 'weird' as never }));
    expect(vm.teamName).toBe('(미상 조)');
    expect(vm.kind).toBe('core');
  });

  it('toReviewItems 는 null/누락을 빈 배열로 흡수', () => {
    expect(toReviewItems(null)).toEqual([]);
    expect(toReviewItems({ topic_id: 't', items: undefined as never })).toEqual([]);
    const res: IssueItemsResult = { topic_id: 't', items: [itemRow(), itemRow({ id: 'si2' })] };
    expect(toReviewItems(res).map((i) => i.itemId)).toEqual(['si1', 'si2']);
  });

  it('매핑 결과가 재분류 계획으로 실동작(end-to-end)', () => {
    const res: IssueItemsResult = {
      topic_id: 't',
      items: [
        itemRow({ id: 'a', links: [{ issue_id: 'i1', cluster_id: null, linked_by: 'ai' }], unclassified: false }),
        itemRow({ id: 'b', links: [], unclassified: true }),
      ],
    };
    const items = toReviewItems(res);
    const plan = planReclassify(items, ['b'], 'i1', null, null);
    expect(plan.error).toBeNull();
    expect(plan.calls[0].itemIds.sort()).toEqual(['a', 'b']); // 기존 a 를 파괴하지 않고 b 추가
  });
});

// ── 미분류/파티션 ──────────────────────────────────────────────────────

describe('미분류 판정·파티션', () => {
  it('issueIds 가 비면 미분류', () => {
    expect(isUnclassified(item({ issueIds: [] }))).toBe(true);
    expect(isUnclassified(item({ issueIds: ['i1'] }))).toBe(false);
  });
  it('partitionItems 가 분류/미분류로 가른다', () => {
    const items = [
      item({ itemId: 'a', issueIds: ['i1'] }),
      item({ itemId: 'b', issueIds: [] }),
      item({ itemId: 'c', issueIds: ['i1', 'i2'] }),
    ];
    const { classified, unclassified } = partitionItems(items);
    expect(classified.map((i) => i.itemId)).toEqual(['a', 'c']);
    expect(unclassified.map((i) => i.itemId)).toEqual(['b']);
  });
  it('itemsForIssue·issueItemIds 는 M:N 연결을 반영', () => {
    const items = [
      item({ itemId: 'a', issueIds: ['i1'] }),
      item({ itemId: 'b', issueIds: ['i2'] }),
      item({ itemId: 'c', issueIds: ['i1', 'i2'] }),
    ];
    expect(itemsForIssue(items, 'i1').map((i) => i.itemId)).toEqual(['a', 'c']);
    expect(issueItemIds(items, 'i2')).toEqual(['b', 'c']);
  });
});

// ── 재분류 계획 (replace-all 안전) ─────────────────────────────────────

describe('planReclassify', () => {
  const items = [
    item({ itemId: 'a', issueIds: ['i1'] }),
    item({ itemId: 'b', issueIds: ['i1'] }),
    item({ itemId: 'c', issueIds: ['i2'] }),
    item({ itemId: 'd', issueIds: [] }), // 미분류
  ];

  it('미분류→issue 끌어오기는 target 한 번, 기존 집합 ∪ 선택', () => {
    const plan = planReclassify(items, ['d'], 'i2', null, 'k9');
    expect(plan.error).toBeNull();
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0].role).toBe('target');
    expect(plan.calls[0].issueId).toBe('i2');
    expect(plan.calls[0].itemIds.sort()).toEqual(['c', 'd']);
    expect(plan.calls[0].clusterId).toBe('k9');
  });

  it('issue A→B 이동은 두 호출 — target 은 ∪, source 는 나머지(파괴 방지)', () => {
    const plan = planReclassify(items, ['a'], 'i2', 'i1', null);
    expect(plan.error).toBeNull();
    expect(plan.calls).toHaveLength(2);
    const target = plan.calls.find((c) => c.role === 'target')!;
    const source = plan.calls.find((c) => c.role === 'source')!;
    expect(target.issueId).toBe('i2');
    expect(target.itemIds.sort()).toEqual(['a', 'c']); // 기존 c 를 파괴하지 않음
    expect(source.issueId).toBe('i1');
    expect(source.itemIds).toEqual(['b']); // a 만 빠지고 b 는 남음
    expect(target.clusterId).toBeNull();
    expect(source.clusterId).toBeNull();
  });

  it('대상 결과의 cluster가 다르면 명시적 값 없이는 전체 계획을 거부', () => {
    const mixed = [
      item({ itemId: 'a', links: [{ issueId: 'i1', clusterId: 'k2', linkedBy: 'ai' }] }),
      item({ itemId: 'b', links: [{ issueId: 'i1', clusterId: 'k2', linkedBy: 'ai' }] }),
      item({ itemId: 'c', links: [{ issueId: 'i2', clusterId: 'k1', linkedBy: 'human' }] }),
    ];
    const plan = planReclassify(mixed, ['a'], 'i2', 'i1', null);
    expect(plan.calls).toEqual([]);
    expect(plan.error).toContain('대상 원문');
    expect(plan.error).toContain('cluster_id');
  });

  it('명시적 cluster는 대상 전체를 덮되 원본의 uniform cluster는 보존', () => {
    const mixed = [
      item({ itemId: 'a', links: [{ issueId: 'i1', clusterId: 'k2', linkedBy: 'ai' }] }),
      item({ itemId: 'b', links: [{ issueId: 'i1', clusterId: 'k2', linkedBy: 'human' }] }),
      item({ itemId: 'c', links: [{ issueId: 'i2', clusterId: 'k1', linkedBy: 'human' }] }),
    ];
    const plan = planReclassify(mixed, ['a'], 'i2', 'i1', 'k9');
    expect(plan.error).toBeNull();
    expect(plan.calls).toEqual([
      { issueId: 'i2', itemIds: ['c', 'a'], clusterId: 'k9', role: 'target' },
      { issueId: 'i1', itemIds: ['b'], clusterId: 'k2', role: 'source' },
    ]);
  });

  it('이미 대상에 연결된 null cluster는 원본의 non-null cluster보다 우선 보존', () => {
    const multiLabel = [
      item({
        itemId: 'a',
        links: [
          { issueId: 'i1', clusterId: 'k2', linkedBy: 'ai' },
          { issueId: 'i2', clusterId: null, linkedBy: 'human' },
        ],
      }),
      item({ itemId: 'b', links: [{ issueId: 'i1', clusterId: 'k2', linkedBy: 'ai' }] }),
      item({ itemId: 'c', links: [{ issueId: 'i2', clusterId: null, linkedBy: 'human' }] }),
    ];
    const plan = planReclassify(multiLabel, ['a'], 'i2', 'i1', null);
    expect(plan.error).toBeNull();
    expect(plan.calls[0].clusterId).toBeNull();
    expect(plan.calls[1].clusterId).toBe('k2');
  });

  it('원본에 남는 per-link cluster가 다르면 RPC 호출 전에 전체 계획을 거부', () => {
    const mixed = [
      item({ itemId: 'a', links: [{ issueId: 'i1', clusterId: 'k1', linkedBy: 'ai' }] }),
      item({ itemId: 'b', links: [{ issueId: 'i1', clusterId: 'k1', linkedBy: 'ai' }] }),
      item({ itemId: 'c', links: [{ issueId: 'i1', clusterId: 'k2', linkedBy: 'human' }] }),
      item({ itemId: 'd', links: [{ issueId: 'i2', clusterId: 'k1', linkedBy: 'human' }] }),
    ];
    const plan = planReclassify(mixed, ['a'], 'i2', 'i1', 'k1');
    expect(plan.calls).toEqual([]);
    expect(plan.error).toContain('replace-all RPC');
  });

  it('빈 선택·대상 없음·같은 쟁점·미지의 item 을 거부', () => {
    expect(planReclassify(items, [], 'i2', null, null).error).toContain('선택');
    expect(planReclassify(items, ['a'], null, null, null).error).toContain('대상');
    expect(planReclassify(items, ['a'], 'i1', 'i1', null).error).toContain('같은 쟁점');
    expect(planReclassify(items, ['zzz'], 'i2', null, null).error).toContain('찾을 수 없');
  });

  it('planUnlink 는 남은 집합만 재기록(빈 배열도 유효)', () => {
    const plan = planUnlink(items, 'i1', ['a', 'b']);
    expect(plan.error).toBeNull();
    expect(plan.calls[0].issueId).toBe('i1');
    expect(plan.calls[0].itemIds).toEqual([]);
    expect(planUnlink(items, 'i1', []).error).toContain('선택');
  });

  it('planUnlink는 남은 원문의 cluster가 다르면 전체 계획을 거부', () => {
    const mixed = [
      item({ itemId: 'a', links: [{ issueId: 'i1', clusterId: null, linkedBy: 'ai' }] }),
      item({ itemId: 'b', links: [{ issueId: 'i1', clusterId: 'k1', linkedBy: 'ai' }] }),
      item({ itemId: 'c', links: [{ issueId: 'i1', clusterId: 'k2', linkedBy: 'human' }] }),
    ];
    const plan = planUnlink(mixed, 'i1', ['a']);
    expect(plan.calls).toEqual([]);
    expect(plan.error).toContain('replace-all RPC');
  });

  it('planUnlink는 stale하거나 다른 쟁점의 선택을 거부', () => {
    const plan = planUnlink(items, 'i1', ['c']);
    expect(plan.calls).toEqual([]);
    expect(plan.error).toContain('쟁점 연결');
  });
});

// ── 병합 유효성 ────────────────────────────────────────────────────────

describe('validateMerge', () => {
  const issues: IssueViewModel[] = [
    toIssueViewModel(issueRow({ id: 'i1' })),
    toIssueViewModel(issueRow({ id: 'i2' })),
    toIssueViewModel(issueRow({ id: 'i3', review_status: 'archived', archived_at: '2026-01-01' })),
  ];

  it('정상 병합', () => {
    expect(validateMerge('i1', 'i2', issues)).toEqual({ ok: true, reason: null });
  });
  it('자기 자신 금지', () => {
    expect(validateMerge('i1', 'i1', issues).ok).toBe(false);
    expect(validateMerge('i1', 'i1', issues).reason).toContain('같은 쟁점');
  });
  it('미선택 거부', () => {
    expect(validateMerge(null, 'i2', issues).ok).toBe(false);
    expect(validateMerge('i1', null, issues).ok).toBe(false);
  });
  it('archived 방지(원본·대상)', () => {
    expect(validateMerge('i3', 'i1', issues).reason).toContain('보관');
    expect(validateMerge('i1', 'i3', issues).reason).toContain('보관');
  });
  it('없는 쟁점 거부', () => {
    expect(validateMerge('nope', 'i1', issues).reason).toContain('원본');
  });
});

describe('itemKindLabel', () => {
  it('core/extra', () => {
    expect(itemKindLabel('core')).toBe('핵심');
    expect(itemKindLabel('extra')).toBe('부가');
  });
});
