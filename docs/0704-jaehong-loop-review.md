# 0704 기후시민회의 운영 리뷰: Jaehong Loop 기준

작성: 2026-07-05

## 결론

0704 운영은 현장 요구 변화에 맞춰 질문 17개에서 선정 질문 4개, 의제 후보에서 투표 의제 4개, 그리고 4개 의제 투표 결과 버블레이스 최종 화면까지 닫는 구조였다. 사용자가 정리한 운영 요건은 `질문 17 -> 4`, `의제 8 -> 4`, `4개 투표 -> 최종 버블레이스`다. 최종적으로는 보드, 인쇄본, 의제투표, 버블레이스, 캡쳐 보관까지 완료했다. 다만 현재 보관된 의제 후보 데이터는 8개가 아니라 17개로 남아 있어, "의제 8개 후보" 단계의 별도 증거가 모호하다. 이 지점이 이번 리뷰에서 가장 중요한 archive gap이다.

따라서 다음 운영의 기준은 `Jaehong Loop`로 잡는다. 사람이 정한 마지막 상태를 source of truth로 두고, 에이전트가 전파, 검증, 캡쳐, 보관을 반복하는 방식이다.

## 주요 문제

### P0. Source of truth가 중간에 계속 바뀌었는데 전파 확인이 수동이었다

현장에서는 질문 입력 방식, 발언자 필드, 전체 질문 17개, 선정 질문 4개, 의제 후보 8개, 선정 의제 4개, 투표 문구, 버블레이스 짧은 라벨이 계속 바뀌었다. 그런데 변경 후 Sheet, Form, Scores, Board, PDF, 배포 화면이 같은 상태인지 한 번에 확인하는 명령이 없었다.

영향:

- "반영이 안 된다"는 상황이 여러 번 발생했다.
- 화면에는 바뀐 것처럼 보이지만 PDF나 Form, Scores가 이전 상태인 경우가 생길 수 있었다.
- 운영자가 어느 버튼과 어느 결과 화면을 눌러야 하는지 헷갈렸다.

다음 조치:

- `scripts/jaehong-loop.ps1 finalize -Capture` 같은 단일 명령이 필요하다.
- 이 명령은 Sheet/Form/Scores/Board/PDF/URL/PNG를 모두 대조하고, 실패 항목을 evaluation JSON으로 남겨야 한다.

### P0. 투표 결과 화면의 fallback 데이터와 실제 live Sheet 데이터가 다르다

현재 live Scores Sheet는 4개 의제만 내려온다. 확인 시점의 Scores CSV는 header 포함 5행, 데이터 4행이다.

반면 `public/agenda-vote-0704/data.json` fallback에는 8개 의제가 남아 있다. 실제 URL에 `?sheet=...`가 붙고 Sheet 접근이 성공하면 4개로 표시되지만, Sheet 접근 실패나 네트워크 이슈가 있으면 과거 8개 fallback으로 돌아갈 수 있다.

증거:

- live Scores: 4개 데이터 행
- fallback JSON: `meta, agendas`, agendas 8개
- 결과 URL: `https://climate-assembly.org/agenda-vote-0704/?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw`

다음 조치:

- fallback `data.json`도 최종 4개 의제로 맞춘다.
- 결과 페이지는 live Sheet load 실패 시 "fallback 표시"가 아니라 "데이터 갱신 실패"를 명확히 띄운다.

### P1. 전체 후보 화면과 선정 후보 화면의 구분이 늦게 확정됐다

질문과 의제는 각각 두 화면이 모두 필요했다.

- 전체 질문 17개: 전문가 전달 전 전체 질의 풀 확인용
- 선정 질문 4개: 전문가에게 실제 전달할 질문 확인용
- 의제 후보 8개: 투표 전 A/B조에서 올라온 후보 전체 확인용
- 선정 의제 4개: 실제 1~5점 투표 대상 확인용

운영 중에는 선정된 4개만 보이게 해야 하는 순간과 전체 후보를 캡쳐해야 하는 순간이 섞였다. 이 때문에 "선정된 의제 4개만 띄워줘"와 "투표 전 조별 의제 후보 캡쳐도 필요하다"가 뒤늦게 동시에 충족되어야 했다.

다음 조치:

- 모든 보드는 처음부터 `view=all`, `view=selected`, `capture=fullpage`를 가진다.
- 관리자 페이지 버튼도 "전체 후보 보드"와 "선정 의제 보드"를 명확히 분리한다.

### P1. 의제 후보 8개 단계가 별도 산출물로 고정되지 않았다

사용자가 정리한 최종 운영 체인은 `의제 8 -> 4`다. 그런데 현재 확인되는 `public/agenda-board-0704/data.json`은 `agendaCount=17`, agendas 17행이고, `public/0704-admin/live-sheet-agendas-print.html`도 A/B조 의제 후보 17행을 담고 있다. 즉, `8개 후보만 따로 보이는 보드/캡쳐/PDF`가 현재 산출물명과 데이터만으로는 명확히 분리되어 있지 않다.

해석:

- 선정 의제 4개와 투표 결과는 확인된다.
- 전체 의제 후보 보드는 남아 있다.
- 다만 "투표 전 8개 후보"라는 중간 상태가 있었다면, 그 상태는 별도 archive key로 고정되지 않았다.

다음 조치:

- 다음 운영에서는 `agenda-candidates-all`, `agenda-candidates-shortlist`, `agenda-selected-for-vote`를 서로 다른 URL/파일명으로 분리한다.
- archive manifest에 `질문 17`, `질문 4`, `의제 8`, `의제 4`, `투표 결과`를 필수 슬롯으로 둔다.

### P1. 실시간 갱신 주체가 불명확했다

운영 중 사용자는 "새로고침을 내가 해야 해? 누가 해?"라고 물었다. 이는 시스템이 자동 갱신인지, 콘솔에서 watcher가 도는지, 수동 스크립트 실행인지 UI에서 알 수 없었기 때문이다.

다음 조치:

- 관리자 화면 상단에 "마지막 Sheet 읽기", "마지막 PDF 생성", "마지막 배포", "다음 polling"을 표시한다.
- watch 프로세스가 꺼져 있으면 명확히 경고한다.

### P1. 긴 원문과 발표용 라벨이 늦게 분리됐다

Form에는 긴 원문이 필요하고, 버블레이스에는 짧은 라벨이 필요했다. 이 분리가 늦어지면서 결과 화면에서 텍스트가 잘리거나 가시성이 흔들렸다.

현재는 Scores Sheet에 `name`과 `short`가 분리되어 있다. 예를 들어 live Scores의 첫 데이터는 원문 `제재가 아닌 인센티브 중심으로...`와 short `(A조) 기업 인센티브 감축방안`을 따로 가진다.

다음 조치:

- Form용 원문, 발표용 short label, 캡쳐용 display label을 schema에서 분리한다.
- short label은 최대 길이와 줄 수를 검증한다.

### P2. 캡쳐는 남았지만 최종 증거와 중간 시행착오가 한 폴더에 섞여 있다

작업산출물 폴더에는 최종 캡쳐 6종이 모두 존재한다. 동시에 중간 캡쳐와 실패/시행착오 캡쳐도 남아 있다.

다음 조치:

- `screenshots/final/`, `screenshots/debug/`, `screenshots/manual/`처럼 분리한다.
- 보고서용 manifest JSON을 만들어 어떤 파일이 공식 증거인지 고정한다.

### P2. URL query와 Playwright/PowerShell 캡쳐가 취약했다

`?sheet=...&capture=...` 같은 URL은 PowerShell에서 `&` 처리 때문에 깨질 수 있었다. 실제 운영 중에도 복잡한 캡쳐는 Node/Playwright 직접 제어가 더 안정적이었다.

다음 조치:

- 캡쳐 스크립트는 URL 배열을 코드 내부에 보관하고 shell escaping을 피한다.
- 캡쳐 URL은 `evaluation/0704-live-artifact-manifest.json`에 보관한다.

## 산출물 확인

### 필수 운영 체인

0704 산출물은 아래 흐름으로 모두 있어야 한다.

| 단계 | 운영 의미 | 증거 상태 |
| --- | --- | --- |
| 질문 17개 | A/B 실시간 Sheet에 누적된 전체 전문가 질문 | 질문 보드 캡쳐 있음 |
| 질문 4개 | 전문가에게 전달할 선정 질문 | 선정질문 보드 캡쳐 있음 |
| 의제 8개 | A/B조에서 올라온 투표 전 의제 후보 shortlist | 현재 별도 8개 산출물은 모호함. 보관 데이터는 17개 후보 |
| 의제 4개 | 실제 1~5점 투표로 승격된 최종 의제 | 선정 의제 보드와 Form/Scores 검증 리포트 있음 |
| 투표 결과 | 4개 의제 점수 결과 | Scores Sheet 4행 확인, 최종 버블레이스 캡쳐 있음 |

### 공식 캡쳐

위치:

`C:\Users\iceam\OneDrive\_30_컨설팅\2026\기후회의모더레이터\10_작업산출물\7.4_제4차워크숍_운영문서\screenshots`

| 구분 | 파일 | 상태 |
| --- | --- | --- |
| 질문 보드 | `0704-question-board-20260704-175602.png` | 있음, 1920x1080 |
| 선정질문 보드 | `0704-selected-question-board-20260704-175602.png` | 있음, 1920x1080 |
| 전체 의제 후보 보드 | `0704-all-agenda-board-17-20260704-175602.png` | 있음, 1920x1080. 단, 파일명/데이터 기준 17개 후보 |
| 선정 의제 4개 | `0704-selected-agenda-board-20260704-175602.png` | 있음, 1920x1080 |
| 투표 구조/운영 화면 | `0704-vote-structure-20260704-175602.png` | 있음, 1920x1080 |
| 의제투표 버블레이스 최종 | `0704-agenda-vote-final-bubble-race-live-forced-20260704-085923.png` | 있음, 1920x1080 |

추가로 `wiki/evaluation/screenshots/`에도 0704 관련 캡쳐가 보관되어 있다. 다만 작업산출물 폴더에는 `0704-agenda-vote-final-bubble-race-live-20260704-085747.png`처럼 중간 캡쳐도 섞여 있으므로 최종 보고에는 위 6종을 우선 사용한다.

### PDF/HTML

| 구분 | 파일 | 상태 |
| --- | --- | --- |
| 실시간 질문 인쇄본 | `public/0704-admin/live-sheet-questions-print.pdf` | 있음, 2026-07-04 15:53 생성 |
| 실시간 의제 인쇄본 | `public/0704-admin/live-sheet-agendas-print.pdf` | 있음, 2026-07-04 15:53 생성. HTML 기준 A/B 의제 후보 17행 |
| 전문가 질문 샘플 | `public/0704-admin/expert-questions-print.pdf` | 있음, 2026-07-03 생성 |
| 조별 의제 샘플 | `public/0704-admin/group-agendas-print.pdf` | 있음, 2026-07-03 생성 |

해석:

- 7월 4일 실시간 출력 기준으로는 `live-sheet-*` 두 파일이 핵심 증거다.
- 7월 3일 생성된 `expert-questions-print.pdf`, `group-agendas-print.pdf`는 샘플/초기 구조 확인용으로 남겨야 한다.

### 데이터와 검증 리포트

| 구분 | 파일 | 확인 내용 |
| --- | --- | --- |
| 실시간 Sheet 패킷 | `evaluation/0704-live-sheet-packets-report.json` | questionCount, agendaCount, PDF/HTML 출력 경로 |
| 의제투표 구조 검증 | `evaluation/0704-agenda-vote-structure-test-report.json` | A/B조 선정 marker, 4개 의제 승격, QR, 최종 문구 검증 항목 |
| 투표 무결성 점검 | `evaluation/0704-vote-integrity-check.json` | agendaVote, decisionVotes, duplicate/drop 관련 점검 |
| 투표 reset | `evaluation/0704-vote-reset-report.json` | reset marker와 reset 전후 상태 |
| 의사결정 투표 report | `evaluation/0704-decision-votes-report.json` | refresh 결과와 sheet URL |

### 라이브 URL 상태

2026-07-05 확인 기준 모두 HTTP 200 응답이다.

| 화면 | URL |
| --- | --- |
| 관리자 | https://climate-assembly.org/0704-admin/ |
| 질문 보드 | https://climate-assembly.org/question-board-0704/ |
| 선정질문 보드 | https://climate-assembly.org/selected-question-board-0704/ |
| 전체 의제 후보 | https://climate-assembly.org/agenda-board-0704/?view=all |
| 선정 의제 | https://climate-assembly.org/agenda-board-0704/ |
| 의제투표 결과 | https://climate-assembly.org/agenda-vote-0704/?sheet=1wbAwRa7ynC12SanI7VJWc-fMea_NmOPVvIAKBLt5Wrw |

## 무엇은 잘 됐나

1. 현장 중간 변경을 버티며 최종적으로 질문, 의제, 투표, 결과 발표 화면을 모두 구성했다.
2. 질문 17개와 선정 질문 4개, 전체 의제 후보와 선정 의제 4개를 분리하는 구조를 만들었다.
3. live Scores Sheet가 4개 의제만 내려오는 상태까지 맞췄다.
4. 질문 보드, 선정질문 보드, 전체 의제 보드, 선정 의제 보드, 투표 구조, 최종 버블레이스 캡쳐가 모두 남아 있다.
5. `docs/0704-live-operation-retrospective.md`와 `docs/jaehong-loop-field-ops.md`로 운영 교훈이 문서화되어 있다.

## 다음 운영을 위한 Jaehong Loop 체크리스트

### Preflight

- 관리자 URL 200 확인
- QR 확대 모달 확인
- Form 응답 URL과 편집 URL 확인
- Sheet 탭/컬럼 확인
- Board `view=all`, `view=selected` 확인
- Scores fallback JSON과 live Sheet row count 일치 확인

### Watch

- Sheet polling 상태 표시
- 질문/의제 row count 표시
- PDF 최신 생성 시각 표시
- Form 응답 수와 Scores row count 표시
- watch 프로세스 종료 시 관리자 화면에 경고

### Finalize

- 사람이 최종 문구를 확정한다.
- Sheet/Form/Scores/Board/PDF 문구를 대조한다.
- 질문 17개, 선정 질문 4개, 의제 후보 8개 shortlist, 선정 의제 4개 화면을 각각 캡쳐한다.
- 버블레이스는 `capture=final` 상태로 캡쳐한다.
- final manifest에 파일 경로와 해시를 남긴다.

### Archive

- 공식 캡쳐 6종 이상을 작업산출물 폴더에 저장한다.
- PDF/HTML/JSON/evaluation report를 묶는다.
- 회고 문서와 메모리 노트를 남긴다.
- git commit/push까지 닫는다.

## 권장 구현

1. `scripts/jaehong-loop.ps1`
   - `preflight`, `watch`, `finalize`, `archive` 서브커맨드 제공

2. `scripts/verify-0704-final-wording.ps1`
   - Sheet/Form/Scores/Board/PDF 문구 일치 검증

3. `scripts/capture-0704-live-artifacts.mjs`
   - 질문/선정질문/전체의제/선정의제/투표구조/버블레이스 캡쳐 일괄 수행

4. `evaluation/0704-live-artifact-manifest.json`
   - 공식 산출물 목록, URL, 파일 크기, 생성 시각, 캡쳐 모드 기록

5. 관리자 화면의 운영 상태 패널
   - 마지막 Sheet 읽기
   - 마지막 PDF 생성
   - 마지막 배포 확인
   - 응답 수
   - Scores row count
   - final capture 존재 여부

## 리뷰 판정

0704 운영은 결과물 보존까지는 성공했다. 하지만 운영 안정성 기준으로는 "사람이 계속 바꾸는 최종 판단을 모든 산출물에 자동 전파하고 검증하는 루프"가 부족했다. 다음 운영에서는 기능을 더 늘리기보다, Jaehong Loop를 명령과 화면 상태로 구현하는 것이 우선이다.

가장 먼저 고칠 것은 두 가지다.

1. live Sheet와 fallback JSON의 불일치 제거
2. `의제 8개 후보 shortlist`를 별도 URL/PDF/캡쳐로 고정
3. 최종 확정 직전 `finalize -Capture` 단일 명령 도입
