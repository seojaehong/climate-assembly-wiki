/**
 * 조 산출물 「전부 받기(.zip)」 — 워드·엑셀·줄글을 한 파일로 묶는 판정.
 *
 * 왜 묶는가: 한 화면에서 세 형식을 연달아 누르면 두 번째부터 파일이 안 떨어지는 일이 있다.
 * 브라우저가 「여러 파일 내려받기」를 물어보는 경계에 걸리기 때문이고,
 * 이 저장소는 이미 같은 벽에 부딪혀 `zip-store.ts` 로 우회한 전례가 있다(45장 결과 이미지).
 * **클릭 한 번 = 다운로드 한 개**면 그 경계에 아예 닿지 않는다.
 *
 * ★ 이 모듈은 **내용을 만들지 않는다.** 개별 내려받기가 이미 만든 바이트·문자열을 그대로 받아
 *   이름만 붙여 담는다. 그래서 ZIP 안 세 파일은 개별로 받은 것과 **같고**,
 *   「어떤 내보내기에서도 카드 수가 줄지 않는다」는 불변식(AGENTS.md 「8.29 취합 화면의 불변식」)이
 *   검사가 아니라 자료구조로 지켜진다 — 담을 때 고를 자리가 없다.
 *
 * 순수하다 — DOM 도 시계도 쓰지 않는다(시각은 파일명 안에 이미 박혀 있는 `report.generatedAt` 이다).
 */
import { reportFileName, type SubmissionReport } from './submission-report';
import type { ZipEntry } from './zip-store';

/** ZIP 에 담을 세 형식. 순서는 화면의 버튼 순서(워드·엑셀·줄글)와 같다. */
export const TEAM_BUNDLE_FORMATS = ['docx', 'csv', 'txt'] as const;

/**
 * 개별 내려받기가 만든 것 그대로.
 *
 * `docx` 만 바이트인 것은 docx 가 이미 압축된 아카이브라 문자열로 지날 수 없기 때문이다.
 * `csv`·`txt` 는 개별 내려받기가 `new Blob([문자열])` 로 내보내므로, 같은 UTF-8 바이트가 되도록
 * 여기서도 `TextEncoder` 하나만 태운다(CSV 앞머리의 BOM 도 그대로 실린다).
 */
export type TeamBundleParts = {
  docx: Uint8Array;
  csv: string;
  txt: string;
};

/**
 * ZIP 항목 세 개. 이름은 개별 내려받기와 **같은 규칙**(`reportFileName`)이라
 * 압축을 풀면 하나씩 받았을 때와 같은 파일명이 나온다.
 *
 * 폴더를 만들지 않는다 — 파일이 셋뿐이라 한 겹 더 넣을 이유가 없다.
 */
export function buildTeamBundleEntries(
  report: SubmissionReport,
  parts: TeamBundleParts
): ZipEntry[] {
  const encoder = new TextEncoder();
  return [
    { name: reportFileName(report, 'docx'), data: parts.docx },
    { name: reportFileName(report, 'csv'), data: encoder.encode(parts.csv) },
    { name: reportFileName(report, 'txt'), data: encoder.encode(parts.txt) },
  ];
}

/** 「기후시민회의_조별산출물_1분과1조_20260829-1405.zip」 — 개별 파일과 같은 이름, 확장자만 다르다. */
export function teamBundleFileName(report: SubmissionReport): string {
  return reportFileName(report, 'zip');
}

/**
 * 개별 내려받기를 두 번째로 누른 순간부터 안내를 띄운다.
 *
 * 두 번째 클릭이 곧 브라우저의 「여러 파일 내려받기」 경계다. 차단은 **조용히** 일어나
 * (`a.click()` 은 그대로 성공한다) 화면이 실패를 알 방법이 없으므로, 실패를 감지하지 말고
 * **두 번째를 누른 사실**만 보고 다음에 할 일을 알린다.
 */
export function shouldShowMultiDownloadHint(individualDownloads: number): boolean {
  return individualDownloads >= 2;
}

/** 무엇을 하면 되는지만 적는다. 버튼이 「안 하는 일」은 적지 않는다. */
export const MULTI_DOWNLOAD_HINT =
  '두 가지 이상 받을 때는 「전부 받기 (.zip)」를 누르세요. 브라우저가 「여러 파일 내려받기」를 물으면 「허용」을 고르면 됩니다.';
