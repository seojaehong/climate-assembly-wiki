import { useEffect, useState } from 'react';
import { castBallot, fetchRound, fetchVotes, tallyVotes, type Round, type Vote } from '../../lib/mod-console';
import { parseVoteUrl, nextCastState, resolveVoteScreen, type CastState } from './vote-card-logic';

const OPTION_COLORS = ['#23B2C3', '#2E75B6', '#4F9D3A', '#F5A623', '#135C73', '#1F4E79'];

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[12px] font-semibold uppercase ${className}`} style={{ letterSpacing: '.14em' }}>
      {children}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5F8FB] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden shadow-[0_1px_2px_rgba(31,78,121,.04),0_8px_24px_-16px_rgba(31,78,121,.18)]">
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
          {icon}
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
      title="모더레이터 화면의 QR을 스캔해 주세요"
      body="투표 링크가 올바르지 않습니다. 조 화면에 뜬 QR 코드를 다시 스캔해 주세요."
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

function PendingScreen({ title }: { title: string }) {
  return (
    <CenterMessage
      icon="⏳"
      eyebrow="대기 중"
      title="곧 투표가 시작됩니다"
      body={`"${title}" — 모더레이터가 투표를 열 때까지 화면을 유지해 주세요.`}
      color="#2E75B6"
    />
  );
}

function VotedScreen({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <CenterMessage icon="✓" eyebrow="완료" title="투표 완료 ✓" body="참여해 주셔서 감사합니다." color="#4F9D3A">
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
    </CenterMessage>
  );
}

function DuplicateScreen({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <CenterMessage icon="⚠" eyebrow="안내" title="이미 참여하셨습니다" body="이 기기로는 이미 한 번 투표했습니다." color="#F5A623">
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />
    </CenterMessage>
  );
}

function RefreshButton({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      className="mt-7 w-full h-14 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[18px] font-bold disabled:opacity-50"
    >
      {refreshing ? '확인 중…' : '결과 보기'}
    </button>
  );
}

function ActiveScreen({
  round,
  onSubmit,
  submitting,
  error,
}: {
  round: Round;
  onSubmit: (choice: string | string[]) => void;
  submitting: boolean;
  error: string | null;
}) {
  const options = round.options ?? [];
  const isCheckbox = round.type === 'CHECKBOX';
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (opt: string) => {
    if (submitting) return;
    if (!isCheckbox) {
      onSubmit(opt);
      return;
    }
    setSelected((prev) => (prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]));
  };

  return (
    <Shell>
      <div className="px-6 pt-10 pb-8">
        <Eyebrow className="text-[#5A6B73] mb-2">질문</Eyebrow>
        <h1 className="text-[26px] font-extrabold text-[#1F4E79] leading-snug mb-8" style={{ letterSpacing: '-.022em' }}>
          {round.title}
        </h1>

        {error ? (
          <div className="mb-5 flex items-center gap-2 text-[#B91C1C] text-[15px] font-semibold bg-[#FEF2F2] border border-[#DC2626]/30 rounded-xl px-4 py-2.5">
            <span aria-hidden="true">⛔</span>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="space-y-3" role="group" aria-label="보기">
          {options.map((opt, i) => {
            const active = selected.includes(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggle(opt)}
                disabled={submitting}
                aria-pressed={isCheckbox ? active : undefined}
                className={`w-full min-h-[64px] rounded-2xl border-2 px-5 py-4 text-left text-[19px] font-bold flex items-center gap-3 transition disabled:opacity-50 ${
                  active
                    ? 'border-[#23B2C3] bg-[#23B2C3]/8 text-[#135C73]'
                    : 'border-[#DCE7EE] bg-white text-[#1F2933]'
                }`}
              >
                <span
                  className="w-9 h-9 shrink-0 rounded-lg grid place-items-center text-[15px] font-extrabold"
                  style={{ background: OPTION_COLORS[i % OPTION_COLORS.length], color: 'white' }}
                >
                  {i + 1}
                </span>
                <span className="flex-1">{opt}</span>
                {isCheckbox ? (
                  <span
                    className={`w-6 h-6 shrink-0 rounded-md border-2 grid place-items-center ${
                      active ? 'border-[#23B2C3] bg-[#23B2C3] text-white' : 'border-[#C4D8E4] bg-white'
                    }`}
                    aria-hidden="true"
                  >
                    {active ? '✓' : ''}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {isCheckbox ? (
          <button
            type="button"
            onClick={() => onSubmit(selected)}
            disabled={submitting || selected.length === 0}
            className="w-full min-h-[64px] mt-6 rounded-2xl bg-[#23B2C3] text-white text-[20px] font-bold shadow-sm active:scale-[.99] transition disabled:opacity-40"
          >
            {submitting ? '투표하는 중…' : '투표하기'}
          </button>
        ) : null}

        <p className="text-[13px] text-[#5A6B73] text-center mt-6">이름·개인정보는 저장되지 않습니다. 무기명 투표입니다.</p>
      </div>
    </Shell>
  );
}

function ClosedScreen({ round, votes }: { round: Round; votes: Vote[] }) {
  const tally = tallyVotes(round, votes);
  const ranked = (round.options ?? [])
    .map((opt) => ({ opt, count: tally.byOption[opt] ?? 0 }))
    .sort((a, b) => b.count - a.count);

  return (
    <Shell>
      <div className="px-6 pt-8 pb-8">
        <Eyebrow className="text-[#5A6B73] mb-2">투표 마감됨 · 결과</Eyebrow>
        <h1 className="text-[24px] font-extrabold text-[#1F4E79] leading-snug mb-1" style={{ letterSpacing: '-.022em' }}>
          {round.title}
        </h1>
        <p className="text-[#5A6B73] text-[14px] mb-6">총 {tally.total}표</p>

        <div className="space-y-3">
          {ranked.map(({ opt, count }, i) => {
            const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
            return (
              <div key={opt}>
                <div className="flex justify-between items-baseline mb-1.5">
                  <span className="text-[17px] font-bold text-[#1F2933]">
                    {i === 0 ? '🏆 ' : ''}
                    {opt}
                  </span>
                  <span className="text-[16px] font-extrabold text-[#1F4E79] tr-num">
                    {count}표 <span className="text-[#5A6B73] text-[13px] font-semibold">{pct}%</span>
                  </span>
                </div>
                <div className="h-9 rounded-lg bg-[#F1F7FA] overflow-hidden">
                  <div
                    className="h-full rounded-lg transition-all"
                    style={{ width: `${pct}%`, background: OPTION_COLORS[i % OPTION_COLORS.length] }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}

// ============================================================
// Root
// ============================================================

export default function VoteCard() {
  const parsed = typeof window !== 'undefined' ? parseVoteUrl(window.location.search) : null;
  const roundId = parsed?.roundId ?? null;

  const [round, setRound] = useState<Round | null | undefined>(undefined);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [castState, setCastState] = useState<CastState>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!roundId) return;
    try {
      const r = await fetchRound(roundId);
      setRound(r);
    } catch {
      setRound(null);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const screen = resolveVoteScreen({ hasRoundId: !!roundId, round, castState });

  useEffect(() => {
    if (screen !== 'closed' || !roundId) return;
    fetchVotes(roundId)
      .then(setVotes)
      .catch(() => {});
  }, [screen, roundId]);

  const handleSubmit = async (choice: string | string[]) => {
    if (!roundId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await castBallot(roundId, choice);
      setCastState(nextCastState(result));
      // 라운드가 방금 마감됐다면(가드가 차단) 최신 round(status='closed')를 다시 받아와
      // 결과 화면이 정확한 데이터로 뜨도록 한다.
      if (result === 'closed') load();
    } catch {
      setError('투표에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (screen === 'invalid') return <InvalidScreen />;
  if (screen === 'loading') return <LoadingScreen />;
  if (screen === 'pending') return <PendingScreen title={round?.title ?? ''} />;
  if (screen === 'voted') return <VotedScreen onRefresh={handleRefresh} refreshing={refreshing} />;
  if (screen === 'duplicate') return <DuplicateScreen onRefresh={handleRefresh} refreshing={refreshing} />;
  if (screen === 'closed' && round) return <ClosedScreen round={round} votes={votes} />;
  if (screen === 'active' && round) {
    return <ActiveScreen round={round} onSubmit={handleSubmit} submitting={submitting} error={error} />;
  }

  return <LoadingScreen />;
}
