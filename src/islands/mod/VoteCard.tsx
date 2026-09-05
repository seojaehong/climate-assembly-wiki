import { useCallback, useEffect, useRef, useState } from 'react';
import {
  castBallot,
  fetchPublicTally,
  fetchRound,
  isDeviceTokenPersistent,
  type Round,
  type Tally,
} from '../../lib/mod-console';
import {
  normalizeTextVoteChoice,
  parseVoteUrl,
  nextCastState,
  refreshStatusMessage,
  resolveLatestRoundSnapshot,
  resolveVoteScreen,
  TEXT_VOTE_MAX_LENGTH,
  type CastState,
} from './vote-card-logic';
import {
  createResourceRequestCoordinator,
  type ResourceRequestPriority,
} from './resource-request-coordinator';

// Every numbered chip uses white text, so each background must independently
// meet the WCAG AA 4.5:1 contrast threshold for its 15px label.
const OPTION_COLORS = ['#0A6670', '#2E75B6', '#2D6A24', '#8A4B08', '#135C73', '#1F4E79'];
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

function Shell({ children }: { children: React.ReactNode }) {
  const nonPersistentMode = !isDeviceTokenPersistent();
  return (
    <div className="min-h-screen bg-[#F5F8FB] flex items-center justify-center px-4 py-8">
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

function PendingScreen({
  title,
  onRefresh,
  refreshing,
  refreshNotice,
}: {
  title: string;
  onRefresh: () => void;
  refreshing: boolean;
  refreshNotice: string | null;
}) {
  return (
    <CenterMessage
      icon="⏳"
      eyebrow="대기 중"
      title="곧 투표가 시작됩니다"
      body={`"${title}" — 모더레이터가 투표를 열 때까지 화면을 유지해 주세요.`}
      color="#2E75B6"
    >
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="mt-6 w-full h-14 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[17px] font-bold disabled:opacity-50"
      >
        {refreshing ? '투표 시작 여부 확인 중…' : '투표 시작 여부 확인'}
      </button>
      <p className="min-h-6 mt-3 text-[14px] leading-relaxed text-[#5A6B73]" role="status" aria-live="polite">
        {refreshNotice ?? '5초마다 자동으로 시작 여부를 확인합니다.'}
      </p>
    </CenterMessage>
  );
}

function RoundLoadErrorScreen({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <CenterMessage
      icon="!"
      eyebrow="연결 오류"
      title="투표 정보를 불러오지 못했습니다"
      body="링크가 틀린 것으로 확정하지 않았습니다. 네트워크를 확인한 뒤 다시 시도해 주세요."
      color="#B42318"
    >
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-6 w-full h-14 rounded-2xl bg-[#1F4E79] text-white text-[17px] font-bold disabled:opacity-50"
      >
        {retrying ? '다시 불러오는 중…' : '다시 불러오기'}
      </button>
    </CenterMessage>
  );
}

function ResultPendingPanel() {
  return (
    <div className="mt-6 rounded-2xl border border-[#C4D8E4] bg-[#F1F7FA] px-4 py-4 text-left">
      <div className="flex items-center gap-3 text-[#1F4E79] font-bold">
        <span className="w-7 h-7 rounded-full bg-[#2D6A24] text-white grid place-items-center text-[14px]" aria-hidden="true">
          1
        </span>
        <span>투표 제출 완료</span>
      </div>
      <div className="ml-3.5 h-4 border-l-2 border-dashed border-[#9BBBCB]" aria-hidden="true" />
      <div className="flex items-center gap-3 text-[#1F4E79] font-bold">
        <span className="w-7 h-7 rounded-full border-2 border-[#2E75B6] bg-white text-[#2E75B6] grid place-items-center text-[14px]" aria-hidden="true">
          2
        </span>
        <span>투표 마감 후 결과 공개</span>
      </div>
      <p className="mt-3 text-[14px] leading-relaxed text-[#5A6B73]">
        모더레이터가 투표를 마감하면 결과를 확인할 수 있습니다.
      </p>
    </div>
  );
}

export function VotedScreen({
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
      icon="✓"
      eyebrow="제출 완료"
      title="투표가 제출되었습니다"
      body="결과는 투표가 마감된 뒤 공개됩니다."
      color="#2D6A24"
    >
      <ResultPendingPanel />
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />
    </CenterMessage>
  );
}

function DuplicateScreen({
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
      icon="!"
      eyebrow="제출 완료"
      title="이미 참여하셨습니다"
      body="이 기기의 투표는 정상적으로 제출되어 있습니다."
      color="#8A4B08"
    >
      <ResultPendingPanel />
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />
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
        {refreshing ? '마감 여부 확인 중…' : '투표 마감 여부 확인'}
      </button>
      <p
        className="min-h-6 mt-3 text-[14px] leading-relaxed text-[#5A6B73]"
        role="status"
        aria-live="polite"
      >
        {refreshNotice}
      </p>
    </>
  );
}

export function ActiveScreen({
  round,
  onSubmit,
  submitting,
  error,
}: {
  round: Round;
  onSubmit: (choice: unknown) => void;
  submitting: boolean;
  error: string | null;
}) {
  const options = round.options ?? [];
  const isCheckbox = round.type === 'CHECKBOX';
  const isScaleMulti = round.type === 'SCALE_MULTI';
  const isText = round.type === 'TEXT';
  const [selected, setSelected] = useState<string[]>([]);
  const [scaleValues, setScaleValues] = useState<Record<string, number>>({});
  const [textValue, setTextValue] = useState('');
  const scaleLow = round.scale_low ?? 1;
  const scaleHigh = round.scale_high ?? 5;
  const normalizedTextValue = normalizeTextVoteChoice(textValue);
  const textInputId = `participant-text-choice-${round.id}`;

  const submitExplicitChoice = () => {
    if (isText) {
      if (normalizedTextValue !== null) onSubmit(normalizedTextValue);
      return;
    }
    onSubmit(isScaleMulti ? scaleValues : selected);
  };

  const explicitChoiceDisabled = isText
    ? normalizedTextValue === null
    : isScaleMulti
      ? options.some((option) => scaleValues[option] == null)
      : selected.length === 0;

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
        {round.description ? <p className="-mt-5 mb-7 text-[15px] leading-relaxed text-[#5A6B73]">{round.description}</p> : null}

        {error ? (
          <div
            className="mb-5 flex items-center gap-2 text-[#B91C1C] text-[15px] font-semibold bg-[#FEF2F2] border border-[#DC2626]/30 rounded-xl px-4 py-2.5"
            role="alert"
            aria-live="assertive"
          >
            <span aria-hidden="true">⛔</span>
            <span>{error}</span>
          </div>
        ) : null}

        {isText ? (
          <div className="rounded-2xl border-2 border-[#DCE7EE] bg-white p-4">
            <label
              htmlFor={textInputId}
              className="block text-[17px] font-bold leading-snug text-[#1F2933]"
            >
              의견을 입력해 주세요
            </label>
            <textarea
              id={textInputId}
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              disabled={submitting}
              required
              rows={7}
              maxLength={TEXT_VOTE_MAX_LENGTH}
              aria-describedby={`${textInputId}-help ${textInputId}-count`}
              className="mt-3 w-full resize-y rounded-xl border-2 border-[#9BBBCB] bg-[#F8FBFD] px-4 py-3 text-[17px] leading-relaxed text-[#1F2933] outline-none transition focus:border-[#1F4E79] focus:ring-4 focus:ring-[#2E75B6]/20 disabled:opacity-50"
            />
            <div className="mt-2 flex items-start justify-between gap-4 text-[13px] leading-relaxed text-[#5A6B73]">
              <p id={`${textInputId}-help`}>공백만 입력한 의견은 제출할 수 없습니다.</p>
              <p id={`${textInputId}-count`} className="shrink-0 font-semibold" aria-live="polite">
                {textValue.length.toLocaleString('ko-KR')} / {TEXT_VOTE_MAX_LENGTH.toLocaleString('ko-KR')}자
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3" role="group" aria-label="보기">
            {options.map((opt, i) => {
            if (isScaleMulti) {
              return (
                <fieldset key={opt} className="rounded-2xl border-2 border-[#DCE7EE] bg-white p-4">
                  <legend className="px-1 text-[17px] font-bold leading-snug text-[#1F2933]">{opt}</legend>
                  <div className="mt-3 grid grid-cols-5 gap-2" aria-label={`${opt} 점수`}>
                    {Array.from({ length: scaleHigh - scaleLow + 1 }, (_, index) => scaleLow + index).map((score) => {
                      const active = scaleValues[opt] === score;
                      return (
                        <button
                          key={score}
                          type="button"
                          onClick={() => setScaleValues((values) => ({ ...values, [opt]: score }))}
                          disabled={submitting}
                          aria-pressed={active}
                          aria-label={`${opt} ${score}점`}
                          className={`min-h-12 rounded-xl border-2 text-[17px] font-extrabold transition disabled:opacity-50 ${
                            active
                              ? 'border-[#23B2C3] bg-[#23B2C3] text-white'
                              : 'border-[#C4D8E4] bg-[#F8FBFD] text-[#1F4E79]'
                          }`}
                        >
                          {score}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex justify-between text-[12px] font-semibold text-[#5A6B73]">
                    <span>{round.scale_low_label ?? '낮음'}</span>
                    <span>{round.scale_high_label ?? '높음'}</span>
                  </div>
                </fieldset>
              );
            }
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
        )}

        {isText || isCheckbox || isScaleMulti ? (
          <button
            type="button"
            onClick={submitExplicitChoice}
            disabled={submitting || explicitChoiceDisabled}
            className="w-full min-h-[64px] mt-6 rounded-2xl bg-[#23B2C3] text-white text-[20px] font-bold shadow-sm active:scale-[.99] transition disabled:opacity-40"
          >
            {submitting
              ? (isText ? '의견 제출 중…' : '투표하는 중…')
              : (isText ? '의견 제출하기' : '투표하기')}
          </button>
        ) : null}

        <p className="text-[13px] text-[#5A6B73] text-center mt-6">
          이름·개인정보는 저장되지 않습니다. 기기 기준으로 중복을 제한하는 비구속 현장 조사이며,
          공식 의사결정의 단독 근거로 사용할 수 없습니다. 조 모더레이터의 대리 기록과는 별개입니다.
        </p>
      </div>
    </Shell>
  );
}

export function ClosedScreen({
  round,
  tally,
  resultError,
  resultLoading,
  onRetry,
  lastSuccessAt,
}: {
  round: Round;
  tally: Tally | null;
  resultError: string | null;
  resultLoading: boolean;
  onRetry: () => void;
  lastSuccessAt: number | null;
}) {
  const isScaleMulti = round.type === 'SCALE_MULTI';
  const isText = round.type === 'TEXT';
  const scaleLow = round.scale_low ?? 1;
  const scaleHigh = round.scale_high ?? 5;
  const ranked = (isText ? [] : round.options ?? [])
    .map((opt) => ({
      opt,
      count: tally?.byOption[opt] ?? 0,
      average: tally?.averageByOption[opt],
    }))
    .sort((a, b) => isScaleMulti
      ? (b.average ?? Number.NEGATIVE_INFINITY) - (a.average ?? Number.NEGATIVE_INFINITY)
      : b.count - a.count);
  const leadingValue = ranked.length === 0
    ? null
    : (isScaleMulti ? ranked[0].average ?? null : ranked[0].count);

  return (
    <Shell>
      <div className="px-6 pt-8 pb-8">
        <Eyebrow className="text-[#5A6B73] mb-2">투표 마감됨 · 결과</Eyebrow>
        <h1 className="text-[24px] font-extrabold text-[#1F4E79] leading-snug mb-1" style={{ letterSpacing: '-.022em' }}>
          {round.title}
        </h1>
        <p className="text-[#5A6B73] text-[14px] mb-6">
          {tally == null
            ? '집계 확인 중…'
            : isText
              ? `기기 응답 ${tally.total}건`
              : isScaleMulti
                ? `응답 ${tally.total}명`
                : `총 ${tally.total}표`}
        </p>

        {resultLoading && tally == null ? (
          <p className="mb-5 rounded-2xl border border-[#C4D8E4] bg-[#F1F7FA] p-4 text-[14px] font-semibold text-[#1F4E79]" role="status">
            마감 집계를 불러오는 중입니다…
          </p>
        ) : null}

        {resultError ? (
          <div className="mb-5 rounded-2xl border border-[#F2B8B5] bg-[#FFF4F3] p-4" role="alert">
            <p className="text-[14px] font-semibold leading-relaxed text-[#9A2C25]">
              {resultError}
              {tally && lastSuccessAt
                ? ` 화면에는 ${new Date(lastSuccessAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}에 확인한 마지막 집계가 표시됩니다.`
                : ''}
            </p>
            <button
              type="button"
              onClick={onRetry}
              disabled={resultLoading}
              className="mt-3 min-h-11 rounded-xl bg-[#1F4E79] px-4 py-2 text-[14px] font-bold text-white disabled:opacity-50"
            >
              {resultLoading ? '결과 다시 불러오는 중…' : '결과 다시 불러오기'}
            </button>
          </div>
        ) : null}

        {tally && isText ? (
          <p className="rounded-2xl border border-[#C4D8E4] bg-[#F1F7FA] p-4 text-[14px] font-semibold leading-relaxed text-[#1F4E79]">
            자유서술 원문은 공개 결과 화면에 표시하지 않습니다. 응답 건수만 공개합니다.
          </p>
        ) : tally ? <div className="space-y-3">
          {ranked.map(({ opt, count, average }, i) => {
            const pct = isScaleMulti
              ? (average == null ? 0 : Math.round(((average - scaleLow) / Math.max(scaleHigh - scaleLow, 1)) * 100))
              : (tally.total > 0 ? Math.round((count / tally.total) * 100) : 0);
            return (
              <div key={opt}>
                <div className="flex justify-between items-baseline mb-1.5">
                  <span className="text-[17px] font-bold text-[#1F2933]">
                    {leadingValue != null && leadingValue > 0
                      && (isScaleMulti ? average === leadingValue : count === leadingValue) ? '🏆 ' : ''}
                    {opt}
                  </span>
                  <span className="text-[16px] font-extrabold text-[#1F4E79] tr-num">
                    {isScaleMulti
                      ? (average == null ? '응답 없음' : `${average.toFixed(2)}점`)
                      : <>{count}표 <span className="text-[#5A6B73] text-[13px] font-semibold">{pct}%</span></>}
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
        </div> : null}
        <p className="mt-6 text-center text-[13px] font-semibold leading-relaxed text-[#7C2D12]">
          기기 기준 중복 제한을 적용한 비구속 현장 조사 결과입니다. 공식 의사결정의 단독 근거로
          사용하지 마세요. 조 모더레이터의 대리 기록과는 별개입니다.
        </p>
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
  const [tally, setTally] = useState<Tally | null>(null);
  const [castState, setCastState] = useState<CastState>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultReloadKey, setResultReloadKey] = useState(0);
  const [resultLastSuccessAt, setResultLastSuccessAt] = useState<number | null>(null);
  const [roundLoadError, setRoundLoadError] = useState<string | null>(null);
  const roundLoadCoordinator = useRef(createResourceRequestCoordinator());
  const roundSnapshot = useRef<Round | null | undefined>(undefined);

  const load = useCallback(async (
    {
      preserveCurrent = false,
      priority = 'manual',
    }: { preserveCurrent?: boolean; priority?: ResourceRequestPriority } = {},
  ): Promise<Round | null | undefined> => {
    if (!roundId) return null;
    const coordinator = roundLoadCoordinator.current;
    const ticket = coordinator.begin(`round:${roundId}`, priority);
    if (!ticket) return undefined;
    try {
      const r = await fetchRound(roundId);
      if (!coordinator.isCurrent(ticket)) return undefined;
      if (r === null) {
        roundSnapshot.current = null;
        setRound(null);
        setRoundLoadError(null);
        return null;
      }
      const resolution = resolveLatestRoundSnapshot(
        roundSnapshot.current,
        r,
        ticket.sequence,
        coordinator.currentSequence(),
      );
      if (!resolution.applied) return undefined;
      roundSnapshot.current = resolution.round;
      setRound(resolution.round);
      setRoundLoadError(null);
      return resolution.round;
    } catch (loadError) {
      if (!coordinator.isCurrent(ticket)) return undefined;
      console.error('투표 상태를 불러오지 못했습니다.', loadError);
      setRoundLoadError('투표 정보를 불러오지 못했습니다.');
      if (!preserveCurrent) {
        roundSnapshot.current = null;
        setRound(null);
      }
      return null;
    } finally {
      coordinator.finish(ticket);
    }
  }, [roundId]);

  useEffect(() => {
    const coordinator = roundLoadCoordinator.current;
    coordinator.invalidate();
    roundSnapshot.current = undefined;
    setRound(undefined);
    setRoundLoadError(null);
    setTally(null);
    setResultLastSuccessAt(null);
    void load({ priority: 'background' });
    return () => coordinator.invalidate();
  }, [load]);

  const screen = resolveVoteScreen({ hasRoundId: !!roundId, round, castState });

  useEffect(() => {
    if (screen !== 'pending') return undefined;
    const timer = window.setInterval(() => {
      void load({ preserveCurrent: true, priority: 'background' });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [load, screen]);

  useEffect(() => {
    if (screen !== 'closed' || !roundId) return;
    let cancelled = false;
    setResultLoading(true);
    setResultError(null);
    fetchPublicTally(roundId)
      .then((nextTally) => {
        if (!cancelled) {
          setTally(nextTally);
          setResultLastSuccessAt(Date.now());
        }
      })
      .catch((loadError: unknown) => {
        console.error('투표 결과를 불러오지 못했습니다.', loadError);
        if (!cancelled) setResultError('결과를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
      })
      .finally(() => {
        if (!cancelled) setResultLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [screen, roundId, resultReloadKey]);

  const handleSubmit = async (choice: unknown) => {
    if (!roundId) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await castBallot(roundId, choice);
      setCastState(nextCastState(result));
      // 라운드가 방금 마감됐다면(가드가 차단) 최신 round(status='closed')를 다시 받아와
      // 결과 화면이 정확한 데이터로 뜨도록 한다.
      if (result === 'closed') void load({ preserveCurrent: true, priority: 'manual' });
    } catch (submitError: unknown) {
      console.error('투표 제출에 실패했습니다.', submitError);
      setError('투표에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const refreshedRound = await load({ preserveCurrent: true, priority: 'manual' });
      if (refreshedRound === undefined) return;
      setRefreshNotice(
        refreshedRound
          ? refreshStatusMessage(refreshedRound)
          : '마감 여부를 확인하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleRoundRetry = async () => {
    setRefreshing(true);
    roundSnapshot.current = undefined;
    setRound(undefined);
    setRoundLoadError(null);
    try {
      await load({ priority: 'manual' });
    } finally {
      setRefreshing(false);
    }
  };

  if (roundId && round === null && roundLoadError) {
    return <RoundLoadErrorScreen onRetry={() => void handleRoundRetry()} retrying={refreshing} />;
  }
  if (screen === 'invalid') return <InvalidScreen />;
  if (screen === 'loading') return <LoadingScreen />;
  if (screen === 'pending') {
    return (
      <PendingScreen
        title={round?.title ?? ''}
        onRefresh={() => void handleRefresh()}
        refreshing={refreshing}
        refreshNotice={roundLoadError ?? refreshNotice}
      />
    );
  }
  if (screen === 'voted') {
    return <VotedScreen onRefresh={handleRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />;
  }
  if (screen === 'duplicate') {
    return <DuplicateScreen onRefresh={handleRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />;
  }
  if (screen === 'closed' && round) {
    return (
      <ClosedScreen
        round={round}
        tally={tally}
        resultError={resultError}
        resultLoading={resultLoading}
        onRetry={() => setResultReloadKey((key) => key + 1)}
        lastSuccessAt={resultLastSuccessAt}
      />
    );
  }
  if (screen === 'active' && round) {
    return <ActiveScreen round={round} onSubmit={handleSubmit} submitting={submitting} error={error} />;
  }

  return <LoadingScreen />;
}
