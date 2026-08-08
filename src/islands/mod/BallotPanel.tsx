import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ballotCreate,
  ballotList,
  ballotResults,
  ballotSetStatus,
  submissionGet,
  topicList,
  type BallotListRow,
  type BallotResults,
  type BallotScale,
  type SubmissionGetResult,
  type Topic,
} from '../../lib/deliberation';
import { renderBallotItemSvg } from './ballot-result-image';
import { RESULT_IMAGE_SCALE, ballotImageFileName, downloadBlob, svgToPngBlob } from './svg-to-png';
import {
  BALLOT_SCALES,
  MAX_BALLOT_ITEMS,
  ballotStatusLabel,
  ballotUrl,
  distRows,
  emptyBallotFormItem,
  primaryAction,
  qrSubgroupNotice,
  scaleLabel,
  subgroupBadgeLabel,
  validateBallotForm,
  type BallotAction,
  type BallotFormItem,
} from './ballot-panel-logic';

const DIST_COLORS = ['#23B2C3', '#2E75B6', '#4F9D3A', '#F5A623', '#135C73', '#1F4E79', '#B5651D'];

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`font-mono text-[12px] font-semibold uppercase ${className}`}
      style={{ letterSpacing: '.14em' }}
    >
      {children}
    </div>
  );
}

/** ISO 시각을 시:분으로. 값이 없거나 깨졌으면 '—'. */
function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function statusBadgeClass(status: BallotListRow['status']): string {
  if (status === 'open') return 'bg-[#23B2C3] text-white';
  if (status === 'closed') return 'bg-[#DC2626] text-white';
  if (status === 'published') return 'bg-[#4F9D3A] text-white';
  return 'bg-[#F1F7FA] text-[#5A6B73] border border-[#DCE7EE]';
}

// ============================================================
// 풀스크린 — 참가용 QR (대형 스크린: QR 최대, 안내 24px+)
// ============================================================

function BallotQrFullscreen({
  ballot,
  onExit,
}: {
  ballot: BallotListRow;
  onExit: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const url = ballotUrl(typeof window !== 'undefined' ? window.location.origin : '', ballot.token);
  const urlDisplay = url.replace(/^https?:\/\//, '');

  useEffect(() => {
    // 대형 스크린에서 원거리 스캔 대비 고해상도로 뽑는다(표시 크기는 CSS가 결정).
    QRCode.toDataURL(url, { width: 960, margin: 1 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  // 세 분과가 세 장소에서 동시에 QR을 띄운다 — 오배포 방지용 분과 라벨을 크게 박는다.
  const subgroupNotice = qrSubgroupNotice(ballot.subgroup);

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col items-center px-6 py-6 sm:py-8">
      <div className="w-full flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow className="text-[#135C73] mb-1">
            다의제 투표 · {subgroupBadgeLabel(ballot.subgroup)}
          </Eyebrow>
          <h1
            className="text-[clamp(24px,3vw,44px)] font-extrabold text-[#1F4E79] leading-tight truncate"
            style={{ letterSpacing: '-.022em' }}
          >
            {ballot.title}
          </h1>
        </div>
        <button
          type="button"
          onClick={onExit}
          aria-label="QR 화면 나가기"
          className="shrink-0 rounded-full border border-[#C4D8E4] bg-white/90 px-4 py-2 text-[15px] font-bold text-[#5A6B73] shadow-sm"
        >
          나가기 (ESC)
        </button>
      </div>

      {subgroupNotice ? (
        <p className="mt-3 w-full rounded-2xl bg-[#135C73] px-6 py-3 text-center text-[clamp(24px,2.8vw,44px)] font-extrabold text-white">
          {subgroupNotice}
        </p>
      ) : null}

      {/* QR — 뷰포트를 최대한 차지한다 */}
      <div className="flex-1 min-h-0 w-full grid place-items-center py-4">
        {qr ? (
          <img
            src={qr}
            alt="참가용 QR 코드"
            className="h-full w-auto max-w-full max-h-full object-contain rounded-2xl border border-[#DCE7EE]"
          />
        ) : (
          <div className="w-[min(70vh,90vw)] aspect-square bg-[#F1F7FA] rounded-2xl animate-pulse" />
        )}
      </div>

      <div className="w-full flex flex-col items-center text-center gap-2 pb-1">
        <p className="text-[clamp(24px,2.6vw,40px)] font-extrabold text-[#1F4E79]">
          <span aria-hidden="true">📷</span> 휴대폰 카메라로 QR을 스캔하세요
        </p>
        <p
          className="font-mono text-[clamp(24px,2.2vw,34px)] font-bold text-[#135C73] break-all select-all"
          style={{ letterSpacing: '-.01em' }}
        >
          {urlDisplay}
        </p>
        <p className="text-[clamp(28px,3vw,48px)] font-extrabold text-[#1F4E79] tr-num">
          제출 {ballot.response_count}명
        </p>
      </div>
    </div>
  );
}

// ============================================================
// 풀스크린 — 결과 (잠정·확정 공용, 3초 폴링)
// ============================================================

function BallotResultsFullscreen({
  ballot,
  code,
  onExit,
  onNotify,
}: {
  ballot: BallotListRow;
  code: string;
  onExit: () => void;
  /** 내보내기 결과 안내(토스트). 패널 본체의 setToast를 받는다. */
  onNotify: (message: string) => void;
}) {
  const [results, setResults] = useState<BallotResults | null>(null);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState<'png' | 'docx' | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      ballotResults(ballot.token, code)
        .then((next) => {
          if (cancelled) return;
          if (next) {
            setResults(next);
            setFailed(false);
          } else {
            setFailed(true);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [ballot.token, code]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const provisional = results != null && results.status !== 'published';

  /** 문항별 카드 PNG를 순서대로 내려받는다. 브라우저가 다중 다운로드 허용을 물을 수 있다. */
  const savePng = async () => {
    if (results == null || exporting != null) return;
    setExporting('png');
    try {
      const at = new Date();
      for (const item of results.items) {
        const svg = renderBallotItemSvg({
          ballotTitle: results.title,
          ordinal: item.ordinal,
          statement: item.statement,
          scale: item.scale,
          n: item.n,
          avg: item.avg,
          dist: item.dist,
        });
        const blob = await svgToPngBlob(svg, RESULT_IMAGE_SCALE);
        downloadBlob(blob, ballotImageFileName({ title: results.title, ordinal: item.ordinal, at }));
      }
      onNotify(`결과 이미지 ${results.items.length}장을 저장했습니다.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : '이미지 저장에 실패했습니다.');
    } finally {
      setExporting(null);
    }
  };

  /** 결과보고서 DOCX. docx 모듈은 무겁다 — 눌렀을 때만 동적 로드해 콘솔 초기 로드를 지킨다. */
  const saveDocx = async () => {
    if (results == null || exporting != null) return;
    setExporting('docx');
    try {
      const docxMod = await import('./ballot-report-docx');
      // §3 내 조 산출물은 선택 데이터 — 조회에 실패해도 보고서는 §1·§2만으로 나간다.
      let topics: Array<{ topic: Topic; submission: SubmissionGetResult }> | null = null;
      try {
        const list = await topicList(code);
        topics = await Promise.all(
          list.map(async (t) => ({ topic: t, submission: await submissionGet(code, t.id) })),
        );
      } catch {
        topics = null;
      }
      const model = docxMod.buildBallotReportModel({
        results,
        generatedAtLabel: docxMod.formatGeneratedAt(new Date()),
        topics,
      });
      const blob = await docxMod.ballotReportBlob(model);
      downloadBlob(blob, docxMod.ballotReportFileName({ title: results.title, at: new Date() }));
      onNotify('결과보고서(DOCX)를 저장했습니다.');
    } catch {
      onNotify('보고서 저장에 실패했습니다 — 다시 시도해 주세요.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col px-6 sm:px-14 py-8 sm:py-10">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <Eyebrow className="text-[#135C73] mb-2">
            {provisional ? '잠정 결과 · 운영진 전용' : '최종 결과'} ·{' '}
            {subgroupBadgeLabel(results?.subgroup ?? ballot.subgroup)}
          </Eyebrow>
          <h1
            className="text-[clamp(28px,3.4vw,50px)] font-extrabold text-[#1F4E79] leading-tight"
            style={{ letterSpacing: '-.022em' }}
          >
            {results?.title ?? ballot.title}
          </h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <Eyebrow className="text-[#5A6B73] mb-1">제출</Eyebrow>
            <div className="text-[clamp(56px,7vw,100px)] font-extrabold text-[#1F4E79] leading-none tr-num">
              {results?.responses ?? '—'}
              <span className="text-[0.35em] font-bold text-[#5A6B73]">명</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onExit}
            aria-label="결과 화면 나가기"
            className="rounded-full border border-[#C4D8E4] bg-white/90 px-4 py-2 text-[15px] font-bold text-[#5A6B73] shadow-sm"
          >
            나가기 (ESC)
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <button
          type="button"
          onClick={() => void savePng()}
          disabled={results == null || exporting != null}
          className="h-12 rounded-xl border border-[#1F4E79] px-4 text-[16px] font-bold text-[#1F4E79] disabled:opacity-40"
        >
          {exporting === 'png' ? '이미지 저장 중…' : '결과 이미지 저장(PNG)'}
        </button>
        <button
          type="button"
          onClick={() => void saveDocx()}
          disabled={results == null || exporting != null}
          className="h-12 rounded-xl border border-[#1F4E79] px-4 text-[16px] font-bold text-[#1F4E79] disabled:opacity-40"
        >
          {exporting === 'docx' ? '보고서 만드는 중…' : '보고서 다운로드(DOCX)'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pr-1">
        {failed && results == null ? (
          <p className="text-[24px] font-bold text-[#B5651D]">
            결과를 불러오지 못했습니다 — 네트워크를 확인해 주세요. 3초마다 다시 시도합니다.
          </p>
        ) : results == null ? (
          <p className="text-[24px] text-[#5A6B73]">불러오는 중…</p>
        ) : (
          results.items.map((item) => {
            const rows = distRows(item.scale, item.dist);
            return (
              <div key={item.id} className="rounded-2xl border border-[#DCE7EE] bg-white p-5 sm:p-6">
                <div className="flex items-start justify-between gap-6 mb-4">
                  <div className="min-w-0">
                    <Eyebrow className="text-[#5A6B73] mb-1">
                      의제 {item.ordinal} · {item.scale}점 척도 · 응답 {item.n}건
                    </Eyebrow>
                    <p className="text-[clamp(22px,2.2vw,34px)] font-extrabold text-[#1F2933] leading-snug break-words">
                      {item.statement}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Eyebrow className="text-[#5A6B73] mb-1">평균</Eyebrow>
                    <div className="text-[clamp(56px,6vw,88px)] font-extrabold text-[#135C73] leading-none tr-num">
                      {item.avg == null ? '—' : item.avg.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {rows.map((row) => (
                    <div key={row.value} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-[clamp(18px,1.6vw,26px)] font-extrabold text-[#1F4E79] tr-num text-right">
                        {row.value}
                      </span>
                      <div className="flex-1 h-[clamp(24px,3vh,40px)] rounded-lg bg-[#F1F7FA] overflow-hidden border border-[#DCE7EE]">
                        <div
                          className="h-full rounded-lg transition-all"
                          style={{
                            width: `${row.pct}%`,
                            background: DIST_COLORS[(row.value - 1) % DIST_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="w-[7em] shrink-0 text-[clamp(18px,1.6vw,26px)] font-bold text-[#5A6B73] tr-num text-right">
                        {row.count}건 · {row.pct}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================
// 생성 폼 — 제목·안내문·의제 행(문장 + 척도 2/4/5/7)
// ============================================================

function CreateForm({
  submitting,
  subgroup,
  onCreate,
  onCancel,
}: {
  submitting: boolean;
  /** 내 조의 분과(mod_join team.subgroup). null이면 「내 분과」 옵션을 숨긴다. */
  subgroup: string | null;
  onCreate: (
    title: string,
    instructions: string | null,
    items: BallotFormItem[],
    subgroup: string | null,
  ) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [items, setItems] = useState<BallotFormItem[]>([emptyBallotFormItem()]);
  // 대상: 세션 전체(기본) / 내 분과 한정. 분과 정보가 없는 팀은 전체 고정.
  const [scope, setScope] = useState<'all' | 'subgroup'>('all');
  const [error, setError] = useState<string | null>(null);

  const setStatement = (index: number, statement: string) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, statement } : item)));
  const setScale = (index: number, scale: BallotScale) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, scale } : item)));
  const addItem = () =>
    setItems((prev) => (prev.length < MAX_BALLOT_ITEMS ? [...prev, emptyBallotFormItem()] : prev));
  const removeItem = (index: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const submit = () => {
    const checked = validateBallotForm(title, items);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    onCreate(
      title,
      instructions.trim() ? instructions.trim() : null,
      items,
      scope === 'subgroup' && subgroup ? subgroup : null,
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <label
          className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2"
          style={{ letterSpacing: '.14em' }}
        >
          투표 제목
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 폐회 일괄 투표 — 권고안 지지도"
          className="w-full min-w-0 h-14 rounded-xl border border-[#C4D8E4] focus:border-[#23B2C3] px-4 text-[18px] text-[#1F2933] outline-none"
        />
      </div>

      <div>
        <label
          className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2"
          style={{ letterSpacing: '.14em' }}
        >
          안내문 (선택)
        </label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={2}
          placeholder="참가자 화면 상단에 보여줄 안내를 적습니다."
          className="w-full min-w-0 rounded-xl border border-[#C4D8E4] focus:border-[#23B2C3] px-4 py-3 text-[17px] text-[#1F2933] outline-none resize-y"
        />
      </div>

      {subgroup ? (
        <div>
          <label
            className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2"
            style={{ letterSpacing: '.14em' }}
          >
            대상
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setScope('all')}
              aria-pressed={scope === 'all'}
              className={`h-12 rounded-xl border px-3 text-[16px] font-bold ${
                scope === 'all'
                  ? 'border-[#23B2C3] bg-[#23B2C3]/10 text-[#135C73]'
                  : 'border-[#C4D8E4] bg-white text-[#5A6B73]'
              }`}
            >
              세션 전체
            </button>
            <button
              type="button"
              onClick={() => setScope('subgroup')}
              aria-pressed={scope === 'subgroup'}
              className={`h-12 rounded-xl border px-3 text-[16px] font-bold ${
                scope === 'subgroup'
                  ? 'border-[#23B2C3] bg-[#23B2C3]/10 text-[#135C73]'
                  : 'border-[#C4D8E4] bg-white text-[#5A6B73]'
              }`}
            >
              내 분과 ({subgroup})
            </button>
          </div>
          {scope === 'subgroup' ? (
            <p className="mt-2 text-[14px] text-[#5A6B73]">
              이 투표는 <b className="text-[#135C73]">{subgroup}</b> 장소의 QR로만 배포하세요.
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <label
          className="block text-[#5A6B73] font-mono text-[12px] font-semibold uppercase mb-2"
          style={{ letterSpacing: '.14em' }}
        >
          의제 (1~{MAX_BALLOT_ITEMS}개 · 문장 + 척도)
        </label>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="rounded-xl border border-[#C4D8E4] p-3 space-y-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-9 h-9 shrink-0 rounded-lg bg-[#F1F7FA] border border-[#DCE7EE] grid place-items-center text-[16px] font-bold text-[#1F4E79]">
                  {index + 1}
                </span>
                <input
                  type="text"
                  value={item.statement}
                  onChange={(e) => setStatement(index, e.target.value)}
                  placeholder="의제 문장"
                  className="min-w-0 flex-1 h-[52px] rounded-xl border border-[#C4D8E4] focus:border-[#23B2C3] px-3 text-[17px] text-[#1F2933] outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  disabled={items.length <= 1}
                  aria-label={`의제 ${index + 1} 삭제`}
                  className="w-10 h-12 shrink-0 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-2xl grid place-items-center disabled:opacity-30"
                >
                  ×
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-11">
                {BALLOT_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    onClick={() => setScale(index, scale)}
                    className={`h-10 rounded-lg border px-3 text-[15px] font-bold ${
                      item.scale === scale
                        ? 'border-[#23B2C3] bg-[#23B2C3]/10 text-[#135C73]'
                        : 'border-[#C4D8E4] bg-white text-[#5A6B73]'
                    }`}
                  >
                    {scaleLabel(scale)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addItem}
          disabled={items.length >= MAX_BALLOT_ITEMS}
          className="mt-3 w-full h-[52px] rounded-xl border border-dashed border-[#23B2C3] text-[#135C73] text-[18px] font-bold flex items-center justify-center gap-2 disabled:opacity-30"
        >
          <span className="text-2xl leading-none">＋</span> 의제 추가
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#DC2626]/30 bg-[#FEF2F2] px-4 py-2.5 text-[16px] font-bold text-[#B91C1C]">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="h-14 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[18px] font-bold disabled:opacity-50"
        >
          취소
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="h-14 rounded-2xl bg-[#2E75B6] text-white text-[18px] font-bold shadow-sm disabled:opacity-50"
        >
          {submitting ? '만드는 중…' : '초안 만들기'}
        </button>
      </div>
      <p className="text-[14px] text-[#5A6B73] text-center">
        초안 상태에서는 참가자에게 보이지 않습니다. 목록에서 <b className="text-[#1F4E79]">투표 시작</b>을
        눌러야 제출이 열립니다.
      </p>
    </div>
  );
}

// ============================================================
// 패널 본체 — 목록(3초 폴링) + 생성 + 상태 전이 + 풀스크린 진입
// ============================================================

export default function BallotPanel({
  code,
  subgroup = null,
}: {
  code: string | null;
  /** 내 조의 분과(mod_join team.subgroup). 없으면 분과 한정 투표를 만들 수 없다. */
  subgroup?: string | null;
}) {
  const [ballots, setBallots] = useState<BallotListRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ ballot: BallotListRow; action: BallotAction } | null>(null);
  // 풀스크린은 id만 들고 목록 폴링분에서 최신 행을 찾는다 — 제출 수가 3초마다 살아 움직인다.
  const [qrId, setQrId] = useState<string | null>(null);
  const [resultsId, setResultsId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const rows = await ballotList(code);
      setBallots(rows);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [code]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    const tick = () => {
      ballotList(code)
        .then((rows) => {
          if (!cancelled) {
            setBallots(rows);
            setLoadFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setLoadFailed(true);
        });
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [code]);

  const handleCreate = async (
    title: string,
    instructions: string | null,
    items: BallotFormItem[],
    ballotSubgroup: string | null,
  ) => {
    if (!code) return;
    const checked = validateBallotForm(title, items);
    if (!checked.ok) return;
    setSubmitting(true);
    try {
      // 대상=전체면 deliberation.ballotCreateParams가 p_subgroup 키 자체를 빼고 보낸다(S4 미적용 DB 호환).
      await ballotCreate(code, {
        title: checked.title,
        instructions,
        items: checked.items,
        subgroup: ballotSubgroup,
      });
      setShowForm(false);
      setToast('투표 초안이 만들어졌습니다. 준비되면 투표 시작을 누르세요.');
      await refresh();
    } catch {
      setToast('투표 만들기에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const runTransition = async (ballot: BallotListRow, action: BallotAction) => {
    if (!code) return;
    setBusyId(ballot.id);
    try {
      await ballotSetStatus(code, ballot.id, action.to);
      if (action.to === 'open') setQrId(ballot.id); // 시작 직후 바로 QR을 띄운다 — 현장 순서 그대로.
      setToast(
        action.to === 'open'
          ? '투표가 시작되었습니다.'
          : action.to === 'closed'
            ? '투표가 마감되었습니다.'
            : '결과가 공개되었습니다.',
      );
      await refresh();
    } catch {
      setToast('상태 변경에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setBusyId(null);
    }
  };

  const qrBallot = qrId ? (ballots ?? []).find((b) => b.id === qrId) ?? null : null;
  const resultsBallot = resultsId ? (ballots ?? []).find((b) => b.id === resultsId) ?? null : null;

  return (
    <section className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-6 py-4 bg-[#2E75B6]/8 border-b border-[#DCE7EE]">
        <span
          className="w-11 h-11 rounded-xl bg-[#2E75B6] grid place-items-center text-white text-2xl"
          aria-hidden="true"
        >
          📮
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[22px] font-extrabold text-[#1F4E79]" style={{ letterSpacing: '-.01em' }}>
            다의제 투표
          </h3>
          <p className="text-[14px] text-[#5A6B73]">여러 의제를 한 번에 — QR 1회 스캔으로 전 문항 제출</p>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {!code ? (
          <p className="text-[16px] text-[#5A6B73]">조 접속 후에 사용할 수 있습니다.</p>
        ) : showForm ? (
          <CreateForm
            submitting={submitting}
            subgroup={subgroup}
            onCreate={handleCreate}
            onCancel={() => setShowForm(false)}
          />
        ) : (
          <>
            {loadFailed && ballots == null ? (
              <p className="rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3 text-[16px] font-extrabold text-[#B5651D]">
                투표 목록을 불러오지 못했습니다 — 네트워크를 확인해 주세요. 3초마다 다시 시도합니다.
              </p>
            ) : null}

            {(ballots ?? []).map((ballot) => {
              const action = primaryAction(ballot.status);
              const busy = busyId === ballot.id;
              return (
                <div key={ballot.id} className="rounded-xl border border-[#C4D8E4] bg-white p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[18px] font-bold text-[#1F2933] break-words">{ballot.title}</p>
                      <p className="mt-1 text-[15px] font-semibold text-[#5A6B73] tr-num">
                        의제 {ballot.item_count}개 · 제출 {ballot.response_count}명 · {formatClock(ballot.created_at)}
                      </p>
                    </div>
                    <span className="shrink-0 flex flex-col items-end gap-1.5">
                      <span
                        className={`rounded-full px-3 py-1 text-[14px] font-bold ${statusBadgeClass(ballot.status)}`}
                      >
                        {ballotStatusLabel(ballot.status)}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-[14px] font-bold ${
                          ballot.subgroup
                            ? 'bg-[#135C73] text-white'
                            : 'bg-[#F1F7FA] text-[#5A6B73] border border-[#DCE7EE]'
                        }`}
                      >
                        {subgroupBadgeLabel(ballot.subgroup)}
                      </span>
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {ballot.status === 'open' ? (
                      <button
                        type="button"
                        onClick={() => setQrId(ballot.id)}
                        className="h-12 rounded-xl bg-[#23B2C3] px-4 text-[16px] font-bold text-white"
                      >
                        QR 크게 보기
                      </button>
                    ) : null}
                    {ballot.status === 'open' || ballot.status === 'closed' ? (
                      <button
                        type="button"
                        onClick={() => setResultsId(ballot.id)}
                        className="h-12 rounded-xl border border-[#1F4E79] px-4 text-[16px] font-bold text-[#1F4E79]"
                      >
                        잠정 결과
                      </button>
                    ) : null}
                    {ballot.status === 'published' ? (
                      <button
                        type="button"
                        onClick={() => setResultsId(ballot.id)}
                        className="h-12 rounded-xl border border-[#1F4E79] px-4 text-[16px] font-bold text-[#1F4E79]"
                      >
                        결과 크게 보기
                      </button>
                    ) : null}
                    {action ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmAction({ ballot, action })}
                        className={`h-12 rounded-xl px-4 text-[16px] font-bold disabled:opacity-50 ${
                          action.to === 'closed'
                            ? 'bg-[#DC2626] text-white'
                            : action.to === 'published'
                              ? 'bg-[#4F9D3A] text-white'
                              : 'bg-[#2E75B6] text-white'
                        }`}
                      >
                        {busy ? '처리 중…' : action.label}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {ballots != null && ballots.length === 0 ? (
              <p className="text-[16px] text-[#5A6B73]">아직 만든 다의제 투표가 없습니다.</p>
            ) : null}

            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="w-full h-14 rounded-2xl border border-dashed border-[#2E75B6] text-[#2E75B6] text-[18px] font-bold flex items-center justify-center gap-2"
            >
              <span className="text-2xl leading-none">＋</span> 새 다의제 투표
            </button>
          </>
        )}
      </div>

      {confirmAction ? (
        <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden">
            <div className="px-6 pt-6 pb-5 text-center">
              <div
                className="w-14 h-14 mx-auto rounded-2xl bg-[#F5A623]/15 border border-[#F5A623]/40 grid place-items-center text-3xl mb-4"
                aria-hidden="true"
              >
                {confirmAction.action.to === 'closed' ? '⛔' : '🗳️'}
              </div>
              <Eyebrow className="text-[#B5651D] mb-2">Confirm</Eyebrow>
              <h4
                className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-3"
                style={{ letterSpacing: '-.01em' }}
              >
                {confirmAction.ballot.title}
              </h4>
              <p className="text-[18px] font-bold text-[#1F2933] leading-relaxed">
                {confirmAction.action.confirm}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-0">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="h-[56px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[19px] font-bold"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  const { ballot, action } = confirmAction;
                  setConfirmAction(null);
                  void runTransition(ballot, action);
                }}
                className={`h-[56px] rounded-2xl text-white text-[19px] font-bold shadow-sm ${
                  confirmAction.action.to === 'closed' ? 'bg-[#DC2626]' : 'bg-[#1F4E79]'
                }`}
              >
                {confirmAction.action.label}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {qrBallot ? <BallotQrFullscreen ballot={qrBallot} onExit={() => setQrId(null)} /> : null}
      {resultsBallot && code ? (
        <BallotResultsFullscreen
          ballot={resultsBallot}
          code={code}
          onExit={() => setResultsId(null)}
          onNotify={setToast}
        />
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F4E79] text-white text-[16px] font-bold rounded-full px-5 py-3 shadow-lg">
          {toast}
        </div>
      ) : null}
    </section>
  );
}
