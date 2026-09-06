import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchHqSubmissions,
  assignSubmissionCategory,
  categoryNoteId,
  fetchHqSubmissionCategories,
  fetchHqSubmissionHistory,
  reopenSubmission,
  type HqHistoryRow,
  type HqSubmissionRow,
  CURRENT_SESSION_SLUG,
} from '../../lib/hq-submissions';
import {
  buildSubmissionReport,
  reportToCsv,
  reportToText,
  reportFileName,
  formatStamp,
} from './submission-report';
import { submissionReportBlob } from './submission-report-docx';
import PrintableReport from './PrintableReport';
import ClearAllPanel from './ClearAllPanel';
import type { SubmissionReport } from './submission-report';
import { buildSealedPlanFiles } from './ontology-plan';
import { boardToOntologySnapshot } from './ontology-snapshot';
import { hqBoardState, notOpenedMessage } from './hq-session-state';
import {
  assignSubmissionKind,
  fetchHqTopicDeadlines,
  fetchSubmissionKinds,
} from '../../lib/hq-submissions';
import {
  buildBoards,
  buildHqClearSnapshot,
  flattenNotes,
  filterNotes,
  silentTeams,
  noteColor,
  boardToText,
  groupBySubgroup,
  subgroupsOf,
  filterBoardBySubgroup,
  hqAssignmentConflictMessage,
  hqLiveItemIdentityMap,
  isHqAssignmentContinuationCurrent,
  resolveHqAssignmentIntent,
  type HqAssignmentIntent,
  type Note,
  type TeamColumn,
  type TopicBoard,
} from './hq-submission-board-logic';
import {
  deadlineFailureMessage,
  deadlineView,
  describeRpcError,
  isoToLocalInput,
  planDeadline,
  serverDeadlineMap,
} from './hq-deadline-logic';
import {
  setWorkshopDeadline,
  WorkshopHqDeadlineConflictError,
} from '../../lib/workshop-hq';
import { orderNotesBySimilarity, similarPairs, type SimilarPair } from './note-similarity';
import {
  teamPairOverlaps,
  uniqueNoteIds,
  uniqueCountByTeam,
  type TeamPairOverlap,
} from './team-similarity';
import { presentScale } from './present-scale';
import { firstFocusTeamId, focusPosition, focusedTeam, stepTeam } from './present-focus';
import { pairKey, togglePair, marksByNote, checkedPairCount } from './pair-marks';
import {
  emptyCategoryState,
  assignCategory,
  preservationInvariant,
  toggleCategory,
  unassignCategory,
  type CategoryState,
  type FourCategory,
} from './four-category';
import {
  CategoryBadge,
  CategoryButtons,
  FourCategoryPanel,
  PreservationCounter,
} from './FourCategoryPanel';
import {
  describePickFailure,
  groupsFromCheckedPairs,
  groupsMapOf,
  representativeNoteIds,
} from './representative-groups';
import {
  pickRepresentative,
  type RepresentativeActor,
  type RepresentativePickEntry,
  type RepresentativeState,
} from './representative-pick';
import { RepresentativeBadge, RepresentativePanel } from './RepresentativePanel';
import {
  buildOntologyExport,
  ontologyExportPreservation,
  ontologyExportReadiness,
} from './ontology-export';
import { OntologyExportPanel } from './OntologyExportPanel';
import {
  assignKind,
  emptyKindState,
  kindPreservation,
  toggleKind,
  unassignKind,
  type KindState,
  type OntologyKind,
} from './ontology-kind';
import {
  OntologyKindBadge,
  OntologyKindButtons,
  OntologyKindCounter,
} from './OntologyKindPanel';
import { useModalDialog } from './use-modal-dialog';
import { classifyHqAuthorizationError } from './hq-gate-logic';

/**
 * 본부 조별 산출물 취합 보드.
 *
 * 조가 /mod에서 저장하면 세션 범위 RPC를 5초마다 다시 읽어 따라온다. 조가 쓴 한 줄을 포스트잇 한 장으로
 * 두고, 색은 조마다 고정해(noteColor) 벽에 붙인 것과 같은 방식으로 읽히게 한다.
 * 「조별」은 어느 조가 무엇을 냈는지, 「모아보기」는 내용만 죽 훑을 때 쓴다.
 *
 * 읽기 전용이다 — 본부가 조의 글을 고치는 경로는 만들지 않았다(조의 산출물이므로).
 *
 * `fixtureRows`를 주면 Supabase를 아예 부르지 않는다(폴링도 안 건다).
 * /hq는 본부 비밀번호 게이트라 자동 검증이 불가해, 미리보기 라우트
 * /ko/moderator/insights/submission-lab 이 픽스처로 같은 화면을 띄워 브라우저 검증에 쓴다.
 */

/**
 * 폴링 주기.
 *
 * submission·submission_item은 anon SELECT 정책이 없고 읽기는 범위가 검증된 RPC로만 한다.
 * HQ bearer는 Supabase Auth JWT가 아니므로 broad Realtime 구독에 권한을 전달할 수 없다.
 * 그것을 고치겠다고 anon SELECT를 열면 닫아둔 조 간 열람 경로가 도로 열린다.
 * 따라서 이 명시적 RPC 폴링이 유일한 갱신 수단이다.
 * 45행 규모라 5초 폴링이 부담되지 않는다.
 */
const POLL_MS = 5_000;
const TOPIC_PANEL_ID = 'hq-topic-panel';

function topicDomSuffix(topicId: string): string {
  return topicId.replace(/[^A-Za-z0-9_-]/g, '-');
}

function topicTabId(topicId: string): string {
  return `hq-topic-tab-${topicDomSuffix(topicId)}`;
}

type AssignmentIdentity = {
  eventId: number;
  sourceItemId: string;
};

type AssignmentOperation = {
  sequence: number;
  sourceItemId: string;
};

type AssignmentFailure<T extends string> = {
  message: string;
  retry: { desired: T | null; fingerprint: string } | null;
};

/**
 * 어떤 모양으로 오든 사람이 읽을 수 있는 한 줄로 만든다(코드가 있으면 함께 남긴다).
 *
 * 본체는 `hq-deadline-logic.ts` 에 있다 — `.tsx` 는 vitest include 밖이라 여기 두면
 * 「PostgREST 오류는 Error 가 아니다」라는 핵심 판단이 영영 시험되지 않는다.
 */
const describeError = describeRpcError;

/** ISO -> 시:분:초. 값이 없으면 em dash. */
function clock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[12px] font-semibold uppercase ${className}`} style={{ letterSpacing: '.14em' }}>
      {children}
    </div>
  );
}

/**
 * 「닮은 짝」에 사람이 붙인 표시. 카드에 번호표만 얹고 카드는 그대로 둔다.
 * 조마다 포스트잇 색이 달라 배지는 자체 대비(짙은 남색 바탕 + 흰 글씨)를 갖는다.
 */
function PairMarks({ marks }: { marks: number[] }) {
  return (
    <div className="flex flex-wrap gap-1" data-testid="pair-marks">
      {marks.map((n) => (
        <span
          key={n}
          className="rounded-full bg-[#1F4E79] px-2 py-[2px] text-[12px] font-extrabold text-white"
        >
          닮은 짝 {n}
        </span>
      ))}
    </div>
  );
}

function Postit({
  note,
  showTeam,
  marks,
  representative,
  category,
  onCategory,
  categoryBusy,
  categoryError,
  onCategoryRetry,
  kind,
  onKind,
  kindBusy,
  kindError,
  onKindRetry,
}: {
  note: Note;
  showTeam: boolean;
  marks?: number[];
  /** L4 — 이 카드가 대표로 지목된 묶음 번호들. 없으면 아무것도 안 붙고 카드는 그대로 남는다. */
  representative?: number[];
  /** L3 — 이 카드에 얹힌 **잠정** 범주. 없으면 미배정이고, 미배정도 화면에 그대로 남는다. */
  category?: FourCategory | null;
  onCategory?: (noteId: string, category: FourCategory) => void;
  categoryBusy?: boolean;
  categoryError?: string | null;
  onCategoryRetry?: (noteId: string) => void;
  /**
   * US-013 — 이 카드에 얹힌 **잠정** 온톨로지 종류. 「온톨로지」 관점을 켰을 때만 넘어온다.
   * 관점을 끄면 이름표도 버튼도 사라지지만 붙여둔 종류는 보드 상태에 그대로 남는다.
   */
  kind?: OntologyKind | null;
  onKind?: (noteId: string, kind: OntologyKind) => void;
  kindBusy?: boolean;
  kindError?: string | null;
  onKindRetry?: (noteId: string) => void;
}) {
  return (
    <article
      className="rounded-[6px] p-4 shadow-[0_8px_18px_rgba(31,41,55,.12),0_1px_2px_rgba(31,41,55,.06)]"
      style={{ background: noteColor(note.teamName) }}
      data-note-id={note.id}
      data-category={category ?? ''}
      data-kind={kind ?? ''}
      data-representative={representative && representative.length > 0 ? 'true' : 'false'}
    >
      {/* 표시 네 겹(대표 · 닮은 짝 · 잠정 범주 · 잠정 종류)을 **한 줄에 모은다** — 각자 한 줄씩 먹으면
          배지밭이 되어 본문이 카드 아래로 밀린다(US-009 기록). */}
      {(representative && representative.length > 0) ||
      (marks && marks.length > 0) ||
      category ||
      kind ? (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {representative && representative.length > 0 ? (
            <RepresentativeBadge marks={representative} />
          ) : null}
          {marks && marks.length > 0 ? <PairMarks marks={marks} /> : null}
          {category ? <CategoryBadge category={category} /> : null}
          {kind ? <OntologyKindBadge kind={kind} /> : null}
        </div>
      ) : null}
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
      {onCategory ? (
        <CategoryButtons noteId={note.id} current={category ?? null} onToggle={onCategory} disabled={categoryBusy} />
      ) : null}
      {categoryError ? (
        <div role="alert" className="mt-2 rounded-lg border border-[#DC2626] bg-[#FEF2F2] px-3 py-2 text-[13px] font-bold text-[#B91C1C]">
          <p>{categoryError}</p>
          {onCategoryRetry ? (
            <button
              type="button"
              onClick={() => onCategoryRetry(note.id)}
              disabled={categoryBusy}
              className="mt-2 min-h-11 rounded-lg border-2 border-[#B91C1C] bg-white px-3 disabled:opacity-50"
            >
              {categoryBusy ? '다시 저장 중…' : '범주 저장 다시 시도'}
            </button>
          ) : null}
        </div>
      ) : null}
      {/* 관점을 켜야만 넘어온다 — 끄면 버튼이 사라지고 카드는 원래 모습으로 돌아온다. */}
      {onKind ? (
        <OntologyKindButtons
          noteId={note.id}
          current={kind ?? null}
          onToggle={onKind}
          disabled={kindBusy}
        />
      ) : null}
      {kindError ? (
        <div
          role="alert"
          className="mt-2 rounded-lg border border-[#DC2626] bg-[#FEF2F2] px-3 py-2 text-[13px] font-bold text-[#B91C1C]"
        >
          <p>{kindError}</p>
          {onKindRetry ? (
            <button
              type="button"
              onClick={() => onKindRetry(note.id)}
              disabled={kindBusy}
              className="mt-2 min-h-11 rounded-lg border-2 border-[#B91C1C] bg-white px-3 disabled:opacity-50"
            >
              {kindBusy ? '다시 저장 중…' : '종류 저장 다시 시도'}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function StatusChip({ status }: { status: TopicBoard['teams'][number]['status'] }) {
  if (status === 'final') {
    return (
      <span className="rounded-full bg-[#1F4E79] px-2 py-[2px] text-[12px] font-bold text-white">
        제출 완료 · 잠금
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

/**
 * L2 「닮은 짝」 패널 — AI 는 **제안까지만** 한다.
 *
 * 짝마다 두 카드의 원문 전체·조 이름·겹친 낱말을 함께 낸다. 점수만 보이면 「0.95니까 같은 말」
 * 이라는 착시가 생기고, 그 착시야말로 설계문서 §5 가 막으려는 위험이다(한국어 단문에서
 * 유사도는 자주 틀린다 — 이 저장소 실측에 무관한 의제가 0.954 로 잡힌 오탐이 있었다).
 *
 * ✓ 를 눌러도 카드는 사라지거나 합쳐지지 않는다 — 두 카드에 같은 번호표가 붙을 뿐이고
 * 다시 누르면 없어진다.
 *
 * 짝 행은 일부러 `<article>` 이 아닌 `<li>`·`<div>` 로 낸다 — 포스트잇이 `<article>` 이라
 * 같은 태그를 쓰면 「카드 N장」을 세는 검증이 조용히 부풀어 오른다.
 */
/**
 * 조 × 조 겹침 — 「우리 분과에서 어느 조와 어느 조가 같은 이야기를 하고 있나」.
 *
 * 백분율 한 칸짜리 표(히트맵)로 만들지 않았다. 행사장에서 「1조와 4조가 62%」는
 * 맞는지 틀린지 따질 방법이 없는데, 이 저장소는 유사도를 낼 때 **겹친 낱말을 항상
 * 함께 싣는다**는 규칙을 이미 갖고 있다. 칸 하나에는 낱말이 안 들어간다.
 * 그래서 순위 목록으로 두고 겹친 낱말을 줄에 그대로 적는다 — 한 분과는 5개 조,
 * 최대 10쌍이라 목록이 오히려 멀리서 읽기 좋다.
 *
 * 펼치기는 클릭으로만 한다. hover 는 이 프로젝트에서 금지다(대형 스크린·터치).
 */
function TeamOverlapPanel({
  overlaps,
  uniqueByTeam,
  teams,
}: {
  overlaps: TeamPairOverlap[];
  uniqueByTeam: Map<string, number>;
  teams: readonly TeamColumn[];
}) {
  const [open, setOpen] = useState(true);
  const soloTeams = teams
    .map((team) => ({ name: team.teamName, count: uniqueByTeam.get(team.teamId) ?? 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));

  return (
    <section
      aria-label="조 사이 겹침"
      data-testid="team-overlap-panel"
      className="mb-5 rounded-2xl border border-[#DCE7EE] bg-white p-4"
    >
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="text-[20px] font-extrabold text-[#1F4E79]">
          조 사이 겹침 <span className="tr-num text-[#0F6B78]">{overlaps.length}</span>쌍
        </h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto h-11 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[15px] font-bold text-[#1F4E79]"
        >
          {open ? '접기' : '펼치기'}
        </button>
      </header>

      <p className="mt-2 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[15px] leading-[1.6] text-[#6B4B00]">
        <b>AI 제안 — 확정은 사람이 합니다.</b> 낱말이 겹친 카드의 수를 조 단위로 접은 것입니다.
        겹친 낱말을 보고 맞는지 판단해 주세요. 카드는 합쳐지지도 사라지지도 않습니다.
      </p>

      {open ? (
        <div className="mt-3 space-y-4">
          <div>
            <h4 className="mb-2 text-[16px] font-extrabold text-[#5A6B73]">같은 이야기를 하는 조</h4>
            {overlaps.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#C4D8E4] px-4 py-5 text-[16px] text-[#526975]">
                아직 겹치는 조가 없습니다. 조가 더 쓰면 여기에 모입니다.
              </p>
            ) : (
              <ol data-testid="team-overlap-list" className="space-y-2">
                {overlaps.map((row) => (
                  <li
                    key={`${row.aTeamId} ${row.bTeamId}`}
                    className="rounded-xl border border-[#DCE7EE] px-4 py-3"
                  >
                    <p className="flex flex-wrap items-baseline gap-2 text-[18px] font-extrabold text-[#1F2933]">
                      {row.aTeamName} <span className="text-[#0F6B78]">↔</span> {row.bTeamName}
                      <span className="ml-2 text-[16px] font-bold text-[#5A6B73]">
                        비슷한 쌍 <span className="tr-num text-[#1F4E79]">{row.pairCount}</span>
                      </span>
                    </p>
                    <p
                      className="mt-1 text-[16px] leading-[1.6] text-[#5A6B73]"
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      겹친 낱말 {row.sharedTerms.map((term) => `「${term}」`).join(' ')}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-[16px] font-extrabold text-[#5A6B73]">
              이 조만 말한 것 — 아직 아무도 같은 말을 하지 않았습니다
            </h4>
            {soloTeams.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#C4D8E4] px-4 py-5 text-[16px] text-[#526975]">
                없습니다.
              </p>
            ) : (
              <ul data-testid="team-unique-list" className="flex flex-wrap gap-2">
                {soloTeams.map((row) => (
                  <li
                    key={row.name}
                    className="rounded-xl bg-[#FFF0D6] px-4 py-2 text-[17px] font-bold text-[#8A5A00]"
                  >
                    {row.name} <span className="tr-num font-extrabold">{row.count}</span>건
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[15px] leading-[1.6] text-[#5A6B73]">
              「중요하다」는 뜻이 아닙니다. 회의자료가 <b className="text-[#1F4E79]">소수의견 삭제를
              금지</b>하므로, 겹치는 것만 눈에 띄지 않도록 같은 무게로 함께 보여줍니다.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SimilarPairsPanel({
  pairs,
  notesById,
  checked,
  onToggle,
}: {
  pairs: SimilarPair[];
  notesById: Map<string, Note>;
  checked: Set<string>;
  onToggle: (key: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const marked = checkedPairCount(pairs, checked);

  return (
    <section
      aria-label="닮은 짝"
      data-testid="similar-pairs-panel"
      className="mb-5 rounded-2xl border border-[#DCE7EE] bg-white p-4"
    >
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="text-[20px] font-extrabold text-[#1F4E79]">
          닮은 짝 <span className="tr-num text-[#0F6B78]">{pairs.length}</span>쌍
        </h3>
        {marked > 0 ? (
          <span data-testid="pair-checked-count" className="text-[16px] font-bold text-[#5A6B73]">
            표시함 <span className="tr-num text-[#1F4E79]">{marked}</span>쌍
          </span>
        ) : null}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto h-11 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[15px] font-bold text-[#1F4E79]"
        >
          {open ? '접기' : '펼치기'}
        </button>
      </header>

      <p className="mt-2 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[15px] leading-[1.6] text-[#6B4B00]">
        <b>AI 제안 — 확정은 사람이 합니다.</b> 짧은 한국어 문장에서는 유사도가 자주 틀립니다. 겹친
        낱말을 직접 보고 판단하세요. 점수는 참고 표시일 뿐이고, ✓ 를 눌러도 카드는 합쳐지거나 사라지지
        않습니다 — 두 카드에 같은 번호표만 붙습니다.
      </p>

      {open ? (
        pairs.length === 0 ? (
          <p className="mt-3 text-[16px] text-[#5A6B73]">이 꼭지에는 닮은 짝 후보가 없습니다.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {pairs.map((pair, index) => {
              const key = pairKey(pair.aId, pair.bId);
              const a = notesById.get(pair.aId);
              const b = notesById.get(pair.bId);
              if (!a || !b) return null;
              const isChecked = checked.has(key);
              return (
                <li
                  key={key}
                  data-testid="pair-row"
                  className={`rounded-xl border p-3 ${
                    isChecked ? 'border-[#1F4E79] bg-[#F2F7FB]' : 'border-[#DCE7EE] bg-[#F8FAFC]'
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <span className="text-[15px] font-extrabold text-[#1F4E79] tr-num">
                      닮은 짝 {index + 1}
                    </span>
                    <span className="text-[14px] font-bold text-[#526975] tr-num">
                      참고 점수 {pair.score.toFixed(2)}
                    </span>
                    <span className="text-[14px] text-[#5A6B73]">
                      겹친 낱말{' '}
                      {pair.sharedTerms.map((term) => (
                        <span
                          key={term}
                          className="mr-1 rounded bg-[#E3F2F5] px-2 py-[1px] text-[14px] font-bold text-[#0F6B78]"
                        >
                          {term}
                        </span>
                      ))}
                    </span>
                    <button
                      type="button"
                      aria-pressed={isChecked}
                      onClick={() => onToggle(key)}
                      className={`ml-auto h-11 rounded-xl px-4 text-[15px] font-bold ${
                        isChecked
                          ? 'bg-[#1F4E79] text-white'
                          : 'border border-[#C4D8E4] bg-white text-[#1F4E79]'
                      }`}
                    >
                      {isChecked ? '✓ 표시함 — 누르면 해제' : '✓ 닮은 짝으로 표시'}
                    </button>
                  </div>
                  <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
                    {[a, b].map((note) => (
                      <div
                        key={note.id}
                        className="rounded-[6px] p-3"
                        style={{ background: noteColor(note.teamName) }}
                      >
                        <div className="mb-1 text-[14px] font-extrabold text-[#1f2937]">
                          {note.teamName}
                        </div>
                        <p className="whitespace-pre-wrap text-[16px] font-semibold leading-[1.45] text-[#1f2937]">
                          {note.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}

export default function HqSubmissionBoard({
  token,
  fixtureRows,
  onAuthorizationExpired,
}: {
  token?: string;
  /** 주면 네트워크를 쓰지 않는 미리보기 모드. 본부 화면(/hq)은 이 값을 주지 않는다. */
  fixtureRows?: HqSubmissionRow[];
  /** 서버가 bearer 폐기/만료를 확정했을 때만 로그인 게이트로 복귀시킨다. */
  onAuthorizationExpired?: () => void;
}) {
  const [rows, setRows] = useState<HqSubmissionRow[] | null>(fixtureRows ?? null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const rowsLoadedRef = useRef(fixtureRows !== undefined);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const boardLoadEpochRef = useRef(0);
  const liveItemIdentityRef = useRef<Map<string, string>>(
    hqLiveItemIdentityMap(fixtureRows ?? []),
  );
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(true);
  const [query, setQuery] = useState('');
  // L1 — 「모아보기」의 배치 방식. 기본은 조별 순서(원래 동작 그대로).
  // 'similar'는 orderNotesBySimilarity로 **재배열만** 한다 — 카드는 합쳐지지도 사라지지도 않는다.
  const [sortMode, setSortMode] = useState<'team' | 'similar'>('team');
  // L2 — 사람이 ✓ 한 짝. 카드 id 에 꼭지가 들어 있어 꼭지를 넘나들어도 한 Set 으로 충돌이 없다.
  // AI 가 미리 채우지 않는다 — 처음엔 비어 있고 사람이 눌러야 표시가 생긴다.
  const [checkedPairs, setCheckedPairs] = useState<Set<string>>(() => new Set());
  // L3 — 카드 id → **잠정** 범주. 카드는 제자리에 두고 이름표만 얹으므로 배정이 카드를 지울 수 없다.
  // 서버의 append-only 배정 이력을 되읽고, 변경 시 같은 RPC에 저장한다.
  const [catState, setCatState] = useState<CategoryState>(() => emptyCategoryState());
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);
  const [categoryBusy, setCategoryBusy] = useState<Set<string>>(() => new Set());
  const categoryBusyRef = useRef<Set<string>>(new Set());
  const categoryRefreshSequenceRef = useRef(0);
  const categoryIdentityRef = useRef<Map<string, AssignmentIdentity>>(new Map());
  const categoryIntentRef = useRef<Map<string, HqAssignmentIntent>>(new Map());
  const categoryOperationRef = useRef<Map<string, AssignmentOperation>>(new Map());
  const [categoryErrors, setCategoryErrors] = useState<Record<string, AssignmentFailure<FourCategory>>>({});
  // L4 — 대표 지목 **이력만** 상태로 든다. 묶음(groups)은 체크된 짝에서 매번 파생하고,
  // 「현재 대표」는 이력의 마지막 사건에서 파생한다. 맞아야 하는 저장소가 하나뿐이라 어긋날 수가 없다.
  const [repHistory, setRepHistory] = useState<readonly RepresentativePickEntry[]>([]);
  // US-013 — 「온톨로지」는 **관점**이다. 켜면 카드 위에 종류 이름표 한 겹이 겹쳐 보이고,
  // 끄면 화면이 원래대로 돌아온다. 기본은 꺼짐 — 논증 구조는 취합의 마지막 겹이라
  // 조가 쓴 것을 먼저 그대로 읽고 나서 얹는다.
  const [ontologyView, setOntologyView] = useState(false);
  // 카드 id → **잠정** 종류. 처음엔 비어 있다 — AI 가 미리 정하지 않는다(US-013 AC).
  // 관점을 껐다 켜도 이 맵은 그대로다(붙인 것이 보기 전환으로 사라지면 안 된다).
  const [kindState, setKindState] = useState<KindState>(() => emptyKindState());
  const [kindLoadError, setKindLoadError] = useState<string | null>(null);
  const [kindBusy, setKindBusy] = useState<Set<string>>(() => new Set());
  const kindBusyRef = useRef<Set<string>>(new Set());
  const kindWriteEpochRef = useRef(0);
  const kindIdentityRef = useRef<Map<string, AssignmentIdentity>>(new Map());
  const kindIntentRef = useRef<Map<string, HqAssignmentIntent>>(new Map());
  const kindOperationRef = useRef<Map<string, AssignmentOperation>>(new Map());
  const assignmentOperationSequenceRef = useRef(0);
  const [kindErrors, setKindErrors] = useState<Record<string, AssignmentFailure<OntologyKind>>>({});
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  // 분과 필터 — 회의자료가 정한 구조화 단위가 분과다(총괄모더레이터 3인 × 5개 조).
  const [subgroup, setSubgroup] = useState<string | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  // 발표 모드 — 16:25 분과 공유에서 조원들이 함께 보는 화면.
  // **분과 단위로만** 켠다. 15개 조를 한 화면에 띄우면 글자가 읽을 수 없이 작아지고,
  // 그 자리 자체가 분과별로 진행된다(조별 발표 각 2분 → 총괄모더레이터 잠정 구조화).
  const [presentMode, setPresentMode] = useState(false);
  // 「조 하나씩」 — 6-1 조별 공유는 한 조씩 차례로 발표하는 자리다. 다섯 조를 한
  // 화면에 늘어놓으면 발표 중인 조가 눈에 안 들어온다. null = 전체 보기(기존 동작).
  const [presentTeamId, setPresentTeamId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // 인쇄 전용 문서 — 화면이 아니라 이것이 종이에 나간다.
  const [printReport, setPrintReport] = useState<SubmissionReport | null>(null);
  // 재오픈 - 사유가 필수라 다이얼로그를 거친다(서버도 2자 이상을 요구한다).
  const [reopening, setReopening] = useState<{ submissionId: string; teamName: string } | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenBusy, setReopenBusy] = useState(false);
  const [history, setHistory] = useState<HqHistoryRow[] | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // US-011 마감시각 — 꼭지 id → 입력칸에 친 값(로컬 벽시계). 꼭지를 오가도 친 값이 남는다.
  const [deadlineDraft, setDeadlineDraft] = useState<Record<string, string>>({});
  // 꼭지 id → **이 화면이 마지막으로 건 값**(ISO). null = 지움, 키 없음 = 아직 안 건드림.
  // ★ 서버 값이 아니다 — s19 를 못 읽었을 때의 **퇴화 표시 전용**이다(그때만 화면에 나온다).
  const [deadlineApplied, setDeadlineApplied] = useState<Record<string, string | null>>({});
  // 꼭지 id → **서버의 현재 마감**(s19 hq_topic_deadlines). 값 null = 마감 없음.
  // ★ 맵 자체가 null 이면 **아직 한 번도 못 읽었다**(= 모름). 「마감 없음」과 섞지 말 것 —
  //   본부에게 전혀 다른 사실이고, 이 구별이 새로고침 뒤에도 마감을 보여 주는 근거다.
  const [deadlineServer, setDeadlineServer] = useState<Record<string, string | null> | null>(null);
  const [deadlineBusy, setDeadlineBusy] = useState(false);
  // 실패 문구는 꼭지에 묶어 둔다 — 꼭지를 옮기면 남의 꼭지 경고가 따라다니지 않는다.
  const [deadlineError, setDeadlineError] = useState<{ topicId: string; message: string } | null>(
    null
  );
  const deadlineRequestIdsRef = useRef<Map<string, string>>(new Map());
  const [deadlineRefresh, setDeadlineRefresh] = useState<{
    busy: boolean;
    stale: boolean;
    lastSuccessAt: number | null;
    error: string | null;
  }>({ busy: false, stale: false, lastSuccessAt: null, error: null });
  const deadlineRefreshSequenceRef = useRef(0);
  const assignmentViewEpochRef = useRef(0);
  const handleRpcAuthorizationError = useCallback((error: unknown): boolean => {
    if (classifyHqAuthorizationError(error) !== 'expired') return false;
    onAuthorizationExpired?.();
    return true;
  }, [onAuthorizationExpired]);
  const reopenDialogRef = useModalDialog<HTMLDivElement>(reopening !== null, () => {
    if (!reopenBusy) setReopening(null);
  });

  useEffect(() => {
    assignmentViewEpochRef.current += 1;
    return () => {
      assignmentViewEpochRef.current += 1;
    };
  }, [token, activeTopic, fixtureRows]);

  useEffect(() => {
    // A new bearer must never inherit optimistic state or an in-flight operation
    // from the previous HQ session. Operation markers keep late finally blocks
    // from clearing a newer request for the same card.
    categoryRefreshSequenceRef.current += 1;
    kindWriteEpochRef.current += 1;
    boardLoadEpochRef.current += 1;
    loadInFlightRef.current = null;
    categoryOperationRef.current.clear();
    kindOperationRef.current.clear();
    categoryBusyRef.current = new Set();
    kindBusyRef.current = new Set();
    categoryIdentityRef.current.clear();
    kindIdentityRef.current.clear();
    categoryIntentRef.current.clear();
    kindIntentRef.current.clear();
    liveItemIdentityRef.current = hqLiveItemIdentityMap(fixtureRows ?? []);
    setCategoryBusy(new Set());
    setKindBusy(new Set());
    setCatState(emptyCategoryState());
    setKindState(emptyKindState());
    setCategoryLoadError(null);
    setKindLoadError(null);
    setCategoryErrors({});
    setKindErrors({});
    setOperationError(null);
    setFailed(null);
    setRefreshError(null);
    setRows(fixtureRows ?? null);
    rowsLoadedRef.current = fixtureRows !== undefined;
  }, [token, fixtureRows]);

  const load = useCallback(async () => {
    if (!token) return;
    if (loadInFlightRef.current) return loadInFlightRef.current;
    const boardLoadEpoch = boardLoadEpochRef.current;
    const task = (async () => {
      try {
        const next = await fetchHqSubmissions(token, CURRENT_SESSION_SLUG);
        if (boardLoadEpoch !== boardLoadEpochRef.current) return;
        const liveItemIdentities = hqLiveItemIdentityMap(next);
        liveItemIdentityRef.current = liveItemIdentities;
        setCatState((current) => new Map([...current].filter(([noteId]) => {
          const operationSource = categoryOperationRef.current.get(noteId)?.sourceItemId;
          const assignedSource = categoryIdentityRef.current.get(noteId)?.sourceItemId;
          return (operationSource ?? assignedSource) === liveItemIdentities.get(noteId);
        })));
        categoryIdentityRef.current = new Map(
          [...categoryIdentityRef.current].filter(
            ([noteId, identity]) => identity.sourceItemId === liveItemIdentities.get(noteId),
          ),
        );
        setKindState((current) => new Map([...current].filter(([noteId]) => {
          const operationSource = kindOperationRef.current.get(noteId)?.sourceItemId;
          const assignedSource = kindIdentityRef.current.get(noteId)?.sourceItemId;
          return (operationSource ?? assignedSource) === liveItemIdentities.get(noteId);
        })));
        kindIdentityRef.current = new Map(
          [...kindIdentityRef.current].filter(
            ([noteId, identity]) => identity.sourceItemId === liveItemIdentities.get(noteId),
          ),
        );
        setRows(next);
        rowsLoadedRef.current = true;
        setFailed(null);
        setRefreshError(null);
        setRefreshedAt(new Date());
        // 서버에 남은 종류 배정을 화면 상태로 되살린다. 없으면 조용히 넘어간다
        // (s12 미적용 환경에서도 보드 자체는 떠야 한다).
        const readEpoch = kindWriteEpochRef.current;
        try {
          const kinds = await fetchSubmissionKinds(token, CURRENT_SESSION_SLUG);
          if (
            boardLoadEpoch !== boardLoadEpochRef.current ||
            readEpoch !== kindWriteEpochRef.current
          ) return;
          const serverIdentities = new Map<string, AssignmentIdentity>();
          const serverState = new Map<string, OntologyKind>();
          for (const row of kinds) {
            const id = `${row.topic_id}:${row.team_id}:${row.item_ordinal}`;
            if (liveItemIdentities.get(id) !== row.source_item_id) continue;
            serverIdentities.set(id, {
              eventId: row.event_id,
              sourceItemId: row.source_item_id,
            });
            if (row.kind) serverState.set(id, row.kind as OntologyKind);
          }
          setKindState((current) => {
            const merged = new Map(serverState);
            // A read during an optimistic write must not overwrite that row.
            for (const noteId of kindBusyRef.current) {
              const operation = kindOperationRef.current.get(noteId);
              if (operation?.sourceItemId !== liveItemIdentities.get(noteId)) continue;
              const optimistic = current.get(noteId);
              if (optimistic) merged.set(noteId, optimistic);
              else merged.delete(noteId);
            }
            return merged;
          });
          const nextIdentities = new Map(serverIdentities);
          for (const noteId of kindBusyRef.current) {
            const operation = kindOperationRef.current.get(noteId);
            if (operation?.sourceItemId !== liveItemIdentities.get(noteId)) continue;
            const pendingIdentity = kindIdentityRef.current.get(noteId);
            if (pendingIdentity) nextIdentities.set(noteId, pendingIdentity);
            else nextIdentities.delete(noteId);
          }
          kindIdentityRef.current = nextIdentities;
          setKindLoadError(null);
        } catch (kindError) {
          if (
            boardLoadEpoch !== boardLoadEpochRef.current ||
            readEpoch !== kindWriteEpochRef.current
          ) return;
          console.warn('[HQ submissions] 종류 배정을 불러오지 못했습니다', kindError);
          if (handleRpcAuthorizationError(kindError)) return;
          setKindLoadError('저장된 종류 배정을 다시 읽지 못했습니다. 마지막 정상 표시를 유지합니다.');
        }
      } catch (error: unknown) {
        if (boardLoadEpoch !== boardLoadEpochRef.current) return;
        // Supabase 오류는 Error 인스턴스가 아니라 평범한 객체다 — instanceof만 보면
        // 진짜 원인이 통째로 사라지고 「불러오지 못했습니다」만 남아 진단이 불가능해진다.
        console.error('[HQ submissions] load failed', error);
        if (handleRpcAuthorizationError(error)) return;
        const message = describeError(error);
        if (rowsLoadedRef.current) {
          setRefreshError(`새 제출물을 확인하지 못했습니다. 마지막 정상 화면을 유지합니다. ${message}`);
        } else {
          setFailed(message);
        }
      }
    })();
    loadInFlightRef.current = task;
    try {
      await task;
    } finally {
      if (loadInFlightRef.current === task) loadInFlightRef.current = null;
    }
  }, [handleRpcAuthorizationError, token]);

  const loadCategories = useCallback(async () => {
    if (!token) return;
    const sequence = categoryRefreshSequenceRef.current + 1;
    categoryRefreshSequenceRef.current = sequence;
    try {
      const pendingBoardLoad = loadInFlightRef.current;
      if (pendingBoardLoad) await pendingBoardLoad;
      if (categoryRefreshSequenceRef.current !== sequence) return;
      const saved = await fetchHqSubmissionCategories(token, CURRENT_SESSION_SLUG);
      if (categoryRefreshSequenceRef.current !== sequence) return;
      const liveItemIdentities = liveItemIdentityRef.current;
      const serverState = new Map<string, FourCategory>();
      const serverIdentities = new Map<string, AssignmentIdentity>();
      for (const row of saved) {
        const noteId = categoryNoteId(row);
        if (liveItemIdentities.get(noteId) !== row.source_item_id) continue;
        serverIdentities.set(noteId, {
          eventId: row.event_id,
          sourceItemId: row.source_item_id,
        });
        if (row.category) serverState.set(noteId, row.category);
      }
      setCatState((current) => {
        const next = new Map(serverState);
        for (const noteId of categoryBusyRef.current) {
          const operation = categoryOperationRef.current.get(noteId);
          if (operation?.sourceItemId !== liveItemIdentities.get(noteId)) continue;
          const optimistic = current.get(noteId);
          if (optimistic) next.set(noteId, optimistic);
          else next.delete(noteId);
        }
        return next;
      });
      const nextIdentities = new Map(serverIdentities);
      for (const noteId of categoryBusyRef.current) {
        const operation = categoryOperationRef.current.get(noteId);
        if (operation?.sourceItemId !== liveItemIdentities.get(noteId)) continue;
        const pendingIdentity = categoryIdentityRef.current.get(noteId);
        if (pendingIdentity) nextIdentities.set(noteId, pendingIdentity);
        else nextIdentities.delete(noteId);
      }
      categoryIdentityRef.current = nextIdentities;
      setCategoryLoadError(null);
    } catch (error: unknown) {
      if (categoryRefreshSequenceRef.current !== sequence) return;
      console.error('[HQ submissions] category reload failed', error);
      if (handleRpcAuthorizationError(error)) return;
      setCategoryLoadError('저장된 범주 배정을 불러오지 못했습니다. 현재 표시는 최신 상태가 아닐 수 있습니다.');
    }
  }, [handleRpcAuthorizationError, token]);

  const reloadAssignmentBoard = useCallback(async () => {
    // Join a poll that was already in flight, then start one authoritative read
    // after the mutation response. Otherwise a pre-write poll could masquerade
    // as the required post-write refresh.
    const pendingBoardLoad = loadInFlightRef.current;
    if (pendingBoardLoad) await pendingBoardLoad;
    await Promise.all([load(), loadCategories()]);
  }, [load, loadCategories]);

  /**
   * 서버의 현재 마감을 읽어 온다(s19).
   *
   * ★ **못 읽어도 지난 값을 지우지 않는다.** 한 번 읽은 사실을 네트워크가 한 번 끊겼다고
   *   「모름」으로 되돌리면 본부 화면의 마감이 깜빡인다. 배너 폴링(DeadlineBanner)이
   *   실패를 삼키고 지난 값을 유지하는 것과 같은 규칙이다.
   */
  const loadDeadlines = useCallback(async () => {
    if (!token) return;
    const sequence = deadlineRefreshSequenceRef.current + 1;
    deadlineRefreshSequenceRef.current = sequence;
    setDeadlineRefresh((current) => ({ ...current, busy: true }));
    try {
      const rows = await fetchHqTopicDeadlines(token, CURRENT_SESSION_SLUG);
      if (deadlineRefreshSequenceRef.current !== sequence) return;
      if (rows === null) {
        // s19 미적용 — 「마감 없음」이 아니라 「모름」이다. 화면은 s19 이전 표시로 퇴화한다.
        console.warn('[HQ submissions] s19 미적용 — 서버의 현재 마감을 읽을 수 없습니다');
        setDeadlineRefresh((current) => ({
          ...current,
          busy: false,
          stale: true,
          error: '서버가 마감 되읽기를 지원하지 않아 현재 마감 상태를 확인할 수 없습니다.',
        }));
        return;
      }
      setDeadlineServer(serverDeadlineMap(rows));
      setDeadlineRefresh({ busy: false, stale: false, lastSuccessAt: Date.now(), error: null });
    } catch (error: unknown) {
      console.warn('[HQ submissions] 서버의 현재 마감을 읽지 못했습니다', error);
      if (deadlineRefreshSequenceRef.current !== sequence) return;
      if (handleRpcAuthorizationError(error)) return;
      setDeadlineRefresh((current) => ({
        ...current,
        busy: false,
        stale: true,
        error: '마감 정보를 다시 읽지 못했습니다. 마지막 정상 확인 값을 유지합니다.',
      }));
    }
  }, [handleRpcAuthorizationError, token]);

  useEffect(() => {
    // 미리보기 모드 — fetch·구독·폴링 어느 것도 걸지 않는다(네트워크 없이 열려야 한다).
    if (fixtureRows) {
      setRows(fixtureRows);
      return;
    }
    void load();
    void loadCategories();
    void loadDeadlines();
    // HQ bearers are scoped RPC capabilities, not Supabase Auth JWTs. Broad
    // postgres_changes subscriptions to the protected submission tables cannot
    // authorize with this token, so explicit scoped polling is the sole source.
    const timer = setInterval(() => {
      void load();
      // 범주 변경은 여러 HQ 기기에서 일어나며 broad realtime 이벤트에 의존하지 않는다.
      void loadCategories();
      // 마감은 본부 3인이 각자 걸 수 있다 — 남이 건 값도 따라와야 「내가 뭘 걸었나」가 맞는다.
      void loadDeadlines();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      boardLoadEpochRef.current += 1;
      loadInFlightRef.current = null;
      categoryRefreshSequenceRef.current += 1;
      deadlineRefreshSequenceRef.current += 1;
    };
  }, [load, loadCategories, loadDeadlines, fixtureRows]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const boards = useMemo(() => buildBoards(rows ?? []), [rows]);
  const clearSnapshot = useMemo(() => (rows ? buildHqClearSnapshot(rows) : null), [rows]);
  const onTopicTabKeyDown = useCallback((
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    if (boards.length === 0) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % boards.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + boards.length) % boards.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = boards.length - 1;
    }
    if (nextIndex === null) return;
    const nextTopic = boards[nextIndex];
    event.preventDefault();
    setActiveTopic(nextTopic.topicId);
    requestAnimationFrame(() => document.getElementById(topicTabId(nextTopic.topicId))?.focus());
  }, [boards]);

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

  // 발표 모드 「조 하나씩」 — 화살표 키로 넘기고 Esc로 나간다. 발표대에서는
  // 마우스를 잡을 손이 없다. 발표 모드가 아닐 때는 아무것도 듣지 않는다.
  const presentTeamsForKeys = presentMode && board ? groupBySubgroup(board)[0]?.teams ?? [] : [];
  useEffect(() => {
    if (!presentMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPresentMode(false);
        setPresentTeamId(null);
        return;
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // 전체 보기에서 화살표를 누르면 「조 하나씩」으로 들어간다.
      setPresentTeamId((cur) =>
        cur === null
          ? firstFocusTeamId(presentTeamsForKeys)
          : stepTeam(presentTeamsForKeys, cur, e.key === 'ArrowRight' ? 1 : -1),
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // presentTeamsForKeys는 매 렌더 새 배열이라 teamId 목록으로 비교한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentMode, presentTeamsForKeys.map((t) => t.teamId).join(',')]);

  // 분과를 바꾸면 보고 있던 조는 그 분과에 없다 — 전체 보기로 되돌린다.
  useEffect(() => {
    setPresentTeamId(null);
  }, [activeSubgroup, board?.topicId]);

  // L2 짝 후보는 **화면에 뜬 꼭지·분과의 카드 전체**로 낸다 — 검색어와는 무관하다.
  // 패널은 그리드가 아니라 별도 목록이라, 검색으로 카드를 좁힌 동안에도 짝은 그대로 있어야 한다.
  const boardNotes = useMemo(() => (board ? flattenNotes(board) : []), [board]);
  const pairs = useMemo(() => similarPairs(boardNotes), [boardNotes]);
  // 조 × 조 겹침도 같은 입력을 쓴다 — 검색어에 따라 조 사이의 숫자가 바뀌면
  // 같은 회의에서 사람마다 다른 수치를 보게 된다.
  const overlaps = useMemo(() => teamPairOverlaps(boardNotes), [boardNotes]);
  const uniqueByTeam = useMemo(() => uniqueCountByTeam(boardNotes), [boardNotes]);
  const notesById = useMemo(() => new Map(boardNotes.map((n) => [n.id, n])), [boardNotes]);
  const noteMarks = useMemo(() => marksByNote(pairs, checkedPairs), [pairs, checkedPairs]);
  const toggleCheckedPair = useCallback((key: string) => {
    setCheckedPairs((prev) => togglePair(prev, key));
  }, []);
  const persistNoteCategory = useCallback(async (
    noteId: string,
    desired: FourCategory | null,
    retryFingerprint?: string,
  ) => {
    if (categoryBusyRef.current.has(noteId)) return;
    if (!token && !fixtureRows) {
      setCategoryErrors((current) => ({
        ...current,
        [noteId]: {
          message: '본부 연결 토큰이 없어 범주를 저장할 수 없습니다. 다시 로그인해 주세요.',
          retry: null,
        },
      }));
      return;
    }
    const previous = catState.get(noteId) ?? null;
    const applyValue = (state: CategoryState, value: FourCategory | null): CategoryState =>
      value ? assignCategory(state, noteId, value) : unassignCategory(state, noteId);
    setCatState((current) => applyValue(current, desired));
    setCategoryErrors((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });
    if (!token) return; // fixtureRows preview keeps changes in-memory only.
    const note = wholeBoard?.teams
      .flatMap((candidate) => candidate.notes)
      .find((candidate) => candidate.id === noteId);
    if (!note?.submissionId || !note.submissionUpdatedAt || !note.itemId) {
      setCatState((current) => applyValue(current, previous));
      setCategoryErrors((current) => ({
        ...current,
        [noteId]: {
          message: '이 카드의 서버 항목을 찾지 못했습니다. 보드를 다시 확인해 주세요.',
          retry: null,
        },
      }));
      return;
    }

    const expectedEventId = categoryIdentityRef.current.get(noteId)?.eventId ?? null;
    const intent = resolveHqAssignmentIntent(categoryIntentRef.current.get(noteId), {
      assignmentKind: 'category',
      sessionSlug: CURRENT_SESSION_SLUG,
      submissionId: note.submissionId,
      itemOrdinal: note.ordinal,
      sourceItemId: note.itemId,
      desired,
      expectedSubmissionUpdatedAt: note.submissionUpdatedAt,
      expectedEventId,
    });
    if (retryFingerprint !== undefined && intent.fingerprint !== retryFingerprint) {
      categoryIntentRef.current.delete(noteId);
      setCatState((current) => applyValue(current, previous));
      const message = '카드가 변경되어 이전 저장 요청을 다시 적용하지 않았습니다. 최신 카드에서 다시 지정해 주세요.';
      setCategoryErrors((current) => ({
        ...current,
        [noteId]: { message, retry: null },
      }));
      setOperationError(message);
      return;
    }
    categoryIntentRef.current.set(noteId, intent);
    const viewEpoch = assignmentViewEpochRef.current;
    const operationSequence = assignmentOperationSequenceRef.current + 1;
    assignmentOperationSequenceRef.current = operationSequence;
    categoryOperationRef.current.set(noteId, {
      sequence: operationSequence,
      sourceItemId: note.itemId,
    });

    // Invalidate category reads started before this write. A late stale response
    // must not replace the optimistic value after the busy flag is released.
    categoryRefreshSequenceRef.current += 1;
    categoryBusyRef.current = new Set(categoryBusyRef.current).add(noteId);
    setCategoryBusy(new Set(categoryBusyRef.current));
    const isCurrentOperation = () => isHqAssignmentContinuationCurrent(
      categoryOperationRef.current.get(noteId)?.sequence,
      operationSequence,
      assignmentViewEpochRef.current,
      viewEpoch,
    );
    let busyReleased = false;
    const releaseBusy = () => {
      if (busyReleased) return;
      busyReleased = true;
      if (categoryOperationRef.current.get(noteId)?.sequence !== operationSequence) return;
      const nextBusy = new Set(categoryBusyRef.current);
      nextBusy.delete(noteId);
      categoryBusyRef.current = nextBusy;
      setCategoryBusy(new Set(nextBusy));
    };
    const retireOperation = () => {
      if (categoryOperationRef.current.get(noteId)?.sequence === operationSequence) {
        categoryOperationRef.current.delete(noteId);
      }
    };
    let mutationAnswered = false;
    try {
      const result = await assignSubmissionCategory(token, CURRENT_SESSION_SLUG, {
        submissionId: note.submissionId,
        itemOrdinal: note.ordinal,
        category: desired,
        expectedSubmissionUpdatedAt: note.submissionUpdatedAt,
        expectedEventId,
        idempotencyKey: intent.idempotencyKey,
      });
      mutationAnswered = true;
      if (!isCurrentOperation()) return;
      categoryIntentRef.current.delete(noteId);
      if (result.status === 'conflict' || result.source_item_id !== note.itemId) {
        const message = result.status === 'conflict'
          ? hqAssignmentConflictMessage({
              assignmentKind: 'category',
              expectedSubmissionUpdatedAt: note.submissionUpdatedAt,
              currentSubmissionUpdatedAt: result.current_submission_updated_at,
              expectedEventId,
              currentEventId: result.current_event_id,
            })
          : '원문이 변경됨. 최신 보드를 확인한 뒤 최신 카드에서 다시 지정해 주세요.';
        setCatState((current) => applyValue(current, previous));
        releaseBusy();
        if (!isCurrentOperation()) return;
        await reloadAssignmentBoard();
        if (!isCurrentOperation()) return;
        setCategoryErrors((current) => ({
          ...current,
          [noteId]: { message, retry: null },
        }));
        setOperationError(message);
        return;
      }
      categoryIdentityRef.current.set(noteId, {
        eventId: result.event_id,
        sourceItemId: result.source_item_id,
      });
      releaseBusy();
      if (!isCurrentOperation()) return;
      await reloadAssignmentBoard();
      if (!isCurrentOperation()) return;
    } catch (error: unknown) {
      console.error('[HQ submissions] category assign failed', error);
      if (handleRpcAuthorizationError(error)) return;
      if (!isCurrentOperation()) return;
      if (mutationAnswered) {
        const message = '저장 결과는 처리되었지만 최신 보드를 다시 읽지 못했습니다. 보드를 다시 연결해 확인해 주세요.';
        setCategoryErrors((current) => ({
          ...current,
          [noteId]: { message, retry: null },
        }));
        setOperationError(message);
        return;
      }
      setCatState((current) => applyValue(current, previous));
      setCategoryErrors((current) => ({
        ...current,
        [noteId]: {
          message: `범주를 저장하지 못해 이전 값으로 되돌렸습니다. ${describeError(error)}`,
          retry: { desired, fingerprint: intent.fingerprint },
        },
      }));
    } finally {
      releaseBusy();
      retireOperation();
    }
  }, [catState, fixtureRows, handleRpcAuthorizationError, reloadAssignmentBoard, token, wholeBoard]);

  const toggleNoteCategory = useCallback((noteId: string, category: FourCategory) => {
    const desired = toggleCategory(catState, noteId, category).get(noteId) ?? null;
    void persistNoteCategory(noteId, desired);
  }, [catState, persistNoteCategory]);

  const retryNoteCategory = useCallback((noteId: string) => {
    const failure = categoryErrors[noteId];
    if (failure?.retry) {
      void persistNoteCategory(noteId, failure.retry.desired, failure.retry.fingerprint);
    }
  }, [categoryErrors, persistNoteCategory]);
  /**
   * 카드에 종류를 붙였다 뗀다. 화면을 먼저 바꾸고 서버에 보낸다
   * (누를 때마다 기다리게 하지 않는다).
   *
   * 🔴 예전에 이 함수는 의존성이 `[]` 였다. /hq 는 rows 가 null 로 시작하므로 첫 렌더의
   * `board` 는 null 이고, 빈 배열이면 그 null 이 **영원히 붙잡힌다.** 그래서
   * `board?.teams.find(...)` 가 언제나 undefined 가 되어 저장 RPC 가 **한 번도 불리지
   * 않았다.** 화면에는 배지가 붙으니 저장된 것처럼 보이고, 새로고침해야만 사라진 걸 안다 —
   * 실패가 조용해서 더 위험했다.
   *
   * 🔴 서버 호출을 setState **업데이터 밖으로** 뺀다. 업데이터 안의 부수효과는
   * StrictMode 에서 두 번 실행되고, 이 표는 append-only 라 같은 배정이 두 줄 쌓인다.
   *
   * 🔴 `board` 가 아니라 `wholeBoard` 에서 카드를 찾는다. board 는 분과 필터가 걸린
   * 보드라, 분과를 좁혀 놓고 붙인 배정이 조용히 누락됐다.
   */
  const persistNoteKind = useCallback(async (
    noteId: string,
    desired: OntologyKind | null,
    retryFingerprint?: string,
  ) => {
    if (kindBusyRef.current.has(noteId)) return;
    if (!token && !fixtureRows) {
      setKindErrors((current) => ({
        ...current,
        [noteId]: {
          message: '본부 연결 토큰이 없어 종류를 저장할 수 없습니다. 다시 로그인해 주세요.',
          retry: null,
        },
      }));
      return;
    }
    const previous = kindState.get(noteId) ?? null;
    setKindState((current) => desired ? assignKind(current, noteId, desired) : unassignKind(current, noteId));
    const nextBusy = new Set(kindBusyRef.current);
    nextBusy.add(noteId);
    kindBusyRef.current = nextBusy;
    setKindBusy(new Set(nextBusy));
    setKindErrors((current) => {
      const next = { ...current };
      delete next[noteId];
      return next;
    });

    // Fixture mode intentionally remains local-only.
    if (!token) {
      const finished = new Set(kindBusyRef.current);
      finished.delete(noteId);
      kindBusyRef.current = finished;
      setKindBusy(new Set(finished));
      return;
    }

    const note = wholeBoard?.teams
      .flatMap((candidate) => candidate.notes)
      .find((candidate) => candidate.id === noteId);
    if (!note?.submissionId || !note.submissionUpdatedAt || !note.itemId) {
      setKindState((current) => previous
        ? assignKind(current, noteId, previous)
        : unassignKind(current, noteId));
      const finished = new Set(kindBusyRef.current);
      finished.delete(noteId);
      kindBusyRef.current = finished;
      setKindBusy(new Set(finished));
      setKindErrors((current) => ({
        ...current,
        [noteId]: {
          message: '저장할 제출물 정보를 찾지 못했습니다. 보드를 다시 불러온 뒤 시도해 주세요.',
          retry: null,
        },
      }));
      return;
    }
    const expectedEventId = kindIdentityRef.current.get(noteId)?.eventId ?? null;
    const intent = resolveHqAssignmentIntent(kindIntentRef.current.get(noteId), {
      assignmentKind: 'kind',
      sessionSlug: CURRENT_SESSION_SLUG,
      submissionId: note.submissionId,
      itemOrdinal: note.ordinal,
      sourceItemId: note.itemId,
      desired,
      expectedSubmissionUpdatedAt: note.submissionUpdatedAt,
      expectedEventId,
    });
    if (retryFingerprint !== undefined && intent.fingerprint !== retryFingerprint) {
      kindIntentRef.current.delete(noteId);
      setKindState((current) => previous
        ? assignKind(current, noteId, previous)
        : unassignKind(current, noteId));
      const finished = new Set(kindBusyRef.current);
      finished.delete(noteId);
      kindBusyRef.current = finished;
      setKindBusy(new Set(finished));
      const message = '카드가 변경되어 이전 저장 요청을 다시 적용하지 않았습니다. 최신 카드에서 다시 지정해 주세요.';
      setKindErrors((current) => ({
        ...current,
        [noteId]: { message, retry: null },
      }));
      setOperationError(message);
      return;
    }
    kindIntentRef.current.set(noteId, intent);
    kindWriteEpochRef.current += 1;
    const viewEpoch = assignmentViewEpochRef.current;
    const operationSequence = assignmentOperationSequenceRef.current + 1;
    assignmentOperationSequenceRef.current = operationSequence;
    kindOperationRef.current.set(noteId, {
      sequence: operationSequence,
      sourceItemId: note.itemId,
    });
    const isCurrentOperation = () => isHqAssignmentContinuationCurrent(
      kindOperationRef.current.get(noteId)?.sequence,
      operationSequence,
      assignmentViewEpochRef.current,
      viewEpoch,
    );
    let busyReleased = false;
    const releaseBusy = () => {
      if (busyReleased) return;
      busyReleased = true;
      if (kindOperationRef.current.get(noteId)?.sequence !== operationSequence) return;
      const finished = new Set(kindBusyRef.current);
      finished.delete(noteId);
      kindBusyRef.current = finished;
      setKindBusy(new Set(finished));
    };
    const retireOperation = () => {
      if (kindOperationRef.current.get(noteId)?.sequence === operationSequence) {
        kindOperationRef.current.delete(noteId);
      }
    };
    let mutationAnswered = false;
    try {
      const result = await assignSubmissionKind(token, CURRENT_SESSION_SLUG, {
        submissionId: note.submissionId,
        itemOrdinal: note.ordinal,
        kind: desired,
        expectedSubmissionUpdatedAt: note.submissionUpdatedAt,
        expectedEventId,
        idempotencyKey: intent.idempotencyKey,
      });
      mutationAnswered = true;
      if (!isCurrentOperation()) return;
      kindIntentRef.current.delete(noteId);
      if (result.status === 'conflict' || result.source_item_id !== note.itemId) {
        const message = result.status === 'conflict'
          ? hqAssignmentConflictMessage({
              assignmentKind: 'kind',
              expectedSubmissionUpdatedAt: note.submissionUpdatedAt,
              currentSubmissionUpdatedAt: result.current_submission_updated_at,
              expectedEventId,
              currentEventId: result.current_event_id,
            })
          : '원문이 변경됨. 최신 보드를 확인한 뒤 최신 카드에서 다시 지정해 주세요.';
        setKindState((current) => previous ? assignKind(current, noteId, previous) : unassignKind(current, noteId));
        releaseBusy();
        if (!isCurrentOperation()) return;
        await reloadAssignmentBoard();
        if (!isCurrentOperation()) return;
        setKindErrors((current) => ({
          ...current,
          [noteId]: { message, retry: null },
        }));
        setOperationError(message);
        return;
      }
      kindIdentityRef.current.set(noteId, {
        eventId: result.event_id,
        sourceItemId: result.source_item_id,
      });
      releaseBusy();
      if (!isCurrentOperation()) return;
      await reloadAssignmentBoard();
      if (!isCurrentOperation()) return;
    } catch (error: unknown) {
      console.error('[HQ submissions] kind assign failed', error);
      if (handleRpcAuthorizationError(error)) return;
      if (!isCurrentOperation()) return;
      if (mutationAnswered) {
        const message = '저장 결과는 처리되었지만 최신 보드를 다시 읽지 못했습니다. 보드를 다시 연결해 확인해 주세요.';
        setKindErrors((current) => ({
          ...current,
          [noteId]: { message, retry: null },
        }));
        setOperationError(message);
        return;
      }
      setKindState((current) => previous ? assignKind(current, noteId, previous) : unassignKind(current, noteId));
      setKindErrors((current) => ({
        ...current,
        [noteId]: {
          message: `종류를 저장하지 못해 이전 값으로 되돌렸습니다. ${describeError(error)}`,
          retry: { desired, fingerprint: intent.fingerprint },
        },
      }));
    } finally {
      // Invalidate reads that began before or during this write.
      if (kindOperationRef.current.get(noteId)?.sequence === operationSequence) {
        kindWriteEpochRef.current += 1;
      }
      releaseBusy();
      retireOperation();
    }
  }, [fixtureRows, handleRpcAuthorizationError, kindState, reloadAssignmentBoard, token, wholeBoard]);

  const toggleNoteKind = useCallback((noteId: string, kind: OntologyKind) => {
    const desired = toggleKind(kindState, noteId, kind).get(noteId) ?? null;
    void persistNoteKind(noteId, desired);
  }, [kindState, persistNoteKind]);

  const retryNoteKind = useCallback((noteId: string) => {
    const failure = kindErrors[noteId];
    if (failure?.retry) {
      void persistNoteKind(noteId, failure.retry.desired, failure.retry.fingerprint);
    }
  }, [kindErrors, persistNoteKind]);
  // L4 — 묶음 = 사람이 ✓ 한 닮은 짝 하나(카드 두 장). **짝을 합쳐 큰 묶음을 만들지 않는다** —
  // 합치는 순간 그게 회의자료가 금지한 「조별 결과 임의 통합」이다.
  const repGroups = useMemo(
    () => groupsFromCheckedPairs(pairs, checkedPairs),
    [pairs, checkedPairs],
  );
  const repState = useMemo<RepresentativeState>(
    () => ({ groups: groupsMapOf(repGroups), history: repHistory }),
    [repGroups, repHistory],
  );
  const repMarks = useMemo(
    () => representativeNoteIds(repState, repGroups),
    [repState, repGroups],
  );
  /** 지목 시도. 성립하지 않으면 **이유별 한국어 안내**를 돌려준다(예외를 삼키지 않는다). */
  const doPick = useCallback(
    (groupId: string, noteId: string, actor: RepresentativeActor): string | null => {
      try {
        const next = pickRepresentative(repState, groupId, noteId, actor);
        setRepHistory(next.history);
        return null;
      } catch (error) {
        return describePickFailure(error);
      }
    },
    [repState],
  );
  // ★ 카운터는 **검색어와 무관한** 꼭지·분과 전체(boardNotes)로 센다. 검색으로 좁힌 수를 쓰면
  // 「원문 N장」이 타이핑에 따라 흔들려 카드가 사라진 것처럼 읽힌다.
  const preservation = useMemo(
    () => preservationInvariant(boardNotes, catState),
    [boardNotes, catState],
  );
  // 「미지정 N장」도 같은 기준(꼭지·분과 전체, 검색어와 무관)으로 센다. 사람이 손으로 붙이는
  // 이름표라 화면에 안 보이는 카드까지 세면 끝나지 않는 숙제가 된다(US-012 기록).
  const kindReport = useMemo(() => kindPreservation(boardNotes, kindState), [boardNotes, kindState]);

  // 온톨로지 내보내기 — ★ **거르지 않은 꼭지 전체**(wholeBoard)를 쓴다. 조 순번(t01)은 board.teams
  // 에서의 자리로 매기므로, 분과로 거른 보드를 넘기면 같은 카드가 다른 순번을 받아 다른 분과의
  // 스냅샷과 노드 id 가 충돌한다(ontology-snapshot.ts 주석). 화면이 좁아도 파일은 꼭지 전체다.
  const exportReadiness = useMemo(
    () => ontologyExportReadiness(wholeBoard ? flattenNotes(wholeBoard) : []),
    [wholeBoard],
  );
  const exportPreservation = useMemo(
    () =>
      wholeBoard
        ? ontologyExportPreservation(wholeBoard)
        : { submitted: 0, nodes: 0, deleted: 0, ok: true },
    [wholeBoard],
  );
  /**
   * 온톨로지 검수 파일 두 개를 한 번에 낸다 — 스냅샷 + **봉인된 검수 계획**.
   *
   * 예전에는 스냅샷만 내주고 계획은 사람이 터미널에서 만들어야 했다. 행사장에서
   * 총괄모더레이터가 할 수 있는 일이 아니다. 계획 생성은 CLI와 **같은 순수 로직**을 쓰고
   * (automation/canvas-ontology-plan.mjs) 해시만 Web Crypto로 구한다 — 값이 같음을
   * ontology-plan.test.ts 가 CLI 출력과 대조해 못 박는다.
   */
  const doExportPlan = useCallback(async () => {
    if (!wholeBoard || !exportReadiness.exportable) return;
    try {
      const snapshot = boardToOntologySnapshot(wholeBoard, new Date().toISOString());
      const stamp = formatStamp(new Date()).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
      const files = await buildSealedPlanFiles(snapshot, activeSubgroup ?? '전체', stamp);
      for (const file of [files.snapshot, files.plan]) {
        const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('[HQ submissions] ontology plan export failed', error);
      setFailed(describeError(error));
    }
  }, [wholeBoard, exportReadiness, activeSubgroup]);

  const doExportOntology = useCallback(() => {
    if (!wholeBoard || !exportReadiness.exportable) return;
    // 시각은 **여기서** 읽는다 — 순수 모듈은 시계를 읽지 않는다(같은 입력이면 같은 출력).
    const file = buildOntologyExport(wholeBoard, new Date().toISOString());
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [wholeBoard, exportReadiness]);

  /**
   * 내려받기 — 지금 화면에 걸린 범위(분과 필터 포함)를 그대로 낸다.
   *
   * 요약하지 않고 순서를 바꾸지 않는다. 「약간의 편집」은 받는 사람이 워드에서 한다.
   * 시각은 여기서 읽는다 — 순수 모듈은 시계를 읽지 않는다(같은 입력이면 같은 출력).
   */
  const buildReport = useCallback(() => {
    const scoped = activeSubgroup ?? `전체 ${wholeBoard ? wholeBoard.teams.length : 0}개 조`;
    const scopedBoards = activeSubgroup
      ? boards.map((b) => filterBoardBySubgroup(b, activeSubgroup))
      : boards;
    return buildSubmissionReport(scopedBoards, {
      generatedAt: formatStamp(new Date()),
      scopeLabel: scoped,
    });
  }, [boards, activeSubgroup, wholeBoard]);

  const saveFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const doDownload = async (kind: 'docx' | 'csv' | 'txt') => {
    setDownloading(true);
    try {
      const report = buildReport();
      if (kind === 'docx') {
        saveFile(await submissionReportBlob(report), reportFileName(report, 'docx'));
      } else if (kind === 'csv') {
        saveFile(
          new Blob([reportToCsv(report)], { type: 'text/csv;charset=utf-8' }),
          reportFileName(report, 'csv')
        );
      } else {
        saveFile(
          new Blob([reportToText(report)], { type: 'text/plain;charset=utf-8' }),
          reportFileName(report, 'txt')
        );
      }
      setOperationError(null);
      setDownloadOpen(false);
    } catch (error) {
      console.error('[HQ submissions] download failed', error);
      setOperationError(`파일을 만들지 못했습니다. ${describeError(error)}`);
    } finally {
      setDownloading(false);
    }
  };

  const doReopen = async () => {
    if (!reopening || !token) return;
    setReopenBusy(true);
    try {
      await reopenSubmission(token, CURRENT_SESSION_SLUG, reopening.submissionId, reopenReason.trim());
      setOperationError(null);
      setReopening(null);
      setReopenReason('');
      await load();
      if (historyOpen) await loadHistory();
    } catch (error) {
      console.error('[HQ submissions] reopen failed', error);
      if (handleRpcAuthorizationError(error)) return;
      setOperationError(`제출물을 다시 열지 못했습니다. ${describeError(error)}`);
    } finally {
      setReopenBusy(false);
    }
  };

  const loadHistory = async () => {
    if (!token) return;
    try {
      setHistory(await fetchHqSubmissionHistory(token, CURRENT_SESSION_SLUG));
      setOperationError(null);
    } catch (error) {
      console.error('[HQ submissions] history failed', error);
      if (handleRpcAuthorizationError(error)) return;
      setHistory([]);
      setOperationError(`이력을 불러오지 못했습니다. ${describeError(error)}`);
    }
  };

  /**
   * 꼭지 마감을 걸거나 지운다 — 무엇을 보낼지는 `planDeadline` 이 정한다.
   *
   * ★ 마감은 **잠금이 아니다.** RPC 가 꼭지 status 를 안 건드리므로 마감 뒤에도 조는
   *   계속 저장할 수 있다. 8.29 에 실제로 일어난 일(다 정리했는데 못 올림)이 반복되지 않도록
   *   시간을 알리기만 한다.
   */
  const applyDeadline = async (mode: 'set' | 'clear') => {
    if (!token || !board) return;
    const topicId = board.topicId;
    const plan = planDeadline(mode, deadlineDraft[topicId] ?? '');
    if (plan.kind === 'reject') {
      setDeadlineError({ topicId, message: plan.message });
      return;
    }
    setDeadlineBusy(true);
    setDeadlineError(null);
    const expectedDeadlineAt = deadlineServer?.[topicId] ?? null;
    const intentKey = `deadline:${topicId}:${expectedDeadlineAt ?? 'none'}:${plan.deadlineAt ?? 'none'}`;
    const requestId = deadlineRequestIdsRef.current.get(intentKey) ?? crypto.randomUUID();
    deadlineRequestIdsRef.current.set(intentKey, requestId);
    try {
      await setWorkshopDeadline(
        token,
        CURRENT_SESSION_SLUG,
        topicId,
        expectedDeadlineAt,
        plan.deadlineAt,
        requestId,
      );
      deadlineRequestIdsRef.current.delete(intentKey);
      setDeadlineApplied((prev) => ({ ...prev, [topicId]: plan.deadlineAt }));
      // 서버가 받아 준 값이므로 되읽기 맵도 같이 옮긴다 — 다음 폴링까지 옛 값이 남지 않게.
      // ★ 아직 한 번도 못 읽었으면(null) **만들지 않는다.** 「모름」을 「서버에서 읽었다」로
      //   바꾸는 것은 없는 사실을 지어내는 것이고, s19 미적용 DB 에서 정확히 그렇게 된다.
      setDeadlineServer((prev) => (prev === null ? null : { ...prev, [topicId]: plan.deadlineAt }));
      if (plan.kind === 'clear') setDeadlineDraft((prev) => ({ ...prev, [topicId]: '' }));
      void loadDeadlines();
    } catch (error) {
      console.error('[HQ submissions] deadline failed', error);
      if (handleRpcAuthorizationError(error)) return;
      if (error instanceof WorkshopHqDeadlineConflictError) {
        setDeadlineError({
          topicId,
          message: '다른 운영자가 마감을 먼저 바꿨습니다. 최신 값을 다시 불러왔으니 확인 후 다시 시도해 주세요.',
        });
        await loadDeadlines();
      } else {
        setDeadlineError({ topicId, message: deadlineFailureMessage(mode, error) });
        await loadDeadlines();
      }
    } finally {
      setDeadlineBusy(false);
    }
  };

  const copyBoard = async () => {
    if (!board) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(boardToText(board));
      setCopied(true);
    } catch (error) {
      console.warn('[HQ submissions] clipboard copy failed', error);
      setCopyError('클립보드에 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.');
    }
  };

  // 무엇을 그릴지는 한 곳에서 정한다(hq-session-state.ts). 화면이 회차를 바꾼 직후
  // 개통 SQL 적용 전이면 여기서 「아직 개통되지 않았다」로 갈린다.
  const view = hqBoardState({
    rows,
    failed,
    boardCount: boards.length,
    sessionSlug: CURRENT_SESSION_SLUG,
  });

  if (view.kind === 'loading') {
    return <p className="p-6 text-[16px] text-[#5A6B73]">조별 산출물을 불러오는 중…</p>;
  }

  if (view.kind === 'failed') {
    return (
      <div className="p-6">
        <p role="alert" className="rounded-lg bg-[#FFF4D6] px-4 py-3 text-[15px] font-bold text-[#6B4B00]">
          조별 산출물을 불러오지 못했습니다 — {view.message}
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

  // `!board` 는 boardCount 0 과 같은 조건이다(보드가 비어야 board 가 null 이다).
  // 둘을 함께 적는 것은 타입을 좁히기 위해서다 — 아래 코드는 board 가 있어야 돈다.
  if (view.kind === 'not-opened' || !board) {
    const notice = view.kind === 'not-opened' ? view : notOpenedMessage(CURRENT_SESSION_SLUG);
    return (
      <div className="p-6">
        <div className="rounded-2xl border-2 border-[#C4D8E4] bg-[#F4F9FC] px-6 py-6">
          <p role="status" className="text-[26px] font-extrabold leading-snug text-[#1F4E79]">
            {notice.headline}
          </p>
          <p className="mt-3 max-w-[64ch] text-[18px] leading-relaxed text-[#33474F]">
            {notice.detail}
          </p>
          <p className="mt-2 max-w-[64ch] text-[16px] leading-relaxed text-[#5A6B73]">
            {notice.hint}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-4 h-12 rounded-xl border border-[#C4D8E4] bg-white px-5 text-[16px] font-bold text-[#1F4E79]"
          >
            다시 확인
          </button>
        </div>
      </div>
    );
  }

  // 마감 줄에 낼 한 줄과 그 출처. 서버(s19)를 읽었으면 서버 값, 못 읽었으면 s19 이전 표시.
  const deadlineShown = deadlineView(deadlineServer, board.topicId, deadlineApplied[board.topicId]);
  // 입력칸의 기본값 — 아직 아무것도 치지 않았으면 **서버의 현재 마감**이 들어가 있다.
  // 이것이 「새로고침하면 자기가 뭘 걸었는지 모른다」의 나머지 반쪽이다.
  // ('' 는 undefined 가 아니라서 「지우기」 뒤에는 ?? 가 안 걸린다 — 빈 칸이 그대로 유지된다.)
  const deadlineServerValue = deadlineServer?.[board.topicId] ?? null;

  // 검색으로 먼저 거르고 그 다음에 재배열한다 — 유사도 사슬은 **화면에 보이는 카드끼리** 잇는다.
  // (거르기 전에 정렬하면 안 보이는 카드가 사슬 중간에 끼어 이웃이 엉뚱해진다.)
  const visibleNotes = grouped ? [] : filterNotes(flattenNotes(board), query);
  const notes = sortMode === 'similar' ? orderNotesBySimilarity(visibleNotes) : visibleNotes;
  // ── 발표 모드 ────────────────────────────────────────────────────
  // 조작 요소를 전부 걷어내고 글만 남긴다. 여러 사람이 동시에 읽는 화면이므로
  // 본문을 크게 키우고(28px) 한 줄 길이를 제한한다. 자동 갱신은 그대로 돈다 —
  // 발표 중에 다른 조가 저장하면 그 자리에서 따라와야 한다.
  if (presentMode && activeSubgroup) {
    const block = groupBySubgroup(board)[0];
    const presentTeams = block ? block.teams : board.teams;
    // 「조 하나씩」이면 그 조만 그린다. 선택이 갱신 중에 사라지면 전체로 되돌아간다.
    const focused = focusedTeam(presentTeams, presentTeamId);
    const shownTeams = focused ? [focused] : presentTeams;
    const position = focusPosition(presentTeams, presentTeamId);
    // 조가 얼마나 쓸지 미리 알 수 없다 — 분량을 보고 한 단계씩 줄인다(하한 24px).
    // ★ 지금 그리는 것만으로 잰다 — 한 조만 볼 때 다른 조 분량 때문에 작아지면 안 된다.
    const scale = presentScale(shownTeams);
    // 「이 조만 말한 것」은 발표 모드에서도 보인다. 분과 공유의 목적이
    // 겹치는 것 확인만이 아니라 한 조만 꺼낸 이야기를 건지는 것이기도 하다.
    // ⚠️ 검색으로 거르기 전 카드로 센다 — 검색어에 따라 표시가 바뀌면 안 된다.
    const presentUnique = uniqueNoteIds(flattenNotes(board));
    // ★ 전부 「이 조만」이면 배지는 아무 말도 하지 않는다. 겹치는 카드가 하나도
    // 없는 날(오늘처럼 조마다 다른 낱말을 쓴 경우) 56줄에 배지가 56개 붙어
    // 화면만 시끄러워진다. 겹침이 하나라도 있을 때만 켠다.
    const presentAllNotes = flattenNotes(board);
    const showOwnBadge = presentUnique.size < presentAllNotes.length;
    return (
      <div className="min-h-screen bg-white p-6 sm:p-10">
        <header className="mb-8 flex flex-wrap items-baseline gap-4 border-b-4 border-[#1F4E79] pb-4">
          <h1 className="text-[44px] font-extrabold leading-none text-[#1F4E79]">{activeSubgroup}</h1>
          <p className="text-[30px] font-bold text-[#0F6B78]">{board.prompt}</p>
          <p className="ml-auto text-[22px] font-bold text-[#5A6B73] tr-num">
            {board.teamsWithNotes}/{board.teams.length}개 조 · {board.totalNotes}건
          </p>
          <div className="flex items-center gap-2 print:hidden">
            {/* 전체 ↔ 조 하나씩. 기본은 전체(기존 동작). */}
            <button
              type="button"
              aria-pressed={presentTeamId === null}
              onClick={() => setPresentTeamId(null)}
              className={`h-12 rounded-xl border px-4 text-[16px] font-bold ${
                presentTeamId === null
                  ? 'border-[#1F4E79] bg-[#1F4E79] text-white'
                  : 'border-[#C4D8E4] bg-white text-[#1F4E79]'
              }`}
            >
              전체
            </button>
            <button
              type="button"
              aria-pressed={presentTeamId !== null}
              data-testid="present-one-team"
              onClick={() => setPresentTeamId(firstFocusTeamId(presentTeams))}
              className={`h-12 rounded-xl border px-4 text-[16px] font-bold ${
                presentTeamId !== null
                  ? 'border-[#1F4E79] bg-[#1F4E79] text-white'
                  : 'border-[#C4D8E4] bg-white text-[#1F4E79]'
              }`}
            >
              조 하나씩
            </button>
            <button
              type="button"
              onClick={() => {
                setPresentMode(false);
                setPresentTeamId(null);
              }}
              className="h-12 rounded-xl border border-[#C4D8E4] px-4 text-[16px] font-bold text-[#5A6B73]"
            >
              나가기
            </button>
          </div>
        </header>

        {/* 조 하나씩일 때만 나오는 이동 줄. 화살표 키(← →)로도 넘긴다. */}
        {focused ? (
          <div className="mb-6 flex items-center gap-4 print:hidden">
            <button
              type="button"
              onClick={() => setPresentTeamId(stepTeam(presentTeams, presentTeamId, -1))}
              className="h-14 rounded-xl border-2 border-[#1F4E79] px-6 text-[20px] font-extrabold text-[#1F4E79]"
            >
              ◀ 이전
            </button>
            <button
              type="button"
              onClick={() => setPresentTeamId(stepTeam(presentTeams, presentTeamId, 1))}
              className="h-14 rounded-xl border-2 border-[#1F4E79] px-6 text-[20px] font-extrabold text-[#1F4E79]"
            >
              다음 ▶
            </button>
            {position ? (
              <span className="text-[22px] font-bold text-[#5A6B73] tr-num">
                {position.at} / {position.total}
              </span>
            ) : null}
            <span className="ml-auto text-[16px] font-bold text-[#526975]">
              ← → 키로도 넘길 수 있습니다
            </span>
          </div>
        ) : null}

        <div
          className="grid gap-6"
          style={{
            gridTemplateColumns: focused
              ? '1fr'
              : `repeat(auto-fill, minmax(${scale.columnMin}px, 1fr))`,
          }}
        >
          {shownTeams.map((team) => (
            <section key={team.teamId} className="rounded-2xl border-2 border-[#DCE7EE] p-5">
              <h2
                className="mb-4 flex items-baseline gap-3 font-extrabold text-[#1F4E79]"
                style={{ fontSize: `${scale.teamName}px` }}
              >
                {team.teamName}
                {team.tableNo ? (
                  <span className="text-[20px] font-bold text-[#5A6B73]">{team.tableNo}번 테이블</span>
                ) : null}
                <span className="ml-auto flex items-baseline gap-2">
                  {(() => {
                    const own = team.notes.filter((note) => presentUnique.has(note.id)).length;
                    return showOwnBadge && own > 0 ? (
                      <span
                        className="rounded-md bg-[#FFF0D6] px-2 font-extrabold text-[#8A5A00] tr-num"
                        style={{ fontSize: `${Math.round(scale.teamName * 0.62)}px` }}
                      >
                        이 조만 {own}
                      </span>
                    ) : null;
                  })()}
                  <span
                    className="font-extrabold text-[#0F6B78] tr-num"
                    style={{ fontSize: `${Math.round(scale.teamName * 0.8)}px` }}
                  >
                    {team.notes.length}
                  </span>
                </span>
              </h2>
              {team.notes.length === 0 ? (
                <p className="rounded-xl border-2 border-dashed border-[#C4D8E4] px-4 py-10 text-center text-[24px] text-[#526975]">
                  아직 없음
                </p>
              ) : (
                /* ★ 한 조만 볼 때는 2단으로 흘린다. 세로로만 쌓으면 56줄이 5화면을
                     넘어가 발표 중에 스크롤을 해야 하고, 청중은 위치를 잃는다.
                     동시에 오른쪽에 남던 여백도 이 단이 가져간다. 읽기 폭 자체는
                     단 안에서 그대로 지켜진다 — 폭을 넓히는 게 아니라 나누는 것이다. */
                <ol
                  className={focused ? 'space-y-3' : 'space-y-4'}
                  style={
                    focused
                      ? {
                          // 분량이 많으면 단을 하나 더 연다. 49줄이 2단으로도 3.4화면이라
                          // 발표 중 스크롤이 생겼다(1920×1080 실측). 3단이면 2.3화면.
                          // 1920 기준 3단은 한 단 약 590px — 24px 글자로 24자 안팎이라
                          // 읽기 폭으로도 무리가 없다.
                          columnCount: team.notes.length > 30 ? 3 : 2,
                          columnGap: '2.25rem',
                          columnRule: '1px solid #E6EEF3',
                        }
                      : undefined
                  }
                >
                  {team.notes.map((note, index) => (
                    <li
                      key={note.id}
                      className={focused ? 'flex gap-2.5' : 'flex gap-3'}
                      style={{ breakInside: 'avoid' }}
                    >
                      <span
                        className="mt-1 grid shrink-0 place-items-center rounded-lg bg-[#1F4E79] font-extrabold text-white tr-num"
                        style={{
                          height: `${scale.badge}px`,
                          width: `${scale.badge}px`,
                          fontSize: `${Math.round(scale.badge * 0.56)}px`,
                        }}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        {/* overflowWrap:'anywhere' — 띄어쓰기 없는 긴 낱말·주소가 들어와도
                            가로로 삐져나가지 않게 한다. 이것 하나가 「값이 어떻게 나오든」의
                            대부분을 막는다. */}
                        <p
                          className="whitespace-pre-wrap font-semibold text-[#1F2933]"
                          style={{
                            fontSize: `${scale.body}px`,
                            // 1.45 → 1.38. 24px 본문에서 여전히 편한 행간이면서
                            // 면적 낭비를 5%p 줄인다(1분과 1조 6,817자에서 실측).
                            lineHeight: focused ? 1.38 : 1.45,
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word',
                            // 전역 타이포그래피가 p 에 max-width 996px 을 걸어 카드
                            // 오른쪽 43%가 비어 있었다(1920 실측). 단으로 나눈 뒤에는
                            // 단 폭이 곧 읽기 폭이므로 제한을 풀어야 한다.
                            maxWidth: 'none',
                          }}
                        >
                          {note.content}
                          {showOwnBadge && presentUnique.has(note.id) ? (
                            <span
                              className="ml-2 align-middle rounded-md bg-[#FFF0D6] px-2 py-0.5 font-extrabold text-[#8A5A00]"
                              style={{ fontSize: `${Math.round(scale.body * 0.62)}px` }}
                            >
                              이 조만
                            </span>
                          ) : null}
                        </p>
                        {note.rationale ? (
                          <p
                            className="mt-2 text-[#5A6B73]"
                            style={{
                              fontSize: `${Math.round(scale.body * 0.72)}px`,
                              lineHeight: 1.5,
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word',
                            }}
                          >
                            {note.rationale}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>

        <p className="mt-10 text-center text-[18px] text-[#526975]">
          조가 저장하는 대로 자동으로 따라옵니다 · 이 화면에서는 고칠 수 없습니다
        </p>
      </div>
    );
  }

  const silent = silentTeams(board);

  return (
    <div className="mx-auto max-w-[1600px] p-4 sm:p-6">
      {/* 꼭지 선택 */}
      <div role="tablist" aria-label="꼭지" className="mb-4 flex flex-wrap gap-2">
        {boards.map((item, index) => {
          const selected = item.topicId === board.topicId;
          return (
            <button
              key={item.topicId}
              id={topicTabId(item.topicId)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={TOPIC_PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTopic(item.topicId)}
              onKeyDown={(event) => onTopicTabKeyDown(event, index)}
              className={`h-14 rounded-xl px-5 text-[18px] font-bold transition ${
                selected
                  ? 'bg-[#1F4E79] text-white shadow-sm'
                  : 'border border-[#DCE7EE] bg-white text-[#5A6B73]'
              }`}
            >
              {item.prompt}
              <span className={`ml-2 text-[15px] font-extrabold ${selected ? 'text-white' : 'text-[#0F6B78]'}`}>
                {item.totalNotes}
              </span>
            </button>
          );
        })}
      </div>

      <div
        id={TOPIC_PANEL_ID}
        role="tabpanel"
        aria-labelledby={topicTabId(board.topicId)}
        tabIndex={0}
      >

      {/* US-011 마감시각 — 고른 꼭지 하나에 건다. 본부 토큰이 있을 때만 낸다
          (미리보기 라우트는 토큰을 안 주므로 이 줄이 아예 안 그려진다).
          ★ 카드 수 검사가 부풀지 않도록 여기의 어떤 요소도 <article> 로 내지 않는다. */}
      {token ? (
        <div
          data-testid="hq-deadline-row"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[#DCE7EE] bg-white px-4 py-3"
        >
          <Eyebrow className="text-[#5A6B73]">마감</Eyebrow>
          <label htmlFor="hq-deadline-input" className="text-[16px] font-bold text-[#1F4E79]">
            「{board.prompt}」
          </label>
          <input
            id="hq-deadline-input"
            type="datetime-local"
            data-testid="hq-deadline-input"
            data-topic-id={board.topicId}
            value={deadlineDraft[board.topicId] ?? isoToLocalInput(deadlineServerValue)}
            onChange={(e) =>
              setDeadlineDraft((prev) => ({ ...prev, [board.topicId]: e.target.value }))
            }
            className="h-12 rounded-xl border border-[#C4D8E4] px-3 text-[16px]"
          />
          <button
            type="button"
            data-testid="hq-deadline-set"
            disabled={deadlineBusy}
            onClick={() => void applyDeadline('set')}
            className="h-12 rounded-xl bg-[#1F4E79] px-5 text-[16px] font-bold text-white disabled:opacity-50"
          >
            걸기
          </button>
          <button
            type="button"
            data-testid="hq-deadline-clear"
            disabled={deadlineBusy}
            onClick={() => void applyDeadline('clear')}
            className="h-12 rounded-xl border border-[#C4D8E4] px-5 text-[16px] font-bold text-[#5A6B73] disabled:opacity-50"
          >
            지우기
          </button>
          {/* 출처를 속성으로 함께 낸다 — 서버에서 읽은 값인지 이 화면의 마지막 조작인지가
              구별돼야 본부가 표시를 믿을 수 있다(검증도 문구가 아니라 이 속성을 집는다). */}
          <span
            data-testid="hq-deadline-echo"
            data-deadline-source={deadlineShown.source}
            className="text-[15px] font-bold text-[#5A6B73]"
          >
            {deadlineShown.label}
          </span>
          {/* 마감은 잠금이 아니고, 조 화면 배너는 30초마다 꼭지를 다시 읽는다.
              이 두 가지를 모르면 「안 걸렸다」로 오해해 같은 시각을 반복해서 건다. */}
          <span className="basis-full text-[14px] text-[#526975]">
            조 화면 배너에 최대 30초 뒤 뜹니다 · 마감이 지나도 조는 계속 저장할 수 있습니다
          </span>
          {deadlineRefresh.stale || deadlineRefresh.error ? (
            <div
              role="alert"
              data-testid="hq-deadline-refresh-error"
              className="basis-full flex flex-wrap items-center gap-3 rounded-lg border-2 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[#B91C1C]"
            >
              <p className="min-w-[220px] flex-1 text-[14px] font-extrabold leading-relaxed">
                {deadlineRefresh.error}{' '}
                {deadlineRefresh.lastSuccessAt === null
                  ? '아직 서버에서 확인된 마감 정보가 없습니다.'
                  : `마지막 정상 확인 ${new Date(deadlineRefresh.lastSuccessAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.`}
              </p>
              <button
                type="button"
                onClick={() => void loadDeadlines()}
                disabled={deadlineRefresh.busy}
                className="min-h-11 rounded-lg border-2 border-[#B91C1C] bg-white px-3 text-[14px] font-extrabold disabled:opacity-50"
              >
                {deadlineRefresh.busy ? '마감 다시 확인 중…' : '마감 다시 확인'}
              </button>
            </div>
          ) : (
            <span role="status" data-testid="hq-deadline-refresh-status" className="basis-full text-[13px] font-semibold text-[#526975]">
              {deadlineRefresh.busy
                ? '마감 정보 확인 중…'
                : deadlineRefresh.lastSuccessAt === null
                  ? '마감 정보를 처음 확인하는 중입니다.'
                  : `마감 정보 정상 확인 ${new Date(deadlineRefresh.lastSuccessAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
            </span>
          )}
          {deadlineError && deadlineError.topicId === board.topicId ? (
            <p
              role="alert"
              data-testid="hq-deadline-error"
              className="basis-full rounded-lg bg-[#FFF4D6] px-4 py-3 text-[15px] font-bold text-[#6B4B00]"
            >
              {deadlineError.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* 분과 필터 — 15개 조를 한 사람이 보지 않는다 */}
      {subgroups.length > 1 ? (
        <div role="group" aria-label="분과 선택" className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={activeSubgroup === null}
            onClick={() => setSubgroup(null)}
            className={`h-12 rounded-xl px-4 text-[16px] font-bold transition ${
              activeSubgroup === null
                ? 'bg-[#0F6B78] text-white'
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
                      ? 'bg-[#0F6B78] text-white'
                      : 'border border-[#C4D8E4] bg-white text-[#5A6B73]'
                  }`}
                >
                  {block.subgroup}
                  <span
                    className={`ml-2 text-[14px] font-extrabold tr-num ${
                      activeSubgroup === block.subgroup ? 'text-white' : 'text-[#0F6B78]'
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
              className={`h-12 px-4 text-[16px] font-bold ${grouped ? 'bg-[#0F6B78] text-white' : 'bg-white text-[#5A6B73]'}`}
            >
              조별
            </button>
            <button
              type="button"
              aria-pressed={!grouped}
              onClick={() => setGrouped(false)}
              className={`h-12 px-4 text-[16px] font-bold ${!grouped ? 'bg-[#0F6B78] text-white' : 'bg-white text-[#5A6B73]'}`}
            >
              모아보기
            </button>
          </div>
          {!grouped ? (
            <>
              {/* L1 정렬 — 배치만 바꾼다. 조별 순서가 기본.
                  「조별」(보기 방식)과 「조별 순서」(정렬)가 나란히 붙어 헷갈리므로 라벨을 둔다. */}
              <Eyebrow className="ml-1 text-[#526975]">정렬</Eyebrow>
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
          {/* US-013 — 「온톨로지」 관점 전환. **조별·모아보기 둘 다에서 보여야** 하므로
              정렬 버튼들(`!grouped` 안)이 아니라 이 자리에 둔다. 두 보기 모두 포스트잇을 그린다. */}
          <button
            type="button"
            aria-pressed={ontologyView}
            data-testid="ontology-view-toggle"
            onClick={() => setOntologyView((v) => !v)}
            title="카드마다 쟁점·주장·제안·우려·조건·가치·근거 중 하나를 사람이 붙입니다"
            className={`h-12 rounded-xl border px-4 text-[16px] font-bold ${
              ontologyView
                ? 'border-[#7A3E9D] bg-[#7A3E9D] text-white'
                : 'border-[#C4D8E4] bg-white text-[#1F4E79]'
            }`}
          >
            온톨로지
          </button>
          <button
            type="button"
            disabled={!activeSubgroup}
            title={activeSubgroup ? '' : '분과를 먼저 고르세요 — 발표는 분과 단위로 진행합니다'}
            onClick={() => setPresentMode(true)}
            className="h-12 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79] disabled:opacity-40"
          >
            발표 모드
          </button>
          {/* 안내가 title(hover)뿐이면 왜 안 눌리는지 모른 채 두세 번 더 누르게 된다.
              행사장에서는 그 몇 초가 아깝다 — 눈에 보이는 문장으로 같이 적는다. */}
          {!activeSubgroup ? (
            <span className="self-center text-[15px] font-bold text-[#8A5A00]">
              ← 분과를 먼저 고르세요
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const next = !historyOpen;
              setHistoryOpen(next);
              if (next && history === null) void loadHistory();
            }}
            aria-pressed={historyOpen}
            className={`h-12 rounded-xl border px-4 text-[16px] font-bold ${
              historyOpen
                ? 'border-[#1F4E79] bg-[#1F4E79] text-white'
                : 'border-[#C4D8E4] bg-white text-[#1F4E79]'
            }`}
          >
            이력
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setDownloadOpen((v) => !v)}
              aria-expanded={downloadOpen}
              className="h-12 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79]"
            >
              내려받기 ▾
            </button>
            {downloadOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[#DCE7EE] bg-white p-2 shadow-lg">
                <p className="px-2 py-1 text-[13px] text-[#526975]">
                  지금 보고 있는 범위를 그대로 냅니다
                </p>
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => void doDownload('docx')}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-[16px] font-bold text-[#1F4E79] hover:bg-[#F1F7FA] disabled:opacity-40"
                >
                  워드 문서 (.docx)
                  <span className="block text-[13px] font-normal text-[#5A6B73]">
                    손봐서 인쇄·PDF로 저장
                  </span>
                </button>
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => void doDownload('csv')}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-[16px] font-bold text-[#1F4E79] hover:bg-[#F1F7FA] disabled:opacity-40"
                >
                  엑셀 표 (.csv)
                  <span className="block text-[13px] font-normal text-[#5A6B73]">
                    한 줄 = 조가 쓴 한 문장
                  </span>
                </button>
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => void doDownload('txt')}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-[16px] font-bold text-[#1F4E79] hover:bg-[#F1F7FA] disabled:opacity-40"
                >
                  줄글 텍스트 (.txt)
                </button>
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => {
                    setPrintReport(buildReport());
                    setDownloadOpen(false);
                    // 문서가 DOM에 붙은 다음에 인쇄창을 연다.
                    setTimeout(() => window.print(), 150);
                  }}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-[16px] font-bold text-[#1F4E79] hover:bg-[#F1F7FA] disabled:opacity-40"
                >
                  인쇄 · PDF로 저장
                  <span className="block text-[13px] font-normal text-[#5A6B73]">
                    화면이 아니라 정리된 문서가 나갑니다 · 인쇄창에서 프린터 또는 「PDF로
                    저장」을 고르세요
                  </span>
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void copyBoard()}
            className="h-12 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79]"
          >
            {copied ? '복사됨' : '텍스트로 복사'}
          </button>
        </div>
        {copyError ? <p role="alert" className="mt-2 text-[14px] font-bold text-[#A62828]">{copyError}</p> : null}
      </div>

      {operationError ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[#B91C1C]"
        >
          <p className="min-w-[220px] flex-1 text-[15px] font-extrabold">{operationError}</p>
          <button
            type="button"
            onClick={() => setOperationError(null)}
            className="min-h-11 rounded-lg border-2 border-[#B91C1C] bg-white px-3 text-[14px] font-extrabold"
          >
            알림 닫기
          </button>
        </div>
      ) : null}
      {refreshError ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3 text-[#6B4B00]"
        >
          <p className="min-w-[220px] flex-1 text-[15px] font-extrabold">
            {refreshError}
            {refreshedAt ? ` 마지막 정상 확인 ${refreshedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.` : ''}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-11 rounded-lg border-2 border-[#6B4B00] bg-white px-3 text-[14px] font-extrabold"
          >
            지금 다시 연결
          </button>
        </div>
      ) : null}

      {historyOpen ? (
        <section className="mb-5 rounded-2xl border border-[#DCE7EE] bg-white p-4">
          <header className="mb-3 flex flex-wrap items-baseline gap-3">
            <h3 className="text-[19px] font-extrabold text-[#1F4E79]">저장·제출 이력</h3>
            <span className="text-[14px] text-[#5A6B73]">
              조가 저장하며 교체된 문장까지 남습니다 — 지워지지 않습니다
            </span>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="ml-auto h-10 rounded-lg border border-[#C4D8E4] px-3 text-[14px] font-bold text-[#1F4E79]"
            >
              새로고침
            </button>
          </header>
          {history === null ? (
            <p className="text-[15px] text-[#5A6B73]">불러오는 중…</p>
          ) : history.length === 0 ? (
            <p className="text-[15px] text-[#5A6B73]">아직 이력이 없습니다.</p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full text-left text-[15px]">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-[13px] font-bold uppercase text-[#526975]">
                    <th className="py-2 pr-3">시각</th>
                    <th className="py-2 pr-3">조</th>
                    <th className="py-2 pr-3">꼭지</th>
                    <th className="py-2 pr-3">무슨 일</th>
                    <th className="py-2">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, index) => (
                    <tr key={`${row.event_at}-${index}`} className="border-t border-[#EEF3F7] align-top">
                      <td className="py-2 pr-3 whitespace-nowrap tr-num text-[#5A6B73]">
                        {clock(row.event_at)}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap font-bold text-[#1F4E79]">
                        {row.team_name}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-[#5A6B73]">{row.topic_prompt}</td>
                      <td className="py-2 pr-3 whitespace-nowrap font-bold">
                        {row.kind === 'finalize'
                          ? '제출 완료'
                          : row.kind === 'reopen'
                            ? '다시 열기'
                            : '저장으로 교체됨'}
                      </td>
                      <td className="py-2 break-words text-[#1F2933]">{row.detail ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* L3 — 보존 카운터는 **접히지 않고 두 보기 모두에서 항상** 보인다. 「모으지 않았다」의 증명이다. */}
      {categoryLoadError ? (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#DC2626] bg-[#FEF2F2] px-4 py-3 text-[#B91C1C]">
          <p className="min-w-[220px] flex-1 text-[15px] font-extrabold">{categoryLoadError}</p>
          <button
            type="button"
            onClick={() => void loadCategories()}
            className="min-h-11 rounded-lg border-2 border-[#B91C1C] bg-white px-3 text-[14px] font-extrabold"
          >
            범주 다시 불러오기
          </button>
        </div>
      ) : null}
      {kindLoadError && ontologyView ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#B5651D] bg-[#FFF4D6] px-4 py-3 text-[#6B4B00]"
        >
          <p className="min-w-[220px] flex-1 text-[15px] font-extrabold">{kindLoadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="min-h-11 rounded-lg border-2 border-[#6B4B00] bg-white px-3 text-[14px] font-extrabold"
          >
            종류 다시 확인
          </button>
        </div>
      ) : null}
      <PreservationCounter report={preservation} />
      {/* US-013 — 관점을 켠 동안에만 뜬다. 이름표가 안 보이는데 「미지정 N장」만 떠 있으면
          무엇이 미지정인지 확인할 길이 없어 사람이 카운터를 못 믿는다. */}
      {ontologyView ? (
        <OntologyKindCounter notes={boardNotes} state={kindState} report={kindReport} />
      ) : null}
      {/* US-012 — 내보내기도 두 보기 모두에서 항상 보인다(꼭지 전체를 담으므로 보기 방식과 무관하다). */}
      <OntologyExportPanel
        preservation={exportPreservation}
        readiness={exportReadiness}
        subgroupNotice={activeSubgroup}
        onExport={doExportOntology}
      />
      <FourCategoryPanel notes={boardNotes} state={catState} />

      {silent.length > 0 ? (
        <p className="mb-5 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[16px] font-bold text-[#6B4B00]">
          아직 제출 없는 조 {silent.length} — {silent.join(' · ')}
        </p>
      ) : null}

      <TeamOverlapPanel overlaps={overlaps} uniqueByTeam={uniqueByTeam} teams={board.teams} />

      {grouped ? (
        <div className="space-y-7">
          {groupBySubgroup(board).map((block) => (
            <section key={block.subgroup}>
              <header className="mb-3 flex flex-wrap items-baseline gap-3">
                <h3 className="text-[22px] font-extrabold text-[#1F4E79]">{block.subgroup}</h3>
                <span className="text-[16px] font-bold text-[#5A6B73]">
                  <span className="text-[#0F6B78] tr-num">{block.teamsWithNotes}</span>/
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
                <span className="ml-auto text-[16px] font-extrabold text-[#0F6B78] tr-num">
                  {team.notes.length}
                </span>
                <StatusChip status={team.status} />
              </header>
              <p className="mb-3 text-[13px] text-[#526975] tr-num">
                저장 {clock(team.updatedAt)}
                {team.finalizedAt ? ` · 제출 ${clock(team.finalizedAt)}` : ''}
              </p>
              {team.status === 'final' && team.submissionId && token ? (
                <button
                  type="button"
                  onClick={() => {
                    setReopenReason('');
                    setReopening({
                      submissionId: team.submissionId as string,
                      teamName: team.teamName,
                    });
                  }}
                  className="mb-3 h-11 w-full rounded-xl border-2 border-[#8A4512] bg-white text-[15px] font-bold text-[#8A4512]"
                >
                  다시 열기
                </button>
              ) : null}
              {team.notes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#C4D8E4] px-3 py-6 text-center text-[15px] text-[#526975]">
                  아직 없음
                </p>
              ) : (
                <div className="grid gap-3">
                  {team.notes.map((note) => (
                    <Postit
                      key={note.id}
                      note={note}
                      showTeam={false}
                      marks={noteMarks.get(note.id)}
                      representative={repMarks.get(note.id)}
                      category={catState.get(note.id) ?? null}
                      onCategory={toggleNoteCategory}
                      categoryBusy={categoryBusy.has(note.id)}
                      categoryError={categoryErrors[note.id]?.message ?? null}
                      onCategoryRetry={categoryErrors[note.id]?.retry ? retryNoteCategory : undefined}
                      kind={ontologyView ? (kindState.get(note.id) ?? null) : null}
                      onKind={ontologyView ? toggleNoteKind : undefined}
                      kindBusy={kindBusy.has(note.id)}
                      kindError={kindErrors[note.id]?.message ?? null}
                      onKindRetry={kindErrors[note.id]?.retry ? retryNoteKind : undefined}
                    />
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
          <SimilarPairsPanel
            pairs={pairs}
            notesById={notesById}
            checked={checkedPairs}
            onToggle={toggleCheckedPair}
          />
          {/* L4 — 묶음이 생긴 뒤에야 뜻이 있는 화면이라 짝 패널 바로 다음에 두고, 기본은 접어둔다. */}
          <RepresentativePanel
            groups={repGroups}
            notesById={notesById}
            state={repState}
            onPick={doPick}
          />
          <div
            data-testid="note-grid"
            className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]"
          >
            {notes.length === 0 ? (
              <p className="text-[16px] text-[#5A6B73]">해당하는 카드가 없습니다.</p>
            ) : (
              notes.map((note) => (
                <Postit
                  key={note.id}
                  note={note}
                  showTeam
                  marks={noteMarks.get(note.id)}
                  representative={repMarks.get(note.id)}
                  category={catState.get(note.id) ?? null}
                  onCategory={toggleNoteCategory}
                  categoryBusy={categoryBusy.has(note.id)}
                  categoryError={categoryErrors[note.id]?.message ?? null}
                  onCategoryRetry={categoryErrors[note.id]?.retry ? retryNoteCategory : undefined}
                  kind={ontologyView ? (kindState.get(note.id) ?? null) : null}
                  onKind={ontologyView ? toggleNoteKind : undefined}
                  kindBusy={kindBusy.has(note.id)}
                  kindError={kindErrors[note.id]?.message ?? null}
                  onKindRetry={kindErrors[note.id]?.retry ? retryNoteKind : undefined}
                />
              ))
            )}
          </div>
        </div>
      )}

      {reopening ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F4E79]/55 p-5">
          <div
            ref={reopenDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hq-reopen-dialog-title"
            tabIndex={-1}
            className="w-full max-w-md rounded-2xl border border-[#DCE7EE] bg-white p-6"
          >
            <h4 id="hq-reopen-dialog-title" className="text-[21px] font-extrabold text-[#1F4E79]">
              {reopening.teamName} 다시 열기
            </h4>
            <p className="mt-2 text-[15px] leading-[1.6] text-[#5A6B73]">
              제출 완료 상태를 되돌려 조가 다시 고칠 수 있게 합니다. 사유는 기록으로 남습니다.
            </p>
            <label className="mt-4 block text-[15px] font-bold text-[#1F2933]">
              사유
              <input
                type="text"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="예: 조가 실수로 눌렀다고 요청"
                className="mt-1 h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px] font-normal"
              />
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                data-dialog-initial-focus
                onClick={() => setReopening(null)}
                className="h-12 rounded-xl border border-[#C4D8E4] bg-white text-[17px] font-bold text-[#1F4E79]"
              >
                취소
              </button>
              <button
                type="button"
                disabled={reopenReason.trim().length < 2 || reopenBusy}
                onClick={() => void doReopen()}
                className="h-12 rounded-xl bg-[#8A4512] text-[17px] font-bold text-white disabled:opacity-40"
              >
                {reopenBusy ? '여는 중…' : '다시 열기'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </div>

      {/* 인쇄 문서는 **버튼을 누르기 전부터 DOM에 있어야 한다.** 눌러야 만들어지게 두면
          Ctrl+P·브라우저 인쇄 메뉴로 찍을 때 드러낼 것이 없어 백지가 나간다.
          /hq 는 자료가 이미 메모리에 있어 그때그때 만들 수 있다 — 버튼을 누르면
          그 순간 값으로 갈아끼우고, 안 눌러도 최신 화면 내용이 준비돼 있다. */}
      <PrintableReport report={printReport ?? buildReport()} />

      {/* 위험한 조작은 **화면 맨 아래**에 둔다. 자주 쓰는 버튼들 사이에 두면
          행사 중에 손이 미끄러져 눌린다. 픽스처(미리보기)에서는 띄우지 않는다 —
          토큰이 없어 어차피 못 부르고, 미리보기에 지우기 버튼이 있을 이유도 없다. */}
      {token ? (
        <ClearAllPanel
          token={token}
          expectedSubmissions={clearSnapshot}
          onRefresh={reloadAssignmentBoard}
        />
      ) : null}

      <p className="mt-6 text-[14px] text-[#526975]">
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
