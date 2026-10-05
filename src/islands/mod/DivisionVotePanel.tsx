import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ballotCreate,
  ballotList,
  ballotResults,
  type BallotListRow,
  type WorkshopAuthorization,
} from '../../lib/deliberation';
import { createSafeBrowserStorage } from '../../lib/safe-browser-storage';
import { BallotQrFullscreen } from './BallotPanel';
import { ballotCreateIntent, ballotStatusLabel, type BallotCreateIntent } from './ballot-panel-logic';
import DivisionCeremony from './DivisionCeremony';
import { downloadBlob } from './svg-to-png';
import { useModalDialog } from './use-modal-dialog';
import {
  CARD_STATUSES,
  CARD_STATUS_LABELS,
  CRITERIA,
  CRITERION_LABELS,
  PREP_DIVISION_KEY,
  attendanceText,
  ballotCeremonyItems,
  lockedDivisionOf,
  batchLabel,
  batchMotions,
  buildDivisionBallot,
  canCombine,
  combineFailureText,
  createMotion,
  criteriaCount,
  deleteMotion,
  divisionLabel,
  exportFileName,
  fakeYeas,
  initPrepState,
  isUntitled,
  openDivisionBallot,
  parseImport,
  practiceItems,
  prepStorageKey,
  readStoredPrep,
  serializePrep,
  setCardStatus,
  statusTally,
  updateMotion,
  type CardStatus,
  type CeremonyItem,
  type Motion,
  type PrepState,
  type RecsDivision,
} from './division-vote-logic';

/**
 * 10/17 토론회 「분과 의결」 탭 — 1단계 시연판.
 *
 * 준비판 · 투표 열기 · 세리머니 세 화면. 준비 내용은 이 브라우저에만 저장하고
 * JSON 내보내기/가져오기로 다른 기기에 옮긴다(공유 저장은 2단계).
 * 판단은 division-vote-logic.ts 에 있다 — 여기서는 그리기와 배선만 한다.
 *
 * `fixtureSource` 를 주면 미리보기다: 가상 데이터를 바로 싣고 저장 키를 따로 쓴다
 * (같은 도메인의 /mod 준비 내용과 섞이지 않게).
 */

type View = 'prep' | 'ballot' | 'ceremony';
const VIEWS: { id: View; label: string }[] = [
  { id: 'prep', label: '준비판' },
  { id: 'ballot', label: '투표 열기' },
  { id: 'ceremony', label: '세리머니' },
];

const storage = createSafeBrowserStorage('localStorage');

const btn =
  'min-h-12 rounded-xl px-4 text-[17px] font-bold focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79] disabled:opacity-40';
const btnPrimary = `${btn} bg-[#135C73] text-white`;
const btnGhost = `${btn} border border-[#C4D8E4] bg-white text-[#1F4E79]`;
const input =
  'w-full min-w-0 rounded-xl border border-[#C4D8E4] px-3 text-[17px] text-[#1F2933] outline-none focus:border-[#23B2C3] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]';

export default function DivisionVotePanel({
  access,
  fixtureSource,
  subgroup,
}: {
  access: WorkshopAuthorization | null;
  fixtureSource?: RecsDivision[];
  /** 조의 분과(「N분과」). 있으면 그 분과만 보이고 고를 수 있다. 운영진(분과 없음)은 전부. */
  subgroup?: string | null;
}) {
  const lockedDivision = lockedDivisionOf(subgroup);
  const ns = fixtureSource ? 'lab:' : '';
  const keyOf = useCallback((division: number) => `${ns}${prepStorageKey(division)}`, [ns]);

  /** 분과 → 준비 상태. 저장소에 있는 것을 읽어 둔다. */
  const [states, setStates] = useState<Record<number, PrepState>>(() => {
    const out: Record<number, PrepState> = {};
    for (const d of [1, 2, 3]) {
      const stored = readStoredPrep(storage.getItem(`${ns}${prepStorageKey(d)}`));
      if (stored) out[d] = stored;
    }
    for (const source of fixtureSource ?? []) if (!out[source.division]) out[source.division] = initPrepState(source);
    return out;
  });
  const [division, setDivision] = useState<number | null>(() => {
    const saved = Number(storage.getItem(`${ns}${PREP_DIVISION_KEY}`));
    if (Number.isInteger(saved) && saved > 0) return saved;
    return fixtureSource?.[0]?.division ?? null;
  });
  const [view, setView] = useState<View>('prep');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const divisions = Object.keys(states)
    .map(Number)
    .filter((d) => lockedDivision === null || d === lockedDivision)
    .sort((a, b) => a - b);
  // 고른 분과가 잠금 밖이면(가져오기 직후·저장된 옛 선택) 잠긴 분과로 돌아간다.
  const activeDivision = division !== null && divisions.includes(division) ? division : divisions[0] ?? null;
  const state = activeDivision !== null ? states[activeDivision] : null;

  // 바뀔 때마다 저장. 저장소가 막히면 페이지 메모리로 내려가므로 안내를 띄운다.
  const persist = useCallback(
    (next: PrepState) => {
      storage.setItem(keyOf(next.division), serializePrep(next));
    },
    [keyOf],
  );
  const update = useCallback(
    (fn: (s: PrepState) => PrepState) => {
      if (activeDivision === null) return;
      setStates((prev) => {
        const cur = prev[activeDivision];
        if (!cur) return prev;
        const next = fn(cur);
        if (next === cur) return prev;
        persist(next);
        return { ...prev, [activeDivision]: next };
      });
    },
    [activeDivision, persist],
  );

  useEffect(() => {
    if (activeDivision !== null) storage.setItem(`${ns}${PREP_DIVISION_KEY}`, String(activeDivision));
  }, [activeDivision, ns]);

  const onImportFile = async (file: File) => {
    const parsed = parseImport(await file.text());
    if (parsed.kind === 'error') {
      setNotice({ tone: 'error', text: parsed.message });
      return;
    }
    if (parsed.kind === 'state') {
      const s = parsed.state;
      if (states[s.division] && !window.confirm(`${divisionLabel(s.division)} 준비 내용을 가져온 파일로 바꿉니다.`)) return;
      persist(s);
      setStates((prev) => ({ ...prev, [s.division]: s }));
      setDivision(s.division);
      setNotice({ tone: 'ok', text: `${divisionLabel(s.division)} 준비 내용을 가져왔습니다(의결안 ${s.motions.length}건).` });
      return;
    }
    // 원천 파일 — 이미 준비 중인 분과는 건드리지 않는다.
    const added: string[] = [];
    const kept: string[] = [];
    const nextStates = { ...states };
    for (const source of parsed.divisions) {
      if (nextStates[source.division]) {
        kept.push(divisionLabel(source.division));
        continue;
      }
      const s = initPrepState(source);
      persist(s);
      nextStates[source.division] = s;
      added.push(divisionLabel(source.division));
    }
    setStates(nextStates);
    if (activeDivision === null && parsed.divisions[0]) setDivision(parsed.divisions[0].division);
    setNotice({
      tone: 'ok',
      text: [
        added.length ? `${added.join('·')} 권고안을 불러왔습니다.` : '',
        kept.length ? `${kept.join('·')}은 기존 준비 내용을 그대로 두었습니다.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    });
  };

  const onExport = () => {
    if (!state) return;
    downloadBlob(new Blob([serializePrep(state)], { type: 'application/json' }), exportFileName(state.division, new Date()));
    setNotice({ tone: 'ok', text: `${divisionLabel(state.division)} 준비 내용을 파일로 저장했습니다.` });
  };

  const onReset = () => {
    if (!state) return;
    if (!window.confirm(`${divisionLabel(state.division)}의 상태·의결안을 모두 지우고 처음 상태로 돌립니다.`)) return;
    const s = initPrepState(state.source);
    persist(s);
    setStates((prev) => ({ ...prev, [s.division]: s }));
    setNotice({ tone: 'ok', text: '처음 상태로 돌렸습니다.' });
  };

  return (
    <section data-testid="division-vote-panel" className="rounded-2xl border border-[#DCE7EE] bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#DCE7EE] bg-[#1F4E79]/6 px-6 py-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[22px] font-extrabold text-[#1F4E79]">10/17 분과 의결</h3>
          <p className="text-[15px] text-[#5A6B73]">준비 내용은 이 브라우저에 저장됩니다. 다른 기기로는 JSON 파일로 옮깁니다.</p>
        </div>
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
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`rounded-xl px-4 py-3 text-[16px] font-bold ${
              notice.tone === 'error' ? 'border border-[#DC2626]/30 bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#EAF6EE] text-[#2F6F25]'
            }`}
          >
            {notice.text}
          </p>
        ) : null}
        {!storage.isPersistent() ? (
          <p role="alert" className="rounded-xl border border-[#F5A623]/40 bg-[#FFF7E6] px-4 py-3 text-[16px] font-bold text-[#8A5A00]">
            이 브라우저는 저장소를 쓸 수 없어 새로고침하면 내용이 사라집니다. JSON 내보내기로 보관하십시오.
          </p>
        ) : null}

        {!state ? (
          <div className="rounded-xl border border-dashed border-[#C4D8E4] p-6 text-[17px] text-[#1F2933]">
            <p className="font-bold">권고안 파일(recs_1017.json)을 「JSON 가져오기」로 불러오십시오.</p>
            <p className="mt-2 text-[#5A6B73]">다른 기기에서 내보낸 준비판 파일도 같은 버튼으로 가져옵니다.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {divisions.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={d === activeDivision}
                  onClick={() => setDivision(d)}
                  className={d === activeDivision ? btnPrimary : btnGhost}
                >
                  {divisionLabel(d)}
                </button>
              ))}
              <span className="mx-2 h-8 w-px bg-[#DCE7EE]" aria-hidden="true" />
              <div role="tablist" aria-label="의결 화면" className="flex flex-wrap gap-2">
                {VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={view === v.id}
                    onClick={() => setView(v.id)}
                    className={view === v.id ? btnPrimary : btnGhost}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <button type="button" className={`${btnGhost} ml-auto`} onClick={onReset}>
                이 분과 처음으로
              </button>
            </div>
            <p className="text-[16px] text-[#1F2933]">
              <span className="font-bold">{divisionLabel(state.division)}</span> · {state.source.agenda}
            </p>

            {view === 'prep' ? <PrepBoard state={state} update={update} /> : null}
            {view === 'ballot' ? <BallotOpener state={state} access={access} /> : null}
            {view === 'ceremony' ? <CeremonySetup state={state} access={access} /> : null}
          </>
        )}
      </div>
    </section>
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
            <span className="text-[15px] text-[#5A6B73]">작성 {topic.written_by || '—'}</span>
          </div>
          <ul className="divide-y divide-[#EEF3F6]">
            {topic.cards.map((card) => {
              const st = state.cards[card.no];
              const isSel = selected.includes(card.no);
              return (
                <li key={card.no} data-card-no={card.no} className={`px-4 py-3 ${isSel ? 'bg-[#E6F5F7]' : ''}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex min-h-11 cursor-pointer items-center gap-2">
                      <input type="checkbox" className="h-6 w-6" checked={isSel} onChange={() => toggle(card.no)} />
                      <span className="text-[16px] font-bold text-[#135C73] tr-num">{card.no}</span>
                    </label>
                    <span className="min-w-0 flex-1 text-[17px] font-bold text-[#1F2933]">
                      {isUntitled(card) ? (
                        <span className="rounded-md bg-[#FFF1D6] px-2 py-0.5 text-[15px] text-[#8A5A00]">제목 없음</span>
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
                      <span className="text-[15px] font-bold text-[#5A6B73]">→ {st.target ?? '안 번호 없음'}</span>
                    ) : null}
                  </div>
                  <details className="mt-1 pl-8">
                    <summary className="min-h-9 cursor-pointer text-[15px] font-bold text-[#2E75B6]">권고 {card.recs.length}건</summary>
                    <ol className="mt-1 space-y-1 text-[15px] text-[#1F2933]">
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
                <MotionEditor key={m.id} motion={m} update={update} />
              ))}
            </div>
          ) : null}
        </div>
      ))}

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
            <button type="button" className={btnPrimary} disabled={!check.ok || !title.trim()} onClick={make}>
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

function MotionEditor({ motion, update }: { motion: Motion; update: (fn: (s: PrepState) => PrepState) => void }) {
  return (
    <div data-testid="motion-card" data-motion-id={motion.id} className="rounded-xl border border-[#C4D8E4] bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg bg-[#1F4E79] px-3 py-1 text-[16px] font-extrabold text-white">{motion.id}</span>
        <span className="text-[15px] text-[#5A6B73]">원 카드 {motion.cardNos.join(', ')}</span>
        <span className="text-[15px] font-bold text-[#135C73]">기준 {criteriaCount(motion)}/5</span>
        <button
          type="button"
          className={`${btnGhost} ml-auto`}
          onClick={() => {
            if (window.confirm(`${motion.id}을 지웁니다. 통합으로 묶인 카드는 유지로 돌아갑니다.`)) update((s) => deleteMotion(s, motion.id));
          }}
        >
          안 지우기
        </button>
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
      <fieldset className="mt-3">
        <legend className="text-[15px] font-bold text-[#5A6B73]">권고 수준 5개 기준(운영규정 §17②)</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {CRITERIA.map((k) => (
            <label key={k} className="flex min-h-11 cursor-pointer items-center gap-2 text-[16px] text-[#1F2933]">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={motion.criteria[k]}
                onChange={(e) => update((s) => updateMotion(s, motion.id, { criteria: { ...motion.criteria, [k]: e.target.checked } }))}
              />
              {CRITERION_LABELS[k]}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

// ============================================================
// 투표 열기
// ============================================================

function useDivisionBallots(access: WorkshopAuthorization | null, subgroup: string) {
  const [rows, setRows] = useState<BallotListRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    if (!access) return;
    try {
      const all = await ballotList(access);
      setRows(all.filter((b) => (b.subgroup ?? '').trim() === subgroup));
      setFailed(false);
    } catch (error) {
      console.error('[division vote] ballot list failed', error);
      setFailed(true);
    }
  }, [access, subgroup]);
  useEffect(() => {
    setRows(null);
    void refresh();
  }, [refresh]);
  return { rows, failed, refresh };
}

/** [묶음 크기, 버튼 이름]. 1 = 안 하나씩, Infinity = 분과 전체 한 번. */
const BATCH_SIZES: ReadonlyArray<readonly [number, string]> = [
  [1, '하나씩'],
  [5, '5개 안팎'],
  [10, '10개 안팎'],
  [Number.POSITIVE_INFINITY, '전체 한 번'],
];

function BallotOpener({ state, access }: { state: PrepState; access: WorkshopAuthorization | null }) {
  const subgroup = divisionLabel(state.division);
  const [picked, setPicked] = useState<string[]>(() => state.motions.map((m) => m.id));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [qrId, setQrId] = useState<string | null>(null);
  const intentRef = useRef<BallotCreateIntent | null>(null);
  const dialogRef = useModalDialog<HTMLDivElement>(confirming, () => setConfirming(false));
  const { rows, failed, refresh } = useDivisionBallots(access, subgroup);

  useEffect(() => setPicked(state.motions.map((m) => m.id)), [state.division, state.motions.length]);

  const [batchSize, setBatchSize] = useState<number>(5);
  const batches = batchMotions(state.motions, batchSize);
  const motions = state.motions.filter((m) => picked.includes(m.id));
  const plan = buildDivisionBallot(state.division, motions, motions.length < state.motions.length ? batchLabel(motions) : undefined);
  const duplicate = (rows ?? []).some((b) => b.title === plan.payload.title);

  const create = async () => {
    if (!access) return;
    const intent = ballotCreateIntent(
      intentRef.current,
      { title: plan.payload.title, instructions: plan.payload.instructions, items: plan.payload.items, subgroup: plan.payload.subgroup },
      () => crypto.randomUUID(),
    );
    intentRef.current = intent;
    setBusy(true);
    try {
      await openDivisionBallot((input, key) => ballotCreate(access, input, key), plan, intent.requestId);
      intentRef.current = null;
      setConfirming(false);
      setMsg(`${subgroup} 투표 초안을 만들었습니다. 「투표」 탭에서 시작한 뒤 QR을 띄우십시오.`);
      await refresh();
    } catch (error) {
      console.error('[division vote] ballot create failed', error);
      setMsg('투표 만들기에 실패했습니다. 네트워크를 확인하고 다시 누르십시오.');
    } finally {
      setBusy(false);
    }
  };

  const qrBallot = qrId ? (rows ?? []).find((b) => b.id === qrId) ?? null : null;

  return (
    <div className="space-y-5">
      {state.motions.length > 0 ? (
        <div className="rounded-2xl border border-[#DCE7EE] p-4" data-testid="division-batches">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-bold text-[#1F4E79]">묶음 크기</span>
            {BATCH_SIZES.map(([size, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={batchSize === size}
                className={batchSize === size ? btnPrimary : btnGhost}
                onClick={() => setBatchSize(size)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[15px] text-[#5A6B73]">주제 순서대로 묶고 한 주제는 쪼개지 않습니다. 묶음을 누르면 아래 목록이 그 묶음으로 바뀝니다.</p>
          <ol className="mt-3 flex flex-wrap gap-2">
            {batches.map((batch, i) => {
              const label = batchLabel(batch);
              const made = (rows ?? []).some((b) => b.title === `${subgroup} 의결 ${label}`);
              const active = batch.length === motions.length && batch.every((m) => picked.includes(m.id));
              return (
                <li key={batch[0].id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    className={active ? btnPrimary : btnGhost}
                    onClick={() => setPicked(batch.map((m) => m.id))}
                  >
                    {i + 1}. {label} · 안 {batch.length}
                    {made ? ' ✓' : ''}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {state.motions.length === 0 ? (
        <p className="text-[17px] text-[#5A6B73]">준비판에서 의결안을 먼저 만드십시오.</p>
      ) : (
        <fieldset className="rounded-2xl border border-[#DCE7EE] p-4">
          <legend className="px-1 text-[16px] font-bold text-[#1F4E79]">투표에 넣을 안 ({motions.length}/{state.motions.length})</legend>
          <ul className="space-y-1">
            {state.motions.map((m) => (
              <li key={m.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[17px]">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    checked={picked.includes(m.id)}
                    onChange={() => setPicked((prev) => (prev.includes(m.id) ? prev.filter((x) => x !== m.id) : [...prev, m.id]))}
                  />
                  <span className="font-bold text-[#135C73]">{m.id}</span>
                  <span className="min-w-0 truncate">{m.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      {plan.problems.length > 0 && state.motions.length > 0 ? (
        <ul role="alert" className="space-y-1 rounded-xl border border-[#F5A623]/40 bg-[#FFF7E6] px-4 py-3 text-[16px] font-bold text-[#8A5A00]">
          {plan.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}

      {duplicate && plan.problems.length === 0 ? (
        <p role="alert" className="rounded-xl border border-[#F5A623]/40 bg-[#FFF7E6] px-4 py-3 text-[16px] font-bold text-[#8A5A00]">
          「{plan.payload.title}」 투표가 이미 있습니다. 다시 만들면 같은 이름이 둘이 됩니다.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={btnPrimary}
          data-testid="division-ballot-create"
          disabled={!access || busy || plan.problems.length > 0}
          onClick={() => setConfirming(true)}
        >
          「{plan.payload.title}」 투표 만들기 (찬성/반대)
        </button>
        {!access ? <span className="text-[16px] text-[#5A6B73]">조 코드로 들어온 콘솔에서 만들 수 있습니다.</span> : null}
      </div>
      {msg ? (
        <p role="status" className="text-[16px] font-bold text-[#1F4E79]">
          {msg}
        </p>
      ) : null}

      {access ? (
        <div className="rounded-2xl border border-[#DCE7EE] p-4">
          <div className="flex items-center gap-3">
            <h4 className="flex-1 text-[18px] font-extrabold text-[#1F4E79]">{subgroup} 투표 목록</h4>
            <button type="button" className={btnGhost} onClick={() => void refresh()}>
              새로고침
            </button>
          </div>
          <p className="mt-1 text-[15px] text-[#5A6B73]">시작·마감·공개는 「투표」 탭에서 합니다.</p>
          {failed ? <p className="mt-2 text-[16px] font-bold text-[#B91C1C]">목록을 읽지 못했습니다.</p> : null}
          <ul className="mt-3 space-y-2">
            {(rows ?? []).map((b) => (
              <li key={b.id} data-ballot-id={b.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-[#F5F8FB] px-3 py-2 text-[16px]">
                <span className="font-bold">{b.title}</span>
                <span className="text-[#5A6B73]">
                  {ballotStatusLabel(b.status)} · 안 {b.item_count}건 · 제출 {b.response_count}명
                </span>
                <button type="button" className={`${btnGhost} ml-auto`} onClick={() => setQrId(b.id)} disabled={b.status !== 'open'}>
                  QR 띄우기
                </button>
              </li>
            ))}
            {rows && rows.length === 0 ? <li className="text-[16px] text-[#5A6B73]">아직 없습니다.</li> : null}
          </ul>
        </div>
      ) : null}

      {confirming ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="투표 만들기 확인" className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-[20px] font-extrabold text-[#1F4E79]">{subgroup} 투표를 운영 서버에 만듭니다</p>
            <p className="mt-2 text-[16px] text-[#1F2933]">
              안 {plan.payload.items.length}건 · 찬성/반대 · {subgroup} 한정. 초안으로 만들어지며 시작은 「투표」 탭에서 합니다.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setConfirming(false)}>
                취소
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={() => void create()}>
                {busy ? '만드는 중…' : '만들기'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {qrBallot ? <BallotQrFullscreen ballot={qrBallot} onExit={() => setQrId(null)} /> : null}
    </div>
  );
}

// ============================================================
// 세리머니 설정
// ============================================================

function CeremonySetup({ state, access }: { state: PrepState; access: WorkshopAuthorization | null }) {
  const subgroup = divisionLabel(state.division);
  const [enrolled, setEnrolled] = useState(60);
  const [present, setPresent] = useState(45);
  const [mode, setMode] = useState<'practice' | 'ballot'>('practice');
  const [yeas, setYeas] = useState<Record<string, number>>({});
  const [ballotIds, setBallotIds] = useState<string[]>([]);
  const [ballotItems, setBallotItems] = useState<CeremonyItem[] | null>(null);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const [running, setRunning] = useState<CeremonyItem[] | null>(null);
  const { rows } = useDivisionBallots(mode === 'ballot' ? access : null, subgroup);

  const randomize = () => {
    const next: Record<string, number> = {};
    for (const m of state.motions) next[m.id] = fakeYeas(present, Math.random);
    setYeas(next);
  };

  // 묶음으로 나눠 연 투표를 여러 개 골라 한 세리머니로 잇는다(목록 순서대로).
  const loadResults = async () => {
    const chosen = (rows ?? []).filter((r) => ballotIds.includes(r.id));
    if (!access || chosen.length === 0) return;
    setLoadMsg('불러오는 중…');
    try {
      const all: CeremonyItem[] = [];
      const counts: number[] = [];
      for (const b of chosen) {
        const res = await ballotResults(b.token, access);
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

  const items = mode === 'practice' ? practiceItems(state.motions, yeas) : ballotItems ?? [];
  const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[16px] font-bold text-[#1F4E79]">재적 R</span>
          <input type="number" min={1} className={`${input} mt-1 h-14 text-[22px] tr-num`} value={Number.isNaN(enrolled) ? '' : enrolled} onChange={(e) => setEnrolled(num(e.target.value))} />
        </label>
        <label className="block">
          <span className="text-[16px] font-bold text-[#1F4E79]">참석 M</span>
          <input type="number" min={0} className={`${input} mt-1 h-14 text-[22px] tr-num`} value={Number.isNaN(present) ? '' : present} onChange={(e) => setPresent(num(e.target.value))} />
        </label>
      </div>
      <p data-testid="division-attendance" className="rounded-xl bg-[#F5F8FB] px-4 py-3 text-[17px] font-bold text-[#1F2933]">
        {attendanceText(enrolled, present)}
      </p>

      <div role="radiogroup" aria-label="결과 원천" className="flex flex-wrap gap-2">
        <button type="button" role="radio" aria-checked={mode === 'practice'} className={mode === 'practice' ? btnPrimary : btnGhost} onClick={() => setMode('practice')}>
          연습 모드(수기·무작위)
        </button>
        <button type="button" role="radio" aria-checked={mode === 'ballot'} className={mode === 'ballot' ? btnPrimary : btnGhost} onClick={() => setMode('ballot')}>
          실제 투표 결과
        </button>
      </div>

      {mode === 'practice' ? (
        state.motions.length === 0 ? (
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
              {state.motions.map((m) => (
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
      ) : !access ? (
        <p className="text-[17px] text-[#5A6B73]">실제 결과는 조 코드로 들어온 콘솔에서 불러옵니다.</p>
      ) : (
        <fieldset className="rounded-2xl border border-[#DCE7EE] p-4">
          <legend className="px-1 text-[16px] font-bold text-[#1F4E79]">{subgroup} 투표 고르기 (여러 개면 순서대로 이어 공개)</legend>
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
          sourceLabel={mode === 'practice' ? '연습' : '투표 결과'}
          onExit={() => setRunning(null)}
        />
      ) : null}
    </div>
  );
}
