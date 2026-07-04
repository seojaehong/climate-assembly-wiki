# 0704 제4차 워크숍 라이브 운영 회고

생성: 2026-07-04

## 산출물

운영 화면 캡쳐는 `10_작업산출물/7.4_제4차워크숍_운영문서/screenshots/`에 저장했다.

- 질문 보드: `0704-question-board-20260704-175602.png`
- 선정질문 보드: `0704-selected-question-board-20260704-175602.png`
- 전체 의제 후보 17개 보드: `0704-all-agenda-board-17-20260704-175602.png`
- 선정 의제 4개 보드: `0704-selected-agenda-board-20260704-175602.png`
- 투표 구조/운영 화면: `0704-vote-structure-20260704-175602.png`
- 의제투표 결과 버블레이스: `0704-agenda-vote-final-bubble-race-live-forced-20260704-085923.png`

운영 URL:

- 관리자: https://climate-assembly.org/0704-admin/
- 질문 보드: https://climate-assembly.org/question-board-0704/
- 선정질문 보드: https://climate-assembly.org/selected-question-board-0704/
- 전체 의제 후보 보드: https://climate-assembly.org/agenda-board-0704/?view=all
- 선정 의제 보드: https://climate-assembly.org/agenda-board-0704/
- 의제투표 Form: https://docs.google.com/forms/d/e/1FAIpQLSf9-AIDhnd0cy8Dfu-xXOgz6cQINjpA-tLzHdM2Ypk8qU_eMA/viewform
- 의제투표 결과 버블레이스: https://climate-assembly.org/agenda-vote-0704/?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw

## 오늘 확정된 운영 구조

1. 질문은 A/B 실시간 Sheet에 계속 누적 입력한다.
2. 질문 보드는 전체 질문 전달용, 선정질문 보드는 전문가 질의용으로 분리한다.
3. 의제는 A/B 실시간 Sheet의 의제 입력 탭에 누적 입력한다.
4. 의제 보드는 두 버전이 필요하다.
   - 전체 의제 후보 17개: 논의 과정과 후보 전체를 보여주는 화면
   - 선정 의제 4개: 투표 대상만 보여주는 화면
5. 선정된 4개 의제만 Google Form의 1~5점 척도 문항으로 승격한다.
6. 투표 집계는 이름 기준 최신 응답 1개만 반영하고, Scores 시트를 버블레이스가 읽는다.

## 시행착오

- 전체 의제 후보 화면과 선정 의제 화면을 하나로 처리하려다 혼선이 생겼다. 앞으로 후보 전체 보드와 최종 선정 보드는 처음부터 별도 URL 또는 명시적 view 모드로 둔다.
- 투표 Form에는 긴 원문이 필요하지만, 버블레이스에는 짧은 라벨이 필요했다. 원문과 발표용 라벨을 분리하지 않으면 결과 화면에서 텍스트가 잘리거나 화면을 압도한다.
- A/B 실시간 Sheet 입력 보드와 의제투표 결과 버블레이스 버튼이 같은 위치에 있으면 사용자가 어떤 결과 화면을 눌러야 하는지 헷갈린다. 결과 발표는 의제투표 카드에만 둔다.
- Google Sheet, Form, Scores, 보드 JSON, PDF가 각각 다른 갱신 타이밍을 가진다. 문구 변경 직후에는 반드시 네 경로를 대조해야 한다.
- Cloudflare Pages 배포 완료 후 preview URL은 즉시 최신이지만 custom domain은 수 초 지연될 수 있다. 배포 검증은 preview와 custom domain을 둘 다 확인한다.
- Playwright CLI에서 URL의 `&`가 PowerShell/npx 체인에서 깨지는 문제가 있었다. 복잡한 URL 캡쳐는 Node REPL Playwright로 직접 처리하는 편이 안전하다.
- 버블레이스 결과 캡쳐에는 재생 오버레이가 남을 수 있다. 기록용 캡쳐 모드를 별도로 두거나 페이지 내부에서 final phase로 강제 점프해야 한다.
- 실시간 운영 중에는 갑작스러운 요구가 본 작업과 섞인다. RSVP, QR, 문구 변경, 결과 캡쳐는 별도 운영 태스크로 보고 빠르게 닫아야 한다.

## 개선안

### 운영 화면 설계

- 모든 라이브 화면은 `input`, `review`, `selected`, `result`, `capture` 모드를 명시적으로 가진다.
- 보드 화면은 기본 표시와 기록용 표시를 분리한다.
  - 발표용: 한 화면 가시성 우선
  - 기록용: full-page 캡쳐 우선
- 투표 결과 화면은 `?capture=final`에서 오버레이 없이 최종 결과를 렌더링해야 한다.
- 버블레이스에는 `name`과 `short`를 분리하고, `short`는 18자 이하 또는 두 줄 고정 라벨로 관리한다.

### 데이터 파이프라인

- Sheet 원문, Form 문항, Scores 이름, 보드 JSON, PDF 문구를 한 번에 비교하는 `verify-final-wording` 스크립트를 둔다.
- 의제 선정 컬럼은 자유 입력 `비고`보다 구조화된 `선정여부`, `순위`, `투표대상` 컬럼으로 분리한다.
- 투표 시작 전 `reset`, 투표 중 `refresh`, 발표 전 `freeze`, 기록 후 `capture` 단계가 자동으로 실행되게 한다.
- 모든 갱신 스크립트는 마지막 실행 시각, 응답 수, 중복 제외 수, 출력 파일 경로를 evaluation JSON으로 남긴다.

### 자동 리서치/에이전트 루프

Andrej Karpathy가 강조하는 작은 자동화 루프 관점으로 보면, 현장 운영은 거대한 단일 앱보다 여러 개의 작고 검증 가능한 루프가 더 안전하다.

- Observe: Sheet/Form/페이지/CSV/PDF 상태를 주기적으로 읽는다.
- Act: 필요한 변환만 수행한다. 예: selected rows -> Form questions -> Scores.
- Eval: 문구 일치, 응답 수, 중복 제거, 화면 렌더링, 캡쳐 파일 존재를 자동 확인한다.
- Snapshot: 운영 순간의 화면과 JSON을 저장한다.
- Recover: custom domain 지연, Google Sheet 지연, Form 구조 변경, 캡쳐 실패 시 fallback 경로를 둔다.

다음 운영에서는 이 루프를 `preflight`, `live-watch`, `finalize`, `archive` 네 명령으로 나누는 것이 좋다.

## 다음 운영 체크리스트

- 시작 전: 모든 QR 확대 모달 확인
- 입력 전: Sheet 탭 이름과 필수 컬럼 확인
- 선정 전: 전체 후보 보드와 인쇄본 확인
- 선정 후: 선정 보드 4개만 표시되는지 확인
- 투표 전: Form 문항 4개와 Scores short 라벨 대조
- 투표 중: 응답 수, unique voter 수, duplicate dropped 수 확인
- 발표 전: refresh 1회, Scores 시트 확인, 버블레이스 final 캡쳐
- 종료 후: 질문/의제/선정/투표/버블레이스/관리자 화면 캡쳐를 산출물 폴더로 복사
