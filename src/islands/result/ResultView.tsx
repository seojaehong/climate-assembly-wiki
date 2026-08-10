import { useEffect, useState, type KeyboardEvent } from 'react';
import HitlBadge from '../../components/HitlBadge';
import { fetchResult } from '../../lib/result-page';
import {
  buildResultExplanation,
  buildResultView,
  ratioToPercent,
  tokenFromPath,
  HITL_RATIO_NOTICE,
  type ResultView as ResultViewModel,
  type ViewIssue,
} from './result-view-logic';

// BallotPanel과 동일 팔레트(현장 톤 일관).
const NAVY = '#1F4E79';
const TEAL = '#135C73';
const INK = '#1F2933';
const GRAY = '#5A6B73';
const BORDER = '#DCE7EE';
const TABLE_BACKGROUND = '#FFFFFF';

function handleHorizontalScrollKey(event: KeyboardEvent<HTMLDivElement>) {
  const region = event.currentTarget;
  if (event.key === 'ArrowRight') region.scrollLeft += 40;
  else if (event.key === 'ArrowLeft') region.scrollLeft -= 40;
  else if (event.key === 'End') region.scrollLeft = region.scrollWidth;
  else if (event.key === 'Home') region.scrollLeft = 0;
  else return;
  event.preventDefault();
}
export const RESULT_CONTROL_BORDER = '#6B7D88';
export const RESULT_STATUS_GREEN = '#2F6F25';
export const RESULT_STATUS_AMBER = '#8A4F08';
export const RESULT_MATRIX_RAISED = '#2E75B6';
export const RESULT_MATRIX_NOT_RAISED = '#6B7D88';

const FREQ_COLOR: Record<string, string> = {
  consensus: RESULT_STATUS_GREEN,
  majority: '#2E75B6',
  minority: RESULT_STATUS_AMBER,
  mixed: '#5A6B73',
};

// ── 보고서(DOCX) 내려받기 ──
// docx·result-report-docx 는 무겁고 브라우저 전용이라, 클릭 시점에 동적 import 한다
// (초기 로딩엔 싣지 않는다). 실패(import·Packer)는 삼키지 않고 문구로 안내한다.
function ReportDownloadButton({ view }: { view: ResultViewModel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const [{ buildResultReportModel, resultReportBlob, resultReportFileName, formatGeneratedAt }, { downloadBlob }] =
        await Promise.all([import('./result-report-docx'), import('../mod/svg-to-png')]);
      const now = new Date();
      const model = buildResultReportModel({ view, generatedAtLabel: formatGeneratedAt(now) });
      const blob = await resultReportBlob(model);
      downloadBlob(blob, resultReportFileName({ title: view.title, at: now }));
    } catch {
      setError('보고서를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onDownload}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-[clamp(16px,1.7vw,20px)] font-extrabold text-white shadow-sm disabled:opacity-60"
        style={{ background: NAVY }}
      >
        <span aria-hidden="true">⬇</span>
        {busy ? '보고서 만드는 중…' : '보고서 다운로드(DOCX)'}
      </button>
      {error ? (
        <span role="alert" className="text-[15px] font-semibold" style={{ color: RESULT_STATUS_AMBER }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

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
      className={`font-mono text-[13px] font-semibold uppercase ${className}`}
      style={{ letterSpacing: '.14em', ...style }}
    >
      {children}
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── 상태 화면(로딩·오류·미공개) — 시민에게 미공개와 일시 오류를 구분해 보인다 ──

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl text-center">{children}</div>
    </main>
  );
}

function StanceBadge({ issue }: { issue: ViewIssue }) {
  if (!issue.frequencyLabel && !issue.stanceLabel) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {issue.frequencyLabel ? (
        <span
          className="rounded-full px-3 py-1 text-[15px] font-bold text-white"
          style={{ background: FREQ_COLOR[issue.frequency ?? ''] ?? GRAY }}
        >
          {issue.frequencyLabel}
        </span>
      ) : null}
      {issue.stanceLabel ? (
        <span
          className="rounded-full border-2 px-3 py-1 text-[15px] font-bold"
          style={{ borderColor: BORDER, color: TEAL }}
        >
          {issue.stanceLabel}
        </span>
      ) : null}
    </span>
  );
}

function StatTile({
  label,
  value,
  unit,
  accent = NAVY,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border-2 bg-white px-5 py-4" style={{ borderColor: BORDER }}>
      <Eyebrow className="mb-1" style={{ color: GRAY }}>
        {label}
      </Eyebrow>
      <div className="text-[clamp(40px,5vw,68px)] font-extrabold leading-none tr-num" style={{ color: accent }}>
        {value}
        {unit ? <span className="text-[0.36em] font-bold" style={{ color: GRAY }}>{unit}</span> : null}
      </div>
    </div>
  );
}

// ── 조×쟁점 커버리지 매트릭스 ──

function CoverageMatrix({ view }: { view: ResultViewModel }) {
  const { matrix } = view;
  if (matrix.teams.length === 0 || matrix.rows.length === 0) return null;
  return (
    <section className="rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: BORDER }}>
      <Eyebrow className="mb-1" style={{ color: TEAL }}>
        조 × 쟁점 커버리지
      </Eyebrow>
      <h2 className="text-[clamp(20px,2.2vw,30px)] font-extrabold mb-1" style={{ color: NAVY }}>
        어느 조가 무엇을 제기했는가
      </h2>
      <p className="text-[16px] mb-4" style={{ color: GRAY }}>
        세로 = 쟁점, 가로 = 조. ● 제기 · · 미제기
      </p>
      <div className="overflow-x-auto" role="region" aria-label="조별 쟁점 커버리지 표" tabIndex={0} onKeyDown={handleHorizontalScrollKey}>
        <table className="border-collapse text-left" style={{ minWidth: '100%' }}>
          <caption className="sr-only">쟁점별 조 제기 여부</caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 bg-white px-3 py-2 text-[15px] font-bold align-bottom"
                style={{ background: TABLE_BACKGROUND, color: GRAY, minWidth: 220 }}
              >
                쟁점
              </th>
              {matrix.teams.map((t) => (
                <th
                  scope="col"
                  key={t}
                  className="px-2 py-2 text-[14px] font-bold text-center whitespace-nowrap"
                  style={{ background: TABLE_BACKGROUND, color: NAVY }}
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map(({ issue, cells }) => (
              <tr key={issue.id} className="border-t-2" style={{ borderColor: BORDER }}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-white px-3 py-2 text-[16px] font-bold text-left align-middle"
                  style={{ background: TABLE_BACKGROUND, color: INK, minWidth: 220 }}
                >
                  {issue.label}
                </th>
                {cells.map((raised, i) => (
                  <td
                    key={matrix.teams[i]}
                    className="px-2 py-2 text-center align-middle"
                    style={{ background: TABLE_BACKGROUND, color: INK }}
                  >
                    <span className="sr-only">{matrix.teams[i]} {raised ? '제기' : '미제기'}</span>
                    {raised ? (
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ background: RESULT_MATRIX_RAISED }}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: RESULT_MATRIX_NOT_RAISED }}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── 쟁점 랭킹(제기 조 수 막대) ──

function RankingChart({ view }: { view: ResultViewModel }) {
  const max = Math.max(1, ...view.ranking.map((i) => i.teamCount));
  return (
    <section className="rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: BORDER }}>
      <Eyebrow className="mb-1" style={{ color: TEAL }}>
        쟁점 랭킹
      </Eyebrow>
      <h2 className="text-[clamp(20px,2.2vw,30px)] font-extrabold mb-4" style={{ color: NAVY }}>
        제기한 조가 많은 순
      </h2>
      <div className="space-y-4">
        {view.ranking.map((issue) => (
          <div key={issue.id}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span className="text-[clamp(17px,1.8vw,22px)] font-extrabold break-words" style={{ color: INK }}>
                  {issue.label}
                </span>
                <StanceBadge issue={issue} />
                <HitlBadge status={issue.hitl} />
              </div>
              <span className="shrink-0 text-[clamp(20px,2vw,28px)] font-extrabold tr-num" style={{ color: NAVY }}>
                {issue.teamCount}
                <span className="text-[0.6em] font-bold" style={{ color: GRAY }}>개 조</span>
              </span>
            </div>
            <div aria-hidden="true" className="h-[clamp(20px,2.6vh,32px)] rounded-lg overflow-hidden border-2" style={{ background: '#F1F7FA', borderColor: BORDER }}>
              <div
                className="h-full rounded-lg"
                style={{ width: `${(issue.teamCount / max) * 100}%`, background: FREQ_COLOR[issue.frequency ?? ''] ?? '#2E75B6' }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 쟁점별 요약 + 연결 근거 ──

function IssueSummaries({ view }: { view: ResultViewModel }) {
  return (
    <section className="space-y-4">
      <Eyebrow style={{ color: TEAL }}>쟁점별 요약</Eyebrow>
      {view.issues.map((issue) => (
        <article key={issue.id} className="rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: BORDER }}>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="text-[clamp(19px,2vw,26px)] font-extrabold break-words" style={{ color: NAVY }}>
              {issue.label}
            </h3>
            <StanceBadge issue={issue} />
            <HitlBadge status={issue.hitl} />
          </div>
          {issue.summary ? (
            <p className="text-[clamp(17px,1.6vw,20px)] leading-relaxed mb-3" style={{ color: INK }}>
              {issue.summary}
            </p>
          ) : (
            <p className="text-[16px] italic mb-3" style={{ color: GRAY }}>
              요약이 아직 작성되지 않았습니다.
            </p>
          )}
          <p className="text-[15px] font-semibold tr-num" style={{ color: GRAY }}>
            제기 {issue.teamCount}개 조
            {issue.teams.length > 0 ? ` · ${issue.teams.join(', ')}` : ''}
            {issue.consensusDenominator != null ? ` · 원문 군집 ${issue.consensusDenominator}건` : ''}
          </p>
        </article>
      ))}
      {view.stats.unclassifiedCount > 0 ? (
        <p
          className="rounded-2xl border-2 px-5 py-4 text-[16px] font-bold"
          style={{ borderColor: BORDER, background: '#F1F7FA', color: TEAL }}
        >
          기타 {view.stats.unclassifiedCount}건은 특정 쟁점으로 분류되지 않았습니다.
        </p>
      ) : null}
    </section>
  );
}

// ── 함께 확인된 것 / 더 논의할 것 / 다음 단계 ──

function TakeawaysBlock({ view }: { view: ResultViewModel }) {
  const consensus = view.issues.filter((i) => i.isConsensus);
  const further = view.issues.filter((i) => !i.isConsensus);
  const col = (title: string, accent: string, items: ViewIssue[], empty: string) => (
    <div className="rounded-2xl border-2 bg-white p-5" style={{ borderColor: BORDER }}>
      <h3 className="text-[clamp(18px,1.9vw,24px)] font-extrabold mb-3" style={{ color: accent }}>
        {title}
      </h3>
      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="text-[clamp(16px,1.5vw,19px)] font-semibold leading-snug" style={{ color: INK }}>
              · {i.label}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[16px]" style={{ color: GRAY }}>{empty}</p>
      )}
    </div>
  );
  return (
    <section className="grid gap-4 sm:grid-cols-3">
      {col('함께 확인된 것', RESULT_STATUS_GREEN, consensus, '합의로 분류된 쟁점이 아직 없습니다.')}
      {col('더 논의할 것', RESULT_STATUS_AMBER, further, '추가 논의가 필요한 쟁점이 없습니다.')}
      <div className="rounded-2xl border-2 bg-white p-5" style={{ borderColor: BORDER }}>
        <h3 className="text-[clamp(18px,1.9vw,24px)] font-extrabold mb-3" style={{ color: NAVY }}>
          다음 단계
        </h3>
        <p className="text-[clamp(16px,1.5vw,19px)] leading-relaxed" style={{ color: INK }}>
          이 결과는 숙의 과정의 중간 정리입니다. 더 논의할 쟁점은 다음 회차에서 이어 다루며,
          정리된 내용은 권고안 심의의 근거 자료로 쓰입니다.
        </p>
      </div>
    </section>
  );
}

function ResultExplanationPanel({ view }: { view: ResultViewModel }) {
  const steps = buildResultExplanation(view);
  return (
    <details className="rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: RESULT_CONTROL_BORDER }}>
      <summary className="cursor-pointer text-left">
        <Eyebrow style={{ color: TEAL }}>XAI · 산정 설명</Eyebrow>
        <span className="mt-1 block text-[clamp(20px,2.2vw,30px)] font-extrabold" style={{ color: NAVY }}>
          결과가 만들어진 과정
        </span>
        <span className="mt-1 block text-[15px]" style={{ color: GRAY }}>
          공개된 수치의 범위·집계·분류·검수 기준을 확인합니다.
        </span>
      </summary>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2">
        {steps.map((step, index) => (
          <li key={step.label} className="rounded-xl border-2 p-4" style={{ borderColor: BORDER }}>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold text-white"
                style={{ background: TEAL }}
              >
                {index + 1}
              </span>
              <h3 className="text-[17px] font-extrabold" style={{ color: NAVY }}>{step.label}</h3>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed" style={{ color: INK }}>{step.detail}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[14px] leading-relaxed" style={{ color: GRAY }}>
        이 설명은 현재 공개 스냅샷에서 확인 가능한 집계 근거입니다. 개별 원문 인용과 이행 상태는 해당 데이터가 공개 계약에 포함된 뒤 별도 제공합니다.
      </p>
    </details>
  );
}

// ── 차트 '표로 보기' 대체본(접근성) ──

function DataTable({ view }: { view: ResultViewModel }) {
  return (
    <details className="rounded-2xl border-2 bg-white p-5 sm:p-6" style={{ borderColor: RESULT_CONTROL_BORDER }}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 text-left">
        <span>
          <Eyebrow style={{ color: TEAL }}>접근성</Eyebrow>
          <span className="block text-[clamp(18px,1.9vw,24px)] font-extrabold" style={{ color: NAVY }}>
            분석 데이터를 표로 보기
          </span>
          <span className="block text-[15px]" style={{ color: GRAY }}>
            스크린리더·정확한 수치 확인용
          </span>
        </span>
        <span className="shrink-0 text-[22px]" style={{ color: TEAL }} aria-hidden="true">↕</span>
      </summary>
      <div className="mt-4 overflow-x-auto" role="region" aria-label="쟁점 분석 데이터 표" tabIndex={0} onKeyDown={handleHorizontalScrollKey}>
        <table className="w-full border-collapse text-left text-[15px]" style={{ minWidth: 720 }}>
          <caption className="sr-only">쟁점별 방향·빈도·제기 조 수·원문 군집·검수 상태</caption>
          <thead>
            <tr className="border-b-2" style={{ borderColor: BORDER, color: GRAY }}>
              <th scope="col" className="px-3 py-2" style={{ background: TABLE_BACKGROUND, color: GRAY }}>쟁점</th>
              <th scope="col" className="px-3 py-2" style={{ background: TABLE_BACKGROUND, color: GRAY }}>빈도</th>
              <th scope="col" className="px-3 py-2" style={{ background: TABLE_BACKGROUND, color: GRAY }}>방향</th>
              <th scope="col" className="px-3 py-2 text-right" style={{ background: TABLE_BACKGROUND, color: GRAY }}>제기 조</th>
              <th scope="col" className="px-3 py-2 text-right" style={{ background: TABLE_BACKGROUND, color: GRAY }}>원문 군집</th>
              <th scope="col" className="px-3 py-2" style={{ background: TABLE_BACKGROUND, color: GRAY }}>검수</th>
            </tr>
          </thead>
          <tbody>
            {view.ranking.map((issue) => (
              <tr key={issue.id} className="border-b-2" style={{ borderColor: BORDER, color: INK }}>
                <th scope="row" className="px-3 py-2 font-bold text-left" style={{ background: TABLE_BACKGROUND, color: INK }}>{issue.label}</th>
                <td className="px-3 py-2" style={{ background: TABLE_BACKGROUND, color: INK }}>{issue.frequencyLabel ?? '—'}</td>
                <td className="px-3 py-2" style={{ background: TABLE_BACKGROUND, color: INK }}>{issue.stanceLabel ?? '—'}</td>
                <td className="px-3 py-2 text-right tr-num font-bold" style={{ background: TABLE_BACKGROUND, color: INK }}>{issue.teamCount}</td>
                <td className="px-3 py-2 text-right tr-num" style={{ background: TABLE_BACKGROUND, color: INK }}>{issue.consensusDenominator ?? '—'}</td>
                <td className="px-3 py-2" style={{ background: TABLE_BACKGROUND, color: INK }}>{issue.hitl.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ── 본체 ──

export function ResultStatusScreen({ kind }: { kind: 'loading' | 'error' | 'unpublished' }) {
  if (kind === 'loading') {
    return (
      <Centered>
        <p role="status" aria-live="polite" className="text-[22px] font-bold" style={{ color: GRAY }}>불러오는 중…</p>
      </Centered>
    );
  }
  if (kind === 'error') {
    return (
      <Centered>
        <div role="alert">
          <div className="text-5xl mb-4" aria-hidden="true">⚠️</div>
          <h1 className="text-[26px] font-extrabold mb-2" style={{ color: RESULT_STATUS_AMBER }}>
            결과를 불러오지 못했습니다
          </h1>
          <p className="text-[18px]" style={{ color: GRAY }}>
            네트워크 상태를 확인한 뒤 페이지를 새로고침해 주세요.
          </p>
        </div>
      </Centered>
    );
  }
  return (
    <Centered>
      <div role="status">
        <div className="text-5xl mb-4" aria-hidden="true">🔒</div>
        <h1 className="text-[26px] font-extrabold mb-2" style={{ color: NAVY }}>
          공개되지 않은 결과입니다
        </h1>
        <p className="text-[18px]" style={{ color: GRAY }}>
          링크가 올바른지 확인해 주세요. 아직 공개 전이거나 공개가 해제된 결과일 수 있습니다.
        </p>
      </div>
    </Centered>
  );
}

export default function ResultView() {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'error' } | { kind: 'unpublished' } | { kind: 'ready'; view: ResultViewModel }
  >({ kind: 'loading' });

  useEffect(() => {
    const token = tokenFromPath(typeof window !== 'undefined' ? window.location.pathname : null);
    if (!token) {
      setState({ kind: 'unpublished' });
      return;
    }
    let cancelled = false;
    fetchResult(token)
      .then((res) => {
        if (cancelled) return;
        const view = buildResultView(res);
        setState(view ? { kind: 'ready', view } : { kind: 'unpublished' });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind !== 'ready') return <ResultStatusScreen kind={state.kind} />;
  return <ResultContent view={state.view} />;
}

export function ResultContent({ view }: { view: ResultViewModel }) {
  const pct = ratioToPercent(view.stats.consensusRatio);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen overflow-x-hidden px-4 sm:px-8 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {/* 헤더 */}
        <header className="rounded-2xl border-2 bg-white p-6 sm:p-8" style={{ borderColor: BORDER }}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Eyebrow style={{ color: TEAL }}>기후시민회의 · 숙의 결과</Eyebrow>
            {view.scopeLabel ? (
              <span className="rounded-full px-3 py-1 text-[14px] font-bold text-white" style={{ background: TEAL }}>
                {view.scopeLabel} 단위
              </span>
            ) : null}
            <span
              className="rounded-full border-2 px-3 py-1 text-[14px] font-bold"
              style={{ borderColor: BORDER, color: GRAY }}
            >
              조 단위 분포 기준
            </span>
            <span className="rounded-full px-3 py-1 text-[14px] font-bold text-white" style={{ background: RESULT_STATUS_GREEN }}>
              검수 완료 {view.stats.reviewedCount} / 전체 {view.stats.issueCount}
            </span>
          </div>
          <h1 className="text-[clamp(28px,4vw,52px)] font-extrabold leading-tight" style={{ color: NAVY, letterSpacing: '-.022em' }}>
            {view.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[16px]" style={{ color: GRAY }}>
              공개일 {formatDate(view.publishedAt)}
              {view.generatedAt ? ` · 분석 시점 ${formatDate(view.generatedAt)}` : ''}
            </p>
            <ReportDownloadButton view={view} />
          </div>
        </header>

        {/* 스탯 */}
        <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <StatTile label="합의 비율" value={String(pct)} unit="%" accent={RESULT_STATUS_GREEN} />
          <StatTile label="쟁점 수" value={String(view.stats.issueCount)} unit="개" />
          <StatTile label="참여 조" value={String(view.stats.participatingTeams)} unit="개" accent={TEAL} />
          <StatTile label="추가 숙의" value={String(view.stats.furtherCount)} unit="개" accent={RESULT_STATUS_AMBER} />
        </section>

        {/* HITL 고정 카피 */}
        <section
          className="rounded-2xl border-2 px-5 py-4"
          style={{ borderColor: '#F5A623', background: '#FEF6E7' }}
        >
          <p className="text-[clamp(16px,1.6vw,20px)] font-extrabold" style={{ color: RESULT_STATUS_AMBER }}>
            {view.hitlNotice}
          </p>
          <p className="mt-1 text-[clamp(15px,1.5vw,18px)] font-semibold" style={{ color: '#8A5A15' }}>
            {HITL_RATIO_NOTICE}
          </p>
        </section>

        <CoverageMatrix view={view} />
        <RankingChart view={view} />
        <IssueSummaries view={view} />
        <TakeawaysBlock view={view} />
        <ResultExplanationPanel view={view} />
        <DataTable view={view} />

        {/* 분모 규칙 주석 + HITL 푸터 */}
        <footer className="rounded-2xl border-2 bg-white p-5 sm:p-6 space-y-2" style={{ borderColor: BORDER }}>
          <Eyebrow style={{ color: GRAY }}>산정 기준</Eyebrow>
          <p className="text-[15px] leading-relaxed" style={{ color: GRAY }}>
            합의 비율은 <b style={{ color: INK }}>합의로 분류된 쟁점 수 ÷ 전체 쟁점 수</b>로 산정합니다
            (조 단위 분포 기준). {view.consensusRule}
          </p>
          <p className="text-[15px] leading-relaxed" style={{ color: GRAY }}>
            {view.hitlNotice} {HITL_RATIO_NOTICE}
          </p>
          <p className="text-[15px] leading-relaxed">
            <a className="font-bold underline underline-offset-4" style={{ color: TEAL }} href="/platform/accessibility/">
              접근성 성명 및 피드백
            </a>
          </p>
        </footer>
      </div>
    </main>
  );
}
