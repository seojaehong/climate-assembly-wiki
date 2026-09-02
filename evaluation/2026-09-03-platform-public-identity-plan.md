# B6 공공 IdP 연계 계획 검증

- 기준 commit: `cbd21054036ba38c3164dc20ac91d2c7923a9e14`
- 집중 테스트: 6건 통과
- 기본 profile blocker: 17개
- template plan checksum: `cd4b79410a6690fd3348360db2ab98205ea8808f924aa584d6f9c714a26c94fa`
- production DB/Auth/IdP 변경: 0건
- 실제 credential 사용: 0건; credential 전용 입력·출력 field: 0개

## 구현 결과

기관별 SAML/GPKI gateway 결정, SP endpoint, metadata 근거, 불변 subject 기반 계정 연결,
assertion 검증, replay 차단, 시간 동기화 책임과 기관 승인을 exact-schema profile로 검증한다.
GPKI는 SAML과 같은 것으로 취급하지 않고 기관이 승인한 gateway가 있는 경우에만 해당 모드를
준비 완료로 판정한다.

기본 template를 저장소 밖에서 실제 실행한 결과는
`needs_institution_identity_decisions`, `readyForInstitutionIntegration:false`,
`databaseMutationExecuted:false`, `authProviderRegistered:false`,
`credentialFieldSchemaIncluded:false`였다.
따라서 제품 측 계약과 안전한 실행 전 계획은 준비됐지만 실제 B6 통합 완료 증거는 아니다.

## 코드 검증 범위

- HTTPS Auth/application/metadata URL과 metadata query token 거부
- IdP metadata 인증서 fingerprint·검토시각 검증
- GPKI gateway 승인·소유자·근거의 all-or-none 계약
- JIT provisioning과 외부 attribute 기반 application role 부여 거부
- 서명·audience·destination·recipient·InResponseTo·replay 안전 기본값 강제
- 미래 검토시각, 저장소 내부 profile/output, 기존 출력 덮어쓰기 거부
