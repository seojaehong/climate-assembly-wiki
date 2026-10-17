import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CEREMONY_START,
  advanceCeremony,
  attendanceCheck,
  attendanceText,
  barRatio,
  ceremonyReveal,
  ceremonyVerdict,
  divisionLabel,
  rewindCeremony,
  summarizeCeremony,
  thresholdRatio,
  type CeremonyItem,
  type CeremonyStep,
} from './division-vote-logic';
import { ceremonyCounter, summaryLayout } from './ceremony-layout';

/**
 * 10/17 분과 의결 세리머니 — 대형 화면(200명) 풀스크린.
 *
 * 판단은 전부 division-vote-logic.ts 에 있다. 여기서는 단계별로 보이는 것을 그리기만 한다.
 * 크기: 본문 24px+ · 안 제목 40px+(긴 합친 문구는 길이에 따라 줄인다 — 300자도 1920×1080 에서 약 41px) · 숫자 80px+ · hover 의존 없음.
 * 안 제목은 자르지 않는다 — 합친 문구(안 번호 포함 300자까지)를 전부 보인다.
 * 「다음」 한 번 = 안 제목 공개, 다시 한 번 = 막대 → 기준선 → 도장(자동 진행, 누르면 바로 도장).
 * 리모컨 넘김키(PageDown/PageUp)와 화살표도 받는다.
 */

const BAR_MS = 1400;
const LINE_MS = 900;

const C = {
  bg: '#0B2233',
  panel: '#12324A',
  text: '#FFFFFF',
  sub: '#C9D8E3',
  gold: '#FFD25A',
  yes: '#35C27A',
  track: '#284A63',
  // 10/14 moderator-3 — 가결은 초록(운영 화면 배지·권고 수준 표와 같은 뜻). 빨강은 부결·경고에만.
  pass: '#35C27A',
  fail: '#9FB3C2',
  warn: '#FFB4B4',
};

/**
 * 안 제목 글자 크기 — 길수록 줄인다(분과 의결 QR 화면 headlineSize 와 같은 방식).
 * 아래 막대·도장 줄(약 360px)이 늘 자리를 잡고 있으므로, 300자(안 번호 포함)도 1920×1080 에서
 * 그 위 남은 높이 안에 잘리지 않고 들어가는 크기로 잡았다. vh 항은 낮은 화면에서 넘치지 않게 한다.
 */
function titleSize(text: string): string {
  const n = [...text].length;
  if (n <= 40) return 'text-[clamp(40px,3.6vw,72px)]';
  if (n <= 120) return 'text-[clamp(32px,min(3vw,5.4vh),58px)]';
  return 'text-[clamp(24px,min(2.3vw,3.8vh),42px)]';
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

async function fireConfetti(): Promise<void> {
  if (prefersReducedMotion()) return;
  try {
    const { default: confetti } = await import('canvas-confetti');
    const base = { particleCount: 140, spread: 80, startVelocity: 55, zIndex: 60 };
    confetti({ ...base, origin: { x: 0.2, y: 0.7 }, angle: 60 });
    confetti({ ...base, origin: { x: 0.8, y: 0.7 }, angle: 120 });
    setTimeout(() => confetti({ ...base, particleCount: 200, spread: 120, origin: { x: 0.5, y: 0.4 } }), 350);
  } catch (error) {
    console.warn('[ceremony] confetti unavailable', error);
  }
}

export default function DivisionCeremony({
  division,
  enrolled,
  present,
  items,
  motionCount,
  sourceLabel,
  onExit,
  controlledStep,
  onStepChange,
  displayOnly = false,
}: {
  division: number;
  enrolled: number;
  present: number;
  items: CeremonyItem[];
  /** 분과 안 수(제외 안 빼고). 공개할 안 수와 다르면 「상정 N건(분과 안 M건 중)」으로 밝힌다(10/14 moderator-5). */
  motionCount?: number;
  /** 「연습 모드」·「실제 투표 결과」 — 화면 구석에 작게 남겨 캡처해도 출처가 보이게 한다. */
  sourceLabel: string;
  onExit: () => void;
  /** 발표 창 — 노트북이 보낸 단계를 그대로 그린다(스스로 넘기지 않는다). */
  controlledStep?: CeremonyStep;
  /** 노트북 — 단계가 바뀔 때마다 알린다(발표 창으로 보낸다). */
  onStepChange?: (step: CeremonyStep) => void;
  /** 발표 창 — 단추·키보드 없이 보이기만. */
  displayOnly?: boolean;
}) {
  const [ownStep, setStep] = useState<CeremonyStep>(CEREMONY_START);
  const step = controlledStep ?? ownStep;
  // 알림 함수는 매번 새로 와도 단계가 바뀔 때만 부른다(새 함수마다 부르면 부모 다시 그리기와 맞물려 끝없이 돈다).
  const onStepChangeRef = useRef(onStepChange);
  onStepChangeRef.current = onStepChange;
  useEffect(() => {
    if (!controlledStep) onStepChangeRef.current?.(ownStep);
  }, [ownStep, controlledStep]);
  const total = items.length;
  // 10/17 — 「상정 N건」은 정책 권고안만(문구 작성 위임 의결은 따로 센다).
  const policy = useMemo(() => items.filter((i) => i.kind !== 'delegation'), [items]);
  const delegations = useMemo(() => items.filter((i) => i.kind === 'delegation'), [items]);
  const policyTotal = policy.length;
  const totalText = motionCount !== undefined && motionCount !== policyTotal ? `상정 ${policyTotal}건(분과 안 ${motionCount}건 중)` : `상정 ${policyTotal}건`;
  const att = attendanceCheck(enrolled, present);
  const established = att.kind === 'ok' && att.established;
  const label = divisionLabel(division);

  const next = useCallback(() => {
    setStep((current) => {
      if (current.phase === 'intro' && !established) return current;
      // 막대·기준선 애니메이션 도중이면 바로 도장으로 건너뛴다.
      if (current.phase === 'bar' || current.phase === 'line') return { phase: 'verdict', index: current.index };
      return advanceCeremony(current, total);
    });
  }, [established, total]);
  const back = useCallback(() => setStep((current) => rewindCeremony(current, total)), [total]);

  // 막대 → 기준선 → 도장 자동 진행
  useEffect(() => {
    if (controlledStep) return undefined;
    if (step.phase !== 'bar' && step.phase !== 'line') return undefined;
    const t = setTimeout(() => setStep((current) => advanceCeremony(current, total)), step.phase === 'bar' ? BAR_MS : LINE_MS);
    return () => clearTimeout(t);
  }, [step, total, controlledStep]);

  useEffect(() => {
    if (displayOnly) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, next, onExit, displayOnly]);

  const current = step.phase === 'intro' || step.phase === 'summary' ? null : items[step.index] ?? null;
  const verdict = current ? ceremonyVerdict(current, enrolled, present) : null;
  // 저장된 결과는 안마다 그 투표의 재적·참석을 들고 온다(마감 때 값).
  const itemEnrolled = current?.enrolled ?? enrolled;
  const itemPresent = current?.present ?? present;

  // 가결 도장이 찍히는 순간에만 색종이
  const firedRef = useRef<string | null>(null);
  useEffect(() => {
    if (step.phase !== 'verdict' || !current || verdict?.kind !== 'decided' || !verdict.passed) return;
    const key = `${current.key}:${step.index}`;
    if (firedRef.current === key) return;
    firedRef.current = key;
    void fireConfetti();
  }, [current, step, verdict]);
  useEffect(() => {
    if (step.phase !== 'verdict') firedRef.current = null;
  }, [step.phase]);

  const summary = useMemo(() => summarizeCeremony(policy, enrolled, present), [policy, enrolled, present]);
  const delegationResults = useMemo(
    () => delegations.map((d) => ({ item: d, verdict: ceremonyVerdict(d, enrolled, present) })),
    [delegations, enrolled, present],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} 의결 세리머니`}
      data-testid="division-ceremony"
      data-phase={step.phase}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background: C.bg, color: C.text, padding: 'clamp(16px,2.6vh,40px) clamp(20px,3vw,64px)' }}
    >
      {/* 머리줄 */}
      <header className="flex shrink-0 items-center justify-between gap-6">
        <div className="min-w-0 text-[clamp(24px,1.8vw,34px)] font-extrabold" style={{ color: C.sub }}>
          {label} 의결
          {current ? (
            <span data-testid="ceremony-counter" className="ml-4 tr-num" style={{ color: C.text }}>
              {ceremonyCounter(items, step.index)}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[24px] font-bold" style={{ color: C.sub }}>
            {sourceLabel}
          </span>
          {displayOnly ? null : (
          <>
          <button
            type="button"
            onClick={back}
            disabled={step.phase === 'intro'}
            className="min-h-14 rounded-xl border-2 px-5 text-[24px] font-bold disabled:opacity-30"
            style={{ borderColor: C.sub, color: C.text }}
          >
            이전
          </button>
          <button
            type="button"
            onClick={onExit}
            aria-label="세리머니 나가기"
            className="min-h-14 rounded-xl border-2 px-5 text-[24px] font-bold"
            style={{ borderColor: C.sub, color: C.text }}
          >
            나가기 (ESC)
          </button>
          </>
          )}
        </div>
      </header>

      {/* 본문 */}
      <main className="flex min-h-0 flex-1 flex-col justify-center" style={{ gap: 'clamp(12px,2.4vh,36px)' }}>
        {step.phase === 'intro' ? (
          <IntroView label={label} totalText={totalText} enrolled={enrolled} present={present} established={established} />
        ) : step.phase === 'summary' ? (
          <SummaryView label={label} summary={summary} totalText={totalText} delegations={delegationResults} />
        ) : current && verdict ? (
          <MotionView item={current} verdict={verdict} present={itemPresent} reveal={ceremonyReveal(step.phase)} />
        ) : null}
      </main>

      {/* 발판 */}
      <footer className="flex shrink-0 items-center justify-between gap-6">
        <p className="min-w-0 text-[clamp(24px,1.6vw,30px)] font-bold" style={{ color: C.sub }}>
          재적 {itemEnrolled}명 · 참석 {itemPresent}명 · 참석자 3분의 2 이상 찬성 시 가결
        </p>
        {displayOnly ? null : step.phase === 'summary' ? (
          <button
            type="button"
            onClick={onExit}
            className="min-h-[72px] shrink-0 rounded-2xl px-10 text-[30px] font-extrabold"
            style={{ background: C.gold, color: C.bg }}
          >
            마치기
          </button>
        ) : (
          <button
            type="button"
            onClick={next}
            disabled={step.phase === 'intro' && !established}
            data-testid="ceremony-next"
            className="min-h-[72px] shrink-0 rounded-2xl px-10 text-[30px] font-extrabold disabled:opacity-30"
            style={{ background: C.gold, color: C.bg }}
          >
            {step.phase === 'intro' ? '시작 ▶' : '다음 ▶'}
          </button>
        )}
      </footer>
    </div>
  );
}

function IntroView({
  label,
  totalText,
  enrolled,
  present,
  established,
}: {
  label: string;
  totalText: string;
  enrolled: number;
  present: number;
  established: boolean;
}) {
  return (
    <div className="flex flex-col items-center text-center" style={{ gap: 'clamp(16px,3vh,40px)' }}>
      <h1 className="text-[clamp(80px,8vw,150px)] font-black leading-none" style={{ letterSpacing: '-.03em', color: C.text }}>
        {label} 의결
      </h1>
      <p data-testid="ceremony-total" className="text-[clamp(32px,2.6vw,52px)] font-extrabold tr-num" style={{ color: C.sub }}>
        {totalText}
      </p>
      <p
        data-testid="ceremony-attendance"
        data-established={established ? 'true' : 'false'}
        className="max-w-[80vw] rounded-2xl px-8 py-4 text-[clamp(26px,2vw,40px)] font-extrabold"
        style={established ? { background: C.panel, color: C.text } : { background: '#5A1F24', color: C.warn }}
      >
        {attendanceText(enrolled, present)}
      </p>
    </div>
  );
}

function MotionView({
  item,
  verdict,
  present,
  reveal,
}: {
  item: CeremonyItem;
  verdict: ReturnType<typeof ceremonyVerdict>;
  present: number;
  reveal: { bar: boolean; line: boolean; stamp: boolean };
}) {
  const decided = verdict.kind === 'decided' ? verdict : null;
  const threshold = decided?.threshold ?? 0;
  const ratio = reveal.bar && decided ? barRatio(decided.yeas, present) : 0;
  const lineAt = thresholdRatio(threshold, present);
  // 기준선 이름표가 화면 끝에서 잘리지 않게 가운데 쪽으로 붙잡는다.
  const lineLabelAt = Math.min(Math.max(lineAt, 0.12), 0.88);

  return (
    <>
      <div className="min-w-0">
        <p className="text-[clamp(28px,2.2vw,44px)] font-extrabold tr-num" style={{ color: C.gold }}>
          {item.label}
        </p>
        <h2
          data-testid="ceremony-title"
          className={`${titleSize(item.title)} font-black leading-[1.18] break-keep`}
          style={{ letterSpacing: '-.02em', color: C.text, overflowWrap: 'anywhere' }}
        >
          {item.title}
        </h2>
      </div>

      <div className="grid min-h-0 items-center" style={{ gridTemplateColumns: 'minmax(0,1fr) auto', gap: 'clamp(24px,3vw,64px)' }}>
        <div className="min-w-0" style={{ visibility: reveal.bar ? 'visible' : 'hidden' }}>
          <div className="flex items-baseline gap-6 tr-num">
            <span className="text-[clamp(28px,2.2vw,40px)] font-extrabold" style={{ color: C.sub }}>
              찬성
            </span>
            <span data-testid="ceremony-yeas" className="text-[clamp(80px,8vw,160px)] font-black leading-none" style={{ color: C.yes }}>
              {decided ? decided.yeas : '—'}
            </span>
            <span className="text-[clamp(32px,2.6vw,52px)] font-extrabold" style={{ color: C.sub }}>
              / 참석 {present}
              {item.nays !== undefined ? ` · 반대 ${item.nays}` : ''}
            </span>
          </div>
          <div className="relative mt-4 w-full rounded-2xl" style={{ height: 'clamp(56px,7vh,96px)', background: C.track }}>
            <div
              data-testid="ceremony-bar"
              className="h-full rounded-2xl"
              style={{
                width: `${ratio * 100}%`,
                background: C.yes,
                transition: `width ${BAR_MS}ms cubic-bezier(.2,.8,.2,1)`,
              }}
            />
            {reveal.line && decided ? (
              <div
                data-testid="ceremony-line"
                className="absolute"
                style={{ left: `${lineAt * 100}%`, top: '-14px', bottom: '-14px', width: '8px', marginLeft: '-4px', background: C.gold, borderRadius: '4px' }}
              />
            ) : null}
          </div>
          <div className="relative mt-3" style={{ height: 'clamp(36px,4vh,52px)' }}>
            {reveal.line && decided ? (
              <span
                className="absolute whitespace-nowrap text-[clamp(24px,1.9vw,36px)] font-extrabold tr-num"
                style={{ left: `${lineLabelAt * 100}%`, transform: 'translateX(-50%)', color: C.gold }}
              >
                3분의 2 = {threshold}표
              </span>
            ) : null}
          </div>
        </div>

        <StampBox verdict={verdict} show={reveal.stamp} />
      </div>
    </>
  );
}

function StampBox({ verdict, show }: { verdict: ReturnType<typeof ceremonyVerdict>; show: boolean }) {
  const size = 'clamp(220px,19vw,360px)';
  let body: React.ReactNode = null;
  if (show) {
    if (verdict.kind === 'decided') {
      const color = verdict.passed ? C.pass : C.fail;
      body = (
        <div
          data-testid="ceremony-stamp"
          data-passed={verdict.passed ? 'true' : 'false'}
          className="grid place-items-center rounded-full font-black ceremony-stamp"
          style={{
            width: '78%',
            height: '78%',
            border: `clamp(8px,0.8vw,14px) solid ${color}`,
            color,
            fontSize: 'clamp(64px,5.4vw,104px)',
            transform: 'rotate(-12deg)',
          }}
        >
          {verdict.passed ? '가결' : '부결'}
        </div>
      );
    } else {
      body = (
        <p data-testid="ceremony-stamp" data-passed="invalid" className="px-2 text-center text-[26px] font-extrabold" style={{ color: C.warn }}>
          판정 불가
          <br />
          {verdict.kind === 'invalid' ? verdict.message : '정족수 미달입니다.'}
        </p>
      );
    }
  }
  return (
    <div className="grid place-items-center" style={{ width: size, height: size }}>
      <style>{`
        @keyframes ceremony-stamp-in { 0% { transform: scale(1.8) rotate(-12deg); opacity: 0; } 60% { transform: scale(.94) rotate(-12deg); opacity: 1; } 100% { transform: scale(1) rotate(-12deg); } }
        .ceremony-stamp { animation: ceremony-stamp-in 420ms cubic-bezier(.2,.8,.2,1) both; }
        @media (prefers-reduced-motion: reduce) { .ceremony-stamp { animation: none; } }
      `}</style>
      {body}
    </div>
  );
}

function SummaryView({
  label,
  summary,
  totalText,
  delegations = [],
}: {
  label: string;
  summary: ReturnType<typeof summarizeCeremony>;
  totalText: string;
  /** 문구 작성 위임 의결 — 정책 권고안 수와 따로(10/17). */
  delegations?: { item: CeremonyItem; verdict: ReturnType<typeof ceremonyVerdict> }[];
}) {
  // 10/17 v2 — 가결·부결을 빠짐없이(자르지 않는다), 줄마다 한 줄. 글자 크기·단 수는 줄 수로 정한다(ceremony-layout.ts).
  const shown = summary.passed;
  const rejected = [...summary.failed, ...summary.invalid];
  const layout = summaryLayout(shown.length, rejected.length);
  const listStyle = (n: number): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: `repeat(${Math.min(layout.columns, Math.max(1, n))},minmax(0,1fr))`,
    columnGap: '40px',
    fontSize: `${layout.fontPx}px`,
    lineHeight: `${layout.lineH}px`,
  });
  const row = (item: CeremonyItem, labelColor: string, textColor: string) => (
    <li key={item.key} data-testid="ceremony-summary-item" className="flex min-w-0 items-baseline gap-4 font-bold" style={{ color: textColor, height: `${layout.lineH}px` }}>
      <span className="shrink-0 tr-num" style={{ color: labelColor }}>
        {item.label}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{item.title}</span>
    </li>
  );
  return (
    <div className="flex min-h-0 flex-col" style={{ gap: 'clamp(10px,1.6vh,24px)' }}>
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-8 gap-y-2">
        <h1 data-testid="ceremony-summary" data-passed-count={summary.passed.length} className="text-[clamp(56px,5vw,96px)] font-black leading-none" style={{ color: C.text }}>
          {label} 의결 <span className="tr-num" style={{ color: C.gold, fontSize: 'clamp(80px,8vw,150px)' }}>{summary.passed.length}</span>건
        </h1>
        <p className="text-[clamp(28px,2.2vw,44px)] font-extrabold tr-num" style={{ color: C.sub }}>
          {totalText} · 부결 {summary.failed.length}건
          {summary.invalid.length > 0 ? ` · 판정 불가 ${summary.invalid.length}건` : ''}
          {(() => {
            const second = [...summary.passed, ...summary.failed, ...summary.invalid].filter((i) => (i.round ?? 1) > 1).length;
            return second > 0 ? ` · 그중 2차 투표 ${second}건` : '';
          })()}
        </p>
      </div>
      {shown.length > 0 ? (
        <ol data-testid="ceremony-summary-passed" className="shrink-0" style={listStyle(shown.length)}>
          {shown.map((item) => row(item, C.gold, C.text))}
        </ol>
      ) : null}
      {rejected.length > 0 ? (
        <section data-testid="ceremony-summary-failed" className="shrink-0">
          <p className="text-[clamp(26px,2vw,36px)] font-extrabold leading-tight" style={{ color: C.fail }}>
            부결{summary.invalid.length ? '·판정 불가' : ''} {rejected.length}건
          </p>
          <ol className="mt-1" style={listStyle(rejected.length)}>
            {rejected.map((item) => row(item, C.sub, C.sub))}
          </ol>
        </section>
      ) : null}
      {delegations.map(({ item, verdict }) => (
        <p key={item.key} data-testid="ceremony-summary-delegation" className="shrink-0 text-[clamp(26px,2vw,36px)] font-extrabold leading-tight" style={{ color: C.text }}>
          문구 작성 위임 의결:{' '}
          <span style={{ color: verdict.kind === 'decided' ? (verdict.passed ? C.pass : C.fail) : C.warn }}>
            {verdict.kind === 'decided' ? (verdict.passed ? '가결' : '부결') : '판정 불가'}
          </span>
        </p>
      ))}
    </div>
  );
}
