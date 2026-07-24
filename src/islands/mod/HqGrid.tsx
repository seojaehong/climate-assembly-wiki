import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchHqTeams,
  fetchTeamRounds,
  fetchVoteCounts,
  subscribeHqUpdates,
  type HqTeam,
  type Round,
} from '../../lib/mod-console';
import {
  teamCell,
  relevantRoundIds,
  summarizeTeamCells,
  teamMatchesFilters,
  type TeamCellResult,
} from './hq-grid-logic';

const POLL_MS = 30000;

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

function TeamCard({ team, cell }: { team: HqTeam; cell: TeamCellResult }) {
  const style = STATUS_STYLE[cell.label];
  return (
    <div className="min-h-[158px] rounded-2xl border border-[#DCE7EE] bg-white p-4 flex flex-col gap-3 shadow-sm">
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
    </div>
  );
}

/** /hq 본부용 15조 읽기전용 현황 그리드. 버튼·입력 없음 — 표시만 한다. */
export default function HqGrid() {
  const [teams, setTeams] = useState<HqTeam[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({});
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState<'전체' | TeamCellResult['label']>('전체');
  const [subgroupFilter, setSubgroupFilter] = useState('전체');
  const loadingRef = useRef(false);

  const refresh = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    Promise.all([fetchHqTeams(), fetchTeamRounds()])
      .then(async ([t, r]) => {
        setTeams(t);
        setRounds(r);
        const ids = relevantRoundIds(t, r);
        const counts = await fetchVoteCounts(ids).catch(() => ({}) as Record<string, number>);
        setVoteCounts(counts);
        setUpdatedAt(new Date());
      })
      .catch(() => {
        /* 조회 실패 — 다음 폴링/실시간 이벤트에서 재시도 */
      })
      .finally(() => {
        loadingRef.current = false;
      });
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeHqUpdates(refresh);
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh]);

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

  const statusOptions: Array<{ label: '전체' | TeamCellResult['label']; value: number }> = [
    { label: '전체', value: summary.total },
    { label: '투표중', value: summary.polling },
    { label: '마감', value: summary.closed },
    { label: '대기', value: summary.waiting },
  ];

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
        <div className="text-[16px] font-semibold text-[#5A6B73]">
          마지막 갱신:{' '}
          <span className="tr-num text-[#1F4E79] font-bold">{updatedAt ? formatTime(updatedAt) : '—'}</span>
        </div>
      </div>

      {teams.length > 0 ? (
        <div className="mb-4 space-y-3">
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
          />
        ))}
      </div>

      {teams.length === 0 ? (
        <div className="text-center text-[#5A6B73] text-[18px] mt-16">조 정보를 불러오는 중입니다…</div>
      ) : visibleTeams.length === 0 ? (
        <div className="rounded-2xl border border-[#DCE7EE] bg-white p-8 text-center text-[#5A6B73]">
          선택한 조건에 해당하는 조가 없습니다.
        </div>
      ) : null}
    </div>
  );
}
