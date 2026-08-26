# 분석코어 import provenance exact-field 검증

## 구현 결과

분석코어 import의 사람이 준비하는 provenance overlay를 schema별 exact contract로 검증한다. 알 수 없는 필드를 무시해 출처 연결이나 검수 정보가 손실되는 대신 plan 생성 전에 fail-closed한다.

## 허용 필드

- schema v1 root: `schemaVersion`, `topicId`, `sourceMappings`
- schema v2 root: v1 필드와 `candidateMappings`
- source mapping: `sourceUid`, `transcriptChunkId`, `itemId`, `clusterId`
- candidate mapping: `recommendationId`, `title`, `summary`, `sourceRecommendationSha256`, `minorityMappings`
- minority mapping: `index`, `minorityId`, `title`, `sourceTextSha256`, `citedUids`

## TDD 경계

- red: source mapping의 `clusterID`가 무시되고 plan이 생성되는 기존 동작을 재현했다.
- candidate mapping의 알 수 없는 내부 메모를 거부한다.
- minority mapping의 잘못된 citation 필드를 거부한다.
- schema v2 root의 알 수 없는 필드를 CLI에서 JSON 의미 검증 전에 차단한다.
- 오류에는 알 수 없는 필드명·값·source UID·시민 원문을 포함하지 않는다.
- Python analysis recommendation 본체는 별도 실제 산출 계약이므로 이번 exact overlay allowlist의 대상이 아니다.

## 검증

- focused: `npm.cmd test -- --run tests/platform-analysis-import.test.mjs` — 1개 파일, 19건 통과
- automation 전체: 27개 파일·439건 통과
- 루트 전체: 64개 파일·1,077건 통과
- Astro: 330개 파일, 오류·경고 0건, 기존 hint 49건

## 비변경 범위

실제 8/29 산출, 시민 원문, Supabase, DB, API, public asset과 배포 상태를 읽거나 변경하지 않았다.
