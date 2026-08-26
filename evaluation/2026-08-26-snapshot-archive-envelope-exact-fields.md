# Snapshot archive envelope exact-field 검증

## 결과

서명된 platform snapshot archive의 복구 verifier가 HMAC 일치만으로 알 수 없는 envelope 필드를 받아들이지 않도록 exact-field 계약을 적용했다. schema drift는 복구 과정에서 무시되지 않고 검토 전에 fail-closed한다.

## 검증 경계

- archive root: `legacy`, `platform`, `audit` 필수·추가 필드 금지
- platform row: `id`, `source`, `payload` 필수; 현재 snapshot table의 알려진 필드만 허용
- audit: schema·event·GitHub provenance·key/snapshot ID·integrity 필수; 추가 필드 금지
- integrity: `algorithm`, `target`, `digest` 필수·추가 필드 금지
- platform payload: 복구 대상 8개 collection과 `counts`만 허용
- declared counts: `submission`, `issue`, `issue_link`, `result_page`, `ballot`만 허용

`legacy` 내부 형상은 기존 snapshot 계약의 별도 payload이므로 이번 platform 복구 exact-field 검증 대상에 포함하지 않았다.

## TDD 증거

- RED: archive root의 `legacy` 누락과 알 수 없는 root 필드가 기존 HMAC 검증을 통과했다.
- 첫 원격 CI는 격리 PostgreSQL용 생성 fixture가 실제 export와 달리 `legacy`를 누락한 채 통과해 왔음을 드러내며 restore 단계에서 실패했다. fixture를 실제 envelope와 맞추고 생성 결과 자체를 검증하는 회귀 테스트를 추가했다.
- signed drift: audit·integrity·platform row·payload·declared counts에 알 수 없는 필드를 넣은 유효 HMAC fixture를 거부한다.
- confidentiality: 오류에는 추가 필드명·값·archive 원문을 포함하지 않는다.

## 검증

- focused: `npm.cmd test -- --run tests/snapshot-db.test.mjs` — 1개 파일, 64건 통과
- automation 전체: 27개 파일, 441건 통과
- 루트 전체: 64개 파일, 1,077건 통과
- Astro: 330개 파일, 오류·경고 0건, 기존 hint 49건

루트 package에는 `test` script가 없어 `npm.cmd test`는 명령 오류로 종료했으며, 정본 전체 회귀 명령 `npm.cmd exec vitest -- run`으로 다시 검증했다.

## 비변경 범위

production Supabase·Drive·snapshot archive·HMAC credential·PITR/WAL·운영 감사로그를 읽거나 변경하지 않았다.
