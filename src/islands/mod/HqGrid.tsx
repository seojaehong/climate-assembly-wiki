import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchHqTeams,
  fetchTeamRounds,
  fetchVoteCounts,
  subscribeHqUpdates,
  type HqTeam,
  type Round,
} from '../../lib/mod-console';
import { teamCell, relevantRoundIds, type TeamCellResult } from './hq-grid-logic';

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
    <div className="rounded-2xl border border-[#DCE7EE] bg-white p-5 sm:p-6 flex flex-col gap-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div
            className="text-[36px] sm:text-[40px] font-extrabold text-[#1F2933] leading-tight truncate"
            style={{ letterSpacing: '-.01em' }}
          >
            {team.name}
          </div>
          {team.subgroup ? <Eyebrow className="text-[#5A6B73] mt-1">{team.subgroup}</Eyebrow> : null}
        </div>
        <div
          className="flex items-center gap-2 rounded-full px-4 py-2 shrink-0"
          style={{ background: style.bg, color: style.text }}
        >
          <span className="w-3 h-3 rounded-full shrink-0" style={{ background: style.dot }} aria-hidden="true" />
          <span className="text-[18px] font-bold whitespace-nowrap">{cell.label}</span>
        </div>
      </div>
      <div className="mt-auto">
        <Eyebrow className="text-[#5A6B73] mb-1">참여</Eyebrow>
        <div className="text-[80px] sm:text-[92px] font-extrabold text-[#1F4E79] leading-none tr-num">
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

  return (
    <div className="min-h-screen bg-[#F5F8FB] px-6 sm:px-10 py-8 sm:py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
        <div>
          <Eyebrow className="text-[#5A6B73]">Headquarters · Read-only</Eyebrow>
          <h1
            className="text-[32px] sm:text-[38px] font-extrabold text-[#1F4E79] leading-tight mt-1"
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

      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5">
        {teams.map((team) => (
          <TeamCard key={team.id} team={team} cell={teamCell(team, rounds, voteCounts)} />
        ))}
      </div>

      {teams.length === 0 ? (
        <div className="text-center text-[#5A6B73] text-[18px] mt-16">조 정보를 불러오는 중입니다…</div>
      ) : null}
    </div>
  );
}
