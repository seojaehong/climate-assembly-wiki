# Snapshot archive schema v1 명시적 호환 경계

## 결과

`verifySnapshotArchiveIntegrity()`의 기본 성공 의미를 schema v2 전체 archive 무결성으로 고정했다. legacy를 서명하지 않은 schema v1은 기본 boolean에서 실패하며, 과거 platform snapshot 복구가 필요한 file verifier만 명시적으로 호환 모드를 사용한다.

## 계약

- 기본 API: schema v2 `legacy+platform+provenance`만 `true`
- v1 직접 검증: `{ allowPlatformOnlyV1: true }` 필수
- file `--verify|--rehearse`: v1 호환을 내부에서 명시적으로 선택
- v1 결과: `integrityTarget: platform+provenance`, `legacyIntegrityVerified: false`
- v2 결과: `integrityTarget: legacy+platform+provenance`, `legacyIntegrityVerified: true`

## TDD 증거

- RED: v1 platform-only archive가 옵션 없는 기본 integrity boolean에서 `true`였다.
- GREEN: 같은 호출은 `false`, 명시적 v1 호환 호출은 `true`다.
- v1 legacy 변조는 호환 HMAC 범위 밖이라는 기존 한계를 유지하고 결과 필드로 노출한다.
- v2 생성·legacy 변조 거부·file verifier·restore rehearsal 계약은 그대로 통과한다.

## 검증

- focused: `npm.cmd test -- --run tests/snapshot-db.test.mjs` — 1개 파일, 67건 통과
- automation 전체: 27개 파일, 444건 통과
- 루트 전체: 64개 파일, 1,077건 통과
- Astro check: 330개 파일, 오류·경고 0건, 기존 hint 49건

## 비변경 범위

production Supabase·Drive·snapshot archive·HMAC key·PITR/WAL·운영 감사로그를 읽거나 변경하지 않았다.
