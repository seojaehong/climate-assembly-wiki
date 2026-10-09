import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ballotStatusLabel } from './ballot-panel-logic';
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
  attendanceText,
  ballotCeremonyItems,
  canCombine,
  canDeleteMotion,
  combineFailureText,
  createMotion,
  criteriaCount,
  deleteMotion,
  divisionLabel,
  excludedCardNos,
  exportFileName,
  fakeYeas,
  finalCriterion,
  initPrepState,
  isUntitled,
  lockedDivisionOf,
  motionExcluded,
  parseImport,
  passLineText,
  practiceItems,
  prepStorageKey,
  readStoredPrep,
  serializePrep,
  setCardStatus,
  setCriterionOverride,
  setGridMark,
  statusTally,
  teamMajority,
  updateMotion,
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
  PHASE_LABELS,
  beginVote,
  boardSummary,
  canRevote,
  cancelRevote,
  currentRound,
  elapsedText,
  markMinority,
  motionPhase,
  parseHandInput,
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
const btnBig = 'min-h-16 rounded-2xl px-7 text-[22px] font-extrabold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] disabled:cursor-not-allowed disabled:opacity-40';
const input =
  'w-full min-w-0 rounded-xl border border-[#C4D8E4] px-3 text-[17px] text-[#1F2933] outline-none focus:border-[#23B2C3] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]';

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
}) {
  const preview = !!fixtureSource;
  const lockedDivision = lockedDivisionOf(subgroup);
  const isOps = preview ? !!opsPreview : lockedDivision === null;
  const ns = preview ? (isOps ? 'lab-ops:' : 'lab:') : '';
  const token = access?.accessToken ?? null;

  const prepApi = useMemo<PrepApi | null>(
    () =>
      token && !preview
        ? {
            get: () => divisionPrepGet(token),
            save: (sg, version, state, label) => divisionPrepSave(token, sg, version, state, label),
          }
        : null,
    [token, preview],
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
    const saved = Number(storage.getItem(`${ns}${PREP_DIVISION_KEY}`));
    if (Number.isInteger(saved) && saved > 0) return saved;
    return fixtureSource?.[0]?.division ?? null;
  });
  const [view, setView] = useState<View>('prep');
  const fileRef = useRef<HTMLInputElement>(null);
  const { notice, setNotice } = prep;

  const divisions = Object.entries(prep.slots)
    .filter(([, slot]) => !!slot.state)
    .map(([d]) => Number(d))
    .filter((d) => lockedDivision === null || d === lockedDivision)
    .sort((a, b) => a - b);
  // 고른 분과가 잠금 밖이면(가져오기 직후·저장된 옛 선택) 잠긴 분과로 돌아간다.
  const activeDivision = division !== null && divisions.includes(division) ? division : divisions[0] ?? null;
  const state = activeDivision !== null ? prep.slots[activeDivision]?.state ?? null : null;

  useEffect(() => {
    if (activeDivision !== null) storage.setItem(`${ns}${PREP_DIVISION_KEY}`, String(activeDivision));
  }, [activeDivision, ns]);

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
      if (prep.slots[s.division]?.state && !window.confirm(`${divisionLabel(s.division)} 준비 내용을 가져온 파일로 바꿉니다.`)) return;
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
        <button type="button" className={btnGhost} onClick={() => fileRef.current?.click()}>
          JSON 가져오기
        </button>
        <button type="button" className={btnGhost} onClick={onExport} disabled={!state}>
          JSON 내보내기
        </button>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {notice ? (
          <p
            role={notice.tone === 'ok' ? 'status' : 'alert'}
            data-testid="division-notice"
            className={`flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-[17px] font-bold ${
              notice.tone === 'error'
                ? 'border border-[#DC2626]/30 bg-[#FEF2F2] text-[#B91C1C]'
                : notice.tone === 'warn'
                  ? 'border border-[#F5A623]/50 bg-[#FFF7E6] text-[#8A5A00]'
                  : 'bg-[#EAF6EE] text-[#2F6F25]'
            }`}
          >
            <span className="min-w-0 flex-1">{notice.text}</span>
            <button type="button" className="min-h-11 rounded-lg px-3 text-[16px] underline" onClick={() => setNotice(null)}>
              닫기
            </button>
          </p>
        ) : null}
        {prep.mode === 'local' && !preview ? (
          <p role="alert" data-testid="division-local-banner" className="rounded-xl border-2 border-[#F5A623] bg-[#FFF3C4] px-4 py-3 text-[18px] font-extrabold text-[#7A4B00]">
            서버 저장 안 됨 — 이 기기에만 저장 중
            {prep.localReason ? <span className="ml-2 text-[16px] font-bold">({prep.localReason} 30초마다 다시 연결합니다.)</span> : null}
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
          />
        ) : null}

        {!state ? (
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

            {view === 'prep' ? <PrepBoard state={state} update={update} /> : null}
            {view === 'vote' ? (
              <VoteBoard
                key={state.division}
                state={state}
                update={update}
                prep={prep}
                api={vApi}
                preview={preview}
                onCsv={() => downloadCsv(state.division)}
              />
            ) : null}
            {view === 'ceremony' ? <CeremonySetup state={state} api={vApi} /> : null}
          </>
        )}
      </div>
    </section>
  );
}

// ============================================================
// 사용법
// ============================================================

const OPERATOR_STEPS = [
  '화면 위 분과 이름이 우리 분과인지 확인합니다. 오른쪽 위 칩이 「저장됨」이면 서버에 저장되고 있습니다.',
  '「1. 준비판」에서 카드마다 처리 상태를 고르고, 카드를 골라 안 제목을 넣은 뒤 [의결안 만들기]를 누릅니다. 시행중-제외 카드는 안에 넣을 수 없습니다.',
  '「2. 투표 진행」 맨 위에 재적과 참석 인원을 넣습니다. 재적 과반수가 참석해야 [투표 시작]이 눌립니다. 가결선이 바로 아래에 나옵니다.',
  '안마다 [투표 시작]을 누르면 투표가 열리고 QR 화면이 바로 뜹니다. [나가기] 또는 ESC로 돌아오고, [QR 다시 띄우기]로 다시 엽니다.',
  '투표를 끝낼 때 [마감하고 결과 보기]를 누르고, 버튼이 「정말 마감합니까?」로 바뀌면 5초 안에 한 번 더 누릅니다. 찬성·반대 표, 가결선, 가결·부결이 크게 나옵니다.',
  '손을 든 표가 있으면 거수 찬성·반대 칸에 넣습니다. 온라인 표에 더해 다시 판정합니다. 조별 권고 수준 표와 기타 의견도 그 안 아래에 적습니다.',
  '부결된 안은 [문구 고쳐 2차 투표] 또는 [소수 의견으로 기록]을 고릅니다. 다 끝나면 「3. 세리머니」로 발표하고 [이 분과 결과 CSV]를 내려받습니다.',
];

const OPS_STEPS = [
  '맨 위 현황판이 세 분과의 후보안·진행 중 투표·가결·부결·소수 의견을 5초마다 새로 보여 줍니다. 빨간 글씨는 참석 인원이 비어 있다는 뜻입니다.',
  '[N분과 화면 열기]를 누르면 그 분과 오퍼레이터와 같은 화면이 아래에 열립니다. 여기서 고친 내용은 그 분과에 「운영팀」 이름으로 저장됩니다.',
  '어느 분과 투표든 그 화면에서 시작하고 마감할 수 있습니다. 순서는 분과 오퍼레이터 사용법과 같습니다.',
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
}: {
  prep: DivisionPrep;
  preview: boolean;
  active: number | null;
  onOpen: (division: number) => void;
  onCsvAll: () => void;
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
                    {sum.open.length === 0 ? (
                      <p className="text-[16px] text-[#5A6B73]">진행 중 투표 없음</p>
                    ) : (
                      <ul className="space-y-1">
                        {sum.open.map((o) => (
                          <li key={o.label} className="rounded-lg bg-[#135C73] px-3 py-1 text-[17px] font-extrabold text-white tr-num">
                            투표 중 {o.label} · {elapsedText(o.openedAt, now)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-[16px] text-[#5A6B73] tr-num">
                    마지막 저장 {slot?.updatedAt ? hhmmss(slot.updatedAt) : '-'}
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

function PrepBoard({ state, update }: { state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected([]);
    setError(null);
  }, [state.division]);

  const check = canCombine(state.source, selected);
  const tally = statusTally(state);
  const motionsByTopic = useMemo(() => {
    const map = new Map<string, Motion[]>();
    for (const m of state.motions) map.set(m.topicNo, [...(map.get(m.topicNo) ?? []), m]);
    return map;
  }, [state.motions]);
  const excluded = excludedCardNos(state);
  const selectedExcluded = selected.filter((no) => state.cards[no]?.status === 'excluded');

  const toggle = (no: string) => setSelected((prev) => (prev.includes(no) ? prev.filter((x) => x !== no) : [...prev, no]));

  const make = () => {
    const r = createMotion(state, { cardNos: selected, title, text });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    update(() => r.state);
    setSelected([]);
    setTitle('');
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
              return (
                <li key={card.no} data-card-no={card.no} data-excluded={isExcluded ? 'true' : undefined} className={`px-4 py-3 ${isSel ? 'bg-[#E6F5F7]' : isExcluded ? 'bg-[#F4F4F4]' : ''}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className={`flex min-h-11 items-center gap-2 ${isExcluded ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        className="h-6 w-6"
                        checked={isSel}
                        disabled={isExcluded && !isSel}
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
                    {st.status === 'merged' ? (
                      <span className="text-[16px] font-bold text-[#5A6B73]">→ {st.target ?? '안 번호 없음'}</span>
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

      <div data-testid="excluded-list" className="rounded-2xl border border-[#DCE7EE] bg-[#F7F7F7] p-4">
        <p className="text-[17px] font-extrabold text-[#5A6B73]">시행중-제외 카드 {excluded.length}장</p>
        <p className="mt-1 text-[16px] text-[#5A6B73]">{excluded.length ? excluded.join(', ') : '없습니다.'}</p>
      </div>

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
          {selectedExcluded.length > 0 ? (
            <p role="alert" className="text-[16px] font-bold text-[#B91C1C]">
              시행중-제외 카드({selectedExcluded.join(', ')})는 의결안에 넣을 수 없습니다. 선택을 풀어 주십시오.
            </p>
          ) : null}
          <input
            className={`${input} h-12`}
            placeholder="안 제목"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="안 제목"
          />
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
            <button type="button" className={btnPrimary} disabled={!check.ok || !title.trim() || selectedExcluded.length > 0} onClick={make}>
              의결안 만들기
            </button>
            <button type="button" className={btnGhost} onClick={() => setSelected([])}>
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

function MotionEditor({ motion, state, update }: { motion: Motion; state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  const phase = motionPhase(state, motion);
  return (
    <div data-testid="motion-card" data-motion-id={motion.id} className="rounded-xl border border-[#C4D8E4] bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg bg-[#1F4E79] px-3 py-1 text-[16px] font-extrabold text-white">{motion.id}</span>
        <PhaseBadge phase={phase} />
        <span className="text-[16px] text-[#5A6B73]">원 카드 {motion.cardNos.join(', ')}</span>
        <span className="text-[16px] font-bold text-[#135C73]">권고 수준 충족 {criteriaCount(motion)}/5</span>
        {canDeleteMotion(motion) ? (
          <button
            type="button"
            className={`${btnGhost} ml-auto`}
            onClick={() => {
              if (window.confirm(`${motion.id}을 지웁니다. 통합으로 묶인 카드는 유지로 돌아갑니다.`)) update((s) => deleteMotion(s, motion.id));
            }}
          >
            안 지우기
          </button>
        ) : (
          <span className="ml-auto text-[16px] text-[#5A6B73]">투표를 시작한 안은 지울 수 없습니다.</span>
        )}
      </div>
      <input
        className={`${input} mt-3 h-12 font-bold`}
        value={motion.title}
        aria-label={`${motion.id} 제목`}
        onChange={(e) => update((s) => updateMotion(s, motion.id, { title: e.target.value }))}
      />
      <textarea
        className={`${input} mt-2 min-h-20 py-2`}
        value={motion.text}
        aria-label={`${motion.id} 문안`}
        placeholder="안 문안"
        onChange={(e) => update((s) => updateMotion(s, motion.id, { text: e.target.value }))}
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

/** [묶음 크기, 버튼 이름]. 1 = 안 하나씩(기본), Infinity = 분과 전체 한 번. */
const BATCH_SIZES: ReadonlyArray<readonly [number, string]> = [
  [1, '하나씩'],
  [5, '5개 안팎'],
  [10, '10개 안팎'],
  [Number.POSITIVE_INFINITY, '전체 한 번'],
];

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
  onCsv,
}: {
  state: PrepState;
  update: (fn: (s: PrepState) => PrepState) => void;
  prep: DivisionPrep;
  api: DivisionBallotApi | null;
  preview: boolean;
  onCsv: () => void;
}) {
  const d = state.division;
  const [batchSize, setBatchSize] = useState<number>(1);
  const [busy, setBusy] = useState<Record<string, 'start' | 'close'>>({});
  const inflight = useRef<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ key: string; tone: 'ok' | 'error'; text: string } | null>(null);
  const [qrKey, setQrKey] = useState<string | null>(null);

  const units = voteUnits(state, batchSize);
  const anyOpen = Object.values(state.ballots).some((b) => b.stage === 'open');
  const counts = useBallotCounts(api, anyOpen || qrKey !== null);
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

  const lock = (key: string, kind: 'start' | 'close') => {
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
    try {
      let requestId: string | null = null;
      let error: string | null = null;
      const fresh = newRequestId();
      await commit((s) => {
        const r = beginVote(s, unit.motionIds, fresh);
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
      await runVoteStart(api, commit, getState, id, nowIso);
      setMsg(null);
      setQrKey(id);
    } catch (e) {
      console.error('[division vote] start failed', e);
      setMsg({ key: unit.key, tone: 'error', text: '투표를 여는 중에 끊겼습니다. [투표 시작]을 다시 누르면 같은 투표를 이어서 엽니다.' });
    } finally {
      unlock(unit.key);
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

  const qrRecord = qrKey ? state.ballots[qrKey] : null;
  const qrRow = qrRecord ? qrRowOf(qrRecord, qrRecord.ballotId ? counts[qrRecord.ballotId] ?? 0 : 0) : null;

  return (
    <div className="space-y-5">
      <AttendanceBox state={state} update={update} />

      {state.motions.length === 0 ? (
        <p className="text-[18px] text-[#5A6B73]">「1. 준비판」에서 의결안을 먼저 만드십시오.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#DCE7EE] p-3" data-testid="division-batches">
            <span className="text-[16px] font-bold text-[#1F4E79]">한 번에 투표할 안</span>
            {BATCH_SIZES.map(([size, lbl]) => (
              <button
                key={lbl}
                type="button"
                aria-pressed={batchSize === size}
                className={batchSize === size ? btnPrimary : btnGhost}
                onClick={() => setBatchSize(size)}
              >
                {lbl}
              </button>
            ))}
          </div>
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
                onQr={() => unit.requestId && setQrKey(unit.requestId)}
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
                <span className="font-bold">{m.id}</span> {m.title} <span className="text-[#7A8790]">(원 카드 {m.cardNos.join(', ')})</span>
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

      {qrRow ? <BallotQrFullscreen ballot={qrRow} onExit={() => setQrKey(null)} /> : null}
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

function UnitCard({
  unit,
  state,
  update,
  ready,
  canNetwork,
  busy,
  msg,
  responses,
  nowMs,
  onStart,
  onClose,
  onQr,
}: {
  unit: VoteUnit;
  state: PrepState;
  update: (fn: (s: PrepState) => PrepState) => void;
  ready: boolean;
  canNetwork: boolean;
  busy: 'start' | 'close' | null;
  msg: { tone: 'ok' | 'error'; text: string } | null;
  responses: number | null;
  nowMs: number;
  onStart: () => void;
  onClose: () => void;
  onQr: () => void;
}) {
  const motions = unit.motionIds.map((id) => state.motions.find((m) => m.id === id)).filter((m): m is Motion => !!m);
  if (motions.length === 0) return null;
  const phase = motionPhase(state, motions[0]);
  const ballot = unit.requestId ? state.ballots[unit.requestId] : null;
  const isRevote = phase === 'revote';
  const notStarted = phase === 'ready' || isRevote;
  const startDisabled = !canNetwork || !!busy || (notStarted && !ready);
  const startLabel = busy === 'start' ? '여는 중…' : phase === 'starting' ? '투표 시작 이어서 하기' : isRevote ? '2차 투표 시작' : '투표 시작';

  return (
    <li data-testid="vote-unit" data-unit-key={unit.key} data-phase={phase} className="rounded-2xl border-2 border-[#C4D8E4] bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#DCE7EE] bg-[#F5F8FB] px-4 py-3">
        <span className="text-[18px] font-extrabold text-[#1F4E79]">
          {motions.length > 1 ? `묶음 투표 · 안 ${motions.length}건` : roundLabel(motions[0].id, isRevote ? motions[0].rounds.length + 1 : currentRound(motions[0])?.round ?? 1)}
        </span>
        <PhaseBadge phase={phase} />
        {ballot ? <span className="text-[16px] text-[#5A6B73]">{ballot.title} · {ballotStatusLabel(ballot.stage === 'creating' ? 'draft' : ballot.stage)}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {notStarted || phase === 'starting' ? (
            <button type="button" className={`${btnBig} bg-[#135C73] text-white`} data-testid="vote-start" disabled={startDisabled} onClick={onStart}>
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
                armedLabel="정말 마감합니까? (다시 누르면 마감)"
                onFire={onClose}
              />
            </>
          ) : null}
          {phase === 'counting' ? (
            <button type="button" className={`${btnBig} bg-[#B45309] text-white`} data-testid="vote-close" disabled={!canNetwork || !!busy} onClick={onClose}>
              {busy === 'close' ? '불러오는 중…' : '결과 다시 불러오기'}
            </button>
          ) : null}
        </div>
      </div>
      {notStarted && !ready ? (
        <p className="px-4 pt-3 text-[16px] font-bold text-[#B91C1C]">참석 인원을 위에 넣으면 [투표 시작]이 눌립니다.</p>
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

function MotionVoteBlock({ motion, state, update }: { motion: Motion; state: PrepState; update: (fn: (s: PrepState) => PrepState) => void }) {
  const phase = motionPhase(state, motion);
  const withTotals = motion.rounds.filter((r) => roundTotals(r) !== null);
  const last = withTotals[withTotals.length - 1] ?? null;
  const earlier = withTotals.slice(0, -1);
  const rejected = phase === 'failed' || phase === 'revote' || phase === 'minority';

  // 두 번째 누름에서만 부른다(TwoStepButton). 칸이 비어 있으면 무장 문구가 그 사실을 알린다.
  const onMinority = () =>
    update((s) => {
      const f = markMinority(s, motion.id, true);
      return f.ok ? f.state : s;
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
            onChange={(e) => update((s) => updateMotion(s, motion.id, { title: e.target.value }))}
          />
        ) : (
          <span className="min-w-0 flex-1 text-[20px] font-extrabold text-[#1F2933]">{motion.title}</span>
        )}
        <span className="text-[16px] text-[#5A6B73]">원 카드 {motion.cardNos.join(', ')}</span>
      </div>

      {earlier.map((r) => (
        <p key={r.round} className="rounded-lg bg-[#F5F8FB] px-3 py-2 text-[16px] text-[#1F2933] tr-num" data-testid="round-history">
          {r.round}차 「{r.title}」 · 찬성 {roundTotals(r)?.yes} · 반대 {roundTotals(r)?.no} · {r.verdict === 'passed' ? '가결' : r.verdict === 'failed' ? '부결' : '판정 불가'}
        </p>
      ))}

      {last ? <ResultBar motion={motion} round={last} state={state} update={update} /> : null}

      {phase === 'failed' ? (
        <div className="flex flex-wrap gap-3">
          {canRevote(state, motion) ? (
            <button type="button" className={`${btnBig} border-2 border-[#135C73] bg-white text-[#135C73]`} data-testid="revote" onClick={() => update((s) => requestRevote(s, motion.id))}>
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
          <button type="button" className={btnGhost} onClick={() => update((s) => cancelRevote(s, motion.id))}>
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
          <button type="button" className={btnGhost} onClick={() => update((s) => unmarkMinority(s, motion.id))}>
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
          onChange={(e) => update((s) => updateMotion(s, motion.id, { otherOpinion: e.target.value }))}
        />
      </label>
      {rejected ? (
        <label className="block">
          <span className="text-[17px] font-bold text-[#5B21B6]">소수 의견</span>
          <textarea
            className={`${input} mt-1 min-h-20 py-2`}
            value={motion.minorityOpinion}
            aria-label={`${motion.id} 소수 의견`}
            onChange={(e) => update((s) => updateMotion(s, motion.id, { minorityOpinion: e.target.value }))}
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

/** 결과 막대 — 프로젝터에 그대로 비친다. 숫자 96px · 이름표 36px · 본문 24px 이상. */
function ResultBar({
  motion,
  round,
  state,
  update,
}: {
  motion: Motion;
  round: MotionRound;
  state: PrepState;
  update: (fn: (s: PrepState) => PrepState) => void;
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
  const attendanceChanged = round.enrolled !== state.attendance.enrolled || round.present !== state.attendance.present;

  return (
    <div data-testid="result-bar" data-verdict={round.verdict ?? ''} className="rounded-2xl bg-[#0B2233] p-5 text-white sm:p-7">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="text-[36px] font-black leading-tight">{round.round > 1 ? `${round.round}차 투표 결과` : '투표 결과'}</span>
        <span
          data-testid="result-verdict"
          className={`ml-auto rounded-2xl border-[6px] px-6 py-1 text-[64px] font-black leading-tight ${
            decided ? (passed ? 'border-[#FF5A5A] text-[#FF8A8A]' : 'border-[#9FB3C2] text-[#C9D8E3]') : 'border-[#FFB4B4] text-[#FFB4B4]'
          }`}
        >
          {decided ? (passed ? '가결' : '부결') : '판정 불가'}
        </span>
      </div>
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

      <div className="mt-5 flex flex-wrap items-end gap-4 rounded-xl bg-white/10 p-4">
        <HandInput label="거수 찬성" value={round.handYes} onCommit={(v) => update((s) => setHandCount(s, motion.id, round.round, { handYes: v }))} />
        <HandInput label="거수 반대" value={round.handNo} onCommit={(v) => update((s) => setHandCount(s, motion.id, round.round, { handNo: v }))} />
        {attendanceChanged ? (
          <button
            type="button"
            className="min-h-14 rounded-xl border-2 border-[#FFD25A] px-4 text-[18px] font-bold text-[#FFD25A]"
            onClick={() => update((s) => reapplyAttendance(s, motion.id, round.round))}
          >
            지금 참석 인원({state.attendance.present ?? '-'}명)으로 다시 판정
          </button>
        ) : null}
      </div>
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
                      onClick={() => update((s) => setGridMark(s, motion.id, team as TeamNo, c, next))}
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
                    onChange={(e) => update((s) => setCriterionOverride(s, motion.id, c as Criterion, (e.target.value || null) as Mark | null))}
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

function CeremonySetup({ state, api }: { state: PrepState; api: DivisionBallotApi | null }) {
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
        <button type="button" role="radio" aria-checked={mode === 'ballot'} className={mode === 'ballot' ? btnPrimary : btnGhost} onClick={() => setMode('ballot')}>
          투표 목록에서 불러오기
        </button>
      </div>

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

      <button
        type="button"
        data-testid="division-ceremony-start"
        className={`${btnPrimary} min-h-14 px-6 text-[20px]`}
        disabled={items.length === 0}
        onClick={() => setRunning(items)}
      >
        세리머니 시작 (전체 화면)
      </button>

      {running ? (
        <DivisionCeremony
          division={state.division}
          enrolled={enrolled}
          present={present}
          items={running}
          sourceLabel={mode === 'stored' ? '투표 결과' : mode === 'practice' ? '연습' : '투표 목록'}
          onExit={() => setRunning(null)}
        />
      ) : null}
    </div>
  );
}
