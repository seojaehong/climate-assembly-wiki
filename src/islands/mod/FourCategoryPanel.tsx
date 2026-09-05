import { useState } from 'react';
import {
  FOUR_CATEGORIES,
  FOUR_CATEGORY_LABELS,
  countsByCategory,
  preservationTone,
  type CategoryState,
  type FourCategory,
  type PreservationReport,
} from './four-category';
import { noteColor, type Note } from './hq-submission-board-logic';

/**
 * L3 — 4범주 **잠정** 구조화 화면.
 *
 * 회의자료 260811 이 총괄모더레이터에게 맡긴 일은 「공통·차이·갈등·질문으로 **잠정** 비교·구조화」이고,
 * 같은 표가 금지한 것은 「조별 결과 임의 통합」·「좋은 의견 선정」·「소수의견 삭제」다.
 * 그래서 이 화면은 카드를 **어디로도 옮기지 않는다** — 카드는 제자리에 있고 이름표만 얹힌다.
 *
 *   묶어도 카드 수는 줄지 않는다.
 *
 * 그 사실을 매번 숫자로 보여주는 것이 `PreservationCounter` 다(설계문서 §4).
 *
 * ★ 이 파일의 카드 발췌는 `<article>` 이 아니라 `<li>`·`<div>` 로 낸다 — 포스트잇이 `<article>` 이라
 * 같은 태그를 쓰면 「카드 N장」을 세는 브라우저 검증이 조용히 부풀어 통과한다(US-005 기록).
 */

/** 범주마다 고정 색. 조 색(noteColor)과 겹치지 않게 테두리·글씨로만 구분한다. */
const CATEGORY_TONE: Record<FourCategory, { border: string; text: string; bg: string }> = {
  common: { border: '#1F4E79', text: '#1F4E79', bg: '#EAF2F8' },
  difference: { border: '#0F6B78', text: '#0F6B78', bg: '#E3F2F5' },
  conflict: { border: '#8A4512', text: '#8A4512', bg: '#FBEEE2' },
  question: { border: '#6B4B00', text: '#6B4B00', bg: '#FFF4D6' },
};

/**
 * 「원문 N장 · 배정 M장 · 미배정 K장 · 삭제 0장」.
 *
 * **접히지 않고 항상 보인다.** 이것이 「모으지 않았다」의 증명이라 조작 중 어느 순간에도
 * 가려지면 안 된다. 미배정은 눈에 띄게 둔다 — 아무 범주에도 안 들어간 소수의견이
 * 조용히 사라지지 않게 하는 장치다.
 */
export function PreservationCounter({ report }: { report: PreservationReport }) {
  const danger = preservationTone(report) === 'danger';
  return (
    <div
      data-testid="preservation-counter"
      className={`mb-5 rounded-2xl border px-4 py-3 ${
        danger ? 'border-[#8A4512] bg-[#FBEEE2]' : 'border-[#DCE7EE] bg-white'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className="text-[17px] font-bold text-[#5A6B73]">
          원문 <span className="text-[24px] font-extrabold text-[#1F4E79] tr-num">{report.originalCount}</span>장
        </span>
        <span className="text-[17px] font-bold text-[#5A6B73]">
          · 배정 <span className="text-[24px] font-extrabold text-[#1F4E79] tr-num">{report.assignedCount}</span>장
        </span>
        <span
          data-testid="unassigned-count"
          className={`rounded-xl px-3 py-1 text-[17px] font-bold ${
            report.unassignedCount > 0 ? 'bg-[#FFF4D6] text-[#6B4B00]' : 'text-[#5A6B73]'
          }`}
        >
          · 미배정{' '}
          <span
            className={`text-[24px] font-extrabold tr-num ${
              report.unassignedCount > 0 ? 'text-[#8A4512]' : 'text-[#1F4E79]'
            }`}
          >
            {report.unassignedCount}
          </span>
          장
        </span>
        <span
          data-testid="deleted-count"
          className={`text-[17px] font-bold ${danger ? 'text-[#8A4512]' : 'text-[#5A6B73]'}`}
        >
          · 삭제{' '}
          <span className={`text-[24px] font-extrabold tr-num ${danger ? 'text-[#8A4512]' : 'text-[#1F4E79]'}`}>
            {report.deletedCount}
          </span>
          장
        </span>
      </div>
      {danger ? (
        <p role="alert" className="mt-2 text-[15px] font-bold leading-[1.6] text-[#8A4512]">
          ⚠ 카드가 사라졌습니다. 이 화면에서는 일어날 수 없는 일입니다 — 배정을 멈추고 기록을
          확인하세요.
        </p>
      ) : (
        <p className="mt-2 text-[15px] leading-[1.6] text-[#5A6B73]">
          범주 배정은 <b className="text-[#1F4E79]">이름표를 얹는 것</b>일 뿐입니다 — 카드는 합쳐지거나
          사라지지 않습니다. 미배정 카드도 그대로 남습니다.
        </p>
      )}
    </div>
  );
}

/**
 * 카드 한 장의 범주 버튼 네 개. **드래그는 쓰지 않는다** —
 * 현장에서 마우스를 끄는 조작은 실수로 카드를 엉뚱한 데 떨어뜨리고, 그 실수가 곧 「임의 통합」이 된다.
 *
 * 누른 범주를 다시 누르면 해제된다(`toggleCategory`). 순서는 `FOUR_CATEGORIES` 그대로라
 * 카드마다 버튼 자리가 같다.
 */
export function CategoryButtons({
  noteId,
  current,
  onToggle,
  disabled = false,
}: {
  noteId: string;
  current: FourCategory | null;
  onToggle: (noteId: string, category: FourCategory) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="범주 배정"
      data-testid="category-buttons"
      className="mt-3 flex flex-wrap gap-1 border-t border-black/10 pt-2"
    >
      {FOUR_CATEGORIES.map((category) => {
        const active = current === category;
        const tone = CATEGORY_TONE[category];
        return (
          <button
            key={category}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            data-category={category}
            onClick={() => onToggle(noteId, category)}
            title={active ? '다시 누르면 해제' : `${FOUR_CATEGORY_LABELS[category]}으로 잠정 배정`}
            className="min-h-11 min-w-[52px] rounded-lg border-2 px-2 text-[14px] font-extrabold transition disabled:cursor-wait disabled:opacity-60"
            style={
              active
                ? { borderColor: tone.border, background: tone.border, color: '#ffffff' }
                : { borderColor: 'rgba(31,41,55,.25)', background: 'rgba(255,255,255,.72)', color: '#3f4a52' }
            }
          >
            {FOUR_CATEGORY_LABELS[category]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 배정된 카드에 붙는 이름표. 「잠정」을 **글자로** 달고 다닌다 —
 * 화면 어디를 잘라 캡처해도 확정으로 읽히지 않게 하기 위해서다.
 */
export function CategoryBadge({ category }: { category: FourCategory }) {
  const tone = CATEGORY_TONE[category];
  return (
    <div>
      <span
        data-testid="category-badge"
        data-category={category}
        className="rounded-full px-2 py-[2px] text-[12px] font-extrabold"
        style={{ background: tone.border, color: '#ffffff' }}
      >
        잠정 · {FOUR_CATEGORY_LABELS[category]}
      </span>
    </div>
  );
}

/**
 * 네 범주 + 미배정을 한자리에서 보는 화면.
 *
 * **다섯 번째 칸(미배정)이 이 화면의 요점이다.** 네 범주만 보이면 어디에도 안 들어간 카드가
 * 화면에서 사라지고, 그게 곧 「소수의견 삭제」다. 미배정 칸은 비어 있을 때만 조용해진다.
 *
 * 패널은 접을 수 있지만 **주의 문구와 상단 카운터는 접어도 남는다**(US-005 와 같은 규칙).
 *
 * 이 패널은 **보기 전용**이다 — 배정 버튼은 포스트잇에만 둔다. 같은 조작을 두 곳에 두면
 * 어느 쪽을 눌렀는지에 따라 사람이 「방금 뭘 했는지」를 놓친다.
 */
export function FourCategoryPanel({
  notes,
  state,
}: {
  notes: readonly Note[];
  state: CategoryState;
}) {
  const [open, setOpen] = useState(true);
  const counts = countsByCategory(notes, state);
  const unassigned = notes.filter((note) => !state.has(note.id));

  const columns: { key: string; label: string; tone: { border: string; text: string; bg: string }; members: Note[] }[] =
    FOUR_CATEGORIES.map((category) => ({
      key: category,
      label: FOUR_CATEGORY_LABELS[category],
      tone: CATEGORY_TONE[category],
      members: notes.filter((note) => state.get(note.id) === category),
    }));

  return (
    <section
      aria-label="4범주 잠정 구조화"
      data-testid="four-category-panel"
      className="mb-5 rounded-2xl border border-[#DCE7EE] bg-white p-4"
    >
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="text-[20px] font-extrabold text-[#1F4E79]">4범주 잠정 구조화</h3>
        <span className="text-[16px] font-bold text-[#5A6B73]">
          공통 <span className="tr-num text-[#1F4E79]">{counts.common}</span> · 차이{' '}
          <span className="tr-num text-[#1F4E79]">{counts.difference}</span> · 갈등{' '}
          <span className="tr-num text-[#1F4E79]">{counts.conflict}</span> · 질문{' '}
          <span className="tr-num text-[#1F4E79]">{counts.question}</span>
        </span>
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
        <b>모두 잠정입니다 — 시민 검토 전에는 확정이 아닙니다.</b> 범주는 총괄모더레이터가 잠정으로
        얹은 이름표이고, 카드마다 다시 누르면 해제됩니다. 어느 범주에도 안 들어간 카드는 미배정으로
        남을 뿐 사라지지 않습니다.
      </p>

      {open ? (
        <div className="mt-3 grid items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
          {columns.map((column) => (
            <div
              key={column.key}
              data-testid="category-column"
              data-category={column.key}
              className="rounded-xl border p-3"
              style={{ borderColor: column.tone.border, background: column.tone.bg }}
            >
              <h4 className="mb-2 text-[17px] font-extrabold" style={{ color: column.tone.text }}>
                {column.label}{' '}
                <span className="tr-num">{column.members.length}</span>장
                <span className="ml-2 text-[13px] font-bold">잠정</span>
              </h4>
              {column.members.length === 0 ? (
                <p className="text-[14px]" style={{ color: column.tone.text }}>
                  아직 없음
                </p>
              ) : (
                <ul className="grid max-h-[340px] gap-2 overflow-y-auto">
                  {column.members.map((note) => (
                    <li
                      key={note.id}
                      data-testid="category-member"
                      data-note-id={note.id}
                      className="rounded-[6px] p-2"
                      style={{ background: noteColor(note.teamName) }}
                    >
                      <div className="text-[13px] font-extrabold text-[#1f2937]">{note.teamName}</div>
                      <p className="whitespace-pre-wrap text-[15px] font-semibold leading-[1.4] text-[#1f2937]">
                        {note.content}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {/* 다섯 번째 칸 — 여기가 비어야 배정이 끝난 것이고, 비지 않아도 카드는 그대로다. */}
          <div
            data-testid="category-column"
            data-category="unassigned"
            className="rounded-xl border-2 border-dashed border-[#8A4512] bg-[#FFFDF7] p-3"
          >
            <h4 className="mb-2 text-[17px] font-extrabold text-[#8A4512]">
              미배정 <span className="tr-num">{unassigned.length}</span>장
            </h4>
            {unassigned.length === 0 ? (
              <p className="text-[14px] text-[#8A4512]">모든 카드에 이름표가 붙었습니다.</p>
            ) : (
              <ul className="grid max-h-[340px] gap-2 overflow-y-auto">
                {unassigned.map((note) => (
                  <li
                    key={note.id}
                    data-testid="category-member"
                    data-note-id={note.id}
                    className="rounded-[6px] p-2"
                    style={{ background: noteColor(note.teamName) }}
                  >
                    <div className="text-[13px] font-extrabold text-[#1f2937]">{note.teamName}</div>
                    <p className="whitespace-pre-wrap text-[15px] font-semibold leading-[1.4] text-[#1f2937]">
                      {note.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {/* 접어도 남는다 — 접힌 상태에서 캡처해도 「잠정」이 읽혀야 한다. */}
      {!open && unassigned.length > 0 ? (
        <p className="mt-2 text-[15px] font-bold text-[#8A4512]">
          미배정 <span className="tr-num">{unassigned.length}</span>장이 남아 있습니다.
        </p>
      ) : null}

      <p className="mt-2 text-[14px] text-[#526975]">
        카드를 끌어다 놓는 조작은 없습니다. 각 카드의 버튼 네 개로 배정하고, 같은 버튼을 다시 누르면
        해제됩니다.
      </p>
    </section>
  );
}
