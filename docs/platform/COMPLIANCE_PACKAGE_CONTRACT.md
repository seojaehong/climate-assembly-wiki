# B4/B5 개인정보 영향평가·공공기록물 지원 패키지 계약

## 목적과 책임 경계

이 패키지는 공론화 SaaS가 처리하는 데이터셋을 현재·계획 schema와 연결하고, 기관이
개인정보 영향평가 자료와 기록관리기준표 매핑을 빠짐없이 작성하도록 돕는다. 제품은 개인정보의
법적 분류, 처리 근거, 보존기간 또는 폐기를 자동 결정하지 않는다.

- `complianceCertified`는 항상 `false`다.
- `legalAssessmentPerformedByProduct`는 항상 `false`다.
- 기관의 개인정보 책임 역할과 기록물관리 책임 역할이 각각 판단을 확정해야 한다.
- profile과 생성 산출물은 저장소·공개 경로 밖에 둔다.
- 생성기는 DB·Auth·외부 API를 호출하거나 데이터를 변경하지 않는다.

개인정보 영향평가 항목은 개인정보보호위원회의
[개인정보 영향평가 수행안내서(2024.4)](https://pipc.go.kr/np/cop/bbs/selectBoardArticle.do?bbsId=BS217&mCode=G010030000&nttId=10089)를
기준 참조점으로 둔다. 기록물 매핑은 국가기록원의
[기록물관리 공공표준 목록](https://archives.go.kr/next/newdata/standardCondition.do)과
[기록관리기준표·보존기간 분류](https://archives.go.kr/next/newmanager/standardDiagramList.do)를
참조한다. [공공기록물 관리에 관한 법률 시행령 제26조](https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lspttninfSeq=67908)의
보존기간 구분을 값의 기준으로 삼지만, 특정 데이터셋에 어느 기간을 적용할지는
기관 기록관리기준표와 책임자 판단으로 확정한다.

## 정본 파일

| 파일 | 역할 |
|---|---|
| `platform-compliance-catalog.json` | 제품 데이터셋·schema object·흐름의 버전 관리 정본 |
| `compliance-institution-profile.template.json` | 기관별 판단을 저장소 밖에서 작성하는 입력 양식 |
| `platform-compliance-package.mjs` | 검증·정규화·checksum·JSON/Markdown 생성기 |

카탈로그의 table 집합은 `supabase/migrations/*.sql`에서 발견한 모든 `climate_vote` table과
legacy `session`, `rounds`, `votes`, `snapshots`를 정확히 한 번 포함해야 한다. 휴면 migration
table도 `dormant_draft`로 포함해 향후 활성화 전에 평가 범위를 놓치지 않는다. DB table이 없는
브라우저 메모리 음성·전사 처리도 `transient-audio-transcript` 데이터셋으로 별도 표시한다.

## 완료 조건

다음 항목이 모두 채워져야 `readyForInstitutionSubmission:true`다.

1. 서비스 트랙이 비공공 managed 또는 공공조달 후보 중 하나로 확정됨
2. 개인정보 검토 상태, 책임 역할, 검토시각, 처리 근거 문서가 확정됨
3. 정치적 의견과 음성·생체 가능성의 기관 분류가 확정됨
4. 국외 이전, 수탁자 목록, 고지·동의 검토가 확정됨
5. 모든 데이터셋에 기록 유형, 단위과제 코드, 보존기간, 기산점, 처분 방식, 처분 권한,
   파기 방법이 매핑됨
6. 기록물 검토 상태, 책임 역할, 검토시각, 기록관리기준표 근거가 확정됨

기관 판단이 `approved`인데 필수 근거가 비어 있으면 모순으로 보고 출력 생성 자체를 거부한다.
그 밖의 미결정 값은 blocker 목록으로 보존하고 제출 준비 상태를 거짓으로 올리지 않는다.

## 보존·폐기 안전 경계

생성기는 보존기간 만료를 데이터 삭제 명령으로 바꾸지 않는다. 국가기록원 안내가 설명하는
평가·폐기 절차처럼 실제 처분은 기관 기록관리 절차와 권한을 거쳐야 한다. 따라서
`dispositionAction=institution_records_process`는 승인된 기관 절차로 넘긴다는 뜻이며 DB 삭제,
스토리지 삭제, key 폐기 또는 snapshot 제거를 실행한다는 뜻이 아니다.

## 변경 통제

- 새 migration table은 카탈로그 분류 없이 CI를 통과할 수 없다.
- table 하나를 여러 데이터셋에 중복 배정할 수 없다.
- catalog/profile의 알 수 없는 field, 중복 dataset, 중복 retention mapping은 거부한다.
- `recordClass`는 회의록, 행정기록, 감사기록, 시스템기록, 공개 결과물, 비기록 또는 기관 미결정
  중 하나여야 하며 제품이 회의록 해당 여부를 자동 판정하지 않는다.
- 생성 파일은 canonical package checksum을 포함하고 기존 경로를 덮어쓰지 않는다.
- 실제 기관 profile은 Git에 커밋하지 않는다.
