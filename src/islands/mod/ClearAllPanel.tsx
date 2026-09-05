import { useEffect, useRef, useState } from 'react';
import { CLEAR_CONFIRM_PHRASE, clearAllSubmissions,
  CURRENT_SESSION_SLUG,
  type HqExpectedSubmission,
} from '../../lib/hq-submissions';
import { resolveHqClearIntent, type HqAssignmentIntent } from './hq-submission-board-logic';

/**
 * 조별 산출물 전체 비우기 — 8.29 오전 연습 값을 오후 본 숙의 전에 치운다.
 *
 * ── 이 버튼이 하는 일의 무게 ─────────────────────────────────────────
 * 15개 조가 쓴 글을 한 번에 지운다. 그럼에도 두는 이유는 대안이 「본부가 SQL Editor에서
 * delete 를 직접 친다」이기 때문이다. 그쪽이 훨씬 위험하다 — where 절 하나 틀리면
 * 되돌릴 수 없고 누가 언제 했는지도 안 남는다.
 *
 * ── 세 겹의 방어 ─────────────────────────────────────────────────────
 *   1) 평소에는 **접혀 있다.** 「위험한 조작」을 눌러야 나온다
 *   2) 확인 문구를 **직접 타이핑**해야 한다. 잘못 누른 클릭으로는 절대 안 지워진다
 *   3) 지운 문장은 아카이브에 남는다 — 되살리는 것은 SQL 한 줄이다
 *
 * 색은 경고색을 쓰되 다른 버튼과 모양을 확실히 다르게 한다. 행사장에서 손이 미끄러져
 * 눌리는 자리에 두지 않는다는 뜻이다.
 */
export default function ClearAllPanel({
  token,
  expectedSubmissions,
  onRefresh,
}: {
  token: string;
  expectedSubmissions: HqExpectedSubmission[] | null;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const intentRef = useRef<HqAssignmentIntent | undefined>(undefined);
  const credentialEpochRef = useRef(0);

  useEffect(() => {
    credentialEpochRef.current += 1;
    intentRef.current = undefined;
    setOpen(false);
    setPhrase('');
    setBusy(false);
    setMessage(null);
    setFailed(null);
    return () => {
      credentialEpochRef.current += 1;
    };
  }, [token]);

  const armed = phrase.trim() === CLEAR_CONFIRM_PHRASE && expectedSubmissions !== null;

  const run = async () => {
    if (!armed || busy) return;
    setBusy(true);
    setFailed(null);
    setMessage(null);
    if (!expectedSubmissions) {
      setFailed('현재 제출물 세대를 확인하지 못해 비우기를 중단했습니다. 보드를 다시 불러와 주세요.');
      setBusy(false);
      return;
    }
    const intent = resolveHqClearIntent(
      intentRef.current,
      CURRENT_SESSION_SLUG,
      expectedSubmissions,
    );
    intentRef.current = intent;
    const credentialEpoch = credentialEpochRef.current;
    try {
      const result = await clearAllSubmissions(token, CURRENT_SESSION_SLUG, {
        confirmPhrase: phrase.trim(),
        expectedSubmissions,
        idempotencyKey: intent.idempotencyKey,
      });
      if (credentialEpochRef.current !== credentialEpoch) return;
      intentRef.current = undefined;
      if (result.status === 'conflict') {
        setPhrase('');
        await onRefresh();
        if (credentialEpochRef.current !== credentialEpoch) return;
        setFailed(
          '제출물이 변경되어 아무것도 비우지 않았습니다. 최신 목록을 확인한 뒤 확인 문구를 다시 입력해 주세요.',
        );
        return;
      }
      setPhrase('');
      await onRefresh();
      if (credentialEpochRef.current !== credentialEpoch) return;
      setMessage(
        `${result.cleared_items}건을 비웠습니다. 지운 문장은 보관돼 있어 필요하면 되살릴 수 있습니다.`,
      );
    } catch (error: unknown) {
      if (credentialEpochRef.current !== credentialEpoch) return;
      setFailed(error instanceof Error ? error.message : '비우지 못했습니다.');
    } finally {
      if (credentialEpochRef.current === credentialEpoch) setBusy(false);
    }
  };

  return (
    <section
      aria-label="위험한 조작"
      data-testid="clear-all-panel"
      className="mb-5 rounded-2xl border-2 border-[#C9A227] bg-[#FFFBF0] p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[18px] font-extrabold text-[#8A5A00]">위험한 조작</h3>
        <p className="text-[15px] text-[#6B4B00]">
          연습으로 넣은 값을 본 숙의 전에 한 번에 치웁니다.
        </p>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            setPhrase('');
            setFailed(null);
          }}
          className="ml-auto h-11 rounded-xl border-2 border-[#C9A227] bg-white px-4 text-[15px] font-bold text-[#8A5A00]"
        >
          {open ? '닫기' : '열기'}
        </button>
      </div>

      {open ? (
        <div className="mt-4 rounded-xl border border-[#E4C97A] bg-white p-4">
          <p className="text-[16px] font-bold leading-[1.6] text-[#1F2933]">
            15개 조가 쓴 <b className="text-[#B5651D]">모든 문장을 지웁니다.</b> 조 구성과 꼭지는
            그대로 남고, 조는 빈 화면에서 다시 쓰면 됩니다.
          </p>
          <p className="mt-2 text-[15px] leading-[1.6] text-[#5A6B73]">
            지운 문장은 보관됩니다 — 실수로 눌렀다면 되살릴 수 있습니다. 다만 되살리려면 개발자가
            직접 손을 대야 하므로, 정말 지울 때만 진행하세요.
          </p>
          {expectedSubmissions === null ? (
            <p role="alert" className="mt-3 rounded-lg bg-[#FFF4D6] px-3 py-2 text-[15px] font-bold text-[#6B4B00]">
              현재 제출물 세대를 확인하지 못해 비우기를 잠갔습니다. 위의 「지금 다시 연결」로 보드를
              갱신해 주세요.
            </p>
          ) : (
            <p className="mt-3 text-[14px] font-bold text-[#526975]">
              현재 확인된 제출물 {expectedSubmissions.length}개가 모두 그대로일 때만 실행됩니다.
            </p>
          )}

          <label className="mt-4 block text-[15px] font-bold text-[#334E5C]">
            지우려면 「{CLEAR_CONFIRM_PHRASE}」라고 그대로 입력하세요
            <input
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={CLEAR_CONFIRM_PHRASE}
              aria-label="확인 문구"
              className="mt-1 min-h-12 w-full max-w-sm rounded-xl border-2 border-[#C4D8E4] px-3 text-[17px]"
            />
          </label>

          <button
            type="button"
            disabled={!armed || busy}
            onClick={() => void run()}
            className={`mt-3 h-12 rounded-xl px-5 text-[16px] font-extrabold ${
              armed && !busy
                ? 'bg-[#B5651D] text-white'
                : 'cursor-not-allowed border border-[#DCE7EE] bg-[#F1F5F8] text-[#8FA3AD]'
            }`}
          >
            {busy ? '비우는 중…' : '전체 비우기'}
          </button>
        </div>
      ) : null}

      {message ? (
        <p role="status" className="mt-3 rounded-lg bg-[#E8F4EA] px-3 py-2 text-[15px] font-bold text-[#1F5B2E]">
          {message}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-3 rounded-lg bg-[#FFF4D6] px-3 py-2 text-[15px] font-bold text-[#6B4B00]">
          {failed}
        </p>
      ) : null}
    </section>
  );
}
