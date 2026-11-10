/**
 * 11/14 의제별 의결 투표지 — 휴대폰 「넘김식」 화면(최종안 ④-1 · W04 · 고정조건 C-7).
 *
 * 한 화면에 권고안 1건 → [찬성]/[반대]를 누르면 다음 건 → 마지막에 요약(찬성 · 반대 · 미응답 + 번호) → [제출] 한 번.
 * 상태 규칙은 ballot-pager-logic.ts(순수, 시험)에 있고, 이 파일은 그리기와 시계만 맡는다.
 * 어르신 기준: 글자 크게(제목 26px · 단추 글자 30px), 찬반 단추 높이 96px · 사이 24px, 낱말 중간 줄바꿈 없음(keep-all).
 */
import { useEffect, useRef, useState } from 'react';
import type { Ballot, BallotItem } from '../../lib/ballot';
import { parseMotionStatement } from '../../lib/division-ballot-format';
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

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F5F8FB] flex justify-center px-3 py-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden">{children}</div>
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

  return (
    <Frame>
      <div className="sticky top-0 z-10 bg-white border-b border-[#DCE7EE] px-5 pt-3 pb-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[17px] font-extrabold text-[#135C73]" style={KEEP}>
            {title}
          </span>
          <span data-testid="pager-position" className="shrink-0 whitespace-nowrap text-[26px] font-black text-[#1F4E79] tr-num" role="status" aria-live="polite">
            {pos + 1} / {total}
          </span>
        </div>
        <div className="mt-2 flex gap-[3px]" aria-hidden="true">
          {items.map((it, i) => {
            const v = answers[it.id];
            const cls = i === pos ? 'bg-[#1F4E79]' : v === YES ? 'bg-[#2F6F25]' : v === NO ? 'bg-[#B91C1C]' : 'bg-[#DCE7EE]';
            return <span key={it.id} className={`h-2 flex-1 rounded-full ${cls}`} />;
          })}
        </div>
      </div>
      <VoterBar voterLine={voterLine} onChange={onChangeVoter} />

      <section className="px-5 pt-6 pb-6" aria-label={`권고안 ${number}`}>
        <p data-testid="pager-number" className="text-[30px] font-black text-[#1F4E79] tr-num mb-3">
          권고안 {number}
        </p>
        <h2 data-testid="pager-title" className="text-[26px] font-extrabold leading-[1.45] text-[#1F2933] whitespace-pre-line" style={KEEP}>
          {itemTitle(item)}
        </h2>
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
  return (
    <Frame>
      <div className="border-b border-[#DCE7EE] px-5 pt-4 pb-3">
        <p className="text-[17px] font-extrabold text-[#135C73]" style={KEEP}>
          {title} · 권고안 {items.length}건
        </p>
        <h1 className="mt-1 text-[26px] font-black text-[#1F4E79]">제출 전 확인</h1>
      </div>
      <VoterBar voterLine={voterLine} />
      <div className="px-5 pt-5 pb-7">
        <p data-testid="pager-counts" className="rounded-2xl border-2 border-[#1F4E79] bg-[#F1F7FA] px-4 py-4 text-center text-[26px] font-black leading-snug text-[#1F2933] tr-num" style={KEEP}>
          <span className="text-[#2F6F25]">찬성 {s.yes}</span>
          <span className="text-[#5A6B73]"> · </span>
          <span className="text-[#B91C1C]">반대 {s.no}</span>
          <span className="text-[#5A6B73]"> · </span>
          <span className="text-[#8A4B08]">미응답 {s.unanswered}</span>
        </p>

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
  teams,
  voter,
  onVoter,
  onStart,
}: {
  title: string;
  teams: RosterTeam[];
  voter: VoterDraft;
  onVoter: (v: VoterDraft) => void;
  onStart: () => void;
}) {
  const ok = voterReady(voter.team, voter.name, teams);
  return (
    <Frame>
      <div className="px-5 pt-5 pb-7">
        <p className="text-[17px] font-extrabold text-[#135C73]" style={KEEP}>
          {title}
        </p>
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
  }, [state.pos, voterStep]);

  // 명단이 늦게 와서 실명으로 바뀌면 본인 확인부터.
  useEffect(() => {
    if (named && !voterReady(voter.team, voter.name, teams)) setVoterStep(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [named]);

  const voterLine = named && voter.team ? `${voter.team} ${voter.name.trim()} 님` : null;
  const go = (target: PagerPos) => setState((s) => pagerGo(s, target, total, Date.now()));

  if (voterStep) {
    return <VoterStep title={ballot.title} teams={teams} voter={voter} onVoter={onVoter} onStart={() => setVoterStep(false)} />;
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
