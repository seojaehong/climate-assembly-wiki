# B6 공공 IdP 연계 계약

## 목적과 현재 경계

이 계약은 공공기관 운영자 로그인을 self-hosted Supabase Auth의 SAML 2.0 서비스 제공자(SP)와
기관 IdP 사이에 연결하기 전에 필요한 값을 구조화한다. 실제 IdP 등록, 인증서·개인키 생성,
Auth 설정, 계정 생성, membership 부여, DB 변경 또는 로그인 traffic 활성화는 수행하지 않는다.

행정전자서명 인증관리센터는 GPKI를 공개키 암호기술 기반의 정부 전자서명 기반구조로 설명한다.
따라서 이 제품은 GPKI 인증서를 SAML assertion으로 직접 간주하지 않는다. 기관이 제공하거나
승인한 GPKI-SAML 게이트웨이의 소유자와 근거가 있을 때만 `gpki_via_saml_gateway`를 선택한다.

## 기술 기준

- [행정전자서명 인증관리센터의 GPKI 인증체계 설명](https://gpki.go.kr/jsp/centerIntro/mainBusiness/management/searchManagement_03.jsp)
- [OASIS SAML 2.0 metadata 표준](https://docs.oasis-open.org/security/saml/v2.0/saml-metadata-2.0-os.pdf)
- [self-hosted Supabase SAML SSO 설정](https://supabase.com/docs/guides/self-hosting/self-hosted-saml-sso)

Supabase Auth의 공개 SP metadata와 ACS 경로는 기관 profile의 `authBaseUrl`에서 각각
`/sso/saml/metadata`, `/sso/saml/acs`로 결정한다. IdP metadata URL은 query parameter를
허용하지 않고, profile에는 metadata XML·인증서·개인키·service role key를 넣지 않는다.

## 인증과 권한의 분리

- SAML assertion은 외부 주체 식별까지만 담당한다.
- JIT 계정·membership 생성은 금지한다.
- IdP attribute가 `org_admin`, `operator`, `hq`, `facilitator` 역할을 직접 부여할 수 없다.
- 계정 연결은 사전 등록된 불변 subject exact match 또는 관리자 승인 방식만 허용한다.
- 실제 `climate_vote.membership` 부여는 별도 승인된 access workflow로 수행한다.

## fail-closed 조건

다음 값이 모두 확정되어야 `readyForInstitutionIntegration:true`다.

1. self-hosted Supabase 배포와 federation 방식
2. HTTPS Auth base URL과 application origin
3. IdP metadata 출처·entity ID·인증서 SHA-256 fingerprint·검토시각·갱신 책임 역할
4. persistent 또는 email NameID, 불변 subject, email attribute, 계정 연결 방식
5. response/assertion 서명, audience·destination·recipient·InResponseTo 검증, replay 거부
6. assertion 암호화 판단과 시간 동기화 책임 역할
7. GPKI 방식이면 승인된 SAML gateway 소유자와 근거
8. 기관 책임 역할의 최종 검토와 canonical UTC 시각

미결정 값은 blocker로 남는다. 출력은 항상 `databaseMutationExecuted:false`,
`authProviderRegistered:false`, `credentialFieldSchemaIncluded:false`를 유지한다. 자유문자 값에
비밀을 입력하지 않는 것은 별도 운영 책임이며 이 필드는 credential 부재를 포괄 보증하지 않는다.

## 정본과 민감정보 경계

| 파일 | 역할 |
|---|---|
| `public-identity-institution-profile.template.json` | 저장소 밖에서 작성할 기관 입력 양식 |
| `platform-public-identity-plan.mjs` | exact-schema 검증, 파생 endpoint, checksum, private plan 생성기 |

실제 기관 profile과 plan은 Git·public 경로 밖에 두며 기존 파일을 덮어쓰지 않는다. IdP metadata
문서와 signing/decryption key는 이 profile의 값이 아니라 기관의 승인된 비밀·인증서 관리
절차에서 별도로 보관한다.
