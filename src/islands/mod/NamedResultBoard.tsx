import { createContext, useEffect, useMemo, useState } from 'react';
import {
  ballotNamedResponses,
  ballotResults,
  type BallotNamedResponses,
  type WorkshopAuthorization,
} from '../../lib/deliberation';
import { nameGridLayout, yesNoColumns } from '../../lib/named-vote-logic';

/**
 * 실명 투표(10/17) — 큰 화면용 실시간 집계와 「투표결과 보기」(찬성 | 반대 두 단 + 「3조 홍길동」 이름표).
 * 판단(정렬·단 수·글자 크기)은 named-vote-logic.ts(순수, vitest)에 있다.
 */

const POLL_MS = 3000;

export type LiveCounts = { responses: number; yes: number | null; no: number | null };

/** 투표 하나의 실시간 제출 수·찬반 수(ballot_results_v2, 3초). 찬반 2점 문항이 아니면 yes/no 는 null. */
export function useLiveCounts(access: WorkshopAuthorization | null | undefined, token: string | null, enabled = true): LiveCounts | null {
  const [counts, setCounts] = useState<LiveCounts | null>(null);
  useEffect(() => {
    if (!access || !token || !enabled) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await ballotResults(token, access);
        if (cancelled || !r) return;
        const item = [...r.items].sort((a, b) => a.ordinal - b.ordinal).find((it) => it.scale === 2);
        setCounts({
          responses: r.responses,
          yes: item ? item.dist['2'] ?? 0 : null,
          no: item ? item.dist['1'] ?? 0 : null,
        });
      } catch (error: unknown) {
        console.warn('[live counts] refresh failed', error);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [access, token, enabled]);
  return counts;
}

/** 실명 응답(ballot_named_responses_v2, 3초). s28 미적용이면 'missing'. */
export function useNamedResponses(
  access: WorkshopAuthorization | null | undefined,
  ballotId: string | null,
  enabled = true,
  pollMs = POLL_MS,
): { data: BallotNamedResponses | null; missing: boolean; failed: boolean; reload: () => void } {
  const [data, setData] = useState<BallotNamedResponses | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (!access || !ballotId || !enabled) return undefined;
    let cancelled = false;
    const tick = async () => {
      try {
        const r = await ballotNamedResponses(access, ballotId);
        if (cancelled) return;
        if (r === null) setMissing(true);
        else setData(r);
        setFailed(false);
      } catch (error: unknown) {
        console.warn('[named responses] refresh failed', error);
        if (!cancelled) setFailed(true);
      }
    };
    void tick();
    const id = pollMs > 0 ? setInterval(() => void tick(), pollMs) : null;
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [access, ballotId, enabled, pollMs, key]);
  return { data, missing, failed, reload: () => setKey((k) => k + 1) };
}

function NameColumn({ label, count, names, anonymous, tone, columns, fontPx }: {
  label: string;
  count: number;
  names: string[];
  anonymous: number;
  tone: 'yes' | 'no';
  columns: number;
  fontPx: number;
}) {
  const color = tone === 'yes' ? '#2F6F25' : '#B91C1C';
  const bg = tone === 'yes' ? '#EAF6EE' : '#FEF2F2';
  return (
    <section className="flex min-h-0 min-w-0 flex-col rounded-3xl border-4 px-6 py-4" style={{ borderColor: color, background: bg }} data-testid={`named-col-${tone}`}>
      <div className="flex shrink-0 items-baseline justify-between gap-4">
        <span className="text-[56px] font-black" style={{ color }}>{label}</span>
        <span className="text-[120px] font-black leading-none tr-num" style={{ color }} data-testid={`named-count-${tone}`}>{count}</span>
      </div>
      <ol
        className="mt-3 min-h-0 flex-1 overflow-hidden font-bold text-[#1F2933]"
        style={{ columnCount: columns, columnGap: '24px', fontSize: `${fontPx}px`, lineHeight: 1.35 }}
      >
        {names.map((n, i) => (
          <li key={`${n}-${i}`} className="whitespace-nowrap overflow-hidden text-ellipsis" style={{ breakInside: 'avoid' }}>
            {n}
          </li>
        ))}
      </ol>
      {anonymous > 0 ? (
        <p className="shrink-0 text-[24px] font-bold text-[#5A6B73] tr-num">이름 없이 제출 {anonymous}</p>
      ) : null}
    </section>
  );
}

/**
 * 「투표결과 보기」 — 한 화면(1920×1080), 위에 찬성·반대 수, 아래 이름표(조 → 이름). 스크롤하지 않는다.
 * 이름이 없는 응답(무기명 세션·옛 제출)은 수에만 들어간다. s28 미적용이면 수만 보인다.
 */
export function NamedResultBoard({
  access,
  ballotId,
  title,
  sub,
  onBack,
  backLabel = 'QR로 돌아가기',
  note,
  live = true,
  fixture = null,
}: {
  access: WorkshopAuthorization | null | undefined;
  ballotId: string;
  title: string;
  sub?: string;
  onBack?: () => void;
  backLabel?: string;
  /** 큰 글자 아래 한 줄(예: 「거수는 따로 셉니다」). */
  note?: string | null;
  /** 열려 있는 투표면 3초마다 다시 읽는다. 닫힌 투표는 한 번만. */
  live?: boolean;
  /** 미리보기 — 주면 서버를 부르지 않고 이 값을 그린다. */
  fixture?: BallotNamedResponses | null;
}) {
  const remote = useNamedResponses(access, ballotId, !fixture, live ? POLL_MS : 0);
  const data = fixture ?? remote.data;
  const missing = fixture ? false : remote.missing;
  const failed = fixture ? false : remote.failed;
  const cols = useMemo(() => (data ? yesNoColumns(data.items, data.responses) : null), [data]);
  // 세션 스위치 「큰 화면에 이름」이 꺼져 있으면(기본) 수만 — 이름표를 그리지 않는다.
  const showNames = data?.settings?.show_names === true;
  const longest = cols ? Math.max(cols.yesNames.length, cols.noNames.length) : 0;
  // 이름표 칸 높이 실측 722px(1920×1080, 제목 두 줄) — 여유를 두고 700.
  const layout = nameGridLayout(longest, 700);
  // 두 칸(찬성·반대)이 화면 반씩(약 900px) — 그 안을 다시 2~4단으로 나눈다(4단이면 한 이름표 약 210px).
  const inner = layout;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-white px-8 py-5" data-testid="named-result-board">
      <div className="flex shrink-0 items-start justify-between gap-6">
        <div className="min-w-0">
          {sub ? <p className="text-[28px] font-bold text-[#5A6B73] tr-num">{sub}</p> : null}
          <h1
            className="font-extrabold leading-snug text-[#1F4E79]"
            // 제목은 두 줄까지만(긴 문구는 QR 화면에 전체가 있다) — 이름표 자리를 지킨다.
            style={{
              fontSize: [...title].length > 120 ? '30px' : [...title].length > 60 ? '36px' : '48px',
              wordBreak: 'keep-all',
              overflowWrap: 'anywhere',
              margin: 0,
              color: '#1F4E79',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {title}
          </h1>
          {note ? <p className="mt-1 text-[24px] font-bold text-[#8A5A00]">{note}</p> : null}
        </div>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="shrink-0 rounded-full border border-[#C4D8E4] bg-white px-5 py-3 text-[20px] font-bold text-[#1F4E79]"
          >
            {backLabel}
          </button>
        ) : null}
      </div>
      {missing ? (
        <p className="mt-10 text-[36px] font-bold text-[#5A6B73]">이름 기록을 아직 쓸 수 없습니다(서버 준비 전). 집계 수는 QR 화면에서 보입니다.</p>
      ) : !data ? (
        <p className="mt-10 text-[36px] font-bold text-[#5A6B73]">{failed ? '불러오지 못했습니다 — 다시 시도하는 중' : '불러오는 중…'}</p>
      ) : !cols ? (
        <p className="mt-10 text-[36px] font-bold text-[#5A6B73]">찬반 문항이 없는 투표입니다(제출 {data.responses.length}).</p>
      ) : (
        <div className="mt-4 grid min-h-0 flex-1 grid-cols-2 gap-6">
          <NameColumn label="찬성" count={cols.yes} names={showNames ? cols.yesNames : []} anonymous={showNames ? cols.yesAnonymous : 0} tone="yes" {...inner} />
          <NameColumn label="반대" count={cols.no} names={showNames ? cols.noNames : []} anonymous={showNames ? cols.noAnonymous : 0} tone="no" {...inner} />
        </div>
      )}
    </div>
  );
}

/**
 * 분과 의결 화면 깊은 곳(안 카드·QR)까지 운영 토큰을 내려보낸다. 미리보기(가상 데이터)는 null — 네트워크를 타지 않는다.
 */
export const NamedAccessContext = createContext<WorkshopAuthorization | null>(null);
