/**
 * 11/14 최종 의결 「표출 화면」 — 무대 대형 스크린(1920×1080, F11 전체화면).
 *
 * /show?t=<토큰>&present=<참석>&min=<분>      의제 하나: 1 진행 중 · 2 결과 상세 · 3 결과 요약
 * /show?t=<토큰1>,<토큰2>,<토큰3>&present=..  의결 결과 종합(70건 한 화면)
 *
 * present= 가 양의 정수가 아니면 빨간 안내를 띄우고 가결 기준 · 판정을 숨긴다(명단 수로 조용히 바꾸지 않는다).
 *   진행 · 실시간 화면의 완료율(제출 ÷ 참석)은 그때 명단 기준이라고 적는다. motion=0 = 애니메이션 끔(저사양 노트북).
 * 키: Space(또는 프레젠터 F5 · Shift+F5) 시작/일시정지 — 타이머가 보이는 화면(진행 · 영상 · 실시간)에서만 ·
 *     Shift+R 처음으로 · ↑/↓ ±1분 · 1/2/3 화면 전환. 타이머는 기기에 저장돼 새로고침에도 이어진다.
 *     PageDown/PageUp(프레젠터) = 진행 → 실시간 → 영상 차례로(결과 화면 2·3 에는 가지 않고, 2·3 에서는 무시).
 *       종합 주소에서는 실시간 순환 안에서 판만 넘긴다.
 *     V 영상 모드(왼쪽 16:9 영상 + 오른쪽 띠: 남은 시간 · 제출 · QR) · K 또는 영상 클릭 = 재생/일시정지.
 *       영상은 서버에 올리지 않는다 — 화면에 끌어다 놓거나 「영상 고르기」로 고른 파일을 objectURL 로 튼다.
 *     4 실시간 순환(투표율만, 8초마다 넘김) · ←/→ 수동 넘김 · P 자동 넘김 멈춤/재개. 종합 주소에서도 4, 돌아오기는 1 또는 4.
 *       찬성률·찬반 수는 실시간 화면에 넣지 않는다(결과 발표 때 공개).
 * 로그인 없음 — 진행 중에는 수(시작 · 제출)만 읽고(ballot_live_counts), 찬반은 공개(published)된 뒤
 * ballot_results 가 돌려줄 때만 그린다. 공개 전이면 「집계 확인 중」.
 * 계산 규칙은 src/lib/show-logic.ts(순수, 시험).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  fetchBallotLiveCounts,
  fetchBallotResults,
  type BallotLiveCounts,
  type BallotResultItem,
  type BallotResults,
} from '../../lib/ballot';
import { parseMotionStatement } from '../../lib/division-ballot-format';
import {
  AGENDA_FULL_NAMES,
  POLL_TIMEOUT_MS,
  adjustTimer,
  agendaOutcome,
  classifyLoadError,
  clickerStep,
  clockDisplay,
  DEMO_ITEMS,
  DEMO_PRESENT,
  defaultDurationSec,
  demoAdvanceMs,
  demoLiveCounts,
  initialTimer,
  itemOutcome,
  liveDenominator,
  overallTurnout,
  parsePresent,
  parseShowParams,
  participationPct,
  passThreshold,
  resetTimer,
  restoreTimer,
  rotationPanels,
  serializeTimer,
  showModeKey,
  showQr,
  staleSeconds,
  statusText,
  stepPanel,
  screenCue,
  submittedExceedsPresent,
  timeCue,
  timerRemainingMs,
  timerStorageKey,
  toggleTimer,
  turnoutBar,
  turnoutPct,
  withTimeout,
  type RotationPanel,
  type ShowMode,
  type TimeCue,
  type TimerState,
} from '../../lib/show-logic';
import { AGENDA_NAMES, agendaTheme } from '../ballot/BallotPager';
import { motionNumber } from '../ballot/ballot-pager-logic';

const W = 1920;
const H = 1080;
const POLL_MS = 3000;
const VOTE_ORIGIN = 'https://climate-assembly.org';

const C = {
  bg: '#0D1822',
  line: '#1F2C3A',
  text: '#FFFFFF',
  muted: '#9AA8B6',
  dim: '#6B7A89',
  blue: '#5AA8EF',
  orange: '#F29A4A',
  rowBg: '#16222E',
  passBar: '#1F3B57',
  failBar: '#5A3418',
  chipBg: '#1C3550',
};

const KEEP: React.CSSProperties = { wordBreak: 'keep-all', overflowWrap: 'break-word' };
const CLAMP2: React.CSSProperties = {
  ...KEEP,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};


// ── 데이터 ─────────────────────────────────────────────────────────

type Poll<T> = {
  data: T | undefined;
  failing: boolean;
  /** 마지막 실패의 종류(성공하면 null). 첫 읽기 실패 문구를 가른다. */
  errorKind: 'not_found' | 'network' | null;
  /** 마지막 성공이 10초보다 오래되면 지난 초, 아니면 null. */
  staleSec: number | null;
};

/**
 * 3초마다 다시 읽는다. 겹쳐 부르지 않고, 실패하면 마지막 값을 그대로 둔다(무대 화면이 비지 않게).
 * 한 번 읽기는 8초에서 끊는다(응답이 오지 않아도 다음 주기가 돈다).
 */
function usePoll<T>(load: (() => Promise<T>) | null, ms = POLL_MS): Poll<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [failing, setFailing] = useState(false);
  const [errorKind, setErrorKind] = useState<'not_found' | 'network' | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [tickNow, setTickNow] = useState(() => Date.now());
  useEffect(() => {
    if (!load) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStartedAt(Date.now());
    const clock = setInterval(() => setTickNow(Date.now()), 1000);
    const tick = async () => {
      try {
        const v = await withTimeout(load(), POLL_TIMEOUT_MS);
        if (!alive) return;
        setData(v);
        setFailing(false);
        setErrorKind(null);
        setLastOk(Date.now());
      } catch (e) {
        if (alive) {
          setFailing(true);
          setErrorKind(classifyLoadError(e));
        }
      }
      if (alive) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      clearInterval(clock);
    };
  }, [load, ms]);
  return { data, failing, errorKind, staleSec: load ? staleSeconds(lastOk, startedAt, tickNow) : null };
}

/** 첫 읽기 실패 문구 — 없는 토큰과 연결 실패를 가른다. */
function LoadFailed({ kind }: { kind: 'not_found' | 'network' | null }) {
  return kind === 'not_found' ? (
    <Centered title="투표지를 찾을 수 없습니다" sub="링크의 토큰(t=)을 확인해 주세요." />
  ) : (
    <Centered title="서버에 연결하지 못했습니다" sub="자동으로 다시 시도합니다." />
  );
}

/** 무대 위 안내 — 출석 인원 빠짐(빨강) · 제출이 출석보다 많음(주황). */
function Alerts({ presentMissing, overflow }: { presentMissing: boolean; overflow: boolean }) {
  if (!presentMissing && !overflow) return null;
  return (
    // 머리 바로 아래 띠(본문을 그만큼 밀어낸다 — 의제 · 상태 글자를 가리지 않게).
    <div style={{ flex: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, padding: '10px 72px 0' }}>
      {presentMissing ? (
        <p data-testid="show-present-missing" style={{ margin: 0, background: '#C62828', color: '#FFFFFF', fontSize: 34, fontWeight: 900, padding: '10px 32px', borderRadius: 10 }}>
          출석 인원(present=)을 주소에 넣어 주세요
        </p>
      ) : null}
      {overflow ? (
        <p data-testid="show-overflow" style={{ margin: 0, background: '#3A2410', color: C.orange, border: `2px solid ${C.orange}`, fontSize: 22, fontWeight: 800, padding: '6px 18px', borderRadius: 8 }}>
          제출 수가 출석보다 많습니다 — 출석 인원 확인
        </p>
      ) : null}
    </div>
  );
}

function agendaNo(title: string | null | undefined): 1 | 2 | 3 | null {
  return agendaTheme(title)?.no ?? null;
}

function agendaFullName(title: string | null | undefined): string {
  const t = agendaTheme(title);
  if (!t) return title ?? '';
  return AGENDA_FULL_NAMES[t.no] ?? t.name;
}

function itemTitle(item: BallotResultItem): string {
  return parseMotionStatement(item.statement)?.title ?? item.statement;
}

// ── 무대(1920×1080 고정 캔버스를 화면에 맞춰 줄이고 늘린다) ───────────────

function Stage({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, background: C.bg, overflow: 'hidden' }}>
      <div
        data-testid="show-stage"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: W,
          height: H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
          background: C.bg,
          color: C.text,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Header({ sub, right, staleSec }: { sub: string; right: React.ReactNode; staleSec?: number | null }) {
  return (
    <header
      style={{
        height: 100,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 72px',
        borderBottom: `2px solid ${C.line}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
        <span style={{ fontSize: 30, fontWeight: 800 }}>2026 기후시민회의 제9차 전체회의</span>
        <span style={{ fontSize: 30, fontWeight: 500, color: C.muted }}>{sub}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontSize: 30, color: C.muted }}>
        {staleSec != null ? (
          <span data-testid="show-reconnect" className="tr-num" style={{ fontSize: 22, color: C.orange }}>
            ● 연결 확인 중 · 마지막 갱신 {staleSec}초 전
          </span>
        ) : null}
        {right}
      </div>
    </header>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <footer
      style={{
        height: 84,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 72px',
        borderTop: `2px solid ${C.line}`,
        fontSize: 26,
        color: C.muted,
      }}
    >
      {children}
    </footer>
  );
}

function CriteriaLine({ present }: { present: number }) {
  return (
    <span>
      의결 기준&nbsp;&nbsp;
      <b style={{ color: C.text, fontWeight: 700 }}>
        참석자 {present}명의 3분의 2 이상 찬성 ({passThreshold(present)}표 이상)
      </b>
    </span>
  );
}

function AgendaBadge({ no }: { no: number | null }) {
  if (!no) return null;
  return (
    <span
      style={{
        background: C.blue,
        color: '#0B1A2A',
        fontSize: 40,
        fontWeight: 800,
        padding: '6px 24px',
        borderRadius: 10,
        lineHeight: 1.2,
      }}
    >
      의제 {no}
    </span>
  );
}

function Centered({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <p data-testid="show-message" style={{ fontSize: 72, fontWeight: 800, margin: 0 }}>
        {title}
      </p>
      {sub ? <p style={{ fontSize: 32, color: C.muted, margin: 0 }}>{sub}</p> : null}
    </div>
  );
}

// ── 투표 진행 중(시안 쪽 0) ─────────────────────────────────────────

/** 시연(demo=) 화면의 가짜 토큰 — 32자 영숫자가 아니라 실제 투표지와 겹칠 수 없다. QR 에는 주소가 아니라 안내 글만 넣는다. */
const DEMO_TOKEN = 'demo';
const DEMO_QR_TEXT = '시연용 QR - 실제 투표지가 아닙니다 (기후시민회의 표출 화면 시연)';

function useQrSrc(token: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const payload = token === DEMO_TOKEN ? DEMO_QR_TEXT : `${VOTE_ORIGIN}/b?t=${token}`;
    QRCode.toDataURL(payload, { width: 1000, margin: 1, errorCorrectionLevel: token === DEMO_TOKEN ? 'H' : 'M' })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [token]);
  return src;
}

/** QR 이 숨은 자리(서버 상태가 open 이 아닐 때). */
function QrHidden({ size, fontSize }: { size: number; fontSize: number }) {
  return (
    <div
      data-testid="show-qr-hidden"
      style={{ ...KEEP, width: size, height: size, flex: 'none', boxSizing: 'border-box', border: `3px dashed ${C.dim}`, borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 28, fontSize, fontWeight: 800, color: C.muted, lineHeight: 1.4, alignSelf: 'center' }}
    >
      투표가 열리면 QR이 나타납니다
    </div>
  );
}

/** 시연 QR 가운데 「시연용」 딱지(오류 정정 H 라 가려도 읽힌다 — 읽히는 것은 안내 글뿐). */
function DemoQrMark() {
  return (
    <span
      data-testid="show-qr-demo"
      style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', background: C.bg, color: '#FFFFFF', fontSize: 40, fontWeight: 900, padding: '10px 22px', borderRadius: 12, whiteSpace: 'nowrap' }}
    >
      시연용
    </span>
  );
}

/** 시연 화면 표기(머리 오른쪽, 작게). */
function DemoTag() {
  return (
    <span data-testid="show-demo-tag" style={{ fontSize: 22, fontWeight: 700, color: C.orange, border: `2px solid ${C.orange}`, borderRadius: 8, padding: '4px 14px', whiteSpace: 'nowrap' }}>
      시연 화면 · 숫자는 가상
    </span>
  );
}

// ── 남은 시간 알림 · 10초 카운트다운 · 종료(시안 색 · 글꼴 안에서) ─────────────────

/** 제목과 수 사이 빈자리에 띄우는 띠 — 5분 · 3분 · 1분 · 30초(주황, 잠깐 크게 떴다 줄어듦) · 종료(주황 테두리, 계속). */
function CueBand({ cue, small = false }: { cue: TimeCue; small?: boolean }) {
  const f = small ? 0.84 : 1; // 실시간 순환 · 영상 화면은 조금 작게(빈자리가 좁다)
  if (cue.kind === 'notice') {
    return (
      <p
        key={cue.sec}
        data-testid="show-cue"
        data-kind="notice"
        data-sec={cue.sec}
        className="show-cue-in"
        style={{ margin: 0, flex: 'none', background: C.orange, color: '#0B1A2A', fontSize: 76 * f, fontWeight: 900, lineHeight: 1.15, padding: '8px 52px', borderRadius: 16, whiteSpace: 'nowrap' }}
      >
        {cue.text}
        {/* 독려 문구 — 같은 줄 오른쪽에 작게(띠 높이는 그대로, 11/12 줌 회의 5·3·1분 독려) */}
        {cue.sub ? (
          <span data-testid="show-cue-sub" style={{ fontSize: 44 * f, fontWeight: 800, marginLeft: 28 * f }}>
            {cue.sub}
          </span>
        ) : null}
      </p>
    );
  }
  if (cue.kind === 'ended') {
    return (
      <p
        data-testid="show-cue"
        data-kind="ended"
        className="show-cue-in"
        style={{ margin: 0, flex: 'none', border: `4px solid ${C.orange}`, background: C.bg, color: C.orange, fontSize: 64 * f, fontWeight: 900, lineHeight: 1.15, padding: '8px 44px', borderRadius: 16, whiteSpace: 'nowrap' }}
      >
        {cue.text}
      </p>
    );
  }
  return null;
}

/** 실시간 순환 · 영상 화면 — 띠를 칸 위(top) 또는 아래(bottom) 가운데에 겹쳐 띄운다. */
function CueFloat({ cue, at }: { cue: TimeCue; at: 'top' | 'bottom' }) {
  if (cue.kind !== 'notice' && cue.kind !== 'ended') return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, [at]: at === 'top' ? 12 : 28, display: 'flex', justifyContent: 'center', zIndex: 3, pointerEvents: 'none' }}>
      <CueBand cue={cue} small />
    </div>
  );
}

/** 10→1 — 제목 자리 전체를 덮는 큰 숫자(QR 은 가리지 않는다). */
function CountdownCover({ n }: { n: number }) {
  return (
    <div
      data-testid="show-cue"
      data-kind="count"
      data-n={n}
      style={{ position: 'absolute', inset: 0, background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 36, zIndex: 2 }}
    >
      <span style={{ fontSize: 56, fontWeight: 800, color: C.muted, whiteSpace: 'nowrap' }}>투표 마감까지</span>
      <span key={n} className="tr-num show-count-pop" style={{ fontSize: 400, fontWeight: 900, lineHeight: 1, color: n <= 3 ? C.orange : C.text, minWidth: 520, textAlign: 'center' }}>
        {n}
      </span>
      <span style={{ fontSize: 72, fontWeight: 800, color: C.muted }}>초</span>
    </div>
  );
}

function QrCard({ token, visible }: { token: string; visible: boolean }) {
  const src = useQrSrc(token);
  return (
    <div style={{ width: 420, flex: 'none', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {visible ? (
        <div style={{ position: 'relative', background: '#FFFFFF', borderRadius: 28, padding: 26, width: 420, height: 420, boxSizing: 'border-box' }}>
          {src ? <img data-testid="show-qr" src={src} alt="투표 QR" style={{ width: '100%', height: '100%', display: 'block' }} /> : null}
          {token === DEMO_TOKEN ? <DemoQrMark /> : null}
        </div>
      ) : (
        <QrHidden size={420} fontSize={36} />
      )}
      <p style={{ ...KEEP, margin: 0, fontSize: 32, fontWeight: 700, lineHeight: 1.45 }}>
        QR을 비춘 뒤 권고안마다 <span style={{ color: C.blue }}>찬성</span> 또는 <span style={{ color: C.orange }}>반대</span>를 선택해
        주세요.
      </p>
      <p style={{ ...KEEP, margin: 0, fontSize: 25, color: C.muted, lineHeight: 1.5 }}>
        접속이 어려우시면 손을 들어 현장 도우미를 불러 주세요.
      </p>
    </div>
  );
}

type Denom = { n: number; label: string; byRoster: boolean };

function LiveView({
  token,
  live,
  denom,
  timer,
  now,
  cue,
}: {
  token: string;
  live: BallotLiveCounts;
  denom: Denom;
  timer: TimerState;
  now: number;
  /** 남은 시간 알림(SingleShow 가 screenCue 로 정해 넘긴다 — 영상 · 실시간 화면과 같은 값). */
  cue: TimeCue;
}) {
  const no = agendaNo(live.title);
  const remaining = timerRemainingMs(timer, now);
  const timeUp = remaining <= 0 && timer.durationMs > 0;
  const clock = clockDisplay(live.status, remaining, timer.durationMs);
  const closed = clock.ended;
  const running = timer.runningSince != null && !timeUp;
  const rate = participationPct(live.submitted, denom.n);
  const progressRate = turnoutPct(live.started, denom.n);
  const timeFrac = timer.durationMs > 0 ? Math.min(1, remaining / timer.durationMs) : 0;
  const status = statusText(live.status, timeUp);
  return (
    <div style={{ flex: 1, display: 'flex', padding: '44px 72px 36px', gap: 72, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* 의제 · 제목 · 빈자리 — 알림 띠는 빈자리에, 10초 카운트다운은 이 칸 전체를 덮는다(QR · 수는 그대로). */}
        <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
          <AgendaBadge no={no} />
          <span data-testid="show-status" style={{ fontSize: 40, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 22, height: 22, borderRadius: 11, background: status === '투표 진행 중' ? C.blue : C.orange }} />
            {status}
          </span>
        </div>
        <h1
          data-testid="show-title"
          style={{ ...CLAMP2, flex: 'none', margin: '26px 0 0', fontSize: 80, fontWeight: 900, lineHeight: 1.2, textAlign: 'center', letterSpacing: '-0.02em' }}
        >
          {agendaFullName(live.title)}
        </h1>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CueBand cue={cue} />
        </div>
        {cue.kind === 'count' ? <CountdownCover n={cue.n} /> : null}
        </div>
        <div style={{ display: 'flex', gap: 64 }}>
          <div style={{ flex: 1, borderTop: `6px solid ${C.text}`, paddingTop: 18 }}>
            <p style={{ margin: 0, fontSize: 36, fontWeight: 700, color: C.muted }}>남은 투표 시간</p>
            <p
              data-testid="show-clock"
              className="tr-num"
              style={{ margin: '4px 0 0', fontSize: clock.text.length > 2 && closed ? 120 : 176, height: 176, display: 'flex', alignItems: 'flex-end', fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', color: closed ? C.orange : C.text }}
            >
              {clock.text}
            </p>
          </div>
          <div style={{ flex: 1, borderTop: `6px solid ${C.blue}`, paddingTop: 18 }}>
            <p style={{ margin: 0, fontSize: 36, fontWeight: 700, color: C.blue }}>제출 완료</p>
            <p style={{ margin: '4px 0 0', display: 'flex', alignItems: 'baseline', gap: 18, lineHeight: 1 }}>
              <span data-testid="show-submitted" className="tr-num" style={{ fontSize: 176, fontWeight: 900, color: C.blue, whiteSpace: 'nowrap', flex: 'none' }}>
                {live.submitted}
              </span>
              <span className="tr-num" style={{ fontSize: denom.byRoster ? 32 : 44, color: C.muted, whiteSpace: 'nowrap' }}>
                / {denom.label}
              </span>
            </p>
            {/* 진행률 = 투표 시작 ÷ 참석(들어온 사람) · 완료율 = 제출 ÷ 참석([제출]까지 누른 사람) */}
            <p style={{ margin: '14px 0 0', fontSize: 28, color: C.muted, display: 'flex', gap: 24, whiteSpace: 'nowrap' }}>
              <span>
                투표 시작{' '}
                <b data-testid="show-started" className="tr-num" style={{ color: C.text, fontSize: 40 }}>
                  {live.started}
                </b>
                명
              </span>
              <span>
                진행률{' '}
                <b data-testid="show-progress-rate" className="tr-num" style={{ color: C.orange, fontSize: 40 }}>
                  {progressRate}%
                </b>
              </span>
              <span>
                완료율{' '}
                <b data-testid="show-rate" className="tr-num" style={{ color: C.blue, fontSize: 40 }}>
                  {rate}%
                </b>
              </span>
              {denom.byRoster ? <span style={{ fontSize: 22 }}>(명단 기준)</span> : null}
            </p>
            {/* 2겹 막대 — 주황(진행률)이 먼저 차고 파랑(완료율)이 뒤따른다. 메인 숫자는 늘 「제출 완료」. */}
            <div data-testid="show-rate-bar" style={{ position: 'relative', marginTop: 14, height: 18, borderRadius: 9, background: C.line, overflow: 'hidden' }}>
              <div data-testid="show-rate-bar-progress" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progressRate}%`, background: C.orange, borderRadius: 9, transition: 'width .8s ease' }} />
              <div data-testid="show-rate-bar-done" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, rate)}%`, background: C.blue, borderRadius: 9, transition: 'width .8s ease' }} />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 30, height: 22, borderRadius: 11, background: C.line, overflow: 'hidden' }}>
          <div style={{ width: `${timeFrac * 100}%`, height: '100%', background: closed ? C.orange : C.text, borderRadius: 11 }} />
        </div>
      </div>
      <QrCard token={token} visible={showQr(live.status)} />
    </div>
  );
}

// ── 결과 상세(시안 쪽 6~8) ──────────────────────────────────────────

function StatBlock({ label, color, value, unit }: { label: string; color: string; value: React.ReactNode; unit?: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <p style={{ margin: 0, fontSize: 24, fontWeight: 700, color }}>{label}</p>
      <p className="tr-num" style={{ margin: '2px 0 0', fontSize: 56, fontWeight: 900, lineHeight: 1.05 }}>
        {value}
        {unit ? <span style={{ fontSize: 30, color: C.muted, fontWeight: 600 }}>{unit}</span> : null}
      </p>
    </div>
  );
}

function ResultRow({ item, present, height }: { item: BallotResultItem; present: number; height: number }) {
  const o = itemOutcome(item.dist, present);
  const lineAt = present > 0 ? Math.min(100, (passThreshold(present) / present) * 100) : 0;
  const color = o.passed ? C.blue : C.orange;
  return (
    <div data-testid="show-row" style={{ height, display: 'flex', alignItems: 'center', gap: 14 }}>
      <span className="tr-num" style={{ width: 74, flex: 'none', fontSize: 28, fontWeight: 800 }}>
        {motionNumber(item)}
      </span>
      <div style={{ position: 'relative', flex: 1, minWidth: 0, height: height - 8, background: C.rowBg, borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${o.barPct}%`, background: o.passed ? C.passBar : C.failBar }} />
        <div style={{ position: 'absolute', left: `${lineAt}%`, top: 0, bottom: 0, width: 3, background: '#FFFFFF', opacity: 0.85 }} />
        <div style={{ position: 'relative', height: '100%', display: 'flex', alignItems: 'center', padding: '0 14px' }}>
          <span style={{ ...CLAMP2, fontSize: 20, lineHeight: 1.22, fontWeight: 500 }}>{itemTitle(item)}</span>
        </div>
      </div>
      <span className="tr-num" style={{ width: 92, flex: 'none', textAlign: 'right', fontSize: 34, fontWeight: 800, color: o.passed ? C.text : C.orange }}>
        {o.pct}%
      </span>
      <span className="tr-num" style={{ width: 74, flex: 'none', textAlign: 'right', fontSize: 20, color: C.muted }}>
        {o.yes}표
      </span>
      <span
        data-testid="show-verdict"
        style={{
          width: 86,
          flex: 'none',
          textAlign: 'center',
          background: color,
          color: '#0B1A2A',
          fontSize: 24,
          fontWeight: 800,
          borderRadius: 6,
          padding: '4px 0',
        }}
      >
        {o.passed ? '가결' : '부결'}
      </span>
    </div>
  );
}

function DetailView({ results, present }: { results: BallotResults; present: number }) {
  const items = [...results.items].sort((a, b) => a.ordinal - b.ordinal);
  const out = agendaOutcome(items.map((i) => i.dist), present);
  const half = Math.ceil(items.length / 2);
  const cols = [items.slice(0, half), items.slice(half)];
  const bodyH = H - 100 - 84 - 150 - 30;
  const rowH = Math.min(78, Math.floor(bodyH / Math.max(1, half)));
  const no = agendaNo(results.title);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '22px 72px 0', minHeight: 0 }}>
      <div style={{ height: 128, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', paddingBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, minWidth: 0 }}>
          <span style={{ fontSize: 76, fontWeight: 900, whiteSpace: 'nowrap' }}>의제 {no ?? ''}</span>
          <span style={{ fontSize: 32, color: C.muted, whiteSpace: 'nowrap' }}>{agendaFullName(results.title)}</span>
        </div>
        <div style={{ display: 'flex', gap: 48 }}>
          <StatBlock label="가결" color={C.blue} value={out.passed} unit={` / ${items.length}`} />
          <StatBlock label="부결" color={C.orange} value={out.failed} />
          <StatBlock label="평균 찬성률" color={C.muted} value={`${out.avgPct}%`} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 56, flex: 1, minHeight: 0 }}>
        {cols.map((col, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            {col.map((item) => (
              <ResultRow key={item.id} item={item} present={present} height={rowH} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 결과 요약(시안 쪽 3~5) ──────────────────────────────────────────

function Chip({ number, passed, w, h }: { number: string; passed: boolean; w: number; h: number }) {
  return (
    <div
      data-testid="show-chip"
      style={{
        width: w,
        height: h,
        boxSizing: 'border-box',
        borderRadius: 10,
        border: `2px solid ${passed ? C.blue : C.orange}`,
        background: passed ? C.chipBg : C.orange,
        color: passed ? C.text : '#1B1206',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1.1,
      }}
    >
      <span className="tr-num" style={{ fontSize: 28, fontWeight: 800 }}>
        {number}
      </span>
      <span style={{ fontSize: 20, fontWeight: 700 }}>{passed ? '가결' : '부결'}</span>
    </div>
  );
}

function BigStat({ label, color, value, unit, valueColor }: { label: string; color: string; value: React.ReactNode; unit: string; valueColor?: string }) {
  return (
    <div style={{ flex: 1, borderTop: `6px solid ${color}`, paddingTop: 16 }}>
      <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: color === C.text ? C.muted : color }}>{label}</p>
      <p className="tr-num" style={{ margin: 0, fontSize: 150, fontWeight: 900, lineHeight: 1.05, color: valueColor ?? color }}>
        {value}
        <span style={{ fontSize: 44, color: C.muted, fontWeight: 600, marginLeft: 10 }}>{unit}</span>
      </p>
    </div>
  );
}

function SummaryView({ results, present }: { results: BallotResults; present: number }) {
  const items = [...results.items].sort((a, b) => a.ordinal - b.ordinal);
  const out = agendaOutcome(items.map((i) => i.dist), present);
  const no = agendaNo(results.title);
  const failedNums = items.filter((i) => !itemOutcome(i.dist, present).passed).map((i) => motionNumber(i));
  const message =
    out.failed === 0
      ? `의제 ${no ?? ''} 권고안 ${items.length}건이 모두 가결되었습니다.`
      : `의제 ${no ?? ''} 권고안 ${items.length}건 중 ${out.passed}건 가결 · ${out.failed}건 부결 (부결: ${failedNums.join(', ')})`;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '30px 72px 0', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
        <AgendaBadge no={no} />
        <span style={{ fontSize: 40, fontWeight: 800 }}>의결 결과</span>
      </div>
      <h1 style={{ ...KEEP, margin: '14px 0 22px', fontSize: 68, fontWeight: 900, textAlign: 'center', whiteSpace: 'nowrap' }}>
        {agendaFullName(results.title)}
      </h1>
      <div style={{ display: 'flex', gap: 56 }}>
        <BigStat label="가결" color={C.blue} value={out.passed} unit="건" />
        <BigStat label="부결" color={C.orange} value={out.failed} unit="건" />
        <BigStat label="평균 찬성률" color={C.text} value={out.avgPct} unit="%" />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 26 }}>
        {items.map((i) => (
          <Chip key={i.id} number={motionNumber(i)} passed={itemOutcome(i.dist, present).passed} w={114} h={70} />
        ))}
      </div>
      <p data-testid="show-summary-message" style={{ ...KEEP, width: '100%', margin: '24px 0 0', textAlign: 'center', fontSize: 32, fontWeight: 800, color: out.failed ? C.orange : C.blue }}>
        {message}
      </p>
    </div>
  );
}

// ── 영상 모드(V) — 왼쪽 16:9 영상 + 오른쪽 세로 띠 ────────────────────────

const VID_W = 1440;
const VID_H = 810;
const VID_GAP = 24;
const STRIP_W = W - VID_W - VID_GAP * 3; // 408
const VIDEO_QR = 404; // 무대 px(안쪽 그림 380) — 1536×864(×0.8)에서도 그림 약 304px

function isVideoFile(f: File): boolean {
  return f.type.startsWith('video/') || /\.(mp4|m4v|webm|mov)$/i.test(f.name);
}

function VideoView({
  token,
  live,
  present,
  denom,
  timer,
  now,
  videoUrl,
  videoRef,
  onTogglePlay,
  onPick,
  cue,
}: {
  cue: TimeCue;
  token: string;
  live: BallotLiveCounts;
  /** 출석(URL present). null 이면 가결 기준 줄을 숨긴다. */
  present: number | null;
  denom: Denom;
  timer: TimerState;
  now: number;
  videoUrl: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onTogglePlay: () => void;
  onPick: () => void;
}) {
  const qr = useQrSrc(token);
  const no = agendaNo(live.title);
  const remaining = timerRemainingMs(timer, now);
  const timeUp = remaining <= 0 && timer.durationMs > 0;
  const clock = clockDisplay(live.status, remaining, timer.durationMs);
  const closed = clock.ended;
  const status = statusText(live.status, timeUp);
  const qrOn = showQr(live.status);
  const [playing, setPlaying] = useState(false);
  const [begun, setBegun] = useState(false);
  useEffect(() => {
    setPlaying(false);
    setBegun(false);
  }, [videoUrl]);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: VID_GAP, padding: `0 ${VID_GAP}px`, alignItems: 'stretch' }}>
      <div style={{ width: VID_W, flex: 'none', display: 'flex', alignItems: 'center' }}>
        <div
          data-testid="show-video-cell"
          onClick={videoUrl ? onTogglePlay : undefined}
          style={{
            position: 'relative',
            width: VID_W,
            height: VID_H,
            background: '#000',
            borderRadius: 12,
            overflow: 'hidden',
            cursor: videoUrl ? 'pointer' : 'default',
            border: videoUrl ? 'none' : `3px dashed ${C.dim}`,
            boxSizing: 'border-box',
          }}
        >
          {videoUrl ? (
            <>
              <video
                ref={videoRef}
                data-testid="show-video"
                src={videoUrl}
                playsInline
                preload="auto"
                onPlay={() => {
                  setPlaying(true);
                  setBegun(true);
                }}
                onPause={() => setPlaying(false)}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
              {!playing && !begun ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span style={{ fontSize: 120, color: '#FFFFFF', opacity: 0.75, lineHeight: 1 }}>▶</span>
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
              <p data-testid="show-video-empty" style={{ margin: 0, fontSize: 48, fontWeight: 800, color: C.muted }}>
                영상 파일을 여기로 끌어다 놓으세요
              </p>
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={onPick}
                style={{ font: 'inherit', fontSize: 30, fontWeight: 700, padding: '14px 36px', borderRadius: 10, border: `2px solid ${C.blue}`, background: 'transparent', color: C.blue, cursor: 'pointer' }}
              >
                영상 고르기
              </button>
              <p style={{ margin: 0, fontSize: 22, color: C.dim }}>재생·일시정지: 영상 클릭 또는 K · 영상 끄기: V</p>
            </div>
          )}
          {/* 남은 시간 알림 — 영상 아래쪽 가운데 띠, 10초부터는 영상 칸을 덮는 큰 숫자(오른쪽 띠의 QR 은 그대로). */}
          <CueFloat cue={cue} at="bottom" />
          {cue.kind === 'count' ? <CountdownCover n={cue.n} /> : null}
        </div>
      </div>
      <aside data-testid="show-video-strip" style={{ width: STRIP_W, flex: 'none', display: 'flex', flexDirection: 'column', padding: '22px 0 20px', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {no ? (
            <span style={{ background: C.blue, color: '#0B1A2A', fontSize: 30, fontWeight: 800, padding: '4px 18px', borderRadius: 8, lineHeight: 1.2, whiteSpace: 'nowrap' }}>의제 {no}</span>
          ) : null}
          <span data-testid="show-status" style={{ fontSize: 26, fontWeight: 800, color: status === '투표 진행 중' ? C.text : C.orange }}>
            {status}
          </span>
        </div>
        <p style={{ ...KEEP, flex: 'none', margin: '10px 0 0', fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>{no ? AGENDA_NAMES[no] : live.title}</p>
        <div style={{ flex: 'none', marginTop: 18, borderTop: `4px solid ${C.text}`, paddingTop: 8 }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.muted }}>남은 투표 시간</p>
          <p data-testid="show-clock" className="tr-num" style={{ margin: 0, fontSize: closed && clock.text.length > 2 ? 60 : 84, height: 88, display: 'flex', alignItems: 'flex-end', fontWeight: 900, lineHeight: 1.05, whiteSpace: 'nowrap', color: closed ? C.orange : C.text }}>
            {clock.text}
          </p>
        </div>
        <div style={{ flex: 'none', marginTop: 14, borderTop: `4px solid ${C.blue}`, paddingTop: 8 }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.blue }}>제출 완료</p>
          <p style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 12, lineHeight: 1.05 }}>
            <span data-testid="show-submitted" className="tr-num" style={{ fontSize: 80, fontWeight: 900, color: C.blue }}>
              {live.submitted}
            </span>
            <span className="tr-num" style={{ fontSize: denom.byRoster ? 24 : 30, color: C.muted, whiteSpace: 'nowrap' }}>/ {denom.label}</span>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 24, color: C.muted }}>
            투표 시작{' '}
            <b data-testid="show-started" className="tr-num" style={{ color: C.text, fontSize: 30 }}>
              {live.started}
            </b>
            명
          </p>
        </div>
        <div style={{ flex: 1 }} />
        {qrOn ? (
          <>
            <div style={{ flex: 'none', width: VIDEO_QR, height: VIDEO_QR, background: '#FFFFFF', borderRadius: 18, padding: 14, boxSizing: 'border-box', alignSelf: 'center' }}>
              {qr ? <img data-testid="show-qr" src={qr} alt="투표 QR" style={{ width: '100%', height: '100%', display: 'block' }} /> : null}
            </div>
            <p style={{ ...KEEP, flex: 'none', margin: '10px 0 0', fontSize: 22, fontWeight: 700, textAlign: 'center' }}>휴대폰으로 QR을 비춰 투표해 주세요</p>
          </>
        ) : (
          <QrHidden size={VIDEO_QR} fontSize={30} />
        )}
        {present != null ? (
          <p className="tr-num" style={{ ...KEEP, flex: 'none', margin: '8px 0 0', fontSize: 20, color: C.muted, textAlign: 'center' }}>
            가결 기준 참석자 3분의 2 이상 찬성 ({passThreshold(present)}표 이상)
          </p>
        ) : null}
      </aside>
    </div>
  );
}

// ── 실시간 순환(4) — 투표율만. 찬성률·찬반 수는 이 화면에 넣지 않는다 ────────────

const ROTATE_MS = 8000;

type LiveAgenda = { no: 1 | 2 | 3 | null; live: BallotLiveCounts };

/** 8초마다 다음 판. ←/→ 로 넘기면 그때부터 다시 8초. paused 면 멈춘다. */
function useRotation(count: number, active: boolean) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!active || paused || count <= 1) return;
    const t = setTimeout(() => setIndex((i) => stepPanel(i, count, 1)), ROTATE_MS);
    return () => clearTimeout(t);
  }, [index, paused, active, count]);
  const step = useCallback((d: number) => setIndex((i) => stepPanel(i, count, d)), [count]);
  const togglePause = useCallback(() => setPaused((p) => !p), []);
  return { index: count > 0 ? index % count : 0, paused, step, togglePause };
}

function Ring({ pct, size }: { pct: number; size: number }) {
  const stroke = 44;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.line} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={C.blue}
        strokeWidth={stroke}
        strokeLinecap={pct > 0 ? 'round' : 'butt'}
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .8s ease' }}
      />
    </svg>
  );
}

function OverallPanel({ agendas, denom, compact = false }: { agendas: LiveAgenda[]; denom: Denom; compact?: boolean }) {
  const o = overallTurnout(
    agendas.map((a) => a.live),
    denom.n,
  );
  // compact = 오른쪽에 QR 이 붙은 판(의제 하나 실시간) — 고리를 줄여 왼쪽 칸 안에 든다.
  const size = compact ? 500 : 600;
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: compact ? 64 : 110 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <Ring pct={o.pct} size={size} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span data-testid="rot-overall-pct" className="tr-num" style={{ fontSize: 190, fontWeight: 900, lineHeight: 1 }}>
            {o.pct}
            <span style={{ fontSize: 80, color: C.muted }}>%</span>
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 44, minWidth: compact ? 0 : 560 }}>
        <p style={{ margin: 0, fontSize: 64, fontWeight: 900 }}>전체 완료율{denom.byRoster ? <span style={{ fontSize: 34, color: C.muted }}> (명단 기준)</span> : null}</p>
        <div style={{ borderTop: `6px solid ${C.blue}`, paddingTop: 14 }}>
          <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: C.blue }}>제출 완료</p>
          <p className="tr-num" style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 16, lineHeight: 1.05 }}>
            <span style={{ fontSize: 120, fontWeight: 900, color: C.blue }}>{o.submitted}</span>
            <span style={{ fontSize: 36, color: C.muted, whiteSpace: 'nowrap' }}>
              / {agendas.length > 1 ? `${denom.label} × 의제 ${agendas.length}개` : denom.label}
            </span>
          </p>
        </div>
        <div style={{ borderTop: `6px solid ${C.text}`, paddingTop: 14 }}>
          <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: C.muted }}>지금 투표 중</p>
          <p className="tr-num" style={{ margin: 0, lineHeight: 1.05 }}>
            <span data-testid="rot-inprogress" style={{ fontSize: 120, fontWeight: 900 }}>
              {o.inProgress}
            </span>
            <span style={{ fontSize: 44, color: C.muted, marginLeft: 10 }}>명</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function AgendasPanel({ agendas, denom }: { agendas: LiveAgenda[]; denom: Denom }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 30, padding: '0 20px' }}>
      <p style={{ margin: 0, fontSize: 52, fontWeight: 900 }}>의제별 완료율{denom.byRoster ? <span style={{ fontSize: 30, color: C.muted }}> (명단 기준)</span> : null}</p>
      {agendas.map((a) => {
        const b = turnoutBar(a.live.submitted, a.live.started, denom.n);
        const pct = turnoutPct(a.live.submitted, denom.n);
        return (
          <div key={a.live.title} data-testid="rot-agenda-row">
            <p style={{ ...KEEP, margin: '0 0 12px', display: 'flex', alignItems: 'baseline', gap: 20 }}>
              <span style={{ fontSize: 44, fontWeight: 900, whiteSpace: 'nowrap' }}>의제{a.no ?? ''}</span>
              <span style={{ fontSize: 30, color: C.muted, whiteSpace: 'nowrap' }}>
                {a.no ? AGENDA_NAMES[a.no] : a.live.title}
              </span>
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
              <div style={{ position: 'relative', flex: 1, height: 72, background: C.rowBg, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b.submittedPct}%`, background: C.blue, transition: 'width .8s ease' }} />
                <div
                  title="투표 시작"
                  style={{ position: 'absolute', left: `calc(${b.startedPct}% - 3px)`, top: 0, bottom: 0, width: 6, background: C.orange, transition: 'left .8s ease' }}
                />
              </div>
              <span className="tr-num" style={{ width: 210, flex: 'none', textAlign: 'right', fontSize: 76, fontWeight: 900, lineHeight: 1 }}>
                {pct}
                <span style={{ fontSize: 40, color: C.muted }}>%</span>
              </span>
            </div>
            <p className="tr-num" style={{ margin: '10px 0 0', fontSize: 28, color: C.muted, display: 'flex', gap: 36 }}>
              <span>
                제출 완료 <b style={{ color: C.text }}>{a.live.submitted}</b> / {denom.label}
              </span>
              <span>
                투표 시작 <b style={{ color: C.orange }}>{a.live.started}</b>명
              </span>
              <span>
                지금 투표 중 <b style={{ color: C.text }}>{a.live.in_progress}</b>명
              </span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

function SinglePanel({
  agenda,
  denom,
  clock,
  compact = false,
}: {
  agenda: LiveAgenda;
  denom: Denom;
  clock: { text: string; closed: boolean } | null;
  compact?: boolean;
}) {
  const pct = turnoutPct(agenda.live.submitted, denom.n);
  const big = compact ? 132 : 170;
  const cell = (label: string, color: string, value: React.ReactNode, unit: string, testid?: string, size = big) => (
    <div style={{ flex: 1, borderTop: `8px solid ${color}`, paddingTop: 18 }}>
      <p style={{ margin: 0, fontSize: 38, fontWeight: 700, color: color === C.text ? C.muted : color }}>{label}</p>
      <p className="tr-num" style={{ margin: '6px 0 0', lineHeight: 1, whiteSpace: 'nowrap' }}>
        <span data-testid={testid} style={{ fontSize: size, fontWeight: 900, color: color === C.text ? C.text : color }}>
          {value}
        </span>
        {unit ? <span style={{ fontSize: 48, color: C.muted, marginLeft: 10 }}>{unit}</span> : null}
      </p>
    </div>
  );
  // 위 83px 는 남은 시간 띠 자리(RotateView 의 CueFloat 위 12px ~ 약 102px) — 띠가 의제 이름 줄을 덮지 않게 늘 비워 둔다.
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 56, padding: '83px 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <AgendaBadge no={agenda.no} />
        <span style={{ ...KEEP, fontSize: compact ? 44 : 52, fontWeight: 900 }}>{agenda.no ? AGENDA_NAMES[agenda.no] : agenda.live.title}</span>
      </div>
      <div style={{ display: 'flex', gap: compact ? 40 : 56 }}>
        {cell('제출 완료', C.blue, agenda.live.submitted, `/ ${denom.byRoster ? denom.label : `${denom.n}명`}`, 'rot-single-submitted')}
        {cell(denom.byRoster ? '완료율(명단 기준)' : '완료율', C.blue, pct, '%', 'rot-single-rate')}
        {cell('진행률', C.orange, turnoutPct(agenda.live.started, denom.n), '%', 'rot-single-progress')}
      </div>
      <div style={{ display: 'flex', gap: compact ? 40 : 56 }}>
        {cell('투표 시작', C.orange, agenda.live.started, '명')}
        {cell('지금 투표 중', C.text, agenda.live.in_progress, '명')}
        {clock ? cell('남은 투표 시간', clock.closed ? C.orange : C.text, clock.text, '', 'rot-single-clock', clock.closed && clock.text.length > 2 ? 96 : big) : null}
      </div>
    </div>
  );
}

function RotateView({
  agendas,
  denom,
  panels,
  index,
  clock,
  cue = { kind: 'none' },
  qr = null,
}: {
  agendas: LiveAgenda[];
  denom: Denom;
  panels: RotationPanel[];
  index: number;
  clock: { text: string; closed: boolean } | null;
  /** 의제 하나 주소의 남은 시간 알림(종합 주소는 타이머가 없어 none). 판이 넘어가도 그대로 위에 뜬다. */
  cue?: TimeCue;
  /** 의제 하나 주소 — QR 을 오른쪽에 늘 두고 왼쪽 판만 넘긴다(진행 화면과 같은 자리 · 크기). */
  qr?: { token: string; visible: boolean } | null;
}) {
  const panel = panels[index] ?? 'overall';
  const compact = qr != null;
  const panels_ = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', position: 'relative' }}>
      <div key={`${panel}-${index}`} data-testid={`rot-panel-${panel}`} className="show-panel-in" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {panel === 'overall' ? (
          <OverallPanel agendas={agendas} denom={denom} compact={compact} />
        ) : panel === 'agendas' ? (
          <AgendasPanel agendas={agendas} denom={denom} />
        ) : agendas[0] ? (
          <SinglePanel agenda={agendas[0]} denom={denom} clock={clock} compact={compact} />
        ) : null}
      </div>
      <CueFloat cue={cue} at="top" />
      {cue.kind === 'count' ? <CountdownCover n={cue.n} /> : null}
    </div>
  );
  if (qr) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '44px 72px 36px', gap: 72 }}>
        {panels_}
        <QrCard token={qr.token} visible={qr.visible} />
      </div>
    );
  }
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '30px 72px', position: 'relative' }}>
      {panels_}
    </div>
  );
}

function RotateFooter({ panels, index, paused }: { panels: RotationPanel[]; index: number; paused: boolean }) {
  return (
    <Footer>
      <span data-testid="rot-notice" style={{ ...KEEP, color: C.muted }}>
        찬반 결과는 16:30 결과 발표에서 공개합니다
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        {paused ? <span style={{ fontSize: 22, color: C.dim }}>자동 넘김 멈춤</span> : null}
        <span style={{ display: 'flex', gap: 12 }}>
          {panels.map((p, i) => (
            <span key={p} style={{ width: 16, height: 16, borderRadius: 8, background: i === index ? C.text : C.line }} />
          ))}
        </span>
      </span>
    </Footer>
  );
}

// ── 의제 하나 ─────────────────────────────────────────────────────

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * 시연 시계 — 벽시계 대신 쓰는 가상 시각. 타이머가 흐르는 동안은 demoAdvanceMs(1배속 구간 밖은 speed 배)로,
 * 멈춰 있을 때는 1배로 간다. 타이머 함수(toggle · adjust · reset)는 이 시각을 그대로 받는다.
 */
function useDemoClock(enabled: boolean, speed: number, timerRef: React.MutableRefObject<TimerState | null>) {
  const vRef = useRef(Date.now());
  const [now, setNow] = useState(() => vRef.current);
  const read = useCallback(() => vRef.current, []);
  useEffect(() => {
    if (!enabled) return;
    let last = performance.now();
    const id = setInterval(() => {
      const w = performance.now();
      const dt = w - last;
      last = w;
      const t = timerRef.current;
      if (t && t.runningSince != null) {
        const rem = timerRemainingMs(t, vRef.current);
        vRef.current += rem > 0 ? demoAdvanceMs(rem, dt, speed, t.durationMs) : dt;
      } else {
        vRef.current += dt;
      }
      setNow(vRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [enabled, speed, timerRef]);
  return { now, read };
}

/** 마우스를 움직이면 3초 동안 화면 단추를 보인다(무대에서는 숨김). */
function useMouseShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      setShown(true);
      if (t) clearTimeout(t);
      t = setTimeout(() => setShown(false), 3000);
    };
    window.addEventListener('mousemove', on);
    return () => {
      window.removeEventListener('mousemove', on);
      if (t) clearTimeout(t);
    };
  }, []);
  return shown;
}

function Controls({ buttons }: { buttons: Array<{ label: string; key: string; onClick: () => void }> }) {
  const shown = useMouseShown();
  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 16,
        display: 'flex',
        gap: 8,
        opacity: shown ? 0.9 : 0,
        transition: 'opacity .3s',
        pointerEvents: shown ? 'auto' : 'none',
        zIndex: 10,
      }}
    >
      {buttons.map((b) => (
        <button
          key={b.key}
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={b.onClick}
          style={{ font: 'inherit', fontSize: 14, padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.dim}`, background: '#14202B', color: C.muted, cursor: 'pointer' }}
        >
          {b.label} <kbd style={{ opacity: 0.7 }}>{b.key}</kbd>
        </button>
      ))}
    </div>
  );
}

function SingleShow({
  token,
  presentRaw,
  minutes,
  demo = null,
  speed = 1,
}: {
  token: string;
  presentRaw: string | null;
  minutes: number | null;
  /** 시연 의제 — 있으면 DB 를 읽지 않고 가상 수로 돈다(타이머 저장도 하지 않는다). */
  demo?: 1 | 2 | 3 | null;
  speed?: number;
}) {
  const [mode, setMode] = useState<ShowMode>({ view: 'live', video: false });
  const view = mode.view;
  const press = useCallback((k: '1' | '2' | '3' | '4' | 'V') => setMode((m) => showModeKey(m, k)), []);
  const loadLive = useCallback(() => fetchBallotLiveCounts(token), [token]);
  const loadResults = useCallback(() => fetchBallotResults(token), [token]);
  const live = usePoll(demo ? null : loadLive);
  // 결과는 공개(published) 뒤에만 온다. 결과 화면(2·3)에 있을 때만 읽는다 — 공개되는 순간 「집계 확인 중」에서 넘어간다.
  // 실시간 순환(4)은 수만 쓰므로 결과를 읽지 않는다.
  const res = usePoll(!demo && (view === 'detail' || view === 'summary') ? loadResults : null);
  const panels = rotationPanels(1);
  const rot = useRotation(panels.length, view === 'rotate');

  // 영상 — 서버에 올리지 않는다. 표출 노트북에서 고르거나 끌어다 놓은 파일을 objectURL 로 재생.
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const takeFile = useCallback((f: File | null | undefined) => {
    if (!f || !isVideoFile(f)) return;
    setVideoUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setMode({ view: 'live', video: true });
  }, []);
  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }, []);
  const showVideo = mode.video && view === 'live';
  useEffect(() => {
    if (!showVideo) videoRef.current?.pause(); // 결과·실시간 화면 위로 소리가 나지 않게
  }, [showVideo]);
  // 영상 칸을 빗나가 떨어뜨려도 브라우저가 mp4 로 넘어가 무대 화면이 사라지지 않게 창 전체에서 받는다.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      takeFile(e.dataTransfer?.files?.[0]);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [takeFile]);
  const [timer, setTimer] = useState<TimerState | null>(null);
  const timerRef = useRef<TimerState | null>(null);
  timerRef.current = timer;

  // 타이머 — 처음 한 번 정하고, 같은 주소(토큰)로 저장해 두어 F5 · 새로고침에도 이어진다.
  const storeKey = timerStorageKey([token]);
  const items0 = demo ? DEMO_ITEMS[demo] : live.data?.items;
  useEffect(() => {
    if (timer || items0 == null) return;
    const init = initialTimer(minutes != null ? Math.round(minutes * 60) : defaultDurationSec(items0));
    if (demo) {
      setTimer(init); // 시연은 늘 처음부터(저장값을 읽지 않는다)
      return;
    }
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(storeKey);
    } catch {
      saved = null;
    }
    setTimer(restoreTimer(saved, init.durationMs, Date.now()) ?? init);
  }, [items0, demo, minutes, timer, storeKey]);
  useEffect(() => {
    if (!timer || demo) return;
    try {
      window.localStorage.setItem(storeKey, serializeTimer(timer, Date.now()));
    } catch {
      // 저장소가 막힌 브라우저 — 화면 메모리로만 돈다.
    }
  }, [timer, storeKey, demo]);

  const wallNow = useNow(!demo && timer?.runningSince != null);
  const demoClock = useDemoClock(!!demo, speed, timerRef);
  const readClock = demo ? demoClock.read : Date.now;

  const act = useCallback((kind: 'toggle' | 'reset' | 'up' | 'down') => {
    const t = timerRef.current;
    if (!t) return;
    const at = readClock();
    if (kind === 'toggle') setTimer(toggleTimer(t, at));
    else if (kind === 'reset') setTimer(resetTimer(t));
    else setTimer(adjustTimer(t, kind === 'up' ? 60 : -60, at));
  }, [readClock]);
  // 타이머가 보이는 화면(진행 · 영상 · 실시간 순환)에서만 Space · ↑↓ · F5 가 듣는다. 결과 화면(2·3)에서는 무시.
  const timerShown = view === 'live' || view === 'rotate';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (timerShown) act('toggle');
          break;
        case 'F5':
          // 무선 프레젠터의 재생 단추(F5 · Shift+F5) — 새로고침하지 않고 시작/정지. 정말 새로고침은 Ctrl+F5.
          e.preventDefault();
          if (timerShown) act('toggle');
          break;
        case 'KeyR':
          // 실수로 처음으로 돌리지 않게 Shift+R 만.
          if (e.shiftKey) {
            e.preventDefault();
            act('reset');
          }
          break;
        case 'PageDown':
        case 'PageUp':
          // 프레젠터 다음/이전 — 진행 → 실시간 → 영상 사이만. 결과 화면(2·3)에서는 아무것도 하지 않는다.
          e.preventDefault();
          setMode((m) => clickerStep(m, e.code === 'PageDown' ? 1 : -1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (timerShown) act('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (timerShown) act('down');
          break;
        case 'Digit1':
        case 'Numpad1':
          press('1');
          break;
        case 'Digit2':
        case 'Numpad2':
          press('2');
          break;
        case 'Digit3':
        case 'Numpad3':
          press('3');
          break;
        case 'Digit4':
        case 'Numpad4':
          press('4');
          break;
        case 'KeyV':
          e.preventDefault();
          press('V');
          break;
        case 'KeyK':
          if (showVideo) {
            e.preventDefault();
            togglePlay();
          }
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (view === 'rotate') {
            e.preventDefault();
            rot.step(e.code === 'ArrowLeft' ? -1 : 1);
          }
          break;
        case 'KeyP':
          if (view === 'rotate') {
            e.preventDefault();
            rot.togglePause();
          }
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, press, showVideo, togglePlay, view, timerShown, rot.step, rot.togglePause]);

  const nowMs = demo ? demoClock.now : Math.max(wallNow, Date.now());
  // 시연 — 수는 타이머가 흐른 비율로 정한다(처음 시작 전 = 시작 전 · 0명).
  const demoBegun = !!timer && (timer.runningSince != null || timer.pausedRemainingMs !== timer.durationMs);
  const d: BallotLiveCounts | undefined = demo
    ? timer
      ? demoLiveCounts(demo, timer.durationMs > 0 ? 1 - timerRemainingMs(timer, nowMs) / timer.durationMs : 0, demoBegun, parsePresent(presentRaw) ?? DEMO_PRESENT)
      : undefined
    : live.data;
  const present = parsePresent(presentRaw);
  const denom = liveDenominator(present, d?.roster ?? 0);
  const itemsCount = d?.items ?? res.data?.items.length ?? 0;
  const sub = view === 'live' ? '최종 권고안 의결' : view === 'rotate' ? '실시간 투표 현황' : '의제별 의결 결과';
  const resultView = view === 'detail' || view === 'summary';
  // 결과 화면은 결과 읽기만 본다(실시간 수 읽기가 실패해도 막히지 않는다).
  const poll = resultView ? res : live;
  // 남은 시간 알림 — 진행 · 영상 · 실시간 화면이 같은 값을 쓴다(화면을 오가도 중복 · 누락 없음).
  const cue: TimeCue = timer && d ? screenCue(mode, timeCue(timer, nowMs, d.status)) : { kind: 'none' };

  let body: React.ReactNode;
  if (resultView && demo) {
    body = <Centered title="시연 화면에는 결과가 없습니다" sub="1 을 누르면 진행 화면으로 돌아갑니다." />;
  } else if (resultView) {
    if (present == null) {
      body = <Centered title="출석 인원(present=)을 주소에 넣어 주세요" sub="가결 · 부결 판정은 출석 인원이 있어야 표시합니다." />;
    } else if (res.data === undefined) {
      body = res.failing ? <LoadFailed kind={res.errorKind} /> : <Centered title="불러오는 중" />;
    } else if (res.data === null) {
      body = <Centered title="집계 확인 중" sub="결과가 공개되면 이 화면에 바로 나타납니다." />;
    } else if (view === 'detail') {
      body = <DetailView results={res.data} present={present} />;
    } else {
      body = <SummaryView results={res.data} present={present} />;
    }
  } else if (!d) {
    body = live.failing ? <LoadFailed kind={live.errorKind} /> : <Centered title="불러오는 중" />;
  } else if (showVideo) {
    body = null; // 영상 칸은 아래에서 늘 붙어 있다(2·3 에 다녀와도 파일·재생 위치가 남게)
  } else if (view === 'live') {
    body = timer ? <LiveView token={token} live={d} denom={denom} timer={timer} now={nowMs} cue={cue} /> : <Centered title="불러오는 중" />;
  } else {
    const c = timer ? clockDisplay(d.status, timerRemainingMs(timer, nowMs), timer.durationMs) : null;
    body = (
      <RotateView
        agendas={[{ no: agendaNo(d.title), live: d }]}
        denom={denom}
        panels={panels}
        index={rot.index}
        clock={c ? { text: c.text, closed: c.ended } : null}
        cue={cue}
        qr={{ token, visible: showQr(d.status) }}
      />
    );
  }

  return (
    <>
      <Stage>
        <Header
          sub={sub}
          staleSec={poll.data !== undefined ? poll.staleSec : null}
          right={
            <>
              {demo ? <DemoTag /> : null}
              <span>
                권고안 <b className="tr-num" style={{ color: C.text }}>{itemsCount}</b>건
              </span>
            </>
          }
        />
        <Alerts presentMissing={present == null} overflow={!!d && submittedExceedsPresent(present, [d.submitted])} />
        {body}
        {mode.video && d && timer ? (
          <div style={{ display: showVideo ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
            <VideoView
              token={token}
              live={d}
              present={present}
              denom={denom}
              timer={timer}
              now={nowMs}
              videoUrl={videoUrl}
              videoRef={videoRef}
              onTogglePlay={togglePlay}
              onPick={() => fileRef.current?.click()}
              cue={cue}
            />
          </div>
        ) : null}
        {showVideo && d ? null : view === 'rotate' && d ? (
          <RotateFooter panels={panels} index={rot.index} paused={rot.paused} />
        ) : (
        <Footer>
          {present == null ? (
            <span />
          ) : view === 'detail' && res.data ? (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
                <Legend color={C.blue} label="가결" />
                <Legend color={C.orange} label="부결" />
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 4, height: 30, background: '#FFFFFF' }} />
                  가결선 {passThreshold(present)}표 (3분의 2)
                </span>
              </span>
              <span>막대 길이와 숫자는 찬성률 · 참석자 {present}명 기준</span>
            </>
          ) : (
            <>
              <CriteriaLine present={present} />
              <span>국가기후위기대응위원회</span>
            </>
          )}
        </Footer>
        )}
      </Stage>
      <input
        ref={fileRef}
        data-testid="show-video-input"
        type="file"
        accept="video/*,.mp4,.m4v,.webm,.mov"
        tabIndex={-1}
        style={{ display: 'none' }}
        onChange={(e) => {
          takeFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <Controls
        buttons={[
          { label: '진행', key: '1', onClick: () => press('1') },
          { label: '결과 상세', key: '2', onClick: () => press('2') },
          { label: '결과 요약', key: '3', onClick: () => press('3') },
          { label: '실시간', key: '4', onClick: () => press('4') },
          { label: '영상', key: 'V', onClick: () => press('V') },
          { label: '영상 고르기', key: '…', onClick: () => fileRef.current?.click() },
          ...(showVideo ? [{ label: '재생/정지', key: 'K', onClick: togglePlay }] : []),
          ...(view === 'rotate'
            ? [
                { label: '이전 판', key: '←', onClick: () => rot.step(-1) },
                { label: '다음 판', key: '→', onClick: () => rot.step(1) },
                { label: '자동 넘김', key: 'P', onClick: rot.togglePause },
              ]
            : []),
          { label: '이전 화면', key: 'PgUp', onClick: () => setMode((m) => clickerStep(m, -1)) },
          { label: '다음 화면(진행→실시간→영상)', key: 'PgDn', onClick: () => setMode((m) => clickerStep(m, 1)) },
          { label: '시작/정지', key: 'Space·F5', onClick: () => act('toggle') },
          { label: '처음', key: 'Shift+R', onClick: () => act('reset') },
          { label: '+1분', key: '↑', onClick: () => act('up') },
          { label: '−1분', key: '↓', onClick: () => act('down') },
        ]}
      />
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 26, height: 26, borderRadius: 5, background: color }} />
      {label}
    </span>
  );
}

// ── 종합(시안 쪽 9) ────────────────────────────────────────────────

type AgendaBundle = { live: BallotLiveCounts; results: BallotResults | null };

/** 종합 주소의 투표지 하나 — 이번에 못 읽었으면 failed, value 는 마지막으로 읽은 값(없으면 null). */
type Slot<T> = { index: number; value: T | null; failed: boolean };

/**
 * 토큰마다 따로 읽는다 — 하나가 실패해도 나머지는 그린다(실패한 것은 마지막 값을 쓰고 표시).
 * 전부 실패하면 던져서 화면 전체가 「연결 확인 중」으로 간다.
 */
async function settleEach<T>(tokens: string[], fetchOne: (t: string) => Promise<T>, last: { current: Array<T | null> }): Promise<Slot<T>[]> {
  const errors: unknown[] = [];
  const slots = await Promise.all(
    tokens.map(async (t, i): Promise<Slot<T>> => {
      try {
        const v = await withTimeout(fetchOne(t), POLL_TIMEOUT_MS - 1000);
        last.current[i] = v;
        return { index: i, value: v, failed: false };
      } catch (e) {
        errors.push(e);
        return { index: i, value: last.current[i] ?? null, failed: true };
      }
    }),
  );
  if (errors.length === tokens.length) throw errors[0];
  return slots;
}

function OverviewShow({ tokens, presentRaw }: { tokens: string[]; presentRaw: string | null }) {
  const lastBundles = useRef<Array<AgendaBundle | null>>([]);
  const lastLives = useRef<Array<BallotLiveCounts | null>>([]);
  const load = useCallback(
    () =>
      settleEach(
        tokens,
        async (t): Promise<AgendaBundle> => {
          const [live, results] = await Promise.all([fetchBallotLiveCounts(t), fetchBallotResults(t)]);
          return { live, results };
        },
        lastBundles,
      ),
    [tokens],
  );
  // 4 = 실시간 순환(투표율만), 1 · 다시 4 = 종합으로. 실시간 화면에서는 결과(찬반)를 읽지도 않는다.
  const [view, setView] = useState<'overview' | 'rotate'>('overview');
  const loadLive = useCallback(() => settleEach(tokens, fetchBallotLiveCounts, lastLives), [tokens]);
  const livePoll = usePoll(view === 'rotate' ? loadLive : null);
  const panels = rotationPanels(tokens.length);
  const rot = useRotation(panels.length, view === 'rotate');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      switch (e.code) {
        case 'Digit1':
        case 'Numpad1':
          setView('overview');
          break;
        case 'Digit4':
        case 'Numpad4':
          setView((v) => (v === 'rotate' ? 'overview' : 'rotate'));
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (view === 'rotate') {
            e.preventDefault();
            rot.step(e.code === 'ArrowLeft' ? -1 : 1);
          }
          break;
        case 'KeyP':
          if (view === 'rotate') {
            e.preventDefault();
            rot.togglePause();
          }
          break;
        case 'PageDown':
        case 'PageUp':
          // 종합 주소 — 투표 중 화면은 실시간 순환 하나뿐이라 PageDown/PageUp 은 순환 안에서 판만 넘긴다.
          // 종합(결과) 화면에서는 아무것도 하지 않는다(프레젠터로 결과 화면을 오가지 않게).
          e.preventDefault();
          if (view === 'rotate') rot.step(e.code === 'PageUp' ? -1 : 1);
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, rot.step, rot.togglePause]);
  const poll = usePoll(view === 'overview' ? load : null);
  const { data, failing } = poll;
  const present = parsePresent(presentRaw);
  const controls = (
    <Controls
      buttons={[
        { label: '종합', key: '1', onClick: () => setView('overview') },
        { label: '실시간', key: '4', onClick: () => setView((v) => (v === 'rotate' ? 'overview' : 'rotate')) },
        ...(view === 'rotate'
          ? [
              { label: '이전 판', key: '←·PgUp', onClick: () => rot.step(-1) },
              { label: '다음 판', key: '→·PgDn', onClick: () => rot.step(1) },
              { label: '자동 넘김', key: 'P', onClick: rot.togglePause },
            ]
          : []),
      ]}
    />
  );

  if (view === 'rotate') {
    const slots = livePoll.data ?? [];
    const lives = slots
      .flatMap((s) => (s.value ? [s.value] : []))
      .sort((a, b) => (agendaNo(a.title) ?? 9) - (agendaNo(b.title) ?? 9));
    const rDenom = liveDenominator(present, lives[0]?.roster ?? 0);
    const failedNames = slots.filter((s) => s.failed).map((s) => slotName(s.value?.title, s.index));
    return (
      <>
        <Stage>
          <Header
            sub="실시간 투표 현황"
            staleSec={livePoll.data !== undefined ? livePoll.staleSec : null}
            right={
              <span>
                의제 <b className="tr-num" style={{ color: C.text }}>{tokens.length}</b>개
              </span>
            }
          />
          <Alerts presentMissing={present == null} overflow={submittedExceedsPresent(present, lives.map((l) => l.submitted))} />
          {lives.length > 0 ? (
            <RotateView agendas={lives.map((l) => ({ no: agendaNo(l.title), live: l }))} denom={rDenom} panels={panels} index={rot.index} clock={null} />
          ) : livePoll.failing ? (
            <LoadFailed kind={livePoll.errorKind} />
          ) : (
            <Centered title="불러오는 중" />
          )}
          {failedNames.length > 0 ? <FailedNote names={failedNames} /> : null}
          <RotateFooter panels={panels} index={rot.index} paused={rot.paused} />
        </Stage>
        {controls}
      </>
    );
  }

  const slots = data ?? [];
  const bundles = slots
    .flatMap((s) => (s.value ? [s.value] : []))
    .sort((a, b) => (agendaNo(a.live.title) ?? 9) - (agendaNo(b.live.title) ?? 9));
  const failedNames = slots.filter((s) => s.failed).map((s) => slotName(s.value?.live.title, s.index));
  const totalItems = bundles.reduce((s, b) => s + b.live.items, 0);

  return (
    <>
    <Stage>
      <Header
        sub="의결 결과 종합 현황"
        staleSec={data !== undefined ? poll.staleSec : null}
        right={
          <span>
            권고안 <b className="tr-num" style={{ color: C.text }}>{totalItems}</b>건
          </span>
        }
      />
      <Alerts presentMissing={present == null} overflow={false} />
      {present == null ? (
        <Centered title="출석 인원(present=)을 주소에 넣어 주세요" sub="가결 · 부결 판정은 출석 인원이 있어야 표시합니다." />
      ) : bundles.length === 0 ? (
        failing ? <LoadFailed kind={poll.errorKind} /> : <Centered title="불러오는 중" />
      ) : (
        <OverviewBody bundles={bundles} present={present} failedNames={failedNames} />
      )}
      <Footer>
        {present == null ? (
          <span />
        ) : (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
              <Legend color={C.chipBg} label="가결" />
              <Legend color={C.orange} label="부결" />
            </span>
            <span>
              의결 기준: 참석자 {present}명의 3분의 2 이상 찬성 ({passThreshold(present)}표 이상)
            </span>
          </>
        )}
      </Footer>
    </Stage>
    {controls}
    </>
  );
}

/** 못 읽은 투표지 이름 — 제목을 한 번이라도 읽었으면 「의제 N」, 아니면 주소 속 순서. */
function slotName(title: string | null | undefined, index: number): string {
  const no = agendaNo(title);
  return no ? `의제 ${no}` : `${index + 1}번째 투표지`;
}

function FailedNote({ names }: { names: string[] }) {
  return (
    <p data-testid="show-slot-failed" style={{ position: 'absolute', left: 72, bottom: 96, margin: 0, fontSize: 22, fontWeight: 800, color: C.orange, zIndex: 5 }}>
      ● {names.join(' · ')} 불러오기 실패 — 마지막 값을 보여 주는 중이거나 비어 있습니다. 자동으로 다시 시도합니다.
    </p>
  );
}

function OverviewBody({ bundles, present, failedNames }: { bundles: AgendaBundle[]; present: number; failedNames: string[] }) {
  const totalItems = bundles.reduce((s, b) => s + b.live.items, 0);
  const published = bundles.filter((b) => b.results);
  const allDists = published.flatMap((b) => b.results!.items.map((i) => i.dist));
  const out = agendaOutcome(allDists, present);
  const allPublished = bundles.length > 0 && published.length === bundles.length;
  return (
    <>
      {failedNames.length > 0 ? <FailedNote names={failedNames} /> : null}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '26px 72px 0', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 48 }}>
            <OvStat label="전체 권고안" color={C.text} value={totalItems} unit="건" />
            <OvStat label="가결" color={C.blue} value={out.passed} unit="건" />
            <OvStat label="부결" color={C.orange} value={out.failed} unit="건" />
            <OvStat label="평균 찬성률" color="#4A5868" valueColor={C.text} value={`${out.avgPct}%`} unit="" />
          </div>
          {!allPublished ? (
            <p style={{ margin: '6px 0 0', fontSize: 22, color: C.orange }}>
              공개된 의제 {published.length}개 / {bundles.length}개 기준 — 나머지는 집계 확인 중
            </p>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: allPublished ? 30 : 10 }}>
            {bundles.map((b) => (
              <OverviewRow key={b.live.title} bundle={b} present={present} />
            ))}
          </div>
      </div>
    </>
  );
}

function OvStat({ label, color, value, unit, valueColor }: { label: string; color: string; value: React.ReactNode; unit: string; valueColor?: string }) {
  return (
    <div style={{ flex: 1, borderTop: `6px solid ${color}`, paddingTop: 14 }}>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: color === C.text || color === '#4A5868' ? C.muted : color }}>{label}</p>
      <p className="tr-num" style={{ margin: 0, fontSize: 92, fontWeight: 900, lineHeight: 1.05, color: valueColor ?? color }}>
        {value}
        {unit ? <span style={{ fontSize: 34, color: C.muted, fontWeight: 600, marginLeft: 8 }}>{unit}</span> : null}
      </p>
    </div>
  );
}

function OverviewRow({ bundle, present }: { bundle: AgendaBundle; present: number }) {
  const no = agendaNo(bundle.live.title);
  const items = bundle.results ? [...bundle.results.items].sort((a, b) => a.ordinal - b.ordinal) : [];
  const out = agendaOutcome(items.map((i) => i.dist), present);
  return (
    <div data-testid="show-ov-row" style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ width: 300, flex: 'none' }}>
        <p style={{ margin: 0, fontSize: 44, fontWeight: 900, lineHeight: 1.1 }}>의제 {no ?? ''}</p>
        <p style={{ ...KEEP, margin: '6px 0 0', fontSize: 21, color: C.muted, lineHeight: 1.35 }}>
          {no ? AGENDA_FULL_NAMES[no] : bundle.live.title}
        </p>
        <p className="tr-num" style={{ margin: '8px 0 0', fontSize: 26, fontWeight: 800 }}>
          {bundle.results ? `가결 ${out.passed} · 부결 ${out.failed}` : `권고안 ${bundle.live.items}건`}
        </p>
      </div>
      {bundle.results ? (
        <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {items.map((i) => (
            <Chip key={i.id} number={motionNumber(i)} passed={itemOutcome(i.dist, present).passed} w={94} h={66} />
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, height: 142, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px dashed ${C.line}`, borderRadius: 12, fontSize: 36, fontWeight: 800, color: C.muted }}>
          집계 확인 중
        </div>
      )}
    </div>
  );
}

// ── 진입 ──────────────────────────────────────────────────────────

export default function ShowScreen() {
  const [params] = useState(() => parseShowParams(typeof window === 'undefined' ? '' : window.location.search));
  // motion=0 — 저사양 노트북. 순환 화면 등의 애니메이션 · 전환 효과를 끈다(show.astro 의 [data-motion="0"] 규칙).
  useEffect(() => {
    if (!params.motion) document.documentElement.dataset.motion = '0';
  }, [params.motion]);
  // 무선 프레젠터의 재생 단추(F5 · Shift+F5)로 무대 화면이 새로고침되지 않게 — 어느 화면(불러오는 중 · 오류 · 종합)에서든.
  // 정말 새로고침이 필요하면 Ctrl+F5.
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (e.code === 'F5' && !e.ctrlKey && !e.metaKey) e.preventDefault();
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, []);
  if (params.demo) {
    return <SingleShow token={DEMO_TOKEN} presentRaw={params.present ?? String(DEMO_PRESENT)} minutes={params.minutes} demo={params.demo} speed={params.speed} />;
  }
  if (params.tokens.length === 0) {
    return (
      <Stage>
        <Header sub="표출 화면" right={null} />
        <Centered title="투표지 토큰이 없습니다" sub="주소 예: /show?t=<토큰>&present=174  ·  종합: /show?t=<토큰1>,<토큰2>,<토큰3>" />
        <Footer>
          <span style={{ fontSize: 22 }}>
            Space·F5 시작/정지 · Shift+R 처음 · ↑/↓ ±1분 · 1 진행 · 2 결과 상세 · 3 결과 요약 · 4 실시간 · V 영상 · K 재생 · PgDn/PgUp 진행→실시간→영상(결과 화면 제외) · motion=0 움직임 끔
          </span>
          <span />
        </Footer>
      </Stage>
    );
  }
  if (params.tokens.length > 1) return <OverviewShow tokens={params.tokens} presentRaw={params.present} />;
  return <SingleShow token={params.tokens[0]} presentRaw={params.present} minutes={params.minutes} />;
}
