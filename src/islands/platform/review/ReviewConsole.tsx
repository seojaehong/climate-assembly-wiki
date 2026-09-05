// 검수 콘솔 — AI 초안을 사람이 원문과 대조해 확정하는 검수실 (플랫폼 핵심 화면)
//
// gongron 최대 강점(§2-1)을 우리 데이터로 이식: 4×6 코딩 스킴 배지 · 원문 재분류 · 병합 · 검수 게이트.
// 데이터는 authenticated staff RPC만 쓴다.
// 색·타이포는 /mod 콘솔 톤. 합니다체. 라이브는 스키마 적용 후 동작(guard 가 미적용을 notice 로 흡수).
//
// 원문 본문·링크는 선택한 sessionId와 topicId로 조회한다(issue_list 는 카운트만).
//   issue_items 성공 → 연결 원문 카드·미분류함 본문·재분류/끌어오기 **활성**.
//   실패(스키마 미적용·권한 오류) → items 미로드로 남아 재분류/끌어오기 **비활성**(replace-all 파괴 방지).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HitlBadge from '../../../components/HitlBadge';
import {
  issueList,
  issueItems,
  issueUpsert,
  issueReclassify,
  issueMerge,
  issueReview,
  type IssueListResult,
  type IssueItemsResult,
  type PlatformResult,
} from '../../../lib/platform';
import {
  FREQUENCY_OPTIONS,
  STANCE_OPTIONS,
  toIssueViewModels,
  toReviewItems,
  publishGateNotice,
  canPublish,
  partitionItems,
  itemsForIssue,
  planReclassify,
  planUnlink,
  validateMerge,
  itemKindLabel,
  sourceReference,
  reclassifyPlanFingerprint,
  type IssueViewModel,
  type ReviewItem,
  type ReclassifyPlan,
} from './review-console-logic';

const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const MUTED = '#5A6B73';
const LINE = '#6B7D88';
const PANEL = '#F1F7FA';
const AMBER = '#8A4F08';
const RED = '#B91C1C';
export const REVIEW_STATUS_GREEN = '#2F6F25';
const GREEN = REVIEW_STATUS_GREEN;

type IssueListLoader = (sessionId: string, topicId: string) => Promise<PlatformResult<IssueListResult>>;
type IssueItemsLoader = (sessionId: string, topicId: string) => Promise<PlatformResult<IssueItemsResult>>;

export interface ReviewLoadData {
  list: IssueListResult | null;
  items: ReviewItem[] | null;
}

export async function loadReviewData(
  sessionId: string,
  topicId: string,
  listLoader: IssueListLoader = issueList,
  itemsLoader: IssueItemsLoader = issueItems,
): Promise<PlatformResult<ReviewLoadData>> {
  const [listResult, itemsResult] = await Promise.all([
    listLoader(sessionId, topicId),
    itemsLoader(sessionId, topicId),
  ]);
  const notices: string[] = [];
  if (!listResult.data) {
    if (!listResult.notice) console.error('Review issue list request returned no data or notice');
    notices.push(listResult.notice ?? '쟁점 목록을 불러오지 못했습니다.');
  }
  if (!itemsResult.data) {
    if (!itemsResult.notice) console.error('Review issue items request returned no data or notice');
    notices.push(itemsResult.notice ?? '원문 목록을 불러오지 못했습니다.');
  }
  const data = listResult.data || itemsResult.data
    ? {
        list: listResult.data,
        items: itemsResult.data ? toReviewItems(itemsResult.data) : null,
      }
    : null;
  return { data, notice: notices.length > 0 ? notices.join(' ') : null };
}

export async function completeReviewLoad(
  action: () => Promise<PlatformResult<ReviewLoadData>>,
  onBusyChange: (busy: boolean) => void,
  onDataChange: (data: ReviewLoadData | null) => void,
  onNoticeChange: (notice: string | null) => void,
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  onBusyChange(true);
  onDataChange(null);
  onNoticeChange(null);
  try {
    const result = await action();
    if (!isCurrent()) return false;
    if (result.data) onDataChange(result.data);
    if (result.notice) onNoticeChange(result.notice);
    if (!result.data && !result.notice) {
      console.error('Review request returned no data or notice');
      onNoticeChange('검수 데이터를 불러오지 못했습니다.');
    }
    return Boolean(result.data?.list);
  } catch (error: unknown) {
    if (!isCurrent()) return false;
    console.error('Failed to load review data', error);
    onNoticeChange('검수 데이터를 불러오는 중 예상하지 못한 오류가 발생했습니다.');
    return false;
  } finally {
    if (isCurrent()) onBusyChange(false);
  }
}

export async function completeReviewMutation<T>(
  action: () => Promise<PlatformResult<T>>,
  onBusyChange: (busy: boolean) => void,
  onError: (notice: string) => void,
  isCurrent: () => boolean = () => true,
): Promise<T | null> {
  onBusyChange(true);
  try {
    const result = await action();
    if (!isCurrent()) return null;
    if (result.notice) {
      onError(result.notice);
      return null;
    }
    if (result.data === null) {
      console.error('Review mutation returned no data or notice');
      onError('검수 작업 결과를 확인하지 못했습니다. 현재 데이터를 다시 불러오세요.');
      return null;
    }
    return result.data;
  } catch (error: unknown) {
    if (!isCurrent()) return null;
    console.error('Failed to complete review mutation', error);
    onError('검수 작업 중 예상하지 못한 오류가 발생했습니다. 현재 데이터를 다시 불러오세요.');
    return null;
  } finally {
    if (isCurrent()) onBusyChange(false);
  }
}

// ── 작은 프리미티브 ────────────────────────────────────────────────────

function Eyebrow({ children, color = TEAL }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '.14em', color, textTransform: 'uppercase' }}>
      {children}
    </div>
  );
}

function Badge({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return (
    <span style={{ display: 'inline-block', fontSize: 12, fontWeight: 700, color: fg, background: bg, borderRadius: 999, padding: '2px 10px', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

export function ReviewIssueChoice({
  vm,
  active,
  onSelect,
}: {
  vm: IssueViewModel;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        border: `2px solid ${active ? TEAL : LINE}`,
        borderRadius: 14, background: active ? '#F1FAFB' : '#fff', padding: '12px 14px',
      }}
    >
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <Badge bg="#E7F0FA" fg={NAVY}>{vm.frequencyBadge}</Badge>
        <Badge bg="#F0EAF7" fg="#6B3FA0">{vm.stanceBadge}</Badge>
        <HitlBadge status={vm.hitl} />
        {active ? <Badge bg="#E4F2F6" fg={TEAL}>선택됨</Badge> : null}
      </span>
      <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: INK, lineHeight: 1.4 }}>{vm.label}</span>
      <span style={{ display: 'block', fontSize: 12, color: MUTED, marginTop: 6 }}>
        연결 원문 {vm.linkedItemCount}건 · 합의도 분모 {vm.consensusDenominator}
      </span>
    </button>
  );
}

const btn = (kind: 'primary' | 'ghost' | 'danger' | 'disabled'): React.CSSProperties => {
  const base: React.CSSProperties = { fontSize: 14, fontWeight: 700, borderRadius: 10, padding: '9px 16px', cursor: 'pointer', border: 'none' };
  if (kind === 'primary') return { ...base, background: TEAL, color: '#fff' };
  if (kind === 'danger') return { ...base, background: '#fff', color: RED, border: `2px solid ${RED}` };
  if (kind === 'disabled') return { ...base, background: '#CBD5DC', color: '#fff', cursor: 'default' };
  return { ...base, background: '#fff', color: NAVY, border: `2px solid ${LINE}` };
};

const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', height: 44, padding: '0 12px', fontSize: 14,
  border: `2px solid ${LINE}`, borderRadius: 10, color: INK, background: '#fff',
};

// ── 편집 폼 상태 ───────────────────────────────────────────────────────

interface EditForm {
  id: string | null;
  expectedSnapshotHash: string | null;
  label: string;
  stance: string;
  frequency: string;
  summary: string;
}

export interface IssueUpsertIntentInput {
  sessionId: string;
  topicId: string;
  existingIssueId: string | null;
  expectedSnapshotHash: string | null;
  label: string;
  stance?: string;
  frequency?: string;
  summary?: string;
}

export interface IssueUpsertIntent {
  fingerprint: string;
  issueId: string;
  idempotencyKey: string;
}

/** Canonical fingerprint of the exact server request except generated UUIDs. */
export function issueUpsertIntentFingerprint(input: IssueUpsertIntentInput): string {
  return JSON.stringify([
    'platform_issue_upsert_v3',
    input.sessionId,
    input.topicId,
    input.existingIssueId,
    input.expectedSnapshotHash,
    input.label,
    input.stance ?? null,
    input.frequency ?? null,
    input.summary ?? null,
  ]);
}

/**
 * Reuses both UUIDs only for an exact ambiguous retry. A changed field or CAS
 * snapshot starts a new intent; creates also receive a new stable issue UUID.
 */
export function ensureIssueUpsertIntent(
  current: IssueUpsertIntent | null,
  input: IssueUpsertIntentInput,
  createId: () => string = () => crypto.randomUUID(),
): IssueUpsertIntent {
  const fingerprint = issueUpsertIntentFingerprint(input);
  if (current?.fingerprint === fingerprint) return current;
  return {
    fingerprint,
    issueId: input.existingIssueId ?? createId(),
    idempotencyKey: createId(),
  };
}

export interface ReviewFlash {
  kind: 'status' | 'error';
  text: string;
}

interface ReviewMutationContext {
  requestGeneration: number;
  serial: number;
  topicId: string;
  sessionId: string;
}

const emptyForm: EditForm = {
  id: null,
  expectedSnapshotHash: null,
  label: '',
  stance: '',
  frequency: '',
  summary: '',
};

export function ReviewFlashNotice({ flash }: { flash: ReviewFlash }) {
  return (
    <p
      role={flash.kind === 'error' ? 'alert' : 'status'}
      aria-live={flash.kind === 'status' ? 'polite' : undefined}
      style={{ fontSize: 14, fontWeight: 600, color: flash.kind === 'error' ? RED : NAVY, background: flash.kind === 'error' ? '#FDECEC' : '#E4F2F6', borderRadius: 10, padding: '10px 14px', margin: '0 0 14px' }}
    >
      {flash.text}
    </p>
  );
}

function formFrom(vm: IssueViewModel): EditForm {
  return {
    id: vm.id,
    expectedSnapshotHash: vm.snapshotHash || null,
    label: vm.label,
    stance: vm.stance ?? '',
    frequency: vm.frequencyClass ?? '',
    summary: vm.summary ?? '',
  };
}

// ── 콘솔 ───────────────────────────────────────────────────────────────

export interface ReviewConsoleProps {
  /** 검수 대상 주제(discussion_topic) id — 스코프에서 온다. */
  topicId: string | null;
  /** 검수 대상을 포함하는 회차 id — 인증된 기관 트리에서 온다. */
  sessionId: string | null;
  /**
   * 원문(submission_item) 주입 override — 테스트/스토리용. undefined 면 issue_items RPC 로 자체 조회한다.
   * P2 issue_items 성공 시 items 가 채워져 연결 원문 본문·미분류함 본문·재분류가 **활성**된다.
   * 조회 실패(스키마 미적용 등)면 null 로 남아 재분류/끌어오기가 비활성(replace-all 파괴 방지).
   */
  items?: ReviewItem[] | null;
}

export default function ReviewConsole({ topicId, sessionId, items: itemsOverride }: ReviewConsoleProps) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [list, setList] = useState<IssueListResult | null>(null);
  const [fetchedItems, setFetchedItems] = useState<ReviewItem[] | null>(null); // issue_items 조회 결과
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>(emptyForm);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reclassTarget, setReclassTarget] = useState<string>('');
  const [clusterId, setClusterId] = useState<string>('');
  const [mergeSrc, setMergeSrc] = useState<string>('');
  const [mergeDst, setMergeDst] = useState<string>('');
  const [flash, setFlash] = useState<ReviewFlash | null>(null);
  const requestGeneration = useRef(0);
  const currentTopicId = useRef(topicId);
  const currentSessionId = useRef(sessionId);
  const mutationSerial = useRef(0);
  const mutationInFlight = useRef(false);
  const issueUpsertIntent = useRef<IssueUpsertIntent | null>(null);
  const reclassifyIntent = useRef<{ fingerprint: string; id: string } | null>(null);
  const reviewIntent = useRef<{ fingerprint: string; id: string } | null>(null);
  const mergeIntent = useRef<{ fingerprint: string; id: string } | null>(null);
  const flashGeneration = useRef(0);
  currentTopicId.current = topicId;
  currentSessionId.current = sessionId;

  // 유효 items = override(테스트 주입) 우선, 없으면 자체 조회분. null = 미로드(재분류 비활성).
  const items = itemsOverride !== undefined ? itemsOverride : fetchedItems;
  const itemsLoaded = items !== null;

  useEffect(() => {
    requestGeneration.current += 1;
    setActiveSessionId(null);
    setList(null);
    setFetchedItems(null);
    setNotice(null);
    setBusy(false);
    setSelectedId(null);
    setForm(emptyForm);
    setChecked(new Set());
    setFlash(null);
    mutationSerial.current += 1;
    mutationInFlight.current = false;
    issueUpsertIntent.current = null;
    reclassifyIntent.current = null;
    reviewIntent.current = null;
    mergeIntent.current = null;
    flashGeneration.current += 1;
    return () => {
      requestGeneration.current += 1;
      mutationSerial.current += 1;
      mutationInFlight.current = false;
      flashGeneration.current += 1;
    };
  }, [sessionId, topicId]);

  const reload = useCallback(async (): Promise<boolean> => {
    if (!topicId) {
      setNotice('주제(topic) 스코프를 먼저 선택하세요.');
      return false;
    }
    if (!sessionId) {
      setNotice('회차 연결 정보를 확인하지 못했습니다. 좌측 트리에서 주제를 다시 선택하세요.');
      return false;
    }
    if (currentTopicId.current !== topicId || currentSessionId.current !== sessionId) return false;
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    const loaded = await completeReviewLoad(
      () => loadReviewData(sessionId, topicId),
      setBusy,
      (data) => {
        setList(data?.list ?? null);
        setFetchedItems(data?.items ?? null);
        setActiveSessionId(data?.list ? sessionId : null);
      },
      setNotice,
      () => requestGeneration.current === generation
        && currentTopicId.current === topicId
        && currentSessionId.current === sessionId,
    );
    return loaded;
  }, [sessionId, topicId]);

  useEffect(() => {
    if (topicId && sessionId) void reload();
  }, [reload, sessionId, topicId]);

  const issues = useMemo(() => toIssueViewModels(list), [list]);
  const selected = useMemo(() => issues.find((i) => i.id === selectedId) ?? null, [issues, selectedId]);
  const reviewedCount = list?.reviewed_count ?? 0;
  const unclassifiedCount = list?.unclassified_count ?? 0;

  // 선택 issue 가 목록에서 사라지면(병합 등) 선택 해제.
  useEffect(() => {
    if (selectedId && !issues.some((i) => i.id === selectedId)) {
      setSelectedId(null);
      setForm(emptyForm);
    }
  }, [issues, selectedId]);

  const partition = useMemo(() => (items ? partitionItems(items) : null), [items]);
  const linkedItems = useMemo(
    () => (items && selected ? itemsForIssue(items, selected.id) : []),
    [items, selected],
  );

  const showFlash = (text: string, kind: ReviewFlash['kind'] = 'error') => {
    const generation = flashGeneration.current + 1;
    flashGeneration.current = generation;
    setFlash({ kind, text });
    window.setTimeout(() => {
      if (flashGeneration.current === generation) setFlash(null);
    }, 2600);
  };

  const isMutationCurrent = (context: ReviewMutationContext): boolean => (
    requestGeneration.current === context.requestGeneration
    && mutationSerial.current === context.serial
    && currentTopicId.current === context.topicId
    && currentSessionId.current === context.sessionId
  );

  const runMutation = async <T,>(action: () => Promise<PlatformResult<T>>): Promise<T | null> => {
    if (!topicId || !sessionId || mutationInFlight.current) return null;
    mutationInFlight.current = true;
    const context: ReviewMutationContext = {
      requestGeneration: requestGeneration.current,
      serial: mutationSerial.current + 1,
      topicId,
      sessionId,
    };
    mutationSerial.current = context.serial;
    try {
      return await completeReviewMutation(
        action,
        setBusy,
        (message) => showFlash(message, 'error'),
        () => isMutationCurrent(context),
      );
    } finally {
      if (mutationSerial.current === context.serial) mutationInFlight.current = false;
    }
  };

  // ── 편집 저장 ──
  const selectIssue = (vm: IssueViewModel) => {
    issueUpsertIntent.current = null;
    setSelectedId(vm.id);
    setForm(formFrom(vm));
    setChecked(new Set());
    setReclassTarget('');
  };
  const newIssue = () => {
    issueUpsertIntent.current = null;
    setSelectedId(null);
    setForm(emptyForm);
    setChecked(new Set());
  };

  const saveIssue = async () => {
    if (!activeSessionId || !topicId) return;
    if (!form.label.trim()) { showFlash('쟁점명을 입력하세요.'); return; }
    if (form.id !== null && !form.expectedSnapshotHash) {
      showFlash('수정 기준값을 확인하지 못했습니다. 최신 쟁점을 다시 선택하세요.');
      return;
    }

    const payload = {
      label: form.label.trim(),
      stance: form.stance || undefined,
      frequency: form.frequency || undefined,
      summary: form.summary.trim() || undefined,
    };
    const intent = ensureIssueUpsertIntent(issueUpsertIntent.current, {
      sessionId: activeSessionId,
      topicId,
      existingIssueId: form.id,
      expectedSnapshotHash: form.expectedSnapshotHash,
      ...payload,
    });
    issueUpsertIntent.current = intent;

    const result = await runMutation(() => issueUpsert(
      activeSessionId,
      topicId,
      { id: intent.issueId, ...payload },
      form.expectedSnapshotHash,
      intent.idempotencyKey,
    ));
    if (!result) {
      await reload();
      return;
    }
    if (result.status === 'conflict' && result.id === intent.issueId && result.current_snapshot_hash) {
      issueUpsertIntent.current = null;
      setSelectedId(null);
      setForm(emptyForm);
      await reload();
      showFlash('쟁점이 다른 화면에서 바뀌었습니다. 최신 내용을 다시 선택해 검토하세요.');
      return;
    }
    if (
      result.status !== 'applied'
      || result.id !== intent.issueId
      || typeof result.created !== 'boolean'
      || !result.snapshot_hash
    ) {
      console.error('Unexpected issue upsert result', result);
      await reload();
      showFlash('저장 결과를 확인하지 못했습니다. 최신 목록을 확인한 뒤 같은 내용으로 다시 시도하세요.');
      return;
    }
    issueUpsertIntent.current = null;
    showFlash(result.created ? '쟁점을 만들었습니다(검수 대기).' : '쟁점을 수정했습니다 — 재검수가 필요합니다.', 'status');
    const savedId = result.id;
    setForm((current) => ({
      ...current,
      id: savedId,
      expectedSnapshotHash: result.snapshot_hash,
      label: payload.label,
      summary: payload.summary ?? '',
    }));
    const loaded = await reload();
    if (loaded && savedId) setSelectedId(savedId);
  };

  // ── 검수 확정 ──
  const doReview = async (issueId: string) => {
    if (!activeSessionId) return;
    const issue = issues.find((candidate) => candidate.id === issueId);
    if (!issue?.snapshotHash) {
      showFlash('검수 기준값을 확인하지 못했습니다. 데이터를 새로고침한 뒤 다시 시도하세요.');
      return;
    }
    const fingerprint = `${issue.id}:${issue.snapshotHash}`;
    if (reviewIntent.current?.fingerprint !== fingerprint) {
      reviewIntent.current = { fingerprint, id: crypto.randomUUID() };
    }
    const intentId = reviewIntent.current.id;
    const result = await runMutation(() => issueReview(
      activeSessionId,
      issue.id,
      issue.snapshotHash,
      intentId,
    ));
    if (!result) return;
    reviewIntent.current = null;
    if (result.status === 'conflict') {
      await reload();
      showFlash('쟁점 내용이나 연결 원문이 다른 화면에서 바뀌었습니다. 최신 내용을 다시 확인하세요.');
      return;
    }
    if (result.status !== 'applied') {
      console.error('Unexpected issue review result', result);
      showFlash('검수 결과를 확인하지 못했습니다. 현재 데이터를 다시 불러오세요.');
      return;
    }
    showFlash('검수 완료로 확정했습니다.', 'status');
    await reload();
  };

  // ── 재분류/끌어오기 — 전체 계획을 서버의 단일 트랜잭션으로 적용 ──
  const runPlan = async (plan: ReclassifyPlan, okMsg: string) => {
    if (plan.error) { showFlash(plan.error); return; }
    if (!activeSessionId || !topicId || plan.calls.length === 0) return;
    const fingerprint = reclassifyPlanFingerprint(plan);
    if (reclassifyIntent.current?.fingerprint !== fingerprint) {
      reclassifyIntent.current = { fingerprint, id: crypto.randomUUID() };
    }
    const intentId = reclassifyIntent.current.id;
    const result = await runMutation(() => issueReclassify(
      activeSessionId,
      topicId,
      plan.calls,
      intentId,
    ));
    if (!result) return;
    reclassifyIntent.current = null;
    if (result.status === 'conflict') {
      setChecked(new Set());
      await reload();
      showFlash('다른 화면에서 원문 분류가 변경되었습니다. 최신 데이터를 불러왔으니 다시 선택하세요.');
      return;
    }
    if (result.status !== 'applied') {
      console.error('Unexpected atomic reclassification result', result);
      showFlash('재분류 결과를 확인하지 못했습니다. 현재 데이터를 다시 불러오세요.');
      return;
    }
    showFlash(okMsg, 'status');
    setChecked(new Set());
    await reload();
  };

  const reclassifyChecked = () => {
    if (!items) return;
    const plan = planReclassify(items, [...checked], reclassTarget || null, selected?.id ?? null, clusterId.trim() || null);
    void runPlan(plan, '선택 원문을 재분류했습니다 — 두 쟁점이 재검수 대기로 돌아갑니다.');
  };

  const pullIntoSelected = (itemId: string) => {
    if (!items || !selected) { showFlash('먼저 대상 쟁점을 선택하세요.'); return; }
    const plan = planReclassify(items, [itemId], selected.id, null, clusterId.trim() || null);
    void runPlan(plan, '원문을 이 쟁점으로 끌어왔습니다.');
  };

  const unlinkChecked = () => {
    if (!items || !selected) return;
    const plan = planUnlink(items, selected.id, [...checked]);
    void runPlan(plan, '선택 원문의 연결을 해제했습니다(미분류함으로 이동).');
  };

  // ── 병합 ──
  const doMerge = async () => {
    if (!activeSessionId) return;
    const v = validateMerge(mergeSrc || null, mergeDst || null, issues);
    if (!v.ok) { showFlash(v.reason ?? '병합할 수 없습니다.'); return; }
    const source = issues.find((issue) => issue.id === mergeSrc);
    const destination = issues.find((issue) => issue.id === mergeDst);
    if (!source?.snapshotHash || !destination?.snapshotHash) {
      showFlash('병합 기준값을 확인하지 못했습니다. 데이터를 새로고침한 뒤 다시 시도하세요.');
      return;
    }
    const fingerprint = [
      source.id,
      source.snapshotHash,
      destination.id,
      destination.snapshotHash,
    ].join(':');
    if (mergeIntent.current?.fingerprint !== fingerprint) {
      mergeIntent.current = { fingerprint, id: crypto.randomUUID() };
    }
    const intentId = mergeIntent.current.id;
    const result = await runMutation(() => issueMerge(
      activeSessionId,
      source.id,
      destination.id,
      source.snapshotHash,
      destination.snapshotHash,
      intentId,
    ));
    if (!result) return;
    mergeIntent.current = null;
    if (result.status === 'conflict') {
      await reload();
      showFlash('병합 대상의 내용이나 연결 원문이 바뀌었습니다. 최신 내용을 확인하고 다시 병합하세요.');
      return;
    }
    if (result.status !== 'applied' || typeof result.moved !== 'number') {
      console.error('Unexpected issue merge result', result);
      showFlash('병합 결과를 확인하지 못했습니다. 현재 데이터를 다시 불러오세요.');
      return;
    }
    showFlash(`병합 완료 — 원문 ${result.moved}건 이전, 원본은 보관되었습니다.`, 'status');
    setMergeSrc(''); setMergeDst('');
    await reload();
  };

  const toggleCheck = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── 렌더 ────────────────────────────────────────────────────────────
  if (!topicId) {
    return (
      <div style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, padding: '22px 20px', background: PANEL, color: MUTED, fontSize: 15 }}>
        검수는 <b style={{ color: NAVY }}>주제(topic)</b> 스코프에서 엽니다. 좌측 트리에서 회차 아래 주제를 선택하세요.
      </div>
    );
  }

  if (!sessionId) {
    return (
      <div role="alert" style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, padding: '22px 20px', background: PANEL, color: MUTED, fontSize: 15 }}>
        회차 연결 정보를 확인하지 못했습니다. 좌측 트리에서 주제를 다시 선택하세요.
      </div>
    );
  }

  return (
    <div aria-busy={busy} style={{ fontFamily: 'Pretendard, system-ui, sans-serif', color: INK }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <Eyebrow>검수실 · HITL</Eyebrow>
          <h2 style={{ fontSize: 24, fontWeight: 800, color: NAVY, margin: '4px 0 4px', letterSpacing: '-.01em' }}>
            🔎 쟁점 검수 — AI 초안을 원문과 대조해 확정
          </h2>
          <p style={{ color: MUTED, fontSize: 14, margin: 0 }}>
            AI가 만든 <b style={{ color: AMBER }}>초안(draft)</b>을 사람이 확인·수정·병합하고 「검수 완료」해야 공개할 수 있습니다.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 14px', padding: '8px 12px', border: `2px solid ${LINE}`, borderRadius: 10, background: PANEL }}>
        <p style={{ fontSize: 12, color: MUTED, margin: 0 }}>로그인된 운영자 권한과 선택한 회차를 기준으로 자동 동기화합니다.</p>
        <button type="button" onClick={() => { void reload(); }} disabled={busy} style={busy ? btn('disabled') : btn('ghost')}>
          {busy ? '불러오는 중…' : '검수 데이터 새로고침'}
        </button>
      </div>

      {notice ? (
        <p role="alert" style={{ fontSize: 14, color: AMBER, background: '#FBF3E6', borderRadius: 10, padding: '10px 14px', margin: '0 0 14px' }}>{notice}</p>
      ) : null}
      {flash ? (
        <ReviewFlashNotice flash={flash} />
      ) : null}

      {/* 공개 게이트 안내 */}
      {list ? (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', borderRadius: 12, background: canPublish(reviewedCount) ? '#E3F1E6' : PANEL, border: `2px solid ${canPublish(reviewedCount) ? GREEN : LINE}` }}>
          <span style={{ fontSize: 20 }} aria-hidden="true">{canPublish(reviewedCount) ? '📢' : '🔒'}</span>
          <span style={{ fontSize: 14, color: canPublish(reviewedCount) ? GREEN : MUTED, fontWeight: 600 }}>{publishGateNotice(reviewedCount)}</span>
        </div>
      ) : null}

      {list ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(340px, 1.3fr)', gap: 18, alignItems: 'start' }}>
          {/* 좌: issue 목록 */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Eyebrow color={MUTED}>쟁점 {issues.length}건 · 검수완료 {reviewedCount}</Eyebrow>
              <button onClick={newIssue} style={{ ...btn('ghost'), padding: '6px 12px', fontSize: 13 }}>+ 새 쟁점</button>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {issues.length === 0 ? (
                <li style={{ color: MUTED, fontSize: 14, padding: 8 }}>이 주제에 등록된 쟁점이 없습니다. 「새 쟁점」으로 만들거나 분석코어 적재를 기다립니다.</li>
              ) : issues.map((vm) => {
                const active = vm.id === selectedId;
                return (
                  <li key={vm.id}>
                    <ReviewIssueChoice vm={vm} active={active} onSelect={() => selectIssue(vm)} />
                  </li>
                );
              })}
            </ul>

            {/* 병합 */}
            <div style={{ marginTop: 18, border: `2px solid ${LINE}`, borderRadius: 14, padding: 14, background: '#fff' }}>
              <Eyebrow color={MUTED}>쟁점 병합</Eyebrow>
              <p style={{ fontSize: 12, color: MUTED, margin: '6px 0 10px' }}>원본의 연결 원문을 대상으로 이전하고 원본은 보관합니다.</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select aria-label="병합할 원본 쟁점" value={mergeSrc} onChange={(e) => setMergeSrc(e.target.value)} style={{ ...field, height: 40, width: 'auto', flex: 1, minWidth: 120 }}>
                  <option value="">원본…</option>
                  {issues.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
                <span style={{ color: MUTED }}>→</span>
                <select aria-label="병합 대상 쟁점" value={mergeDst} onChange={(e) => setMergeDst(e.target.value)} style={{ ...field, height: 40, width: 'auto', flex: 1, minWidth: 120 }}>
                  <option value="">대상…</option>
                  {issues.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
                <button onClick={doMerge} disabled={busy} style={busy ? btn('disabled') : btn('ghost')}>병합</button>
              </div>
            </div>
          </section>

          {/* 중: 편집 + 연결 원문 + 재분류 / 우하: 미분류함 */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* 편집 */}
            <div style={{ border: `2px solid ${LINE}`, borderRadius: 16, padding: 18, background: '#fff' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Eyebrow>{form.id ? '쟁점 편집' : '새 쟁점'}</Eyebrow>
                {selected ? (
                  selected.reviewable ? (
                    <button onClick={() => doReview(selected.id)} disabled={busy} style={{ ...(busy ? btn('disabled') : btn('primary')), background: busy ? '#CBD5DC' : GREEN }}>
                      ✓ 검수 완료
                    </button>
                  ) : (
                    <span style={{ fontSize: 13, color: MUTED }}>
                      {selected.reviewStatus === 'reviewed' ? '검수 완료됨' : '보관됨'} — 재검수 불가
                    </span>
                  )
                ) : null}
              </div>

              <label htmlFor="review-issue-label" style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 4 }}>쟁점명(label)</label>
              <input id="review-issue-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="예: 재생에너지 발전 비중 확대" style={{ ...field, marginBottom: 12 }} />

              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label htmlFor="review-frequency" style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 4 }}>빈도(합의도)</label>
                  <select id="review-frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })} style={{ ...field }}>
                    <option value="">미지정</option>
                    {FREQUENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label htmlFor="review-stance" style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 4 }}>방향(입장)</label>
                  <select id="review-stance" value={form.stance} onChange={(e) => setForm({ ...form, stance: e.target.value })} style={{ ...field }}>
                    <option value="">미지정</option>
                    {STANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <label htmlFor="review-summary" style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 4 }}>요약(summary)</label>
              <textarea id="review-summary" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} rows={3} placeholder="쟁점 확정문(사람 검수)" style={{ ...field, height: 'auto', padding: 12, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5, marginBottom: 12 }} />

              <button onClick={saveIssue} disabled={busy} style={busy ? btn('disabled') : btn('primary')}>
                {form.id ? '수정 저장(재검수 대기)' : '새 쟁점 만들기'}
              </button>
            </div>

            {/* 연결 원문 + 재분류 */}
            {selected ? (
              <div style={{ border: `2px solid ${LINE}`, borderRadius: 16, padding: 18, background: '#fff' }}>
                <Eyebrow color={MUTED}>연결 원문 · {selected.label}</Eyebrow>
                {!itemsLoaded ? (
                  <p style={{ fontSize: 13, color: AMBER, margin: '10px 0 0', lineHeight: 1.6 }}>
                    연결 원문 <b>{selected.linkedItemCount}건</b>(카운트만). 원문 본문이 로드되지 않아 재분류가 비활성입니다 — 스키마 적용 상태와 운영자 권한을 확인하세요.
                  </p>
                ) : linkedItems.length === 0 ? (
                  <p style={{ fontSize: 14, color: MUTED, margin: '10px 0 0' }}>연결된 원문이 없습니다. 아래 미분류함에서 끌어오세요.</p>
                ) : (
                  <>
                    <SourceReferenceList items={linkedItems} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
                      {linkedItems.map((it) => (
                        <ReviewSourceCard key={it.itemId} item={it} checked={checked.has(it.itemId)} onToggle={() => toggleCheck(it.itemId)} />
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: `2px solid ${LINE}`, paddingTop: 12 }}>
                      <select aria-label="선택 원문을 이동할 대상 쟁점" value={reclassTarget} onChange={(e) => setReclassTarget(e.target.value)} style={{ ...field, height: 40, width: 'auto', flex: 1, minWidth: 140 }}>
                        <option value="">다른 쟁점으로 이동…</option>
                        {issues.filter((i) => i.id !== selected.id).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                      </select>
                      <button onClick={reclassifyChecked} disabled={busy || checked.size === 0} style={busy || checked.size === 0 ? btn('disabled') : btn('ghost')}>선택 이동</button>
                      <button onClick={unlinkChecked} disabled={busy || checked.size === 0} style={busy || checked.size === 0 ? btn('disabled') : btn('danger')}>연결 해제</button>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <label htmlFor="review-cluster-id" style={{ fontSize: 12, color: MUTED }}>cluster_id(합의도 분모 보정, 입력 시 대상 원문 전체에 적용)</label>
                      <input id="review-cluster-id" value={clusterId} onChange={(e) => setClusterId(e.target.value)} placeholder="선택 — 같은 원문 군집 uuid" style={{ ...field, marginTop: 4, fontFamily: 'monospace', fontSize: 13 }} />
                      <p style={{ fontSize: 11, color: MUTED, margin: '4px 0 0' }}>비워 두면 결과 원문의 cluster가 모두 같을 때만 기존 값을 보존합니다. 서로 다르면 데이터 손실을 막기 위해 이동을 차단합니다.</p>
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {/* 미분류함 */}
            <div style={{ border: `2px solid ${LINE}`, borderRadius: 16, padding: 18, background: PANEL }}>
              <Eyebrow color={AMBER}>미분류함 · {unclassifiedCount}건</Eyebrow>
              <p style={{ fontSize: 12, color: MUTED, margin: '6px 0 10px' }}>어떤 쟁점에도 연결되지 않은 원문입니다. 본문을 확인하고 쟁점으로 끌어오세요(원문 전수 역추적).</p>
              {!itemsLoaded ? (
                <p style={{ fontSize: 13, color: AMBER, lineHeight: 1.6, margin: 0 }}>
                  미분류 <b>{unclassifiedCount}건</b>(카운트만). 원문 본문이 로드되지 않아 끌어오기가 비활성입니다 — 스키마 적용 상태와 운영자 권한을 확인하세요.
                </p>
              ) : !partition || partition.unclassified.length === 0 ? (
                <p style={{ fontSize: 14, color: MUTED, margin: 0 }}>미분류 원문이 없습니다. 모든 원문이 쟁점에 연결되었습니다.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {partition.unclassified.map((it) => (
                    <div key={it.itemId} style={{ border: `2px solid ${LINE}`, borderRadius: 12, padding: '10px 12px', background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, color: MUTED }}>{it.teamName} · {itemKindLabel(it.kind)}</span>
                        <button onClick={() => pullIntoSelected(it.itemId)} disabled={busy || !selected} style={busy || !selected ? { ...btn('disabled'), padding: '5px 10px', fontSize: 12 } : { ...btn('ghost'), padding: '5px 10px', fontSize: 12 }}>
                          {selected ? '이 쟁점으로 ↑' : '쟁점 선택 필요'}
                        </button>
                      </div>
                      <div style={{ fontSize: 14, color: INK, lineHeight: 1.5 }}>{it.content}</div>
                      {it.rationale ? <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>근거: {it.rationale}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div style={{ border: `2px dashed ${TEAL}`, borderRadius: 14, padding: '22px 20px', background: PANEL, color: MUTED, fontSize: 14 }}>
          {busy ? '이 주제의 쟁점 목록을 안전하게 불러오는 중입니다.' : '이 주제의 쟁점 목록을 자동으로 불러옵니다.'}
        </div>
      )}
    </div>
  );
}

export function SourceReferenceList({ items }: { items: ReviewItem[] }) {
  return (
    <nav aria-label="연결 원문 바로가기" style={{ marginTop: 12 }}>
      <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((item) => {
          const reference = sourceReference(item);
          return (
            <li key={item.itemId}>
              <a href={reference.href} style={{ color: TEAL, fontSize: 13, fontWeight: 700, textDecoration: 'underline' }}>
                {reference.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function ReviewSourceCard({ item, checked, onToggle }: { item: ReviewItem; checked: boolean; onToggle: () => void }) {
  const reference = sourceReference(item);
  return (
    <label id={reference.id} tabIndex={-1} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', border: `2px solid ${checked ? TEAL : LINE}`, borderRadius: 12, padding: '10px 12px', background: checked ? '#F1FAFB' : '#fff', cursor: 'pointer' }}>
      <input aria-label={`${reference.label} 선택`} type="checkbox" checked={checked} onChange={onToggle} style={{ marginTop: 3, width: 16, height: 16, accentColor: TEAL }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, color: MUTED, marginBottom: 3 }}>{reference.label}</span>
        <span style={{ display: 'block', fontSize: 14, color: INK, lineHeight: 1.5 }}>{item.content}</span>
        {item.rationale ? <span style={{ display: 'block', fontSize: 12, color: MUTED, marginTop: 4 }}>근거: {item.rationale}</span> : null}
      </span>
    </label>
  );
}
