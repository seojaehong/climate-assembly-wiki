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
  LEAVE_CONFIRM_MESSAGE,
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

export default function SubmissionPanel({ code }: { code: string | null }) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [topicsFailed, setTopicsFailed] = useState(false);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
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
  const selectedTopic = (topics ?? []).find((t) => t.id === selectedTopicId) ?? null;
  const badge = submissionBadge(loaded?.status ?? null);
  // 편집 가능 = 제출물이 잠기지 않았고(final 아님) 주제가 아직 open일 때.
  const topicOpen = selectedTopic?.status === 'open';
  const editable = loaded != null && isEditable(loaded.status) && topicOpen;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // 주제 목록 로드 — 최초 1회 + 실패 시 재시도 버튼.
  const loadTopics = useCallback(async () => {
    if (!code) return;
    try {
      const list = await topicList(code);
      setTopics(list);
      setTopicsFailed(false);
      // 최초 로드에서 첫 주제를 자동 선택한다(탭이 비어 있는 화면 방지).
      setSelectedTopicId((current) => current ?? list[0]?.id ?? null);
    } catch {
      setTopicsFailed(true);
    }
  }, [code]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  // 선택 주제의 제출물 로드.
  const loadSubmission = useCallback(async () => {
    if (!code || !selectedTopicId) return;
    try {
      const result = await submissionGet(code, selectedTopicId);
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
  }, [code, selectedTopicId]);

  useEffect(() => {
    setLoaded(null);
    setLoadFailed(false);
    void loadSubmission();
  }, [loadSubmission]);

  // 저장 전 이탈(새로고침·탭 닫기) confirm — 자동 저장이 없으므로 이 방어선이 유일하다.
  useEffect(() => {
    if (!dirty || !editable) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, editable]);

  const selectTopic = (topicId: string) => {
    if (topicId === selectedTopicId) return;
    if (dirty && editable && !window.confirm(LEAVE_CONFIRM_MESSAGE)) return;
    setSelectedTopicId(topicId);
  };

  const handleSave = async () => {
    if (!code || !selectedTopicId || !editable) return;
    setSaving(true);
    try {
      await submissionSave(code, selectedTopicId, toSaveItems(rows));
      setToast('저장되었습니다. 최종 제출 전까지 계속 고칠 수 있습니다.');
      await loadSubmission();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setToast(
        message.includes('finalized')
          ? '이미 최종 제출된 상태입니다 — 본부에 재오픈을 요청하세요.'
          : message.includes('not open')
            ? '이 주제는 마감되어 저장할 수 없습니다.'
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
    if (!code || !selectedTopicId || !editable) return;
    setFinalizing(true);
    try {
      await submissionSave(code, selectedTopicId, toSaveItems(rows));
      await submissionFinalize(code, selectedTopicId);
      setToast('최종 제출되었습니다.');
      await loadSubmission();
    } catch {
      setToast('최종 제출에 실패했습니다 — 네트워크를 확인하고 다시 시도해 주세요.');
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#DCE7EE] bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-6 py-4 bg-[#4F9D3A]/8 border-b border-[#DCE7EE]">
        <span
          className="w-11 h-11 rounded-xl bg-[#4F9D3A] grid place-items-center text-white text-2xl"
          aria-hidden="true"
        >
          📝
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[22px] font-extrabold text-[#1F4E79]" style={{ letterSpacing: '-.01em' }}>
            조별 산출물
          </h3>
          <p className="text-[14px] text-[#5A6B73]">주제별 핵심의견을 기록하고 최종 제출합니다</p>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-4">
        {!code ? (
          <p className="text-[16px] text-[#5A6B73]">조 접속 후에 사용할 수 있습니다.</p>
        ) : topicsFailed && topics == null ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#F5A623] bg-[#F5A623]/10 px-4 py-3">
            <span className="text-[16px] font-extrabold text-[#B5651D] flex-1 min-w-[200px]">
              토론 주제를 불러오지 못했습니다 — 네트워크를 확인해 주세요.
            </span>
            <button
              type="button"
              onClick={() => void loadTopics()}
              className="min-h-11 rounded-lg border-2 border-[#B5651D] px-4 text-[15px] font-bold text-[#B5651D]"
            >
              지금 다시 시도
            </button>
          </div>
        ) : topics == null ? (
          <p className="text-[16px] text-[#5A6B73]">불러오는 중…</p>
        ) : topics.length === 0 ? (
          <p className="text-[16px] text-[#5A6B73]">
            아직 열린 토론 주제가 없습니다. 본부에서 주제를 열면 여기에 나타납니다.
          </p>
        ) : (
          <>
            {/* 주제 탭 */}
            <div className="flex flex-wrap gap-2">
              {topics.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => selectTopic(topic.id)}
                  className={`h-11 rounded-xl border px-3.5 text-[15px] font-bold ${
                    topic.id === selectedTopicId
                      ? 'border-[#4F9D3A] bg-[#4F9D3A]/10 text-[#2F6322]'
                      : 'border-[#C4D8E4] bg-white text-[#5A6B73]'
                  }`}
                >
                  주제 {topic.ordinal}
                  {topic.status === 'closed' ? ' · 마감' : ''}
                </button>
              ))}
            </div>

            {selectedTopic ? (
              <div className="rounded-xl border border-[#DCE7EE] bg-[#F5F8FB] px-4 py-3">
                <p className="text-[17px] font-bold text-[#1F2933] break-words">{selectedTopic.prompt}</p>
                {selectedTopic.guidance ? (
                  <p className="mt-1 text-[15px] text-[#5A6B73] break-words">{selectedTopic.guidance}</p>
                ) : null}
              </div>
            ) : null}

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
                {/* 상태 배지 + 잠금 안내 */}
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
                    이 주제는 마감되어 더 이상 저장할 수 없습니다.
                  </p>
                ) : null}

                {/* 핵심의견 행 편집기 */}
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
                              aria-label={`의견 ${index + 1} 위로`}
                              className="w-10 h-10 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-lg grid place-items-center disabled:opacity-30"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => setRows((prev) => moveRow(prev, index, 1))}
                              disabled={index === rows.length - 1}
                              aria-label={`의견 ${index + 1} 아래로`}
                              className="w-10 h-10 rounded-lg border border-[#DCE7EE] text-[#5A6B73] text-lg grid place-items-center disabled:opacity-30"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => setRows((prev) => removeRow(prev, index))}
                              aria-label={`의견 ${index + 1} 삭제`}
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
                        placeholder="핵심의견 내용"
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
                      <span className="text-2xl leading-none">＋</span> 의견 추가
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
                className="text-[22px] font-extrabold text-[#1F4E79] leading-snug mb-3"
                style={{ letterSpacing: '-.01em' }}
              >
                최종 제출할까요?
              </h4>
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
