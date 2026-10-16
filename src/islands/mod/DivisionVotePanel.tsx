import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  PRESENT_ALIVE_MS,
  PRESENT_QUERY,
  isPresentMessage,
  presentChannelName,
  type PresentStateMessage,
} from './division-present';
import {
  ballotCreate,
  ballotList,
  ballotResults,
  ballotSetStatus,
  type BallotListRow,
  type WorkshopAuthorization,
} from '../../lib/deliberation';
import { divisionPrepGet, divisionPrepSave } from '../../lib/division-prep';
import { createSafeBrowserStorage } from '../../lib/safe-browser-storage';
import { BallotQrFullscreen } from './BallotPanel';
import { NamedAccessContext, NamedResultBoard } from './NamedResultBoard';
import VoterReconcileBox from './VoterReconcileBox';
import DivisionBundleBoard from './DivisionBundleBoard';
import { bundleCsvRows, bundleCsvText } from './division-bundle';
import NamedVoteSettingsBox from './NamedVoteSettingsBox';
import { MAX_STATEMENT_LENGTH, ballotStatusLabel } from './ballot-panel-logic';
import DivisionCeremony from './DivisionCeremony';
import { chipText, hhmmss } from './division-prep-sync';
import {
  CARD_STATUSES,
  CARD_STATUS_LABELS,
  CRITERIA,
  CRITERION_LABELS,
  CRITERION_RESULT_LABELS,
  MARK_LABELS,
  PREP_DIVISION_KEY,
  TEAM_NOS,
  attendanceReady,
  AGENDA_PRESETS,
  attendanceText,
  agendaTopicNo,
  createAgendaMotion,
  groupLabel,
  groupRecTexts,
  importSimilarGroups,
  isAgendaMotion,
  parseSimilarGroups,
  sharedCardWarnings,
  ballotCeremonyItems,
  canCombine,
  canDeleteMotion,
  canEditMotionTitle,
  cardsInMotions,
  combineFailureText,
  combineWarningText,
  createMotion,
  motionTitleRoom,
  nextMotionId,
  topicOfCard,
  criteriaCount,
  deleteMotion,
  divisionLabel,
  excludedCardNos,
  exportFileName,
  fakeYeas,
  finalCriterion,
  initPrepState,
  isUntitled,
  liveRounds,
  lockedDivisionOf,
  motionExcluded,
  motionRef,
  onMotion,
  resolveMotionId,
  parseImport,
  passLineText,
  practiceItems,
  prepStorageKey,
  readStoredPrep,
  replaceStateProblem,
  serializePrep,
  setCardStatus,
  setCriterionOverride,
  setGridMark,
  statusTally,
  teamMajority,
  updateMotion,
  type BallotRecord,
  type CardStatus,
  type CeremonyItem,
  type Criterion,
  type Mark,
  type Motion,
  type MotionRound,
  type PrepState,
  type RecsDivision,
  type TeamNo,
} from './division-vote-logic';
import {
  LONG_OPEN_MS,
  PHASE_LABELS,
  STUCK_START_MS,
  armedText,
  ballotLabel,
  beginVote,
  boardSummary,
  canEditRoundCounts,
  canRevote,
  canVoidRound,
  cancelRevote,
  ceremonyGaps,
  confirmHandCount,
  currentRound,
  elapsedText,
  handPending,
  liveBallots,
  markMinority,
  motionPhase,
  overdue,
  parseHandInput,
  qrHeadlineOf,
  qrRowOf,
  reapplyAttendance,
  requestRevote,
  resultCsvRows,
  resultsFileName,
  roundLabel,
  roundThreshold,
  roundTotals,
  roundVerdict,
  runVoteClose,
  runVoteStart,
  runStrayClose,
  strayOpenBallot,
  startStuck,
  elsewhereHint,
  runVoteVoid,
  titleHead,
  setAttendanceField,
  setHandCount,
  storedCeremonyItems,
  toCsv,
  unmarkMinority,
  voteUnits,
  type MotionPhase,
  type VoteApi,
  type VoteUnit,
} from './division-vote-flow';
import { DECISION_TIMETABLE, currentTimetableBlock } from './division-timetable';
import { downloadBlob } from './svg-to-png';
import { TWO_STEP_MS, twoStepPress, type TwoStepArm } from './two-step';
import { useDivisionPrep, type DivisionPrep, type PrepApi } from './use-division-prep';

/**
 * 10/17 토론회 「분과 의결」 탭.
 *
 * 분과 오퍼레이터: 사용법 → 준비판 → 투표 진행(참석 → 안마다 [투표 시작] → [마감하고 결과 보기]
 * → 거수·권고 수준·의견 → 부결 처리) → 세리머니 → 결과 CSV. 위에서 아래로 한 줄.
 * 운영팀(분과 칸이 빈 조): 맨 위 세 분과 현황판 + 분과를 골라 같은 화면으로 들어가 고친다.
 *
 * 준비 내용은 서버에 공유 저장한다(use-division-prep.ts). 서버를 못 쓰면 이 기기 저장으로 내려가고 노란 띠를 띄운다.
 * 판단은 division-vote-logic.ts · division-vote-flow.ts · division-prep-sync.ts(전부 순수, vitest)에 있다.
 *
 * `fixtureSource` 를 주면 미리보기다: 가상 데이터, 저장 키 `lab:`, 서버 호출 없음(가짜 투표 서버는 ballotApi 로 받는다).
 */

type View = 'prep' | 'vote' | 'ceremony';
const VIEWS: { id: View; label: string }[] = [
  { id: 'prep', label: '준비판' },
  { id: 'vote', label: '투표 진행' },
  { id: 'ceremony', label: '세리머니' },
];

export type DivisionBallotApi = VoteApi & { list(): Promise<BallotListRow[]> };

export function realBallotApi(access: WorkshopAuthorization): DivisionBallotApi {
  return {
    create: (input, key) => ballotCreate(access, input, key),
    setStatus: (id, status) => ballotSetStatus(access, id, status),
    statusOf: async (id) => (await ballotList(access)).find((b) => b.id === id)?.status ?? null,
    results: (token) => ballotResults(token, access),
    list: () => ballotList(access),
  };
}

const storage = createSafeBrowserStorage('localStorage');

const btn =
  'min-h-12 rounded-xl px-4 text-[17px] font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] disabled:cursor-not-allowed disabled:opacity-40';
const btnPrimary = `${btn} bg-[#135C73] text-white`;
const btnGhost = `${btn} border border-[#C4D8E4] bg-white text-[#1F4E79]`;

/**
 * 시간표 띠(10/15) — 추진계획안_5 의결 블록 넷. 누르면 그 시간에 쓰는 화면(준비판·투표 진행)으로 간다.
 * 행사 당일(KST)에는 지금 블록에 「지금」이 붙는다. 30초마다 시각을 다시 본다.
 */
function TimetableStrip({ view, onGo }: { view: View; onGo: (v: View) => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const current = currentTimetableBlock(now);
  return (
    <ol data-testid="timetable-strip" aria-label="10/17 의결 시간표" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {DECISION_TIMETABLE.map((b) => {
        const isNow = current?.id === b.id;
        return (
          <li key={b.id}>
            <button
              type="button"
              data-testid={`timetable-${b.id}`}
              data-now={isNow ? 'true' : 'false'}
              aria-current={isNow ? 'time' : undefined}
              onClick={() => onGo(b.view)}
              className={`flex h-full w-full flex-col items-start rounded-2xl border-2 px-4 py-3 text-left ${
                isNow ? 'border-[#B45309] bg-[#FFF7E6]' : view === b.view ? 'border-[#9CC3D5] bg-[#F5F8FB]' : 'border-[#DCE7EE] bg-white'
              }`}
            >
              <span className="text-[16px] font-extrabold text-[#5A6B73]">
                {isNow ? <span className="mr-2 rounded-full bg-[#B45309] px-2 py-0.5 text-white">지금</span> : null}
                {b.start}~{b.end}
              </span>
              <span className="mt-1 text-[18px] font-extrabold text-[#1F4E79]">{b.label}</span>
              <span className="mt-1 text-[15px] font-bold text-[#335]">{b.where}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
const btnBig = 'min-h-16 rounded-2xl px-7 text-[22px] font-extrabold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] disabled:cursor-not-allowed disabled:opacity-40';
const input =
  'w-full min-w-0 rounded-xl border border-[#C4D8E4] px-3 text-[17px] text-[#1F2933] outline-none focus:border-[#23B2C3] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]';

/** 운영팀 화면의 「지금 고치는 분과」 띠 색 — 분과마다 다르게(10/14 ops-6). */
const DIVISION_BAND: Record<number, string> = {
  1: 'bg-[#1F4E79]',
  2: 'bg-[#6B3FA0]',
  3: 'bg-[#0F6B4F]',
};

const newRequestId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    // 아주 옛 브라우저 — 서버는 uuid 모양만 본다.
    const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
  }
};

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export default function DivisionVotePanel({
  access,
  fixtureSource,
  subgroup,
  teamName,
  ballotApi,
  opsPreview,
  initialStates,
  labPrepApi,
  labStorageNs,
  storageScope,
}: {
  access: WorkshopAuthorization | null;
  fixtureSource?: RecsDivision[];
  /** 조의 분과(「N분과」). 있으면 그 분과만. 비어 있으면 운영팀 — 세 분과 현황판과 분과 고르기. */
  subgroup?: string | null;
  /** 저장자 이름(조 이름). 운영팀은 「운영팀」. */
  teamName?: string | null;
  /** 미리보기 전용 가짜 투표 서버. 주지 않으면 /mod 는 실제 RPC, 미리보기는 투표 버튼이 막힌다. */
  ballotApi?: DivisionBallotApi | null;
  /** 미리보기 전용 — 운영팀 화면으로 보기. */
  opsPreview?: boolean;
  /** 미리보기 전용 — 처음 상태(저장소보다 앞선다). */
  initialStates?: Record<number, PrepState>;
  /** 미리보기 전용 — 메모리 안 가짜 공유 저장(두 화면 충돌 시연, ?pair=1). */
  labPrepApi?: PrepApi | null;
  /** 미리보기 전용 — 이 기기 저장 키 접두사(두 화면이 한 페이지에 있을 때 서로 섞이지 않게). */
  labStorageNs?: string;
  /** 실제 /mod — 이 기기 저장을 조(=세션) 단위로 나눈다. 없으면 옛 세션 내용이 새 세션 빈 서버로 올라간다(10/15 리허설2). */
  storageScope?: string | null;
}) {
  const preview = !!fixtureSource;
  const lockedDivision = lockedDivisionOf(subgroup);
  const isOps = preview ? !!opsPreview : lockedDivision === null;
  const ns = preview ? labStorageNs ?? (isOps ? 'lab-ops:' : 'lab:') : `team:${storageScope ?? 'unknown'}:`;
  const token = access?.accessToken ?? null;

  const prepApi = useMemo<PrepApi | null>(
    () =>
      preview
        ? labPrepApi ?? null
        : token
          ? {
              get: () => divisionPrepGet(token),
              save: (sg, version, state, label) => divisionPrepSave(token, sg, version, state, label),
            }
          : null,
    [token, preview, labPrepApi],
  );
  const vApi = useMemo<DivisionBallotApi | null>(
    () => ballotApi ?? (token && !preview ? realBallotApi({ accessToken: token }) : null),
    [ballotApi, token, preview],
  );
  const label = isOps ? '운영팀' : teamName?.trim() || (lockedDivision ? divisionLabel(lockedDivision) : '분과');

  const prep = useDivisionPrep({
    api: prepApi,
    label,
    persistLocal: (s) => storage.setItem(`${ns}${prepStorageKey(s.division)}`, serializePrep(s)),
    initial: () => {
      const out: Record<number, PrepState> = {};
      for (const d of [1, 2, 3]) {
        const stored = readStoredPrep(storage.getItem(`${ns}${prepStorageKey(d)}`));
        if (stored) out[d] = stored;
      }
      for (const source of fixtureSource ?? []) if (!out[source.division]) out[source.division] = initPrepState(source);
      for (const [d, s] of Object.entries(initialStates ?? {})) out[Number(d)] = s;
      return out;
    },
  });

  const [division, setDivision] = useState<number | null>(() => {
    // 운영팀은 처음에 분과를 열지 않는다(10/14 ops-6) — 현황판만 보이고 [N분과 화면 열기]로 고른다.
    if (isOps) return null;
    const saved = Number(storage.getItem(`${ns}${PREP_DIVISION_KEY}`));
    if (Number.isInteger(saved) && saved > 0) return saved;
    return fixtureSource?.[0]?.division ?? null;
  });
  const [view, setView] = useState<View>('prep');
  /** 들어왔을 때 열린 투표가 있으면 띄울 QR(10/14 operator-6). VoteBoard 가 한 번 받아 쓴다. */
  const [entryQr, setEntryQr] = useState<string | null>(null);
  const entryChecked = useRef(false);
  /** 「지금 투표 중」 띠를 붙일 자리 — 알림과 같은 붙박이 칸 안(겹치지 않게). */
  const [bandSlot, setBandSlot] = useState<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const groupsFileRef = useRef<HTMLInputElement>(null);
  const { notice, setNotice } = prep;
  // 알림은 화면 위에 붙어 있으므로 「됐습니다」류(ok)는 6초 뒤 스스로 닫는다. 경고·오류는 닫을 때까지 둔다.
  useEffect(() => {
    if (notice?.tone !== 'ok') return undefined;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  const divisions = Object.entries(prep.slots)
    .filter(([, slot]) => !!slot.state)
    .map(([d]) => Number(d))
    .filter((d) => lockedDivision === null || d === lockedDivision)
    .sort((a, b) => a - b);
  // 고른 분과가 잠금 밖이면(가져오기 직후·저장된 옛 선택) 잠긴 분과로 돌아간다. 운영팀은 고르기 전까지 비워 둔다.
  const activeDivision =
    division !== null && divisions.includes(division) ? division : isOps ? null : divisions[0] ?? null;
  const state = activeDivision !== null ? prep.slots[activeDivision]?.state ?? null : null;

  useEffect(() => {
    if (activeDivision !== null) storage.setItem(`${ns}${PREP_DIVISION_KEY}`, String(activeDivision));
  }, [activeDivision, ns]);

  // ── 발표 화면(10/15) — 같은 PC 의 발표 창으로 지금 상태·고른 안·제출 수를 보낸다(division-present.ts) ──
  const presentScope = preview ? 'preview' : storageScope ?? 'unknown';
  const [presentFocus, setPresentFocus] = useState<string | null>(null);
  const [presentNames, setPresentNames] = useState<string | null>(null);
  const [presenterOn, setPresenterOn] = useState(false);
  const presenterSeenAt = useRef(0);
  const presentCounts = useRef<Record<string, number>>({});
  const presentChannel = useRef<BroadcastChannel | null>(null);
  const presentLatest = useRef<PresentStateMessage | null>(null);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const ch = new BroadcastChannel(presentChannelName(presentScope));
    presentChannel.current = ch;
    ch.onmessage = (e) => {
      if (!isPresentMessage(e.data) || e.data.kind !== 'alive') return;
      presenterSeenAt.current = Date.now();
      setPresenterOn(true);
      if (presentLatest.current) ch.postMessage(presentLatest.current);
    };
    const id = setInterval(() => setPresenterOn(Date.now() - presenterSeenAt.current < PRESENT_ALIVE_MS), 2000);
    return () => {
      clearInterval(id);
      ch.close();
      presentChannel.current = null;
    };
  }, [presentScope]);
  const postPresent = useCallback(() => {
    if (!state) return;
    const m: PresentStateMessage = { kind: 'state', v: 1, state, focus: presentFocus, counts: presentCounts.current, names: presentNames };
    presentLatest.current = m;
    presentChannel.current?.postMessage(m);
  }, [state, presentFocus, presentNames]);
  useEffect(() => {
    postPresent();
  }, [postPresent]);
  const onPresentCounts = useCallback(
    (c: Record<string, number>) => {
      presentCounts.current = c;
      postPresent();
    },
    [postPresent],
  );
  const presentCtx = useMemo<PresentCtx>(
    () => ({
      focus: (id: string) => {
        setPresentFocus(id);
        setPresentNames(null);
      },
      presenterAlive: () => Date.now() - presenterSeenAt.current < PRESENT_ALIVE_MS,
      current: presentFocus,
      names: presentNames,
      showNames: (ballotId: string | null) => setPresentNames(ballotId),
    }),
    [presentFocus, presentNames],
  );
  const openPresenter = () => {
    window.open(`${window.location.pathname}?${PRESENT_QUERY}=1`, `division-present-${presentScope}`, 'popup=yes,width=1280,height=720');
  };

  // 10/14 operator-6 — 새로고침·노트북 재시작 뒤 들어왔을 때 열린 투표가 있으면 「투표 진행」과 그 QR 로 바로 연다.
  // 서버에서 읽기를 마친 뒤(연결 중이 아닐 때) 한 번만 본다. 운영팀 화면은 건드리지 않는다.
  useEffect(() => {
    if (entryChecked.current || isOps || !state || prep.mode === 'connecting') return;
    entryChecked.current = true;
    const open = Object.values(state.ballots).find((b) => b.stage === 'open');
    if (open) {
      setView('vote');
      setEntryQr(open.requestId);
    }
  }, [isOps, state, prep.mode]);

  const update = useCallback(
    (fn: (s: PrepState) => PrepState) => {
      if (activeDivision !== null) prep.edit(activeDivision, fn);
    },
    [activeDivision, prep],
  );

  const onImportFile = async (file: File) => {
    const parsed = parseImport(await file.text());
    if (parsed.kind === 'error') {
      setNotice({ tone: 'error', text: parsed.message });
      return;
    }
    if (parsed.kind === 'state') {
      const s = parsed.state;
      if (lockedDivision !== null && s.division !== lockedDivision) {
        setNotice({ tone: 'error', text: `이 조는 ${divisionLabel(lockedDivision)}만 다룹니다. ${divisionLabel(s.division)} 파일은 가져오지 않았습니다.` });
        return;
      }
      // 10/14 — 옛 백업 파일이 마감한 투표 기록을 지우고 같은 안을 다시 열게 만든다. 투표 기록이 줄면 거절.
      const current = prep.slots[s.division]?.state ?? null;
      const problem = replaceStateProblem(current, s);
      if (problem) {
        setNotice({ tone: 'error', text: problem });
        return;
      }
      const voted = current ? current.motions.filter((m) => m.rounds.length > 0).length : 0;
      if (
        current &&
        !window.confirm(
          `${divisionLabel(s.division)} 준비 내용 전체(카드 상태·의결안·참석 인원·투표 기록 ${voted}건)를 가져온 파일 내용으로 바꿉니다. 같은 분과의 다른 화면에도 바로 퍼집니다. 바꿀까요?`,
        )
      )
        return;
      prep.replace(s.division, s);
      setDivision(s.division);
      setNotice({ tone: 'ok', text: `${divisionLabel(s.division)} 준비 내용을 가져왔습니다(의결안 ${s.motions.length}건).` });
      return;
    }
    // 원천 파일 — 이미 준비 중인 분과는 건드리지 않는다.
    const added: string[] = [];
    const kept: string[] = [];
    for (const source of parsed.divisions) {
      if (lockedDivision !== null && source.division !== lockedDivision) continue;
      if (prep.slots[source.division]?.state) {
        kept.push(divisionLabel(source.division));
        continue;
      }
      prep.replace(source.division, initPrepState(source));
      added.push(divisionLabel(source.division));
    }
    if (activeDivision === null && parsed.divisions[0]) setDivision(lockedDivision ?? parsed.divisions[0].division);
    setNotice({
      tone: 'ok',
      text:
        [
          added.length ? `${added.join('·')} 권고안을 불러왔습니다.` : '',
          kept.length ? `${kept.join('·')}은 기존 준비 내용을 그대로 두었습니다.` : '',
        ]
          .filter(Boolean)
          .join(' ') || '불러올 분과가 없습니다.',
    });
  };

  /**
   * 유사 묶음 파일(similar_groups_1017.json) — 분과 오퍼레이터는 자기 분과만, 운영팀은 준비 내용이 있는 세 분과 모두.
   * 저장 충돌 때 서버 최신 위에 다시 적용되므로 함수는 묶음 번호로 중복을 거른다(importSimilarGroups).
   */
  const onImportGroups = async (file: File) => {
    const parsed = parseSimilarGroups(await file.text());
    if (!parsed.ok) {
      setNotice({ tone: 'error', text: parsed.message });
      return;
    }
    const targets = isOps ? [1, 2, 3] : lockedDivision !== null ? [lockedDivision] : activeDivision !== null ? [activeDivision] : [];
    const lines: string[] = [];
    let failed = false;
    for (const d of targets) {
      const current = prep.slots[d]?.state;
      if (!current) continue;
      const mine = parsed.groups.filter((g) => g.division === d);
      if (mine.length === 0) continue;
      const dry = importSimilarGroups(current, mine);
      if (dry.created.length > 0) prep.edit(d, (s) => importSimilarGroups(s, mine).state);
      const parts = [`${divisionLabel(d)} 묶음 ${mine.length}개 — 새 안 ${dry.created.length}건`];
      if (dry.skipped.length) parts.push(`이미 있어 건너뜀 ${dry.skipped.length}건`);
      if (dry.failed.length) {
        failed = true;
        parts.push(`못 만듦 ${dry.failed.map((x) => `${x.groupId}(${x.reason})`).join(', ')}`);
      }
      lines.push(parts.join(' · '));
    }
    setNotice({
      tone: failed ? 'warn' : 'ok',
      text: lines.length
        ? `${lines.join(' / ')}. 안 제목은 비어 있습니다 — 합친 문구를 넣어야 [투표 시작]이 눌립니다.`
        : '이 화면에서 다루는 분과의 묶음이 파일에 없습니다(또는 권고안 파일을 먼저 가져오십시오).',
    });
  };

  const onExport = () => {
    if (!state) return;
    downloadBlob(new Blob([serializePrep(state)], { type: 'application/json' }), exportFileName(state.division, new Date()));
    setNotice({ tone: 'ok', text: `${divisionLabel(state.division)} 준비 내용을 파일로 저장했습니다.` });
  };

  const downloadCsv = (scope: number | 'all') => {
    const targets = scope === 'all' ? [1, 2, 3] : [scope];
    const rows = targets.flatMap((d) => {
      const s = prep.slots[d]?.state;
      return s ? resultCsvRows(s) : [];
    });
    downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), resultsFileName(scope, new Date()));
    setNotice({ tone: 'ok', text: `결과 CSV를 내려받았습니다(${rows.length}줄).` });
  };

  const onReset = () => {
    if (!state) return;
    if (state.motions.some((m) => m.rounds.length > 0)) {
      setNotice({ tone: 'error', text: '투표 기록이 있는 분과는 처음으로 돌릴 수 없습니다.' });
      return;
    }
    if (!window.confirm(`${divisionLabel(state.division)}의 상태·의결안·참석 인원을 모두 지우고 처음 상태로 돌립니다.`)) return;
    prep.replace(state.division, initPrepState(state.source));
    setNotice({ tone: 'ok', text: '처음 상태로 돌렸습니다.' });
  };

  const chip = chipText(prep.mode, activeDivision !== null ? prep.slots[activeDivision] : undefined, prep.lastSaveFailed);

  return (
    <PresentContext.Provider value={presentCtx}>
    <NamedAccessContext.Provider value={preview ? null : access}>
    <section data-testid="division-vote-panel" data-ops={isOps ? 'true' : 'false'} className="rounded-2xl border border-[#DCE7EE] bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#DCE7EE] bg-[#1F4E79]/6 px-6 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[22px] font-extrabold text-[#1F4E79]">
            10/17 분과 의결{isOps ? ' · 운영팀' : ''}
          </h3>
          <p className="text-[16px] text-[#5A6B73]">
            {preview ? '미리보기 — 가상 데이터, 이 기기에만 저장합니다.' : '준비 내용과 투표 결과는 서버에 저장되어 같은 분과 화면끼리 함께 봅니다.'}
          </p>
        </div>
        <span
          data-testid="division-sync-chip"
          data-tone={chip.tone}
          className={`rounded-full px-4 py-2 text-[16px] font-extrabold tr-num ${
            chip.tone === 'ok' ? 'bg-[#EAF6EE] text-[#2F6F25]' : chip.tone === 'busy' ? 'bg-[#E6F0F8] text-[#1F4E79]' : 'bg-[#FFF1D6] text-[#8A5A00]'
          }`}
        >
          {chip.text}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          data-testid="division-import-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void onImportFile(f);
          }}
        />
        {!preview ? (
          <button
            type="button"
            data-testid="present-open"
            className={presenterOn ? `${btn} bg-[#2F6F25] text-white` : btnPrimary}
            onClick={openPresenter}
          >
            {presenterOn ? '발표 화면 연결됨' : '발표 화면 열기 (새 창)'}
          </button>
        ) : null}
        <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>
          JSON 가져오기
        </button>
        <button type="button" className={btnGhost} onClick={onExport} disabled={!state}>
          JSON 내보내기
        </button>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {/* 10/14 — 알림·운영팀 분과 띠는 화면 위에 붙어 있다. 아래 안 블록에서 일하는 중에도 보인다(operator-4·ops-6). */}
        {notice || (state && (isOps || view === 'vote')) ? (
          // /mod 안에서는 콘솔 위 띠(연결 상태·마감 배너, ModConsole 이 높이를 --mod-sticky-h 로 내려 줌) 바로 아래에 붙는다 —
          // 같은 자리에 붙으면 이 띠가 연결 상태를 덮는다(10/14 재검). 미리보기(랩)에는 그 띠가 없어 0.
          <div data-testid="division-sticky" className="sticky z-20 space-y-2" style={{ top: 'calc(var(--mod-sticky-h, 0px) + 0.5rem)' }}>
            {isOps && state ? (
              <p
                data-testid="ops-division-band"
                data-division={state.division}
                className={`rounded-xl px-4 py-2 text-[20px] font-black text-white shadow-md ${DIVISION_BAND[state.division] ?? 'bg-[#1F4E79]'}`}
              >
                지금 고치는 분과: {divisionLabel(state.division)}
                <span className="ml-3 text-[16px] font-bold opacity-90">(운영팀 · 여기서 누르는 버튼은 {divisionLabel(state.division)}에 바로 적용됩니다)</span>
              </p>
            ) : null}
            {notice ? (
              <p
                role={notice.tone === 'ok' ? 'status' : 'alert'}
                data-testid="division-notice"
                data-tone={notice.tone}
                className={`flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-[17px] font-bold shadow-md ${
                  notice.tone === 'error'
                    ? 'border border-[#DC2626]/30 bg-[#FEF2F2] text-[#B91C1C]'
                    : notice.tone === 'warn'
                      ? 'border-2 border-[#F5A623] bg-[#FFF7E6] text-[#8A5A00]'
                      : 'bg-[#EAF6EE] text-[#2F6F25]'
                }`}
              >
                <span className="min-w-0 flex-1">{notice.text}</span>
                <button type="button" className="min-h-11 rounded-lg px-3 text-[16px] underline" onClick={() => setNotice(null)}>
                  닫기
                </button>
              </p>
            ) : null}
            {state && view === 'vote' ? <div ref={setBandSlot} data-testid="live-vote-slot" /> : null}
          </div>
        ) : null}
        {(prep.mode === 'local' || prep.lastSaveFailed) && !preview ? (
          <p role="alert" data-testid="division-local-banner" className="rounded-xl border-2 border-[#F5A623] bg-[#FFF3C4] px-4 py-3 text-[18px] font-extrabold text-[#7A4B00]">
            서버 저장 안 됨 — 이 기기에만 저장 중
            {prep.localReason ? <span className="ml-2 text-[16px] font-bold">({prep.localReason} 30초마다 다시 연결합니다.)</span> : null}
            <span className="mt-1 block text-[16px] font-bold">
              운영팀에 바로 알리십시오. 브라우저를 닫지 말고, 안을 마감할 때마다 [이 분과 결과 CSV]와 [JSON 내보내기]로 이 기기 내용을 받아 두십시오.
            </span>
          </p>
        ) : null}
        {!storage.isPersistent() ? (
          <p role="alert" className="rounded-xl border border-[#F5A623]/40 bg-[#FFF7E6] px-4 py-3 text-[16px] font-bold text-[#8A5A00]">
            이 브라우저는 저장소를 쓸 수 없어 새로고침하면 이 기기 사본이 사라집니다. JSON 내보내기로 보관하십시오.
          </p>
        ) : null}

        <HelpPanel isOps={isOps} />

        {isOps ? (
          <OpsBoard
            prep={prep}
            preview={preview}
            active={activeDivision}
            onOpen={(d) => {
              setDivision(d);
              setView('vote');
            }}
            onCsvAll={() => downloadCsv('all')}
            onBundleCsvAll={() => {
              const rows = [1, 2, 3].flatMap((d) => {
                const st = prep.slots[d]?.state;
                return st ? bundleCsvRows(st) : [];
              });
              downloadBlob(new Blob([bundleCsvText(rows)], { type: 'text/csv;charset=utf-8' }), '1017_묶음기록_전체.csv');
              setNotice({ tone: 'ok', text: `묶음 기록 CSV를 내려받았습니다(${rows.length}줄).` });
            }}
          />
        ) : null}

        {!state && isOps && divisions.length > 0 ? (
          <p data-testid="ops-pick-division" className="rounded-xl border border-dashed border-[#C4D8E4] p-6 text-[18px] font-bold text-[#1F4E79]">
            위 현황판에서 [N분과 화면 열기]를 누르면 그 분과 화면이 여기에 열립니다.
          </p>
        ) : !state ? (
          <div className="rounded-xl border border-dashed border-[#C4D8E4] p-6 text-[17px] text-[#1F2933]">
            <p className="font-bold">
              {prep.mode === 'connecting' ? '서버에서 준비 내용을 읽는 중입니다…' : '권고안 파일(recs_1017.json)을 「JSON 가져오기」로 불러오십시오.'}
            </p>
            <p className="mt-2 text-[#5A6B73]">다른 기기에서 내보낸 준비판 파일도 같은 버튼으로 가져옵니다.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {!isOps
                ? divisions.map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={d === activeDivision}
                      onClick={() => setDivision(d)}
                      className={d === activeDivision ? btnPrimary : btnGhost}
                    >
                      {divisionLabel(d)}
                    </button>
                  ))
                : null}
              {!isOps ? <span className="mx-2 h-8 w-px bg-[#DCE7EE]" aria-hidden="true" /> : null}
              <div role="tablist" aria-label="의결 화면" className="flex flex-wrap gap-2">
                {VIEWS.map((v, i) => (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={view === v.id}
                    onClick={() => setView(v.id)}
                    className={view === v.id ? btnPrimary : btnGhost}
                  >
                    {i + 1}. {v.label}
                  </button>
                ))}
              </div>
              <button type="button" className={`${btnGhost} ml-auto`} onClick={onReset}>
                이 분과 처음으로
              </button>
            </div>
            <p className="text-[18px] text-[#1F2933]">
              <span className="font-extrabold text-[#1F4E79]">{divisionLabel(state.division)}</span> · {state.source.agenda}
              {isOps ? <span className="ml-2 text-[16px] font-bold text-[#135C73]">(운영팀이 이 분과 화면을 열었습니다 · 고친 내용은 이 분과에 저장됩니다)</span> : null}
            </p>
            <TimetableStrip view={view} onGo={setView} />

            {view === 'prep' ? (
              <>
                <div data-testid="groups-import" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#C4D8E4] bg-[#F5F8FB] px-4 py-3">
                  <input
                    ref={groupsFileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    data-testid="groups-import-input"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) void onImportGroups(f);
                    }}
                  />
                  <button type="button" className={btnPrimary} onClick={() => groupsFileRef.current?.click()}>
                    유사 묶음 파일 가져오기
                  </button>
                  <span className="min-w-0 flex-1 text-[16px] text-[#5A6B73]">
                    similar_groups 파일의 {isOps ? '세 분과' : divisionLabel(state.division)} 묶음을 안으로 한꺼번에 만듭니다. 제목은 비워 둡니다. 두 번 가져와도 안이 겹치지 않습니다.
                  </span>
                </div>
                <PrepBoard state={state} update={update} />
              </>
            ) : null}
            {view === 'vote' ? (
              <VoteBoard
                key={state.division}
                state={state}
                update={update}
                prep={prep}
                api={vApi}
                preview={preview}
                isOps={isOps}
                entryQr={entryQr}
                onEntryQrUsed={() => setEntryQr(null)}
                bandSlot={bandSlot}
                onCsv={() => downloadCsv(state.division)}
                onCounts={onPresentCounts}
              />
            ) : null}
            {view === 'ceremony' ? <CeremonySetup state={state} api={vApi} isOps={isOps} preview={preview} /> : null}
          </>
        )}
      </div>
    </section>
    </NamedAccessContext.Provider>
    </PresentContext.Provider>
  );
}

/** 발표 창 연결(10/15) — 안 카드·투표 단위가 「지금 이 안」을 알리고, 발표 창이 살아 있으면 노트북에 QR 전체 화면을 띄우지 않는다. */
type PresentCtx = {
  focus: (id: string) => void;
  presenterAlive: () => boolean;
  current: string | null;
  /** 큰 화면에 띄운 「투표결과 보기」의 투표(ballotId). */
  names?: string | null;
  showNames?: (ballotId: string | null) => void;
};
const PresentContext = createContext<PresentCtx>({ focus: () => undefined, presenterAlive: () => false, current: null });

// ============================================================
// 사용법
// ============================================================

const OPERATOR_STEPS = [
  '화면 위 분과 이름이 우리 분과인지 확인합니다. 오른쪽 위 칩이 「저장됨」이면 서버에 저장되고 있습니다.',
  '「1. 준비판」에서 카드마다 처리 상태를 고릅니다. 모더레이터가 합친 카드들을 고르고, 합친 문구를 안 제목 칸에 친 뒤 [의결안 만들기]를 누릅니다. 카드를 1장만 고르면 그 카드 제목이 미리 들어갑니다.',
  '같은 분과 안이면 주제가 다른 카드도 한 안으로 합칠 수 있습니다(주황 경고만 뜹니다). 이미 다른 안에 들어간 카드도 고를 수 있고, 「이 카드는 ○-○-안○ 에도 들어 있습니다」 경고만 뜹니다. 시행중-제외 카드는 고를 수 없습니다. 다른 분과 카드와의 통합은 이 화면에서 하지 않습니다(현장 수기).',
  '유사 묶음(추진계획안 붙임)은 준비판 위 [유사 묶음 파일 가져오기]로 similar_groups 파일을 고르면 우리 분과 묶음이 안으로 한꺼번에 생깁니다. 안 카드에 묶음 번호·공통 취지·세부 번호·제안 조가 나오고 [세부 권고 문구 보기]로 원문을 펼칩니다. 안 제목 칸은 비어 있습니다 — 모더레이터가 합친 문구를 치십시오. 제목이 빈 안은 [투표 시작]이 눌리지 않습니다. 같은 파일을 두 번 가져와도 안이 겹치지 않습니다.',
  '카드와 무관한 안건(분과별 최종 권고안 의결 · 최종 권고안 문구 작성 위임 의결)은 준비판 맨 아래 「카드 없는 안건」에서 만듭니다. 안 번호는 「N-최종-안1」처럼 붙고 투표 진행 맨 뒤에 놓입니다.',
  '안 제목은 큰 QR 화면과 투표자 휴대폰에 그대로 크게 나옵니다. 안 번호 포함 300자까지이며, 칸 아래에 남은 글자 수가 나옵니다.',
  '「2. 투표 진행」 맨 위에 재적과 참석 인원을 넣습니다. 재적 과반수가 참석해야 [투표 시작]이 눌립니다. 가결선이 바로 아래에 나옵니다.',
  '투표는 안 하나씩 엽니다. 한 안이 열려 있으면 다른 안의 [투표 시작]은 눌리지 않습니다. [투표 시작]을 누르면 버튼에 「N분과 안 번호 「제목…」 투표를 시작합니까?」가 뜹니다. 모더레이터가 부른 안 번호와 같은지 소리 내어 확인하고 5초 안에 한 번 더 누릅니다. 투표가 열리고 QR 화면이 바로 뜹니다. [나가기] 또는 ESC로 돌아오고, 화면 위 「지금 투표 중」 띠의 [QR 띄우기]로 다시 엽니다.',
  '안을 잘못 열었으면 마감하지 말고 그 안의 [잘못 연 투표 무효]를 두 번 누릅니다. 투표가 닫히고 안이 「투표 전」으로 돌아가며 차수도 쓰지 않습니다. 기록에는 「무효」로 남습니다.',
  '휴대폰이 없거나 제출이 안 된 분은 손을 들어 찬반을 표시합니다. 책임 모더레이터가 찬성·반대 인원을 따로 세어 오퍼레이터에게 알려 줍니다.',
  '투표를 끝낼 때 [마감하고 결과 보기]를 누르고, 버튼이 「… 투표를 마감합니까?」로 바뀌면 5초 안에 한 번 더 누릅니다. 찬성·반대 표와 가결선, 잠정 판정이 나옵니다.',
  '결과 아래 「거수 찬성」·「거수 반대」 칸에 책임 모더레이터가 센 인원을 넣고 [거수 입력 완료]를 누릅니다(거수가 없으면 [거수 없음]). 그 전까지 판정은 「잠정」이고 2차 투표·소수 의견 버튼이 나오지 않습니다. 모더레이터는 이 버튼을 누른 뒤에 판정을 읽습니다.',
  '투표를 시작한 안의 제목은 고칠 수 없습니다(QR·휴대폰·기록은 보낸 문장 그대로입니다). 투표 전 오타는 준비판 안 카드 제목 칸에서 고치되, 칸 왼쪽의 큰 안 번호가 모더레이터가 부른 번호인지 먼저 봅니다. 부결 뒤에는 [문구 고쳐 2차 투표]의 제목 칸에서 고칩니다.',
  '부결된 안은 [문구 고쳐 2차 투표] 또는 [소수 의견으로 기록]을 고릅니다. 다 끝나면 「3. 세리머니」로 발표하고 [이 분과 결과 CSV]를 내려받습니다. 세리머니는 「마감한 결과(○건)」로 시작합니다.',
];

const OPS_STEPS = [
  '맨 위 현황판이 세 분과의 후보안·진행 중 투표·가결·부결·소수 의견을 5초마다 새로 보여 줍니다. 빨간 글씨는 참석 인원이 비어 있다는 뜻입니다. 주황·빨강 줄(시작 멈춤·집계 실패·판정 불가·거수 확인 전·오래 열린 투표)이 보이면 그 분과에 연락합니다.',
  '[N분과 화면 열기]를 누르면 그 분과 오퍼레이터와 같은 화면이 아래에 열리고, 화면 위에 「지금 고치는 분과」 띠가 붙습니다. 여기서 고친 내용은 그 분과에 「운영팀」 이름으로 저장됩니다.',
  '어느 분과 투표든 그 화면에서 시작하고 마감할 수 있지만, 분과 PC가 응답하지 않을 때만 대신 엽니다. 대신 열면 QR은 이 노트북에만 뜹니다 — 그 분과 PC-A에 「화면 위 [QR 띄우기]를 누르십시오」라고 바로 알립니다. 결과가 나온 뒤 무효 처리는 운영팀 화면에서만 할 수 있습니다.',
  '[전체 결과 CSV]는 세 분과 결과를 한 파일로 내려받습니다(엑셀에서 바로 열립니다).',
];

function HelpPanel({ isOps }: { isOps: boolean }) {
  const steps = isOps ? OPS_STEPS : OPERATOR_STEPS;
  return (
    <details data-testid="division-help" className="rounded-2xl border border-[#C4D8E4] bg-[#F5F8FB]">
      <summary className="min-h-12 cursor-pointer px-5 py-3 text-[18px] font-extrabold text-[#1F4E79]">사용법 {isOps ? '(운영팀)' : '(분과 오퍼레이터)'}</summary>
      <ol className="space-y-2 px-5 pb-4">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3 text-[17px] leading-relaxed text-[#1F2933]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#135C73] text-[16px] font-extrabold text-white">{i + 1}</span>
            <span className="min-w-0">{s}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

// ============================================================
// 운영팀 현황판
// ============================================================

function OpsBoard({
  prep,
  preview,
  active,
  onOpen,
  onCsvAll,
  onBundleCsvAll,
}: {
  prep: DivisionPrep;
  preview: boolean;
  active: number | null;
  onOpen: (division: number) => void;
  onCsvAll: () => void;
  /** 10/17 — 세 분과 묶음 기록(헤쳐모여) CSV. */
  onBundleCsvAll?: () => void;
}) {
  const now = useNow(1000) + prep.serverOffsetMs;
  const conn = preview ? '미리보기(서버 없음)' : prep.mode === 'local' ? '서버 저장 안 됨' : prep.connected === false ? '연결 끊김' : prep.connected ? '연결됨' : '연결 중';
  const connBad = !preview && (prep.mode === 'local' || prep.connected === false);
  return (
    <div data-testid="ops-board" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="flex-1 text-[22px] font-extrabold text-[#1F4E79]">세 분과 현황</h4>
        <span className={`text-[17px] font-bold ${connBad ? 'text-[#B91C1C]' : 'text-[#2F6F25]'}`} data-testid="ops-connection">
          서버: {conn}
        </span>
        <button type="button" className={btnPrimary} onClick={onCsvAll} data-testid="ops-csv-all">
          전체 결과 CSV
        </button>
        {onBundleCsvAll ? (
          <button type="button" className={btnGhost} onClick={onBundleCsvAll} data-testid="ops-bundle-csv-all">
            전체 묶음 기록 CSV
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[1, 2, 3].map((d) => {
          const slot = prep.slots[d];
          const sum = boardSummary(d, slot?.state ?? null);
          return (
            <div
              key={d}
              data-testid="ops-column"
              data-division={d}
              className={`flex min-w-0 flex-col gap-2 rounded-2xl border-2 p-4 ${active === d ? 'border-[#135C73] bg-[#E6F5F7]' : 'border-[#DCE7EE] bg-white'}`}
            >
              <p className="text-[26px] font-black text-[#1F4E79]">{divisionLabel(d)}</p>
              {!sum.hasState ? (
                <p className="text-[17px] font-bold text-[#5A6B73]">아직 준비 내용이 없습니다.</p>
              ) : (
                <>
                  {sum.attendanceMissing ? (
                    <p className="rounded-lg bg-[#FEF2F2] px-3 py-1 text-[17px] font-extrabold text-[#B91C1C]">참석 인원 미입력</p>
                  ) : (
                    <p className="text-[17px] font-bold text-[#1F2933] tr-num">
                      재적 {sum.enrolled} · 참석 {sum.present}
                    </p>
                  )}
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[17px] tr-num">
                    <dt className="text-[#5A6B73]">후보안</dt>
                    <dd className="font-extrabold">{sum.motionCount}</dd>
                    <dt className="text-[#5A6B73]">가결</dt>
                    <dd className="font-extrabold text-[#2F6F25]">{sum.passed}</dd>
                    <dt className="text-[#5A6B73]">부결</dt>
                    <dd className="font-extrabold text-[#B91C1C]">{sum.failed}</dd>
                    <dt className="text-[#5A6B73]">소수 의견</dt>
                    <dd className="font-extrabold">{sum.minority}</dd>
                    <dt className="text-[#5A6B73]">투표 전</dt>
                    <dd className="font-extrabold">{sum.pending}</dd>
                  </dl>
                  <div className="min-h-[2.5rem]">
                    {sum.open.length + sum.starting.length === 0 ? (
                      <p className="text-[16px] text-[#5A6B73]">진행 중 투표 없음</p>
                    ) : null}
                    <ul className="space-y-1" data-testid="ops-alerts">
                      {sum.open.map((o) => {
                        const long = overdue(o.openedAt, now, LONG_OPEN_MS);
                        return (
                          <li
                            key={o.label}
                            data-alert="open"
                            data-overdue={long ? 'true' : 'false'}
                            className={`rounded-lg px-3 py-1 text-[17px] font-extrabold tr-num ${long ? 'bg-[#F5A623] text-[#3A2400]' : 'bg-[#135C73] text-white'}`}
                          >
                            투표 중 {o.label} · {elapsedText(o.openedAt, now)}
                            {long ? ' · 마감 확인' : ''}
                          </li>
                        );
                      })}
                      {sum.starting.map((o) => {
                        const stuck = overdue(o.since, now, STUCK_START_MS);
                        return (
                          <li
                            key={o.label}
                            data-alert="starting"
                            data-overdue={stuck ? 'true' : 'false'}
                            className={`rounded-lg px-3 py-1 text-[17px] font-extrabold tr-num ${stuck ? 'bg-[#B91C1C] text-white' : 'bg-[#FFF1D6] text-[#8A5A00]'}`}
                          >
                            시작 멈춤 {o.label}
                            {o.since ? ` · ${elapsedText(o.since, now)}` : ''} — 분과 PC에서 [투표 시작 이어서 하기]
                          </li>
                        );
                      })}
                      {sum.counting.map((l) => (
                        <li key={`c-${l}`} data-alert="counting" className="rounded-lg bg-[#FFF1D6] px-3 py-1 text-[17px] font-extrabold text-[#8A5A00]">
                          집계 실패 {l} — [결과 다시 불러오기]
                        </li>
                      ))}
                      {sum.undecided.map((l) => (
                        <li key={`u-${l}`} data-alert="undecided" className="rounded-lg bg-[#FFF1D6] px-3 py-1 text-[17px] font-extrabold text-[#8A5A00]">
                          판정 불가 {l} — 참석 인원 확인
                        </li>
                      ))}
                      {sum.handPending.map((l) => (
                        <li key={`h-${l}`} data-alert="hand" className="rounded-lg bg-[#FFF1D6] px-3 py-1 text-[17px] font-extrabold text-[#8A5A00]">
                          거수 확인 전 {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="text-[16px] text-[#5A6B73] tr-num">
                    마지막 저장 {slot?.updatedAt ? `${hhmmss(slot.updatedAt)} (${elapsedText(slot.updatedAt, now)} 전)` : '-'}
                    {slot?.updatedBy ? ` · ${slot.updatedBy}` : ''}
                    {slot?.unreadable ? ' · 서버 내용 읽기 실패' : ''}
                  </p>
                </>
              )}
              <button type="button" className={`${active === d ? btnPrimary : btnGhost} mt-auto`} disabled={!sum.hasState} onClick={() => onOpen(d)}>
                {divisionLabel(d)} 화면 열기
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// 준비판
// ============================================================

export function PrepBoard({ state, update }: { state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  return (
    <div className="space-y-5">
      <DivisionBundleBoard state={state} update={update} />
      <PrepBoardBody state={state} update={update} />
    </div>
  );
}

function PrepBoardBody({ state, update }: { state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected([]);
    setError(null);
  }, [state.division]);

  const check = canCombine(state.source, selected);
  const warning = combineWarningText(check);
  const used = cardsInMotions(state);
  const nextId = check.ok ? nextMotionId(state, check.topicNo) : null;
  const room = nextId ? motionTitleRoom(nextId, title) : null;
  /** 카드 1장을 고를 때 안 제목 칸에 미리 넣은 값. 오퍼레이터가 고쳐 쓴 값은 덮지 않는다. */
  const autoTitle = useRef<string | null>(null);
  const tally = statusTally(state);
  const motionsByTopic = useMemo(() => {
    const map = new Map<string, Motion[]>();
    for (const m of state.motions) map.set(m.topicNo, [...(map.get(m.topicNo) ?? []), m]);
    return map;
  }, [state.motions]);
  const excluded = excludedCardNos(state);
  const selectedExcluded = selected.filter((no) => state.cards[no]?.status === 'excluded');
  /** 10/14 — 이미 다른 안에 들어간 카드는 막지 않고 경고만. */
  const shared = sharedCardWarnings(state, selected);
  /** 방금 만든 안의 공유 경고(만든 뒤에도 한 번 보여 준다). */
  const [madeNote, setMadeNote] = useState<string | null>(null);
  const agendaTopic = agendaTopicNo(state.division);
  const agendaMotions = state.motions.filter((m) => isAgendaMotion(m));
  const [agendaTitle, setAgendaTitle] = useState('');
  const [agendaError, setAgendaError] = useState<string | null>(null);
  const agendaNextId = nextMotionId(state, agendaTopic);
  const makeAgenda = () => {
    // 열쇠는 누를 때 한 번 — 저장 충돌 뒤 다시 적용돼도 같은 안 하나만 만든다(10/14).
    const spec = { title: agendaTitle, text: '', key: newRequestId() };
    const r = createAgendaMotion(state, spec);
    if (!r.ok) {
      setAgendaError(r.error);
      return;
    }
    update((s) => {
      const again = createAgendaMotion(s, spec);
      return again.ok ? again.state : s;
    });
    setAgendaTitle('');
    setAgendaError(null);
  };

  const toggle = (no: string) => {
    const next = selected.includes(no) ? selected.filter((x) => x !== no) : [...selected, no];
    setSelected(next);
    // 카드 1장 = 그 카드 제목을 안 제목 칸에 미리 넣는다(빈칸이거나 아직 미리 넣은 값 그대로일 때만).
    const untouched = !title.trim() || title === autoTitle.current;
    if (next.length === 1 && untouched) {
      const topic = state.source.topics.find((t) => t.no === topicOfCard(state.source, next[0]));
      const cardTitle = topic?.cards.find((c) => c.no === next[0])?.title.trim() ?? '';
      autoTitle.current = cardTitle;
      setTitle(cardTitle);
    } else if (next.length === 0 && untouched) {
      autoTitle.current = null;
      setTitle('');
    } else if (next.length >= 2 && autoTitle.current !== null && title === autoTitle.current) {
      // 둘 이상 합칠 때 첫 카드 제목이 그대로 남으면 합친 안이 그 제목으로 나간다. 미리 넣은 값만 비운다.
      autoTitle.current = null;
      setTitle('');
    }
  };

  const make = () => {
    // 열쇠는 누를 때 한 번 — 저장 충돌 뒤 다시 적용돼도 같은 안 하나만 만들고, 뒤이은 고침이 이 안을 찾는다(10/14).
    const spec = { cardNos: selected, title, text, key: newRequestId() };
    const r = createMotion(state, spec);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // 충돌하면 서버 최신 위에 다시 적용하므로(use-division-prep) 만든 상태를 통째로 넣지 않고 그 위에서 다시 만든다.
    update((s) => {
      const again = createMotion(s, spec);
      return again.ok ? again.state : s;
    });
    setMadeNote(r.warnings.length ? `${r.motion.id}을 만들었습니다. ${r.warnings.join(' ')}` : null);
    setSelected([]);
    setTitle('');
    autoTitle.current = null;
    setText('');
    setError(null);
  };

  return (
    <div className="space-y-5">
      <div data-testid="division-status-tally" className="flex flex-wrap gap-2 text-[16px]">
        {CARD_STATUSES.map((s) => (
          <span key={s} className="rounded-lg border border-[#DCE7EE] bg-[#F5F8FB] px-3 py-1 font-bold text-[#1F4E79]">
            {CARD_STATUS_LABELS[s]} {tally[s]}
          </span>
        ))}
        <span className="rounded-lg bg-[#1F4E79] px-3 py-1 font-bold text-white">의결안 {state.motions.length}</span>
        {state.motions.some((m) => !m.title.trim()) ? (
          <span data-testid="empty-title-count" className="rounded-lg bg-[#FEF2F2] px-3 py-1 font-bold text-[#B91C1C]">
            제목 빈 안 {state.motions.filter((m) => !m.title.trim()).length}
          </span>
        ) : null}
      </div>

      {state.source.topics.map((topic) => (
        <div key={topic.no} data-testid="division-topic" className="rounded-2xl border border-[#DCE7EE]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#DCE7EE] bg-[#F5F8FB] px-4 py-3">
            <span className="text-[18px] font-extrabold text-[#135C73]">{topic.no}</span>
            <span className="min-w-0 text-[18px] font-extrabold text-[#1F2933]">{topic.name}</span>
            <span className="text-[16px] text-[#5A6B73]">작성 {topic.written_by || '—'}</span>
          </div>
          <ul className="divide-y divide-[#EEF3F6]">
            {topic.cards.map((card) => {
              const st = state.cards[card.no];
              const isSel = selected.includes(card.no);
              const isExcluded = st.status === 'excluded';
              const inMotions = used.get(card.no) ?? [];
              const inMotion = inMotions.length ? inMotions.join(' · ') : null;
              // 10/14 — 다른 안에 들어간 카드도 고를 수 있다(유사 묶음이 카드를 함께 쓴다). 막는 것은 시행중-제외뿐.
              const locked = isExcluded && !isSel;
              return (
                <li key={card.no} data-card-no={card.no} data-excluded={isExcluded ? 'true' : undefined} data-in-motion={inMotion ?? undefined} className={`px-4 py-3 ${isSel ? 'bg-[#E6F5F7]' : isExcluded ? 'bg-[#F4F4F4]' : ''}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className={`flex min-h-11 items-center gap-2 ${locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        className="h-6 w-6"
                        checked={isSel}
                        disabled={locked}
                        title={inMotion ? `${inMotion}에 들어 있는 카드입니다(또 넣을 수 있습니다)` : undefined}
                        aria-label={`${card.no} 고르기`}
                        onChange={() => toggle(card.no)}
                      />
                      <span className="text-[16px] font-bold text-[#135C73] tr-num">{card.no}</span>
                    </label>
                    <span className={`min-w-0 flex-1 text-[17px] font-bold ${isExcluded ? 'text-[#7A8790] line-through' : 'text-[#1F2933]'}`}>
                      {isUntitled(card) ? (
                        <span className="rounded-md bg-[#FFF1D6] px-2 py-0.5 text-[16px] text-[#8A5A00] no-underline">제목 없음</span>
                      ) : (
                        card.title
                      )}
                    </span>
                    <select
                      aria-label={`${card.no} 처리 상태`}
                      value={st.status}
                      onChange={(e) => update((s) => setCardStatus(s, card.no, { status: e.target.value as CardStatus, target: st.target }))}
                      className="min-h-11 rounded-xl border border-[#C4D8E4] bg-white px-2 text-[16px] font-bold text-[#1F4E79]"
                    >
                      {CARD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {CARD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    {st.status === 'transferred' ? (
                      <select
                        aria-label={`${card.no} 이관 분과`}
                        value={st.target ?? ''}
                        onChange={(e) => update((s) => setCardStatus(s, card.no, { status: 'transferred', target: e.target.value }))}
                        className="min-h-11 rounded-xl border border-[#C4D8E4] bg-white px-2 text-[16px]"
                      >
                        <option value="">이관할 분과</option>
                        {[1, 2, 3]
                          .filter((d) => d !== state.division)
                          .map((d) => (
                            <option key={d} value={divisionLabel(d)}>
                              {divisionLabel(d)}
                            </option>
                          ))}
                      </select>
                    ) : null}
                    {st.status === 'merged' && inMotions.length <= 1 ? (
                      <span className="text-[16px] font-bold text-[#5A6B73]">→ {st.target ?? '안 번호 없음'}</span>
                    ) : inMotion ? (
                      <span data-testid="card-in-motions" className={`text-[16px] font-bold ${inMotions.length > 1 ? 'rounded-md bg-[#FFF6E0] px-2 py-0.5 text-[#7A4B00]' : 'text-[#5A6B73]'}`}>
                        → {inMotion}에 들어감
                      </span>
                    ) : null}
                  </div>
                  <details className="mt-1 pl-8">
                    <summary className="min-h-11 cursor-pointer text-[16px] font-bold text-[#2E75B6]">권고 {card.recs.length}건</summary>
                    <ol className="mt-1 space-y-1 text-[16px] text-[#1F2933]">
                      {card.recs.map((r) => (
                        <li key={r.no}>
                          <span className="mr-2 font-bold text-[#5A6B73] tr-num">{r.no}</span>
                          {r.text}
                        </li>
                      ))}
                    </ol>
                  </details>
                </li>
              );
            })}
          </ul>
          {(motionsByTopic.get(topic.no) ?? []).length > 0 ? (
            <div className="space-y-3 border-t border-[#DCE7EE] bg-[#FBFDFE] p-4">
              {(motionsByTopic.get(topic.no) ?? []).map((m) => (
                <MotionEditor key={m.id} motion={m} state={state} update={update} />
              ))}
            </div>
          ) : null}
        </div>
      ))}

      <div data-testid="agenda-section" className="rounded-2xl border-2 border-[#1F4E79]/30">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#DCE7EE] bg-[#F5F8FB] px-4 py-3">
          <span className="text-[18px] font-extrabold text-[#135C73]">{agendaTopic}</span>
          <span className="min-w-0 text-[18px] font-extrabold text-[#1F2933]">카드 없는 안건</span>
          <span className="text-[16px] text-[#5A6B73]">분과별 최종 권고안 의결 · 최종 권고안 문구 작성 위임 의결처럼 카드와 무관한 안건. 투표 진행 맨 뒤에 놓입니다.</span>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            {AGENDA_PRESETS.map((p) => (
              <button key={p} type="button" className={btnGhost} onClick={() => setAgendaTitle(p)}>
                「{p}」 넣기
              </button>
            ))}
          </div>
          <textarea
            className={`${input} min-h-14 py-2 font-bold`}
            rows={titleRows(agendaTitle)}
            placeholder="안건 제목 — 큰 QR 화면과 투표자 휴대폰에 그대로 나옵니다"
            value={agendaTitle}
            onChange={(e) => setAgendaTitle(e.target.value)}
            aria-label="카드 없는 안건 제목"
          />
          <TitleRoom id={agendaNextId} room={motionTitleRoom(agendaNextId, agendaTitle)} />
          {agendaError ? (
            <p role="alert" className="text-[16px] font-bold text-[#B91C1C]">
              {agendaError}
            </p>
          ) : null}
          <button
            type="button"
            className={btnPrimary}
            data-testid="agenda-make"
            disabled={!agendaTitle.trim() || motionTitleRoom(agendaNextId, agendaTitle) < 0}
            onClick={makeAgenda}
          >
            {agendaNextId} 안건 만들기
          </button>
        </div>
        {agendaMotions.length > 0 ? (
          <div className="space-y-3 border-t border-[#DCE7EE] bg-[#FBFDFE] p-4">
            {agendaMotions.map((m) => (
              <MotionEditor key={m.id} motion={m} state={state} update={update} />
            ))}
          </div>
        ) : null}
      </div>

      <div data-testid="excluded-list" className="rounded-2xl border border-[#DCE7EE] bg-[#F7F7F7] p-4">
        <p className="text-[17px] font-extrabold text-[#5A6B73]">시행중-제외 카드 {excluded.length}장</p>
        <p className="mt-1 text-[16px] text-[#5A6B73]">{excluded.length ? excluded.join(', ') : '없습니다.'}</p>
      </div>

      {selected.length === 0 && madeNote ? (
        <p data-testid="made-note" className="sticky bottom-2 z-20 flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#E8B44C] bg-[#FFF6E0] px-4 py-3 text-[16px] font-bold text-[#7A4B00] shadow-lg">
          <span className="min-w-0 flex-1">⚠ {madeNote}</span>
          <button type="button" className="min-h-11 rounded-lg px-3 underline" onClick={() => setMadeNote(null)}>
            닫기
          </button>
        </p>
      ) : null}
      {/* 의결안 만들기 — 카드를 고르면 아래에 붙는다 */}
      {selected.length > 0 ? (
        <div data-testid="motion-builder" className="sticky bottom-2 z-20 space-y-3 rounded-2xl border-2 border-[#135C73] bg-white p-4 shadow-lg">
          <p className="text-[16px] font-bold text-[#1F2933]">
            고른 카드 {selected.length}장 · {selected.join(', ')}
          </p>
          {!check.ok ? (
            <p role="alert" className="text-[16px] font-bold text-[#B91C1C]">
              {combineFailureText(check)}
            </p>
          ) : null}
          {warning ? (
            <p data-testid="combine-warning" className="rounded-xl border border-[#E8B44C] bg-[#FFF6E0] px-3 py-2 text-[16px] font-bold text-[#7A4B00]">
              ⚠ {warning}
            </p>
          ) : null}
          {shared.length > 0 ? (
            <ul data-testid="shared-card-warning" className="space-y-1 rounded-xl border border-[#E8B44C] bg-[#FFF6E0] px-3 py-2 text-[16px] font-bold text-[#7A4B00]">
              {shared.map((w) => (
                <li key={w}>⚠ {w} 맞으면 그대로 만드십시오.</li>
              ))}
            </ul>
          ) : null}
          {selectedExcluded.length > 0 ? (
            <p role="alert" className="text-[16px] font-bold text-[#B91C1C]">
              시행중-제외 카드({selectedExcluded.join(', ')})는 의결안에 넣을 수 없습니다. 선택을 풀어 주십시오.
            </p>
          ) : null}
          <textarea
            className={`${input} min-h-16 py-2 font-bold`}
            rows={titleRows(title)}
            placeholder="안 제목 — 합친 문구. 큰 QR 화면과 투표자 휴대폰에 그대로 크게 나옵니다"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="안 제목"
          />
          {nextId ? <TitleRoom id={nextId} room={room ?? 0} /> : null}
          <textarea
            className={`${input} min-h-24 py-2`}
            placeholder="안 문안"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="안 문안"
          />
          {error ? (
            <p role="alert" className="text-[16px] font-bold text-[#B91C1C]">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={!check.ok || !title.trim() || selectedExcluded.length > 0 || (room ?? 0) < 0} onClick={make}>
              의결안 만들기
            </button>
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                setSelected([]);
                if (title === autoTitle.current) setTitle('');
                autoTitle.current = null;
              }}
            >
              선택 해제
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PhaseBadge({ phase }: { phase: MotionPhase }) {
  const tone: Record<MotionPhase, string> = {
    excluded: 'bg-[#E5E7EB] text-[#4B5563]',
    ready: 'bg-[#E6F0F8] text-[#1F4E79]',
    revote: 'bg-[#FFF1D6] text-[#8A5A00]',
    starting: 'bg-[#E6F0F8] text-[#1F4E79]',
    open: 'bg-[#135C73] text-white',
    counting: 'bg-[#FFF1D6] text-[#8A5A00]',
    passed: 'bg-[#2F6F25] text-white',
    failed: 'bg-[#B91C1C] text-white',
    undecided: 'bg-[#FFF1D6] text-[#8A5A00]',
    minority: 'bg-[#5B21B6] text-white',
  };
  return (
    <span data-testid="motion-phase" data-phase={phase} className={`rounded-lg px-3 py-1 text-[16px] font-extrabold ${tone[phase]}`}>
      {PHASE_LABELS[phase]}
    </span>
  );
}

/** 안 제목 칸 줄 수 — 300자 문구도 스크롤 없이 다 보이게 길이에 맞춰 늘린다. */
function titleRows(title: string): number {
  return Math.min(8, Math.max(2, Math.ceil([...title].length / 55) + (title.match(/\n/g)?.length ?? 0)));
}

/** 안 제목 칸 아래 「남은 글자」. 투표 문항 = 안 번호 + 띄어쓰기 + 제목, 300자까지. */
function TitleRoom({ id, room }: { id: string; room: number }) {
  return (
    <p data-testid="title-room" className={`text-[16px] font-bold tr-num ${room < 0 ? 'text-[#B91C1C]' : room <= 30 ? 'text-[#8A5A00]' : 'text-[#5A6B73]'}`}>
      {room < 0 ? `${-room}자 넘쳤습니다` : `남은 글자 ${room}자`} · 안 번호 「{id}」 포함 {MAX_STATEMENT_LENGTH}자까지
    </p>
  );
}

/** 안 카드의 원 카드 표기. 카드 없는 안건은 그렇다고 적는다. */
function cardsText(motion: Pick<Motion, 'cardNos'>): string {
  return isAgendaMotion(motion) ? '카드 없는 안건' : `원 카드 ${motion.cardNos.join(', ')}`;
}

/**
 * 유사 묶음 참고(10/14) — 묶음 번호·공통 취지·세부 번호·제안 조, 그리고 세부 권고 원문(펼쳐 보기).
 * 모더레이터가 문구를 합칠 때 분과 PC 화면에서 바로 본다. 원문은 준비판 원천(가져온 권고안 파일)에서 찾는다.
 */
export function GroupReference({ group, source }: { group: NonNullable<Motion['group']>; source: RecsDivision }) {
  const recs = groupRecTexts(source, group.recs);
  return (
    <div data-testid="group-reference" className="mt-3 rounded-xl border border-[#C4D8E4] bg-[#F5F8FB] px-4 py-3">
      <p className="text-[17px] text-[#1F2933]">
        <span className="mr-2 font-extrabold text-[#1F4E79]">{group.letter ? groupLabel(group) : group.id}</span>
        {group.letter ? (group.common ? <span className="text-[#5A6B73]">공통: {group.common}</span> : null) : (<><span className="font-bold">공통 취지:</span> {group.name || '—'}</>)}
      </p>
      <p className="mt-1 text-[16px] text-[#5A6B73] tr-num">
        세부 {group.recs.length}건 {group.recs.join(', ')}
        {group.cardTeams ? ` · 카드 ${Object.entries(group.cardTeams).map(([c, t]) => `${c} (${t})`).join(' ')}` : group.teams.length ? ` · 제안 ${group.teams.join(' ')}` : ''}
      </p>
      <details className="mt-1" data-testid="group-recs">
        <summary className="min-h-11 cursor-pointer text-[16px] font-bold text-[#2E75B6]">세부 권고 문구 보기 ({recs.length}건)</summary>
        <ol className="mt-1 space-y-2 text-[17px] leading-relaxed text-[#1F2933]">
          {recs.map((r) => (
            <li key={r.no} data-rec-no={r.no}>
              <span className="mr-2 font-bold text-[#135C73] tr-num">{r.no}</span>
              {r.text ?? <span className="font-bold text-[#B91C1C]">권고안 파일에서 찾지 못했습니다</span>}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

export function MotionEditor({ motion, state, update }: { motion: Motion; state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  const present = useContext(PresentContext);
  const phase = motionPhase(state, motion);
  const titleLocked = !canEditMotionTitle(motion);
  const combined = canCombine(state.source, motion.cardNos);
  const topics = combined.ok ? combined.topics : [];
  return (
    <div
      data-testid="motion-card"
      data-motion-id={motion.id}
      className={`rounded-xl border bg-white p-4 ${present.current === motion.id ? 'border-[3px] border-[#B45309]' : 'border-[#C4D8E4]'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg bg-[#1F4E79] px-3 py-1 text-[16px] font-extrabold text-white">{motion.id}</span>
        <PhaseBadge phase={phase} />
        <button
          type="button"
          data-testid="present-focus"
          aria-pressed={present.current === motion.id}
          onClick={() => present.focus(motion.id)}
          className={present.current === motion.id ? `${btn} bg-[#B45309] text-white` : btnGhost}
        >
          {present.current === motion.id ? '큰 화면에 나오는 중' : '큰 화면에 띄우기'}
        </button>
        <span className="text-[16px] text-[#5A6B73]">{cardsText(motion)}</span>
        {motion.group ? (
          <span data-testid="motion-group-id" className="rounded-lg bg-[#E6F0F8] px-2 py-0.5 text-[16px] font-extrabold text-[#1F4E79]">
            {motion.group.id}
          </span>
        ) : null}
        {topics.length > 1 ? (
          <span className="rounded-lg bg-[#FFF6E0] px-2 py-0.5 text-[16px] font-bold text-[#7A4B00]">주제 섞임 {topics.join(' · ')}</span>
        ) : null}
        <span className="text-[16px] font-bold text-[#135C73]">권고 수준 충족 {criteriaCount(motion)}/5</span>
        {canDeleteMotion(motion) ? (
          <button
            type="button"
            className={`${btnGhost} ml-auto`}
            onClick={() => {
              if (window.confirm(`${motion.id}을 지웁니다. 통합으로 묶인 카드는 유지로 돌아갑니다.`)) update(onMotion(motionRef(motion), (s, id) => deleteMotion(s, id)));
            }}
          >
            안 지우기
          </button>
        ) : (
          <span className="ml-auto text-[16px] text-[#5A6B73]">투표를 시작한 안은 지울 수 없습니다.</span>
        )}
      </div>
      {motion.group ? <GroupReference group={motion.group} source={state.source} /> : null}
      {/* 10/14 operator-5 — 제목 칸 바로 왼쪽에 안 번호를 크게. 다른 안 칸을 고치는 착각을 막는다. */}
      <div className="mt-3 flex items-stretch gap-3">
        <span
          data-testid="title-id-tag"
          className="flex w-36 shrink-0 flex-col justify-center rounded-xl bg-[#1F4E79] px-2 py-2 text-center text-white"
        >
          <span className="text-[14px] font-bold opacity-80">안 번호</span>
          <span className="break-all text-[24px] font-black leading-tight tr-num">{motion.id}</span>
        </span>
        <textarea
          className={`${input} min-h-14 flex-1 py-2 font-bold ${titleLocked ? 'cursor-not-allowed bg-[#F4F4F4] text-[#4B5563]' : ''} ${!motion.title.trim() && !titleLocked ? 'border-2 border-[#DC2626] bg-[#FFF8F8]' : ''}`}
          rows={titleRows(motion.title)}
          value={motion.title}
          readOnly={titleLocked}
          aria-readonly={titleLocked}
          data-locked={titleLocked ? 'true' : 'false'}
          aria-label={`${motion.id} 제목`}
          placeholder={`${motion.id} 제목 — 합친 문구를 칩니다. 큰 QR 화면과 투표자 휴대폰에 그대로 나옵니다`}
          onFocus={() => present.focus(motion.id)}
          onChange={(e) => {
            if (!titleLocked) update(onMotion(motionRef(motion), (s, id) => updateMotion(s, id, { title: e.target.value })));
          }}
        />
      </div>
      {!motion.title.trim() && !titleLocked ? (
        <p data-testid="title-empty" className="mt-1 text-[16px] font-bold text-[#B91C1C]">
          {motion.id} 제목이 비어 있습니다. 제목을 넣어야 [투표 시작]이 눌립니다.
        </p>
      ) : null}
      {titleLocked ? (
        <p data-testid="title-locked" className="text-[16px] font-bold text-[#8A5A00]">
          투표를 시작한 안은 제목을 고칠 수 없습니다(큰 화면·휴대폰·기록은 보낸 문장 그대로입니다). 부결이면 [문구 고쳐 2차 투표]에서 고칩니다.
        </p>
      ) : (
        <TitleRoom id={motion.id} room={motionTitleRoom(motion.id, motion.title)} />
      )}
      <label className="mt-3 block text-[16px] font-extrabold text-[#135C73]" htmlFor={`motion-text-${motion.id}`}>
        본문 메모 <span className="font-bold text-[#5A6B73]">(선택 · 투표 문구는 위 제목 칸입니다. 원안 대비 수정 내역·권고 본문을 남길 때 씁니다 · 투표 뒤에도 고칠 수 있고 결과 CSV 「수정문안」 열에 남습니다)</span>
      </label>
      <textarea
        id={`motion-text-${motion.id}`}
        data-testid="motion-text"
        className={`${input} mt-1 min-h-20 py-2`}
        value={motion.text}
        aria-label={`${motion.id} 문안`}
        placeholder="필요할 때만 — 원안과 수정안 차이, 권고 본문 등"
        onChange={(e) => update(onMotion(motionRef(motion), (s, id) => updateMotion(s, id, { text: e.target.value })))}
      />
      {phase === 'excluded' ? (
        <p className="mt-2 text-[16px] font-bold text-[#4B5563]">원 카드가 모두 시행중-제외라 투표에 올리지 않습니다.</p>
      ) : null}
    </div>
  );
}

// ============================================================
// 투표 진행
// ============================================================

/**
 * 투표 단위 = 안 하나(10/7·10/14 결정). 묶음 로직(batchMotions)은 남아 있지만 화면에서는 고를 수 없다.
 * 이미 묶어 시작한 옛 투표가 있으면 voteUnits 가 그 투표끼리 그대로 보여 준다.
 */
const ONE_AT_A_TIME = 1;

function useBallotCounts(api: DivisionBallotApi | null, active: boolean): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!api || !active) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const rows = await api.list();
        if (alive) setCounts(Object.fromEntries(rows.map((r) => [r.id, Number(r.response_count) || 0])));
      } catch (error) {
        console.warn('[division vote] ballot list failed', error);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [api, active]);
  return counts;
}

function VoteBoard({
  state,
  update,
  prep,
  api,
  preview,
  isOps,
  entryQr,
  onEntryQrUsed,
  bandSlot,
  onCsv,
  onCounts,
}: {
  state: PrepState;
  update: (fn: (s: PrepState) => PrepState) => void;
  prep: DivisionPrep;
  api: DivisionBallotApi | null;
  preview: boolean;
  isOps: boolean;
  /** 들어왔을 때 열린 투표가 있으면 그 멱등키 — 한 번 QR 로 띄우고 onEntryQrUsed 로 돌려준다. */
  entryQr: string | null;
  onEntryQrUsed: () => void;
  /** 「지금 투표 중」 띠를 붙일 자리(패널 위 붙박이 칸). 없으면 이 자리에 그린다. */
  bandSlot: HTMLElement | null;
  onCsv: () => void;
  /** 제출 수가 바뀔 때마다 — 발표 창으로 보낸다(10/15). */
  onCounts?: (counts: Record<string, number>) => void;
}) {
  const present = useContext(PresentContext);
  const namedAccess = useContext(NamedAccessContext);
  const d = state.division;
  const [busy, setBusy] = useState<Record<string, 'start' | 'close' | 'void'>>({});
  const inflight = useRef<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ key: string; tone: 'ok' | 'error'; text: string } | null>(null);
  const [qrKey, setQrKey] = useState<string | null>(null);
  /** 이 기기에서 연 투표. 다른 화면(운영팀·PC-B)이 연 투표는 띠에서 따로 알린다(10/14 ops-5). */
  const openedHere = useRef<Set<string>>(new Set());

  // 10/7·10/14 결정 — 투표는 안 하나씩. 묶음 버튼(5개·10개 안팎·전체 한 번)은 화면에서 뺐다.
  const units = voteUnits(state, ONE_AT_A_TIME);
  const live = liveBallots(state);
  const anyOpen = live.some((b) => b.stage === 'open');
  const counts = useBallotCounts(api, anyOpen || qrKey !== null);
  useEffect(() => {
    onCounts?.(counts);
  }, [counts, onCounts]);
  const ready = attendanceReady(state.attendance);
  const excludedMotions = state.motions.filter((m) => motionExcluded(state, m));
  const now = useNow(1000) + prep.serverOffsetMs;

  const commit = useCallback((fn: (s: PrepState) => PrepState) => prep.commitFact(d, fn), [prep, d]);
  const getState = useCallback(() => {
    const s = prep.getState(d);
    if (!s) throw new Error('준비 내용이 없습니다.');
    return s;
  }, [prep, d]);
  const nowIso = () => new Date(Date.now() + prep.serverOffsetMs).toISOString();

  /** QR 띄우기 — 이 화면에서 한 번 띄운 투표는 「다른 화면에서 연 투표」 안내를 다시 보이지 않는다(안내를 따른 것이므로). */
  const showQr = (requestId: string) => {
    openedHere.current.add(requestId);
    setQrKey(requestId);
  };

  // 10/14 operator-6 — 새로고침 뒤 들어왔을 때 열린 투표의 QR 을 바로 띄운다(한 번).
  useEffect(() => {
    if (!entryQr) return;
    if (state.ballots[entryQr]?.stage === 'open') {
      // 이 PC 가 띄우던 투표로 본다 — 「다른 화면에서 연 투표」 안내를 띄우지 않게.
      // 발표 창이 연결돼 있으면 QR 은 발표 창이 띄운다(노트북은 작업 화면 그대로).
      if (present.presenterAlive()) openedHere.current.add(entryQr);
      else showQr(entryQr);
    }
    onEntryQrUsed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryQr]);

  // 10/14 ops-5 — QR 의 투표가 다른 화면에서 마감·무효되면 QR 을 내린다(마감된 QR 이 결과를 가리지 않게).
  const qrStage = qrKey ? state.ballots[qrKey]?.stage ?? null : null;
  useEffect(() => {
    if (qrKey && qrStage !== 'open') setQrKey(null);
  }, [qrKey, qrStage]);

  const lock = (key: string, kind: 'start' | 'close' | 'void') => {
    if (inflight.current.has(key)) return false;
    inflight.current.add(key);
    setBusy((b) => ({ ...b, [key]: kind }));
    return true;
  };
  const unlock = (key: string) => {
    inflight.current.delete(key);
    setBusy((b) => {
      const next = { ...b };
      delete next[key];
      return next;
    });
  };

  const start = async (unit: VoteUnit) => {
    if (!api) return;
    if (!lock(unit.key, 'start')) return;
    // [투표 시작]을 누른 뒤에는 그 안의 단위 키가 「new:…」에서 멱등키로 바뀐다(voteUnits). 멱등키로도 잠가 두어야
    // 여는 동안 같은 화면의 [잘못 연 투표 무효]·[이어서 하기]가 막힌다(10/14).
    let heldKey: string | null = null;
    /** 안내 줄을 붙일 단위 키 — 시작 뒤에는 멱등키가 그 단위의 키다. */
    let msgKey = unit.key;
    try {
      let requestId: string | null = null;
      let error: string | null = null;
      const fresh = newRequestId();
      const at = nowIso();
      // 안 번호가 아니라 열쇠로 넘긴다 — 저장 충돌 뒤 다시 적용될 때 번호가 밀렸어도 이 화면이 본 그 안을 연다(10/14).
      const refs = unit.motionIds.map((id) => {
        const m = state.motions.find((x) => x.id === id);
        return m ? motionRef(m) : id;
      });
      await commit((s) => {
        const ids = refs.map((ref) => resolveMotionId(s, ref));
        if (ids.some((id) => id === null)) {
          error = '안이 바뀌었습니다. 화면을 확인하고 다시 누르십시오.';
          return s;
        }
        const r = beginVote(s, ids as string[], fresh, at);
        if (!r.ok) {
          error = r.error;
          return s;
        }
        requestId = r.requestId;
        return r.state;
      });
      if (error || !requestId) {
        setMsg({ key: unit.key, tone: 'error', text: error ?? '투표를 시작하지 못했습니다.' });
        return;
      }
      const id: string = requestId;
      msgKey = id;
      if (id !== unit.key && lock(id, 'start')) heldKey = id;
      openedHere.current.add(id);
      const record = await runVoteStart(api, commit, getState, id, nowIso);
      if (record.voidedAt || record.stage !== 'open') {
        // 여는 사이에 무효로 했다(이 화면이든 운영팀이든) — QR 을 띄우지 않는다.
        setMsg({ key: msgKey, tone: 'ok', text: '여는 사이에 무효로 한 투표라 열지 않았습니다.' });
        return;
      }
      setMsg(null);
      present.focus(unit.motionIds[0] ?? '');
      // 발표 창이 연결돼 있으면 QR 은 그 창(프로젝터)에 뜬다 — 노트북은 마감·제출 수를 보며 계속 쓴다.
      if (!present.presenterAlive()) setQrKey(id);
    } catch (e) {
      console.error('[division vote] start failed', e);
      setMsg({ key: msgKey, tone: 'error', text: '투표를 여는 중에 끊겼습니다. [투표 시작]을 다시 누르면 같은 투표를 이어서 엽니다.' });
    } finally {
      if (heldKey) unlock(heldKey);
      unlock(unit.key);
    }
  };

  /** 무효로 했는데 서버에서 아직 열려 있는 투표 닫기(옛 기록 — strayOpenBallot). */
  const closeStray = async (requestId: string) => {
    if (!api) return;
    const key = `stray:${requestId}`;
    if (!lock(key, 'close')) return;
    try {
      await runStrayClose(api, commit, getState, requestId, nowIso);
      if (qrKey === requestId) setQrKey(null);
    } catch (e) {
      console.error('[division vote] stray close failed', e);
      setMsg({ key, tone: 'error', text: '서버 투표를 닫지 못했습니다. 다시 누르거나 운영팀에 알리십시오.' });
    } finally {
      unlock(key);
    }
  };

  const close = async (unit: VoteUnit) => {
    if (!api || !unit.requestId) return;
    if (!lock(unit.key, 'close')) return;
    try {
      const out = await runVoteClose(api, commit, getState, unit.requestId, nowIso);
      if (!out.ok) setMsg({ key: unit.key, tone: 'error', text: out.error });
      else setMsg(null);
      if (qrKey === unit.requestId) setQrKey(null);
    } catch (e) {
      console.error('[division vote] close failed', e);
      setMsg({ key: unit.key, tone: 'error', text: '마감 중에 끊겼습니다. [마감하고 결과 보기]를 다시 누르십시오.' });
    } finally {
      unlock(unit.key);
    }
  };

  /** 10/14 operator-2·ops-1 — 잘못 연 투표를 무효로(서버 투표를 닫고 그 차수를 판정·차수 계산에서 뺀다). */
  const voidVote = async (unit: VoteUnit) => {
    if (!api || !unit.requestId) return;
    if (!lock(unit.key, 'void')) return;
    const requestId = unit.requestId;
    const labels = unit.motionIds.join(', ');
    try {
      const out = await runVoteVoid(api, commit, getState, requestId, nowIso);
      if (qrKey === requestId) setQrKey(null);
      setMsg(
        out.ok
          ? { key: unit.key, tone: 'ok', text: `${labels} 투표를 무효로 했습니다. 안이 앞 단계로 돌아갔습니다(기록에는 「무효」로 남습니다).` }
          : { key: unit.key, tone: 'error', text: out.error },
      );
    } catch (e) {
      console.error('[division vote] void failed', e);
      setMsg({ key: unit.key, tone: 'error', text: '서버 투표를 닫지 못해 무효로 하지 않았습니다(아직 표를 받는 중일 수 있습니다). 다시 누르거나 운영팀에 알리십시오.' });
    } finally {
      unlock(unit.key);
    }
  };

  const qrRecord = qrKey ? state.ballots[qrKey] : null;
  const qrRow = qrRecord && qrRecord.stage === 'open' ? qrRowOf(qrRecord, qrRecord.ballotId ? counts[qrRecord.ballotId] ?? 0 : 0) : null;
  const unitOf = (requestId: string) => units.find((u) => u.requestId === requestId) ?? null;

  // 10/14 operator-3·operator-6·ops-5 — 열린 투표는 화면 위 띠에 늘 보인다(스크롤하지 않고 QR·마감).
  const band =
    live.length > 0 ? (
      <div data-testid="live-vote-band" className="space-y-2">
        {live.map((b) => {
          if (strayOpenBallot(b)) {
            const strayKey = `stray:${b.requestId}`;
            return (
              <div key={b.requestId} data-testid="band-stray" data-band-request={b.requestId} className="rounded-2xl border-2 border-[#B91C1C] bg-[#FEF2F2] px-4 py-3 text-[#7F1D1D] shadow-md">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="min-w-0 flex-1 text-[20px] font-extrabold tr-num">
                    무효로 한 투표가 서버에서 아직 열려 있습니다: {divisionLabel(d)} {ballotLabel(b)}
                  </span>
                  <button type="button" data-testid="band-stray-close" className={`${btn} bg-[#B91C1C] text-white`} disabled={!api || !!busy[strayKey]} onClick={() => void closeStray(b.requestId)}>
                    {busy[strayKey] ? '닫는 중…' : '서버 투표 닫기'}
                  </button>
                </div>
                {msg?.key === strayKey ? <p className="mt-1 text-[16px] font-bold">{msg.text}</p> : null}
              </div>
            );
          }
          const unit = unitOf(b.requestId);
          const m = state.motions.find((x) => x.id === b.motionIds[0]);
          const title = currentRound(m ?? { rounds: [] })?.title ?? m?.title ?? '';
          const label = ballotLabel(b);
          const responses = b.ballotId ? counts[b.ballotId] ?? null : null;
          // 운영팀 노트북은 큰 화면에 연결하지 않으므로 이 안내는 분과 PC 에만.
          const elsewhere = elsewhereHint(isOps, b.stage, openedHere.current.has(b.requestId), qrKey === b.requestId);
          const isBusy = unit ? !!busy[unit.key] : false;
          // 10/14 — 여는 중은 30초가 지나야 「멈춤」으로 본다(정상 시작마다 무효를 권하지 않게). 시각 없는 옛 기록은 멈춤으로.
          const stuck = startStuck(b, isBusy, now);
          return (
            <div
              key={b.requestId}
              data-band-request={b.requestId}
              data-stage={b.stage}
              className={`rounded-2xl border-2 px-4 py-3 shadow-md ${b.stage === 'open' ? 'border-[#135C73] bg-[#0B3A4A] text-white' : 'border-[#F5A623] bg-[#FFF3C4] text-[#7A4B00]'}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1 text-[20px] font-extrabold tr-num">
                  {b.stage === 'open' ? '지금 투표 중' : stuck ? '투표 여는 중(멈춤)' : '투표 여는 중…'}: {divisionLabel(d)} {label} 「{titleHead(title, 24)}」
                  {b.stage === 'open' ? (
                    <span className="ml-2 text-[18px] font-bold opacity-90">
                      · 제출 {responses ?? '…'}명 · {elapsedText(b.openedAt, now)}
                    </span>
                  ) : null}
                </span>
                {b.stage === 'open' ? (
                  <>
                    <button
                      type="button"
                      data-testid="band-qr"
                      className="min-h-12 rounded-xl bg-white px-4 text-[17px] font-extrabold text-[#0B3A4A]"
                      onClick={() => showQr(b.requestId)}
                    >
                      QR 띄우기
                    </button>
                    {unit ? (
                      <TwoStepButton
                        className={`${btn} bg-[#B45309] text-white`}
                        armedClassName={`${btn} bg-[#7F1D1D] text-white ring-4 ring-[#FCA5A5]`}
                        testId="band-close"
                        disabled={!api || isBusy}
                        label={busy[unit.key] === 'close' ? '마감하는 중…' : '마감하고 결과 보기'}
                        armedLabel={armedText('close', d, label, title)}
                        onFire={() => void close(unit)}
                      />
                    ) : null}
                  </>
                ) : unit && stuck ? (
                  <button type="button" data-testid="band-resume" className={`${btn} bg-[#135C73] text-white`} disabled={!api || isBusy} onClick={() => void start(unit)}>
                    투표 시작 이어서 하기
                  </button>
                ) : null}
              </div>
              {elsewhere ? (
                <p data-testid="band-elsewhere" className="mt-2 rounded-lg bg-[#F5A623] px-3 py-1 text-[17px] font-extrabold text-[#3A2400]">
                  다른 화면에서 연 투표입니다. 이 PC가 큰 화면에 연결돼 있으면 [QR 띄우기]를 누르십시오.
                </p>
              ) : null}
              {stuck ? (
                <p className="mt-1 text-[16px] font-bold">투표를 여는 중에 멈췄습니다. [투표 시작 이어서 하기]를 누르거나, 잘못 연 것이면 아래 안 카드에서 [잘못 연 투표 무효]를 누릅니다.</p>
              ) : null}
            </div>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="space-y-5">
      {band ? (bandSlot ? createPortal(band, bandSlot) : band) : null}
      <NamedVoteSettingsBox access={namedAccess} />
      <AttendanceBox state={state} update={update} />

      {state.motions.length === 0 ? (
        <p className="text-[18px] text-[#5A6B73]">「1. 준비판」에서 의결안을 먼저 만드십시오.</p>
      ) : (
        <>
          {!api ? (
            <p className="rounded-xl bg-[#F5F8FB] px-4 py-3 text-[16px] text-[#5A6B73]">
              {preview ? '미리보기에는 투표 서버가 없습니다.' : '조 코드로 들어온 콘솔에서 투표를 열 수 있습니다.'}
            </p>
          ) : null}
          <ol className="space-y-4" data-testid="vote-units">
            {units.map((unit) => (
              <UnitCard
                key={unit.key}
                unit={unit}
                state={state}
                update={update}
                ready={ready}
                isOps={isOps}
                otherLive={live.find((b) => b.requestId !== unit.requestId) ?? null}
                canNetwork={!!api}
                busy={busy[unit.key] ?? null}
                msg={msg?.key === unit.key ? msg : null}
                responses={(() => {
                  const b = unit.requestId ? state.ballots[unit.requestId] : null;
                  return b?.ballotId ? counts[b.ballotId] ?? null : null;
                })()}
                nowMs={now}
                onStart={() => void start(unit)}
                onClose={() => void close(unit)}
                onVoid={() => void voidVote(unit)}
                onQr={() => unit.requestId && showQr(unit.requestId)}
              />
            ))}
          </ol>
        </>
      )}

      {excludedMotions.length > 0 ? (
        <div data-testid="excluded-motions" className="rounded-2xl border border-[#DCE7EE] bg-[#F7F7F7] p-4">
          <p className="text-[17px] font-extrabold text-[#5A6B73]">제외된 안 {excludedMotions.length}건 (원 카드가 모두 시행중-제외 · 투표하지 않음)</p>
          <ul className="mt-2 space-y-1 text-[16px] text-[#4B5563]">
            {excludedMotions.map((m) => (
              <li key={m.id}>
                <span className="font-bold">{m.id}</span> {m.title} <span className="text-[#7A8790]">({cardsText(m)})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-[#DCE7EE] pt-4">
        <button type="button" className={btnPrimary} onClick={onCsv} data-testid="division-csv">
          이 분과 결과 CSV
        </button>
        <span className="text-[16px] text-[#5A6B73]">엑셀에서 바로 열리는 파일로 내려받습니다(안·차수마다 한 줄).</span>
      </div>

      {qrRow ? <BallotQrFullscreen ballot={qrRow} headline={qrRecord ? qrHeadlineOf(qrRecord) : undefined} onExit={() => setQrKey(null)} access={namedAccess} /> : null}
    </div>
  );
}

function AttendanceBox({ state, update }: { state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  const { enrolled, present } = state.attendance;
  const ready = attendanceReady(state.attendance);
  const [draft, setDraft] = useState({ enrolled: enrolled === null ? '' : String(enrolled), present: present === null ? '' : String(present) });
  // 다른 화면에서 바뀐 값이 들어오면 칸도 따라간다.
  useEffect(() => {
    setDraft((cur) => ({
      enrolled: cur.enrolled.trim() === (enrolled === null ? '' : String(enrolled)) ? cur.enrolled : enrolled === null ? '' : String(enrolled),
      present: cur.present.trim() === (present === null ? '' : String(present)) ? cur.present : present === null ? '' : String(present),
    }));
  }, [enrolled, present]);
  const onChange = (field: 'enrolled' | 'present', raw: string) => {
    setDraft((cur) => ({ ...cur, [field]: raw }));
    update((s) => setAttendanceField(s, field, raw));
  };
  return (
    <div data-testid="attendance-box" className={`rounded-2xl border-2 p-4 ${ready ? 'border-[#2F6F25] bg-[#F3FAF4]' : 'border-[#DC2626]/50 bg-[#FEF2F2]'}`}>
      <p className="text-[18px] font-extrabold text-[#1F4E79]">참석 인원 (투표 전에 꼭 넣습니다)</p>
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[17px] font-bold text-[#1F4E79]">재적</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="재적"
            className={`${input} mt-1 h-14 text-[24px] tr-num`}
            value={draft.enrolled}
            placeholder="예: 60"
            onChange={(e) => onChange('enrolled', e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-[17px] font-bold text-[#1F4E79]">참석</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="참석"
            className={`${input} mt-1 h-14 text-[24px] tr-num`}
            value={draft.present}
            placeholder="예: 45"
            onChange={(e) => onChange('present', e.target.value)}
          />
        </label>
      </div>
      <p data-testid="division-pass-line" className={`mt-3 text-[22px] font-extrabold tr-num ${ready ? 'text-[#1F4E79]' : 'text-[#B91C1C]'}`}>
        {passLineText(enrolled, present)}
      </p>
    </div>
  );
}

export function UnitCard({
  unit,
  state,
  update,
  ready,
  isOps,
  otherLive,
  canNetwork,
  busy,
  msg,
  responses,
  nowMs,
  onStart,
  onClose,
  onVoid,
  onQr,
}: {
  unit: VoteUnit;
  state: PrepState;
  update: (fn: (s: PrepState) => PrepState) => void;
  ready: boolean;
  isOps: boolean;
  /** 이 단위가 아닌, 열려 있거나 여는 중인 투표. 있으면 [투표 시작]을 막는다(10/14 operator-3). */
  otherLive: BallotRecord | null;
  canNetwork: boolean;
  busy: 'start' | 'close' | 'void' | null;
  msg: { tone: 'ok' | 'error'; text: string } | null;
  responses: number | null;
  nowMs: number;
  onStart: () => void;
  onClose: () => void;
  onVoid: () => void;
  onQr: () => void;
}) {
  const motions = unit.motionIds.map((id) => state.motions.find((m) => m.id === id)).filter((m): m is Motion => !!m);
  const present = useContext(PresentContext);
  if (motions.length === 0) return null;
  const d = state.division;
  const phase = motionPhase(state, motions[0]);
  const ballot = unit.requestId ? state.ballots[unit.requestId] : null;
  const isRevote = phase === 'revote';
  const notStarted = phase === 'ready' || isRevote;
  const blockedByOther = notStarted && otherLive !== null;
  /** 10/14 — 제목이 빈 안(유사 묶음에서 막 만든 안)은 투표를 열지 않는다. 빈 문장이 휴대폰에 나가는 실수. */
  const emptyTitle = notStarted && motions.some((m) => !m.title.trim());
  const startDisabled = !canNetwork || !!busy || (notStarted && !ready) || blockedByOther || emptyTitle;
  const startLabel = busy === 'start' ? '여는 중…' : phase === 'starting' ? '투표 시작 이어서 하기' : isRevote ? '2차 투표 시작' : '투표 시작';
  const roundNo = isRevote ? liveRounds(motions[0].rounds).length + 1 : currentRound(motions[0])?.round ?? 1;
  const label = motions.length > 1 ? `${motions[0].id} 외 ${motions.length - 1}건` : roundLabel(motions[0].id, roundNo);
  // 무장 문구의 제목 — 시작 전에는 지금 칸의 제목(보낼 문구), 시작 뒤에는 그 차수에 보낸 제목.
  const title = notStarted ? motions[0].title : currentRound(motions[0])?.title ?? motions[0].title;
  // 10/14 재검 — 여는 중(시작 중)에는 30초가 지나 멈춘 것으로 보일 때만 무효를 보인다(여는 중에 누르는 실수).
  const voidable =
    !!unit.requestId && canVoidRound(state, motions[0], isOps) && (phase !== 'starting' || (!!ballot && startStuck(ballot, !!busy, nowMs)));

  return (
    <li data-testid="vote-unit" data-unit-key={unit.key} data-phase={phase} className="rounded-2xl border-2 border-[#C4D8E4] bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#DCE7EE] bg-[#F5F8FB] px-4 py-3">
        <span className="text-[18px] font-extrabold text-[#1F4E79]">{motions.length > 1 ? `묶음 투표 · 안 ${motions.length}건` : label}</span>
        <PhaseBadge phase={phase} />
        {ballot ? <span className="text-[16px] text-[#5A6B73]">{ballot.title} · {ballotStatusLabel(ballot.stage === 'creating' ? 'draft' : ballot.stage)}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {motions[0] ? (
            <button
              type="button"
              data-testid="present-focus"
              aria-pressed={present.current === motions[0].id}
              onClick={() => present.focus(motions[0].id)}
              className={present.current === motions[0].id ? `${btn} bg-[#B45309] text-white` : btnGhost}
            >
              {present.current === motions[0].id ? '큰 화면에 나오는 중' : '큰 화면에 띄우기'}
            </button>
          ) : null}
          {notStarted ? (
            <TwoStepButton
              className={`${btnBig} bg-[#135C73] text-white`}
              armedClassName={`${btnBig} bg-[#0B3A4A] text-white ring-4 ring-[#7FC8DE]`}
              testId="vote-start"
              disabled={startDisabled}
              label={startLabel}
              armedLabel={armedText('start', d, label, title)}
              onFire={onStart}
            />
          ) : null}
          {phase === 'starting' ? (
            <button type="button" className={`${btnBig} bg-[#135C73] text-white`} data-testid="vote-start" disabled={!canNetwork || !!busy} onClick={onStart}>
              {startLabel}
            </button>
          ) : null}
          {phase === 'open' ? (
            <>
              <span className="text-[20px] font-extrabold text-[#135C73] tr-num" data-testid="vote-live">
                제출 {responses ?? '…'}명 · {elapsedText(ballot?.openedAt ?? null, nowMs)}
              </span>
              <button type="button" className={btnGhost} onClick={onQr} data-testid="vote-qr">
                QR 다시 띄우기
              </button>
              <TwoStepButton
                className={`${btnBig} bg-[#B45309] text-white`}
                armedClassName={`${btnBig} bg-[#7F1D1D] text-white ring-4 ring-[#FCA5A5]`}
                testId="vote-close"
                disabled={!canNetwork || !!busy}
                label={busy === 'close' ? '마감하는 중…' : '마감하고 결과 보기'}
                armedLabel={armedText('close', d, label, title)}
                onFire={onClose}
              />
            </>
          ) : null}
          {phase === 'counting' ? (
            <button type="button" className={`${btnBig} bg-[#B45309] text-white`} data-testid="vote-close" disabled={!canNetwork || !!busy} onClick={onClose}>
              {busy === 'close' ? '불러오는 중…' : '결과 다시 불러오기'}
            </button>
          ) : null}
          {voidable ? (
            <TwoStepButton
              className={`${btn} border-2 border-[#B91C1C] bg-white text-[#B91C1C]`}
              armedClassName={`${btn} border-2 border-[#7F1D1D] bg-[#B91C1C] text-white ring-4 ring-[#FCA5A5]`}
              testId="vote-void"
              disabled={!canNetwork || !!busy}
              label={busy === 'void' ? '무효 처리 중…' : '잘못 연 투표 무효'}
              armedLabel={armedText('void', d, label, title)}
              onFire={onVoid}
            />
          ) : null}
        </div>
      </div>
      {notStarted && !ready ? (
        <p className="px-4 pt-3 text-[16px] font-bold text-[#B91C1C]">참석 인원을 위에 넣으면 [투표 시작]이 눌립니다.</p>
      ) : null}
      {emptyTitle ? (
        <p data-testid="vote-empty-title" className="px-4 pt-3 text-[17px] font-extrabold text-[#B91C1C]">
          안 제목이 비어 있어 [투표 시작]이 눌리지 않습니다. 「1. 준비판」의 {motions.find((m) => !m.title.trim())?.id} 제목 칸에 합친 문구를 넣으십시오.
        </p>
      ) : null}
      {blockedByOther && otherLive ? (
        <p data-testid="vote-blocked" className="px-4 pt-3 text-[17px] font-extrabold text-[#B45309]">
          {ballotLabel(otherLive)} 투표가 열려 있습니다. 먼저 마감하십시오(화면 위 「지금 투표 중」 띠).
        </p>
      ) : null}
      {phase === 'open' || phase === 'starting' ? (
        <p className="px-4 pt-3 text-[16px] font-bold text-[#5A6B73]">
          엉뚱한 안을 열었으면 마감하지 말고 [잘못 연 투표 무효]를 누릅니다 — 안이 앞 단계로 돌아가고 차수를 쓰지 않습니다.
        </p>
      ) : null}
      {msg ? (
        <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`mx-4 mt-3 rounded-xl px-4 py-3 text-[17px] font-bold ${msg.tone === 'error' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#EAF6EE] text-[#2F6F25]'}`}>
          {msg.text}
        </p>
      ) : null}
      <div className="divide-y divide-[#EEF3F6]">
        {motions.map((m) => (
          <MotionVoteBlock key={m.id} motion={m} state={state} update={update} />
        ))}
      </div>
    </li>
  );
}

export function MotionVoteBlock({ motion, state, update }: { motion: Motion; state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  const phase = motionPhase(state, motion);
  const live = liveRounds(motion.rounds);
  const withTotals = live.filter((r) => roundTotals(r) !== null);
  const last = withTotals[withTotals.length - 1] ?? null;
  const earlier = withTotals.slice(0, -1);
  const voided = motion.rounds.filter((r) => r.voidedAt);
  const rejected = phase === 'failed' || phase === 'revote' || phase === 'minority';
  const cur = currentRound(motion);
  const pending = handPending(cur);
  // 10/14 moderator-1 — 결과 막대가 지금 차수가 아니면(2차 준비·2차 투표 중) 그 막대의 거수 칸은 잠근다.
  const newerRound = !!last && (phase === 'revote' || cur !== last);
  const editable = !!last && canEditRoundCounts(motion, last.round);
  const heading = last ? (last.round > 1 || newerRound ? `${last.round}차 투표 결과` : '투표 결과') : '';
  // 투표 진행 화면의 제목 = 지금 차수에 보낸 문장(10/14 operator-5). 2차 준비 중에만 고치는 칸.
  const shownTitle = cur?.title ?? motion.title;
  // 실명 투표(10/17) — 마감한 차수의 「투표결과 보기」(찬성 | 반대 이름표)와 제출자 대조.
  const namedAccess = useContext(NamedAccessContext);
  const present = useContext(PresentContext);
  const [namesOpen, setNamesOpen] = useState(false);
  const lastBallotId = last ? state.ballots[last.requestId]?.ballotId ?? null : null;
  const namesOnBig = !!lastBallotId && present.names === lastBallotId;

  // 두 번째 누름에서만 부른다(TwoStepButton). 칸이 비어 있으면 무장 문구가 그 사실을 알린다.
  const onMinority = () =>
    update((s) => {
      const id = resolveMotionId(s, motionRef(motion));
      const f = id ? markMinority(s, id, true) : null;
      return f?.ok ? f.state : s;
    });
  const minorityArmed = motion.minorityOpinion.trim()
    ? '정말 기록합니까? (다시 누르면 기록)'
    : '소수 의견 칸이 비었습니다. 그래도 기록하려면 다시 누르십시오';

  return (
    <div data-testid="motion-vote" data-motion-id={motion.id} data-phase={phase} className="space-y-4 p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[18px] font-extrabold text-[#135C73]">{motion.id}</span>
        {phase === 'revote' ? (
          <input
            className={`${input} h-12 flex-1 font-bold`}
            value={motion.title}
            aria-label={`${motion.id} 2차 투표 제목`}
            onChange={(e) => update(onMotion(motionRef(motion), (s, id) => updateMotion(s, id, { title: e.target.value })))}
          />
        ) : (
          <span data-testid="motion-vote-title" className="min-w-0 flex-1 text-[20px] font-extrabold text-[#1F2933]">
            {shownTitle}
          </span>
        )}
        <span className="text-[16px] text-[#5A6B73]">{cardsText(motion)}{motion.group ? ` · ${motion.group.id}` : ''}</span>
      </div>
      {phase === 'revote' ? <TitleRoom id={motion.id} room={motionTitleRoom(motion.id, motion.title)} /> : null}

      {voided.map((r) => (
        <p key={r.requestId} className="rounded-lg bg-[#F4F4F4] px-3 py-2 text-[16px] text-[#4B5563] line-through" data-testid="round-voided">
          {r.round}차 「{titleHead(r.title, 30)}」 · 무효(잘못 열림)
        </p>
      ))}
      {earlier.map((r) => (
        <p key={r.requestId} className="rounded-lg bg-[#F5F8FB] px-3 py-2 text-[16px] text-[#1F2933] tr-num" data-testid="round-history">
          {r.round}차 「{r.title}」 · 찬성 {roundTotals(r)?.yes} · 반대 {roundTotals(r)?.no} · {r.verdict === 'passed' ? '가결' : r.verdict === 'failed' ? '부결' : '판정 불가'}
        </p>
      ))}

      {last ? <ResultBar motion={motion} round={last} state={state} update={update} editable={editable} heading={heading} /> : null}
      {last && lastBallotId && namedAccess ? (
        <div className="flex flex-wrap gap-3">
          <button type="button" className={btnGhost} data-testid="named-board-open" onClick={() => setNamesOpen(true)}>
            투표결과 보기 (조·이름)
          </button>
          {present.showNames ? (
            <button
              type="button"
              className={namesOnBig ? btnPrimary : btnGhost}
              data-testid="named-board-present"
              onClick={() => {
                present.focus(motion.key ?? motion.id);
                present.showNames?.(namesOnBig ? null : lastBallotId);
              }}
            >
              {namesOnBig ? '큰 화면: 결과로 돌아가기' : '큰 화면에 투표결과 보기'}
            </button>
          ) : null}
        </div>
      ) : null}
      {last && lastBallotId && namedAccess ? (
        <VoterReconcileBox access={namedAccess} ballotId={lastBallotId} csvName={`${divisionLabel(state.division)}_${motion.id}_${last.round}차`} />
      ) : null}
      {namesOpen && lastBallotId && last ? (
        <NamedResultBoard
          access={namedAccess}
          ballotId={lastBallotId}
          title={last.title}
          sub={`${divisionLabel(state.division)} · ${motion.id}${last.round > 1 ? ` · ${last.round}차` : ''} · QR 투표 (거수는 따로)`}
          onBack={() => setNamesOpen(false)}
          backLabel="닫기"
          live={false}
        />
      ) : null}
      {last && (phase === 'starting' || phase === 'open' || phase === 'counting') ? (
        <p data-testid="hand-wait" className="rounded-xl border-2 border-dashed border-[#F5A623] bg-[#FFF7E6] px-4 py-3 text-[18px] font-extrabold text-[#8A5A00]">
          {cur?.round ?? last.round + 1}차 투표 중 — 거수는 마감 뒤 새로 나오는 「{cur?.round ?? last.round + 1}차 투표 결과」 아래 칸에 넣습니다. 위 {last.round}차 칸은 고칠 수 없습니다.
        </p>
      ) : null}
      {phase === 'revote' && last ? (
        <p className="text-[16px] font-bold text-[#5A6B73]">{last.round}차 거수를 고쳐야 하면 [2차 투표 그만두기]를 먼저 누릅니다.</p>
      ) : null}

      {phase === 'failed' && pending ? (
        <p data-testid="hand-first" className="text-[17px] font-bold text-[#8A5A00]">
          거수를 넣고 [거수 입력 완료](거수가 없으면 [거수 없음])를 누르면 [문구 고쳐 2차 투표]·[소수 의견으로 기록]이 나옵니다.
        </p>
      ) : null}
      {phase === 'failed' && !pending ? (
        <div className="flex flex-wrap gap-3">
          {canRevote(state, motion) ? (
            <button type="button" className={`${btnBig} border-2 border-[#135C73] bg-white text-[#135C73]`} data-testid="revote" onClick={() => update(onMotion(motionRef(motion), (s, id) => requestRevote(s, id)))}>
              문구 고쳐 2차 투표
            </button>
          ) : null}
          <TwoStepButton
            className={`${btnBig} border-2 border-[#5B21B6] bg-white text-[#5B21B6]`}
            armedClassName={`${btnBig} border-2 border-[#5B21B6] bg-[#5B21B6] text-white`}
            testId="minority"
            label="소수 의견으로 기록"
            armedLabel={minorityArmed}
            onFire={onMinority}
          />
        </div>
      ) : null}
      {phase === 'revote' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[17px] font-bold text-[#8A5A00]">위 칸에서 문구를 고친 뒤 [2차 투표 시작]을 누릅니다. 1차 결과는 그대로 남습니다.</p>
          <button type="button" className={btnGhost} onClick={() => update(onMotion(motionRef(motion), (s, id) => cancelRevote(s, id)))}>
            2차 투표 그만두기
          </button>
          <TwoStepButton
            className={btnGhost}
            armedClassName={`${btn} border-2 border-[#5B21B6] bg-[#5B21B6] text-white`}
            testId="minority"
            label="소수 의견으로 기록"
            armedLabel={minorityArmed}
            onFire={onMinority}
          />
        </div>
      ) : null}
      {phase === 'minority' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[17px] font-extrabold text-[#5B21B6]">소수 의견으로 기록했습니다.</p>
          <button type="button" className={btnGhost} onClick={() => update(onMotion(motionRef(motion), (s, id) => unmarkMinority(s, id)))}>
            기록 취소
          </button>
        </div>
      ) : null}

      <details className="rounded-xl border border-[#DCE7EE]" open={phase === 'passed'}>
        <summary className="min-h-12 cursor-pointer px-4 py-3 text-[17px] font-extrabold text-[#1F4E79]">
          권고 수준 (조별 판정) · 충족 {criteriaCount(motion)}/5
        </summary>
        <div className="px-2 pb-3 sm:px-4">
          <CriteriaGrid motion={motion} update={update} />
        </div>
      </details>

      <label className="block">
        <span className="text-[17px] font-bold text-[#1F4E79]">기타 의견</span>
        <textarea
          className={`${input} mt-1 min-h-20 py-2`}
          value={motion.otherOpinion}
          aria-label={`${motion.id} 기타 의견`}
          onChange={(e) => update(onMotion(motionRef(motion), (s, id) => updateMotion(s, id, { otherOpinion: e.target.value })))}
        />
      </label>
      {rejected ? (
        <label className="block">
          <span className="text-[17px] font-bold text-[#5B21B6]">소수 의견</span>
          <textarea
            className={`${input} mt-1 min-h-20 py-2`}
            value={motion.minorityOpinion}
            aria-label={`${motion.id} 소수 의견`}
            onChange={(e) => update(onMotion(motionRef(motion), (s, id) => updateMotion(s, id, { minorityOpinion: e.target.value })))}
          />
        </label>
      ) : null}
    </div>
  );
}

/**
 * 되돌릴 수 없는 버튼 — 첫 누름은 무장(문구가 바뀜), 5초 안에 다시 눌러야 실행. 5초가 지나면 원래대로.
 * 시간 판단은 two-step.ts(순수, 시험됨).
 */
function TwoStepButton({
  label,
  armedLabel,
  onFire,
  className,
  armedClassName,
  disabled,
  testId,
}: {
  label: string;
  armedLabel: string;
  onFire: () => void;
  className: string;
  armedClassName: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [arm, setArm] = useState<TwoStepArm>(null);
  useEffect(() => {
    if (!arm) return undefined;
    const t = setTimeout(() => setArm(null), TWO_STEP_MS);
    return () => clearTimeout(t);
  }, [arm]);
  const armed = arm !== null;
  return (
    <button
      type="button"
      data-testid={testId}
      data-armed={armed ? 'true' : 'false'}
      aria-live="polite"
      className={armed ? armedClassName : className}
      disabled={disabled}
      onClick={() => {
        const r = twoStepPress(arm, 'b', Date.now());
        setArm(r.next);
        if (r.action === 'fire') onFire();
      }}
    >
      {armed ? armedLabel : label}
    </button>
  );
}

/**
 * 결과 막대 — 프로젝터에 그대로 비친다. 숫자 96px · 이름표 36px · 본문 24px 이상.
 * 10/14: 가결 = 초록(배지·권고 수준 표와 같은 뜻), 부결 = 회색. 빨강은 부결·미충족·경고에만 쓴다(moderator-3).
 * 거수 확인 전에는 판정을 「잠정」으로 흐리게 보인다(moderator-2). editable=false 면 거수 칸을 그리지 않는다(moderator-1).
 */
function ResultBar({
  motion,
  round,
  state,
  update,
  editable,
  heading,
}: {
  motion: Motion;
  round: MotionRound;
  state: PrepState;
  update: (fn: (s: PrepState) => PrepState) => void;
  editable: boolean;
  heading: string;
}) {
  const totals = roundTotals(round);
  const verdict = roundVerdict(round);
  const threshold = roundThreshold(round);
  if (!totals) return null;
  const present = round.present ?? 0;
  const yesRatio = present > 0 ? Math.min(totals.yes / present, 1) : 0;
  const noRatio = present > 0 ? Math.min(totals.no / present, 1 - yesRatio) : 0;
  const lineAt = present > 0 && threshold !== null ? Math.min(threshold / present, 1) : null;
  const passed = verdict?.kind === 'decided' && verdict.passed;
  const decided = verdict?.kind === 'decided';
  const provisional = handPending(round);
  const attendanceChanged = round.enrolled !== state.attendance.enrolled || round.present !== state.attendance.present;
  const word = decided ? (passed ? '가결' : '부결') : '판정 불가';
  const stampTone = !decided
    ? 'border-[#FFB4B4] text-[#FFB4B4]'
    : passed
      ? 'border-[#35C27A] text-[#7FE0A8]'
      : 'border-[#9FB3C2] text-[#C9D8E3]';

  return (
    <div
      data-testid="result-bar"
      data-verdict={round.verdict ?? ''}
      data-provisional={provisional ? 'true' : 'false'}
      data-round={round.round}
      className="rounded-2xl bg-[#0B2233] p-5 text-white sm:p-7"
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span data-testid="result-heading" className="text-[36px] font-black leading-tight">
          {heading}
        </span>
        <span
          data-testid="result-verdict"
          className={`ml-auto rounded-2xl border-[6px] px-6 py-1 text-[64px] font-black leading-tight ${stampTone} ${provisional ? 'border-dashed opacity-60' : ''}`}
        >
          {provisional && decided ? `잠정 ${word}` : word}
        </span>
      </div>
      {provisional ? (
        <p data-testid="result-provisional" className="mt-2 text-[26px] font-extrabold text-[#FFD25A]">
          거수 확인 전 — 거수를 더한 뒤 [거수 입력 완료]를 누르면 판정이 확정됩니다.
        </p>
      ) : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[36px] font-extrabold text-[#C9D8E3]">찬성</p>
          <p data-testid="result-yes" className="text-[96px] font-black leading-none text-[#35C27A] tr-num">{totals.yes}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[36px] font-extrabold text-[#C9D8E3]">반대</p>
          <p data-testid="result-no" className="text-[96px] font-black leading-none text-[#FFFFFF] tr-num">{totals.no}</p>
        </div>
      </div>
      <div className="relative mt-6 h-16 w-full overflow-visible rounded-2xl bg-[#284A63]" aria-hidden="true">
        <div className="absolute inset-y-0 left-0 rounded-l-2xl bg-[#35C27A]" style={{ width: `${yesRatio * 100}%` }} />
        <div className="absolute inset-y-0 bg-[#9FB3C2]" style={{ left: `${yesRatio * 100}%`, width: `${noRatio * 100}%` }} />
        {lineAt !== null ? (
          <div className="absolute -top-3 -bottom-3 w-2 -translate-x-1/2 rounded bg-[#FFD25A]" style={{ left: `${lineAt * 100}%` }} />
        ) : null}
      </div>
      <p data-testid="result-line" className="mt-4 text-[28px] font-extrabold text-[#FFD25A] tr-num">
        {threshold !== null ? `가결선: 찬성 ${threshold}표 이상 (참석 ${present}명의 3분의 2)` : '가결선을 정할 수 없습니다'}
      </p>
      <p className="mt-2 text-[24px] font-bold text-[#C9D8E3] tr-num">
        온라인 찬성 {round.onlineYes} · 반대 {round.onlineNo} / 거수 찬성 {round.handYes} · 반대 {round.handNo} / 재적 {round.enrolled ?? '-'} · 참석 {round.present ?? '-'}
      </p>
      {verdict && verdict.kind === 'invalid' ? <p className="mt-2 text-[24px] font-extrabold text-[#FFB4B4]">{verdict.message}</p> : null}
      {verdict && verdict.kind === 'no-quorum' ? <p className="mt-2 text-[24px] font-extrabold text-[#FFB4B4]">정족수 미달입니다.</p> : null}

      {editable ? (
        <div className="mt-5 flex flex-wrap items-end gap-4 rounded-xl bg-white/10 p-4">
          <HandInput label="거수 찬성" value={round.handYes} onCommit={(v) => update(onMotion(motionRef(motion), (s, id) => setHandCount(s, id, round.round, { handYes: v })))} />
          <HandInput label="거수 반대" value={round.handNo} onCommit={(v) => update(onMotion(motionRef(motion), (s, id) => setHandCount(s, id, round.round, { handNo: v })))} />
          {provisional ? (
            <>
              <button
                type="button"
                data-testid="hand-confirm"
                className="min-h-14 rounded-xl bg-[#FFD25A] px-5 text-[20px] font-extrabold text-[#0B2233]"
                onClick={() => update(onMotion(motionRef(motion), (s, id) => confirmHandCount(s, id, round.round, 'entered')))}
              >
                거수 입력 완료
              </button>
              {round.handYes === 0 && round.handNo === 0 ? (
                <button
                  type="button"
                  data-testid="hand-none"
                  className="min-h-14 rounded-xl border-2 border-[#FFD25A] px-5 text-[20px] font-extrabold text-[#FFD25A]"
                  onClick={() => update(onMotion(motionRef(motion), (s, id) => confirmHandCount(s, id, round.round, 'none')))}
                >
                  거수 없음
                </button>
              ) : null}
            </>
          ) : null}
          {attendanceChanged ? (
            <button
              type="button"
              className="min-h-14 rounded-xl border-2 border-[#FFD25A] px-4 text-[18px] font-bold text-[#FFD25A]"
              onClick={() => update(onMotion(motionRef(motion), (s, id) => reapplyAttendance(s, id, round.round)))}
            >
              지금 참석 인원({state.attendance.present ?? '-'}명)으로 다시 판정
            </button>
          ) : null}
        </div>
      ) : (
        <p data-testid="hand-locked" className="mt-5 rounded-xl bg-white/10 p-4 text-[22px] font-bold text-[#C9D8E3]">
          이 결과의 거수 칸은 잠겨 있습니다. 고쳐야 하면 [2차 투표 그만두기]·[기록 취소]로 먼저 되돌립니다.
        </p>
      )}
    </div>
  );
}

function HandInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText((cur) => (parseHandInput(cur) === value ? cur : String(value))), [value]);
  const bad = parseHandInput(text) === null;
  return (
    <label className="block">
      <span className="block text-[24px] font-bold text-white">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        className={`mt-1 h-14 w-36 rounded-xl border-2 bg-white px-3 text-[28px] font-extrabold text-[#0B2233] tr-num ${bad ? 'border-[#FF5A5A]' : 'border-transparent'}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseHandInput(e.target.value);
          if (v !== null) onCommit(v);
        }}
      />
    </label>
  );
}

const MARK_CYCLE: (Mark | null)[] = [null, 'met', 'unmet'];

function CriteriaGrid({ motion, update }: { motion: Motion; update: (fn: (s: PrepState) => PrepState) => void }) {
  const cell = 'border border-[#DCE7EE] p-1 text-center';
  return (
    <div className="overflow-x-auto">
      <p className="px-1 py-2 text-[16px] text-[#5A6B73]">칸을 누를 때마다 충족 → 미충족 → 빈칸으로 바뀝니다. 「최종 판정」을 고르면 다수결 대신 그 값을 씁니다.</p>
      <table data-testid="criteria-grid" className="w-full min-w-[640px] border-collapse text-[16px]">
        <thead>
          <tr className="bg-[#F5F8FB]">
            <th className={`${cell} w-20 text-[#1F4E79]`}>조</th>
            {CRITERIA.map((c) => (
              <th key={c} className={`${cell} font-extrabold text-[#1F4E79]`}>
                {CRITERION_LABELS[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TEAM_NOS.map((team) => (
            <tr key={team}>
              <th className={`${cell} font-bold text-[#1F2933]`}>조{team}</th>
              {CRITERIA.map((c) => {
                const v = motion.grid[team]?.[c] ?? null;
                const next = MARK_CYCLE[(MARK_CYCLE.indexOf(v) + 1) % MARK_CYCLE.length];
                return (
                  <td key={c} className={cell}>
                    <button
                      type="button"
                      data-grid-cell={`${team}:${c}`}
                      aria-label={`조${team} ${CRITERION_LABELS[c]}: ${v ? MARK_LABELS[v] : '빈칸'}`}
                      className={`min-h-11 w-full rounded-lg text-[16px] font-extrabold ${
                        v === 'met' ? 'bg-[#2F6F25] text-white' : v === 'unmet' ? 'bg-[#B91C1C] text-white' : 'border border-dashed border-[#C4D8E4] bg-white text-[#9AA8B0]'
                      }`}
                      onClick={() => update(onMotion(motionRef(motion), (s, id) => setGridMark(s, id, team as TeamNo, c, next)))}
                    >
                      {v ? MARK_LABELS[v] : '—'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr className="bg-[#F5F8FB]">
            <th className={`${cell} font-extrabold text-[#1F4E79]`}>다수결</th>
            {CRITERIA.map((c) => {
              const r = teamMajority(motion.grid, c);
              return (
                <td
                  key={c}
                  data-majority={c}
                  data-value={r}
                  className={`${cell} font-extrabold ${r === 'tie' ? 'bg-[#FFF1D6] text-[#8A5A00]' : r === 'met' ? 'text-[#2F6F25]' : r === 'unmet' ? 'text-[#B91C1C]' : 'text-[#9AA8B0]'}`}
                >
                  {CRITERION_RESULT_LABELS[r]}
                </td>
              );
            })}
          </tr>
          <tr>
            <th className={`${cell} font-extrabold text-[#1F4E79]`}>최종 판정</th>
            {CRITERIA.map((c) => {
              const f = finalCriterion(motion, c);
              const o = motion.override[c] ?? '';
              return (
                <td key={c} className={cell}>
                  <select
                    aria-label={`${CRITERION_LABELS[c]} 최종 판정`}
                    value={o}
                    className="min-h-11 w-full rounded-lg border border-[#C4D8E4] bg-white px-1 text-[16px] font-bold"
                    onChange={(e) => update(onMotion(motionRef(motion), (s, id) => setCriterionOverride(s, id, c as Criterion, (e.target.value || null) as Mark | null)))}
                  >
                    <option value="">다수결 따름</option>
                    <option value="met">충족</option>
                    <option value="unmet">미충족</option>
                  </select>
                  <span data-final={c} data-direct={f.direct ? 'true' : 'false'} className={`mt-1 block text-[16px] font-extrabold ${f.value === 'tie' ? 'text-[#8A5A00]' : 'text-[#1F2933]'}`}>
                    {CRITERION_RESULT_LABELS[f.value]}
                    {f.direct ? ' · 직접 정함' : ''}
                  </span>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// 세리머니 설정
// ============================================================

type CeremonyMode = 'stored' | 'practice' | 'ballot';

function CeremonySetup({ state, api, isOps, preview }: { state: PrepState; api: DivisionBallotApi | null; isOps: boolean; preview: boolean }) {
  const subgroup = divisionLabel(state.division);
  const enrolled = state.attendance.enrolled ?? Number.NaN;
  const present = state.attendance.present ?? Number.NaN;
  const [mode, setMode] = useState<CeremonyMode>('stored');
  const [yeas, setYeas] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<BallotListRow[] | null>(null);
  const [ballotIds, setBallotIds] = useState<string[]>([]);
  const [ballotItems, setBallotItems] = useState<CeremonyItem[] | null>(null);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const [running, setRunning] = useState<CeremonyItem[] | null>(null);
  const votable = state.motions.filter((m) => !motionExcluded(state, m));
  const stored = useMemo(() => storedCeremonyItems(state), [state]);
  // 10/14 moderator-5 — 세리머니에서 빠지거나 잠정인 안. 투표가 아직 돌면 [세리머니 시작]을 두 번 눌러야 한다.
  const gaps = useMemo(() => ceremonyGaps(state), [state]);
  const blocking = gaps.some((g) => g.blocking);
  // 10/14 moderator-4 — 「투표 목록에서 불러오기」는 거수 표가 빠지고 1·2차가 따로 나와 공표용이 아니다. 운영팀·미리보기에만.
  const ballotModeAllowed = isOps || preview;

  useEffect(() => {
    if (mode !== 'ballot' || !api) return;
    let alive = true;
    api
      .list()
      .then((all) => alive && setRows(all.filter((b) => (b.subgroup ?? '').trim() === subgroup)))
      .catch((error) => {
        console.error('[division vote] ballot list failed', error);
        if (alive) setLoadMsg('투표 목록을 읽지 못했습니다.');
      });
    return () => {
      alive = false;
    };
  }, [mode, api, subgroup]);

  const randomize = () => {
    const next: Record<string, number> = {};
    for (const m of votable) next[m.id] = fakeYeas(Number.isNaN(present) ? 0 : present, Math.random);
    setYeas(next);
  };

  const loadResults = async () => {
    const chosen = ballotIds.map((id) => (rows ?? []).find((r) => r.id === id)).filter((r): r is BallotListRow => !!r);
    if (!api || chosen.length === 0) return;
    setLoadMsg('불러오는 중…');
    try {
      const all: CeremonyItem[] = [];
      const counts: number[] = [];
      for (const b of chosen) {
        const res = await api.results(b.token);
        if (!res) {
          setLoadMsg(`「${b.title}」 결과를 읽을 수 없습니다.`);
          return;
        }
        all.push(...ballotCeremonyItems(res));
        counts.push(res.responses);
      }
      setBallotItems(all);
      setLoadMsg(`투표 ${chosen.length}개 · 안 ${all.length}건 · 제출 ${counts.join('·')}명을 불러왔습니다.`);
    } catch (error) {
      console.error('[division vote] results failed', error);
      setLoadMsg('결과를 읽지 못했습니다.');
    }
  };

  const items = mode === 'stored' ? stored : mode === 'practice' ? practiceItems(votable, yeas) : ballotItems ?? [];
  const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

  return (
    <div className="space-y-5">
      <p data-testid="division-attendance" className="rounded-xl bg-[#F5F8FB] px-4 py-3 text-[18px] font-bold text-[#1F2933]">
        {state.attendance.enrolled === null || state.attendance.present === null
          ? '참석 인원이 비어 있습니다. 「2. 투표 진행」 맨 위에 넣으십시오.'
          : attendanceText(enrolled, present)}
      </p>

      <div role="radiogroup" aria-label="결과 원천" className="flex flex-wrap gap-2">
        <button type="button" role="radio" aria-checked={mode === 'stored'} className={mode === 'stored' ? btnPrimary : btnGhost} onClick={() => setMode('stored')}>
          마감한 결과({stored.length}건)
        </button>
        <button type="button" role="radio" aria-checked={mode === 'practice'} className={mode === 'practice' ? btnPrimary : btnGhost} onClick={() => setMode('practice')}>
          연습 모드(수기·무작위)
        </button>
        {ballotModeAllowed ? (
          <button type="button" role="radio" aria-checked={mode === 'ballot'} className={mode === 'ballot' ? btnPrimary : btnGhost} onClick={() => setMode('ballot')}>
            투표 목록에서 불러오기(확인용)
          </button>
        ) : null}
      </div>

      {gaps.length > 0 ? (
        <div data-testid="ceremony-gaps" data-blocking={blocking ? 'true' : 'false'} className="rounded-2xl border-2 border-[#B91C1C] bg-[#FEF2F2] p-4">
          <p className="text-[18px] font-extrabold text-[#B91C1C]">
            세리머니에서 빠지거나 잠정인 안 {gaps.length}건 — 「상정 {stored.length}건(분과 안 {votable.length}건 중)」으로 나옵니다
          </p>
          <ul className="mt-2 space-y-1 text-[17px] font-bold text-[#7F1D1D]">
            {gaps.map((g) => (
              <li key={g.id} data-gap={g.id} data-blocking={g.blocking ? 'true' : 'false'}>
                {g.id} · {g.status}
                {g.blocking ? ' — 투표가 아직 끝나지 않았습니다' : ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[16px] font-bold text-[#7F1D1D]">「2. 투표 진행」에서 마감·거수 확인을 마친 뒤 시작하십시오.</p>
        </div>
      ) : null}

      {mode === 'stored' ? (
        stored.length === 0 ? (
          <p className="text-[17px] text-[#5A6B73]">마감한 투표가 아직 없습니다. 「2. 투표 진행」에서 [마감하고 결과 보기]를 누르면 여기에 쌓입니다.</p>
        ) : (
          <ul className="space-y-1 rounded-2xl border border-[#DCE7EE] p-4 text-[17px]" data-testid="ceremony-stored">
            {stored.map((it) => (
              <li key={it.key} className="flex flex-wrap gap-3 tr-num">
                <span className="font-bold text-[#135C73]">{it.label}</span>
                <span className="min-w-0 flex-1 truncate">{it.title}</span>
                <span className="text-[#5A6B73]">
                  찬성 {it.yeas} · 반대 {it.nays}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : mode === 'practice' ? (
        votable.length === 0 ? (
          <p className="text-[17px] text-[#5A6B73]">준비판에서 의결안을 먼저 만드십시오.</p>
        ) : (
          <div className="rounded-2xl border border-[#DCE7EE] p-4">
            <div className="mb-3 flex items-center gap-3">
              <h4 className="flex-1 text-[18px] font-extrabold text-[#1F4E79]">안별 찬성 수</h4>
              <button type="button" className={btnGhost} onClick={randomize} data-testid="division-randomize">
                무작위 채우기
              </button>
            </div>
            <ul className="space-y-2">
              {votable.map((m) => (
                <li key={m.id} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-[16px] font-bold text-[#135C73]">{m.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[16px]">{m.title}</span>
                  <input
                    type="number"
                    min={0}
                    aria-label={`${m.id} 찬성 수`}
                    className={`${input} h-12 w-28 shrink-0 text-right tr-num`}
                    value={yeas[m.id] ?? ''}
                    onChange={(e) => setYeas((prev) => ({ ...prev, [m.id]: num(e.target.value) }))}
                  />
                </li>
              ))}
            </ul>
          </div>
        )
      ) : !api ? (
        <p className="text-[17px] text-[#5A6B73]">투표 목록은 조 코드로 들어온 콘솔에서 불러옵니다.</p>
      ) : (
        <fieldset className="rounded-2xl border border-[#DCE7EE] p-4">
          <p data-testid="ceremony-ballot-warning" className="mb-3 rounded-xl border-2 border-[#B91C1C] bg-[#FEF2F2] px-3 py-2 text-[17px] font-extrabold text-[#B91C1C]">
            공표용 아님 — 거수 표가 빠지고 1·2차가 따로 나옵니다. 발표는 「마감한 결과」로 합니다.
          </p>
          <legend className="px-1 text-[16px] font-bold text-[#1F4E79]">{subgroup} 투표 고르기 (체크한 순서대로 이어 공개)</legend>
          <ul className="space-y-1">
            {(rows ?? []).map((b) => (
              <li key={b.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[17px]">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    data-ballot-pick={b.id}
                    checked={ballotIds.includes(b.id)}
                    onChange={() => setBallotIds((prev) => (prev.includes(b.id) ? prev.filter((x) => x !== b.id) : [...prev, b.id]))}
                  />
                  <span className="w-8 shrink-0 text-center text-[17px] font-extrabold text-[#135C73]" data-ballot-order={b.id}>
                    {ballotIds.includes(b.id) ? ballotIds.indexOf(b.id) + 1 : ''}
                  </span>
                  <span className="font-bold">{b.title}</span>
                  <span className="text-[#5A6B73]">
                    {ballotStatusLabel(b.status)} · 제출 {b.response_count}명
                  </span>
                </label>
              </li>
            ))}
            {rows && rows.length === 0 ? <li className="text-[16px] text-[#5A6B73]">아직 없습니다.</li> : null}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={btnGhost} disabled={ballotIds.length === 0} onClick={() => void loadResults()}>
              결과 불러오기
            </button>
            {loadMsg ? <span className="text-[16px] font-bold text-[#1F4E79]">{loadMsg}</span> : null}
          </div>
        </fieldset>
      )}

      {mode === 'stored' && blocking ? (
        <TwoStepButton
          testId="division-ceremony-start"
          className={`${btnPrimary} min-h-14 px-6 text-[20px]`}
          armedClassName={`${btn} min-h-14 bg-[#B91C1C] px-6 text-[20px] text-white ring-4 ring-[#FCA5A5]`}
          disabled={items.length === 0}
          label="세리머니 시작 (전체 화면)"
          armedLabel="투표 중인 안이 있습니다. 그래도 시작하려면 다시 누르십시오"
          onFire={() => setRunning(items)}
        />
      ) : (
        <button
          type="button"
          data-testid="division-ceremony-start"
          className={`${btnPrimary} min-h-14 px-6 text-[20px]`}
          disabled={items.length === 0}
          onClick={() => setRunning(items)}
        >
          세리머니 시작 (전체 화면)
        </button>
      )}

      {running ? (
        <DivisionCeremony
          division={state.division}
          enrolled={enrolled}
          present={present}
          items={running}
          motionCount={mode === 'practice' ? undefined : votable.length}
          sourceLabel={mode === 'stored' ? '투표 결과' : mode === 'practice' ? '연습' : '투표 목록'}
          onExit={() => setRunning(null)}
        />
      ) : null}
    </div>
  );
}
