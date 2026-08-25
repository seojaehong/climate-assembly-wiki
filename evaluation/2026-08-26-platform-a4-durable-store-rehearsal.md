# A4 로컬 durable store 리허설 보고서

- 검증일: 2026-08-26 (Asia/Seoul)
- 범위: 저장소 밖 로컬 authorization journal·append-only receipt adapter
- production 적용: 수행하지 않음
- credential·Supabase·Auth·RPC 접근: 수행하지 않음
- database mutation: 수행하지 않음

## 구현 경계

- `automation/platform-design-provisioning-durable-store.mjs`는 절대경로이며 저장소 밖에 있는 명시적 rehearsal 디렉터리만 받는다.
- marker가 없는 기존 디렉터리, 저장소 내부 경로, 상대 경로, 예상하지 않은 layout은 쓰기 전에 거부한다.
- approval state와 synthetic authorization context는 approval ID별 immutable SHA-256 chain journal에 기록한다.
- claim·finalize는 approval별 exclusive lock과 expected snapshot compare-and-set으로 직렬화한다.
- receipt는 execution ID별 immutable 파일로 게시하며 같은 receipt는 `existing`, 다른 receipt는 기존 파일을 유지한 `conflict`로 반환한다.
- journal SHA-256은 손상 검출용이다. 외부 서명, live membership, revocation source, key custody 또는 production trust를 제공하지 않는다.
- stale lock은 자동 회수하지 않아 미확정 동시 실행에서 fail-closed한다.

## 장애·재시작 리허설

1. 새 adapter로 claim→synthetic execution result→HMAC receipt append→terminal finalize를 완료했다.
2. adapter 객체를 모두 다시 만든 뒤 같은 execution을 호출했다.
3. 기존 receipt를 읽어 RPC adapter 호출 없이 `existing_receipt`로 복구하고 terminal claim `completed`를 유지했다.
4. 서로 다른 authorization adapter 두 개의 동시 claim에서 하나만 `new`, 다른 하나는 current journal tail로 `reconciled`됐다.
5. 서로 다른 receipt adapter 두 개의 동시 append에서 하나만 `appended`, 다른 하나는 `existing`이 됐다.
6. 같은 execution ID의 다른 digest는 `conflict`가 되고 최초 receipt는 restart 뒤에도 유지됐다.
7. authorization journal 내용을 hash 갱신 없이 변경하자 read 단계에서 integrity 오류로 중단됐다.
8. approval 하위 디렉터리를 저장소 밖으로 향하는 junction으로 바꾸자 초기화 전에 거부됐다.
9. 영속 receipt에는 Auth 사용자 식별값, resource UUID, team join code가 포함되지 않았다.
10. unclaimed approval의 local revocation을 journal에 기록한 뒤 adapter를 다시 만들어도 새 claim이 거부되고 claim은 `null`로 유지됐다.
11. active claim 뒤 synthetic membership을 비활성화하자 finalize가 거부되고 terminal state로 닫히지 않았다.
12. claim과 revocation을 동시에 시작했을 때 하나의 transition만 journal에 추가되고 최종 상태가 `claimed`와 `revokedAt`을 함께 갖지 않았다.

## 자동화 검증

- A4 plan·bundle 집중: 2개 파일, 46건 통과
- automation 전체: 26개 파일, 364건 통과
- 애플리케이션 전체: 64개 파일, 1,060건 통과
- Astro check: 327개 파일, 오류 0건, 기존 hint 49건
- A4 bundle: artifact 17개, checksum `602b87647c795b8be6f8618c5bbcf087ddbe6e546e950c9e51a11942c9f68846`

## 남은 production blocker

- 승인 발급 경로와 실제 HMAC key custody
- production-grade durable revocation/claim·append-only receipt 저장소
- live Auth/membership/org/host를 같은 transaction에서 검증하는 CAS adapter
- production design executor와 read-only status adapter
- migration·mapping·RPC 권한·role별 E2E에 대한 별도 승인

결론: 로컬 crash/restart와 append-only 계약은 재현됐지만 production readiness는 아니다. `readyForExecution:false`, `productionApplyApproved:false`, `databaseMutationExecuted:false`를 유지한다.
