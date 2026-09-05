import {
  ONTOLOGY_KINDS,
  ONTOLOGY_KIND_HINTS,
  ONTOLOGY_KIND_LABELS,
  countsByKind,
  type KindPreservationReport,
  type KindState,
  type OntologyKind,
} from './ontology-kind';
import type { Note } from './hq-submission-board-logic';

/**
 * US-013 — 온톨로지 **관점 보기** 화면 조각.
 *
 * 「관점」이라고 부르는 이유가 설계다. 종류는 카드를 어디로도 옮기지 않고 카드 위에 겹쳐 보이는
 * 한 겹일 뿐이라, 관점을 끄면 화면은 원래대로 돌아온다. 카드를 종류별 칸으로 옮기는 화면을
 * 만들지 않았다 — 옮기는 순간 「이 카드는 근거일 뿐」이라는 서열이 생기고, 그게 회의자료 260811 이
 * 금지한 「좋은 의견 선정」이다.
 *
 *   묶어도 카드 수는 줄지 않는다.
 *
 * ★ 이 파일의 카드 발췌는 `<article>` 이 아니라 `<div>`·`<li>` 로 낸다 — 포스트잇이 `<article>` 이라
 * 같은 태그를 쓰면 「카드 N장」을 세는 브라우저 검증이 조용히 부풀어 통과한다(US-005 기록).
 */

/**
 * 종류마다 고정 색. 조 색(`noteColor`)과 겹치지 않게 진한 테두리·글씨로만 구분하고,
 * 4범주 색(`FourCategoryPanel` 의 `CATEGORY_TONE`)과도 겹치지 않게 골랐다 —
 * 두 이름표가 한 카드에 함께 붙으므로 색이 같으면 어느 쪽 표시인지 알 수 없다.
 */
const KIND_TONE: Record<OntologyKind, string> = {
  Issue: '#7A3E9D',
  Claim: '#2E5E4E',
  Proposal: '#1F6FB2',
  Concern: '#A33B3B',
  Condition: '#7A5C00',
  Value: '#8A4B7C',
  Evidence: '#3F5B76',
};

/**
 * 카드 한 장의 종류 버튼 일곱 개. **드래그는 쓰지 않는다**(4범주와 같은 규칙) —
 * 끌어다 놓는 조작은 실수로 카드를 엉뚱한 데 떨어뜨리고, 그 실수가 곧 「임의 통합」이 된다.
 *
 * 누른 종류를 다시 누르면 떨어진다(`toggleKind`). 순서는 `ONTOLOGY_KINDS` 그대로라
 * 카드마다 버튼 자리가 같다. 뜻은 `title` 로 붙는다 — 일곱은 네 개보다 많아
 * 낱말만으로는 「조건」과 「우려」가 헷갈린다.
 */
export function OntologyKindButtons({
  noteId,
  current,
  onToggle,
  disabled = false,
}: {
  noteId: string;
  current: OntologyKind | null;
  onToggle: (noteId: string, kind: OntologyKind) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="온톨로지 종류"
      data-testid="ontology-kind-buttons"
      className="mt-3 flex flex-wrap gap-1 border-t border-black/10 pt-2"
    >
      {ONTOLOGY_KINDS.map((kind) => {
        const active = current === kind;
        const tone = KIND_TONE[kind];
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            aria-busy={disabled || undefined}
            disabled={disabled}
            data-kind={kind}
            onClick={() => onToggle(noteId, kind)}
            title={
              active
                ? '다시 누르면 해제'
                : `${ONTOLOGY_KIND_LABELS[kind]} — ${ONTOLOGY_KIND_HINTS[kind]}`
            }
            className="h-9 min-w-[46px] rounded-lg border-2 px-2 text-[14px] font-extrabold transition disabled:cursor-wait disabled:opacity-55"
            style={
              active
                ? { borderColor: tone, background: tone, color: '#ffffff' }
                : {
                    borderColor: 'rgba(31,41,55,.25)',
                    background: 'rgba(255,255,255,.72)',
                    color: '#3f4a52',
                  }
            }
          >
            {ONTOLOGY_KIND_LABELS[kind]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 종류가 붙은 카드에 얹히는 이름표. 「잠정」을 **글자로** 달고 다닌다 —
 * 화면 어디를 잘라 캡처해도 확정으로 읽히지 않게 하기 위해서다(`CategoryBadge` 와 같은 규칙).
 */
export function OntologyKindBadge({ kind }: { kind: OntologyKind }) {
  return (
    <div>
      <span
        data-testid="ontology-kind-badge"
        data-kind={kind}
        className="rounded-full px-2 py-[2px] text-[12px] font-extrabold"
        style={{ background: KIND_TONE[kind], color: '#ffffff' }}
      >
        잠정 · {ONTOLOGY_KIND_LABELS[kind]}
      </span>
    </div>
  );
}

/**
 * 상단 카운터 — 「원문 N장 · 종류 M장 · **미지정 K장** · 삭제 0장」 + 종류별 수.
 *
 * **관점을 켠 동안 접히지 않고 항상 보인다.** 미지정 수가 이 화면의 요점이다 —
 * 아무 종류도 못 받은 카드가 조용히 사라지지 않는다는 증거이고, 그래서 눈에 띄게 둔다.
 *
 * 세는 대상은 **검색어와 무관한 꼭지·분과 전체**(`boardNotes`)다. 검색 결과로 세면
 * 「원문 N장」이 타이핑에 따라 흔들려 카드가 사라진 것처럼 읽힌다(US-008 기록).
 */
export function OntologyKindCounter({
  notes,
  state,
  report,
}: {
  notes: readonly Note[];
  state: KindState;
  report: KindPreservationReport;
}) {
  const counts = countsByKind(notes, state);
  const danger = !report.ok;
  return (
    <section
      aria-label="온톨로지 관점"
      data-testid="ontology-kind-counter"
      className={`mb-5 rounded-2xl border px-4 py-3 ${
        danger ? 'border-[#B5651D] bg-[#FBEEE2]' : 'border-[#DCE7EE] bg-white'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h3 className="text-[20px] font-extrabold text-[#1F4E79]">온톨로지 관점</h3>
        <span className="text-[17px] font-bold text-[#5A6B73]">
          원문{' '}
          <span className="text-[24px] font-extrabold text-[#1F4E79] tr-num">
            {report.originalCount}
          </span>
          장
        </span>
        <span className="text-[17px] font-bold text-[#5A6B73]">
          · 종류{' '}
          <span className="text-[24px] font-extrabold text-[#1F4E79] tr-num">
            {report.specifiedCount}
          </span>
          장
        </span>
        <span
          data-testid="ontology-unspecified-count"
          className={`rounded-xl px-3 py-1 text-[17px] font-bold ${
            report.unspecifiedCount > 0 ? 'bg-[#FFF4D6] text-[#6B4B00]' : 'text-[#5A6B73]'
          }`}
        >
          · 미지정{' '}
          <span
            className={`text-[24px] font-extrabold tr-num ${
              report.unspecifiedCount > 0 ? 'text-[#B5651D]' : 'text-[#1F4E79]'
            }`}
          >
            {report.unspecifiedCount}
          </span>
          장
        </span>
        <span
          data-testid="ontology-kind-deleted"
          className={`text-[17px] font-bold ${danger ? 'text-[#B5651D]' : 'text-[#5A6B73]'}`}
        >
          · 삭제{' '}
          <span
            className={`text-[24px] font-extrabold tr-num ${danger ? 'text-[#B5651D]' : 'text-[#1F4E79]'}`}
          >
            {report.deletedCount}
          </span>
          장
        </span>
      </div>

      {/* 종류별 수 — 일곱이 **항상 다 나온다**(0장도 자리를 지킨다).
          빈 종류가 사라지면 「그 종류는 안 봐도 된다」로 읽힌다. */}
      <div className="mt-2 flex flex-wrap gap-2">
        {ONTOLOGY_KINDS.map((kind) => (
          <span
            key={kind}
            data-testid="ontology-kind-tally"
            data-kind={kind}
            className="rounded-lg border px-2 py-[2px] text-[15px] font-bold"
            style={{ borderColor: KIND_TONE[kind], color: KIND_TONE[kind] }}
          >
            {ONTOLOGY_KIND_LABELS[kind]} <span className="tr-num">{counts[kind]}</span>
          </span>
        ))}
      </div>

      {danger ? (
        <p role="alert" className="mt-2 text-[15px] font-bold leading-[1.6] text-[#B5651D]">
          ⚠ 카드가 사라졌습니다. 이 화면에서는 일어날 수 없는 일입니다 — 종류 붙이기를 멈추고 기록을
          확인하세요.
        </p>
      ) : (
        <p className="mt-2 rounded-xl bg-[#FFF4D6] px-4 py-3 text-[15px] leading-[1.6] text-[#6B4B00]">
          <b>종류는 사람이 붙입니다 — 미리 정해 둔 것이 없습니다.</b> 처음에는 모든 카드가 미지정이고,
          카드의 버튼 일곱 개로 붙입니다. 같은 버튼을 다시 누르면 해제됩니다. 종류를 붙여도{' '}
          <b>원문은 그대로이고 카드도 사라지지 않습니다</b> — 카드 위에 이름표 한 겹을 얹을 뿐입니다.
        </p>
      )}

      <p className="mt-2 text-[14px] leading-[1.6] text-[#8FA3AD]">
        여기서 붙인 종류는 <b>이 화면에만</b> 남습니다 — 내려받는 온톨로지 스냅샷에는 들어가지
        않습니다. 검수 큐도 노드마다 종류를 비운 채 시작해 사람이 그 자리에서 다시 고릅니다.
      </p>
    </section>
  );
}
