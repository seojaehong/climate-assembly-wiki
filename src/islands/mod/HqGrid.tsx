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
import {
  teamCell,
  hqConnectionState,
  latestTeamRound,
  leadingResult,
  relevantRoundIds,
  summarizeTeamCells,
  teamMatchesFilters,
  toggleComparisonSelection,
  type TeamCellResult,
} from './hq-grid-logic';

const POLL_MS = 30000;
const STALE_AFTER_MS = 65000;

// 대형 스크린(8~15m) 가시성 — 색+텍스트 병기, hover 비의존, 고대비.
const STATUS_STYLE: Record<TeamCellResult['label'], { bg: string; text: string; dot: string }> = {
  대기: { bg: '#EEF1F3', text: '#33393F', dot: '#8A94A0' },
  투표중: { bg: '#DFF6F8', text: '#0A4A52', dot: '#1B9CAD' },
  마감: { bg: '#E6EBF3', text: '#132646', dot: '#1F4E79' },
};

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
}: {
  team: HqTeam;
  cell: TeamCellResult;
  selected: boolean;
  compareMode: boolean;
  comparisonSelected: boolean;
  onSelect: () => void;
}) {
  const style = STATUS_STYLE[cell.label];
  return (
    <button
      type="button"
      aria-label={
        compareMode
          ? `${team.name} 비교 ${comparisonSelected ? '선택 해제' : '선택'}, ${cell.label}, 참여 ${cell.participation}`
          : `${team.name} 상세 보기, ${cell.label}, 참여 ${cell.participation}`
      }
      aria-pressed={compareMode ? comparisonSelected : selected}
      onClick={onSelect}
      className={`min-h-[158px] w-full rounded-2xl border bg-white p-4 flex flex-col gap-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#23B2C3]/40 ${
        selected || comparisonSelected ? 'border-[#1F4E79] ring-2 ring-[#1F4E79]/20' : 'border-[#DCE7EE]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div
            className="text-[22px] sm:text-[24px] font-extrabold text-[#1F2933] leading-tight whitespace-nowrap"
            style={{ letterSpacing: '-.01em' }}
          >
            {team.name}
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 shrink-0"
          style={{ background: style.bg, color: style.text }}
        >
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: style.dot }} aria-hidden="true" />
          <span className="text-[14px] font-bold whitespace-nowrap">{cell.label}</span>
        </div>
      </div>
      <div className="mt-auto">
        <div className="flex items-end justify-between gap-3">
          <Eyebrow className="text-[#5A6B73] pb-1">참여</Eyebrow>
          {team.subgroup ? <span className="text-[12px] font-semibold text-[#5A6B73]">{team.subgroup}</span> : null}
        </div>
        <div className="text-[44px] sm:text-[48px] font-extrabold text-[#1F4E79] leading-none tr-num whitespace-nowrap">
          {cell.participation}
        </div>
      </div>
      <span className="text-[12px] font-bold text-[#1F4E79]">
        {compareMode ? (comparisonSelected ? '비교 선택됨 ✓' : '비교에 추가 +') : '상세 보기 →'}
      </span>
    </button>
  );
}

function TeamDetailPanel({
  team,
  cell,
  round,
  votes,
  updatedAt,
  onClose,
}: {
  team: HqTeam;
  cell: TeamCellResult;
  round: Round | null;
  votes: Vote[];
  updatedAt: Date | null;
  onClose: () => void;
}) {
  const tally = round ? tallyVotes(round, votes) : null;
  const leader = leadingResult(round, votes);
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
          {round ? (
            <>
              <div className="rounded-2xl border border-[#DCE7EE] bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Eyebrow className="text-[#5A6B73]">최근 투표 질문</Eyebrow>
                  <span className="rounded-full bg-[#E6EBF3] px-3 py-1 text-[12px] font-bold text-[#132646]">
                    {round.status === 'active' ? '투표 진행 중' : '투표 마감'}
                  </span>
                </div>
                <h3 className="mt-3 text-[23px] font-extrabold leading-snug text-[#1F2933]">{round.title}</h3>
                {leader ? (
                  <div className="mt-4 rounded-xl bg-[#DFF6F8] px-4 py-3 text-[#0A4A52]">
                    <div className="text-[12px] font-bold">현재 선두 선택지{leader.tied ? ' · 공동 선두' : ''}</div>
                    <div className="mt-1 text-[18px] font-extrabold">{leader.option}</div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl bg-[#EEF1F3] px-4 py-3 text-[14px] font-semibold text-[#5A6B73]">
                    아직 집계된 표가 없습니다.
                  </div>
                )}
              </div>

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

              <div className="rounded-2xl border border-[#F0D28A] bg-[#FFF9E8] p-4 text-[14px] leading-relaxed text-[#5B450B]">
                <strong className="block text-[#6B4B00]">운영 참고용 최근 투표 결과</strong>
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
  const [teams, setTeams] = useState<HqTeam[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [votesByRound, setVotesByRound] = useState<Record<string, Vote[]>>({});
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [statusFilter, setStatusFilter] = useState<'전체' | TeamCellResult['label']>('전체');
  const [subgroupFilter, setSubgroupFilter] = useState('전체');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonTeamIds, setComparisonTeamIds] = useState<string[]>([]);
  const [comparisonMessage, setComparisonMessage] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setRefreshing(true);
    try {
      const [nextTeams, nextRounds] = await Promise.all([fetchHqTeams(), fetchTeamRounds()]);
      const ids = relevantRoundIds(nextTeams, nextRounds);
      const [counts, nextVotesByRound] = await Promise.all([fetchVoteCounts(ids), fetchVotesForRounds(ids)]);
      const completedAt = new Date();
      setTeams(nextTeams);
      setRounds(nextRounds);
      setVoteCounts(counts);
      setVotesByRound(nextVotesByRound);
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
  const subgroups = useMemo(
    () => ['전체', ...Array.from(new Set(teams.map((team) => team.subgroup).filter((value): value is string => Boolean(value))))],
    [teams],
  );
  const visibleTeams = useMemo(
    () =>
      teams.filter((team) =>
        teamMatchesFilters(team, cells.get(team.id) ?? { label: '대기', participation: `0/${team.capacity}` }, statusFilter, subgroupFilter),
      ),
    [cells, statusFilter, subgroupFilter, teams],
  );
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const selectedRound = selectedTeam ? latestTeamRound(selectedTeam.id, rounds) : null;
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
    <div className="min-h-screen bg-[#F5F8FB] px-4 sm:px-6 py-5 sm:py-6">
      <div className="flex items-end justify-between mb-4 flex-wrap gap-3">
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

      {teams.length > 0 ? (
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
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {visibleTeams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            cell={cells.get(team.id) ?? { label: '대기', participation: `0/${team.capacity}` }}
            selected={selectedTeamId === team.id}
            compareMode={compareMode}
            comparisonSelected={comparisonTeamIds.includes(team.id)}
            onSelect={() => (compareMode ? toggleComparisonTeam(team.id) : setTeamSelection(team.id))}
          />
        ))}
      </div>

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
          round={selectedRound}
          votes={selectedRound ? (votesByRound[selectedRound.id] ?? []) : []}
          updatedAt={updatedAt}
          onClose={() => setTeamSelection(null)}
        />
      ) : null}
    </div>
  );
}
