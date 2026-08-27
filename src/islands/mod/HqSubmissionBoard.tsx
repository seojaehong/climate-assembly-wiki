import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchHqSubmissions, subscribeHqSubmissions, type HqSubmissionRow } from '../../lib/hq-submissions';
import {
  buildBoards,
  flattenNotes,
  filterNotes,
  silentTeams,
  noteColor,
  boardToText,
  groupBySubgroup,
  subgroupsOf,
  filterBoardBySubgroup,
  type Note,
  type TopicBoard,
} from './hq-submission-board-logic';
import { orderNotesBySimilarity } from './note-similarity';

/**
 * 본부 조별 산출물 취합 보드.
 *
 * 조가 /mod에서 저장하는 즉시 Realtime으로 따라온다. 조가 쓴 한 줄을 포스트잇 한 장으로
 * 두고, 색은 조마다 고정해(noteColor) 벽에 붙인 것과 같은 방식으로 읽히게 한다.
 * 「조별」은 어느 조가 무엇을 냈는지, 「모아보기」는 내용만 죽 훑을 때 쓴다.
 *
 * 읽기 전용이다 — 본부가 조의 글을 고치는 경로는 만들지 않았다(조의 산출물이므로).
 *
 * `fixtureRows`를 주면 Supabase를 아예 부르지 않는다(폴링·구독도 안 건다).
 * /hq는 본부 비밀번호 게이트라 자동 검증이 불가해, 미리보기 라우트
 * /ko/moderator/insights/submission-lab 이 픽스처로 같은 화면을 띄워 브라우저 검증에 쓴다.
 */

/**
 * 폴링 주기.
 *
 * ⚠️ Realtime을 보조 수단으로 본다. submission·submission_item은 anon SELECT 정책이 없고
 * (읽기는 RPC로만 — 조끼리 서로 못 보게 한 설계다) Supabase의 postgres_changes는 RLS를
 * 따르므로, anon 구독자에게 변경 이벤트가 오지 않을 수 있다. 그것을 고치겠다고 anon SELECT를
 * 열면 닫아둔 조 간 열람 경로가 도로 열린다 — 그래서 폴링을 실질 갱신 수단으로 둔다.
 * 45행 규모라 5초 폴링이 부담되지 않는다.
 */
const POLL_MS = 5_000;

/** 어떤 모양으로 오든 사람이 읽을 수 있는 한 줄로 만든다(코드가 있으면 함께 남긴다). */
function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const e = error as { code?: string; message?: string; hint?: string; details?: string };
    const parts = [e.code, e.message ?? e.details ?? e.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(': ');
    try {
      return JSON.stringify(error).slice(0, 200);
    } catch {
      /* 순환 참조 등 — 아래 기본 문구로 떨어진다 */
    }
  }
  return '원인을 알 수 없습니다';
}

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

export default function HqSubmissionBoard({
  token,
  fixtureRows,
}: {
  token?: string;
  /** 주면 네트워크를 쓰지 않는 미리보기 모드. 본부 화면(/hq)은 이 값을 주지 않는다. */
  fixtureRows?: HqSubmissionRow[];
}) {
  const [rows, setRows] = useState<HqSubmissionRow[] | null>(fixtureRows ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(true);
  const [query, setQuery] = useState('');
  // L1 — 「모아보기」의 배치 방식. 기본은 조별 순서(원래 동작 그대로).
  // 'similar'는 orderNotesBySimilarity로 **재배열만** 한다 — 카드는 합쳐지지도 사라지지도 않는다.
  const [sortMode, setSortMode] = useState<'team' | 'similar'>('team');
  const [copied, setCopied] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  // 분과 필터 — 회의자료가 정한 구조화 단위가 분과다(총괄모더레이터 3인 × 5개 조).
  const [subgroup, setSubgroup] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const next = await fetchHqSubmissions(token);
      setRows(next);
      setFailed(null);
      setRefreshedAt(new Date());
    } catch (error) {
      // Supabase 오류는 Error 인스턴스가 아니라 평범한 객체다 — instanceof만 보면
      // 진짜 원인이 통째로 사라지고 「불러오지 못했습니다」만 남아 진단이 불가능해진다.
      console.error('[HQ submissions] load failed', error);
      setFailed(describeError(error));
    }
  }, [token]);

  useEffect(() => {
    // 미리보기 모드 — fetch·구독·폴링 어느 것도 걸지 않는다(네트워크 없이 열려야 한다).
    if (fixtureRows) {
      setRows(fixtureRows);
      return;
    }
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
  }, [load, fixtureRows]);

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

  const wholeBoard = boards.find((b) => b.topicId === activeTopic) ?? boards[0] ?? null;
  const subgroups = wholeBoard ? subgroupsOf(wholeBoard) : [];
  // 고른 분과가 사라지면(주제 전환 등) 전체로 되돌린다 — 빈 화면을 만들지 않는다.
  const activeSubgroup = subgroup && subgroups.includes(subgroup) ? subgroup : null;
  const board = wholeBoard ? filterBoardBySubgroup(wholeBoard, activeSubgroup) : null;

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

  // 검색으로 먼저 거르고 그 다음에 재배열한다 — 유사도 사슬은 **화면에 보이는 카드끼리** 잇는다.
  // (거르기 전에 정렬하면 안 보이는 카드가 사슬 중간에 끼어 이웃이 엉뚱해진다.)
  const visibleNotes = grouped ? [] : filterNotes(flattenNotes(board), query);
  const notes = sortMode === 'similar' ? orderNotesBySimilarity(visibleNotes) : visibleNotes;
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

      {/* 분과 필터 — 15개 조를 한 사람이 보지 않는다 */}
      {subgroups.length > 1 ? (
        <div role="group" aria-label="분과 선택" className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={activeSubgroup === null}
            onClick={() => setSubgroup(null)}
            className={`h-12 rounded-xl px-4 text-[16px] font-bold transition ${
              activeSubgroup === null
                ? 'bg-[#23B2C3] text-white'
                : 'border border-[#C4D8E4] bg-white text-[#5A6B73]'
            }`}
          >
            전체 15개 조
          </button>
          {wholeBoard
            ? groupBySubgroup(wholeBoard).map((block) => (
                <button
                  key={block.subgroup}
                  type="button"
                  aria-pressed={activeSubgroup === block.subgroup}
                  onClick={() => setSubgroup(block.subgroup)}
                  className={`h-12 rounded-xl px-4 text-[16px] font-bold transition ${
                    activeSubgroup === block.subgroup
                      ? 'bg-[#23B2C3] text-white'
                      : 'border border-[#C4D8E4] bg-white text-[#5A6B73]'
                  }`}
                >
                  {block.subgroup}
                  <span
                    className={`ml-2 text-[14px] font-extrabold tr-num ${
                      activeSubgroup === block.subgroup ? 'text-white/85' : 'text-[#23B2C3]'
                    }`}
                  >
                    {block.teamsWithNotes}/{block.teams.length}
                  </span>
                </button>
              ))
            : null}
        </div>
      ) : null}

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
            <>
              {/* L1 정렬 — 배치만 바꾼다. 조별 순서가 기본.
                  「조별」(보기 방식)과 「조별 순서」(정렬)가 나란히 붙어 헷갈리므로 라벨을 둔다. */}
              <Eyebrow className="ml-1 text-[#8FA3AD]">정렬</Eyebrow>
              <div role="group" aria-label="정렬" className="flex overflow-hidden rounded-xl border border-[#C4D8E4]">
                <button
                  type="button"
                  aria-pressed={sortMode === 'team'}
                  onClick={() => setSortMode('team')}
                  className={`h-12 px-4 text-[16px] font-bold ${
                    sortMode === 'team' ? 'bg-[#1F4E79] text-white' : 'bg-white text-[#5A6B73]'
                  }`}
                >
                  조별 순서
                </button>
                <button
                  type="button"
                  aria-pressed={sortMode === 'similar'}
                  onClick={() => setSortMode('similar')}
                  className={`h-12 px-4 text-[16px] font-bold ${
                    sortMode === 'similar' ? 'bg-[#1F4E79] text-white' : 'bg-white text-[#5A6B73]'
                  }`}
                >
                  비슷한 것끼리
                </button>
              </div>
              {/* 정렬을 바꿔도 이 수는 변하지 않는다 — 「배치만 바꿨다」의 증거를 정렬 버튼 옆에 둔다. */}
              <span
                data-testid="note-count"
                className="text-[16px] font-bold text-[#5A6B73]"
              >
                카드 <span className="text-[#1F4E79] tr-num">{notes.length}</span>장
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="내용·조·테이블 검색"
                aria-label="카드 검색"
                className="h-12 w-56 rounded-xl border border-[#C4D8E4] px-3 text-[16px]"
              />
            </>
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
        <div className="space-y-7">
          {groupBySubgroup(board).map((block) => (
            <section key={block.subgroup}>
              <header className="mb-3 flex flex-wrap items-baseline gap-3">
                <h3 className="text-[22px] font-extrabold text-[#1F4E79]">{block.subgroup}</h3>
                <span className="text-[16px] font-bold text-[#5A6B73]">
                  <span className="text-[#23B2C3] tr-num">{block.teamsWithNotes}</span>/
                  <span className="tr-num">{block.teams.length}</span>개 조 제출 ·{' '}
                  <span className="text-[#1F4E79] tr-num">{block.totalNotes}</span>건
                </span>
              </header>
              <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
                {block.teams.map((team) => (
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
            </section>
          ))}
        </div>
      ) : (
        <div>
          {/* 회의자료 260811이 「조별 결과 임의 통합」을 금지한다 — 정렬은 통합이 아님을 화면에 못 박는다. */}
          <p className="mb-4 rounded-xl border border-[#DCE7EE] bg-[#F8FAFC] px-4 py-3 text-[15px] leading-[1.6] text-[#5A6B73]">
            정렬은 <b className="text-[#1F4E79]">배치만 바꿉니다</b> — 카드가 합쳐지거나 사라지지
            않습니다. 「비슷한 것끼리」는 낱말이 겹치는 카드를 이웃에 놓아 볼 뿐이고, 묶을지는 사람이
            판단합니다.
          </p>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
            {notes.length === 0 ? (
              <p className="text-[16px] text-[#5A6B73]">해당하는 카드가 없습니다.</p>
            ) : (
              notes.map((note) => <Postit key={note.id} note={note} showTeam />)
            )}
          </div>
        </div>
      )}

      <p className="mt-6 text-[14px] text-[#8FA3AD]">
        {fixtureRows
          ? '미리보기 — 고정 픽스처를 읽습니다(갱신 없음)'
          : '조가 저장하는 대로 자동 갱신됩니다 (5초)'}
        {!fixtureRows && refreshedAt
          ? ` · 마지막 갱신 ${refreshedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
          : ''}
      </p>
    </div>
  );
}
