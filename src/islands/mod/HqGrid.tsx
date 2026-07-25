import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchHqTeams,
  fetchTeamRounds,
  fetchVoteCounts,
  fetchVotesForRounds,
  subscribeHqUpdates,
  tallyVotes,
  type HqTeam,
  type Round,
  type Vote,
} from '../../lib/mod-console';
import { fetchHqAttendanceSummaries, type HqAttendanceSummary } from '../../lib/attendance';
import { subgroupFilterOptions } from '../../lib/team-order';
import HqAttendanceAdmin from './HqAttendanceAdmin';
import {
  teamCell,
  hqConnectionState,
  latestTeamRound,
  leadingResult,
  relevantRoundIds,
  summarizeTeamCells,
  teamMatchesFilters,
  teamCellForRoundView,
  teamRoundHistoryWithResults,
  toggleComparisonSelection,
  roundIdsForSequence,
  type RoundView,
  type RoundViewCell,
  type TeamCellResult,
  type TeamRoundHistoryEntry,
} from './hq-grid-logic';
import { maxRoundSequence } from './round-sequence';
import { isOpsMode, participationParts, BROADCAST_STATUS_STYLE } from './hq-broadcast-logic';

const POLL_MS = 30000;
const STALE_AFTER_MS = 65000;

// 대형 스크린(8~15m) 가시성 — 색+텍스트 병기, hover 비의존, 고대비.
const STATUS_STYLE: Record<TeamCellResult['label'], { bg: string; text: string; dot: string }> = {
  대기: { bg: '#EEF1F3', text: '#33393F', dot: '#8A94A0' },
  투표중: { bg: '#DFF6F8', text: '#0A4A52', dot: '#1B9CAD' },
  마감: { bg: '#E6EBF3', text: '#132646', dot: '#1F4E79' },
};

/**
 * 회차별 보기에서 그 회차를 진행하지 않은 조. '대기'(=회차는 있는데 아직 안 열림)와
 * 같은 화면에 함께 뜨므로 회색 계열을 또 쓰지 않는다 — 색·점선 테두리로 한눈에 갈리게 한다.
 */
const UNHELD_STYLE = { bg: '#FFF4D6', text: '#6B4B00', dot: '#D97706' };

/** 카드가 실제로 그리는 값. participation 문구('미실시'·'집계 중')는 호출부에서 확정한다. */
type TeamCardCell = { label: RoundViewCell['label']; participation: string };

/**
 * 회차별 보기 셀을 카드 문구로 확정한다.
 * 회차를 하지 않은 조는 배지가 '미실시'라 '0/12'와 섞이지 않고, 표를 아직 못 받은 조는
 * 상태 배지는 그대로 둔 채 숫자만 낮춘다(부분 열화). 문구는 짧게 — 44px에서 카드를 넘친다.
 */
function roundViewCardCell(cell: RoundViewCell, state: 'loading' | 'failed' | 'loaded'): TeamCardCell {
  if (cell.participation != null) return { label: cell.label, participation: cell.participation };
  if (cell.label === '미실시') return { label: '미실시', participation: '—' };
  return { label: cell.label, participation: state === 'failed' ? '—' : '집계 중' };
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[13px] font-semibold uppercase ${className}`} style={{ letterSpacing: '.14em' }}>
      {children}
    </div>
  );
}

function TeamCard({
  team,
  cell,
  selected,
  compareMode,
  comparisonSelected,
  onSelect,
  attendance,
  opsMode,
}: {
  team: HqTeam;
  cell: TeamCardCell;
  selected: boolean;
  compareMode: boolean;
  comparisonSelected: boolean;
  onSelect: () => void;
  attendance: HqAttendanceSummary | undefined;
  opsMode: boolean;
}) {
  // 운영 노트북은 기존 파스텔 팔레트, 송출은 고채도 팔레트 + 좌측 색 띠.
  // '미실시'는 회차별 보기(운영 모드)에서만 나온다 — 송출 경로의 색은 그대로다.
  const style =
    cell.label === '미실시' ? UNHELD_STYLE : opsMode ? STATUS_STYLE[cell.label] : BROADCAST_STATUS_STYLE[cell.label];
  const band = opsMode || cell.label === '미실시' ? null : BROADCAST_STATUS_STYLE[cell.label].band;
  const participation = participationParts(cell);
  // 보조 텍스트: 송출은 흰 배경 대비 11.5:1(#33393F), 운영은 기존 색 유지(AC #5).
  const mutedText = opsMode ? 'text-[#5A6B73]' : 'text-[#33393F]';
  return (
    <button
      type="button"
      aria-label={
        cell.label === '미실시'
          ? `${team.name}, 이 회차 미실시`
          : compareMode
            ? `${team.name} 비교 ${comparisonSelected ? '선택 해제' : '선택'}, ${cell.label}, 참여 ${cell.participation}`
            : opsMode
              ? `${team.name} 상세 보기, ${cell.label}, 참여 ${cell.participation}`
              : `${team.name}, ${cell.label}, 참여 ${cell.participation}`
      }
      aria-pressed={compareMode ? comparisonSelected : selected}
      onClick={onSelect}
      className={`${
        opsMode ? 'min-h-[158px] border' : 'h-full min-h-0 overflow-hidden border-2 border-l-[12px]'
      } w-full rounded-2xl bg-white p-4 flex flex-col ${
        opsMode ? 'gap-3' : 'gap-2'
      } text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#23B2C3]/40 ${
        selected || comparisonSelected
          ? 'border-[#1F4E79] ring-2 ring-[#1F4E79]/20'
          : cell.label === '미실시'
            ? // 색만이 아니라 선 모양으로도 갈린다 — 15장을 훑을 때 '대기'와 헷갈리지 않게.
              'border-dashed border-[#D97706]'
            : opsMode
              ? 'border-[#DCE7EE]'
              : /* = BROADCAST_BORDER_COLOR */ 'border-[#7A9AAF]'
      }`}
      // 좌측 띠만 인라인으로 덮는다(border-color 단축 속성을 쓰지 않아 순서 의존이 없다).
      style={band ? { borderLeftColor: band } : undefined}
    >
      <div
        className={
          opsMode
            ? 'flex items-start justify-between gap-2'
            : 'flex flex-col items-start gap-2 shrink-0'
        }
      >
        <div>
          <div
            className={`${
              opsMode ? 'text-[22px] sm:text-[24px]' : 'text-[40px]'
            } font-extrabold text-[#1F2933] leading-tight whitespace-nowrap`}
            style={{ letterSpacing: '-.01em' }}
          >
            {team.name}
          </div>
        </div>
        <div
          className={`flex items-center rounded-full shrink-0 ${
            opsMode ? 'gap-1.5 px-2.5 py-1.5' : 'gap-2 px-3 py-1'
          }`}
          style={{ background: style.bg, color: style.text }}
        >
          <span
            className={`${opsMode ? 'w-2.5 h-2.5' : 'w-5 h-5'} rounded-full shrink-0 ${
              !opsMode && cell.label === '투표중' ? 'animate-pulse' : ''
            }`}
            style={{ background: style.dot }}
            aria-hidden="true"
          />
          <span
            className={`${
              opsMode ? 'text-[14px]' : 'text-[32px] leading-tight'
            } font-bold whitespace-nowrap`}
          >
            {cell.label}
          </span>
        </div>
      </div>
      <div className={opsMode ? 'mt-auto' : 'mt-auto shrink-0'}>
        <div className="flex items-end justify-between gap-3">
          <Eyebrow className={`${mutedText} pb-1`}>참여</Eyebrow>
          {team.subgroup ? <span className={`text-[12px] font-semibold ${mutedText}`}>{team.subgroup}</span> : null}
        </div>
        {opsMode ? (
          <div className="text-[44px] sm:text-[48px] font-extrabold text-[#1F4E79] leading-none tr-num whitespace-nowrap">
            {cell.participation}
          </div>
        ) : (
          <div className="flex items-baseline gap-1 leading-none whitespace-nowrap">
            <span className="text-[88px] font-extrabold text-[#1F4E79] leading-none tr-num">
              {participation.votes}
            </span>
            {participation.total ? (
              <span className="text-[32px] font-extrabold text-[#33393F] leading-none tr-num">
                /{participation.total}
              </span>
            ) : null}
          </div>
        )}
      </div>
      {attendance ? (
        opsMode ? (
          <div className="grid grid-cols-3 gap-1.5 border-t pt-3 text-center border-[#DCE7EE]">
            <div><div className={`text-[11px] font-bold ${mutedText}`}>현재/전체</div><div className="font-extrabold text-[#1F4E79]">{attendance.current_present}/{attendance.roster_total}</div></div>
            <div><div className={`text-[11px] font-bold ${mutedText}`}>지각</div><div className="font-extrabold text-[#6B4B00]">{attendance.late}</div></div>
            <div><div className={`text-[11px] font-bold ${mutedText}`}>결석</div><div className="font-extrabold text-[#8B1A1A]">{attendance.absent}</div></div>
            <div><div className={`text-[11px] font-bold ${mutedText}`}>조퇴</div><div className="font-extrabold text-[#6B4B00]">{attendance.early_leave}</div></div>
            <div className="col-span-2"><div className={`text-[11px] font-bold ${mutedText}`}>미확인</div><div className={`font-extrabold ${mutedText}`}>{attendance.unconfirmed}</div></div>
          </div>
        ) : (
          // 송출: '현재/전체' 한 항목만. 라벨과 숫자를 세로로 쌓는다 — 한 줄로 두면
          // 28px 라벨(≈140px) + 64px 숫자(≈160px)가 카드 내용 폭 223px을 넘어 무성 클리핑이 난다.
          <div className="border-t border-[#7A9AAF] pt-2">
            <div className={`text-[28px] font-bold leading-none whitespace-nowrap ${mutedText}`}>현재/전체</div>
            <div className="text-[64px] font-extrabold leading-none tr-num whitespace-nowrap text-[#1F4E79]">
              {attendance.current_present}/{attendance.roster_total}
            </div>
          </div>
        )
      ) : null}
      {opsMode ? (
        <span className="text-[12px] font-bold text-[#1F4E79]">
          {compareMode ? (comparisonSelected ? '비교 선택됨 ✓' : '비교에 추가 +') : '상세 보기 →'}
        </span>
      ) : null}
    </button>
  );
}

const ROUND_STATUS_LABEL: Record<Round['status'], string> = {
  pending: '대기',
  active: '진행 중',
  closed: '마감',
};

/**
 * 라운드 상태 → 카드 상태 팔레트 키. 세 상태를 모두 적어 라벨과 색이 어긋나지 않게 한다
 * (2분기로 쓰면 pending이 '대기' 글자에 '마감' 네이비를 입는다 — 타입체커는 유효한 키라 통과시킨다).
 */
const ROUND_STATUS_TONE: Record<Round['status'], TeamCellResult['label']> = {
  pending: '대기',
  active: '투표중',
  closed: '마감',
};

/** 이력 한 줄의 총 표수·선두 표기. 조회 전('불러오는 중')과 조회 실패('—')를 반드시 가른다. */
function historyFigures(
  entry: TeamRoundHistoryEntry,
  historyState: 'loading' | 'failed' | 'loaded',
): { total: string; leader: string } {
  if (entry.total == null) {
    return { total: historyState === 'loading' ? '불러오는 중' : '—', leader: '—' };
  }
  if (entry.leader == null) return { total: `${entry.total}표`, leader: '표 없음' };
  return { total: `${entry.total}표`, leader: `${entry.leader.option}${entry.leader.tied ? ' (공동)' : ''}` };
}

function TeamDetailPanel({
  team,
  cell,
  round,
  votes,
  entries,
  historyState,
  updatedAt,
  onSelectRound,
  onRetryHistory,
  onClose,
}: {
  team: HqTeam;
  cell: TeamCellResult;
  round: Round | null;
  votes: Vote[];
  entries: TeamRoundHistoryEntry[];
  historyState: 'loading' | 'failed' | 'loaded';
  updatedAt: Date | null;
  onSelectRound: (roundId: string) => void;
  onRetryHistory: () => void;
  onClose: () => void;
}) {
  const tally = round ? tallyVotes(round, votes) : null;
  const leader = leadingResult(round, votes);
  const selectedEntry = round ? (entries.find((entry) => entry.id === round.id) ?? null) : null;
  // 표를 못 받아온 회차에서 빈 막대를 그리면 '0표'로 읽힌다 — 결과 대신 실패 안내를 낸다.
  const resultsKnown = selectedEntry == null || selectedEntry.total != null;
  const options = round
    ? Object.entries(tally?.byOption ?? {}).sort(
        ([optionA, countA], [optionB, countB]) => countB - countA || optionA.localeCompare(optionB, 'ko-KR'),
      )
    : [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="조 상세 닫기"
        className="absolute inset-0 bg-[#132646]/45"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-detail-title"
        className="relative z-10 flex h-full w-full max-w-[520px] flex-col overflow-y-auto bg-[#F5F8FB] shadow-2xl"
      >
        <header className="sticky top-0 z-10 border-b border-[#DCE7EE] bg-white px-5 py-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Eyebrow className="text-[#5A6B73]">Team detail · Read-only</Eyebrow>
              <h2 id="team-detail-title" className="mt-1 text-[30px] font-extrabold leading-tight text-[#1F4E79]">
                {team.name}
              </h2>
            </div>
            <button
              type="button"
              autoFocus
              onClick={onClose}
              className="min-h-11 min-w-11 rounded-full border border-[#C4D8E4] bg-white text-[24px] font-bold text-[#1F4E79] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#23B2C3]/40"
              aria-label={`${team.name} 상세 닫기`}
            >
              ×
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[#EEF4F8] px-4 py-3">
              <div className="text-[12px] font-bold text-[#5A6B73]">현재 상태</div>
              <div className="mt-1 text-[20px] font-extrabold text-[#1F2933]">{cell.label}</div>
            </div>
            <div className="rounded-xl bg-[#EEF4F8] px-4 py-3">
              <div className="text-[12px] font-bold text-[#5A6B73]">참여</div>
              <div className="mt-1 text-[20px] font-extrabold text-[#1F4E79] tr-num">{cell.participation}</div>
            </div>
          </div>
        </header>

        <div className="space-y-5 p-5 sm:p-7">
          {/* 회차가 하나뿐인 조에서는 목록을 그리지 않는다 — 고를 것이 없으면 화면만 어지럽다. */}
          {entries.length > 1 ? (
            <div className="rounded-2xl border border-[#DCE7EE] bg-white p-5">
              <div className="flex items-end justify-between gap-3">
                <h3 className="text-[19px] font-extrabold text-[#1F2933]">이 조의 투표 이력</h3>
                <span className="text-[13px] font-bold text-[#5A6B73] tr-num">총 {entries.length}회</span>
              </div>
              {historyState === 'failed' ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3">
                  <span className="text-[14px] font-bold leading-relaxed text-[#B5651D]">
                    지난 회차의 표수를 불러오지 못했습니다. 회차와 제목은 그대로 볼 수 있습니다.
                  </span>
                  <button
                    type="button"
                    onClick={onRetryHistory}
                    className="min-h-11 rounded-xl border-2 border-[#B5651D] bg-white px-4 text-[14px] font-extrabold text-[#B5651D] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#23B2C3]/40"
                  >
                    지금 다시 시도
                  </button>
                </div>
              ) : null}
              <ul className="mt-3 space-y-2">
                {entries.map((entry) => {
                  const current = entry.id === round?.id;
                  const figures = historyFigures(entry, historyState);
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => onSelectRound(entry.id)}
                        aria-current={current ? 'true' : undefined}
                        aria-label={`${entry.sequence}차 ${entry.title}, ${ROUND_STATUS_LABEL[entry.status]}, 총 ${figures.total}, 선두 ${figures.leader}`}
                        className={`w-full rounded-xl border-2 px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#23B2C3]/40 ${
                          current ? 'border-[#1F4E79] bg-[#EEF4F8]' : 'border-[#DCE7EE] bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="shrink-0 rounded-lg border border-[#DCE7EE] bg-[#F1F7FA] px-2.5 py-1 text-[15px] font-extrabold text-[#1F4E79] tr-num">
                            {entry.sequence}차
                          </span>
                          <span className="flex-1 text-[16px] font-bold leading-snug text-[#1F2933]">{entry.title}</span>
                          <span
                            className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold"
                            style={{
                              background: STATUS_STYLE[ROUND_STATUS_TONE[entry.status]].bg,
                              color: STATUS_STYLE[ROUND_STATUS_TONE[entry.status]].text,
                            }}
                          >
                            {ROUND_STATUS_LABEL[entry.status]}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] font-semibold text-[#33393F]">
                          <span className="tr-num">총 {figures.total}</span>
                          <span>선두 {figures.leader}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {round ? (
            <>
              <div className="rounded-2xl border border-[#DCE7EE] bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Eyebrow className="text-[#5A6B73]">
                    {selectedEntry ? `${selectedEntry.sequence}차 투표 질문` : '최근 투표 질문'}
                  </Eyebrow>
                  <span className="rounded-full bg-[#E6EBF3] px-3 py-1 text-[12px] font-bold text-[#132646]">
                    {round.status === 'active' ? '투표 진행 중' : '투표 마감'}
                  </span>
                </div>
                <h3 className="mt-3 text-[23px] font-extrabold leading-snug text-[#1F2933]">{round.title}</h3>
                {!resultsKnown ? (
                  <div className="mt-4 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3 text-[14px] font-bold leading-relaxed text-[#B5651D]">
                    이 회차의 표를 아직 불러오지 못했습니다. 위 '지금 다시 시도'를 눌러 주세요.
                  </div>
                ) : leader ? (
                  <div className="mt-4 rounded-xl bg-[#DFF6F8] px-4 py-3 text-[#0A4A52]">
                    <div className="text-[13px] font-bold">선두 선택지{leader.tied ? ' · 공동 선두' : ''}</div>
                    <div className="mt-1 text-[18px] font-extrabold">{leader.option}</div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl bg-[#EEF1F3] px-4 py-3 text-[14px] font-semibold text-[#5A6B73]">
                    아직 집계된 표가 없습니다.
                  </div>
                )}
              </div>

              {/* 표를 못 받아온 회차에서는 0% 막대를 그리지 않는다 — '전원 기권'으로 오독된다. */}
              {resultsKnown ? (
                <div className="rounded-2xl border border-[#DCE7EE] bg-white p-5">
                  <div className="flex items-end justify-between gap-3">
                    <h3 className="text-[19px] font-extrabold text-[#1F2933]">선택지별 결과</h3>
                    <span className="text-[13px] font-bold text-[#5A6B73]">참여 {tally?.total ?? 0}명</span>
                  </div>
                  <div className="mt-4 space-y-4">
                    {options.map(([option, count]) => {
                      const percentage = tally && tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
                      return (
                        <div key={option}>
                          <div className="flex items-start justify-between gap-4 text-[15px]">
                            <span className="font-bold text-[#1F2933]">{option}</span>
                            <span className="shrink-0 font-extrabold text-[#1F4E79] tr-num">
                              {count}표 · {percentage}%
                            </span>
                          </div>
                          <div className="mt-2 h-3 overflow-hidden rounded-full bg-[#E6EBF3]">
                            <div
                              className="h-full rounded-full bg-[#23B2C3]"
                              style={{ width: `${Math.min(percentage, 100)}%` }}
                              aria-hidden="true"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-[#F0D28A] bg-[#FFF9E8] p-4 text-[14px] leading-relaxed text-[#5B450B]">
                <strong className="block text-[#6B4B00]">운영 참고용 조별 투표 결과</strong>
                이 결과는 조별 논의 흐름을 확인하기 위한 것이며, 공식 권고안으로 확정된 내용이 아닙니다.
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-[#DCE7EE] bg-white p-8 text-center">
              <div className="text-[44px]" aria-hidden="true">🗳️</div>
              <h3 className="mt-3 text-[20px] font-extrabold text-[#1F2933]">아직 진행된 조별 투표가 없습니다</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#5A6B73]">
                모더레이터가 투표를 열면 최근 질문과 선택지별 결과가 이곳에 표시됩니다.
              </p>
            </div>
          )}
          <p className="text-center text-[12px] font-semibold text-[#5A6B73]">
            마지막 데이터 갱신 {updatedAt ? formatTime(updatedAt) : '—'}
          </p>
        </div>
      </section>
    </div>
  );
}

function TeamComparisonPanel({
  teams,
  rounds,
  voteCounts,
  votesByRound,
  onRemove,
}: {
  teams: HqTeam[];
  rounds: Round[];
  voteCounts: Record<string, number>;
  votesByRound: Record<string, Vote[]>;
  onRemove: (teamId: string) => void;
}) {
  if (teams.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#9CB7C8] bg-white px-5 py-6 text-center">
        <div className="text-[17px] font-extrabold text-[#1F2933]">아직 비교할 조를 선택하지 않았습니다</div>
        <p className="mt-1 text-[14px] text-[#5A6B73]">아래 조 카드에서 최대 3개 조를 선택해 주세요.</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="comparison-title">
      <h2 id="comparison-title" className="mb-3 text-[20px] font-extrabold text-[#1F2933]">조별 비교 결과</h2>
      <div className={`grid gap-3 ${teams.length === 1 ? 'grid-cols-1' : teams.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
        {teams.map((team) => {
          const cell = teamCell(team, rounds, voteCounts);
          const round = latestTeamRound(team.id, rounds);
          const leader = leadingResult(round, round ? (votesByRound[round.id] ?? []) : []);
          return (
            <article key={team.id} className="rounded-2xl border border-[#C4D8E4] bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[21px] font-extrabold text-[#1F4E79]">{team.name}</h3>
                  <p className="mt-1 text-[13px] font-bold text-[#5A6B73]">{team.subgroup ?? '분과 미지정'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(team.id)}
                  className="min-h-11 rounded-full border border-[#C4D8E4] px-3 text-[13px] font-bold text-[#1F4E79] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#23B2C3]/40"
                  aria-label={`${team.name} 비교에서 제외`}
                >
                  제외
                </button>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#EEF4F8] px-3 py-3">
                  <dt className="text-[12px] font-bold text-[#5A6B73]">상태</dt>
                  <dd className="mt-1 text-[18px] font-extrabold text-[#1F2933]">{cell.label}</dd>
                </div>
                <div className="rounded-xl bg-[#EEF4F8] px-3 py-3">
                  <dt className="text-[12px] font-bold text-[#5A6B73]">참여</dt>
                  <dd className="mt-1 text-[18px] font-extrabold text-[#1F4E79] tr-num">{cell.participation}</dd>
                </div>
              </dl>
              <div className="mt-3 rounded-xl border border-[#DCE7EE] p-3">
                <div className="text-[12px] font-bold text-[#5A6B73]">최근 질문</div>
                <div className="mt-1 min-h-[44px] text-[15px] font-bold leading-snug text-[#1F2933]">
                  {round?.title ?? '진행된 투표 없음'}
                </div>
                <div className="mt-3 border-t border-[#DCE7EE] pt-3 text-[12px] font-bold text-[#5A6B73]">
                  현재 선두
                </div>
                <div className="mt-1 text-[15px] font-extrabold text-[#0A4A52]">
                  {leader ? `${leader.option}${leader.tied ? ' · 공동 선두' : ''}` : '집계 결과 없음'}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** /hq 본부용 15조 읽기전용 현황 그리드. */
export default function HqGrid() {
  // 기본은 송출 모드(false). SSR/hydration 시점에 대형 스크린으로 조작 UI가 새지 않게 한다.
  const [opsMode] = useState(() =>
    typeof window === 'undefined' ? false : isOpsMode(window.location.search),
  );
  const [teams, setTeams] = useState<HqTeam[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [votesByRound, setVotesByRound] = useState<Record<string, Vote[]>>({});
  const [attendanceByTeam, setAttendanceByTeam] = useState<Record<string, HqAttendanceSummary>>({});
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [statusFilter, setStatusFilter] = useState<'전체' | TeamCellResult['label']>('전체');
  const [subgroupFilter, setSubgroupFilter] = useState('전체');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  // 지난 회차 표는 상세 패널을 열 때만 조회한다 — 전역 폴링(30초)에 얹으면 송출 화면까지
  // 매번 전 회차 표를 받게 된다. 진행 중 라운드는 계속 votesByRound(전역)가 최신값을 준다.
  const [historyVotesByRound, setHistoryVotesByRound] = useState<Record<string, Vote[]>>({});
  const [historyState, setHistoryState] = useState<'loading' | 'failed' | 'loaded'>('loading');
  const [historyRoundId, setHistoryRoundId] = useState<string | null>(null);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  // 회차별 보기(운영 모드 전용). 송출 모드에는 선택 UI가 없어 항상 'current'로 남는다.
  const [roundView, setRoundView] = useState<RoundView>('current');
  const [sequenceCounts, setSequenceCounts] = useState<Record<string, number>>({});
  const [sequenceState, setSequenceState] = useState<'loading' | 'failed' | 'loaded'>('loaded');
  const [sequenceReloadKey, setSequenceReloadKey] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonTeamIds, setComparisonTeamIds] = useState<string[]>([]);
  const [comparisonMessage, setComparisonMessage] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    try {
      const [nextTeams, nextRounds, attendanceSummaries] = await Promise.all([
        fetchHqTeams(),
        fetchTeamRounds(),
        fetchHqAttendanceSummaries(),
      ]);
      const ids = relevantRoundIds(nextTeams, nextRounds);
      const [counts, nextVotesByRound] = await Promise.all([fetchVoteCounts(ids), fetchVotesForRounds(ids)]);
      const completedAt = new Date();
      setTeams(nextTeams);
      setRounds(nextRounds);
      setVoteCounts(counts);
      setVotesByRound(nextVotesByRound);
      setAttendanceByTeam(Object.fromEntries(attendanceSummaries.map((item) => [item.team_id, item])));
      setUpdatedAt(completedAt);
      setNowMs(completedAt.getTime());
      setRefreshError(null);
    } catch (error) {
      console.error('[HQ] refresh failed', error);
      setRefreshError('조 현황을 갱신하지 못했습니다.');
    } finally {
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeHqUpdates(() => void refresh());
    const interval = setInterval(() => void refresh(), POLL_MS);
    const clock = setInterval(() => setNowMs(Date.now()), 5000);
    return () => {
      unsubscribe();
      clearInterval(interval);
      clearInterval(clock);
    };
  }, [refresh]);

  useEffect(() => {
    const restoreTeamFromUrl = () => {
      const teamId = new URL(window.location.href).searchParams.get('team');
      setSelectedTeamId(teamId);
    };
    restoreTeamFromUrl();
    window.addEventListener('popstate', restoreTeamFromUrl);
    return () => window.removeEventListener('popstate', restoreTeamFromUrl);
  }, []);

  const setTeamSelection = useCallback((teamId: string | null) => {
    const url = new URL(window.location.href);
    if (teamId) url.searchParams.set('team', teamId);
    else url.searchParams.delete('team');
    window.history.pushState({}, '', url);
    setSelectedTeamId(teamId);
  }, []);

  const cells = useMemo(
    () => new Map(teams.map((team) => [team.id, teamCell(team, rounds, voteCounts)])),
    [rounds, teams, voteCounts],
  );
  const summary = useMemo(() => summarizeTeamCells(teams, rounds, voteCounts), [rounds, teams, voteCounts]);
  const maxSequence = useMemo(() => maxRoundSequence(rounds), [rounds]);
  // 회차별 보기에서 조회할 라운드 집합을 문자열 키로 좁힌다(US-012와 같은 idiom).
  // 전역 갱신 시각을 deps에 함께 넣어 **진행 중인 회차**를 보는 동안 숫자가 얼어붙지 않게 한다.
  // 재조회 중에도 sequenceCounts를 비우지 않으므로 카드에는 마지막 숫자가 계속 남는다.
  const lastRefreshMs = updatedAt?.getTime() ?? 0;
  const sequenceRoundKey = useMemo(
    () => (roundView === 'current' ? '' : [...roundIdsForSequence(teams, rounds, roundView)].sort().join(',')),
    [rounds, roundView, teams],
  );

  useEffect(() => {
    if (!sequenceRoundKey) {
      setSequenceCounts((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      setSequenceState('loaded');
      return;
    }
    const ids = sequenceRoundKey.split(',');
    let cancelled = false;
    setSequenceState('loading');
    fetchVotesForRounds(ids)
      .then((votesByRoundId) => {
        if (cancelled) return;
        setSequenceCounts(
          Object.fromEntries(Object.entries(votesByRoundId).map(([roundId, votes]) => [roundId, votes.length])),
        );
        setSequenceState('loaded');
      })
      .catch((error) => {
        console.error('[HQ] round view counts failed', error);
        if (!cancelled) setSequenceState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [lastRefreshMs, sequenceReloadKey, sequenceRoundKey]);

  // 카드에 그릴 값. '현재'와 N차가 같은 함수를 지나므로 두 경로가 서로 어긋날 수 없다.
  const cardCells = useMemo(
    () =>
      new Map<string, TeamCardCell>(
        teams.map((team) => [
          team.id,
          roundViewCardCell(
            teamCellForRoundView(team, rounds, roundView === 'current' ? voteCounts : sequenceCounts, roundView),
            sequenceState,
          ),
        ]),
      ),
    [rounds, roundView, sequenceCounts, sequenceState, teams, voteCounts],
  );
  // 조 도착 순서가 아니라 분과 번호 순으로 고정한다(전체 → 1분과 → 2분과 → 3분과).
  const subgroups = useMemo(() => subgroupFilterOptions(teams), [teams]);
  const visibleTeams = useMemo(
    () =>
      teams.filter((team) =>
        teamMatchesFilters(team, cells.get(team.id) ?? { label: '대기', participation: `0/${team.capacity}` }, statusFilter, subgroupFilter),
      ),
    [cells, statusFilter, subgroupFilter, teams],
  );
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const selectedRound = selectedTeam ? latestTeamRound(selectedTeam.id, rounds) : null;
  // 조회할 라운드 집합을 문자열 키로 좁힌다 — rounds는 30초마다 새 배열이 되지만
  // 내용이 그대로면 지난 회차를 다시 받아올 이유가 없다(마감된 표는 변하지 않는다).
  const historyRoundKey = useMemo(
    () =>
      selectedTeamId
        ? rounds
            .filter((round) => round.team_id === selectedTeamId)
            .map((round) => round.id)
            .sort()
            .join(',')
        : '',
    [rounds, selectedTeamId],
  );

  useEffect(() => {
    if (!selectedTeamId) return;
    const ids = historyRoundKey ? historyRoundKey.split(',') : [];
    if (ids.length === 0) {
      setHistoryVotesByRound({});
      setHistoryState('loaded');
      return;
    }
    let cancelled = false;
    setHistoryState('loading');
    fetchVotesForRounds(ids)
      .then((next) => {
        if (cancelled) return;
        setHistoryVotesByRound(next);
        setHistoryState('loaded');
      })
      .catch((error) => {
        console.error('[HQ] round history votes failed', error);
        if (!cancelled) setHistoryState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [historyRoundKey, historyReloadKey, selectedTeamId]);

  // 다른 조를 열면 회차 선택은 기본값(현재 라운드)으로 돌아간다.
  // historyState도 함께 되돌린다 — 안 그러면 A조에서 조회에 실패한 뒤 B조를 열 때
  // 아직 시도조차 안 한 B조 화면에 실패 배너가 한 프레임 스친다.
  useEffect(() => {
    setHistoryRoundId(null);
    setHistoryState('loading');
  }, [selectedTeamId]);

  const historyEntries = useMemo(
    () =>
      selectedTeam ? teamRoundHistoryWithResults(selectedTeam.id, rounds, historyVotesByRound, votesByRound) : [],
    [historyVotesByRound, rounds, selectedTeam, votesByRound],
  );
  // 기본 선택은 기존 동작 그대로(활성 라운드 → 없으면 최신 마감). 고른 회차가 사라지면 기본값으로 되돌아간다.
  const detailRound =
    (historyRoundId ? (rounds.find((round) => round.id === historyRoundId) ?? null) : null) ?? selectedRound;
  const detailVotes = detailRound
    ? (votesByRound[detailRound.id] ?? historyVotesByRound[detailRound.id] ?? [])
    : [];
  const comparisonTeams = comparisonTeamIds
    .map((teamId) => teams.find((team) => team.id === teamId))
    .filter((team): team is HqTeam => team != null);

  const toggleComparisonTeam = useCallback((teamId: string) => {
    setComparisonTeamIds((currentIds) => {
      const next = toggleComparisonSelection(currentIds, teamId);
      setComparisonMessage(next.limitReached ? '비교는 최대 3개 조까지 선택할 수 있습니다.' : null);
      return next.ids;
    });
  }, []);

  const exitCompareMode = useCallback(() => {
    setCompareMode(false);
    setComparisonTeamIds([]);
    setComparisonMessage(null);
  }, []);

  const statusOptions: Array<{ label: '전체' | TeamCellResult['label']; value: number }> = [
    { label: '전체', value: summary.total },
    { label: '투표중', value: summary.polling },
    { label: '마감', value: summary.closed },
    { label: '대기', value: summary.waiting },
  ];
  const connectionState = hqConnectionState({
    updatedAtMs: updatedAt?.getTime() ?? null,
    nowMs,
    refreshing,
    hasError: refreshError != null,
    staleAfterMs: STALE_AFTER_MS,
  });
  const connectionMeta = {
    loading: { label: '불러오는 중', bg: '#EEF1F3', text: '#33393F', dot: '#8A94A0' },
    refreshing: { label: '갱신 중', bg: '#E6EBF3', text: '#132646', dot: '#1F4E79' },
    live: { label: '실시간 연결', bg: '#DFF6F8', text: '#0A4A52', dot: '#1B9CAD' },
    stale: { label: '갱신 지연', bg: '#FFF4D6', text: '#6B4B00', dot: '#D97706' },
    failed: { label: '연결 실패', bg: '#FDE8E8', text: '#8B1A1A', dot: '#DC2626' },
    degraded: { label: '이전 데이터 표시', bg: '#FFF4D6', text: '#6B4B00', dot: '#D97706' },
  }[connectionState];

  return (
    <div className={`min-h-screen bg-[#F5F8FB] px-4 sm:px-6 ${opsMode ? 'py-5 sm:py-6' : 'py-3'}`}>
      <div className={`flex items-end justify-between ${opsMode ? 'mb-4' : 'mb-3'} flex-wrap gap-3`}>
        <div>
          <Eyebrow className="text-[#5A6B73]">Headquarters · Read-only</Eyebrow>
          <h1
            className="text-[28px] sm:text-[34px] font-extrabold text-[#1F4E79] leading-tight mt-1"
            style={{ letterSpacing: '-.02em' }}
          >
            기후시민회의 운영 현황
          </h1>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1.5">
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-bold"
            style={{ background: connectionMeta.bg, color: connectionMeta.text }}
            role="status"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: connectionMeta.dot }} aria-hidden="true" />
            {connectionMeta.label}
          </div>
          <div className="text-[14px] font-semibold text-[#5A6B73]">
            마지막 갱신:{' '}
            <span className="tr-num text-[#1F4E79] font-bold">{updatedAt ? formatTime(updatedAt) : '—'}</span>
          </div>
        </div>
      </div>

      {refreshError ? (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F0B5B5] bg-[#FFF7F7] px-4 py-3 text-[#8B1A1A]"
          role="alert"
        >
          <div>
            <span className="font-bold">{refreshError}</span>
            {updatedAt ? <span className="ml-2 text-[14px]">마지막 성공 데이터를 계속 표시합니다.</span> : null}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="min-h-11 rounded-lg border border-[#DC2626] bg-white px-4 text-[14px] font-bold disabled:opacity-50"
          >
            {refreshing ? '재시도 중…' : '다시 시도'}
          </button>
        </div>
      ) : null}

      {opsMode && teams.length > 0 ? (
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-extrabold text-[#1F2933]">조별 상태와 논의 결과</h2>
              <p className="mt-0.5 text-[13px] text-[#5A6B73]">
                조 카드를 누르면 상세 결과를 보고, 비교 모드에서는 최대 3개 조를 나란히 볼 수 있습니다.
              </p>
            </div>
            {!compareMode ? (
              <button
                type="button"
                onClick={() => {
                  setTeamSelection(null);
                  // 비교 패널은 '현재' 기준으로만 계산된다(teamCell/latestTeamRound).
                  // N차 보기를 켠 채 비교에 들어가면 한 화면에서 같은 조가 두 숫자로 보인다.
                  setRoundView('current');
                  setCompareMode(true);
                }}
                className="min-h-11 rounded-xl border border-[#1F4E79] bg-white px-4 text-[14px] font-extrabold text-[#1F4E79] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#23B2C3]/40"
              >
                조 비교하기
              </button>
            ) : null}
          </div>

          {compareMode ? (
            <div className="space-y-3 rounded-2xl border-2 border-[#23B2C3] bg-[#F2FCFD] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[17px] font-extrabold text-[#0A4A52]">
                    비교할 조 선택 <span className="tr-num">{comparisonTeamIds.length}/3</span>
                  </div>
                  <p className="mt-1 text-[13px] text-[#40666B]">
                    아래 조 카드를 눌러 추가하거나 해제하세요. 최대 3개 조를 비교할 수 있습니다.
                  </p>
                </div>
                <div className="flex gap-2">
                  {comparisonTeamIds.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setComparisonTeamIds([]);
                        setComparisonMessage(null);
                      }}
                      className="min-h-11 rounded-lg border border-[#9CB7C8] bg-white px-3 text-[13px] font-bold text-[#1F4E79]"
                    >
                      선택 초기화
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={exitCompareMode}
                    className="min-h-11 rounded-lg bg-[#1F4E79] px-4 text-[13px] font-bold text-white"
                  >
                    비교 종료
                  </button>
                </div>
              </div>
              {comparisonMessage ? (
                <div className="rounded-lg border border-[#F0D28A] bg-[#FFF9E8] px-3 py-2 text-[13px] font-bold text-[#6B4B00]" role="alert">
                  {comparisonMessage}
                </div>
              ) : null}
              <TeamComparisonPanel
                teams={comparisonTeams}
                rounds={rounds}
                voteCounts={voteCounts}
                votesByRound={votesByRound}
                onRemove={toggleComparisonTeam}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="조 상태 요약">
            {statusOptions.map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={statusFilter === option.label}
                onClick={() => setStatusFilter(option.label)}
                className={`min-h-11 rounded-xl border px-3 py-2 text-left transition ${
                  statusFilter === option.label
                    ? 'border-[#1F4E79] bg-[#E6EBF3] text-[#132646]'
                    : 'border-[#DCE7EE] bg-white text-[#5A6B73] hover:border-[#9CB7C8]'
                }`}
              >
                <span className="text-[13px] font-bold">{option.label}</span>
                <span className="ml-2 text-[22px] font-extrabold tr-num text-[#1F4E79]">{option.value}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2" aria-label="분과 필터">
            {subgroups.map((subgroup) => (
              <button
                key={subgroup}
                type="button"
                aria-pressed={subgroupFilter === subgroup}
                onClick={() => setSubgroupFilter(subgroup)}
                className={`min-h-11 rounded-full border px-4 text-[14px] font-bold transition ${
                  subgroupFilter === subgroup
                    ? 'border-[#23B2C3] bg-[#DFF6F8] text-[#0A4A52]'
                    : 'border-[#DCE7EE] bg-white text-[#5A6B73] hover:border-[#9CB7C8]'
                }`}
              >
                {subgroup}
              </button>
            ))}
          </div>

          {/* 회차별 보기 — 운영 모드 전용(AC #5). 라운드가 하나도 없으면 고를 것이 없어 감춘다. */}
          {maxSequence > 0 ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2" aria-label="회차 보기 선택">
                <span className="text-[14px] font-extrabold text-[#1F2933]">회차 보기</span>
                {(['current', ...Array.from({ length: maxSequence }, (_, index) => index + 1)] as RoundView[]).map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={roundView === option}
                      onClick={() => setRoundView(option)}
                      className={`min-h-11 rounded-full border px-4 text-[14px] font-bold transition ${
                        roundView === option
                          ? 'border-[#1F4E79] bg-[#E6EBF3] text-[#132646]'
                          : 'border-[#DCE7EE] bg-white text-[#5A6B73] hover:border-[#9CB7C8]'
                      }`}
                    >
                      {option === 'current' ? '현재' : `${option}차`}
                    </button>
                  ),
                )}
              </div>
              {roundView !== 'current' ? (
                <div className="rounded-lg border border-[#C4D8E4] bg-[#EEF4F8] px-3 py-2 text-[13px] font-bold text-[#1F4E79]">
                  카드가 <span className="tr-num">{roundView}</span>차 투표 기준으로 표시되고 있습니다. 그 회차를
                  진행하지 않은 조는 주황 점선 테두리에 '미실시'로 표시됩니다. 지금 상황을 보려면 '현재'를 누르세요.
                </div>
              ) : null}
              {roundView !== 'current' && sequenceState === 'failed' ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3">
                  <span className="text-[14px] font-bold leading-relaxed text-[#B5651D]">
                    <span className="tr-num">{roundView}</span>차 표수를 불러오지 못했습니다. 조 이름과 회차 상태는
                    그대로 볼 수 있습니다.
                  </span>
                  <button
                    type="button"
                    onClick={() => setSequenceReloadKey((key) => key + 1)}
                    className="min-h-11 rounded-xl border-2 border-[#B5651D] bg-white px-4 text-[14px] font-extrabold text-[#B5651D] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#23B2C3]/40"
                  >
                    지금 다시 시도
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={
          opsMode
            ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3'
            : 'grid grid-cols-5 grid-rows-3 gap-3 h-[calc(100vh-160px)] min-h-0'
        }
      >
        {visibleTeams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            cell={cardCells.get(team.id) ?? { label: '대기', participation: `0/${team.capacity}` }}
            selected={selectedTeamId === team.id}
            compareMode={compareMode}
            comparisonSelected={comparisonTeamIds.includes(team.id)}
            attendance={attendanceByTeam[team.id]}
            opsMode={opsMode}
            onSelect={() => (compareMode ? toggleComparisonTeam(team.id) : setTeamSelection(team.id))}
          />
        ))}
      </div>

      <p className="mt-4 text-[12px] font-semibold text-[#5A6B73]">
        지각 후 조퇴한 참여자는 지각과 조퇴 집계에 모두 포함될 수 있습니다. 공개 HQ에는 개인 이름이 표시되지 않습니다.
      </p>

      {opsMode ? (
        <div className="mt-6">
          <HqAttendanceAdmin teams={teams} />
        </div>
      ) : null}

      {teams.length === 0 && !refreshError ? (
        <div className="text-center text-[#5A6B73] text-[18px] mt-16">조 정보를 불러오는 중입니다…</div>
      ) : teams.length === 0 && refreshError ? (
        <div className="rounded-2xl border border-[#F0B5B5] bg-white p-8 text-center text-[#8B1A1A]">
          연결을 복구한 뒤 다시 시도해 주세요.
        </div>
      ) : visibleTeams.length === 0 ? (
        <div className="rounded-2xl border border-[#DCE7EE] bg-white p-8 text-center text-[#5A6B73]">
          선택한 조건에 해당하는 조가 없습니다.
        </div>
      ) : null}

      {selectedTeam ? (
        <TeamDetailPanel
          team={selectedTeam}
          cell={cells.get(selectedTeam.id) ?? { label: '대기', participation: `0/${selectedTeam.capacity}` }}
          round={detailRound}
          votes={detailVotes}
          entries={historyEntries}
          historyState={historyState}
          updatedAt={updatedAt}
          onSelectRound={setHistoryRoundId}
          onRetryHistory={() => setHistoryReloadKey((key) => key + 1)}
          onClose={() => setTeamSelection(null)}
        />
      ) : null}
    </div>
  );
}
