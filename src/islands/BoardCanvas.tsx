/**
 * BoardCanvas.tsx — drag-drop state machine for moderator board
 * React island (client:load) that manages:
 *   - Sheet CSV polling (10s)
 *   - Zone assignment (domain map → override_양단)
 *   - Drag-and-drop (control mode only)
 *   - Apps Script writeback
 *   - Present mode (f key)
 *   - Toast notifications
 *   - Demo mode (?demo=1) — static JSON, localStorage mock writeback
 *
 * spec §2, §3.4, §4, §6, §7
 */

import { useState, useEffect, useCallback, useRef } from 'react';
// NOTE: demoData fetched at runtime (rolldown JSON import rejects with "Missing field moduleType")
// JSON file is in public/ via vite static asset hosting — see fetch in demo init effect.

// ── Types ──────────────────────────────────────────────────────────────────

type Zone = '감축' | '미분류' | '적응';
type Status = '대기' | '선정' | '발표중' | '발표완료';

interface AgendaRow {
  id: number;
  row: number; // 1-indexed sheet row (header = 1, data from 2)
  group: string;
  speaker: string;
  content: string;
  status: Status;
  domain: string;
  keywords: string;
  override_yangdan: string; // raw column 10 value
  displayZone: Zone;
}

interface DragState {
  cardId: number;
  originalZone: Zone;
  startX: number;
  startY: number;
}

// ── Demo row type (matches board-demo-data.json schema) ───────────────────

interface DemoRawRow {
  id: number;
  date: string;
  group: string;
  speaker: string;
  content: string;
  status: string;
  domain: string;
  ts: string;
  keywords: string;
  override_yangdan?: string;
  'override_양단'?: string;
}

// ── Props ──────────────────────────────────────────────────────────────────

interface BoardCanvasProps {
  sheetCsvUrl: string;
  writebackUrl: string;
  domainMap: Record<string, Zone>;
  isControlMode: boolean;
}

// ── CSV parser (same state machine as existing board.astro) ────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let col = '', row: string[] = [], inQuote = false;
  const flush = () => { row.push(col); col = ''; };
  const pushRow = () => { if (row.length > 0) { rows.push(row); row = []; } };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inQuote) {
      if (ch === '"' && next === '"') { col += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { col += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { flush(); }
      else if (ch === '\r' && next === '\n') { flush(); pushRow(); i++; }
      else if (ch === '\n' || ch === '\r') { flush(); pushRow(); }
      else { col += ch; }
    }
  }
  if (col || row.length > 0) { flush(); pushRow(); }
  return rows;
}

const COL_MAP: Record<string, string> = {
  '순번': 'id',
  '일자': 'date',
  '조': 'group',
  '발언자': 'speaker',
  '안건': 'content',
  '상태': 'status',
  '도메인': 'domain',
  '타임스탬프': 'ts',
  '키워드': 'keywords',
  'override_양단': 'override_yangdan',
};

function csvToRows(text: string, domainMap: Record<string, Zone>): AgendaRow[] {
  const parsed = parseCSV(text.trim());
  if (parsed.length < 2) return [];
  const headers = parsed[0].map(h => h.trim());
  const result: AgendaRow[] = [];
  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    if (cells.every(c => !c.trim())) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      const key = COL_MAP[h] || h;
      obj[key] = (cells[i] || '').trim();
    });
    const rowNum = r + 1; // header is row 1, so data row r (0-indexed from slice) = sheet row r+1
    const id = parseInt(obj.id, 10) || r;
    const group = obj.group ? obj.group.replace(/조$/u, '').trim() : '';
    const override = obj.override_yangdan || '';
    const rawDomain = obj.domain || '';
    const displayZone: Zone = (override as Zone) || domainMap[rawDomain] || '미분류';

    result.push({
      id,
      row: rowNum,
      group,
      speaker: obj.speaker || '',
      content: obj.content || '',
      status: (obj.status as Status) || '대기',
      domain: rawDomain,
      keywords: obj.keywords || '',
      override_yangdan: override,
      displayZone,
    });
  }
  return result;
}

// ── Demo JSON → AgendaRow[] (no CSV round-trip) ───────────────────────────

function demoToRows(
  rawRows: DemoRawRow[],
  domainMap: Record<string, Zone>,
  savedOverrides: Record<number, Zone>,
): AgendaRow[] {
  return rawRows.map((raw, idx) => {
    const group = raw.group.replace(/조$/u, '').trim();
    const rawOverride = raw['override_양단'] || raw.override_yangdan || '';
    // localStorage wins over JSON default
    const finalOverride: Zone | '' = savedOverrides[raw.id]
      ? savedOverrides[raw.id]
      : (rawOverride as Zone | '');
    const displayZone: Zone = finalOverride || domainMap[raw.domain] || '미분류';
    return {
      id: raw.id,
      row: idx + 2, // simulate sheet row numbers
      group,
      speaker: raw.speaker,
      content: raw.content,
      status: (raw.status as Status) || '대기',
      domain: raw.domain,
      keywords: raw.keywords,
      override_yangdan: finalOverride,
      displayZone,
    };
  });
}

// ── Deterministic rotation ±1.5° ──────────────────────────────────────────

function cardRotation(id: number): number {
  const hash = ((id * 2654435761) >>> 0) % 1000;
  return parseFloat(((hash / 1000) * 3 - 1.5).toFixed(2));
}

// ── Zone colors ───────────────────────────────────────────────────────────

const ZONE_STRIP: Record<Zone, string> = {
  '감축': '#d97706',
  '미분류': 'transparent',
  '적응': '#059669',
};

const ZONE_BG: Record<Zone, string> = {
  '감축': '#fffbeb',
  '미분류': '#f5f5f4',
  '적응': '#ecfdf5',
};

const ZONE_HEADER_COLOR: Record<Zone, string> = {
  '감축': '#f59e0b',
  '미분류': '#a8a29e',
  '적응': '#10b981',
};

// ── Toast helper ─────────────────────────────────────────────────────────

function showToast(text: string, isError = false) {
  if (typeof window !== 'undefined' && (window as any).__boardToast) {
    (window as any).__boardToast({ text, isError });
  }
}

// ── Demo localStorage helpers ─────────────────────────────────────────────

const DEMO_LS_KEY = 'board-demo-state';

function loadDemoOverrides(): Record<number, Zone> {
  try {
    const raw = localStorage.getItem(DEMO_LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDemoOverride(cardId: number, zone: Zone): void {
  try {
    const current = loadDemoOverrides();
    current[cardId] = zone;
    localStorage.setItem(DEMO_LS_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
}

// ── Main Component ────────────────────────────────────────────────────────

export default function BoardCanvas({
  sheetCsvUrl,
  writebackUrl,
  domainMap,
  isControlMode,
}: BoardCanvasProps) {
  // ── Demo mode detection (URL ?demo=1) ────────────────────────────────
  // NOTE: must be state, not derived const. SSR produces false; hydration
  // then sets true via effect. Derived const would never re-trigger effects.
  const [isDemoMode, setIsDemoMode] = useState(false);

  const [cards, setCards] = useState<AgendaRow[]>([]);
  const [zoneCounts, setZoneCounts] = useState<Record<Zone, number>>({ '감축': 0, '미분류': 0, '적응': 0 });
  const [selectedCount, setSelectedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [sheetStatus, setSheetStatus] = useState<'connecting' | 'live' | 'error' | 'offline'>('connecting');
  const [statusText, setStatusText] = useState('연결 중…');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isPresentMode, setIsPresentMode] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverZone, setDragOverZone] = useState<Zone | null>(null);
  const [isWriting, setIsWriting] = useState(false);
  const [hubToken, setHubToken] = useState<string>('');
  // Runtime control mode (overridden by URL ?mode=control on client)
  const [runtimeControlMode, setRuntimeControlMode] = useState(isControlMode);

  // Demo guide toggle
  const [showDemoGuide, setShowDemoGuide] = useState(false);

  // Modal: zone picker for card click in control mode
  const [modalCard, setModalCard] = useState<AgendaRow | null>(null);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  // ── Helper: recompute counts from card list ───────────────────────────
  const recomputeCounts = useCallback((parsed: AgendaRow[]) => {
    const counts: Record<Zone, number> = { '감축': 0, '미분류': 0, '적응': 0 };
    parsed.forEach(c => { counts[c.displayZone] = (counts[c.displayZone] || 0) + 1; });
    setZoneCounts(counts);
    const sel = parsed.filter(c => c.status === '선정' || c.status === '발표중').length;
    setSelectedCount(sel);
    setTotalCount(parsed.length);
  }, []);

  // ── Demo mode init (fetch JSON at runtime) ────────────────────────────
  useEffect(() => {
    if (!isDemoMode) return;
    let cancelled = false;
    setStatusText('DEMO · 로딩 중…');
    fetch('/data/board-demo-data.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { rows: DemoRawRow[] }) => {
        if (cancelled) return;
        const overrides = loadDemoOverrides();
        const parsed = demoToRows(data.rows || [], domainMap, overrides);
        setCards(parsed);
        recomputeCounts(parsed);
        setSheetStatus('live');
        setStatusText('DEMO · 로컬 데이터');
      })
      .catch(err => {
        if (cancelled) return;
        setSheetStatus('error');
        setStatusText(`DEMO 로드 실패: ${(err as Error).message}`);
      });
    return () => { cancelled = true; };
  }, [isDemoMode, domainMap, recomputeCounts]);

  // ── Detect runtime URL params (demo + control mode) ──────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') {
      setIsDemoMode(true);
    }
    if (params.get('mode') === 'control') {
      setRuntimeControlMode(true);
    }
    // Listen for dispatch from board.astro inline script
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.isControl) setRuntimeControlMode(true);
    };
    window.addEventListener('board:set-control-mode', handler);
    return () => window.removeEventListener('board:set-control-mode', handler);
  }, []);

  // ── Hub token init (control mode, non-demo only) ─────────────────────
  useEffect(() => {
    if (!runtimeControlMode) return;
    if (isDemoMode) return; // demo: no token prompt needed
    const stored = localStorage.getItem('hub-token');
    if (stored) {
      setHubToken(stored);
    } else {
      const entered = window.prompt('본부 토큰을 입력하세요 (hub-token):');
      if (entered) {
        localStorage.setItem('hub-token', entered);
        setHubToken(entered);
      }
    }
  }, [runtimeControlMode, isDemoMode]);

  // ── CSV fetch & parse ─────────────────────────────────────────────────
  const fetchAndUpdate = useCallback(async () => {
    if (isDemoMode) return; // demo: no network fetch
    if (!sheetCsvUrl) {
      setSheetStatus('error');
      setStatusText('⚠ URL 미설정');
      return;
    }
    try {
      const text = await fetch(sheetCsvUrl).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      });
      const parsed = csvToRows(text, domainMap);
      setCards(parsed);
      recomputeCounts(parsed);

      const now = new Date();
      setSheetStatus('live');
      setStatusText(`LIVE · ${now.toLocaleTimeString('ko-KR', { hour12: false })}`);
    } catch (err) {
      setSheetStatus('error');
      setStatusText(`오류: ${(err as Error).message}`);
    }
  }, [isDemoMode, sheetCsvUrl, domainMap, recomputeCounts]);

  // ── Polling ───────────────────────────────────────────────────────────
  const startPoll = useCallback(() => {
    if (isDemoMode) return; // demo: no polling
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(() => {
      if (autoRefreshRef.current) fetchAndUpdate();
    }, 10000);
  }, [isDemoMode, fetchAndUpdate]);

  useEffect(() => {
    if (isDemoMode) return;
    fetchAndUpdate().then(() => startPoll());
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, [isDemoMode, fetchAndUpdate, startPoll]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'f' || e.key === 'F') {
        setIsPresentMode(prev => {
          const next = !prev;
          document.body.classList.toggle('present-mode', next);
          return next;
        });
      }
      if (e.key === 'Escape') {
        setIsPresentMode(false);
        document.body.classList.remove('present-mode');
        setModalCard(null);
      }
      if (e.key === 'r' || e.key === 'R') {
        if (!isDemoMode) fetchAndUpdate();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDemoMode, fetchAndUpdate]);

  // ── Writeback to Apps Script (or demo mock) ───────────────────────────
  const doWriteback = useCallback(async (
    cardRow: number,
    cardId: number,
    newZone: Zone,
    group: string,
    previousZone: Zone,
  ) => {
    // ── DEMO mock path ────────────────────────────────────────────────
    if (isDemoMode) {
      setIsWriting(true);
      await new Promise(res => setTimeout(res, 200)); // simulate network
      saveDemoOverride(cardId, newZone);
      setIsWriting(false);
      showToast(`[데모] ${group}조 의제 #${cardId} → ${newZone}`);
      return true;
    }

    // ── Real path ─────────────────────────────────────────────────────
    if (!writebackUrl) {
      showToast('환경변수 PUBLIC_BOARD_WRITEBACK_URL 미설정 — 드래그 불가', true);
      return false;
    }
    if (!hubToken) {
      showToast('본부 토큰 없음 — 페이지 새로고침 후 토큰 입력', true);
      return false;
    }

    setIsWriting(true);

    const attempt = async (): Promise<boolean> => {
      try {
        const res = await fetch(writebackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            row: cardRow,
            'override_양단': newZone,
            token: hubToken,
            ts: new Date().toISOString(),
          }),
        });
        const data = await res.json();
        if (data.ok) {
          showToast(`${group}조 의제 #${cardId} → ${newZone}`);
          return true;
        } else {
          throw new Error(data.reason || 'writeback failed');
        }
      } catch (err) {
        return false;
      }
    };

    // Try once, then retry once on failure
    let ok = await attempt();
    if (!ok) ok = await attempt();

    setIsWriting(false);

    if (!ok) {
      showToast('동기화 실패 — Sheet 직접 편집', true);
      // Revert card optimistic update
      setCards(prev => prev.map(c =>
        c.id === cardId ? { ...c, displayZone: previousZone } : c
      ));
      setZoneCounts(prev => {
        const next = { ...prev };
        next[newZone] = Math.max(0, (next[newZone] || 0) - 1);
        next[previousZone] = (next[previousZone] || 0) + 1;
        return next;
      });
      return false;
    }
    return true;
  }, [isDemoMode, writebackUrl, hubToken]);

  // ── Drag handlers ─────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, card: AgendaRow) => {
    if (!runtimeControlMode) { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('cardId', String(card.id));
    setDragState({ cardId: card.id, originalZone: card.displayZone, startX: e.clientX, startY: e.clientY });
    (e.currentTarget as HTMLElement).classList.add('dragging');
  }, [runtimeControlMode]);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('dragging');
    setDragState(null);
    setDragOverZone(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, zone: Zone) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverZone(zone);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverZone(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetZone: Zone) => {
    e.preventDefault();
    setDragOverZone(null);
    if (!dragState) return;

    const { cardId, originalZone } = dragState;
    if (targetZone === originalZone) return;

    const card = cards.find(c => c.id === cardId);
    if (!card) return;

    // Optimistic update
    setCards(prev => prev.map(c =>
      c.id === cardId ? { ...c, displayZone: targetZone } : c
    ));
    setZoneCounts(prev => {
      const next = { ...prev };
      next[originalZone] = Math.max(0, (next[originalZone] || 0) - 1);
      next[targetZone] = (next[targetZone] || 0) + 1;
      return next;
    });

    doWriteback(card.row, card.id, targetZone, card.group, originalZone);
    setDragState(null);
  }, [dragState, cards, doWriteback]);

  // ── Control mode: card click → zone picker modal ──────────────────────
  const handleCardClick = useCallback((card: AgendaRow) => {
    if (runtimeControlMode) {
      setModalCard(card);
    }
  }, [runtimeControlMode]);

  const handleModalZoneSelect = useCallback((newZone: Zone) => {
    if (!modalCard) return;
    const prev = modalCard.displayZone;
    if (newZone === prev) { setModalCard(null); return; }

    setCards(c => c.map(r => r.id === modalCard.id ? { ...r, displayZone: newZone } : r));
    setZoneCounts(prev2 => {
      const next = { ...prev2 };
      next[prev] = Math.max(0, (next[prev] || 0) - 1);
      next[newZone] = (next[newZone] || 0) + 1;
      return next;
    });
    doWriteback(modalCard.row, modalCard.id, newZone, modalCard.group, prev);
    setModalCard(null);
  }, [modalCard, doWriteback]);

  // ── Demo reset ────────────────────────────────────────────────────────
  const handleDemoReset = useCallback(() => {
    localStorage.removeItem(DEMO_LS_KEY);
    window.location.reload();
  }, []);

  // ── Zone card lists ───────────────────────────────────────────────────
  const zones: Zone[] = ['감축', '미분류', '적응'];
  const cardsByZone: Record<Zone, AgendaRow[]> = { '감축': [], '미분류': [], '적응': [] };
  cards.forEach(c => cardsByZone[c.displayZone].push(c));

  // ── Render ────────────────────────────────────────────────────────────

  const statusBadgeClass = sheetStatus === 'live' ? 'live' : sheetStatus === 'error' ? 'error' : '';

  return (
    <div className={`board-canvas-root${isPresentMode ? ' present-mode-canvas' : ''}`}>
      {/* ── Demo banner ──────────────────────────────────────────────── */}
      {isDemoMode && (
        <div className="demo-banner" role="status" aria-label="데모 모드 안내">
          <span className="demo-banner-text">
            DEMO 모드 — Sheet 미연결, 변경은 localStorage에만 저장
          </span>
          <button
            className="demo-guide-toggle"
            onClick={() => setShowDemoGuide(v => !v)}
            aria-expanded={showDemoGuide}
            aria-controls="demo-guide-box"
          >
            {showDemoGuide ? '닫기 ▲' : '사용법 ▼'}
          </button>
          <button
            className="demo-reset-btn"
            onClick={handleDemoReset}
            title="localStorage 초기화 후 새로고침"
          >
            초기화
          </button>
          {showDemoGuide && (
            <div id="demo-guide-box" className="demo-guide-box" role="complementary">
              <ul className="demo-guide-list">
                <li><kbd>f</kbd> 키: Present 풀스크린</li>
                <li>URL에 <code>&amp;mode=control</code> 추가: 본부 드래그 활성</li>
                <li>초기화 버튼: localStorage 비우고 새로고침</li>
                <li>ambient wobble: 카드 등장 후 대기 카드 자동 흔들림</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Header controls ──────────────────────────────────────────── */}
      <div className="canvas-header" aria-label="보드 컨트롤">
        <span className="canvas-title">
          기후시민회의 의제 보드 · 2026-06-13
          {runtimeControlMode && <span className="control-badge" aria-label="본부 모드"> [본부]</span>}
        </span>
        <div className="canvas-meta">
          <span className="progress-pill">선정 {selectedCount} / {totalCount}</span>
          <span className={`status-badge ${statusBadgeClass}`} aria-live="polite">{statusText}</span>
          <span className="zone-summary" aria-live="polite">
            감축 {zoneCounts['감축']} ↔ 적응 {zoneCounts['적응']} ↔ 미분류 {zoneCounts['미분류']}
          </span>
          {isWriting && <span className="writing-indicator" aria-live="polite">저장 중…</span>}
        </div>
        <div className="canvas-actions">
          {!isDemoMode && (
            <button
              className={`toggle-btn${!autoRefresh ? ' paused' : ''}`}
              onClick={() => {
                setAutoRefresh(v => !v);
              }}
              aria-pressed={autoRefresh}
            >
              자동 갱신 {autoRefresh ? 'ON' : 'OFF'}
            </button>
          )}
          <button
            className="present-btn"
            onClick={() => {
              setIsPresentMode(v => {
                const next = !v;
                document.body.classList.toggle('present-mode', next);
                return next;
              });
            }}
            aria-label={isPresentMode ? '풀스크린 해제 (f)' : '풀스크린 (f)'}
            title="f 키로 토글"
          >
            {isPresentMode ? '복귀' : 'Present'}
          </button>
        </div>
      </div>

      {/* ── Zone columns ─────────────────────────────────────────────── */}
      <div className="zone-columns" role="main" aria-label="의제 양단 보드">
        {zones.map(zone => (
          <section
            key={zone}
            className={`zone-column${dragOverZone === zone ? ' drag-over' : ''}`}
            style={{ background: ZONE_BG[zone], border: zone === '미분류' ? '3px dashed #a8a29e' : `3px solid ${ZONE_HEADER_COLOR[zone]}` }}
            aria-label={`${zone} 영역`}
            onDragOver={e => handleDragOver(e, zone)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, zone)}
          >
            {/* Zone header */}
            <header
              className="zone-header"
              style={{ borderBottom: `3px solid ${ZONE_HEADER_COLOR[zone]}` }}
            >
              <div className="zone-title-row">
                <span className="zone-emoji" aria-hidden="true">
                  {zone === '감축' ? '⚙️' : zone === '적응' ? '🌱' : '⚪'}
                </span>
                <span className="zone-name">{zone}</span>
              </div>
              <div className="zone-subtitle">
                {zone === '감축' ? 'Mitigation' : zone === '적응' ? 'Adaptation' : 'Unassigned'}
              </div>
              <div className="zone-count" aria-live="polite">{zoneCounts[zone]}</div>
            </header>

            {/* Cards */}
            <div
              className="zone-body"
              role="list"
              aria-label={`${zone} 의제 목록`}
            >
              {cardsByZone[zone].length === 0 ? (
                <div className="zone-placeholder" aria-hidden="true">의제 없음</div>
              ) : (
                cardsByZone[zone].map((card, idx) => {
                  const rot = cardRotation(card.id);
                  const delay = idx * 50;
                  const stripColor = ZONE_STRIP[zone];
                  const shortContent = card.content.length > 80
                    ? card.content.slice(0, 80) + '…'
                    : card.content;

                  return (
                    <div
                      key={card.id}
                      className={`board-card board-card--${card.status}`}
                      data-id={card.id}
                      data-row={card.row}
                      data-zone={zone}
                      data-status={card.status}
                      role="listitem"
                      tabIndex={0}
                      aria-label={`${card.group}조 의제: ${shortContent}`}
                      style={{
                        transform: `rotate(${rot}deg)`,
                        animationDelay: `${delay}ms`,
                        cursor: runtimeControlMode ? 'grab' : 'pointer',
                      }}
                      draggable={runtimeControlMode}
                      onDragStart={e => handleDragStart(e, card)}
                      onDragEnd={handleDragEnd}
                      onClick={() => handleCardClick(card)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(card); } }}
                    >
                      {runtimeControlMode && (
                        <div className="drag-handle" aria-hidden="true" title="드래그로 이동">&#9776;</div>
                      )}
                      {/* Left strip */}
                      <div
                        className="card-strip"
                        style={{ background: stripColor }}
                        aria-hidden="true"
                      />
                      <div className="card-inner">
                        <div className="card-text">{shortContent}</div>
                        <div className="card-footer">
                          <span className="card-chip chip-group">{card.group}조</span>
                          {card.speaker && <span className="card-chip">{card.speaker}</span>}
                          {card.domain && <span className="card-chip">{card.domain}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        ))}
      </div>

      {/* ── Zone picker modal (control mode card click) ────────────── */}
      {modalCard && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="영역 변경"
          onClick={() => setModalCard(null)}
        >
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
          >
            <p className="modal-title">의제 영역 변경</p>
            <p className="modal-card-text">{modalCard.content.slice(0, 60)}{modalCard.content.length > 60 ? '…' : ''}</p>
            <div className="modal-zone-buttons">
              {(['감축', '미분류', '적응'] as Zone[]).map(z => (
                <button
                  key={z}
                  className={`modal-zone-btn zone-btn--${z}${modalCard.displayZone === z ? ' current' : ''}`}
                  onClick={() => handleModalZoneSelect(z)}
                >
                  {z}
                </button>
              ))}
            </div>
            <button className="modal-close-btn" onClick={() => setModalCard(null)}>취소 (Esc)</button>
          </div>
        </div>
      )}

      {/* ── Styles ───────────────────────────────────────────────────── */}
      <style>{`
        .board-canvas-root {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
        }

        /* Demo banner */
        .demo-banner {
          background: #fef08a;
          border-bottom: 2px solid #ca8a04;
          padding: 8px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          flex-shrink: 0;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .demo-banner-text {
          font-size: 0.8rem;
          font-weight: 700;
          color: #713f12;
          flex: 1;
          min-width: 0;
        }
        .demo-guide-toggle {
          background: #ca8a04;
          border: none;
          color: #fff;
          border-radius: 5px;
          padding: 3px 10px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .demo-reset-btn {
          background: #dc2626;
          border: none;
          color: #fff;
          border-radius: 5px;
          padding: 3px 10px;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .demo-guide-box {
          width: 100%;
          background: #fffde7;
          border: 1px solid #ca8a04;
          border-radius: 6px;
          padding: 10px 16px;
          margin-top: 4px;
        }
        .demo-guide-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .demo-guide-list li {
          font-size: 0.8rem;
          color: #713f12;
        }
        .demo-guide-list kbd {
          background: #e5e7eb;
          border: 1px solid #9ca3af;
          border-radius: 3px;
          padding: 1px 5px;
          font-size: 0.75rem;
          font-family: monospace;
        }
        .demo-guide-list code {
          background: rgba(0,0,0,0.08);
          border-radius: 3px;
          padding: 1px 4px;
          font-size: 0.75rem;
          font-family: monospace;
          color: #1e3a5f;
        }

        /* Header */
        .canvas-header {
          background: #ffffff;
          border-bottom: 1px solid #e5e7eb;
          padding: 10px 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .canvas-title {
          font-size: 1rem;
          font-weight: 700;
          color: #111827;
          white-space: nowrap;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .control-badge {
          color: #d97706;
          font-weight: 800;
        }
        .canvas-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          flex: 1;
        }
        .progress-pill {
          background: #d1fae5;
          color: #065f46;
          border-radius: 9999px;
          padding: 2px 10px;
          font-size: 0.75rem;
          font-weight: 600;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .status-badge {
          font-size: 0.75rem;
          color: #6b7280;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .status-badge.live { color: #059669; }
        .status-badge.error { color: #dc2626; }
        .zone-summary {
          font-size: 0.75rem;
          color: #374151;
          font-weight: 600;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .writing-indicator {
          font-size: 0.75rem;
          color: #d97706;
          font-style: italic;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .canvas-actions {
          display: flex;
          gap: 8px;
          margin-left: auto;
        }
        .toggle-btn, .present-btn {
          background: #f3f4f6;
          border: 1px solid #d1d5db;
          color: #374151;
          border-radius: 6px;
          padding: 4px 12px;
          font-size: 0.75rem;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.1s;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .toggle-btn:hover, .present-btn:hover { background: #e5e7eb; }
        .toggle-btn.paused { color: #dc2626; border-color: #fca5a5; background: #fef2f2; }

        /* Zone columns */
        .zone-columns {
          display: flex;
          gap: 16px;
          padding: 20px;
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          align-items: flex-start;
        }

        .zone-column {
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          min-height: 400px;
          flex: 1;
          min-width: 280px;
          overflow: hidden;
          transition: filter 0.2s ease;
        }
        .zone-column.drag-over {
          filter: brightness(0.93);
        }

        /* Zone header */
        .zone-header {
          padding: 20px 24px 16px;
        }
        .zone-title-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 4px;
        }
        .zone-emoji {
          font-size: 32px;
          line-height: 1;
        }
        .zone-name {
          font-size: 48px;
          font-weight: 800;
          line-height: 1;
          color: #1c1917;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .zone-subtitle {
          font-size: 18px;
          font-weight: 500;
          color: #78716c;
          margin-left: 42px;
          margin-bottom: 12px;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .zone-count {
          font-size: 64px;
          font-weight: 900;
          color: #1c1917;
          line-height: 1;
          margin-left: 42px;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }

        /* Zone body */
        .zone-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex: 1;
          min-height: 120px;
        }
        .zone-placeholder {
          text-align: center;
          color: #a8a29e;
          font-size: 18px;
          padding: 40px 16px;
          width: 100%;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }

        /* Cards */
        .board-card {
          background: #fef3c7;
          border-radius: 4px;
          box-shadow: 2px 4px 10px rgba(0,0,0,0.18);
          position: relative;
          display: flex;
          flex-direction: row;
          word-break: keep-all;
          overflow-wrap: break-word;
          opacity: 0;
          animation: card-slide-in 1.2s ease-out forwards;
          user-select: none;
          transition: transform 1.2s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.2s ease;
        }

        @keyframes card-slide-in {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Ambient wobble — 대기 only */
        @media (prefers-reduced-motion: no-preference) {
          .board-card--대기 {
            animation: card-slide-in 1.2s ease-out forwards, card-wobble 4s ease-in-out infinite;
          }
          @keyframes card-wobble {
            0%,  100% { margin-top: 0; }
            25%        { margin-top: -2px; }
            75%        { margin-top: 2px; }
          }
        }

        .board-card.dragging {
          transform: scale(1.05) rotate(-2deg) !important;
          box-shadow: 4px 8px 24px rgba(0,0,0,0.35) !important;
          opacity: 0.95;
          z-index: 1000;
        }

        /* Status effects */
        .board-card--선정 {
          background: #d1fae5 !important;
          box-shadow: 0 0 0 2px #10b981, 2px 4px 14px rgba(16,185,129,0.35);
        }
        .board-card--발표중 {
          background: #d1fae5 !important;
          box-shadow: 0 0 0 3px #059669, 3px 5px 24px rgba(5,150,105,0.6);
        }
        .board-card--발표완료 {
          opacity: 0.35;
          filter: grayscale(1);
        }
        .board-card--발표완료 .card-text {
          text-decoration: line-through;
        }

        @media (prefers-reduced-motion: no-preference) {
          .board-card--선정 {
            animation: card-slide-in 1.2s ease-out forwards, pulse-selected 2.5s ease-in-out infinite;
          }
          @keyframes pulse-selected {
            0%, 100% { box-shadow: 0 0 0 2px #10b981, 2px 4px 14px rgba(16,185,129,0.35); }
            50%       { box-shadow: 0 0 0 3px #10b981, 2px 4px 22px rgba(16,185,129,0.55); }
          }
          .board-card--발표중 {
            animation: card-slide-in 1.2s ease-out forwards, bounce-announcing 1.5s ease-in-out infinite;
          }
          @keyframes bounce-announcing {
            0%, 100% { transform: scale(1.03) translateY(0); }
            50%       { transform: scale(1.03) translateY(-3px); }
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .board-card, .board-card--대기, .board-card--선정, .board-card--발표중 {
            animation: card-fade-in 50ms ease-out forwards !important;
            transition: none !important;
          }
          @keyframes card-fade-in {
            from { opacity: 0; }
            to   { opacity: 1; }
          }
        }

        /* Card internals */
        .card-strip {
          width: 4px;
          flex-shrink: 0;
          border-radius: 4px 0 0 4px;
        }
        .card-inner {
          padding: 10px 12px;
          flex: 1;
          min-width: 0;
        }
        .card-text {
          font-size: 24px;
          font-weight: 500;
          color: #1c1917;
          line-height: 1.45;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
          margin-bottom: 8px;
        }
        .card-footer {
          display: flex;
          gap: 5px;
          flex-wrap: wrap;
          align-items: center;
        }
        .card-chip {
          font-size: 16px;
          font-weight: 700;
          background: rgba(0,0,0,0.08);
          color: #57534e;
          border-radius: 3px;
          padding: 2px 7px;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .chip-group {
          background: rgba(217,119,6,0.15);
          color: #92400e;
        }
        .drag-handle {
          position: absolute;
          top: 6px;
          right: 8px;
          font-size: 22px;
          color: #a8a29e;
          cursor: grab;
          line-height: 1;
          padding: 2px 4px;
          border-radius: 3px;
        }
        .drag-handle:hover {
          color: #57534e;
          background: rgba(0,0,0,0.06);
        }

        /* Status icon prefix */
        .board-card--선정 .card-text::before,
        .board-card--발표중 .card-text::before {
          content: "★ ";
          color: #059669;
          font-weight: 700;
        }

        /* Modal */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 8000;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal-content {
          background: #fff;
          border-radius: 16px;
          padding: 32px;
          max-width: 480px;
          width: 90%;
          box-shadow: 0 8px 40px rgba(0,0,0,0.3);
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }
        .modal-title {
          font-size: 24px;
          font-weight: 700;
          color: #1c1917;
          margin-bottom: 12px;
        }
        .modal-card-text {
          font-size: 18px;
          color: #57534e;
          margin-bottom: 24px;
          line-height: 1.5;
        }
        .modal-zone-buttons {
          display: flex;
          gap: 12px;
          margin-bottom: 16px;
        }
        .modal-zone-btn {
          flex: 1;
          padding: 16px 8px;
          border-radius: 8px;
          border: 2px solid transparent;
          font-size: 22px;
          font-weight: 700;
          cursor: pointer;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
          transition: transform 0.1s;
        }
        .modal-zone-btn:hover { transform: scale(1.04); }
        .modal-zone-btn.current { border-color: #6b7280; }
        .zone-btn--감축 { background: #fffbeb; color: #92400e; }
        .zone-btn--미분류 { background: #f5f5f4; color: #57534e; }
        .zone-btn--적응 { background: #ecfdf5; color: #065f46; }
        .modal-close-btn {
          width: 100%;
          padding: 12px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          background: #f9fafb;
          color: #374151;
          font-size: 16px;
          cursor: pointer;
          font-family: 'Pretendard Variable', 'Pretendard', sans-serif;
        }

        /* Present mode scaling */
        .present-mode-canvas .zone-name { font-size: 67px !important; }
        .present-mode-canvas .zone-count { font-size: 90px !important; }
        .present-mode-canvas .zone-subtitle { font-size: 25px !important; }
        .present-mode-canvas .card-text { font-size: 34px !important; }
        .present-mode-canvas .card-chip { font-size: 22px !important; }
        .present-mode-canvas .zone-columns { gap: 20px; padding: 24px; }

        /* Mobile: stack vertically, no control mode */
        @media (max-width: 900px) {
          .zone-columns { flex-direction: column; }
          .zone-column { min-width: unset; }
        }
      `}</style>
    </div>
  );
}
