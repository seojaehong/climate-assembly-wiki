import type { OntologyPreservation } from './ontology-snapshot';
import { ONTOLOGY_EXPORT_NEXT_STEP, type OntologyExportReadiness } from './ontology-export';

/**
 * 「온톨로지 검수로 내보내기」 — 취합 화면에서 검수 큐로 넘길 파일을 받는 자리.
 *
 * 이 패널은 **읽기 전용**이다. 누르면 파일이 하나 내려올 뿐 화면의 카드는 하나도 바뀌지 않는다.
 * 그 사실을 옆의 카운터가 매번 숫자로 보여준다 — 「원문 N장 · 내보냄 N장 · 삭제 0장」.
 *
 * ★ 내보내는 것은 **꼭지 전체**다. 분과 필터로 화면이 좁혀져 있어도 파일에는 15개 조가 다 실린다
 * (조 순번이 밀리면 다른 분과의 스냅샷과 노드 id 가 충돌하기 때문 — `ontology-snapshot.ts` 주석).
 * 화면에 보이는 카드 수와 카운터의 수가 다를 수 있어, 필터가 걸렸을 때는 그 사실을 한 줄로 알린다.
 *
 * ★ 카드 발췌를 두지 않는다. 포스트잇이 `<article>` 이라 같은 태그로 카드를 내면
 * 「카드 N장」을 세는 브라우저 검증이 조용히 부풀어 통과한다(US-005 기록).
 */
export function OntologyExportPanel({
  preservation,
  readiness,
  subgroupNotice,
  onExport,
}: {
  preservation: OntologyPreservation;
  readiness: OntologyExportReadiness;
  /** 분과 필터가 걸려 화면과 파일의 범위가 다를 때 알릴 분과 이름. 없으면 null. */
  subgroupNotice: string | null;
  onExport: () => void;
}) {
  const danger = !preservation.ok || preservation.deleted !== 0;
  return (
    <section
      aria-label="온톨로지 검수로 내보내기"
      data-testid="ontology-export-panel"
      className={`mb-5 rounded-2xl border px-4 py-3 ${
        danger ? 'border-[#B5651D] bg-[#FBEEE2]' : 'border-[#DCE7EE] bg-white'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          data-testid="ontology-export-button"
          onClick={onExport}
          disabled={!readiness.exportable}
          className={`h-12 rounded-xl px-5 text-[16px] font-bold ${
            readiness.exportable
              ? 'bg-[#1F4E79] text-white'
              : 'cursor-not-allowed border border-[#DCE7EE] bg-[#F1F5F8] text-[#8FA3AD]'
          }`}
        >
          온톨로지 검수로 내보내기
        </button>

        {/* 버튼 옆 — 「모으지 않았다」를 내보내기 순간에도 숫자로 남긴다. */}
        <span
          data-testid="ontology-export-counter"
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
        >
          <span className="text-[17px] font-bold text-[#5A6B73]">
            원문 <span className="tr-num text-[24px] font-extrabold text-[#1F4E79]">{preservation.submitted}</span>장
          </span>
          <span className="text-[17px] font-bold text-[#5A6B73]">
            · 내보냄{' '}
            <span
              className={`tr-num text-[24px] font-extrabold ${danger ? 'text-[#B5651D]' : 'text-[#1F4E79]'}`}
            >
              {preservation.nodes}
            </span>
            장
          </span>
          <span className={`text-[17px] font-bold ${danger ? 'text-[#B5651D]' : 'text-[#5A6B73]'}`}>
            · 삭제{' '}
            <span
              className={`tr-num text-[24px] font-extrabold ${danger ? 'text-[#B5651D]' : 'text-[#1F4E79]'}`}
            >
              {preservation.deleted}
            </span>
            장
          </span>
        </span>
      </div>

      {danger ? (
        <p
          role="alert"
          data-testid="ontology-export-alert"
          className="mt-2 text-[15px] font-bold leading-[1.6] text-[#B5651D]"
        >
          ⚠ 원문 수와 내보낼 수가 다릅니다. 카드가 빠진 파일을 검수 큐에 올리면 되돌릴 수 없습니다 —
          내보내지 말고 기록을 확인하세요.
        </p>
      ) : readiness.exportable ? (
        <p className="mt-2 text-[15px] leading-[1.6] text-[#5A6B73]">
          카드 한 장이 <b className="text-[#1F4E79]">항목 하나</b>로 그대로 넘어갑니다 — 묶지 않고,
          근거도 본문에 붙이지 않고 따로 보냅니다. 화면의 카드는 바뀌지 않습니다.
        </p>
      ) : (
        <p data-testid="ontology-export-reason" className="mt-2 text-[15px] font-bold leading-[1.6] text-[#6B4B00]">
          {readiness.reason}
        </p>
      )}

      {subgroupNotice ? (
        <p data-testid="ontology-export-scope" className="mt-2 text-[15px] leading-[1.6] text-[#6B4B00]">
          지금 화면은 <b>{subgroupNotice}</b>만 보고 있지만, 내보내기는 <b>꼭지 전체(15개 조)</b>를
          담습니다 — 분과별로 쪼개 내보내면 조 순번이 밀려 항목 이름이 서로 어긋납니다.
        </p>
      ) : null}

      {/* 명령을 줄바꿈시키지 않는다 — 하이픈에서 접히면 `--snapshot` 이 `- -snapshot` 으로 읽혀
          그대로 복사한 사람이 틀린 명령을 친다. 좁으면 가로로 스크롤한다. */}
      <p className="mt-2 text-[14px] leading-[1.6] text-[#526975]">받은 파일로 검수 계획을 만드는 다음 걸음:</p>
      <div
        tabIndex={0}
        role="region"
        aria-label="온톨로지 검수 계획 생성 명령어. 좌우 방향키로 전체 내용을 확인할 수 있습니다."
        className="mt-1 overflow-x-auto rounded bg-[#F1F5F8] px-2 py-1 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#1F4E79]"
      >
        <code className="block whitespace-nowrap text-[13px] text-[#5A6B73]">
          {ONTOLOGY_EXPORT_NEXT_STEP}
        </code>
      </div>
    </section>
  );
}
