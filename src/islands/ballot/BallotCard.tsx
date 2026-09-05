import { useEffect, useState } from 'react';
import {
  fetchBallot,
  fetchBallotResults,
  submitBallot,
  type Ballot,
  type BallotItem,
  type BallotResults,
} from '../../lib/ballot';
import { getDeviceToken, isDeviceTokenPersistent } from '../../lib/mod-console';
import {
  answeredCount,
  getLocalSubmit,
  isComplete,
  isLocalSubmitStoragePersistent,
  parseBallotUrl,
  recordLocalSubmit,
  refreshNoticeMessage,
  resolveBallotScreen,
  scaleLabels,
  subgroupVoteBadge,
} from './ballot-logic';
import { useModalDialog } from '../mod/use-modal-dialog';

export const BALLOT_EVIDENCE_BOUNDARY =
  '이름·개인정보는 저장하지 않으며, 브라우저 기기 식별값으로 중복을 줄이는 비구속 현장 의견조사입니다. 공식 의사결정이나 참여 인원 산정의 단독 근거로 사용할 수 없습니다.';

export function ballotResponseCountLabel(count: number): string {
  return `기기 응답 ${count}건`;
}

// VoteCard.tsx의 Shell/CenterMessage/Eyebrow 패턴·색상을 그대로 따른다(수정 금지라 로컬 재정의).
const SCALE_BAR_COLORS = ['#23B2C3', '#2E75B6', '#4F9D3A', '#F5A623', '#135C73', '#1F4E79', '#5A6B73'];
const STATUS_ICON_PATHS: Record<string, string> = {
  '✓': 'M5 12.5 10 17l9-10',
  '!': 'M12 5v9m0 4h.01',
  '↻': 'M20 11a8 8 0 1 1-2.34-5.66M20 4v7h-7',
  '📷': 'M4 7h3l2-2h6l2 2h3v12H4zM15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  '⏱': 'M9 3h6m-3 3a7 7 0 1 1-7 7 7 7 0 0 1 7-7m0 3v4l3 2',
  '⏳': 'M7 3h10M7 21h10M8 3c0 4 2 5 4 7-2 2-4 3-4 7m8-14c0 4-2 5-4 7 2 2 4 3 4 7',
};

function Eyebrow({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`font-mono text-[12px] font-semibold uppercase ${className}`}
      style={{ letterSpacing: '.14em', ...style }}
    >
      {children}
    </div>
  );
}

function Shell({ children, align = 'center' }: { children: React.ReactNode; align?: 'center' | 'top' }) {
  const nonPersistentMode = !isDeviceTokenPersistent() || !isLocalSubmitStoragePersistent();
  return (
    <div
      className={`min-h-screen bg-[#F5F8FB] flex justify-center px-4 py-8 ${
        align === 'center' ? 'items-center' : 'items-start'
      }`}
    >
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden shadow-[0_1px_2px_rgba(31,78,121,.04),0_8px_24px_-16px_rgba(31,78,121,.18)]">
        {nonPersistentMode ? (
          <p role="alert" className="border-b-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3 text-center text-[14px] font-bold text-[#6B4B00]">
            브라우저 저장소가 차단되어 이 페이지를 새로고침하면 기기 중복 확인 정보가 유지되지 않습니다.
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function CenterMessage({
  icon,
  eyebrow,
  title,
  body,
  color = '#1F4E79',
  children,
}: {
  icon: string;
  eyebrow: string;
  title: string;
  body?: string;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <Shell>
      <div className="px-7 pt-14 pb-14 flex flex-col items-center text-center">
        <div
          className="w-16 h-16 rounded-2xl grid place-items-center text-white text-3xl mb-5"
          style={{ background: color }}
          aria-hidden="true"
        >
          <svg
            aria-hidden="true"
            className="h-9 w-9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={STATUS_ICON_PATHS[icon] ?? STATUS_ICON_PATHS['!']} />
          </svg>
        </div>
        <Eyebrow className="mb-2" style={{ color } as React.CSSProperties}>
          {eyebrow}
        </Eyebrow>
        <h1 className="text-[26px] font-extrabold text-[#1F4E79] leading-snug mb-2" style={{ letterSpacing: '-.022em' }}>
          {title}
        </h1>
        {body ? <p className="text-[#5A6B73] text-[16px] leading-relaxed">{body}</p> : null}
        {children ? <div className="w-full">{children}</div> : null}
      </div>
    </Shell>
  );
}

function InvalidScreen() {
  return (
    <CenterMessage
      icon="📷"
      eyebrow="안내"
      title="안내된 QR을 다시 스캔해 주세요"
      body="투표 링크가 올바르지 않거나 아직 공개되지 않았습니다. 현장 화면의 QR 코드를 다시 스캔해 주세요."
      color="#5A6B73"
    />
  );
}

function LoadingScreen() {
  return (
    <Shell>
      <div className="px-7 pt-14 pb-14 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#F1F7FA] animate-pulse mb-5" />
        <Eyebrow className="text-[#5A6B73] mb-2">불러오는 중</Eyebrow>
        <p className="text-[#5A6B73] text-[16px]">잠시만 기다려 주세요…</p>
      </div>
    </Shell>
  );
}

export function LoadErrorScreen({
  title,
  body,
  onRetry,
  retrying,
}: {
  title: string;
  body: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <CenterMessage icon="↻" eyebrow="연결 확인" title={title} body={body} color="#7C2D12">
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-6 min-h-[56px] w-full rounded-2xl border-2 border-[#B5651D] bg-white px-4 text-[17px] font-extrabold text-[#7C2D12] disabled:opacity-50"
      >
        {retrying ? '다시 불러오는 중…' : '다시 불러오기'}
      </button>
    </CenterMessage>
  );
}

function RefreshButton({
  onRefresh,
  refreshing,
  refreshNotice,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  refreshNotice: string | null;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="mt-5 w-full h-14 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[17px] font-bold disabled:opacity-50"
      >
        {refreshing ? '공개 여부 확인 중…' : '결과 공개 여부 확인'}
      </button>
      <p className="min-h-6 mt-3 text-[14px] leading-relaxed text-[#5A6B73]" role="status" aria-live="polite">
        {refreshNotice}
      </p>
    </>
  );
}

function DoneScreen({
  duplicate,
  onRefresh,
  refreshing,
  refreshNotice,
}: {
  duplicate: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  refreshNotice: string | null;
}) {
  return (
    <CenterMessage
      icon={duplicate ? '!' : '✓'}
      eyebrow="제출 완료"
      title={duplicate ? '이미 제출하셨습니다' : '의견이 제출되었습니다'}
      body={
        duplicate
          ? '이 기기의 답변은 정상적으로 제출되어 있습니다.'
          : '참여해 주셔서 감사합니다. 결과는 의견조사 마감 후 공개됩니다.'
      }
      color={duplicate ? '#8A4B08' : '#2D6A24'}
    >
      <p className="mt-5 text-[14px] leading-relaxed text-[#5A6B73]">집계는 운영진 확인을 거쳐 공개됩니다.</p>
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />
    </CenterMessage>
  );
}

function ClosedScreen({
  onRefresh,
  refreshing,
  refreshNotice,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  refreshNotice: string | null;
}) {
  return (
    <CenterMessage
      icon="⏱"
      eyebrow="마감"
      title="의견조사가 마감되었습니다"
      body="집계는 운영진 확인을 거쳐 공개됩니다."
      color="#2E75B6"
    >
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />
    </CenterMessage>
  );
}

// ── 투표 화면 ─────────────────────────────────────────────────────────

function ItemBlock({
  item,
  value,
  onSelect,
  disabled,
}: {
  item: BallotItem;
  value: number | undefined;
  onSelect: (v: number) => void;
  disabled: boolean;
}) {
  const labels = scaleLabels(item.scale);
  return (
    <section className="pt-6 first:pt-0" aria-label={`의제 ${item.ordinal}`}>
      <div className="flex items-start gap-3 mb-1.5">
        <span
          className="w-8 h-8 shrink-0 rounded-lg grid place-items-center text-[14px] font-extrabold text-white bg-[#1F4E79]"
          aria-hidden="true"
        >
          {item.ordinal}
        </span>
        <h2 className="text-[19px] font-extrabold text-[#1F2933] leading-snug" style={{ letterSpacing: '-.015em' }}>
          {item.statement}
          {!item.required ? <span className="ml-1.5 text-[13px] font-semibold text-[#5A6B73]">(선택)</span> : null}
        </h2>
      </div>
      {item.description ? (
        <p className="ml-11 mb-3 text-[14px] leading-relaxed text-[#5A6B73]">{item.description}</p>
      ) : (
        <div className="mb-3" />
      )}

      <div className="space-y-2" role="group" aria-label={`의제 ${item.ordinal} 응답`}>
        {labels.map((label, i) => {
          const v = i + 1;
          const active = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onSelect(v)}
              disabled={disabled}
              aria-pressed={active}
              className={`w-full min-h-[56px] rounded-2xl border-2 px-4 py-3 text-left text-[17px] font-bold flex items-center gap-3 transition disabled:opacity-50 ${
                active ? 'border-[#23B2C3] bg-[#23B2C3]/8 text-[#135C73]' : 'border-[#DCE7EE] bg-white text-[#1F2933]'
              }`}
            >
              <span
                className={`w-6 h-6 shrink-0 rounded-full border-2 grid place-items-center ${
                  active ? 'border-[#23B2C3] bg-[#23B2C3]' : 'border-[#C4D8E4] bg-white'
                }`}
                aria-hidden="true"
              >
                {active ? <span className="w-2 h-2 rounded-full bg-white" /> : null}
              </span>
              <span className="flex-1">{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ConfirmDialog({
  answered,
  total,
  onCancel,
  onConfirm,
  submitting,
}: {
  answered: number;
  total: number;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>(true, () => {
    if (!submitting) onCancel();
  });
  return (
    <div className="fixed inset-0 z-50 bg-[#1F2933]/50 flex items-center justify-center px-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ballot-submit-dialog-title"
        tabIndex={-1}
        className="w-full max-w-sm bg-white rounded-3xl px-6 pt-8 pb-6 text-center shadow-xl"
      >
        <h2
          id="ballot-submit-dialog-title"
          className="text-[21px] font-extrabold text-[#1F4E79] mb-2"
          style={{ letterSpacing: '-.02em' }}
        >
          답변을 제출할까요?
        </h2>
        <p className="text-[15px] leading-relaxed text-[#5A6B73] mb-1">
          {answered}/{total} 문항에 응답하셨습니다.
        </p>
        <p className="text-[15px] font-bold text-[#B91C1C] mb-6">제출 후에는 수정할 수 없습니다.</p>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="w-full min-h-[56px] rounded-2xl bg-[#23B2C3] text-white text-[18px] font-bold active:scale-[.99] transition disabled:opacity-40"
        >
          {submitting ? '제출하는 중…' : '제출하기'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          data-dialog-initial-focus
          className="w-full min-h-[56px] mt-2 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[17px] font-bold disabled:opacity-50"
        >
          다시 살펴보기
        </button>
      </div>
    </div>
  );
}

function VotingScreen({
  ballot,
  answers,
  onSelect,
  onRequestSubmit,
  submitting,
  error,
}: {
  ballot: Ballot;
  answers: Record<string, number>;
  onSelect: (itemId: string, v: number) => void;
  onRequestSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const total = ballot.items.length;
  const answered = answeredCount(ballot.items, answers);
  const complete = isComplete(ballot.items, answers);

  return (
    <Shell align="top">
      {/* 진행률 상단 고정 */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-[#DCE7EE] px-6 py-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="flex items-center gap-2">
            <Eyebrow className="text-[#5A6B73]">다의제 현장 의견조사</Eyebrow>
            {subgroupVoteBadge(ballot.subgroup) ? (
              <span className="rounded-full bg-[#135C73] px-2.5 py-0.5 text-[13px] font-bold text-white">
                {subgroupVoteBadge(ballot.subgroup)}
              </span>
            ) : null}
          </span>
          <span className="text-[15px] font-extrabold text-[#1F4E79] tr-num" role="status" aria-live="polite">
            {answered}/{total} 응답
          </span>
        </div>
        <div className="h-2 rounded-full bg-[#F1F7FA] overflow-hidden" aria-hidden="true">
          <div
            className="h-full rounded-full bg-[#23B2C3] transition-all"
            style={{ width: total > 0 ? `${(answered / total) * 100}%` : '0%' }}
          />
        </div>
      </div>

      <div className="px-6 pt-6 pb-8">
        <h1 className="text-[24px] font-extrabold text-[#1F4E79] leading-snug mb-2" style={{ letterSpacing: '-.022em' }}>
          {ballot.title}
        </h1>
        {ballot.instructions ? (
          <p className="text-[15px] leading-relaxed text-[#5A6B73] mb-2">{ballot.instructions}</p>
        ) : null}
        <p className="text-[13px] text-[#5A6B73] mb-4">
          모든 문항에 답한 뒤 맨 아래에서 한 번에 제출합니다.
        </p>

        <div className="divide-y divide-[#DCE7EE]">
          {ballot.items.map((item) => (
            <ItemBlock
              key={item.id}
              item={item}
              value={answers[item.id]}
              onSelect={(v) => onSelect(item.id, v)}
              disabled={submitting}
            />
          ))}
        </div>

        {error ? (
          <div className="mt-6 flex items-center gap-2 text-[#B91C1C] text-[15px] font-semibold bg-[#FEF2F2] border border-[#DC2626]/30 rounded-xl px-4 py-2.5">
            <span aria-hidden="true">⛔</span>
            <span>{error}</span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onRequestSubmit}
          disabled={submitting || !complete}
          className="w-full min-h-[64px] mt-6 rounded-2xl bg-[#23B2C3] text-white text-[20px] font-bold shadow-sm active:scale-[.99] transition disabled:opacity-40"
        >
          {complete ? '제출하기' : `남은 문항 ${total - answered}개에 답해 주세요`}
        </button>

        <p className="text-[13px] leading-relaxed text-[#5A6B73] text-center mt-6">{BALLOT_EVIDENCE_BOUNDARY}</p>
      </div>
    </Shell>
  );
}

// ── 결과 화면 ─────────────────────────────────────────────────────────

function ResultsScreen({ results }: { results: BallotResults | null }) {
  if (!results) return <LoadingScreen />;

  return (
    <Shell align="top">
      <div className="px-6 pt-8 pb-8">
        <div className="flex items-center gap-2 mb-2">
          <Eyebrow className="text-[#5A6B73]">의견조사 마감됨 · 결과</Eyebrow>
          {subgroupVoteBadge(results.subgroup) ? (
            <span className="rounded-full bg-[#135C73] px-2.5 py-0.5 text-[13px] font-bold text-white">
              {subgroupVoteBadge(results.subgroup)}
            </span>
          ) : null}
        </div>
        <h1 className="text-[24px] font-extrabold text-[#1F4E79] leading-snug mb-1" style={{ letterSpacing: '-.022em' }}>
          {results.title}
        </h1>
        <p className="text-[#5A6B73] text-[14px] mb-2">{ballotResponseCountLabel(results.responses)}</p>
        <p className="text-[#5A6B73] text-[13px] leading-relaxed mb-6">{BALLOT_EVIDENCE_BOUNDARY}</p>

        <div className="space-y-8">
          {results.items.map((item) => {
            const labels = scaleLabels(item.scale);
            const max = Math.max(1, ...Object.values(item.dist));
            return (
              <section key={item.id} aria-label={`의제 ${item.ordinal} 결과`}>
                <div className="flex items-start gap-2.5 mb-1">
                  <span
                    className="w-7 h-7 shrink-0 rounded-lg grid place-items-center text-[13px] font-extrabold text-white bg-[#1F4E79]"
                    aria-hidden="true"
                  >
                    {item.ordinal}
                  </span>
                  <h2 className="text-[17px] font-extrabold text-[#1F2933] leading-snug">{item.statement}</h2>
                </div>
                <p className="ml-9 text-[13px] text-[#5A6B73] mb-3 tr-num">
                  {ballotResponseCountLabel(item.n)}{item.avg != null ? ` · 평균 ${item.avg.toFixed(2)} / ${item.scale}` : ''}
                </p>

                <div className="space-y-2">
                  {labels.map((label, i) => {
                    const v = i + 1;
                    const count = item.dist[String(v)] ?? 0;
                    const pct = item.n > 0 ? Math.round((count / item.n) * 100) : 0;
                    return (
                      <div key={v}>
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-[14px] font-bold text-[#1F2933]">{label}</span>
                          <span className="text-[14px] font-extrabold text-[#1F4E79] tr-num">
                            {count}건 <span className="text-[#5A6B73] text-[12px] font-semibold">{pct}%</span>
                          </span>
                        </div>
                        <div className="h-6 rounded-md bg-[#F1F7FA] overflow-hidden">
                          <div
                            className="h-full rounded-md transition-all"
                            style={{
                              width: `${(count / max) * 100}%`,
                              background: SCALE_BAR_COLORS[i % SCALE_BAR_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <p className="text-[13px] text-[#5A6B73] text-center mt-8 pt-5 border-t border-[#DCE7EE]">
          집계는 운영진 확인을 거쳐 공개됩니다.
        </p>
      </div>
    </Shell>
  );
}

// ============================================================
// Root
// ============================================================

export default function BallotCard() {
  const parsed = typeof window !== 'undefined' ? parseBallotUrl(window.location.search) : null;
  const token = parsed?.token ?? null;

  const [ballot, setBallot] = useState<Ballot | null | undefined>(undefined);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitState, setSubmitState] = useState<'idle' | 'submitted' | 'duplicate'>('idle');
  const [locallySubmitted, setLocallySubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BallotResults | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [ballotLoadError, setBallotLoadError] = useState<string | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultReloadKey, setResultReloadKey] = useState(0);

  const load = async ({ preserveCurrent = false }: { preserveCurrent?: boolean } = {}): Promise<Ballot | null> => {
    if (!token) return null;
    try {
      const b = await fetchBallot(token);
      setBallot(b);
      setBallotLoadError(null);
      if (b && getLocalSubmit(b.id)) setLocallySubmitted(true);
      return b;
    } catch (loadError) {
      console.error('투표를 불러오지 못했습니다.', loadError);
      setBallotLoadError('투표 정보를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
      if (!preserveCurrent) setBallot(undefined);
      return null;
    }
  };

  useEffect(() => {
    setBallot(undefined);
    setBallotLoadError(null);
    setResults(null);
    setResultError(null);
    setResultLoading(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const screen = resolveBallotScreen({
    hasToken: !!token,
    ballot,
    submitted: locallySubmitted || submitState !== 'idle',
  });

  // published가 되면 결과를 가져온다(p_code 없이 — published일 때만 non-null).
  useEffect(() => {
    if (screen !== 'published' || !token) return;
    let cancelled = false;
    setResultLoading(true);
    setResultError(null);
    fetchBallotResults(token)
      .then((nextResults) => {
        if (!nextResults) throw new Error('Published ballot returned no public results.');
        if (!cancelled) setResults(nextResults);
      })
      .catch((loadError: unknown) => {
        console.error('공개된 투표 결과를 불러오지 못했습니다.', loadError);
        if (!cancelled) {
          setResultError('공개 결과를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
        }
      })
      .finally(() => {
        if (!cancelled) setResultLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [screen, token, resultReloadKey]);

  const handleSelect = (itemId: string, v: number) => {
    setAnswers((prev) => ({ ...prev, [itemId]: v }));
  };

  const handleSubmit = async () => {
    if (!token || !ballot) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitBallot(token, getDeviceToken(), answers);
      setConfirmOpen(false);
      if (result === 'ok') {
        recordLocalSubmit(ballot.id);
        setSubmitState('submitted');
      } else if (result === 'duplicate') {
        // 이 디바이스의 제출이 이미 존재 — 로컬 기록을 보정하고 완료 화면으로.
        recordLocalSubmit(ballot.id);
        setSubmitState('duplicate');
      } else {
        // 제출 시점에 이미 마감됨 — 최신 상태(closed/published)를 다시 받아 화면 전환.
        void load({ preserveCurrent: true });
      }
    } catch (submitError: unknown) {
      console.error('투표 제출에 실패했습니다.', submitError);
      setConfirmOpen(false);
      setError('제출에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const refreshed = await load({ preserveCurrent: true });
      setRefreshNotice(
        refreshed
          ? refreshNoticeMessage(refreshed) ??
              (refreshed.status === 'closed' ? '아직 결과가 공개되지 않았습니다. 운영진 확인 후 공개됩니다.' : null)
          : '확인하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleBallotRetry = async () => {
    setRefreshing(true);
    setBallot(undefined);
    setBallotLoadError(null);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (token && ballotLoadError && ballot === undefined) {
    return (
      <LoadErrorScreen
        title="투표 화면에 연결하지 못했습니다"
        body={ballotLoadError}
        onRetry={() => void handleBallotRetry()}
        retrying={refreshing}
      />
    );
  }
  if (screen === 'invalid') return <InvalidScreen />;
  if (screen === 'loading') return <LoadingScreen />;
  if (screen === 'published') {
    if (resultError) {
      return (
        <LoadErrorScreen
          title="공개 결과에 연결하지 못했습니다"
          body={resultError}
          onRetry={() => setResultReloadKey((current) => current + 1)}
          retrying={resultLoading}
        />
      );
    }
    if (resultLoading || !results) return <LoadingScreen />;
    return <ResultsScreen results={results} />;
  }
  if (screen === 'closed') {
    return <ClosedScreen onRefresh={handleRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />;
  }
  if (screen === 'done') {
    return (
      <DoneScreen
        duplicate={submitState === 'duplicate'}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshNotice={refreshNotice}
      />
    );
  }
  if (screen === 'active' && ballot) {
    return (
      <>
        <VotingScreen
          ballot={ballot}
          answers={answers}
          onSelect={handleSelect}
          onRequestSubmit={() => setConfirmOpen(true)}
          submitting={submitting}
          error={error}
        />
        {confirmOpen ? (
          <ConfirmDialog
            answered={answeredCount(ballot.items, answers)}
            total={ballot.items.length}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={handleSubmit}
            submitting={submitting}
          />
        ) : null}
      </>
    );
  }

  return <LoadingScreen />;
}
