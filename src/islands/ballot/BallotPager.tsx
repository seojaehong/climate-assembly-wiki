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
import { voterReady, type RosterTeam } from '../../lib/named-vote-logic';
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
  return { no, name: m[2].trim(), ...AGENDA_COLORS[no] };
}

/** 11/14 의제 이름(권고카드_1109.pdf 「[의제N]」 · 사무국 안내). 한 장 70건 투표지에서 건마다 의제를 보여 줄 때 쓴다. */
export const AGENDA_NAMES: Record<1 | 2 | 3, string> = {
  1: '기업 온실가스 감축 촉진',
  2: '일회용품 줄이기 등 자원순환',
  3: '기후시민 의식제고 교육',
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
export function plenaryCardSrc(title: string, number: string): string | null {
  const theme = itemAgendaTheme(title, number);
  const m = /^([123])-(\d{1,2})$/.exec(number);
  if (!theme || !m || Number(m[1]) !== theme.no) return null;
  return `/ballot/cards1114/${m[1]}-${Number(m[2])}.webp`;
}

/** 크게 보기 — 화면 가득 카드 한 장. 단추로 키우고 줄이며, 손가락으로 밀어 본다(두 손가락 확대도 그대로 된다). */
const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3] as const;
function CardZoom({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  const [step, setStep] = useState(2);
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
        <img src={src} alt={label} className="block h-auto max-w-none" style={{ width: `${ZOOM_STEPS[step] * 100}%` }} />
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
  const [cardFailed, setCardFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    setCardFailed(false);
    setZoom(false);
  }, [card]);
  // 다음 건 카드를 미리 받아 둔다(누르면 바로 다음 장).
  const nextCard = pos + 1 < total ? plenaryCardSrc(title, motionNumber(items[pos + 1])) : null;
  useEffect(() => {
    if (!nextCard || typeof Image === 'undefined') return;
    const im = new Image();
    im.src = nextCard;
  }, [nextCard]);
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
            <span className="text-[17px] font-extrabold text-[#135C73]" style={theme ? { ...KEEP, color: theme.accent } : KEEP}>
              {title}
            </span>
          )}
          <span data-testid="pager-position" className="shrink-0 whitespace-nowrap text-[26px] font-black text-[#1F4E79] tr-num" role="status" aria-live="polite">
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
            <button type="button" onClick={() => setZoom(true)} aria-label={`권고안 ${number} 권고카드 크게 보기`} className="block w-full">
              <img
                key={card}
                src={card}
                alt=""
                width={1080}
                height={1440}
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
            {zoom ? <CardZoom src={card} label={`권고안 ${number}`} onClose={() => setZoom(false)} /> : null}
            <h2 data-testid="pager-title" className="sr-only">
              권고안 {number} {itemTitle(item)}
            </h2>
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
        <button
          type="button"
          data-testid="pager-to-summary"
          onClick={() => onGo('summary')}
          className="mt-3 min-h-[64px] w-full rounded-2xl border-2 border-[#135C73] bg-[#F1F7FA] text-[20px] font-extrabold text-[#135C73]"
        >
          요약 보고 제출하기
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
        {s.noItems.length > 0 ? (
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

// ── F: 본인 확인(실명 투표지) ──────────────────────────────────────────

function VoterStep({
  title,
  instructions,
  itemCount = 0,
  teams,
  voter,
  onVoter,
  onStart,
}: {
  title: string;
  instructions?: string | null;
  itemCount?: number;
  teams: RosterTeam[];
  voter: VoterDraft;
  onVoter: (v: VoterDraft) => void;
  onStart: () => void;
}) {
  const ok = voterReady(voter.team, voter.name, teams);
  const theme = agendaTheme(title);
  const all = isPlenaryAllTitle(title);
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
        <div data-testid="pager-hero" className="relative px-5 pt-5 pb-5" style={{ background: theme.soft }}>
          <img src="/ballot/geudeugi.png" alt="" width={240} height={314} className="absolute right-4 bottom-3 h-[104px] w-auto" />
          <p className="pr-[92px] text-[15px] font-bold text-[#5A6B73]" style={KEEP}>
            제9차 기후시민회의 · 최종 의결
          </p>
          <p className="mt-2 inline-block rounded-full px-3 py-1 text-[17px] font-black text-white" style={{ background: theme.accent }}>
            의제 {theme.no}
          </p>
          <p className="mt-2 pr-[92px] text-[26px] font-black leading-[1.3]" style={{ ...KEEP, color: theme.accent }}>
            {theme.name}
          </p>
        </div>
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
          onClick={onStart}
          className="min-h-[72px] w-full rounded-2xl bg-[#1F4E79] text-white text-[24px] font-black disabled:opacity-35"
        >
          맞습니다 · 투표 시작
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
}: {
  ballot: Ballot;
  initialAnswers: Record<string, number>;
  initialPos: PagerPos;
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
  const [voterStep, setVoterStep] = useState(() => named && !voterReady(voter.team, voter.name, teams));
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
    if (named && !voterReady(voter.team, voter.name, teams)) setVoterStep(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [named]);

  const voterLine = named && voter.team ? `${voter.team} ${voter.name.trim()} 님` : null;
  const go = (target: PagerPos) => setState((s) => pagerGo(s, target, total, Date.now()));

  // 한 장 70건 — 의제 하나를 마치면(다음 의제 첫 건 앞) 그 의제 확인 화면(간지). [다음] 을 누르면 그 뒤로는 안 나온다.
  const check =
    !voterStep && state.pos !== 'summary' && isPlenaryAllTitle(ballot.title)
      ? agendaCheckAt(ballot.items, state.pos, seenDividers)
      : null;

  if (voterStep) {
    return <VoterStep title={ballot.title} instructions={ballot.instructions} itemCount={ballot.items.length} teams={teams} voter={voter} onVoter={onVoter} onStart={() => setVoterStep(false)} />;
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
