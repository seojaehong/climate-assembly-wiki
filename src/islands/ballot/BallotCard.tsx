import { useEffect, useMemo, useState } from 'react';
import {
  fetchBallot,
  fetchBallotResults,
  fetchBallotRoster,
  submitBallot,
  submitBallotNamed,
  type Ballot,
  type RosterRow,
  type BallotItem,
  type BallotResults,
} from '../../lib/ballot';
import { getDeviceToken, isDeviceTokenPersistent } from '../../lib/mod-console';
import {
  answeredCount,
  ballotChoices,
  decisionChoiceOf,
  getLocalSubmit,
  anonymousSubmitGate,
  getLocalVoter,
  isComplete,
  isLocalSubmitStoragePersistent,
  parseBallotUrl,
  recordLocalSubmit,
  recordLocalVoter,
  namedDoneText,
  refreshNoticeMessage,
  resolveBallotScreen,
  scaleLabels,
  subgroupVoteBadge,
  SURVEY_EVIDENCE_BOUNDARY,
  voterCopy,
  type BallotChoice,
  type LocalVoter,
} from './ballot-logic';
import {
  displayVoterName,
  responseChoiceText,
  rosterTeams,
  voterReady,
  type RosterTeam,
} from '../../lib/named-vote-logic';
import { isDivisionDecisionBallot, parseMotionStatement } from '../../lib/division-ballot-format';
import { useModalDialog } from '../mod/use-modal-dialog';

export const BALLOT_EVIDENCE_BOUNDARY = SURVEY_EVIDENCE_BOUNDARY;

export function ballotResponseCountLabel(count: number): string {
  return `기기 응답 ${count}건`;
}

// VoteCard.tsx의 Shell/CenterMessage/Eyebrow 패턴·색상을 그대로 따른다(수정 금지라 로컬 재정의).
const SCALE_BAR_COLORS = ['#23B2C3', '#2E75B6', '#4F9D3A', '#F5A623', '#135C73', '#1F4E79', '#5A6B73'];
const STATUS_ICON_PATHS: Record<string, string> = {
  '✓': 'M5 12.5 10 17l9-10',
  '!': 'M12 5v9m0 4h.01',
  '↻': 'M20 11a8 8 0 1 1-2.34-5.66M20 4v7h-7',
  '📷': 'M4 7h3l2-2h6l2 2h3v12H4zM15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  '⏱': 'M9 3h6m-3 3a7 7 0 1 1-7 7 7 7 0 0 1 7-7m0 3v4l3 2',
  '⏳': 'M7 3h10M7 21h10M8 3c0 4 2 5 4 7-2 2-4 3-4 7m8-14c0 4-2 5-4 7 2 2 4 3 4 7',
};

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
      className={`font-mono text-[12px] font-semibold uppercase ${className}`}
      style={{ letterSpacing: '.14em', ...style }}
    >
      {children}
    </div>
  );
}

function Shell({ children, align = 'center' }: { children: React.ReactNode; align?: 'center' | 'top' }) {
  const nonPersistentMode = !isDeviceTokenPersistent() || !isLocalSubmitStoragePersistent();
  return (
    <div
      className={`min-h-screen bg-[#F5F8FB] flex justify-center px-4 py-8 ${
        align === 'center' ? 'items-center' : 'items-start'
      }`}
    >
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE7EE] overflow-hidden shadow-[0_1px_2px_rgba(31,78,121,.04),0_8px_24px_-16px_rgba(31,78,121,.18)]">
        {nonPersistentMode ? (
          <p role="alert" className="border-b-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3 text-center text-[14px] font-bold text-[#6B4B00]">
            브라우저 저장소가 차단되어 이 페이지를 새로고침하면 기기 중복 확인 정보가 유지되지 않습니다.
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function CenterMessage({
  icon,
  eyebrow,
  title,
  body,
  color = '#1F4E79',
  children,
}: {
  icon: string;
  eyebrow: string;
  title: string;
  body?: string;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <Shell>
      <div className="px-7 pt-14 pb-14 flex flex-col items-center text-center">
        <div
          className="w-16 h-16 rounded-2xl grid place-items-center text-white text-3xl mb-5"
          style={{ background: color }}
          aria-hidden="true"
        >
          <svg
            aria-hidden="true"
            className="h-9 w-9"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.25}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={STATUS_ICON_PATHS[icon] ?? STATUS_ICON_PATHS['!']} />
          </svg>
        </div>
        <Eyebrow className="mb-2" style={{ color } as React.CSSProperties}>
          {eyebrow}
        </Eyebrow>
        <h1 className="text-[26px] font-extrabold text-[#1F4E79] leading-snug mb-2" style={{ letterSpacing: '-.022em' }}>
          {title}
        </h1>
        {body ? <p className="text-[#5A6B73] text-[16px] leading-relaxed">{body}</p> : null}
        {children ? <div className="w-full">{children}</div> : null}
      </div>
    </Shell>
  );
}

function InvalidScreen() {
  return (
    <CenterMessage
      icon="📷"
      eyebrow="안내"
      title="안내된 QR을 다시 스캔해 주세요"
      body="투표 링크가 올바르지 않거나 아직 공개되지 않았습니다. 현장 화면의 QR 코드를 다시 스캔해 주세요."
      color="#5A6B73"
    />
  );
}

function LoadingScreen() {
  return (
    <Shell>
      <div className="px-7 pt-14 pb-14 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#F1F7FA] animate-pulse mb-5" />
        <Eyebrow className="text-[#5A6B73] mb-2">불러오는 중</Eyebrow>
        <p className="text-[#5A6B73] text-[16px]">잠시만 기다려 주세요…</p>
      </div>
    </Shell>
  );
}

export function LoadErrorScreen({
  title,
  body,
  onRetry,
  retrying,
}: {
  title: string;
  body: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <CenterMessage icon="↻" eyebrow="연결 확인" title={title} body={body} color="#7C2D12">
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-6 min-h-[56px] w-full rounded-2xl border-2 border-[#B5651D] bg-white px-4 text-[17px] font-extrabold text-[#7C2D12] disabled:opacity-50"
      >
        {retrying ? '다시 불러오는 중…' : '다시 불러오기'}
      </button>
    </CenterMessage>
  );
}

function RefreshButton({
  onRefresh,
  refreshing,
  refreshNotice,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  refreshNotice: string | null;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="mt-5 w-full h-14 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[17px] font-bold disabled:opacity-50"
      >
        {refreshing ? '공개 여부 확인 중…' : '결과 공개 여부 확인'}
      </button>
      <p className="min-h-6 mt-3 text-[14px] leading-relaxed text-[#5A6B73]" role="status" aria-live="polite">
        {refreshNotice}
      </p>
    </>
  );
}

function DoneScreen({
  duplicate,
  decision,
  onRefresh,
  refreshing,
  refreshNotice,
  voter = null,
}: {
  duplicate: boolean;
  decision: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  refreshNotice: string | null;
  /** 실명 투표 — 이 기기에서 낸 조·이름·고른 값. */
  voter?: LocalVoter | null;
}) {
  const copy = voterCopy(decision);
  return (
    <CenterMessage
      icon={duplicate ? '!' : '✓'}
      eyebrow="제출 완료"
      title={duplicate ? '이미 제출하셨습니다' : copy.doneTitle}
      body={
        duplicate
          ? '이 기기의 답변은 정상적으로 제출되어 있습니다.'
          : copy.doneBody
      }
      color={duplicate ? '#8A4B08' : '#2D6A24'}
    >
      {voter ? (
        <p data-testid="named-done" className="mt-5 rounded-2xl border-2 border-[#2F6F25] bg-[#EAF6EE] px-4 py-3 text-[20px] font-extrabold leading-snug text-[#1F4E79]">
          {namedDoneText(voter)}
        </p>
      ) : null}
      <p className="mt-5 text-[14px] leading-relaxed text-[#5A6B73]">집계는 운영진 확인을 거쳐 공개됩니다.</p>
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />
    </CenterMessage>
  );
}

export function ClosedScreen({
  decision,
  ballotTitle,
  late = false,
  onRefresh,
  refreshing,
  refreshNotice,
}: {
  decision: boolean;
  /** 어느 투표가 마감됐는지(10/14 voter-4) — 옛 QR 로 들어온 사람이 「지금 투표가 끝났다」고 오해하지 않게. */
  ballotTitle?: string | null;
  /** 제출을 눌렀는데 이미 마감돼 표가 들어가지 않았다(10/14 voter-4). */
  late?: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  refreshNotice: string | null;
}) {
  return (
    <CenterMessage
      icon="⏱"
      eyebrow="마감"
      title={voterCopy(decision).closedTitle}
      body="집계는 운영진 확인을 거쳐 공개됩니다."
      color="#2E75B6"
    >
      {ballotTitle ? (
        <p data-testid="closed-ballot-title" className="mt-3 text-[16px] font-bold text-[#1F4E79] tr-num">
          마감된 투표: {ballotTitle}
        </p>
      ) : null}
      {late ? (
        <p
          role="alert"
          data-testid="closed-late"
          className="mt-4 rounded-2xl border-2 border-[#B91C1C] bg-[#FEF2F2] px-4 py-3 text-[19px] font-extrabold leading-snug text-[#B91C1C]"
        >
          마감 뒤에 제출되어 이 표는 반영되지 않았습니다. 손을 들어 알려 주십시오.
        </p>
      ) : null}
      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} refreshNotice={refreshNotice} />
    </CenterMessage>
  );
}

// ── 투표 화면 ─────────────────────────────────────────────────────────

export function ItemBlock({
  item,
  value,
  onSelect,
  disabled,
  decision = false,
}: {
  item: BallotItem;
  value: number | undefined;
  onSelect: (v: number) => void;
  disabled: boolean;
  /** 분과 의결 투표 — 안 제목을 크게, 안 번호는 작게. */
  decision?: boolean;
}) {
  const motion = decision ? parseMotionStatement(item.statement) : null;
  // 10/14 voter-2 — 분과 의결은 찬성을 위로, 고르면 찬성 초록·반대 빨강(저장값 1=반대·2=찬성은 그대로).
  const choices = ballotChoices(item.scale, !!motion && item.scale === 2);
  return (
    <section className="pt-6 first:pt-0" aria-label={motion ? `${motion.id} 투표` : `의제 ${item.ordinal}`}>
      {motion ? (
        <div className="mb-4" data-testid="ballot-motion">
          <p className="text-[14px] font-bold text-[#5A6B73] tr-num mb-1">안 번호 {motion.id}</p>
          <h2
            className="text-[24px] font-extrabold text-[#1F2933] leading-snug whitespace-pre-line"
            style={{ letterSpacing: '-.015em', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}
          >
            {motion.title}
          </h2>
        </div>
      ) : (
      <div className="flex items-start gap-3 mb-1.5">
        <span
          className="w-8 h-8 shrink-0 rounded-lg grid place-items-center text-[14px] font-extrabold text-white bg-[#1F4E79]"
          aria-hidden="true"
        >
          {item.ordinal}
        </span>
        <h2 className="text-[19px] font-extrabold text-[#1F2933] leading-snug" style={{ letterSpacing: '-.015em' }}>
          {item.statement}
          {!item.required ? <span className="ml-1.5 text-[13px] font-semibold text-[#5A6B73]">(선택)</span> : null}
        </h2>
      </div>
      )}
      {motion ? null : item.description ? (
        <p className="ml-11 mb-3 text-[14px] leading-relaxed text-[#5A6B73]">{item.description}</p>
      ) : (
        <div className="mb-3" />
      )}

      <div className="space-y-2" role="group" aria-label={motion ? `${motion.id} 찬반 응답` : `의제 ${item.ordinal} 응답`}>
        {choices.map(({ value: v, label, tone }) => {
          const active = value === v;
          const on = CHOICE_TONE[tone];
          return (
            <button
              key={v}
              type="button"
              onClick={() => onSelect(v)}
              disabled={disabled}
              aria-pressed={active}
              data-choice={v}
              data-tone={tone}
              className={`w-full min-h-[56px] rounded-2xl border-2 px-4 py-3 text-left text-[17px] font-bold flex items-center gap-3 transition disabled:opacity-50 ${
                active ? on.active : 'border-[#DCE7EE] bg-white text-[#1F2933]'
              }`}
            >
              <span
                className={`w-6 h-6 shrink-0 rounded-full border-2 grid place-items-center ${active ? on.dot : 'border-[#C4D8E4] bg-white'}`}
                aria-hidden="true"
              >
                {active ? <span className="w-2 h-2 rounded-full bg-white" /> : null}
              </span>
              <span className="flex-1">{label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const CHOICE_TONE: Record<BallotChoice['tone'], { active: string; dot: string; text: string; box: string }> = {
  neutral: { active: 'border-[#23B2C3] bg-[#23B2C3]/8 text-[#135C73]', dot: 'border-[#23B2C3] bg-[#23B2C3]', text: 'text-[#135C73]', box: 'border-[#23B2C3] bg-[#23B2C3]/8' },
  yes: { active: 'border-[#2F6F25] bg-[#2F6F25]/10 text-[#2F6F25]', dot: 'border-[#2F6F25] bg-[#2F6F25]', text: 'text-[#2F6F25]', box: 'border-[#2F6F25] bg-[#EAF6EE]' },
  no: { active: 'border-[#B91C1C] bg-[#B91C1C]/8 text-[#B91C1C]', dot: 'border-[#B91C1C] bg-[#B91C1C]', text: 'text-[#B91C1C]', box: 'border-[#B91C1C] bg-[#FEF2F2]' },
};

export function ConfirmDialog({
  answered,
  total,
  choice = null,
  voterLine = null,
  onCancel,
  onConfirm,
  submitting,
}: {
  answered: number;
  total: number;
  /** 분과 의결 — 고른 값을 크게 보인다(10/14 voter-2). 확인 창이 버튼을 덮어도 무엇을 골랐는지 보이게. */
  choice?: BallotChoice | null;
  /** 실명 투표 — 「1분과 3조 홍길동 님」. */
  voterLine?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>(true, () => {
    if (!submitting) onCancel();
  });
  return (
    <div className="fixed inset-0 z-50 bg-[#1F2933]/50 flex items-center justify-center px-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ballot-submit-dialog-title"
        tabIndex={-1}
        className="w-full max-w-sm bg-white rounded-3xl px-6 pt-8 pb-6 text-center shadow-xl"
      >
        <h2
          id="ballot-submit-dialog-title"
          className="text-[21px] font-extrabold text-[#1F4E79] mb-2"
          style={{ letterSpacing: '-.02em' }}
        >
          답변을 제출할까요?
        </h2>
        {voterLine ? (
          <p data-testid="confirm-voter" className="text-[19px] font-extrabold text-[#1F2933]">
            {voterLine}
          </p>
        ) : null}
        {choice ? (
          <p
            data-testid="confirm-choice"
            data-tone={choice.tone}
            className={`my-3 rounded-2xl border-2 px-4 py-3 text-[26px] font-black ${CHOICE_TONE[choice.tone].box} ${CHOICE_TONE[choice.tone].text}`}
          >
            선택: {choice.label}
          </p>
        ) : (
          <p className="text-[15px] leading-relaxed text-[#5A6B73] mb-1">
            {answered}/{total} 문항에 응답하셨습니다.
          </p>
        )}
        <p className="text-[15px] font-bold text-[#B91C1C] mb-6">제출 후에는 수정할 수 없습니다.</p>
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="w-full min-h-[56px] rounded-2xl bg-[#23B2C3] text-white text-[18px] font-bold active:scale-[.99] transition disabled:opacity-40"
        >
          {submitting ? '제출하는 중…' : '제출하기'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          data-dialog-initial-focus
          className="w-full min-h-[56px] mt-2 rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[17px] font-bold disabled:opacity-50"
        >
          다시 살펴보기
        </button>
      </div>
    </div>
  );
}

// ── 실명 투표(s28): 조 → 이름 ───────────────────────────────────────

export type VoterDraft = { team: string | null; name: string; manual?: boolean };

export function VoterPicker({
  teams,
  voter,
  onVoter,
  disabled,
}: {
  teams: RosterTeam[];
  voter: VoterDraft;
  onVoter: (v: VoterDraft) => void;
  disabled: boolean;
}) {
  const team = teams.find((t) => t.team === voter.team) ?? null;
  const chosen = !!team && displayVoterName(voter.name).length > 0 && !voter.manual;
  return (
    <section data-testid="voter-picker" aria-label="조와 이름" className="mb-6 rounded-2xl border-2 border-[#135C73] bg-[#F1F7FA] p-4">
      <p className="text-[18px] font-extrabold text-[#135C73] mb-3">1. 우리 조를 누르세요</p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="조">
        {teams.map((t) => {
          const active = voter.team === t.team;
          return (
            <button
              key={t.team}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              data-team={t.team}
              onClick={() => onVoter({ team: t.team, name: active ? voter.name : '', manual: active ? voter.manual : false })}
              className={`min-h-[60px] rounded-2xl border-2 px-2 text-[20px] font-extrabold tr-num ${
                active ? 'border-[#135C73] bg-[#135C73] text-white' : 'border-[#C4D8E4] bg-white text-[#1F2933]'
              }`}
            >
              {t.short}
            </button>
          );
        })}
      </div>

      {team ? (
        <>
          <p className="mt-5 mb-3 text-[18px] font-extrabold text-[#135C73]">2. 내 이름을 누르세요 ({team.team})</p>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="이름">
            {team.names.map((r) => {
              const active = !voter.manual && displayVoterName(voter.name) === displayVoterName(r.name);
              return (
                <button
                  key={`${r.team}-${r.name}`}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  data-name={r.name}
                  onClick={() => onVoter({ team: team.team, name: r.name, manual: false })}
                  className={`min-h-[60px] rounded-2xl border-2 px-3 text-[20px] font-bold break-all ${
                    active ? 'border-[#2F6F25] bg-[#2F6F25] text-white' : 'border-[#C4D8E4] bg-white text-[#1F2933]'
                  }`}
                >
                  {r.name}
                </button>
              );
            })}
          </div>
          {voter.manual ? (
            <label className="mt-3 block">
              <span className="text-[16px] font-bold text-[#1F4E79]">이름을 직접 적어 주세요</span>
              <input
                type="text"
                autoComplete="off"
                maxLength={80}
                disabled={disabled}
                value={voter.name}
                data-testid="voter-name-input"
                onChange={(e) => onVoter({ team: team.team, name: e.target.value, manual: true })}
                className="mt-1 h-14 w-full rounded-2xl border-2 border-[#135C73] bg-white px-4 text-[20px] font-bold"
              />
            </label>
          ) : (
            <button
              type="button"
              disabled={disabled}
              data-testid="voter-manual"
              onClick={() => onVoter({ team: team.team, name: '', manual: true })}
              className="mt-3 min-h-[56px] w-full rounded-2xl border-2 border-dashed border-[#5A6B73] bg-white px-3 text-[17px] font-bold text-[#5A6B73]"
            >
              명단에 없어요 — 이름 직접 입력
            </button>
          )}
        </>
      ) : null}

      {chosen || (voter.manual && team && displayVoterName(voter.name)) ? (
        <p data-testid="voter-chosen" className="mt-4 text-[19px] font-extrabold text-[#1F4E79]">
          {team?.team} {displayVoterName(voter.name)} 님
        </p>
      ) : null}
      <p className="mt-2 text-[14px] text-[#5A6B73]">3. 아래에서 답을 고른 뒤 제출합니다. 제출한 뒤에는 바꿀 수 없습니다.</p>
    </section>
  );
}

function VotingScreen({
  ballot,
  answers,
  onSelect,
  onRequestSubmit,
  submitting,
  error,
  teams = [],
  voter = { team: null, name: '' },
  onVoter = () => undefined,
}: {
  ballot: Ballot;
  answers: Record<string, number>;
  onSelect: (itemId: string, v: number) => void;
  onRequestSubmit: () => void;
  submitting: boolean;
  error: string | null;
  /** 실명 투표(s28) — 명단이 있으면 조·이름을 먼저 고른다. 비었으면 지금처럼 무기명. */
  teams?: RosterTeam[];
  voter?: VoterDraft;
  onVoter?: (v: VoterDraft) => void;
}) {
  const total = ballot.items.length;
  const answered = answeredCount(ballot.items, answers);
  const named = teams.length > 0;
  const voterOk = !named || voterReady(voter.team, voter.name, teams);
  const complete = isComplete(ballot.items, answers) && voterOk;
  const decision = isDivisionDecisionBallot(ballot);
  const copy = voterCopy(decision);

  return (
    <Shell align="top">
      {/* 진행률 상단 고정 */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-[#DCE7EE] px-6 py-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="flex items-center gap-2">
            <Eyebrow className="text-[#5A6B73]">{copy.eyebrow}</Eyebrow>
            {subgroupVoteBadge(ballot.subgroup, decision) ? (
              <span className="rounded-full bg-[#135C73] px-2.5 py-0.5 text-[13px] font-bold text-white">
                {subgroupVoteBadge(ballot.subgroup, decision)}
              </span>
            ) : null}
          </span>
          <span className="text-[15px] font-extrabold text-[#1F4E79] tr-num" role="status" aria-live="polite">
            {answered}/{total} 응답
          </span>
        </div>
        <div className="h-2 rounded-full bg-[#F1F7FA] overflow-hidden" aria-hidden="true">
          <div
            className="h-full rounded-full bg-[#23B2C3] transition-all"
            style={{ width: total > 0 ? `${(answered / total) * 100}%` : '0%' }}
          />
        </div>
      </div>

      <div className="px-6 pt-6 pb-8">
        {decision ? (
          // 분과 의결: 투표 제목(「N분과 의결 안 번호」)은 작게. 크게 보일 것은 아래 안 제목이다.
          <h1 className="text-[15px] font-bold text-[#5A6B73] leading-snug mb-3 tr-num">{ballot.title}</h1>
        ) : (
          <h1 className="text-[24px] font-extrabold text-[#1F4E79] leading-snug mb-2" style={{ letterSpacing: '-.022em' }}>
            {ballot.title}
          </h1>
        )}
        {ballot.instructions && !decision ? (
          <p className="text-[15px] leading-relaxed text-[#5A6B73] mb-2">{ballot.instructions}</p>
        ) : null}
        <p className="text-[13px] text-[#5A6B73] mb-4">
          {decision
            ? '찬성 또는 반대를 고른 뒤 맨 아래 [제출하기]를 누릅니다.'
            : '모든 문항에 답한 뒤 맨 아래에서 한 번에 제출합니다.'}
        </p>

        {named ? <VoterPicker teams={teams} voter={voter} onVoter={onVoter} disabled={submitting} /> : null}

        <div className="divide-y divide-[#DCE7EE]">
          {ballot.items.map((item) => (
            <ItemBlock
              key={item.id}
              item={item}
              value={answers[item.id]}
              onSelect={(v) => onSelect(item.id, v)}
              disabled={submitting}
              decision={decision}
            />
          ))}
        </div>

        {error ? (
          <div className="mt-6 flex items-center gap-2 text-[#B91C1C] text-[15px] font-semibold bg-[#FEF2F2] border border-[#DC2626]/30 rounded-xl px-4 py-2.5">
            <span aria-hidden="true">⛔</span>
            <span>{error}</span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={onRequestSubmit}
          disabled={submitting || !complete}
          className="w-full min-h-[64px] mt-6 rounded-2xl bg-[#23B2C3] text-white text-[20px] font-bold shadow-sm active:scale-[.99] transition disabled:opacity-40"
        >
          {complete
            ? '제출하기'
            : !voterOk
              ? '조와 이름을 먼저 골라 주세요'
              : `남은 문항 ${total - answered}개에 답해 주세요`}
        </button>

        <p className="text-[13px] leading-relaxed text-[#5A6B73] text-center mt-6">{copy.evidence}</p>
      </div>
    </Shell>
  );
}

// ── 결과 화면 ─────────────────────────────────────────────────────────

function ResultsScreen({ results }: { results: BallotResults | null }) {
  if (!results) return <LoadingScreen />;
  const decision = isDivisionDecisionBallot(results);
  const rcopy = voterCopy(decision);

  return (
    <Shell align="top">
      <div className="px-6 pt-8 pb-8">
        <div className="flex items-center gap-2 mb-2">
          <Eyebrow className="text-[#5A6B73]">{rcopy.resultsEyebrow}</Eyebrow>
          {subgroupVoteBadge(results.subgroup, decision) ? (
            <span className="rounded-full bg-[#135C73] px-2.5 py-0.5 text-[13px] font-bold text-white">
              {subgroupVoteBadge(results.subgroup, decision)}
            </span>
          ) : null}
        </div>
        <h1 className="text-[24px] font-extrabold text-[#1F4E79] leading-snug mb-1" style={{ letterSpacing: '-.022em' }}>
          {results.title}
        </h1>
        <p className="text-[#5A6B73] text-[14px] mb-2">{ballotResponseCountLabel(results.responses)}</p>
        <p className="text-[#5A6B73] text-[13px] leading-relaxed mb-6">{rcopy.evidence}</p>

        <div className="space-y-8">
          {results.items.map((item) => {
            const labels = scaleLabels(item.scale);
            const max = Math.max(1, ...Object.values(item.dist));
            return (
              <section key={item.id} aria-label={`의제 ${item.ordinal} 결과`}>
                <div className="flex items-start gap-2.5 mb-1">
                  <span
                    className="w-7 h-7 shrink-0 rounded-lg grid place-items-center text-[13px] font-extrabold text-white bg-[#1F4E79]"
                    aria-hidden="true"
                  >
                    {item.ordinal}
                  </span>
                  <h2 className="text-[17px] font-extrabold text-[#1F2933] leading-snug">{item.statement}</h2>
                </div>
                <p className="ml-9 text-[13px] text-[#5A6B73] mb-3 tr-num">
                  {ballotResponseCountLabel(item.n)}{item.avg != null ? ` · 평균 ${item.avg.toFixed(2)} / ${item.scale}` : ''}
                </p>

                <div className="space-y-2">
                  {labels.map((label, i) => {
                    const v = i + 1;
                    const count = item.dist[String(v)] ?? 0;
                    const pct = item.n > 0 ? Math.round((count / item.n) * 100) : 0;
                    return (
                      <div key={v}>
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-[14px] font-bold text-[#1F2933]">{label}</span>
                          <span className="text-[14px] font-extrabold text-[#1F4E79] tr-num">
                            {count}건 <span className="text-[#5A6B73] text-[12px] font-semibold">{pct}%</span>
                          </span>
                        </div>
                        <div className="h-6 rounded-md bg-[#F1F7FA] overflow-hidden">
                          <div
                            className="h-full rounded-md transition-all"
                            style={{
                              width: `${(count / max) * 100}%`,
                              background: SCALE_BAR_COLORS[i % SCALE_BAR_COLORS.length],
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <p className="text-[13px] text-[#5A6B73] text-center mt-8 pt-5 border-t border-[#DCE7EE]">
          집계는 운영진 확인을 거쳐 공개됩니다.
        </p>
      </div>
    </Shell>
  );
}

// ============================================================
// Root
// ============================================================

export default function BallotCard() {
  const parsed = typeof window !== 'undefined' ? parseBallotUrl(window.location.search) : null;
  const token = parsed?.token ?? null;

  const [ballot, setBallot] = useState<Ballot | null | undefined>(undefined);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitState, setSubmitState] = useState<'idle' | 'submitted' | 'duplicate'>('idle');
  /** 제출했는데 이미 마감 — 표가 들어가지 않았다(10/14 voter-4). */
  const [lateClosed, setLateClosed] = useState(false);
  const [locallySubmitted, setLocallySubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BallotResults | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [ballotLoadError, setBallotLoadError] = useState<string | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultReloadKey, setResultReloadKey] = useState(0);
  /** 실명 투표(s28) 명단. 빈 배열 = 무기명(지금과 같음). */
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [voter, setVoter] = useState<VoterDraft>({ team: null, name: '' });
  const [localVoter, setLocalVoter] = useState<LocalVoter | null>(null);
  const teams = useMemo(() => rosterTeams(roster), [roster]);

  const load = async ({ preserveCurrent = false }: { preserveCurrent?: boolean } = {}): Promise<Ballot | null> => {
    if (!token) return null;
    try {
      // 명단 조회가 실패하면(함수 없음 제외) 투표 화면을 띄우지 않는다 — 이름을 조용히 빼먹지 않게.
      const [b, r] = await Promise.all([fetchBallot(token), fetchBallotRoster(token)]);
      setRoster(r);
      setBallot(b);
      setBallotLoadError(null);
      if (b && getLocalSubmit(b.id)) {
        setLocallySubmitted(true);
        setLocalVoter(getLocalVoter(b.id));
      }
      return b;
    } catch (loadError) {
      console.error('투표를 불러오지 못했습니다.', loadError);
      setBallotLoadError('투표 정보를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
      if (!preserveCurrent) setBallot(undefined);
      return null;
    }
  };

  useEffect(() => {
    setBallot(undefined);
    setBallotLoadError(null);
    setResults(null);
    setResultError(null);
    setResultLoading(false);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 10/17 분과 의결 투표면 「의견조사」 대신 「투표」 문구(일반 다의제 투표는 그대로).
  const decisionBallot = !!ballot && isDivisionDecisionBallot(ballot);
  const screen = resolveBallotScreen({
    hasToken: !!token,
    ballot,
    submitted: locallySubmitted || submitState !== 'idle',
  });

  // published가 되면 결과를 가져온다(p_code 없이 — published일 때만 non-null).
  useEffect(() => {
    if (screen !== 'published' || !token) return;
    let cancelled = false;
    setResultLoading(true);
    setResultError(null);
    fetchBallotResults(token)
      .then((nextResults) => {
        if (!nextResults) throw new Error('Published ballot returned no public results.');
        if (!cancelled) setResults(nextResults);
      })
      .catch((loadError: unknown) => {
        console.error('공개된 투표 결과를 불러오지 못했습니다.', loadError);
        if (!cancelled) {
          setResultError('공개 결과를 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
        }
      })
      .finally(() => {
        if (!cancelled) setResultLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [screen, token, resultReloadKey]);

  const handleSelect = (itemId: string, v: number) => {
    setAnswers((prev) => ({ ...prev, [itemId]: v }));
  };

  const handleSubmit = async () => {
    if (!token || !ballot) return;
    setSubmitting(true);
    setError(null);
    const named = teams.length > 0;
    const voterName = displayVoterName(voter.name);
    if (named && !voterReady(voter.team, voter.name, teams)) {
      setConfirmOpen(false);
      setSubmitting(false);
      setError('조와 이름을 먼저 골라 주세요.');
      return;
    }
    if (!named) {
      // 무기명으로 내기 직전에 명단을 한 번 더 본다 — 화면을 연 뒤 실명으로 바뀌었으면 조·이름부터 받는다.
      // 명단 조회가 실패하면 무기명으로 내지 않는다(이름을 조용히 빼먹지 않게).
      let fresh: RosterRow[] | 'error';
      try {
        fresh = await fetchBallotRoster(token);
      } catch (rosterError: unknown) {
        console.error('명단을 다시 확인하지 못했습니다.', rosterError);
        fresh = 'error';
      }
      const gate = anonymousSubmitGate(fresh);
      if (gate !== 'anonymous') {
        setConfirmOpen(false);
        setSubmitting(false);
        if (gate === 'need-voter' && fresh !== 'error') {
          setRoster(fresh);
          setError('실명 투표입니다. 위에서 조와 이름을 골라 주세요.');
        } else {
          setError('연결을 확인하지 못했습니다. 잠시 뒤 다시 제출해 주세요.');
        }
        return;
      }
    }
    try {
      let result = named
        ? await submitBallotNamed(token, getDeviceToken(), answers, voter.team as string, voterName)
        : await submitBallot(token, getDeviceToken(), answers);
      // 화면을 연 뒤 운영팀이 실명 수집을 껐다 — 지금처럼 무기명으로 낸다.
      let namedSaved = named;
      if (result === 'named_off') {
        namedSaved = false;
        result = await submitBallot(token, getDeviceToken(), answers);
      }
      setConfirmOpen(false);
      const mine: LocalVoter | null = namedSaved
        ? { team: voter.team as string, name: voterName, choice: responseChoiceText(answers, ballot.items) || null }
        : null;
      if (result === 'name_taken') {
        // 같은 이름이 이미 제출됨 — 이 기기는 잠그지 않는다(조·이름을 잘못 눌렀을 수 있다).
        setError('이미 이 이름으로 제출되었습니다. 운영팀에 알려 주세요.');
      } else if (result === 'ok') {
        recordLocalSubmit(ballot.id);
        if (mine) {
          recordLocalVoter(ballot.id, mine);
          setLocalVoter(mine);
        }
        setSubmitState('submitted');
      } else if (result === 'duplicate') {
        // 이 디바이스의 제출이 이미 존재 — 로컬 기록을 보정하고 완료 화면으로.
        recordLocalSubmit(ballot.id);
        setLocalVoter(getLocalVoter(ballot.id));
        setSubmitState('duplicate');
      } else {
        // 제출 시점에 이미 마감됨 — 최신 상태(closed/published)를 다시 받아 화면 전환.
        // 마감 화면에 「이 표는 반영되지 않았습니다」를 붉게 띄운다(손을 들어 알리도록, 10/14 voter-4).
        setLateClosed(true);
        void load({ preserveCurrent: true });
      }
    } catch (submitError: unknown) {
      console.error('투표 제출에 실패했습니다.', submitError);
      setConfirmOpen(false);
      setError('제출에 실패했습니다. 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const refreshed = await load({ preserveCurrent: true });
      setRefreshNotice(
        refreshed
          ? refreshNoticeMessage(refreshed) ??
              (refreshed.status === 'closed' ? '아직 결과가 공개되지 않았습니다. 운영진 확인 후 공개됩니다.' : null)
          : '확인하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleBallotRetry = async () => {
    setRefreshing(true);
    setBallot(undefined);
    setBallotLoadError(null);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (token && ballotLoadError && ballot === undefined) {
    return (
      <LoadErrorScreen
        title="투표 화면에 연결하지 못했습니다"
        body={ballotLoadError}
        onRetry={() => void handleBallotRetry()}
        retrying={refreshing}
      />
    );
  }
  if (screen === 'invalid') return <InvalidScreen />;
  if (screen === 'loading') return <LoadingScreen />;
  if (screen === 'published') {
    if (resultError) {
      return (
        <LoadErrorScreen
          title="공개 결과에 연결하지 못했습니다"
          body={resultError}
          onRetry={() => setResultReloadKey((current) => current + 1)}
          retrying={resultLoading}
        />
      );
    }
    if (resultLoading || !results) return <LoadingScreen />;
    return <ResultsScreen results={results} />;
  }
  if (screen === 'closed') {
    return (
      <ClosedScreen
        decision={decisionBallot}
        ballotTitle={ballot?.title ?? null}
        late={lateClosed}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshNotice={refreshNotice}
      />
    );
  }
  if (screen === 'done') {
    return (
      <DoneScreen
        duplicate={submitState === 'duplicate'}
        decision={decisionBallot}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        refreshNotice={refreshNotice}
        voter={localVoter}
      />
    );
  }
  if (screen === 'active' && ballot) {
    return (
      <>
        <VotingScreen
          ballot={ballot}
          answers={answers}
          onSelect={handleSelect}
          onRequestSubmit={() => setConfirmOpen(true)}
          submitting={submitting}
          error={error}
          teams={teams}
          voter={voter}
          onVoter={(v) => {
            setVoter(v);
            setError(null);
          }}
        />
        {confirmOpen ? (
          <ConfirmDialog
            answered={answeredCount(ballot.items, answers)}
            total={ballot.items.length}
            choice={decisionChoiceOf(ballot.items, answers, decisionBallot)}
            voterLine={teams.length > 0 && voter.team ? `${voter.team} ${displayVoterName(voter.name)} 님` : null}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={handleSubmit}
            submitting={submitting}
          />
        ) : null}
      </>
    );
  }

  return <LoadingScreen />;
}
