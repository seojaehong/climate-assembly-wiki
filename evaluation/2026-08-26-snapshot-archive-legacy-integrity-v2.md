# Snapshot archive legacy 무결성 schema v2

## 결과

신규 platform snapshot archive audit를 schema v2로 올려 기존 `legacy` snapshot RPC 결과와 `platform` snapshot 행을 동일한 HMAC에 결속한다. archive의 두 데이터 축 중 하나가 바뀌어도 검증은 실패한다.

## 계약

- schema v2 target: `legacy+platform+provenance`
- signed record 순서: audit provenance → `legacy` → `platform`
- legacy receipt: null이 아닌 JSON object 필수
- platform receipt: 기존 exact-field·필수 `id|source|payload` 계약 유지
- verifier 결과: `integrityTarget`, `legacyIntegrityVerified`를 항상 출력
- restore SQL 준비·실행 결과도 같은 무결성 범위를 보존

## 과거 schema v1

schema v1 `platform+provenance`는 기존 platform 복구 호환을 위해 검증한다. 다만 legacy는 v1 HMAC에 포함되지 않았으므로 결과는 `legacyIntegrityVerified:false`다. v1 legacy 변조가 platform-only HMAC 결과를 바꾸지 않는 회귀 테스트로 이 한계를 명시하며, 이를 전체 archive 무결성으로 승격하지 않는다.

## TDD 증거

- RED: schema v1 archive의 legacy snapshot ID를 바꿔도 기존 HMAC 검증이 성공했다.
- schema v2: 같은 legacy 변조는 실패한다.
- 생성 경계: 오류 없는 RPC의 빈 legacy receipt를 platform snapshot 생성 전에 거부한다.
- fixture: 격리 PostgreSQL archive 생성기도 schema v2와 같은 signed record를 만든다.

## 검증

- focused: `npm.cmd test -- --run tests/snapshot-db.test.mjs` — 1개 파일, 67건 통과
- automation 전체: 27개 파일, 444건 통과
- 루트 전체: 64개 파일, 1,077건 통과
- Astro: 330개 파일, 오류·경고 0건, 기존 hint 49건

## 비변경 범위

production Supabase·Drive·snapshot archive·HMAC key·PITR/WAL·운영 감사로그를 읽거나 변경하지 않았다.
