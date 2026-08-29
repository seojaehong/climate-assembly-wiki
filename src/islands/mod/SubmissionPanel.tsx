import { useCallback, useEffect, useState } from 'react';
import {
  submissionFinalize,
  submissionGet,
  submissionSave,
  submissionReopenByTeam,
  topicList,
  type SubmissionStatus,
  type Topic,
} from '../../lib/deliberation';
import {
  FINALIZE_CONFIRM_MESSAGE,
  MAX_SUBMISSION_ROWS,
  addRow,
  canFinalize,
  emptyRow,
  isDirty,
  isEditable,
  moveRow,
  pickRestoredRows,
  removeRow,
  rowsFromItems,
  splitPastedRows,
  submissionBadge,
  toSaveItems,
  type EditorRow,
} from './submission-panel-logic';
import { SUBMISSION_GUIDE, topicAnchorId } from './submission-guide';
import {
  buildSubmissionReport,
  reportToCsv,
  reportToText,
  reportFileName,
  formatStamp,
} from './submission-report';
import { submissionReportBlob } from './submission-report-docx';
import PrintableReport from './PrintableReport';
import type { SubmissionReport } from './submission-report';
import { buildBoards } from './hq-submission-board-logic';
import type { HqSubmissionRow } from '../../lib/hq-submissions';

/**
 * 조별 산출물 — 그날의 꼭지를 **한 화면에 모두 펼친다.**
 *
 * 예전에는 주제를 하나 골라 들어가는 탭 구조였다. 8.29에 조가 하는 일은 세 꼭지를
 * 줄글로 채우는 것 하나뿐이라, 고르는 단계가 군더더기였고 주제가 아직 안 열렸을 때는
 * 「본부에서 주제를 열면…」이라는 운영 사정이 시민에게 그대로 노출됐다.
 * 이제 꼭지마다 제 편집기를 가진 구역이 세로로 놓이고, 조는 시트에 적듯 위에서 아래로 쓴다.
 *
 * 상태는 구역마다 따로 갖는다(한 꼭지를 저장해도 다른 꼭지의 미저장 내용이 날아가지 않게).
 */

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`font-mono text-[12px] font-semibold uppercase ${className}`}
      style={{ letterSpacing: '.14em' }}
    >
      {children}
    </div>
  );
}

/** ISO 시각을 시:분으로. 값이 없거나 깨졌으면 '—'. */
function formatClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

type LoadedSubmission = {
  status: SubmissionStatus | null;
  updatedAt: string | null;
  finalizedAt: string | null;
};

/**
 * 인쇄 문서를 다시 만들라는 신호.
 *
 * 인쇄 문서는 **항상 DOM에 있어야 한다** — 버튼을 눌러야 만들어지게 두면 Ctrl+P나
 * 브라우저 메뉴로 인쇄할 때 드러낼 것이 없어 백지가 나간다(실제로 4쪽 전부 빈 종이가
 * 나왔다). 그래서 처음에 한 번 만들고, 조가 저장할 때마다 이 신호로 갱신한다.
 *
 * 조 콘솔은 꼭지마다 구역이 따로라 상태를 공유하지 않는다. 상태를 위로 끌어올리면
 * 세 구역이 서로의 저장에 다시 그려진다 — 입력 중에 그건 위험하다. 신호만 보낸다.
 */
const SUBMISSION_CHANGED = 'climate-vote:submission-changed';
function announceSubmissionChanged() {
  window.dispatchEvent(new CustomEvent(SUBMISSION_CHANGED));
}

/** 꼭지 번호 뱃지 — ①②③. 4개를 넘으면 숫자로 떨어진다. */
const ORDINAL_MARKS = ['①', '②', '③', '④', '⑤', '⑥'];
function ordinalMark(n: number): string {
  return ORDINAL_MARKS[n - 1] ?? String(n);
}

/** 꼭지 하나 = 구역 하나. 편집·저장·최종 제출을 스스로 갖는다. */
function TopicSection({ code, topic }: { code: string; topic: Topic }) {
  const [loaded, setLoaded] = useState<LoadedSubmission | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [rows, setRows] = useState<EditorRow[]>([emptyRow()]);
  const [baseline, setBaseline] = useState<EditorRow[]>([emptyRow()]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dirty = isDirty(rows, baseline);
  // 미저장 입력 임시 보관함 — 조·꼭지마다 따로 둔다.
  const draftKey = `climate_vote_draft:${code}:${topic.id}`;
  const badge = submissionBadge(loaded?.status ?? null);
  const topicOpen = topic.status === 'open';
  const editable = loaded != null && isEditable(loaded.status) && topicOpen;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const loadSubmission = useCallback(async () => {
    try {
      const result = await submissionGet(code, topic.id);
      const nextRows = rowsFromItems(result.items ?? []);
      setLoaded({
        status: result.status ?? null,
        updatedAt: result.updated_at ?? null,
        finalizedAt: result.finalized_at ?? null,
      });
      setBaseline(nextRows);
      setSavedAt(result.updated_at ?? null);
      setLoadFailed(false);
      // 탭을 옮겼다 왔을 때 저장 안 한 글을 되살린다. 서버 내용을 기준선으로 두고,
      // 보관분이 그와 다를 때만 화면에 올린다(저장을 마친 뒤엔 같아지므로 안 뜬다).
      let restored: EditorRow[] | null = null;
      try {
        restored = pickRestoredRows(sessionStorage.getItem(draftKey), nextRows);
      } catch {
        /* 보관함을 못 읽는 브라우저 — 서버 내용으로 연다 */
      }
      setRows(restored ?? nextRows);
    } catch {
      setLoadFailed(true);
    }
  }, [code, topic.id, draftKey]);

  useEffect(() => {
    void loadSubmission();
  }, [loadSubmission]);

  // 미저장 내용을 보관함에 넣어 둔다. 저장해서 서버와 같아지면 지운다
  // (낡은 초안이 남아 다음에 되살아나면 그게 더 위험하다).
  useEffect(() => {
    if (loaded == null) return;
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(rows));
      else sessionStorage.removeItem(draftKey);
    } catch {
      /* 보관만 못 할 뿐 편집은 계속된다 */
    }
  }, [rows, dirty, loaded, draftKey]);

  // 저장 전 이탈(새로고침·탭 닫기) confirm — 자동 저장이 없으므로 이 방어선이 유일하다.
  // 구역마다 걸어 두면 어느 꼭지에 미저장분이 있어도 잡힌다.
  useEffect(() => {
    if (!dirty || !editable) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, editable]);

  const handleSave = async () => {
    if (!editable) return;
    setSaving(true);
    try {
      await submissionSave(code, topic.id, toSaveItems(rows));
      setToast('저장되었습니다. 최종 제출 전까지 계속 고칠 수 있습니다.');
      await loadSubmission();
      announceSubmissionChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setToast(
        message.includes('finalized')
          ? '이미 최종 제출된 상태입니다 — 「다시 열기」를 누르면 조가 직접 풀 수 있습니다.'
          : message.includes('not open')
            ? '이 꼭지는 마감되어 저장할 수 없습니다.'
            : '저장에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.',
      );
    } finally {
      setSaving(false);
    }
  };

  /**
   * 다시 열기 — 본부 승인 없이 조가 직접 푼다. 기록은 남는다(actor_scope='team').
   * 행사 중 본부를 부르게 하면 그 조가 몇 분씩 멈춘다.
   */
  const handleReopen = async () => {
    if (!window.confirm('최종 제출을 취소하고 다시 고칠 수 있게 합니다. 내용은 그대로 남습니다.')) return;
    setReopening(true);
    try {
      await submissionReopenByTeam(code, topic.id);
      setToast('다시 열었습니다. 이어서 고치고 저장하세요.');
      await loadSubmission();
      announceSubmissionChanged();
    } catch (error) {
      setToast(error instanceof Error ? error.message : '다시 열지 못했습니다.');
    } finally {
      setReopening(false);
    }
  };

  /**
   * 최종 제출 — 화면의 내용을 먼저 저장한 뒤 잠근다. 저장 없이 finalize하면
   * 서버에 남은 옛 항목이 잠겨 화면과 다른 내용이 최종본이 된다.
   */
  const handleFinalize = async () => {
    if (!editable) return;
    setFinalizing(true);
    try {
      await submissionSave(code, topic.id, toSaveItems(rows));
      await submissionFinalize(code, topic.id);
      setToast('최종 제출되었습니다.');
      await loadSubmission();
      announceSubmissionChanged();
    } catch {
      setToast('최종 제출에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <section
      id={topicAnchorId(topic.id)}
      className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden scroll-mt-4"
    >
      <header className="px-5 py-4 bg-[#4F9D3A]/8 border-b border-[#DCE7EE]">
        <div className="flex items-baseline gap-2">
          <span className="text-[22px] font-extrabold text-[#4F9D3A]" aria-hidden="true">
            {ordinalMark(topic.ordinal)}
          </span>
          <h4 className="text-[21px] font-extrabold text-[#1F4E79] break-words" style={{ letterSpacing: '-.01em' }}>
            {topic.prompt}
          </h4>
          {topic.status === 'closed' ? (
            <span className="ml-auto shrink-0 rounded-full bg-[#5A6B73] px-2.5 py-[3px] text-[13px] font-bold text-white">
              마감
            </span>
          ) : null}
        </div>
        {topic.guidance ? (
          <p className="mt-2 text-[15px] leading-[1.55] text-[#5A6B73] break-words">{topic.guidance}</p>
        ) : null}
      </header>

      <div className="p-4 sm:p-5 space-y-3">
        {loadFailed ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3">
            <span className="text-[16px] font-extrabold text-[#B5651D] flex-1 min-w-[200px]">
              작성 내용을 불러오지 못했습니다 — 네트워크를 확인해 주세요.
            </span>
            <button
              type="button"
              onClick={() => void loadSubmission()}
              className="min-h-11 rounded-lg border-2 border-[#B5651D] px-4 text-[15px] font-bold text-[#B5651D]"
            >
              지금 다시 시도
            </button>
          </div>
        ) : loaded == null ? (
          <p className="text-[16px] text-[#5A6B73]">불러오는 중…</p>
        ) : (
          <>
            {badge ? (
              <div
                className={`flex items-center gap-2 rounded-xl px-4 py-3 text-[16px] font-extrabold ${
                  badge.tone === 'locked'
                    ? 'bg-[#1F4E79]/8 border border-[#1F4E79]/30 text-[#1F4E79]'
                    : 'bg-[#F5A623]/10 border border-[#F5A623]/40 text-[#B5651D]'
                }`}
              >
                <span aria-hidden="true">{badge.tone === 'locked' ? '🔒' : '🔓'}</span>
                <span>{badge.label}</span>
                {badge.tone === 'locked' && loaded.finalizedAt ? (
                  <span className="text-[14px] font-semibold opacity-80 tr-num">
                    {formatClock(loaded.finalizedAt)}
                  </span>
                ) : null}
              </div>
            ) : null}
            {loaded.status === 'final' ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-[15px] font-semibold text-[#5A6B73]">
                  잘못 눌렀다면 여기서 바로 다시 열 수 있습니다. 내용은 그대로 남습니다.
                </p>
                <button
                  type="button"
                  disabled={reopening}
                  onClick={() => void handleReopen()}
                  className="h-12 rounded-xl border-2 border-[#B5651D] bg-white px-4 text-[16px] font-bold text-[#B5651D] disabled:opacity-40"
                >
                  {reopening ? '여는 중…' : '다시 열기'}
                </button>
              </div>
            ) : null}
            {loaded.status !== 'final' && !topicOpen ? (
              <p className="rounded-xl border border-[#DCE7EE] bg-[#F1F7FA] px-4 py-2.5 text-[15px] font-semibold text-[#5A6B73]">
                이 꼭지는 마감되어 더 이상 저장할 수 없습니다.
              </p>
            ) : null}

            <div className="space-y-3">
              {rows.map((row, index) => (
                <div key={index} className="rounded-xl border border-[#C4D8E4] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="w-9 h-9 shrink-0 rounded-lg bg-[#F1F7FA] border border-[#DCE7EE] grid place-items-center text-[16px] font-bold text-[#1F4E79]">
                      {index + 1}
                    </span>
                    {editable ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setRows((prev) => moveRow(prev, index, -1))}
                          disabled={index === 0}
                          aria-label={`${topic.prompt} ${index + 1}번 위로`}
                          className="w-10 h-10 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-lg grid place-items-center disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => setRows((prev) => moveRow(prev, index, 1))}
                          disabled={index === rows.length - 1}
                          aria-label={`${topic.prompt} ${index + 1}번 아래로`}
                          className="w-10 h-10 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-lg grid place-items-center disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // 빈 줄은 그냥 지운다. 쓴 게 있을 때만 한 번 묻는다.
                            if (
                              row.content.trim().length > 0 &&
                              !window.confirm(`${index + 1}번 줄을 지웁니다. 되돌릴 수 없습니다.`)
                            ) {
                              return;
                            }
                            setRows((prev) => removeRow(prev, index));
                          }}
                          aria-label={`${topic.prompt} ${index + 1}번 삭제`}
                          className="w-10 h-10 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-xl grid place-items-center"
                        >
                          ×
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <textarea
                    value={row.content}
                    readOnly={!editable}
                    onChange={(e) =>
                      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, content: e.target.value } : r)))
                    }
                    /* 여러 줄을 한 번에 붙이면 줄마다 칸을 만들어 나눠 담는다.
                       조는 대부분 한글·워드에 써 두고 마지막에 옮긴다 — 통째로 한 칸에
                       들어가면 문장 열 개가 1건이 되어 발표 카드도 겹침 판정도 무너진다.
                       한 줄짜리는 손대지 않는다(기본 붙여넣기 유지). */
                    onPaste={(e) => {
                      if (!editable) return;
                      const text = e.clipboardData.getData('text/plain');
                      const split = splitPastedRows(rows, index, text);
                      if (split.dropped > 0 && !split.applied) {
                        e.preventDefault();
                        setToast(`이미 ${MAX_SUBMISSION_ROWS}줄이라 더 넣을 수 없습니다 — ${split.dropped}줄이 들어가지 못했습니다.`);
                        return;
                      }
                      if (!split.applied) return;
                      e.preventDefault();
                      setRows(split.rows);
                      setToast(
                        split.dropped > 0
                          ? `${split.inserted}줄로 나눠 넣었습니다. ${MAX_SUBMISSION_ROWS}줄 상한이라 ${split.dropped}줄은 들어가지 못했습니다 — 확인해 주세요.`
                          : `${split.inserted}줄로 나눠 넣었습니다.`,
                      );
                    }}
                    rows={2}
                    placeholder="여기에 적습니다"
                    className={`w-full min-w-0 rounded-xl border px-3 py-2.5 text-[17px] outline-none resize-y ${
                      editable
                        ? 'border-[#C4D8E4] focus:border-[#4F9D3A] text-[#1F2933]'
                        : 'border-[#DCE7EE] bg-[#F5F8FB] text-[#5A6B73]'
                    }`}
                  />
                  {/* 「근거 (선택)」 칸은 2026-08-28 통화에서 없애기로 정리됐다.
                      원인·배경을 별도 칸으로 두면 「써야 하나 말아야 하나·어떻게 써야 하나」가
                      또 하나 늘고, 범주를 늘리면 그 자체로 시끄러워진다는 판단이었다.
                      필요한 내용은 세 꼭지 본문에 함께 적는다.
                      ★ DB 열(submission_item.rationale)과 내보내기 처리는 그대로 둔다 —
                      화면에서만 뺀다. 되살릴 일이 생기면 이 블록만 복구하면 된다. */}
                </div>
              ))}
            </div>

            {editable ? (
              <>
                <button
                  type="button"
                  onClick={() => setRows((prev) => addRow(prev))}
                  disabled={rows.length >= MAX_SUBMISSION_ROWS}
                  className="w-full h-[52px] rounded-xl border border-dashed border-[#4F9D3A] text-[#2F6322] text-[18px] font-bold flex items-center justify-center gap-2 disabled:opacity-30"
                >
                  <span className="text-2xl leading-none">＋</span> 한 줄 더
                </button>
                {rows.length >= MAX_SUBMISSION_ROWS ? (
                  <p className="mt-2 text-center text-[15px] font-bold text-[#B5651D]">
                    한 꼭지에 최대 {MAX_SUBMISSION_ROWS}줄까지 넣을 수 있습니다.
                  </p>
                ) : null}

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={saving || finalizing || !dirty}
                    className="h-14 rounded-2xl border-2 border-[#4F9D3A] bg-white text-[#2F6322] text-[18px] font-bold disabled:opacity-40"
                  >
                    {saving ? '저장 중…' : '저장'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmFinalize(true)}
                    disabled={saving || finalizing || !canFinalize(rows, loaded.status)}
                    className="h-14 rounded-2xl bg-[#1F4E79] text-white text-[18px] font-bold shadow-sm disabled:opacity-40"
                  >
                    {finalizing ? '제출 중…' : '최종 제출'}
                  </button>
                </div>
                <p className="text-[14px] text-[#5A6B73] text-center tr-num">
                  {dirty
                    ? '저장하지 않은 변경이 있습니다.'
                    : savedAt
                      ? `마지막 저장 ${formatClock(savedAt)}`
                      : '아직 저장된 내용이 없습니다.'}
                </p>
              </>
            ) : null}
          </>
        )}
      </div>

      {confirmFinalize ? (
        <div className="fixed inset-0 z-40 bg-[#1F4E79]/55 backdrop-blur-[1px] flex items-center justify-center p-5">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#DCE7EE] overflow-hidden">
            <div className="px-6 pt-6 pb-5 text-center">
              <div
                className="w-14 h-14 mx-auto rounded-2xl bg-[#1F4E79]/10 border border-[#1F4E79]/30 grid place-items-center text-3xl mb-4"
                aria-hidden="true"
              >
                🔒
              </div>
              <Eyebrow className="text-[#1F4E79] mb-2">Confirm</Eyebrow>
              <h4
                className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-1"
                style={{ letterSpacing: '-.01em' }}
              >
                최종 제출할까요?
              </h4>
              <p className="text-[16px] font-bold text-[#4F9D3A] mb-3 break-words">{topic.prompt}</p>
              <p className="text-[18px] font-bold text-[#1F2933] leading-relaxed">
                최종 제출하면 잠깁니다. 잘못 눌렀다면 「다시 열기」로 바로 풀 수 있습니다.
              </p>
              <p className="text-[15px] text-[#5A6B73] mt-3 tr-num">
                지금 화면의 내용 {toSaveItems(rows).length}건이 그대로 제출됩니다.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 pt-0">
              <button
                type="button"
                onClick={() => setConfirmFinalize(false)}
                className="h-[56px] rounded-2xl border border-[#C4D8E4] bg-white text-[#1F4E79] text-[19px] font-bold"
              >
                더 다듬기
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmFinalize(false);
                  void handleFinalize();
                }}
                className="h-[56px] rounded-2xl bg-[#1F4E79] text-white text-[19px] font-bold shadow-sm"
              >
                최종 제출
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1F4E79] text-white text-[16px] font-bold rounded-full px-5 py-3 shadow-lg">
          {toast}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 작성 매뉴얼 — 꼭지가 아직 안 열렸을 때도 보여야 한다. 조 모더레이터가 시작 전에
 * 읽어 두는 것이 이 화면의 절반이기 때문이다. 기본은 펼침이고 접으면 그 상태가 유지된다.
 */
function SubmissionGuide() {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem('climate_vote_guide_collapsed') !== '1';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      sessionStorage.setItem('climate_vote_guide_collapsed', next ? '0' : '1');
    } catch {
      /* 저장 못 해도 토글 자체는 된다 */
    }
  };

  return (
    <section className="rounded-2xl border border-[#C4D8E4] bg-[#F1F7FA] overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <span className="text-[22px]" aria-hidden="true">📖</span>
        <span className="flex-1 min-w-0">
          <span className="block text-[19px] font-extrabold text-[#1F4E79]">작성 안내</span>
          <span className="block text-[14px] text-[#5A6B73]">시작 전에 한 번 읽어 주세요</span>
        </span>
        <span className="text-[20px] text-[#5A6B73]" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <ol className="px-5 pb-5 space-y-3">
          {SUBMISSION_GUIDE.map((item, index) => (
            <li key={item.title} className="flex gap-3">
              <span className="w-7 h-7 shrink-0 rounded-lg bg-white border border-[#C4D8E4] grid place-items-center text-[14px] font-bold text-[#1F4E79] tr-num">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[16px] font-bold text-[#1F2933]">{item.title}</span>
                <span className="block text-[15px] leading-[1.6] text-[#5A6B73]">{item.body}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** 꼭지 바로가기 — 세 구역이 세로로 길어 위아래로 오갈 일이 잦다. */
function TopicJump({ topics }: { topics: Topic[] }) {
  const jump = (topicId: string) => {
    document.getElementById(topicAnchorId(topicId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <nav aria-label="꼭지 바로가기" className="flex flex-wrap gap-2">
      {topics.map((topic) => (
        <button
          key={topic.id}
          type="button"
          onClick={() => jump(topic.id)}
          className="h-12 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79] active:scale-[.99] transition"
        >
          <span className="text-[#4F9D3A] mr-1.5" aria-hidden="true">{ordinalMark(topic.ordinal)}</span>
          {topic.prompt}
        </button>
      ))}
    </nav>
  );
}

/**
 * 우리 조 산출물 내려받기.
 *
 * 본부 보드와 **같은 모델·같은 문서**를 쓴다(submission-report.ts). 조가 받아 본 문서와
 * 본부가 받아 본 문서의 형식이 갈리면, 같은 내용을 두고 어느 쪽이 맞는지 다투게 된다.
 *
 * 조 콘솔에는 본부 취합 RPC가 없으므로, 각 꼭지의 submission_get 결과를 모아
 * 본부 보드와 같은 행 모양(HqSubmissionRow)으로 바꾼 뒤 같은 빌더에 넣는다.
 */
function TeamDownload({
  code,
  teamLabel,
  tableNo,
  topics,
}: {
  code: string;
  teamLabel: string;
  /** 현장 좌석 번호 — 내려받은 표의 「테이블」 칸에 들어간다. */
  tableNo?: string | null;
  topics: Topic[];
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 인쇄 전용 문서. 화면에는 안 보이고 종이에만 나간다.
  const [printReport, setPrintReport] = useState<SubmissionReport | null>(null);

  const collect = async (): Promise<HqSubmissionRow[]> => {
    const rows: HqSubmissionRow[] = [];
    for (const topic of topics) {
      const got = await submissionGet(code, topic.id);
      const items = got?.items ?? [];
      const base = {
        topic_id: topic.id,
        topic_ordinal: topic.ordinal,
        topic_prompt: topic.prompt,
        topic_status: topic.status,
        team_id: code,
        team_name: teamLabel,
        team_subgroup: null,
        table_no: tableNo ?? null,
        submission_id: null,
        submission_status: got?.status ?? null,
        submission_updated_at: got?.updated_at ?? null,
        submission_finalized_at: got?.finalized_at ?? null,
      } as const;
      if (items.length === 0) {
        rows.push({ ...base, item_ordinal: null, item_kind: null, item_content: null, item_rationale: null });
        continue;
      }
      for (const it of items) {
        rows.push({
          ...base,
          item_ordinal: it.ordinal,
          item_kind: it.kind,
          item_content: it.content,
          item_rationale: it.rationale,
        });
      }
    }
    return rows;
  };

  const save = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * 인쇄 — 저장된 내용으로 문서를 만들어 그것만 찍는다.
   * 화면을 그대로 찍으면 안내문·빈 칸·버튼이 종이에 나온다.
   */
  /** 저장된 내용으로 인쇄 문서를 다시 만든다. 실패해도 화면은 그대로 둔다. */
  const refreshPrintReport = useCallback(async () => {
    try {
      setPrintReport(
        buildSubmissionReport(buildBoards(await collect()), {
          generatedAt: formatStamp(new Date()),
          scopeLabel: teamLabel,
        }),
      );
    } catch (caught) {
      console.error('[조 산출물 인쇄] 문서 준비 실패', caught);
    }
    // collect 는 topics·code 에만 기대므로 의존성을 그 둘로 좁힌다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, teamLabel, topics]);

  // 인쇄 문서는 **버튼을 누르기 전부터 DOM에 있어야 한다.**
  // 눌러야 만들어지게 두면 Ctrl+P·브라우저 인쇄 메뉴로 찍을 때 드러낼 것이 없어
  // 백지가 나간다 — 실제로 4쪽 전부 빈 종이가 나왔다.
  useEffect(() => {
    void refreshPrintReport();
    const onChanged = () => void refreshPrintReport();
    window.addEventListener(SUBMISSION_CHANGED, onChanged);
    return () => window.removeEventListener(SUBMISSION_CHANGED, onChanged);
  }, [refreshPrintReport]);

  /**
   * 인쇄 — 저장된 내용으로 문서를 다시 만든 뒤 그것만 찍는다.
   * 화면을 그대로 찍으면 안내문·빈 칸·버튼이 종이에 나온다.
   */
  const doPrint = async () => {
    setBusy(true);
    setError(null);
    try {
      await refreshPrintReport();
      setOpen(false);
      // 문서가 DOM에 붙은 다음에 인쇄창을 연다.
      await new Promise((resolve) => setTimeout(resolve, 150));
      window.print();
    } catch (caught) {
      console.error('[조 산출물 인쇄] 실패', caught);
      setError('인쇄 문서를 만들지 못했습니다 — 저장한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const download = async (kind: 'docx' | 'csv' | 'txt') => {
    setBusy(true);
    setError(null);
    try {
      const report = buildSubmissionReport(buildBoards(await collect()), {
        generatedAt: formatStamp(new Date()),
        scopeLabel: teamLabel,
      });
      if (kind === 'docx') save(await submissionReportBlob(report), reportFileName(report, 'docx'));
      else if (kind === 'csv')
        save(new Blob([reportToCsv(report)], { type: 'text/csv;charset=utf-8' }), reportFileName(report, 'csv'));
      else
        save(new Blob([reportToText(report)], { type: 'text/plain;charset=utf-8' }), reportFileName(report, 'txt'));
      setOpen(false);
    } catch (caught) {
      console.error('[조 산출물 내려받기] 실패', caught);
      setError('내려받지 못했습니다 — 저장한 뒤 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#DCE7EE] bg-white p-4 print:hidden">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-[17px] font-extrabold text-[#1F4E79]">우리 조 산출물 내려받기</h4>
          <p className="text-[14px] text-[#5A6B73]">
            저장한 내용을 그대로 받습니다. 아직 저장하지 않은 글은 담기지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="h-12 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[16px] font-bold text-[#1F4E79]"
        >
          내려받기 ▾
        </button>
      </div>
      {open ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          <button type="button" disabled={busy} onClick={() => void download('docx')}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            워드 (.docx)
          </button>
          <button type="button" disabled={busy} onClick={() => void download('csv')}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            엑셀 (.csv)
          </button>
          <button type="button" disabled={busy} onClick={() => void download('txt')}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            줄글 (.txt)
          </button>
          <button type="button" disabled={busy} onClick={() => void doPrint()}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[15px] font-bold text-[#1F4E79] disabled:opacity-40">
            인쇄 · PDF로 저장
            <span className="mt-0.5 block text-[12px] font-normal text-[#5A6B73]">
              인쇄창에서 프린터 또는 「PDF로 저장」을 고르세요
            </span>
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-[#FFF4D6] px-3 py-2 text-[14px] font-bold text-[#6B4B00]">
          {error}
        </p>
      ) : null}
      {printReport ? <PrintableReport report={printReport} /> : null}
    </section>
  );
}

export default function SubmissionPanel({
  code,
  teamLabel,
  tableNo,
}: {
  code: string | null;
  /** 내려받은 문서에 찍을 조 이름. 없으면 「우리 조」. */
  teamLabel?: string;
  /** 현장 좌석 번호. 내려받은 표의 「테이블」 칸에 들어간다. */
  tableNo?: string | null;
}) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [topicsFailed, setTopicsFailed] = useState(false);

  const loadTopics = useCallback(async () => {
    if (!code) return;
    try {
      setTopics(await topicList(code));
      setTopicsFailed(false);
    } catch {
      setTopicsFailed(true);
    }
  }, [code]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  if (!code) {
    return <p className="text-[16px] text-[#5A6B73]">조 접속 후에 사용할 수 있습니다.</p>;
  }

  if (topicsFailed && topics == null) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3">
        <span className="text-[16px] font-extrabold text-[#B5651D] flex-1 min-w-[200px]">
          작성 화면을 불러오지 못했습니다 — 네트워크를 확인해 주세요.
        </span>
        <button
          type="button"
          onClick={() => void loadTopics()}
          className="min-h-11 rounded-lg border-2 border-[#B5651D] px-4 text-[15px] font-bold text-[#B5651D]"
        >
          지금 다시 시도
        </button>
      </div>
    );
  }

  if (topics == null) {
    return <p className="text-[16px] text-[#5A6B73]">불러오는 중…</p>;
  }

  // 준비 전에도 매뉴얼은 보여 준다 — 시작 전에 읽어 두는 것이 이 화면의 절반이다.
  if (topics.length === 0) {
    return (
      <div className="space-y-5">
        <SubmissionGuide />
        <div className="rounded-2xl border border-[#DCE7EE] bg-[#F5F8FB] px-5 py-8 text-center">
          <p className="text-[17px] font-bold text-[#1F4E79]">작성 화면 준비 중입니다.</p>
          <button
            type="button"
            onClick={() => void loadTopics()}
            className="mt-4 min-h-12 rounded-xl border border-[#C4D8E4] bg-white px-5 text-[16px] font-bold text-[#1F4E79]"
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SubmissionGuide />
      <TopicJump topics={topics} />
      {topics.map((topic) => (
        <TopicSection key={topic.id} code={code} topic={topic} />
      ))}
      <TeamDownload code={code} teamLabel={teamLabel ?? '우리 조'} tableNo={tableNo} topics={topics} />
    </div>
  );
}
