# A7 DOCX 원문 역링크 검증

## 구현 결과

공개 결과 보고서가 웹과 동일한 `ResultView` 공개검수 경계를 사용한다. 승인된 원문은 쟁점별 보고서 모델에 조·종류·순번·발췌·공개 검수일·검수 역할·payload SHA-256과 함께 보존된다. DOCX는 쟁점과 원문에 결정적 bookmark를 만들고 쟁점→첫 원문, 각 원문→쟁점의 internal hyperlink를 제공한다.

## 차단 경계

- 원문 공개 계약 검증은 `result-view-logic.ts` 한 곳에서 수행한다.
- 미검수 쟁점, 잘못된 record, 중복 key, 승인 계약 밖 필드는 원문 묶음 전체를 숨긴다.
- DOCX 모델과 OOXML에는 차단된 원문 발췌가 남지 않고 `근거 원문 공개 정보 확인 필요`만 표시된다.
- 기존 payload에 원문 필드가 없으면 기존 DOCX 구조를 유지한다.
- UI와 DOCX는 제공된 SHA-256 형식만 보존한다. 원문 bytes와 digest의 실제 결속은 후속 승인된 publish preflight/RPC 책임이다.

## 검증

- TDD red: DOCX 모델 보존, 미검수 원문 차단, bookmark·왕복 hyperlink 4건 실패 재현
- 집중 테스트: `npm.cmd exec vitest -- run src/islands/result/result-report-docx.test.ts` — 1개 파일, 29건 통과
- 루트 전체: `npm.cmd exec vitest -- run` — 64개 파일, 1,077건 통과
- automation 전체: `npm.cmd test -- --run` — 27개 파일, 422건 통과
- Astro: `npm.cmd run check` — 330개 파일, 오류 0건, 기존 hint 49건
- 합성 DOCX OOXML: `result_issue_1`, `result_source_1_1` bookmark와 양방향 `w:anchor` 확인
- 합성 DOCX 접근성 구조 감사: high 0건, 기존 key-value 표의 medium 2건, 새 원문 메타 추가 경고 0건
- PNG 시각 렌더: 로컬 LibreOffice 실행 파일 부재로 미실행

## 미완료·승인 경계

- production `result_page` payload에는 아직 `source_references`가 없다.
- DB/RPC/migration, 실제 시민 원문 캡처, 공개 payload 적재와 게시를 수행하지 않았다.
- 실제 Word에서 링크 왕복, 스크린리더·모바일 보조기기 수동 평가는 후속 검증 범위다.
