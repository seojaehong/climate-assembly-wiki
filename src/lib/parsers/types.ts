/**
 * 문서 파서 공용 인터페이스.
 *
 * 한글(HWP/HWPX)·워드(DOCX) 문서를 조별 산출물 행으로 바꾸는 경로가 뒤에 어떤
 * 라이브러리를 쓰든 호출부는 이 타입만 본다. 두 엔진(`rhwp`·`kordoc`) 모두
 * pre-1.0·버스팩터 1이라 한쪽이 멈춰도 어댑터만 갈아끼울 수 있게 한 것이다.
 *
 * 판정 근거는 `20_스크립트/parsers/README.md` (측정일 2026-08-30).
 * 이 파일에는 타입만 둔다 — 구현은 각 어댑터와 `index.ts` 가 갖는다.
 */

/** 이 단위를 뽑아낸 파서 엔진. HWP/HWPX 는 rhwp, DOCX 는 kordoc. */
export type ExtractEngine = 'rhwp' | 'kordoc';

/**
 * 단위 하나가 원문 어디에서 왔는지 가리키는 주소.
 *
 * 좌우 대조 확인 화면이 「조용히 빠진 내용」을 짚어내려면 각 단위가 원문의
 * 어느 자리에서 왔는지 되짚을 수 있어야 한다. 엔진마다 셀 수 있는 좌표가
 * 달라 `engine` 을 뺀 나머지는 모두 선택 항목이다.
 */
export interface UnitProvenance {
  /** 이 단위를 뽑은 엔진. 항상 채운다. */
  engine: ExtractEngine;
  /** (rhwp) 구역 번호. */
  section?: number;
  /** (rhwp) 구역 안 본문 문단 번호. */
  para?: number;
  /** (rhwp) 문단에 딸린 컨트롤(표 등) 번호. 표 셀에서 온 단위에만 있다. */
  control?: number;
  /** (rhwp) 표 안 셀 번호. */
  cell?: number;
  /** (rhwp) 셀 안 문단 번호. 표 하나가 발언 여러 개를 삼키지 않게 하는 좌표다. */
  cellPara?: number;
  /** 원문 전체 텍스트에서의 시작 글자 위치. */
  charOffset?: number;
  /** (kordoc) 페이지 번호. */
  page?: number;
}

/** 문서에서 뽑아낸 텍스트 한 단위(본문 문단 하나 또는 표 셀 문단 하나). */
export interface ExtractedUnit {
  /** 단위의 텍스트. 빈 문자열·공백만 있는 단위는 어댑터가 버린다. */
  text: string;
  /** 이 텍스트가 원문 어디에서 왔는지. */
  provenance: UnitProvenance;
}

/** 경고의 종류. 어느 것이든 「성공으로 위장하지 않는다」는 뜻이다. */
export type ExtractWarningKind =
  /** 구조 API 로 뽑은 글자수가 전문 경로 글자수보다 눈에 띄게 적다 — 중첩표 등이 통째로 빠졌을 수 있다. */
  | 'missing-content'
  /** 이 엔진이 다루지 않는 형식(예: 구형 `.doc`, 어댑터에 맞지 않는 확장자). */
  | 'unsupported'
  /** 암호가 걸려 열 수 없다. */
  | 'encrypted'
  /** 파일이 너무 커서 처리하지 않는다 — 메모리·CPU 한도. */
  | 'too-large';

/** 추출 중 발견한 문제. 사람이 읽고 판단할 수 있게 수치·사유를 담는다. */
export interface ExtractWarning {
  /** 경고의 종류. */
  kind: ExtractWarningKind;
  /** 사람에게 보여 줄 한 줄 설명. 대조한 수치가 있으면 여기에 함께 적는다. */
  message: string;
  /** 원인 추적용 부가 정보(파일명·확장자·예외 메시지 등). */
  detail?: string;
}

/** 문서 하나를 추출한 결과. 실패해도 던지지 않고 warnings 로 알린다. */
export interface ExtractResult {
  /** 뽑아낸 단위들. 거부·실패한 경우 빈 배열이다. */
  units: ExtractedUnit[];
  /** 추출 중 발견한 문제들. 비어 있으면 문제없이 끝난 것이다. */
  warnings: ExtractWarning[];
  /** `units` 텍스트 글자수의 합. 누락 검사에서 전문 경로 글자수와 대조하는 기준값이다. */
  charCount: number;
}
