/**
 * 11/14 의제별 의결 투표지 — 휴대폰 「넘김식」 화면(최종안 ④-1 · W04 · 고정조건 C-7).
 *
 * 한 화면에 권고안 1건 → [찬성]/[반대]를 누르면 다음 건 → 마지막에 요약(찬성 · 반대 · 미응답 + 번호) → [제출] 한 번.
 * 상태 규칙은 ballot-pager-logic.ts(순수, 시험)에 있고, 이 파일은 그리기와 시계만 맡는다.
 * 어르신 기준: 글자 크게(제목 26px · 단추 글자 30px), 찬반 단추 높이 96px · 사이 24px, 낱말 중간 줄바꿈 없음(keep-all).
 */
import { useEffect, useRef, useState } from 'react';
import type { Ballot, BallotItem } from '../../lib/ballot';
import { isPlenaryAllTitle, parseMotionStatement } from '../../lib/division-ballot-format';
import { displayVoterName, voterReady, type RosterTeam } from '../../lib/named-vote-logic';
import { useModalDialog } from '../mod/use-modal-dialog';
import { requiresAllItems } from './ballot-logic';
import {
  NO,
  YES,
  firstMissingPos,
  initialPagerState,
  motionNumber,
  pagerGo,
  pagerPress,
  pagerSubmitGate,
  pagerSummary,
  pagerTick,
  type PagerPos,
  type PagerState,
} from './ballot-pager-logic';
import { VoterPicker, type VoterDraft } from './BallotCard';

const KEEP: React.CSSProperties = { wordBreak: 'keep-all', overflowWrap: 'break-word' };

function itemTitle(item: BallotItem): string {
  return parseMotionStatement(item.statement)?.title ?? item.statement;
}

/** 11/14 전체회의 의결 투표지(「전체회의 의결 의제N 이름」) — 의제마다 띠 색을 달리해 지금 어느 의제인지 한눈에 보이게. 그 밖 투표지는 null. */
export type AgendaTheme = { no: 1 | 2 | 3; name: string; accent: string; soft: string };
const AGENDA_COLORS: Record<1 | 2 | 3, { accent: string; soft: string }> = {
  // 새 색을 만들지 않는다 — 지금 투표 화면·안내 덱에서 쓰는 남색 · 청록 · 파랑 안에서 고른다.
  1: { accent: '#1F4E79', soft: '#F1F7FA' },
  2: { accent: '#135C73', soft: '#EEF6F7' },
  3: { accent: '#2E75B6', soft: '#F0F6FC' },
};
export function agendaTheme(title: string | null | undefined): AgendaTheme | null {
  const m = /^전체회의 의결 의제([123])\s*(.*)$/.exec((title ?? '').trim());
  if (!m) return null;
  const no = Number(m[1]) as 1 | 2 | 3;
  // 이름은 투표지 제목의 줄임말이 아니라 권고카드 머리띠 원문(11/11).
  return { no, name: AGENDA_NAMES[no], ...AGENDA_COLORS[no] };
}

/** 11/14 의제 이름(권고카드_1109.pdf 「[의제N]」 · 사무국 안내). 한 장 70건 투표지에서 건마다 의제를 보여 줄 때 쓴다. */
export const AGENDA_NAMES: Record<1 | 2 | 3, string> = {
  1: '기업이 온실가스를 감축하도록 촉진하는 방안',
  2: '일회용품 줄이기 등 자원순환을 강화하는 방안',
  3: '기후시민 의식제고를 위한 교육 및 참여 활성화 방안',
};

/**
 * 건 하나의 의제 — 의제별 투표지면 제목에서, 한 장 70건 투표지(「전체회의 의결 정책권고안」)면 번호 앞자리(「2-5」 → 의제2)에서.
 * 전체회의 의결이 아니면 null.
 */
export function itemAgendaTheme(title: string | null | undefined, number: string): AgendaTheme | null {
  const byTitle = agendaTheme(title);
  if (byTitle) return byTitle;
  if (!isPlenaryAllTitle(title)) return null;
  const m = /^([123])-\d{1,2}$/.exec(number);
  if (!m) return null;
  const no = Number(m[1]) as 1 | 2 | 3;
  return { no, name: AGENDA_NAMES[no], ...AGENDA_COLORS[no] };
}

/**
 * 11/14 전체회의 의결 — 권고 번호(「1-3」)에 맞는 사무국 권고카드 그림(public/ballot/cards1114, 권고카드_1109.pdf 에서 뽑음).
 * 전체회의 의결 투표지가 아니거나 번호 모양이 다르면 null(글자 화면 그대로).
 */
export function plenaryCardSrc(title: string, number: string, hd = false): string | null {
  const theme = itemAgendaTheme(title, number);
  const m = /^([123])-(\d{1,2})$/.exec(number);
  if (!theme || !m || Number(m[1]) !== theme.no) return null;
  // 11/11 경량화 — 화면용 cards1114 는 가로 800px(현장 와이파이 총량을 줄인다), 「크게 보기」만 원래 1080px(cards1114hd).
  return `/ballot/${hd ? 'cards1114hd' : 'cards1114'}/${m[1]}-${Number(m[2])}.webp`;
}

/** 지금 자리(from)부터 n장 — 미리 받아 둘 카드 그림. 카드가 없는 건은 건너뛴다. */
export function cardPrefetchList(title: string, items: readonly BallotItem[], from: number, n: number): string[] {
  const out: string[] = [];
  for (let i = from; i < items.length && out.length < n; i++) {
    const src = plenaryCardSrc(title, motionNumber(items[i]));
    if (src) out.push(src);
  }
  return out;
}

function useCardPrefetch(srcs: string[]) {
  const key = srcs.join('|');
  useEffect(() => {
    if (!key || typeof Image === 'undefined') return;
    for (const s of key.split('|')) {
      const im = new Image();
      im.src = s;
    }
  }, [key]);
}

/** 크게 보기 — 화면 가득 카드 한 장. 단추로 키우고 줄이며, 손가락으로 밀어 본다(두 손가락 확대도 그대로 된다). */
const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3] as const;
function CardZoom({ src, hdSrc, label, onClose }: { src: string; hdSrc: string | null; label: string; onClose: () => void }) {
  const [step, setStep] = useState(2);
  // 화면용 800px(이미 받아 둔 그림)을 바로 보이고, 1080px 가 다 오면 그때 바꾼다. 1080px 가 실패하면 800px 그대로.
  const [hdReady, setHdReady] = useState(false);
  useEffect(() => {
    setHdReady(false);
    if (!hdSrc || typeof Image === 'undefined') return;
    let alive = true;
    const im = new Image();
    im.onload = () => {
      if (alive) setHdReady(true);
    };
    im.src = hdSrc;
    return () => {
      alive = false;
      im.onload = null;
    };
  }, [hdSrc]);
  const shown = hdReady && hdSrc ? hdSrc : src;
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  const btn = 'min-h-[52px] min-w-[64px] rounded-xl bg-white/95 px-3 text-[20px] font-black text-[#1F4E79] disabled:opacity-35';
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={`${label} 크게 보기`} tabIndex={-1} data-testid="card-zoom" className="fixed inset-0 z-50 flex flex-col bg-[#0F1A24]/95">
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <div className="flex gap-2">
          <button type="button" data-testid="card-zoom-out" aria-label="작게" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))} className={btn}>
            − 작게
          </button>
          <button type="button" data-testid="card-zoom-in" aria-label="크게" disabled={step === ZOOM_STEPS.length - 1} onClick={() => setStep((s) => Math.min(ZOOM_STEPS.length - 1, s + 1))} className={btn}>
            + 크게
          </button>
        </div>
        <button type="button" data-dialog-initial-focus data-testid="card-zoom-close" onClick={onClose} className="min-h-[52px] rounded-xl bg-[#1F4E79] px-4 text-[20px] font-black text-white">
          닫기 ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y pinch-zoom' }}>
        <img src={shown} data-testid="card-zoom-img" data-hd={hdReady ? '1' : '0'} alt={label} className="block h-auto max-w-none" style={{ width: `${ZOOM_STEPS[step] * 100}%` }} />
      </div>
    </div>
  );
}

function Frame({ children, accent }: { children: React.ReactNode; accent?: string | null }) {
  return (
    <div className="min-h-screen bg-[#F5F8FB] flex justify-center px-3 py-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden">
        {accent ? <div data-testid="pager-accent" aria-hidden="true" className="h-[6px]" style={{ background: accent }} /> : null}
        {children}
      </div>
    </div>
  );
}

function VoterBar({ voterLine, onChange }: { voterLine: string | null; onChange?: () => void }) {
  if (!voterLine) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[#DCE7EE] bg-[#F1F7FA] px-5 py-2">
      <span data-testid="pager-voter" className="text-[17px] font-bold text-[#1F4E79]" style={KEEP}>
        {voterLine}
      </span>
      {onChange ? (
        <button type="button" onClick={onChange} className="min-h-[44px] shrink-0 rounded-xl border border-[#C4D8E4] bg-white px-3 text-[15px] font-bold text-[#135C73]">
          이름 바꾸기
        </button>
      ) : null}
    </div>
  );
}

// ── V: 한 건 ──────────────────────────────────────────────────────────

export function PagerItemView({
  title,
  subgroup,
  items,
  pos,
  answers,
  flashValue,
  disabled,
  onChoose,
  onGo,
  voterLine,
  onChangeVoter,
}: {
  title: string;
  subgroup: string | null | undefined;
  items: readonly BallotItem[];
  pos: number;
  answers: Record<string, number>;
  /** 방금 고른 값(0.4초 표시 중). */
  flashValue: number | null;
  disabled: boolean;
  onChoose: (value: number) => void;
  onGo: (target: PagerPos) => void;
  voterLine: string | null;
  onChangeVoter?: () => void;
}) {
  const item = items[pos];
  const total = items.length;
  const current = flashValue ?? answers[item.id];
  const number = motionNumber(item);
  const choice = (value: number, label: string, tone: 'yes' | 'no') => {
    const active = current === value;
    const on =
      tone === 'yes'
        ? 'border-[#2F6F25] bg-[#2F6F25] text-white'
        : 'border-[#B91C1C] bg-[#B91C1C] text-white';
    const off = tone === 'yes' ? 'border-[#2F6F25] bg-white text-[#2F6F25]' : 'border-[#B91C1C] bg-white text-[#B91C1C]';
    return (
      <button
        type="button"
        data-testid={tone === 'yes' ? 'pager-yes' : 'pager-no'}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => onChoose(value)}
        className={`flex-1 min-h-[96px] rounded-2xl border-[3px] text-[30px] font-black flex items-center justify-center gap-2 ${active ? on : off}`}
        style={{ letterSpacing: '.08em' }}
      >
        {active ? <span aria-hidden="true">✓</span> : null}
        {label}
      </button>
    );
  };

  const theme = itemAgendaTheme(title, number);
  const all = isPlenaryAllTitle(title);
  // 한 장 70건 — 머리에 「의제N 이름」, 위치는 전체(3 / 70)와 그 의제 안(의제2 5 / 28)을 함께.
  const agendaItems = all && theme ? items.filter((it) => motionNumber(it).startsWith(`${theme.no}-`)) : null;
  const agendaPos = agendaItems ? agendaItems.findIndex((it) => it.id === item.id) + 1 : 0;
  const card = plenaryCardSrc(title, number);
  // 11/14 의제별 투표지(11/11 수정 의견) — 찬성 · 반대만. 이전 · 다음 건 단추를 두지 않는다.
  const choiceOnly = !all && !!agendaTheme(title);
  const [cardFailed, setCardFailed] = useState(false);
  // 그림이 다 받아진 카드 주소. 받기 전에는 빈 칸만 보이므로 제목 글자를 위에 보인다(받으면 화면 읽기용으로 숨긴다).
  const [loadedCard, setLoadedCard] = useState<string | null>(null);
  const cardLoaded = !!card && loadedCard === card;
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    setCardFailed(false);
    setZoom(false);
  }, [card]);
  // 다음 두 건 카드를 미리 받아 둔다(누르면 바로 다음 장).
  useCardPrefetch(cardPrefetchList(title, items, pos + 1, 2));
  return (
    <Frame accent={theme?.accent}>
      <div className="sticky top-0 z-10 bg-white border-b border-[#DCE7EE] px-5 pt-3 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          {all && theme ? (
            <span data-testid="pager-agenda" className="min-w-0" style={KEEP}>
              <span className="mr-1.5 inline-block rounded-full px-2.5 py-0.5 align-middle text-[15px] font-black text-white" style={{ background: theme.accent }}>
                의제{theme.no}
              </span>
              <span className="align-middle text-[17px] font-extrabold" style={{ color: theme.accent }}>
                {theme.name}
              </span>
              <span className="block text-[14px] font-bold text-[#5A6B73] tr-num">
                의제{theme.no} 안에서 {agendaPos} / {agendaItems?.length}
              </span>
            </span>
          ) : (
            // 머리 제목은 두 줄까지만 — 긴 투표지 제목이 세 줄로 꺾여 찬성·반대 단추를 화면 아래로 밀던 것(11/13 실측 의제2 아래 끝 929px)을 막는다.
            // 의제 이름 전체는 카드 그림 머리띠에 그대로 있다.
            <span
              data-testid="pager-title"
              title={title}
              className="min-w-0 text-[17px] font-extrabold text-[#135C73]"
              style={{ ...KEEP, ...(theme ? { color: theme.accent } : {}), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {title}
            </span>
          )}
          {/* 폭을 「28 / 28」 자리로 미리 잡는다 — 9→10번째에서 자리 수가 늘며 제목이 한 줄 더 꺾여 단추가 밀리던 것(11/13 미리보기 실측 28px)을 막는다. */}
          <span
            data-testid="pager-position"
            className="shrink-0 whitespace-nowrap text-right text-[26px] font-black text-[#1F4E79] tr-num"
            style={{ minWidth: `${String(total).length * 2 + 3}ch` }}
            role="status"
            aria-live="polite"
          >
            {pos + 1} / {total}
          </span>
        </div>
        <div className={`mt-2 flex ${total > 30 ? 'gap-px' : 'gap-[3px]'}`} aria-hidden="true">
          {items.map((it, i) => {
            const v = answers[it.id];
            const cls = i === pos ? 'bg-[#1F4E79]' : v === YES ? 'bg-[#2F6F25]' : v === NO ? 'bg-[#B91C1C]' : 'bg-[#DCE7EE]';
            return <span key={it.id} className={`h-2 flex-1 rounded-full ${cls}`} />;
          })}
        </div>
      </div>
      <VoterBar voterLine={voterLine} onChange={onChangeVoter} />

      <section className={`${card && !cardFailed ? 'px-3 pt-3' : 'px-5 pt-6'} pb-6`} aria-label={`권고안 ${number}`}>
        {card && !cardFailed ? (
          // 11/14 — 사무국 권고카드 한 장 = 투표용지 한 장. 글자는 카드 그림 안에 있고, 같은 문구를 화면 읽기용으로 둔다.
          <div data-testid="pager-card">
            <h2 data-testid="pager-title" className="sr-only">
              권고안 {number} {itemTitle(item)}
            </h2>
            <button type="button" onClick={() => setZoom(true)} aria-label={`권고안 ${number} 권고카드 크게 보기`} className="relative block w-full">
              {cardLoaded ? null : (
                // 그림을 받기 전 빈 칸 위에 번호 · 제목을 겹쳐 보인다. 칸 크기는 그림 width/height 로 미리 잡혀 있어 받은 뒤에도 단추가 움직이지 않는다.
                <div
                  data-testid="pager-title-loading"
                  aria-hidden="true"
                  className="absolute inset-0 flex flex-col items-start justify-start gap-2 p-5 text-left text-[24px] font-extrabold leading-[1.45] text-[#1F2933] whitespace-pre-line"
                  style={KEEP}
                >
                  <span className="text-[#1F4E79] tr-num">권고안 {number}</span>
                  <span>{itemTitle(item)}</span>
                </div>
              )}
              <img
                key={card}
                src={card}
                alt=""
                width={1080}
                height={1440}
                onLoad={() => setLoadedCard(card)}
                onError={() => setCardFailed(true)}
                className="block w-full h-auto rounded-2xl border border-[#DCE7EE]"
              />
            </button>
            <button
              type="button"
              data-testid="pager-zoom"
              onClick={() => setZoom(true)}
              className="mt-2 min-h-[52px] w-full rounded-2xl border-2 border-[#135C73] bg-[#F1F7FA] text-[19px] font-extrabold text-[#135C73]"
            >
              🔍 카드 크게 보기
            </button>
            {zoom ? <CardZoom src={card} hdSrc={plenaryCardSrc(title, number, true)} label={`권고안 ${number}`} onClose={() => setZoom(false)} /> : null}
          </div>
        ) : (
          <>
            <p data-testid="pager-number" className="text-[30px] font-black text-[#1F4E79] tr-num mb-3">
              권고안 {number}
            </p>
            <h2 data-testid="pager-title" className="text-[26px] font-extrabold leading-[1.45] text-[#1F2933] whitespace-pre-line" style={KEEP}>
              {itemTitle(item)}
            </h2>
          </>
        )}
        {item.description ? (
          <details className="mt-4 rounded-xl border border-[#C4D8E4] bg-[#F7FAFC] px-4 py-3">
            <summary className="cursor-pointer text-[18px] font-bold text-[#135C73]">세부권고 보기</summary>
            <p className="mt-2 whitespace-pre-line text-[17px] leading-relaxed text-[#1F2933]" style={KEEP}>
              {item.description}
            </p>
          </details>
        ) : null}

        <div className="mt-7 flex gap-6" role="group" aria-label={`권고안 ${number} 찬반`}>
          {choice(YES, '찬성', 'yes')}
          {choice(NO, '반대', 'no')}
        </div>
        <p className="mt-3 text-center text-[16px] text-[#5A6B73]" style={KEEP}>
          누르면 다음 권고안으로 넘어갑니다.
        </p>

        {choiceOnly ? null : (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            data-testid="pager-prev"
            disabled={pos === 0}
            onClick={() => onGo(pos - 1)}
            className="min-h-[64px] rounded-2xl border-2 border-[#C4D8E4] bg-white text-[20px] font-bold text-[#1F4E79] disabled:opacity-30"
          >
            ← 이전 건
          </button>
          <button
            type="button"
            data-testid="pager-next"
            onClick={() => onGo(pos + 1)}
            className="min-h-[64px] rounded-2xl border-2 border-[#C4D8E4] bg-white text-[20px] font-bold text-[#1F4E79]"
          >
            다음 건 →
          </button>
        </div>
        )}
        <button
          type="button"
          data-testid="pager-to-summary"
          onClick={() => onGo('summary')}
          className="mt-3 min-h-[64px] w-full rounded-2xl border-2 border-[#135C73] bg-[#F1F7FA] text-[20px] font-extrabold text-[#135C73]"
        >
          {choiceOnly ? '내 투표 확인하기' : '요약 보고 제출하기'}
        </button>
      </section>
    </Frame>
  );
}

// ── R: 요약 ───────────────────────────────────────────────────────────

function NumberButtons({ entries, tone, onGo }: { entries: { pos: number; number: string }[]; tone: 'no' | 'missing'; onGo: (p: number) => void }) {
  const cls =
    tone === 'no'
      ? 'border-[#B91C1C] text-[#B91C1C] bg-[#FEF2F2]'
      : 'border-[#8A4B08] text-[#8A4B08] bg-[#FFF4D6] border-dashed';
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {entries.map((e) => (
        <button
          key={e.pos}
          type="button"
          data-goto={e.pos}
          onClick={() => onGo(e.pos)}
          className={`min-h-[56px] min-w-[84px] rounded-2xl border-[3px] px-3 text-[22px] font-black tr-num ${cls}`}
        >
          {e.number}
        </button>
      ))}
    </div>
  );
}

export function PagerSummaryView({
  title,
  items,
  answers,
  submitting,
  error,
  onGo,
  onSubmit,
  voterLine,
  allRequired = false,
}: {
  title: string;
  items: readonly BallotItem[];
  answers: Record<string, number>;
  submitting: boolean;
  error: string | null;
  onGo: (target: PagerPos) => void;
  onSubmit: () => void;
  voterLine: string | null;
  /** 전체회의 의결 — 기권 불인정(11/10 주최 결정). 문항 required 와 상관없이 모든 건을 눌러야 제출. */
  allRequired?: boolean;
}) {
  const s = pagerSummary(items, answers);
  const gate = pagerSubmitGate(items, answers, allRequired);
  const blocked = gate === 'none-answered' || gate === 'required-missing';
  const firstMissing = s.unansweredItems[0] ?? null;
  const all = isPlenaryAllTitle(title);
  return (
    <Frame accent={all ? AGENDA_COLORS[1].accent : agendaTheme(title)?.accent}>
      <div className="border-b border-[#DCE7EE] px-5 pt-4 pb-3">
        <p className="text-[17px] font-extrabold text-[#135C73]" style={KEEP}>
          {all ? `제9차 기후시민회의 최종 의결 · 정책권고안 ${items.length}건` : `${title} · 권고안 ${items.length}건`}
        </p>
        <h1 className="mt-1 text-[26px] font-black text-[#1F4E79]">제출 전 확인</h1>
      </div>
      <VoterBar voterLine={voterLine} />
      {all ? (
        // 마무리말 — 인사말(첫 장) · 권고안 70장 · 이 장 = 72쪽.
        <div data-testid="pager-closing" className="relative px-5 pt-5 pb-4" style={{ background: AGENDA_COLORS[1].soft }}>
          <img src="/ballot/geudeugi.png" alt="" width={240} height={314} className="absolute right-4 bottom-3 h-[84px] w-auto" />
          <p className="pr-[80px] text-[18px] leading-[1.65] text-[#1F2933]" style={KEEP}>
            마지막 장입니다. 아래에서 고른 내용을 확인하고 [제출하기]를 눌러 주세요. 그동안 기후시민회의에 함께해 주신 시민참여단 여러분께 깊이 감사드립니다.
          </p>
        </div>
      ) : null}
      <div className="px-5 pt-5 pb-7">
        <p data-testid="pager-counts" className="rounded-2xl border-2 border-[#1F4E79] bg-[#F1F7FA] px-4 py-4 text-center text-[26px] font-black leading-snug text-[#1F2933] tr-num" style={KEEP}>
          <span className="text-[#2F6F25]">찬성 {s.yes}</span>
          <span className="text-[#5A6B73]"> · </span>
          <span className="text-[#B91C1C]">반대 {s.no}</span>
          <span className="text-[#5A6B73]"> · </span>
          <span className="text-[#8A4B08]">미응답 {s.unanswered}</span>
        </p>

        {all ? <AgendaTallyTable items={items} answers={answers} /> : null}
        {s.unansweredItems.length > 0 ? (
          <section className="mt-6" data-testid="pager-missing">
            <h2 className="text-[20px] font-extrabold text-[#8A4B08]" style={KEEP}>
              누르지 않은 권고안 {s.unanswered}건 — 번호를 누르면 그 건으로 갑니다
            </h2>
            <NumberButtons entries={s.unansweredItems} tone="missing" onGo={onGo} />
          </section>
        ) : null}
        {s.noItems.length > 0 && !(agendaTheme(title) && !all) ? (
          <section className="mt-6" data-testid="pager-nos">
            <h2 className="text-[20px] font-extrabold text-[#B91C1C]" style={KEEP}>
              반대로 고른 권고안
            </h2>
            <NumberButtons entries={s.noItems} tone="no" onGo={onGo} />
          </section>
        ) : null}

        <div className="mt-6">
          <p className="text-[17px] font-semibold text-[#5A6B73] mb-2" style={KEEP}>
            처음부터 다시 보려면
          </p>
          <button
            type="button"
            onClick={() => onGo(0)}
            className="min-h-[56px] w-full rounded-2xl border-2 border-[#C4D8E4] bg-white text-[19px] font-bold text-[#1F4E79]"
          >
            첫 건으로 돌아가기
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-6 rounded-2xl border-2 border-[#B91C1C] bg-[#FEF2F2] px-4 py-3 text-[19px] font-extrabold text-[#B91C1C]" style={KEEP}>
            {error}
          </p>
        ) : null}

        {gate === 'required-missing' ? (
          <p className="mt-6 text-[19px] font-bold text-[#8A4B08]" style={KEEP}>
            모든 권고안에 찬성 또는 반대를 눌러야 제출됩니다.
          </p>
        ) : null}
        {blocked && firstMissing ? (
          <button
            type="button"
            data-testid="pager-goto-missing"
            onClick={() => onGo(firstMissing.pos)}
            className="mt-3 min-h-[72px] w-full rounded-2xl border-[3px] border-[#8A4B08] bg-[#FFF4D6] text-[22px] font-black text-[#8A4B08] tr-num"
            style={KEEP}
          >
            누르지 않은 권고안 {firstMissing.number}부터 고르기
          </button>
        ) : null}
        {gate === 'confirm-missing' ? (
          <p className="mt-6 text-[18px] font-bold text-[#8A4B08]" style={KEEP}>
            누르지 않은 건은 기권으로 기록됩니다. 기권은 찬성으로 세지 않습니다.
          </p>
        ) : null}
        <p className="mt-3 text-[18px] font-bold text-[#B91C1C]" style={KEEP}>
          제출하면 바꿀 수 없습니다.
        </p>
        <button
          type="button"
          data-testid="pager-submit"
          disabled={blocked || submitting}
          onClick={onSubmit}
          className="mt-3 min-h-[80px] w-full rounded-2xl bg-[#1F4E79] text-white text-[26px] font-black disabled:opacity-35"
        >
          {submitting ? '제출하는 중…' : '제출하기'}
        </button>
      </div>
    </Frame>
  );
}

function MissingConfirm({ count, onCancel, onConfirm }: { count: number; onCancel: () => void; onConfirm: () => void }) {
  const ref = useModalDialog<HTMLDivElement>(true, onCancel);
  return (
    <div className="fixed inset-0 z-50 bg-[#1F2933]/50 flex items-center justify-center px-5">
      <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} className="w-full max-w-sm rounded-3xl bg-white px-6 pt-7 pb-6 text-center">
        <p className="text-[22px] font-black text-[#1F2933]" style={KEEP}>
          누르지 않은 {count}건을 기권으로 두고 제출합니다.
        </p>
        <button type="button" onClick={onConfirm} className="mt-6 min-h-[64px] w-full rounded-2xl bg-[#1F4E79] text-[22px] font-black text-white">
          그대로 제출하기
        </button>
        <button type="button" data-dialog-initial-focus onClick={onCancel} className="mt-2 min-h-[64px] w-full rounded-2xl border-2 border-[#C4D8E4] bg-white text-[20px] font-bold text-[#1F4E79]">
          돌아가서 고르기
        </button>
      </div>
    </div>
  );
}

// ── 의제 간지(11/11 피알원 · 국가기후위기대응위원회 간지 3장) ──────────────
const GANJI_BACKGROUND: Record<1 | 2 | 3, string> = {
  1: '탄소중립을 위해 기업의 온실가스 감축이 시급합니다. 기존 정책을 보완하고 실효성 있는 촉진방안을 마련할 필요가 있습니다.',
  2: '탄소중립을 위해 늘어만 가는 일회용품 사용을 줄여야 합니다. 배달 및 다회용품 사용에 대한 문화 조성 등 자원순환을 더 확대할 방법이 필요합니다.',
  3: '지속적인 기후위기대응을 위해서는 학교나 사회교육을 통해 기후시민에 대한 의식제고와 시민참여를 활성화 할 방안이 필요합니다.',
};

function AgendaGanji({ no, name, soft, accent }: { no: 1 | 2 | 3; name: string; soft: string; accent: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div data-testid="pager-hero" className="relative px-5 pt-5 pb-5" style={{ background: soft }}>
        <img src="/ballot/geudeugi.png" alt="" width={240} height={314} className="absolute right-4 bottom-3 h-[104px] w-auto" />
        <p className="pr-[92px] text-[15px] font-bold text-[#5A6B73]" style={KEEP}>
          제9차 기후시민회의 · 최종 의결
        </p>
        <p className="mt-2 inline-block rounded-full px-3 py-1 text-[17px] font-black text-white" style={{ background: accent }}>
          의제 {no}
        </p>
        <p className="mt-2 pr-[92px] text-[26px] font-black leading-[1.3]" style={{ ...KEEP, color: accent }}>
          {name}
        </p>
      </div>
    );
  }
  return (
    <div data-testid="pager-ganji" className="px-3 pt-3">
      <img
        src={`/ballot/ganji/agenda${no}.jpg`}
        alt={`의제 ${no} ${name}. 선정배경: ${GANJI_BACKGROUND[no]}`}
        width={1008}
        height={1344}
        onError={() => setFailed(true)}
        className="block w-full h-auto rounded-2xl border border-[#DCE7EE]"
      />
    </div>
  );
}

/** 이름 확인 — 고른 조·이름을 크게 보이고 한 번 더 묻는다. 「네」를 눌러야 투표가 시작된다. */
export function VoterConfirm({ team, name, onYes, onNo }: { team: string; name: string; onYes: () => void; onNo: () => void }) {
  return (
    <div data-testid="voter-confirm" className="px-5 pt-10 pb-8">
      <p className="text-[20px] font-bold text-[#5A6B73]" style={KEEP}>
        {team}
      </p>
      <h1 className="mt-2 text-[34px] font-black leading-snug text-[#1F2933]" style={KEEP}>
        <span className="text-[#1F4E79]">{name}</span> 님이 맞나요?
      </h1>
      <p className="mt-3 text-[18px] text-[#5A6B73]" style={KEEP}>
        본인 이름이 맞는지 한 번 더 확인해 주세요.
      </p>
      <button
        type="button"
        data-testid="pager-confirm-yes"
        onClick={onYes}
        className="mt-8 min-h-[72px] w-full rounded-2xl bg-[#1F4E79] text-white text-[24px] font-black"
      >
        네, 맞습니다 · 투표 시작
      </button>
      <button
        type="button"
        data-testid="pager-confirm-no"
        onClick={onNo}
        className="mt-3 min-h-[60px] w-full rounded-2xl border-2 border-[#1F4E79] bg-white text-[20px] font-extrabold text-[#1F4E79]"
      >
        아니요, 다시 고르기
      </button>
    </div>
  );
}

// ── F: 본인 확인(실명 투표지) ──────────────────────────────────────────

function VoterStep({
  title,
  instructions,
  itemCount = 0,
  teams,
  voter,
  onVoter,
  onStart,
  prefetch = [],
  initialConfirming = false,
}: {
  title: string;
  instructions?: string | null;
  itemCount?: number;
  teams: RosterTeam[];
  voter: VoterDraft;
  onVoter: (v: VoterDraft) => void;
  onStart: () => void;
  prefetch?: string[];
  /** 새로고침 — 조·이름은 되살렸지만 「네」를 아직 안 눌렀으면 확인 화면부터. */
  initialConfirming?: boolean;
}) {
  // 이름을 고르는 동안 앞 카드 몇 장을 미리 받아 둔다(첫 장이 바로 뜨게).
  useCardPrefetch(prefetch);
  const ok = voterReady(voter.team, voter.name, teams);
  const theme = agendaTheme(title);
  const all = isPlenaryAllTitle(title);
  // 11/11 상규 대표님 메일 — 이름을 고른 뒤 「OOO 님이 맞나요?」를 한 번 더 묻는다.
  const [confirming, setConfirming] = useState(initialConfirming);
  if (confirming && ok) {
    return (
      <Frame accent={all ? AGENDA_COLORS[1].accent : theme?.accent}>
        <VoterConfirm
          team={voter.team as string}
          name={displayVoterName(voter.name)}
          onYes={() => {
            setConfirming(false);
            onStart();
          }}
          onNo={() => setConfirming(false)}
        />
      </Frame>
    );
  }
  return (
    <Frame accent={all ? AGENDA_COLORS[1].accent : theme?.accent}>
      {all ? (
        <div data-testid="pager-hero" className="relative px-5 pt-5 pb-5" style={{ background: AGENDA_COLORS[1].soft }}>
          <img src="/ballot/geudeugi.png" alt="" width={240} height={314} className="absolute right-4 top-4 h-[104px] w-auto" />
          <p className="pr-[92px] text-[15px] font-bold text-[#5A6B73]" style={KEEP}>
            제9차 기후시민회의 · 최종 의결
          </p>
          <p className="mt-2 pr-[92px] text-[26px] font-black leading-[1.3] text-[#1F4E79]" style={KEEP}>
            정책권고안 {itemCount}건
          </p>
          <ul className="mt-3 space-y-1.5">
            {([1, 2, 3] as const).map((no) => (
              <li key={no} className="flex items-center gap-2" style={KEEP}>
                <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[15px] font-black text-white" style={{ background: AGENDA_COLORS[no].accent }}>
                  의제{no}
                </span>
                <span className="text-[17px] font-extrabold" style={{ color: AGENDA_COLORS[no].accent }}>
                  {AGENDA_NAMES[no]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : theme ? (
        // 11/11 피알원 — 의제별 투표지 첫 화면에 그 의제 간지(국가기후위기대응위원회 · 선정배경). 그림이 없으면 아래 띠로 물러선다.
        <AgendaGanji no={theme.no} name={theme.name} soft={theme.soft} accent={theme.accent} />
      ) : null}
      {instructions ? (
        <p data-testid="pager-greeting" className="px-5 pt-5 text-[18px] leading-[1.65] text-[#1F2933] whitespace-pre-line" style={KEEP}>
          {instructions}
        </p>
      ) : null}
      <div className="px-5 pt-5 pb-7">
        {theme || all ? null : (
          <p className="text-[17px] font-extrabold text-[#135C73]" style={KEEP}>
            {title}
          </p>
        )}
        <h1 className="mt-1 mb-4 text-[26px] font-black text-[#1F4E79]" style={KEEP}>
          먼저 조와 이름을 눌러 주세요
        </h1>
        <VoterPicker teams={teams} voter={voter} onVoter={onVoter} disabled={false} />
        <button
          type="button"
          data-testid="pager-start"
          disabled={!ok}
          onClick={() => setConfirming(true)}
          className="min-h-[72px] w-full rounded-2xl bg-[#1F4E79] text-white text-[24px] font-black disabled:opacity-35"
        >
          다음
        </button>
        <p className="mt-4 text-[16px] text-[#5A6B73]" style={KEEP}>
          이름은 1인 1표 확인에만 씁니다. 개인별 찬반은 공개하지 않습니다.
        </p>
      </div>
    </Frame>
  );
}

// ── 간지 = 의제 확인 화면(한 장 70건 투표지) ─────────────────────────────
// 한 의제의 마지막 카드 다음, 다음 의제 첫 카드 앞에 그 의제를 제대로 눌렀는지 보여 준다(찬성 · 반대 · 미응답 + 번호).
// 마지막 의제(3)는 이 화면 대신 「제출 전 확인」(의제별로 나눠 보여 줌)이 맡는다.

export type AgendaCheck = { done: 1 | 2 | 3; next: 1 | 2 | 3; positions: number[] };

function agendaOfItem(item: BallotItem | undefined): 1 | 2 | 3 | null {
  const m = item ? /^([123])-\d{1,2}$/.exec(motionNumber(item)) : null;
  return m ? (Number(m[1]) as 1 | 2 | 3) : null;
}

function agendaPositions(items: readonly BallotItem[], no: 1 | 2 | 3): number[] {
  return items.map((it, i) => (agendaOfItem(it) === no ? i : -1)).filter((i) => i >= 0);
}

/** pos 가 다음 의제의 첫 건이고(바로 앞 건이 다른 의제) 그 확인 화면을 아직 안 넘겼으면 확인 정보. 아니면 null. */
export function agendaCheckAt(items: readonly BallotItem[], pos: number, seen: ReadonlySet<number>): AgendaCheck | null {
  const next = agendaOfItem(items[pos]);
  const done = pos > 0 ? agendaOfItem(items[pos - 1]) : null;
  if (!next || !done || next === done || seen.has(next)) return null;
  return { done, next, positions: agendaPositions(items, done) };
}

/** 한 의제의 찬성 · 반대 · 미응답과 번호(위치는 투표지 전체 기준). */
function agendaTally(items: readonly BallotItem[], positions: number[], answers: Record<string, number>) {
  const s = pagerSummary(
    positions.map((p) => items[p]),
    answers,
  );
  const abs = (e: { pos: number; number: string }) => ({ pos: positions[e.pos], number: e.number });
  return { ...s, noItems: s.noItems.map(abs), unansweredItems: s.unansweredItems.map(abs) };
}

function TallyLine({ yes, no, unanswered }: { yes: number; no: number; unanswered: number }) {
  return (
    <>
      <span className="text-[#2F6F25]">찬성 {yes}</span>
      <span className="text-[#5A6B73]"> · </span>
      <span className="text-[#B91C1C]">반대 {no}</span>
      <span className="text-[#5A6B73]"> · </span>
      <span className="text-[#8A4B08]">미응답 {unanswered}</span>
    </>
  );
}

export function AgendaCheckView({
  check,
  items,
  answers,
  voterLine,
  onGo,
  onNext,
}: {
  check: AgendaCheck;
  items: readonly BallotItem[];
  answers: Record<string, number>;
  voterLine: string | null;
  onGo: (pos: number) => void;
  onNext: () => void;
}) {
  const c = AGENDA_COLORS[check.done];
  const n = AGENDA_COLORS[check.next];
  const t = agendaTally(items, check.positions, answers);
  const last = check.positions[check.positions.length - 1];
  return (
    <Frame accent={c.accent}>
      <div className="border-b border-[#DCE7EE] px-5 pt-4 pb-3" style={{ background: c.soft }}>
        <p style={KEEP}>
          <span className="mr-1.5 inline-block rounded-full px-2.5 py-0.5 align-middle text-[15px] font-black text-white" style={{ background: c.accent }}>
            의제{check.done}
          </span>
          <span className="align-middle text-[17px] font-extrabold" style={{ color: c.accent }}>
            {AGENDA_NAMES[check.done]} · 권고안 {check.positions.length}건
          </span>
        </p>
        <h1 className="mt-1 text-[26px] font-black text-[#1F4E79]" style={KEEP}>
          의제{check.done} 확인
        </h1>
      </div>
      <VoterBar voterLine={voterLine} />
      <div data-testid="pager-agenda-check" className="px-5 pt-5 pb-7">
        <p data-testid="pager-agenda-counts" className="rounded-2xl border-2 px-4 py-4 text-center text-[26px] font-black leading-snug text-[#1F2933] tr-num" style={{ ...KEEP, borderColor: c.accent, background: c.soft }}>
          <TallyLine yes={t.yes} no={t.no} unanswered={t.unanswered} />
        </p>
        {t.unansweredItems.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-[20px] font-extrabold text-[#8A4B08]" style={KEEP}>
              누르지 않은 권고안 {t.unanswered}건 — 번호를 누르면 그 건으로 갑니다
            </h2>
            <NumberButtons entries={t.unansweredItems} tone="missing" onGo={onGo} />
          </section>
        ) : null}
        {t.noItems.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-[20px] font-extrabold text-[#B91C1C]" style={KEEP}>
              반대로 고른 권고안
            </h2>
            <NumberButtons entries={t.noItems} tone="no" onGo={onGo} />
          </section>
        ) : null}
        <p className="mt-6 text-[17px] text-[#5A6B73]" style={KEEP}>
          바꾸려면 번호를 눌러 그 카드로 가서 다시 고르면 됩니다.
        </p>
        <button
          type="button"
          data-testid="pager-agenda-next"
          onClick={onNext}
          className="mt-4 min-h-[76px] w-full rounded-2xl text-[23px] font-black text-white"
          style={{ ...KEEP, background: n.accent }}
        >
          다음 · 의제{check.next} {AGENDA_NAMES[check.next]}
        </button>
        <button
          type="button"
          onClick={() => onGo(last)}
          className="mt-3 min-h-[60px] w-full rounded-2xl border-2 border-[#C4D8E4] bg-white text-[19px] font-bold text-[#1F4E79]"
        >
          ← 이전 건
        </button>
      </div>
    </Frame>
  );
}

/** 제출 전 확인(한 장 70건) — 의제마다 한 줄씩. */
function AgendaTallyTable({ items, answers }: { items: readonly BallotItem[]; answers: Record<string, number> }) {
  return (
    <ul data-testid="pager-agenda-tallies" className="mt-4 space-y-2">
      {([1, 2, 3] as const).map((no) => {
        const pos = agendaPositions(items, no);
        if (!pos.length) return null;
        const t = agendaTally(items, pos, answers);
        return (
          <li key={no} className="rounded-xl border px-3 py-2.5" style={{ borderColor: AGENDA_COLORS[no].accent, background: AGENDA_COLORS[no].soft }}>
            <p className="text-[16px] font-extrabold" style={{ ...KEEP, color: AGENDA_COLORS[no].accent }}>
              의제{no} {AGENDA_NAMES[no]} · {pos.length}건
            </p>
            <p className="text-[20px] font-black tr-num" style={KEEP}>
              <TallyLine yes={t.yes} no={t.no} unanswered={t.unanswered} />
            </p>
          </li>
        );
      })}
    </ul>
  );
}

// ── 묶음 ──────────────────────────────────────────────────────────────

export default function BallotPager({
  ballot,
  initialAnswers,
  initialPos,
  onChange,
  onSubmit,
  submitting,
  error,
  teams,
  voter,
  onVoter,
  onStarted,
}: {
  ballot: Ballot;
  initialAnswers: Record<string, number>;
  initialPos: PagerPos;
  /** 이름 확인 「네」 — 부모가 서버에 「투표 시작」을 남긴다(실패해도 진행). */
  onStarted?: () => void;
  /** 누를 때마다 — 부모가 답과 위치를 들고 임시 저장한다. */
  onChange: (answers: Record<string, number>, pos: PagerPos) => void;
  /** 제출 — 화면에 보이는 답(이 컴포넌트의 상태)을 그대로 넘긴다. */
  onSubmit: (answers: Record<string, number>) => void;
  submitting: boolean;
  error: string | null;
  teams: RosterTeam[];
  voter: VoterDraft;
  onVoter: (v: VoterDraft) => void;
}) {
  const [state, setState] = useState<PagerState>(() => initialPagerState(initialAnswers, initialPos));
  const named = teams.length > 0;
  // 조·이름을 골랐어도 이 기기에서 「네」(confirmed)를 누르기 전이면 본인 확인부터(새로고침해도 확인을 건너뛰지 않게).
  const [voterStep, setVoterStep] = useState(() => named && !(voterReady(voter.team, voter.name, teams) && voter.confirmed === true));
  const [confirmMissing, setConfirmMissing] = useState(false);
  const [seenDividers, setSeenDividers] = useState<ReadonlySet<number>>(() => new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const total = ballot.items.length;
  // 전체회의 의결 — 기권 불인정(11/10 주최 결정). 「기권으로 두고 제출」 확인 길을 열지 않는다.
  const allRequired = requiresAllItems(ballot);

  useEffect(() => {
    onChange(state.answers, state.pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.answers, state.pos]);

  useEffect(() => {
    if (!state.flash) return;
    timer.current = setTimeout(() => setState((s) => pagerTick(s, Date.now())), Math.max(0, state.flash.until - Date.now()));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state.flash]);

  // 위치가 바뀌면 화면 맨 위로(긴 제목 아래에 있던 손가락이 다음 건의 아래쪽을 누르지 않게).
  useEffect(() => {
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }, [state.pos, voterStep, seenDividers]);

  // 명단이 늦게 와서 실명으로 바뀌면 본인 확인부터.
  useEffect(() => {
    if (named && !(voterReady(voter.team, voter.name, teams) && voter.confirmed === true)) setVoterStep(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [named]);

  // 새로고침 — 이미 「네」를 누른 사람이 카드로 바로 돌아오면 「투표 시작」 기록을 한 번 더 남긴다(upsert 라 겹쳐도 안전).
  const restartRecorded = useRef(false);
  useEffect(() => {
    if (restartRecorded.current) return;
    restartRecorded.current = true;
    if (named && voterReady(voter.team, voter.name, teams) && voter.confirmed === true) {
      try {
        onStarted?.();
      } catch {
        // 기록 실패는 투표를 막지 않는다.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voterLine = named && voter.team ? `${voter.team} ${voter.name.trim()} 님` : null;
  const go = (target: PagerPos) => setState((s) => pagerGo(s, target, total, Date.now()));

  // 한 장 70건 — 의제 하나를 마치면(다음 의제 첫 건 앞) 그 의제 확인 화면(간지). [다음] 을 누르면 그 뒤로는 안 나온다.
  const check =
    !voterStep && state.pos !== 'summary' && isPlenaryAllTitle(ballot.title)
      ? agendaCheckAt(ballot.items, state.pos, seenDividers)
      : null;

  if (voterStep) {
    return <VoterStep title={ballot.title} instructions={ballot.instructions} itemCount={ballot.items.length} teams={teams} voter={voter} onVoter={onVoter} onStart={() => {
          // 먼저 넘기고 기록은 나중에 — 기록이 던져도(옛 기기) 투표 시작이 막히지 않게.
          setVoterStep(false);
          try {
            onStarted?.();
          } catch {
            // 무시 — 「투표 시작」 기록은 실패해도 투표는 이어진다.
          }
        }} prefetch={cardPrefetchList(ballot.title, ballot.items, 0, 3)}
        initialConfirming={voterReady(voter.team, voter.name, teams) && voter.confirmed !== true} />;
  }

  if (check) {
    return (
      <AgendaCheckView
        check={check}
        items={ballot.items}
        answers={state.answers}
        voterLine={voterLine}
        onGo={go}
        onNext={() => setSeenDividers((s) => new Set([...s, check.next]))}
      />
    );
  }

  if (state.pos === 'summary') {
    const gate = pagerSubmitGate(ballot.items, state.answers, allRequired);
    const missing = pagerSummary(ballot.items, state.answers).unanswered;
    const submitOrGuide = () => {
      if (gate === 'ready') onSubmit(state.answers);
      else if (gate === 'confirm-missing') setConfirmMissing(true);
      else {
        // 빠진 건이 있으면 내지 않고 그 건으로 보낸다(단추가 꺼져 있어도 한 번 더 막는다).
        const pos = firstMissingPos(ballot.items, state.answers);
        if (pos !== null) go(pos);
      }
    };
    return (
      <>
        <PagerSummaryView
          title={ballot.title}
          items={ballot.items}
          answers={state.answers}
          submitting={submitting}
          error={error}
          onGo={go}
          onSubmit={submitOrGuide}
          voterLine={voterLine}
          allRequired={allRequired}
        />
        {confirmMissing ? (
          <MissingConfirm
            count={missing}
            onCancel={() => setConfirmMissing(false)}
            onConfirm={() => {
              setConfirmMissing(false);
              onSubmit(state.answers);
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <PagerItemView
      title={ballot.title}
      subgroup={ballot.subgroup}
      items={ballot.items}
      pos={state.pos}
      answers={state.answers}
      flashValue={state.flash ? state.answers[ballot.items[state.flash.pos].id] ?? null : null}
      disabled={submitting}
      onChoose={(v) => setState((s) => pagerPress(s, ballot.items, v, Date.now()))}
      onGo={go}
      voterLine={voterLine}
      onChangeVoter={named ? () => setVoterStep(true) : undefined}
    />
  );
}
