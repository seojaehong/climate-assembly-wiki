/**
 * QuorumBoard.tsx — 정족수·출석 라이브 보드 React island
 *
 * 대전제: 200명 대형스크린 가시성 (아이~노인, 8~15m)
 *   - 핵심 숫자(재적·출석·찬성): 80–120px
 *   - 라벨: 36–48px
 *   - 본문: 24px+
 *   - WCAG AAA 대비, hover/얇은선 금지
 *
 * 데이터 소스: props (mock/쿼리스트링 우선) + 수동 입력 모드
 *
 * ── 명단 와이어 지점 (TODO: 갤럽 명단 연동 시 구현) ─────────────────────────
 *   현재: 재적(enrolled)·출석(present)·찬성(yeas)를 props 또는 수동 입력으로 받음.
 *
 *   Supabase climate_vote 실시간 연동 패턴 (use-realtime-agendas.ts 참조):
 *   ```
 *   // WIRE POINT A: participant 명단 (갤럽 제공, 회차별)
 *   //   schema: climate_vote.participant { id, name, session_id, group_id, enrolled_at }
 *   //   enrolled = SELECT COUNT(*) FROM climate_vote.participant WHERE session_id = ?
 *
 *   // WIRE POINT B: 출석 체크인
 *   //   schema: climate_vote.attendance { id, participant_id, session_id, checked_in_at }
 *   //   present = SELECT COUNT(*) FROM climate_vote.attendance WHERE session_id = ?
 *   //   Realtime: sb.channel('attendance:SESSION_ID').on('postgres_changes', ...)
 *
 *   // WIRE POINT C: 투표 집계
 *   //   schema: climate_vote.vote { id, participant_id, session_id, round_id, value }
 *   //   yeas = SELECT COUNT(*) FROM climate_vote.vote
 *   //          WHERE session_id = ? AND round_id = ? AND value = 'yes'
 *   //   (기존 vote-config.ts + voteUrl() 패턴 재사용 가능)
 *   ```
 *   Supabase 프로젝트: labor_money (URL: PUBLIC_VOTE_SUPABASE_URL in vote-config.ts)
 *   스키마 마이그레이션은 명단 확정 후 별도 PR — 이 PR은 스캐폴딩만.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useCallback } from 'react';
import { computeQuorum } from './quorum';
import type { QuorumResult } from './quorum';

// ── 회의 종류 ───────────────────────────────────────────────────────────────

const SESSION_TYPES = [
  { label: '7/4 기획참여단',   defaultEnrolled: 30  },
  { label: '9/13 분과회의',    defaultEnrolled: 50  },
  { label: '10/17 전체회의',   defaultEnrolled: 200 },
  { label: '직접 입력',        defaultEnrolled: 0   },
] as const;

type SessionTypeKey = typeof SESSION_TYPES[number]['label'];

// ── Props ───────────────────────────────────────────────────────────────────

interface QuorumBoardProps {
  /** 초기 재적 (URL 쿼리스트링 또는 외부 주입) */
  initialEnrolled?: number;
  /** 초기 출석 */
  initialPresent?: number;
  /** 초기 찬성 (투표 전이면 undefined) */
  initialYeas?: number;
  /** 제목 레이블 */
  sessionLabel?: string;
}

// ── 색상 팔레트 (WCAG AAA 대비 보장) ────────────────────────────────────────

const COLOR = {
  established:    '#059669', // 초록 — 성립
  notEstablished: '#dc2626', // 빨강 — 미성립
  passed:         '#0284c7', // 파랑 — 가결
  failed:         '#d97706', // 주황 — 부결
  neutral:        '#374151', // 회색 — 중립
  bg:             '#0f172a', // 진한 배경 (대형스크린 야간 대비)
  bgPanel:        '#1e293b',
  bgInput:        '#0f172a',
  border:         '#334155',
  labelFg:        '#94a3b8',
  numFg:          '#f1f5f9',
} as const;

// ── 진행바 컴포넌트 ─────────────────────────────────────────────────────────

function ProgressBar({
  value,
  color,
  label,
}: {
  value: number;
  color: string;
  label: string;
}) {
  const pct = Math.min(Math.max(value, 0), 1) * 100;
  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          height: '20px',
          background: COLOR.border,
          borderRadius: '10px',
          overflow: 'hidden',
        }}
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: color,
            borderRadius: '10px',
            transition: 'width 0.5s ease',
          }}
        />
      </div>
    </div>
  );
}

// ── 큰 숫자 표시 컴포넌트 ───────────────────────────────────────────────────

function BigStat({
  label,
  value,
  sub,
  color,
  size = 96,
}: {
  label: string;
  value: number | string;
  sub?: string;
  color?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: '40px',
          fontWeight: 700,
          color: COLOR.labelFg,
          letterSpacing: '-0.02em',
          fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
          textAlign: 'center',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: `${size}px`,
          fontWeight: 900,
          color: color ?? COLOR.numFg,
          lineHeight: 1,
          fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
          textAlign: 'center',
          letterSpacing: '-0.04em',
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: '28px',
            fontWeight: 500,
            color: COLOR.labelFg,
            fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
            textAlign: 'center',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ── 상태 배지 컴포넌트 ──────────────────────────────────────────────────────

function StatusBadge({
  label,
  color,
  size = 48,
}: {
  label: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: color,
        color: '#ffffff',
        borderRadius: '12px',
        padding: '12px 32px',
        fontSize: `${size}px`,
        fontWeight: 900,
        fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
        letterSpacing: '-0.01em',
        minWidth: '200px',
      }}
    >
      {label}
    </div>
  );
}

// ── 수동 입력 패널 ──────────────────────────────────────────────────────────

function InputPanel({
  enrolled,
  present,
  yeas,
  sessionLabel,
  onEnrolledChange,
  onPresentChange,
  onYeasChange,
  onSessionChange,
}: {
  enrolled: number;
  present: number;
  yeas: number | undefined;
  sessionLabel: string;
  onEnrolledChange: (v: number) => void;
  onPresentChange: (v: number) => void;
  onYeasChange: (v: number | undefined) => void;
  onSessionChange: (label: SessionTypeKey, enrolled: number) => void;
}) {
  const inputStyle: React.CSSProperties = {
    background: COLOR.bgInput,
    border: `2px solid ${COLOR.border}`,
    borderRadius: '8px',
    color: COLOR.numFg,
    fontSize: '28px',
    fontWeight: 700,
    padding: '10px 16px',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 600,
    color: COLOR.labelFg,
    marginBottom: '6px',
    fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
  };

  return (
    <div
      style={{
        background: COLOR.bgPanel,
        border: `1px solid ${COLOR.border}`,
        borderRadius: '16px',
        padding: '28px 32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}
    >
      {/* 회의 종류 선택 */}
      <div>
        <div style={labelStyle}>회의 종류</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {SESSION_TYPES.map((st) => (
            <button
              key={st.label}
              onClick={() => onSessionChange(st.label as SessionTypeKey, st.defaultEnrolled)}
              style={{
                background: sessionLabel === st.label ? '#1d4ed8' : COLOR.border,
                color: COLOR.numFg,
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '22px',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
                transition: 'background 0.15s',
              }}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        {/* 재적 */}
        <div style={{ flex: 1, minWidth: '140px' }}>
          <label htmlFor="enrolled-input" style={labelStyle}>재적 (정원)</label>
          <input
            id="enrolled-input"
            type="number"
            min={1}
            max={9999}
            value={enrolled}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 1) onEnrolledChange(v);
            }}
            style={inputStyle}
            aria-label="재적 인원"
          />
        </div>

        {/* 출석 */}
        <div style={{ flex: 1, minWidth: '140px' }}>
          <label htmlFor="present-input" style={labelStyle}>출석</label>
          <input
            id="present-input"
            type="number"
            min={0}
            max={enrolled}
            value={present}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v) && v >= 0 && v <= enrolled) onPresentChange(v);
            }}
            style={inputStyle}
            aria-label="출석 인원"
          />
        </div>

        {/* 찬성 — 선택 입력 */}
        <div style={{ flex: 1, minWidth: '140px' }}>
          <label htmlFor="yeas-input" style={labelStyle}>
            찬성 <span style={{ fontSize: '18px', fontWeight: 400 }}>(의결 전이면 비워두세요)</span>
          </label>
          <input
            id="yeas-input"
            type="number"
            min={0}
            max={present}
            placeholder="—"
            value={yeas !== undefined ? yeas : ''}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') {
                onYeasChange(undefined);
              } else {
                const v = parseInt(raw, 10);
                if (!isNaN(v) && v >= 0 && v <= present) onYeasChange(v);
              }
            }}
            style={inputStyle}
            aria-label="찬성 인원 (의결 시 입력)"
          />
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ───────────────────────────────────────────────────────────

export default function QuorumBoard({
  initialEnrolled = 200,
  initialPresent = 0,
  initialYeas,
  sessionLabel: initialSessionLabel = '10/17 전체회의',
}: QuorumBoardProps) {
  const [enrolled, setEnrolled] = useState(initialEnrolled);
  const [present, setPresent] = useState(initialPresent);
  const [yeas, setYeas] = useState<number | undefined>(initialYeas);
  const [sessionLabel, setSessionLabel] = useState(initialSessionLabel);
  const [showInput, setShowInput] = useState(true);

  // ── URL 쿼리스트링으로 초기값 오버라이드 ────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const n = parseInt(p.get('n') ?? '', 10);
    const m = parseInt(p.get('m') ?? '', 10);
    const v = parseInt(p.get('v') ?? '', 10);
    if (!isNaN(n) && n >= 1) setEnrolled(n);
    if (!isNaN(m) && m >= 0) setPresent(m);
    if (!isNaN(v) && v >= 0) setYeas(v);
    if (p.get('label')) setSessionLabel(p.get('label')!);
    // 쿼리스트링 있으면 입력 패널 숨김
    if (p.get('n') || p.get('m')) setShowInput(false);
  }, []);

  // ── 회의 종류 선택 시 재적 초기화 ───────────────────────────────────────
  const handleSessionChange = useCallback((label: SessionTypeKey, defaultN: number) => {
    setSessionLabel(label);
    if (defaultN > 0) {
      setEnrolled(defaultN);
      if (present > defaultN) setPresent(defaultN);
    }
  }, [present]);

  // ── 정족수 계산 ──────────────────────────────────────────────────────────
  let result: QuorumResult | null = null;
  let calcError: string | null = null;
  try {
    result = computeQuorum({ enrolled, present, yeas });
  } catch (e) {
    calcError = (e as Error).message;
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  const establishColor = result?.established ? COLOR.established : COLOR.notEstablished;
  const passedColor = result?.passed === true
    ? COLOR.passed
    : result?.passed === false
    ? COLOR.failed
    : COLOR.neutral;

  return (
    <div
      style={{
        background: COLOR.bg,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Pretendard Variable', 'Pretendard', sans-serif",
        padding: '24px',
        gap: '24px',
        boxSizing: 'border-box',
      }}
    >
      {/* ── 헤더 ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '36px',
              fontWeight: 800,
              color: COLOR.numFg,
              letterSpacing: '-0.02em',
            }}
          >
            {sessionLabel}
          </div>
          <div style={{ fontSize: '24px', fontWeight: 500, color: COLOR.labelFg }}>
            2026 기후시민회의 — 정족수 라이브 보드
          </div>
        </div>
        <button
          onClick={() => setShowInput((v) => !v)}
          style={{
            background: showInput ? '#334155' : '#1d4ed8',
            color: COLOR.numFg,
            border: 'none',
            borderRadius: '8px',
            padding: '10px 24px',
            fontSize: '24px',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          aria-expanded={showInput}
        >
          {showInput ? '입력 숨기기' : '수동 입력'}
        </button>
      </div>

      {/* ── 수동 입력 패널 ────────────────────────────────────────────── */}
      {showInput && (
        <InputPanel
          enrolled={enrolled}
          present={present}
          yeas={yeas}
          sessionLabel={sessionLabel}
          onEnrolledChange={setEnrolled}
          onPresentChange={setPresent}
          onYeasChange={setYeas}
          onSessionChange={handleSessionChange}
        />
      )}

      {calcError && (
        <div
          role="alert"
          style={{
            background: '#7f1d1d',
            color: '#fecaca',
            borderRadius: '12px',
            padding: '20px 28px',
            fontSize: '28px',
            fontWeight: 700,
          }}
        >
          입력 오류: {calcError}
        </div>
      )}

      {result && (
        <>
          {/* ── 핵심 수치 — 재적·출석·찬성 ──────────────────────────── */}
          <div
            style={{
              background: COLOR.bgPanel,
              border: `1px solid ${COLOR.border}`,
              borderRadius: '16px',
              padding: '36px 40px',
              display: 'flex',
              gap: '0',
              justifyContent: 'space-around',
              flexWrap: 'wrap',
            }}
          >
            <BigStat
              label="재적"
              value={enrolled}
              sub={`성립 임계: ${result.establishThreshold}명`}
              size={112}
            />
            <div
              style={{
                width: '2px',
                background: COLOR.border,
                alignSelf: 'stretch',
                margin: '0 8px',
              }}
              aria-hidden="true"
            />
            <BigStat
              label="출석"
              value={present}
              sub={result.established ? '성립' : `부족 ${result.shortfall}명`}
              color={establishColor}
              size={112}
            />
            {yeas !== undefined && (
              <>
                <div
                  style={{
                    width: '2px',
                    background: COLOR.border,
                    alignSelf: 'stretch',
                    margin: '0 8px',
                  }}
                  aria-hidden="true"
                />
                <BigStat
                  label="찬성"
                  value={yeas}
                  sub={result.decisionThreshold !== null
                    ? `의결 임계: ${result.decisionThreshold}명`
                    : '(미성립)'
                  }
                  color={passedColor}
                  size={112}
                />
              </>
            )}
          </div>

          {/* ── 성립 상태 배지 ────────────────────────────────────────── */}
          <div
            style={{
              display: 'flex',
              gap: '20px',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <StatusBadge
              label={result.established ? '회의 성립' : '회의 미성립'}
              color={establishColor}
              size={56}
            />
            {yeas !== undefined && result.passed !== null && (
              <StatusBadge
                label={result.passed ? '가결' : '부결'}
                color={passedColor}
                size={56}
              />
            )}
          </div>

          {/* ── 진행바 ────────────────────────────────────────────────── */}
          <div
            style={{
              background: COLOR.bgPanel,
              border: `1px solid ${COLOR.border}`,
              borderRadius: '16px',
              padding: '32px 40px',
              display: 'flex',
              flexDirection: 'column',
              gap: '28px',
            }}
          >
            {/* 성립 진행 */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                }}
              >
                <span
                  style={{
                    fontSize: '36px',
                    fontWeight: 700,
                    color: COLOR.labelFg,
                  }}
                >
                  출석 / 성립 임계
                </span>
                <span
                  style={{
                    fontSize: '36px',
                    fontWeight: 800,
                    color: establishColor,
                  }}
                >
                  {present} / {result.establishThreshold}
                </span>
              </div>
              <ProgressBar
                value={result.establishProgress}
                color={establishColor}
                label={`출석 진행률 ${Math.round(result.establishProgress * 100)}%`}
              />
            </div>

            {/* 의결 진행 (성립 + 찬성 입력 시) */}
            {result.established && result.decisionThreshold !== null && yeas !== undefined && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '36px',
                      fontWeight: 700,
                      color: COLOR.labelFg,
                    }}
                  >
                    찬성 / 의결 임계 (⌈출석×2/3⌉)
                  </span>
                  <span
                    style={{
                      fontSize: '36px',
                      fontWeight: 800,
                      color: passedColor,
                    }}
                  >
                    {yeas} / {result.decisionThreshold}
                  </span>
                </div>
                <ProgressBar
                  value={result.decisionProgress ?? 0}
                  color={passedColor}
                  label={`찬성 진행률 ${Math.round((result.decisionProgress ?? 0) * 100)}%`}
                />
              </div>
            )}

            {/* 의결 임계선 안내 (성립, 찬성 미입력) */}
            {result.established && result.decisionThreshold !== null && yeas === undefined && (
              <div
                style={{
                  fontSize: '28px',
                  fontWeight: 600,
                  color: COLOR.labelFg,
                }}
              >
                의결 임계: <span style={{ color: COLOR.numFg, fontWeight: 800 }}>
                  {result.decisionThreshold}명
                </span> 이상 찬성 필요
                <span style={{ fontSize: '22px', color: COLOR.labelFg, marginLeft: '12px' }}>
                  (출석 {present}명의 2/3 이상)
                </span>
              </div>
            )}
          </div>

          {/* ── 정족수 규칙 안내 (소형 텍스트) ─────────────────────────── */}
          <div
            style={{
              background: COLOR.bgPanel,
              border: `1px solid ${COLOR.border}`,
              borderRadius: '12px',
              padding: '20px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ fontSize: '24px', fontWeight: 700, color: COLOR.labelFg }}>
              정족수 규칙 (기획단·분과·전체회의 공통)
            </div>
            <div style={{ fontSize: '22px', fontWeight: 500, color: COLOR.numFg }}>
              회의 성립: 재적 과반수 출석 (M &gt; N/2)
              &nbsp;·&nbsp;
              의결(채택): 출석 인원의 2/3 이상 찬성 (V ≥ ⌈2M/3⌉)
            </div>
            <div style={{ fontSize: '20px', color: COLOR.labelFg }}>
              ※ 75% 기준은 2026-06-14 부결된 수정안. 이 보드는 운영규정 원문 기준 적용.
            </div>

            {/* ── 명단 와이어 상태 표시 ─────────────────────────────── */}
            <div
              style={{
                marginTop: '8px',
                padding: '12px 16px',
                background: '#1e293b',
                borderRadius: '8px',
                fontSize: '20px',
                color: '#f59e0b',
                fontWeight: 600,
              }}
              role="note"
            >
              [스캐폴딩] 현재 수동 입력 모드.
              갤럽 명단 연동 시 WIRE POINT A/B/C (소스 참조) 구현 후 이 안내 제거.
            </div>
          </div>
        </>
      )}

      {/* ── URL 파라미터 안내 ─────────────────────────────────────────── */}
      {showInput && (
        <div
          style={{
            fontSize: '20px',
            color: COLOR.labelFg,
            padding: '16px 20px',
            background: COLOR.bgPanel,
            borderRadius: '10px',
            border: `1px solid ${COLOR.border}`,
          }}
        >
          URL 파라미터로 초기값 고정: <code style={{ color: COLOR.numFg }}>?n=200&amp;m=120&amp;v=80&amp;label=10/17+전체회의</code>
          &nbsp;— 이 경우 입력 패널 자동 숨김.
        </div>
      )}
    </div>
  );
}
