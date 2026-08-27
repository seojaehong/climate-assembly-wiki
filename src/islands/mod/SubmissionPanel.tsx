import { useCallback, useEffect, useState } from 'react';
import {
  submissionFinalize,
  submissionGet,
  submissionSave,
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
  removeRow,
  rowsFromItems,
  submissionBadge,
  toSaveItems,
  type EditorRow,
} from './submission-panel-logic';

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
  const [toast, setToast] = useState<string | null>(null);

  const dirty = isDirty(rows, baseline);
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
      setRows(nextRows);
      setBaseline(nextRows);
      setSavedAt(result.updated_at ?? null);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [code, topic.id]);

  useEffect(() => {
    void loadSubmission();
  }, [loadSubmission]);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setToast(
        message.includes('finalized')
          ? '이미 최종 제출된 상태입니다 — 본부에 재오픈을 요청하세요.'
          : message.includes('not open')
            ? '이 꼭지는 마감되어 저장할 수 없습니다.'
            : '저장에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.',
      );
    } finally {
      setSaving(false);
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
    } catch {
      setToast('최종 제출에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden">
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
              <p className="text-[15px] font-semibold text-[#5A6B73]">
                수정이 필요하면 본부에 재오픈을 요청하세요.
              </p>
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
                          onClick={() => setRows((prev) => removeRow(prev, index))}
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
                    rows={2}
                    placeholder="여기에 적습니다"
                    className={`w-full min-w-0 rounded-xl border px-3 py-2.5 text-[17px] outline-none resize-y ${
                      editable
                        ? 'border-[#C4D8E4] focus:border-[#4F9D3A] text-[#1F2933]'
                        : 'border-[#DCE7EE] bg-[#F5F8FB] text-[#5A6B73]'
                    }`}
                  />
                  <textarea
                    value={row.rationale}
                    readOnly={!editable}
                    onChange={(e) =>
                      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, rationale: e.target.value } : r)))
                    }
                    rows={2}
                    placeholder="근거 (선택)"
                    className={`w-full min-w-0 rounded-xl border px-3 py-2.5 text-[16px] outline-none resize-y ${
                      editable
                        ? 'border-[#C4D8E4] focus:border-[#4F9D3A] text-[#1F2933]'
                        : 'border-[#DCE7EE] bg-[#F5F8FB] text-[#5A6B73]'
                    }`}
                  />
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
              <p className="text-[18px] font-bold text-[#1F2933] leading-relaxed">{FINALIZE_CONFIRM_MESSAGE}</p>
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

export default function SubmissionPanel({ code }: { code: string | null }) {
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

  // 준비 전에는 운영 사정을 시민 화면에 늘어놓지 않는다 — 한 줄로 끝낸다.
  if (topics.length === 0) {
    return (
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
    );
  }

  return (
    <div className="space-y-5">
      {topics.map((topic) => (
        <TopicSection key={topic.id} code={code} topic={topic} />
      ))}
    </div>
  );
}
