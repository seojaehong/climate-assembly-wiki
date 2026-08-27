import { useState } from 'react';
import { noteColor, type Note } from './hq-submission-board-logic';
import type { RepresentativeGroup } from './representative-groups';
import { pickedGroupCount } from './representative-groups';
import {
  pickHistory,
  representativeOf,
  type RepresentativeActor,
  type RepresentativeState,
} from './representative-pick';

/**
 * L4 — 묶음의 **대표 문장 지목** 화면.
 *
 * 설계문서 §4 는 「**L4는 도구에 버튼을 만들지 않는다.** 대표 지목은 시민 앞에서 시민이 한다」고 적었다.
 * 이 화면은 그 문장을 어기는 것이 아니라 **그 문장을 지키는 장치**로만 존재한다 —
 * 여기서 하는 일은 「고르기」가 아니라 시민이 눈앞에서 고른 것을 **그대로 옮겨 적는 것**이다.
 * 그래서 화면이 세 가지를 강제한다.
 *
 * 1. **모더레이터 단독으로는 아무것도 기록되지 않는다.** 「시민이 고른 것입니다」를 체크하지 않고
 *    누르면 `pickRepresentative` 가 `moderator-alone` 으로 튕기고, 화면은 그 이유를 그대로 보여준다
 *    (예외를 삼키지 않는다 — **왜 안 되는지가 이 화면의 요점**이다).
 * 2. **후보는 그 묶음에 든 원문 카드뿐이다.** 문장을 적어 넣는 칸이 없다 — 이 API 는 카드 id 만 받는다.
 * 3. **대표가 나머지를 대체하지 않는다.** 지목된 카드에 이름표가 하나 붙을 뿐 나머지 카드는
 *    묶음에도, 그리드에도, 카운터에도 그대로 남는다.
 *
 *   묶어도 카드 수는 줄지 않는다.
 *
 * ★ 이 파일의 카드 발췌는 `<article>` 이 아니라 `<li>`·`<div>` 로 낸다 — 포스트잇이 `<article>` 이라
 * 같은 태그를 쓰면 「카드 N장」을 세는 브라우저 검증이 조용히 부풀어 통과한다(US-005 기록).
 */

/** 대표 표시 색. 조 색(noteColor)·짝 번호(남색)·범주 배지(4색)와 겹치지 않는 자주색. */
const REPRESENTATIVE_TONE = '#6B2D5C';

/** ISO → 「8/29 16:30」. 이력에 「언제」를 사람이 읽는 형태로 남긴다. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 포스트잇에 붙는 대표 이름표. 번호는 묶음 번호라 카드의 「닮은 짝 N」과 같은 것을 가리킨다.
 * 대표가 아닌 카드에는 아무것도 붙지 않을 뿐이고 카드는 그대로 있다.
 */
export function RepresentativeBadge({ marks }: { marks: number[] }) {
  return (
    <div className="flex flex-wrap gap-1" data-testid="representative-marks">
      {marks.map((n) => (
        <span
          key={n}
          data-testid="representative-badge"
          className="rounded-full px-2 py-[2px] text-[12px] font-extrabold text-white"
          style={{ background: REPRESENTATIVE_TONE }}
        >
          대표 · 짝 {n}
        </span>
      ))}
    </div>
  );
}

/** 지목 확인 창. 여기를 거치지 않고는 어떤 지목도 기록되지 않는다. */
function PickDialog({
  note,
  ordinal,
  onCancel,
  onSubmit,
}: {
  note: Note;
  ordinal: number;
  onCancel: () => void;
  onSubmit: (actor: RepresentativeActor) => string | null;
}) {
  const [label, setLabel] = useState('');
  const [citizenConfirmed, setCitizenConfirmed] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const submit = () => {
    // ★ 시각은 조작이 일어난 이 자리에서 찍는다 — 순수 로직(representative-pick.ts)은 시계를 읽지 않는다.
    const message = onSubmit({
      kind: 'moderator',
      label: label.trim(),
      at: new Date().toISOString(),
      citizenConfirmed,
    });
    setFailed(message);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1F4E79]/55 p-5">
      <div
        role="dialog"
        aria-label="대표 문장 지목 확인"
        data-testid="representative-dialog"
        className="w-full max-w-lg rounded-2xl border border-[#DCE7EE] bg-white p-6"
      >
        <h4 className="text-[21px] font-extrabold" style={{ color: REPRESENTATIVE_TONE }}>
          짝 {ordinal} 의 대표 문장 지목
        </h4>
        <p className="mt-2 text-[15px] leading-[1.6] text-[#5A6B73]">
          아래 <b>원문 카드</b>를 이 묶음의 대표로 기록합니다. 문장은 고치지 않고 그대로 남으며,
          대표가 아닌 카드도 사라지지 않습니다.
        </p>

        {/* 읽기 전용 발췌 — 문장을 적어 넣는 칸은 이 화면 어디에도 없다. */}
        <div
          data-testid="representative-dialog-note"
          className="mt-3 rounded-[6px] p-3"
          style={{ background: noteColor(note.teamName) }}
        >
          <div className="mb-1 text-[14px] font-extrabold text-[#1f2937]">{note.teamName}</div>
          <p className="whitespace-pre-wrap text-[16px] font-semibold leading-[1.45] text-[#1f2937]">
            {note.content}
          </p>
        </div>

        <label className="mt-4 block text-[15px] font-bold text-[#1F2933]">
          누가 골랐습니까
          <input
            type="text"
            value={label}
            data-testid="representative-actor-label"
            onChange={(e) => setLabel(e.target.value)}
            placeholder="예: 1분과 2조 시민들"
            className="mt-1 h-12 w-full rounded-xl border border-[#C4D8E4] px-3 text-[16px] font-normal"
          />
        </label>

        <label className="mt-4 flex items-start gap-3 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[15px] font-bold leading-[1.6] text-[#6B4B00]">
          <input
            type="checkbox"
            checked={citizenConfirmed}
            data-testid="representative-citizen-confirm"
            onChange={(e) => setCitizenConfirmed(e.target.checked)}
            className="mt-1 h-5 w-5"
          />
          <span>
            시민이 고른 것입니다 — 모더레이터가 대신 고른 것이 아니라, 시민 앞에서 시민이 고른 것을
            기록합니다.
          </span>
        </label>

        {failed ? (
          <p
            role="alert"
            data-testid="representative-error"
            className="mt-3 rounded-xl bg-[#FBEEE2] px-4 py-3 text-[15px] font-bold leading-[1.6] text-[#B5651D]"
          >
            {failed}
          </p>
        ) : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="h-12 rounded-xl border border-[#C4D8E4] text-[16px] font-bold text-[#5A6B73]"
          >
            취소
          </button>
          <button
            type="button"
            data-testid="representative-confirm"
            onClick={submit}
            className="h-12 rounded-xl text-[16px] font-extrabold text-white"
            style={{ background: REPRESENTATIVE_TONE }}
          >
            시민의 선택으로 기록
          </button>
        </div>
      </div>
    </div>
  );
}

export function RepresentativePanel({
  groups,
  notesById,
  state,
  onPick,
}: {
  groups: readonly RepresentativeGroup[];
  notesById: Map<string, Note>;
  state: RepresentativeState;
  /** 지목을 시도한다. 성립하지 않으면 화면에 낼 한국어 안내를 돌려준다(성공이면 null). */
  onPick: (groupId: string, noteId: string, actor: RepresentativeActor) => string | null;
}) {
  // ★ 기본은 **접힘**이다 — 카운터·짝 패널·4범주 패널이 이미 그리드를 아래로 밀어냈다(US-008 기록).
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ group: RepresentativeGroup; noteId: string } | null>(
    null,
  );
  const picked = pickedGroupCount(state, groups);

  const submitPending = (actor: RepresentativeActor): string | null => {
    if (!pending) return null;
    const message = onPick(pending.group.groupId, pending.noteId, actor);
    if (message === null) setPending(null);
    return message;
  };

  const pendingNote = pending ? notesById.get(pending.noteId) : null;

  return (
    <section
      aria-label="대표 문장 지목"
      data-testid="representative-panel"
      className="mb-5 rounded-2xl border p-4"
      style={{ borderColor: '#E0CFDC', background: '#FFFCFE' }}
    >
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="text-[20px] font-extrabold" style={{ color: REPRESENTATIVE_TONE }}>
          대표 문장 지목{' '}
          <span className="tr-num text-[#23B2C3]">{groups.length}</span>묶음
        </h3>
        <span data-testid="representative-picked-count" className="text-[16px] font-bold text-[#5A6B73]">
          지목됨 <span className="tr-num" style={{ color: REPRESENTATIVE_TONE }}>{picked}</span>묶음
        </span>
        <button
          type="button"
          aria-expanded={open}
          data-testid="representative-toggle"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto h-11 rounded-xl border border-[#C4D8E4] bg-white px-4 text-[15px] font-bold text-[#1F4E79]"
        >
          {open ? '접기' : '펼치기'}
        </button>
      </header>

      {/* 접어도 남는다 — 접힌 화면을 캡처해도 「시민이 고른다」가 읽혀야 한다. */}
      <p className="mt-2 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[15px] leading-[1.6] text-[#6B4B00]">
        <b>지목은 시민이 합니다 — 모더레이터는 기록만 합니다.</b> 모더레이터가 고르면 회의자료
        260811 이 금지한 「좋은 의견 선정」이 됩니다. 이 화면은 시민 앞에서 시민이 고른 것을 그대로
        옮겨 적는 자리이고, 새 문장을 쓰는 칸은 없습니다. 대표로 지목되지 않은 카드도 그대로 남습니다
        — <b>대표는 나머지를 대체하지 않습니다.</b>
      </p>

      {open ? (
        groups.length === 0 ? (
          <p data-testid="representative-empty" className="mt-3 text-[16px] text-[#5A6B73]">
            아직 묶음이 없습니다. 위 「닮은 짝」 패널에서 ✓ 를 누르면 그 짝이 묶음이 되고, 여기에서
            대표를 지목할 수 있습니다.
          </p>
        ) : (
          <ul className="mt-3 grid max-h-[520px] gap-3 overflow-y-auto">
            {groups.map((group) => {
              const members = group.memberIds
                .map((id) => notesById.get(id))
                .filter((n): n is Note => Boolean(n));
              const current = representativeOf(state, group.groupId);
              const entries = pickHistory(state, group.groupId);
              return (
                <li
                  key={group.groupId}
                  data-testid="representative-group"
                  data-group-id={group.groupId}
                  data-picked={current ?? ''}
                  className="rounded-xl border border-[#E0CFDC] bg-white p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <span
                      className="text-[15px] font-extrabold tr-num"
                      style={{ color: REPRESENTATIVE_TONE }}
                    >
                      짝 {group.ordinal}
                    </span>
                    <span className="text-[14px] font-bold text-[#5A6B73] tr-num">
                      카드 {members.length}장
                    </span>
                    {current ? null : (
                      <span className="text-[14px] font-bold text-[#B5651D]">아직 지목 안 됨</span>
                    )}
                  </div>

                  <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
                    {members.map((note) => {
                      const isRep = current === note.id;
                      return (
                        <div
                          key={note.id}
                          data-testid="representative-candidate"
                          data-note-id={note.id}
                          data-representative={isRep ? 'true' : 'false'}
                          className="rounded-[6px] border-2 p-3"
                          style={{
                            background: noteColor(note.teamName),
                            borderColor: isRep ? REPRESENTATIVE_TONE : 'transparent',
                          }}
                        >
                          {isRep ? (
                            <span
                              className="mb-1 inline-block rounded-full px-2 py-[2px] text-[12px] font-extrabold text-white"
                              style={{ background: REPRESENTATIVE_TONE }}
                            >
                              대표
                            </span>
                          ) : null}
                          <div className="mb-1 text-[14px] font-extrabold text-[#1f2937]">
                            {note.teamName}
                          </div>
                          <p className="whitespace-pre-wrap text-[16px] font-semibold leading-[1.45] text-[#1f2937]">
                            {note.content}
                          </p>
                          <button
                            type="button"
                            data-testid="representative-pick-button"
                            data-note-id={note.id}
                            onClick={() => setPending({ group, noteId: note.id })}
                            className="mt-2 h-11 w-full rounded-xl border-2 bg-white/80 px-3 text-[15px] font-bold"
                            style={{ borderColor: REPRESENTATIVE_TONE, color: REPRESENTATIVE_TONE }}
                          >
                            {isRep ? '대표 — 다시 지목' : '이 문장을 대표로'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {entries.length > 0 ? (
                    <ol
                      data-testid="representative-history"
                      className="mt-2 grid gap-1 border-t border-[#E0CFDC] pt-2"
                    >
                      {entries.map((entry, index) => (
                        <li
                          key={`${entry.at}-${index}`}
                          className="text-[14px] leading-[1.5] text-[#5A6B73]"
                        >
                          <span className="font-bold" style={{ color: REPRESENTATIVE_TONE }}>
                            {entry.actorLabel}
                          </span>{' '}
                          <span className="tr-num">{stamp(entry.at)}</span> ·{' '}
                          {notesById.get(entry.noteId)?.content.slice(0, 24) ?? entry.noteId}…
                          {entry.actorKind === 'moderator' ? ' (모더레이터 대리 기록)' : ''}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {pending && pendingNote ? (
        <PickDialog
          note={pendingNote}
          ordinal={pending.group.ordinal}
          onCancel={() => setPending(null)}
          onSubmit={submitPending}
        />
      ) : null}
    </section>
  );
}
