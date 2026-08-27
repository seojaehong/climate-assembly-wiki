import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchHqSubmissions, subscribeHqSubmissions, type HqSubmissionRow } from '../../lib/hq-submissions';
import {
  buildBoards,
  flattenNotes,
  filterNotes,
  silentTeams,
  noteColor,
  boardToText,
  type Note,
  type TopicBoard,
} from './hq-submission-board-logic';

/**
 * 본부 조별 산출물 취합 보드.
 *
 * 조가 /mod에서 저장하는 즉시 Realtime으로 따라온다. 조가 쓴 한 줄을 포스트잇 한 장으로
 * 두고, 색은 조마다 고정해(noteColor) 벽에 붙인 것과 같은 방식으로 읽히게 한다.
 * 「조별」은 어느 조가 무엇을 냈는지, 「모아보기」는 내용만 죽 훑을 때 쓴다.
 *
 * 읽기 전용이다 — 본부가 조의 글을 고치는 경로는 만들지 않았다(조의 산출물이므로).
 */

/** Realtime이 끊겼을 때를 대비한 폴백 폴링 주기. */
const POLL_MS = 15_000;

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[12px] font-semibold uppercase ${className}`} style={{ letterSpacing: '.14em' }}>
      {children}
    </div>
  );
}

function Postit({ note, showTeam }: { note: Note; showTeam: boolean }) {
  return (
    <article
      className="rounded-[6px] p-4 shadow-[0_8px_18px_rgba(31,41,55,.12),0_1px_2px_rgba(31,41,55,.06)]"
      style={{ background: noteColor(note.teamName) }}
    >
      {showTeam ? (
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-[15px] font-extrabold text-[#1f2937]">{note.teamName}</span>
          {note.tableNo ? (
            <span className="text-[13px] font-bold text-[#6b7280]">{note.tableNo}번 테이블</span>
          ) : null}
        </div>
      ) : null}
      <p className="whitespace-pre-wrap text-[19px] font-semibold leading-[1.45] text-[#1f2937]">
        {note.content}
      </p>
      {note.rationale ? (
        <p className="mt-3 border-t border-black/10 pt-2 text-[15px] leading-[1.5] text-[#4b5563]">
          {note.rationale}
        </p>
      ) : null}
    </article>
  );
}

function StatusChip({ status }: { status: TopicBoard['teams'][number]['status'] }) {
  if (status === 'final') {
    return (
      <span className="rounded-full bg-[#1F4E79] px-2 py-[2px] text-[12px] font-bold text-white">
        최종 제출 · 잠금
      </span>
    );
  }
  if (status === 'reopened') {
    return (
      <span className="rounded-full bg-[#FFF4D6] px-2 py-[2px] text-[12px] font-bold text-[#6B4B00]">
        재오픈됨
      </span>
    );
  }
  return null;
}

export default function HqSubmissionBoard({ token }: { token: string }) {
  const [rows, setRows] = useState<HqSubmissionRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(true);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchHqSubmissions(token);
      setRows(next);
      setFailed(null);
      setRefreshedAt(new Date());
    } catch (error) {
      console.error('[HQ submissions] load failed', error);
      setFailed(error instanceof Error ? error.message : '불러오지 못했습니다');
    }
  }, [token]);

  useEffect(() => {
    void load();
    const stop = subscribeHqSubmissions(() => {
      void load();
    });
    const timer = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const boards = useMemo(() => buildBoards(rows ?? []), [rows]);

  // 첫 로드 뒤 첫 꼭지를 연다. 이미 고른 꼭지가 사라지면(주제 마감 등) 다시 첫 꼭지로.
  useEffect(() => {
    if (boards.length === 0) return;
    if (activeTopic && boards.some((b) => b.topicId === activeTopic)) return;
    setActiveTopic(boards[0].topicId);
  }, [boards, activeTopic]);

  const board = boards.find((b) => b.topicId === activeTopic) ?? boards[0] ?? null;

  const copyBoard = async () => {
    if (!board) return;
    try {
      await navigator.clipboard.writeText(boardToText(board));
      setCopied(true);
    } catch {
      /* 클립보드 거부(권한·비보안 컨텍스트) — 조용히 넘긴다. */
    }
  };

  if (rows === null && failed === null) {
    return <p className="p-6 text-[16px] text-[#5A6B73]">조별 산출물을 불러오는 중…</p>;
  }

  if (failed !== null) {
    return (
      <div className="p-6">
        <p role="alert" className="rounded-lg bg-[#FFF4D6] px-4 py-3 text-[15px] font-bold text-[#6B4B00]">
          조별 산출물을 불러오지 못했습니다 — {failed}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 h-12 rounded-xl border border-[#C4D8E4] px-5 text-[16px] font-bold text-[#1F4E79]"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!board) {
    return (
      <p className="p-6 text-[16px] text-[#5A6B73]">
        아직 열린 토론 주제가 없습니다. 주제를 열면 조가 쓰는 대로 여기에 모입니다.
      </p>
    );
  }

  const notes = grouped ? [] : filterNotes(flattenNotes(board), query);
  const silent = silentTeams(board);

  return (
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
      {/* 꼭지 선택 */}
      <div role="tablist" aria-label="꼭지" className="mb-4 flex flex-wrap gap-2">
        {boards.map((item) => {
          const selected = item.topicId === board.topicId;
          return (
            <button
              key={item.topicId}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveTopic(item.topicId)}
              className={`h-14 rounded-xl px-5 text-[18px] font-bold transition ${
                selected
                  ? 'bg-[#1F4E79] text-white shadow-sm'
                  : 'border border-[#DCE7EE] bg-white text-[#5A6B73]'
              }`}
            >
              {item.prompt}
              <span className={`ml-2 text-[15px] font-extrabold ${selected ? 'text-white/80' : 'text-[#23B2C3]'}`}>
                {item.totalNotes}
              </span>
            </button>
          );
        })}
      </div>

      {/* 진척 + 도구 */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[#DCE7EE] bg-white px-4 py-3">
        <div className="flex items-baseline gap-2">
          <Eyebrow className="text-[#5A6B73]">제출</Eyebrow>
          <span className="text-[30px] font-extrabold leading-none text-[#1F4E79] tr-num">
            {board.teamsWithNotes}
          </span>
          <span className="text-[18px] font-bold text-[#5A6B73]">/ {board.teams.length}개 조</span>
          <span className="ml-3 text-[18px] font-bold text-[#5A6B73]">
            총 <span className="text-[#1F4E79] tr-num">{board.totalNotes}</span>건
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-[#C4D8E4]">
            <button
              type="button"
              aria-pressed={grouped}
              onClick={() => setGrouped(true)}
              className={`h-12 px-4 text-[16px] font-bold ${grouped ? 'bg-[#23B2C3] text-white' : 'bg-white text-[#5A6B73]'}`}
            >
              조별
            </button>
            <button
              type="button"
              aria-pressed={!grouped}
              onClick={() => setGrouped(false)}
              className={`h-12 px-4 text-[16px] font-bold ${!grouped ? 'bg-[#23B2C3] text-white' : 'bg-white text-[#5A6B73]'}`}
            >
              모아보기
            </button>
          </div>
          {!grouped ? (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="내용·조·테이블 검색"
              aria-label="카드 검색"
              className="h-12 w-56 rounded-xl border border-[#C4D8E4] px-3 text-[16px]"
            />
          ) : null}
          <button
            type="button"
            onClick={() => void copyBoard()}
            className="h-12 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79]"
          >
            {copied ? '복사됨' : '텍스트로 복사'}
          </button>
        </div>
      </div>

      {silent.length > 0 ? (
        <p className="mb-5 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[16px] font-bold text-[#6B4B00]">
          아직 제출 없는 조 {silent.length} — {silent.join(' · ')}
        </p>
      ) : null}

      {grouped ? (
        <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
          {board.teams.map((team) => (
            <section key={team.teamId} className="rounded-2xl border border-[#DCE7EE] bg-[#F8FAFC] p-4">
              <header className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="text-[20px] font-extrabold text-[#1F4E79]">{team.teamName}</h3>
                {team.tableNo ? (
                  <span className="text-[14px] font-bold text-[#5A6B73]">{team.tableNo}번 테이블</span>
                ) : null}
                <span className="ml-auto text-[16px] font-extrabold text-[#23B2C3] tr-num">
                  {team.notes.length}
                </span>
                <StatusChip status={team.status} />
              </header>
              {team.notes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#C4D8E4] px-3 py-6 text-center text-[15px] text-[#8FA3AD]">
                  아직 없음
                </p>
              ) : (
                <div className="grid gap-3">
                  {team.notes.map((note) => (
                    <Postit key={note.id} note={note} showTeam={false} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {notes.length === 0 ? (
            <p className="text-[16px] text-[#5A6B73]">해당하는 카드가 없습니다.</p>
          ) : (
            notes.map((note) => <Postit key={note.id} note={note} showTeam />)
          )}
        </div>
      )}

      <p className="mt-6 text-[14px] text-[#8FA3AD]">
        조가 저장하는 대로 자동 갱신됩니다
        {refreshedAt ? ` · 마지막 갱신 ${refreshedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
      </p>
    </div>
  );
}
