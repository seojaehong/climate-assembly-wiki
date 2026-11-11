/**
 * 11/14 최종 의결 「표출 화면」 — 무대 대형 스크린(1920×1080, F11 전체화면).
 *
 * /show?t=<토큰>&present=<참석>&min=<분>      의제 하나: 1 진행 중 · 2 결과 상세 · 3 결과 요약
 * /show?t=<토큰1>,<토큰2>,<토큰3>&present=..  의결 결과 종합(70건 한 화면)
 *
 * 키: Space 시작/일시정지 · R 처음으로 · ↑/↓ ±1분 · 1/2/3 화면 전환.
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
  adjustTimer,
  agendaOutcome,
  clockText,
  defaultDurationSec,
  initialTimer,
  itemOutcome,
  overallTurnout,
  parseShowParams,
  participationPct,
  passThreshold,
  resetTimer,
  resolvePresent,
  rotationPanels,
  showModeKey,
  stepPanel,
  timerRemainingMs,
  toggleTimer,
  turnoutBar,
  turnoutPct,
  type RotationPanel,
  type ShowMode,
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

/** 3초마다 다시 읽는다. 겹쳐 부르지 않고, 실패하면 마지막 값을 그대로 둔다(무대 화면이 비지 않게). */
function usePoll<T>(load: (() => Promise<T>) | null, ms = POLL_MS): { data: T | undefined; failing: boolean } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [failing, setFailing] = useState(false);
  useEffect(() => {
    if (!load) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const v = await load();
        if (!alive) return;
        setData(v);
        setFailing(false);
      } catch {
        if (alive) setFailing(true);
      }
      if (alive) timer = setTimeout(tick, ms);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [load, ms]);
  return { data, failing };
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

function Header({ sub, right, failing }: { sub: string; right: React.ReactNode; failing?: boolean }) {
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
        {failing ? (
          <span data-testid="show-reconnect" style={{ fontSize: 22, color: C.orange }}>
            ● 다시 연결 중
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

function useQrSrc(token: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(`${VOTE_ORIGIN}/b?t=${token}`, { width: 1000, margin: 1 })
      .then(setSrc)
      .catch(() => setSrc(null));
  }, [token]);
  return src;
}

function QrCard({ token }: { token: string }) {
  const src = useQrSrc(token);
  return (
    <div style={{ width: 420, flex: 'none', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ background: '#FFFFFF', borderRadius: 28, padding: 26, width: 420, height: 420, boxSizing: 'border-box' }}>
        {src ? <img data-testid="show-qr" src={src} alt="투표 QR" style={{ width: '100%', height: '100%', display: 'block' }} /> : null}
      </div>
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

function LiveView({
  token,
  live,
  present,
  timer,
  now,
}: {
  token: string;
  live: BallotLiveCounts;
  present: number;
  timer: TimerState;
  now: number;
}) {
  const no = agendaNo(live.title);
  const remaining = timerRemainingMs(timer, now);
  const closed = remaining <= 0 && timer.durationMs > 0;
  const running = timer.runningSince != null && !closed;
  const rate = participationPct(live.submitted, present);
  const timeFrac = timer.durationMs > 0 ? Math.min(1, remaining / timer.durationMs) : 0;
  const statusText = live.status === 'open' ? (closed ? '투표 마감' : '투표 진행 중') : live.status === 'closed' ? '투표 마감' : '결과 공개';
  return (
    <div style={{ flex: 1, display: 'flex', padding: '44px 72px 36px', gap: 72, minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
          <AgendaBadge no={no} />
          <span data-testid="show-status" style={{ fontSize: 40, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 22, height: 22, borderRadius: 11, background: statusText === '투표 진행 중' ? C.blue : C.orange }} />
            {statusText}
          </span>
        </div>
        <h1
          data-testid="show-title"
          style={{ ...CLAMP2, flex: 'none', margin: '26px 0 0', fontSize: 80, fontWeight: 900, lineHeight: 1.2, textAlign: 'center', letterSpacing: '-0.02em' }}
        >
          {agendaFullName(live.title)}
        </h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 64 }}>
          <div style={{ flex: 1, borderTop: `6px solid ${C.text}`, paddingTop: 18 }}>
            <p style={{ margin: 0, fontSize: 36, fontWeight: 700, color: C.muted }}>남은 투표 시간</p>
            <p
              data-testid="show-clock"
              className="tr-num"
              style={{ margin: '4px 0 0', fontSize: 176, fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', color: closed ? C.orange : C.text }}
            >
              {closed ? '마감' : clockText(remaining)}
            </p>
            <p style={{ margin: '14px 0 0', fontSize: 28, color: C.muted }}>
              {running ? '진행 중' : closed ? '투표 시간이 끝났습니다' : remaining === timer.durationMs ? '시작 전' : '일시정지'} · 전체{' '}
              {clockText(timer.durationMs)}
            </p>
          </div>
          <div style={{ flex: 1, borderTop: `6px solid ${C.blue}`, paddingTop: 18 }}>
            <p style={{ margin: 0, fontSize: 36, fontWeight: 700, color: C.blue }}>제출 완료</p>
            <p style={{ margin: '4px 0 0', display: 'flex', alignItems: 'baseline', gap: 18, lineHeight: 1 }}>
              <span data-testid="show-submitted" className="tr-num" style={{ fontSize: 176, fontWeight: 900, color: C.blue, whiteSpace: 'nowrap', flex: 'none' }}>
                {live.submitted}
              </span>
              <span className="tr-num" style={{ fontSize: 44, color: C.muted, whiteSpace: 'nowrap' }}>
                / 참석 {present}명
              </span>
            </p>
            <p style={{ margin: '14px 0 0', fontSize: 28, color: C.muted, display: 'flex', gap: 28 }}>
              <span>
                투표 시작{' '}
                <b data-testid="show-started" className="tr-num" style={{ color: C.text, fontSize: 40 }}>
                  {live.started}
                </b>
                명
              </span>
              <span>
                참여율{' '}
                <b data-testid="show-rate" className="tr-num" style={{ color: C.text, fontSize: 40 }}>
                  {rate}%
                </b>
              </span>
            </p>
          </div>
        </div>
        <div style={{ marginTop: 30, height: 22, borderRadius: 11, background: C.line, overflow: 'hidden' }}>
          <div style={{ width: `${timeFrac * 100}%`, height: '100%', background: closed ? C.orange : C.text, borderRadius: 11 }} />
        </div>
      </div>
      <QrCard token={token} />
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
  timer,
  now,
  videoUrl,
  videoRef,
  onTogglePlay,
  onPick,
}: {
  token: string;
  live: BallotLiveCounts;
  present: number;
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
  const closed = remaining <= 0 && timer.durationMs > 0;
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
        </div>
      </div>
      <aside data-testid="show-video-strip" style={{ width: STRIP_W, flex: 'none', display: 'flex', flexDirection: 'column', padding: '22px 0 20px', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {no ? (
            <span style={{ background: C.blue, color: '#0B1A2A', fontSize: 30, fontWeight: 800, padding: '4px 18px', borderRadius: 8, lineHeight: 1.2, whiteSpace: 'nowrap' }}>의제 {no}</span>
          ) : null}
          <span data-testid="show-status" style={{ fontSize: 26, fontWeight: 800, color: closed ? C.orange : C.text }}>
            {closed ? '투표 마감' : '투표 진행 중'}
          </span>
        </div>
        <p style={{ ...KEEP, flex: 'none', margin: '10px 0 0', fontSize: 24, fontWeight: 700, lineHeight: 1.3 }}>{no ? AGENDA_NAMES[no] : live.title}</p>
        <div style={{ flex: 'none', marginTop: 18, borderTop: `4px solid ${C.text}`, paddingTop: 8 }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.muted }}>남은 투표 시간</p>
          <p data-testid="show-clock" className="tr-num" style={{ margin: 0, fontSize: 84, fontWeight: 900, lineHeight: 1.05, color: closed ? C.orange : C.text }}>
            {closed ? '마감' : clockText(remaining)}
          </p>
        </div>
        <div style={{ flex: 'none', marginTop: 14, borderTop: `4px solid ${C.blue}`, paddingTop: 8 }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.blue }}>제출 완료</p>
          <p style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 12, lineHeight: 1.05 }}>
            <span data-testid="show-submitted" className="tr-num" style={{ fontSize: 80, fontWeight: 900, color: C.blue }}>
              {live.submitted}
            </span>
            <span className="tr-num" style={{ fontSize: 30, color: C.muted, whiteSpace: 'nowrap' }}>/ 참석 {present}명</span>
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
        <div style={{ flex: 'none', width: VIDEO_QR, height: VIDEO_QR, background: '#FFFFFF', borderRadius: 18, padding: 14, boxSizing: 'border-box', alignSelf: 'center' }}>
          {qr ? <img data-testid="show-qr" src={qr} alt="투표 QR" style={{ width: '100%', height: '100%', display: 'block' }} /> : null}
        </div>
        <p style={{ ...KEEP, flex: 'none', margin: '10px 0 0', fontSize: 22, fontWeight: 700, textAlign: 'center' }}>휴대폰으로 QR을 비춰 투표해 주세요</p>
        <p className="tr-num" style={{ ...KEEP, flex: 'none', margin: '8px 0 0', fontSize: 20, color: C.muted, textAlign: 'center' }}>
          가결 기준 참석자 3분의 2 이상 찬성 ({passThreshold(present)}표 이상)
        </p>
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

function OverallPanel({ agendas, present }: { agendas: LiveAgenda[]; present: number }) {
  const o = overallTurnout(
    agendas.map((a) => a.live),
    present,
  );
  const size = 600;
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 110 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <Ring pct={o.pct} size={size} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span data-testid="rot-overall-pct" className="tr-num" style={{ fontSize: 190, fontWeight: 900, lineHeight: 1 }}>
            {o.pct}
            <span style={{ fontSize: 80, color: C.muted }}>%</span>
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 44, minWidth: 560 }}>
        <p style={{ margin: 0, fontSize: 64, fontWeight: 900 }}>전체 투표율</p>
        <div style={{ borderTop: `6px solid ${C.blue}`, paddingTop: 14 }}>
          <p style={{ margin: 0, fontSize: 32, fontWeight: 700, color: C.blue }}>제출 완료</p>
          <p className="tr-num" style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 16, lineHeight: 1.05 }}>
            <span style={{ fontSize: 120, fontWeight: 900, color: C.blue }}>{o.submitted}</span>
            <span style={{ fontSize: 36, color: C.muted, whiteSpace: 'nowrap' }}>
              / {agendas.length > 1 ? `참석 ${present}명 × 의제 ${agendas.length}개` : `참석 ${present}명`}
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

function AgendasPanel({ agendas, present }: { agendas: LiveAgenda[]; present: number }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 30, padding: '0 20px' }}>
      <p style={{ margin: 0, fontSize: 52, fontWeight: 900 }}>의제별 투표율</p>
      {agendas.map((a) => {
        const b = turnoutBar(a.live.submitted, a.live.started, present);
        const pct = turnoutPct(a.live.submitted, present);
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
                제출 완료 <b style={{ color: C.text }}>{a.live.submitted}</b> / 참석 {present}명
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

function SinglePanel({ agenda, present, clock }: { agenda: LiveAgenda; present: number; clock: { text: string; closed: boolean } | null }) {
  const pct = turnoutPct(agenda.live.submitted, present);
  const cell = (label: string, color: string, value: React.ReactNode, unit: string, testid?: string) => (
    <div style={{ flex: 1, borderTop: `8px solid ${color}`, paddingTop: 18 }}>
      <p style={{ margin: 0, fontSize: 38, fontWeight: 700, color: color === C.text ? C.muted : color }}>{label}</p>
      <p className="tr-num" style={{ margin: '6px 0 0', lineHeight: 1, whiteSpace: 'nowrap' }}>
        <span data-testid={testid} style={{ fontSize: 170, fontWeight: 900, color: color === C.text ? C.text : color }}>
          {value}
        </span>
        {unit ? <span style={{ fontSize: 48, color: C.muted, marginLeft: 10 }}>{unit}</span> : null}
      </p>
    </div>
  );
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 70, padding: '0 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <AgendaBadge no={agenda.no} />
        <span style={{ ...KEEP, fontSize: 52, fontWeight: 900 }}>{agenda.no ? AGENDA_NAMES[agenda.no] : agenda.live.title}</span>
      </div>
      <div style={{ display: 'flex', gap: 56 }}>
        {cell('제출 완료', C.blue, agenda.live.submitted, `/ ${present}명`, 'rot-single-submitted')}
        {cell('투표율', C.blue, pct, '%')}
      </div>
      <div style={{ display: 'flex', gap: 56 }}>
        {cell('투표 시작', C.orange, agenda.live.started, '명')}
        {cell('지금 투표 중', C.text, agenda.live.in_progress, '명')}
        {clock ? cell('남은 투표 시간', clock.closed ? C.orange : C.text, clock.closed ? '마감' : clock.text, '') : null}
      </div>
    </div>
  );
}

function RotateView({
  agendas,
  present,
  panels,
  index,
  clock,
}: {
  agendas: LiveAgenda[];
  present: number;
  panels: RotationPanel[];
  index: number;
  clock: { text: string; closed: boolean } | null;
}) {
  const panel = panels[index] ?? 'overall';
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', padding: '30px 72px', position: 'relative' }}>
      <div key={`${panel}-${index}`} data-testid={`rot-panel-${panel}`} className="show-panel-in" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {panel === 'overall' ? (
          <OverallPanel agendas={agendas} present={present} />
        ) : panel === 'agendas' ? (
          <AgendasPanel agendas={agendas} present={present} />
        ) : agendas[0] ? (
          <SinglePanel agenda={agendas[0]} present={present} clock={clock} />
        ) : null}
      </div>
    </div>
  );
}

function RotateFooter({ panels, index, paused, failing }: { panels: RotationPanel[]; index: number; paused: boolean; failing: boolean }) {
  return (
    <Footer>
      <span data-testid="rot-notice" style={{ ...KEEP, color: C.muted }}>
        찬반 결과는 16:30 결과 발표에서 공개합니다
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        {failing ? (
          <span data-testid="rot-reconnect" style={{ fontSize: 22, color: C.orange }}>
            ● 연결 확인 중
          </span>
        ) : null}
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

function SingleShow({ token, presentRaw, minutes }: { token: string; presentRaw: string | null; minutes: number | null }) {
  const [mode, setMode] = useState<ShowMode>({ view: 'live', video: false });
  const view = mode.view;
  const press = useCallback((k: '1' | '2' | '3' | '4' | 'V') => setMode((m) => showModeKey(m, k)), []);
  const loadLive = useCallback(() => fetchBallotLiveCounts(token), [token]);
  const loadResults = useCallback(() => fetchBallotResults(token), [token]);
  const live = usePoll(loadLive);
  // 결과는 공개(published) 뒤에만 온다. 결과 화면(2·3)에 있을 때만 읽는다 — 공개되는 순간 「집계 확인 중」에서 넘어간다.
  // 실시간 순환(4)은 수만 쓰므로 결과를 읽지 않는다.
  const res = usePoll(view === 'detail' || view === 'summary' ? loadResults : null);
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

  useEffect(() => {
    if (timer || !live.data) return;
    setTimer(initialTimer(minutes != null ? Math.round(minutes * 60) : defaultDurationSec(live.data.items)));
  }, [live.data, minutes, timer]);

  const now = useNow(timer?.runningSince != null);

  const act = useCallback((kind: 'toggle' | 'reset' | 'up' | 'down') => {
    const t = timerRef.current;
    if (!t) return;
    const at = Date.now();
    if (kind === 'toggle') setTimer(toggleTimer(t, at));
    else if (kind === 'reset') setTimer(resetTimer(t));
    else setTimer(adjustTimer(t, kind === 'up' ? 60 : -60, at));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          act('toggle');
          break;
        case 'KeyR':
          e.preventDefault();
          act('reset');
          break;
        case 'ArrowUp':
          e.preventDefault();
          act('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          act('down');
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
  }, [act, press, showVideo, togglePlay, view, rot.step, rot.togglePause]);

  const d = live.data;
  const present = resolvePresent(presentRaw, d?.roster ?? 0);
  const itemsCount = d?.items ?? res.data?.items.length ?? 0;
  const sub = view === 'live' ? '최종 권고안 의결' : view === 'rotate' ? '실시간 투표 현황' : '의제별 의결 결과';
  const nowMs = Math.max(now, Date.now());

  let body: React.ReactNode;
  if (!d) {
    body = live.failing ? <Centered title="투표지를 찾을 수 없습니다" sub="링크의 토큰(t=)을 확인해 주세요." /> : <Centered title="불러오는 중" />;
  } else if (showVideo) {
    body = null; // 영상 칸은 아래에서 늘 붙어 있다(2·3 에 다녀와도 파일·재생 위치가 남게)
  } else if (view === 'live') {
    body = timer ? <LiveView token={token} live={d} present={present} timer={timer} now={nowMs} /> : <Centered title="불러오는 중" />;
  } else if (view === 'rotate') {
    const rem = timer ? timerRemainingMs(timer, nowMs) : 0;
    body = (
      <RotateView
        agendas={[{ no: agendaNo(d.title), live: d }]}
        present={present}
        panels={panels}
        index={rot.index}
        clock={timer ? { text: clockText(rem), closed: rem <= 0 && timer.durationMs > 0 } : null}
      />
    );
  } else if (!res.data) {
    body = <Centered title="집계 확인 중" sub="결과가 공개되면 이 화면에 바로 나타납니다." />;
  } else if (view === 'detail') {
    body = <DetailView results={res.data} present={present} />;
  } else {
    body = <SummaryView results={res.data} present={present} />;
  }

  return (
    <>
      <Stage>
        <Header
          sub={sub}
          failing={live.failing && !!d}
          right={
            <span>
              권고안 <b className="tr-num" style={{ color: C.text }}>{itemsCount}</b>건
            </span>
          }
        />
        {body}
        {mode.video && d && timer ? (
          <div style={{ display: showVideo ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
            <VideoView
              token={token}
              live={d}
              present={present}
              timer={timer}
              now={nowMs}
              videoUrl={videoUrl}
              videoRef={videoRef}
              onTogglePlay={togglePlay}
              onPick={() => fileRef.current?.click()}
            />
          </div>
        ) : null}
        {showVideo && d ? null : view === 'rotate' && d ? (
          <RotateFooter panels={panels} index={rot.index} paused={rot.paused} failing={live.failing} />
        ) : (
        <Footer>
          {view === 'detail' && res.data ? (
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
          { label: '시작/정지', key: 'Space', onClick: () => act('toggle') },
          { label: '처음', key: 'R', onClick: () => act('reset') },
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

function OverviewShow({ tokens, presentRaw }: { tokens: string[]; presentRaw: string | null }) {
  const load = useCallback(
    () =>
      Promise.all(
        tokens.map(async (t): Promise<AgendaBundle> => {
          const [live, results] = await Promise.all([fetchBallotLiveCounts(t), fetchBallotResults(t)]);
          return { live, results };
        }),
      ),
    [tokens],
  );
  // 4 = 실시간 순환(투표율만), 1 · 다시 4 = 종합으로. 실시간 화면에서는 결과(찬반)를 읽지도 않는다.
  const [view, setView] = useState<'overview' | 'rotate'>('overview');
  const loadLive = useCallback(() => Promise.all(tokens.map((t) => fetchBallotLiveCounts(t))), [tokens]);
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
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, rot.step, rot.togglePause]);
  const { data, failing } = usePoll(view === 'overview' ? load : null);
  const controls = (
    <Controls
      buttons={[
        { label: '종합', key: '1', onClick: () => setView('overview') },
        { label: '실시간', key: '4', onClick: () => setView((v) => (v === 'rotate' ? 'overview' : 'rotate')) },
        ...(view === 'rotate'
          ? [
              { label: '이전 판', key: '←', onClick: () => rot.step(-1) },
              { label: '다음 판', key: '→', onClick: () => rot.step(1) },
              { label: '자동 넘김', key: 'P', onClick: rot.togglePause },
            ]
          : []),
      ]}
    />
  );

  if (view === 'rotate') {
    const lives = (livePoll.data ?? []).slice().sort((a, b) => (agendaNo(a.title) ?? 9) - (agendaNo(b.title) ?? 9));
    const rPresent = resolvePresent(presentRaw, lives[0]?.roster ?? 0);
    return (
      <>
        <Stage>
          <Header
            sub="실시간 투표 현황"
            right={
              <span>
                의제 <b className="tr-num" style={{ color: C.text }}>{tokens.length}</b>개
              </span>
            }
          />
          {livePoll.data ? (
            <RotateView agendas={lives.map((l) => ({ no: agendaNo(l.title), live: l }))} present={rPresent} panels={panels} index={rot.index} clock={null} />
          ) : (
            <Centered title={livePoll.failing ? '투표지를 찾을 수 없습니다' : '불러오는 중'} />
          )}
          <RotateFooter panels={panels} index={rot.index} paused={rot.paused} failing={livePoll.failing && !!livePoll.data} />
        </Stage>
        {controls}
      </>
    );
  }

  const bundles = (data ?? []).slice().sort((a, b) => (agendaNo(a.live.title) ?? 9) - (agendaNo(b.live.title) ?? 9));
  const roster = bundles[0]?.live.roster ?? 0;
  const present = resolvePresent(presentRaw, roster);
  const totalItems = bundles.reduce((s, b) => s + b.live.items, 0);
  const published = bundles.filter((b) => b.results);
  const allDists = published.flatMap((b) => b.results!.items.map((i) => i.dist));
  const out = agendaOutcome(allDists, present);
  const allPublished = bundles.length > 0 && published.length === bundles.length;

  return (
    <>
    <Stage>
      <Header
        sub="의결 결과 종합 현황"
        failing={failing && !!data}
        right={
          <span>
            권고안 <b className="tr-num" style={{ color: C.text }}>{totalItems}</b>건
          </span>
        }
      />
      {!data ? (
        <Centered title={failing ? '투표지를 찾을 수 없습니다' : '불러오는 중'} />
      ) : (
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
      )}
      <Footer>
        <span style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
          <Legend color={C.chipBg} label="가결" />
          <Legend color={C.orange} label="부결" />
        </span>
        <span>
          의결 기준: 참석자 {present}명의 3분의 2 이상 찬성 ({passThreshold(present)}표 이상)
        </span>
      </Footer>
    </Stage>
    {controls}
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
  if (params.tokens.length === 0) {
    return (
      <Stage>
        <Header sub="표출 화면" right={null} />
        <Centered title="투표지 토큰이 없습니다" sub="주소 예: /show?t=<토큰>&present=174  ·  종합: /show?t=<토큰1>,<토큰2>,<토큰3>" />
        <Footer>
          <span>Space 시작/정지 · R 처음 · ↑/↓ ±1분 · 1 진행 · 2 결과 상세 · 3 결과 요약 · 4 실시간 · V 영상 · K 재생</span>
          <span />
        </Footer>
      </Stage>
    );
  }
  if (params.tokens.length > 1) return <OverviewShow tokens={params.tokens} presentRaw={params.present} />;
  return <SingleShow token={params.tokens[0]} presentRaw={params.present} minutes={params.minutes} />;
}
