# 공론화 SaaS 전체 완료 감사 — 2026-09-03

## 판정

전체 계획은 아직 완료가 아니다. 현재 vertical 운영 제품과 Phase A의 상당한 코드·검증 계약은
구현됐지만, 판매 가능한 멀티테넌트 SaaS를 만드는 production 활성화와 Phase B 조달·인증,
Phase C 글로벌 항목이 남아 있다. 이 문서는 계획서의 각 항목을 현재 저장소 증거와 대조한 기준선이다.

- 기준 소스: RTL 후속 시작 시점 `origin/main` merge commit `abb72d9d209d931f698fcd959275424960559722`
- 운영 검증: `climate-assembly-wiki.pages.dev`와 `climate-assembly.org`가 같은 commit manifest 제공
- 운영 자산 검증: 두 origin에서 각각 12회 probe 통과
- production DB mutation: 이번 작업에서 0건

## 요구사항별 현재 상태

| 항목 | 상태 | 현재 증거 | 완료에 필요한 다음 조건 |
|---|---|---|---|
| Phase 0 vertical | 운영 중 | 공개 사이트, 모더레이터·HQ·제출·투표·보고서 경로 | 운영 회귀 감시 지속 |
| A1 인증·RLS | production 미완료 | 인증 UI·토큰·정책·preflight 계약과 테스트 | staff Auth 전환 시점 확정, production 적용·실계정 E2E |
| A2 멀티테넌시 | production 미완료 | P1C/A2 migration·rollback·verifier·격리 rehearsal | Gate B-A2 승인, count-only preflight, mapping remediation, 별도 GRANT 승인 |
| A3 5역할·조직·초대 | production 미완료 | UI·계획기·adapter-independent executor/receipt 계약 | named pilot·운영 owner·승인 책임자, durable invitation/receipt와 production adapter |
| A4 셀프서비스 설계 | production 미완료 | schema v4 마법사, migration 초안, fenced RPC adapter, approval bundle | production migration·권한·key custody·live authorization adapter의 개별 승인과 적용 |
| A5 KWCAG 2.2 AA | 부분 완료 | 자동 WCAG/KWCAG 매핑, 키보드·포커스·반응형 CI | 실제 스크린리더와 모바일 보조기기 수동 평가, 접근성 성명 확정 |
| A6 복구·export·감사 | 부분 완료 | 서명 snapshot/export, 복원 rehearsal, workflow | provider PITR/WAL 통제, production platform snapshot 활성화, 사용자 행위 감사로그 |
| A7 이행추적·원문 역링크·HITL | 부분 완료 | source publication, implementation tracking, review queue 계약과 UI | production 저장·공개 adapter, 실제 기관 응답을 사용한 승인 흐름 |
| B1 데이터 분류 | 조건부 | Gate A 권고 방향 기록 | 실제 pilot 데이터 등급·CSAP 등급 확정 |
| B2 CSAP 인프라 | 미착수 | 아키텍처 선택 조건만 문서화 | 적격 provider/topology 확정 후 셀프호스트 구축 |
| B3 인증·조달 등록 | 외부 절차 | 요구 관문 문서화 | CSAP 심사와 디지털서비스 선정·등록 |
| B4 PIA 패키지 | 기관 입력 대기 | DB·비영속 음성 흐름을 포함한 10개 데이터셋·37개 table 카탈로그, 개인정보 판단 profile, fail-closed JSON/Markdown 생성기 | 기관 처리 근거·민감정보·국외 이전·수탁자·고지/동의 판단 확정 |
| B5 기록물 매핑 | 기관 입력 대기 | 모든 데이터셋의 기록 유형·단위과제·보존기간·기산점·처분 권한·파기 방법 입력 계약과 schema coverage CI | 기관 기록관리기준표와 책임자 검토값 확정 |
| B6 GPKI/SAML | 기관 입력 대기 | self-hosted SAML SP·IdP metadata·GPKI gateway·계정 연결·assertion 안전 정책의 fail-closed 계획 생성기 | 기관 metadata·gateway·책임자 승인과 격리 통합 시험 |
| B7 셀프호스트 부하 검증 | 선행조건 대기 | managed 환경 수치는 기준으로 사용하지 않음 | B2 환경 완성 후 동일 시나리오 재측정 |
| Phase C 글로벌 | 부분 구현 | 한국어 SSOT, 6개 locale 정적 빌드, 중앙 locale registry, Arabic RTL 문서 방향·구조 전용 고지 | 아랍어 원문 번역·native review, RTL 수동 시각/보조기기 검수, 리전별 데이터주권, 라이선스, 비동기 채널, 자동 진행 기능 |

## 이번 구현 — 8/29 provenance 공백

`automation/platform-analysis-provenance-map.mjs`를 추가했다. 분석 입력의
`분과·조/k{꼭지}/i{순번}` UID를 조·꼭지·항목 좌표와 원문 exact match로 검증한 뒤 실제
`submission_item` UUID에 연결한다. 유사도나 생성 문장을 사용하지 않는다.

안전 경계:

- 분석 입력·submission export·provenance 출력은 모두 저장소 밖만 허용
- source UID 중복, 좌표 불일치, 원문 drift, UUID 누락·오류, 제출 좌표 중복은 fail-closed
- 출력은 importer의 schema version 1이며 DB mutation과 공개 파일 쓰기는 없음
- 8/29 legacy `latest.json`에는 `item_id`가 없으므로 임의 ID로 진행하지 않고 명시적으로 중단

검증 결과:

- provenance generator와 기존 importer 집중 테스트: 2개 파일, 26건 통과
- 실제 8/29 분석입력과 legacy `latest.json` 대조: `Invalid submission item UUID`로 중단
- 위 중단 실행의 출력 파일 생성: 0건
- 프론트 전체 Vitest: 98개 파일, 1,753건 통과
- automation 전체 기본 실행: 511건 중 505건 통과, 임시 Git fixture 6건은 Windows 5초 제한 초과
- 위 6개 관련 파일의 60초 제한 순차 재실행: 92건 통과
- Astro strict check: 446개 파일, 오류·경고 0건, 기존 hint 57건

strict check에서 기존 `BaseLayout.astro`의 hreflang 반복 변수가 암시적 `any`로 추론되는 문제도
발견해 `HreflangLink` 타입을 명시했다. 렌더 결과는 바꾸지 않는다.

## 실행 순서

1. production 변경 없이 가능한 provenance 생성기·테스트·문서화를 병합한다.
2. 승인된 read-only export 또는 기존 platform snapshot에서 실제 `submission_item.id`가 포함된 비공개 파일을 확보한다.
3. 주제별 provenance map과 검수 전 import plan을 생성하고 사람이 원문 역링크를 전수 확인한다.
4. production 적용은 Gate B-A2, A2 진단, 권한, A4 migration/RPC, 실제 issue 적재를 각각 분리 승인한다.
5. 수동 접근성 평가와 Phase B 사업 결정을 병렬로 준비하되 외부 심사 완료를 코드 완료로 표시하지 않는다.

## 9/3 후속 — 현재 submission identity의 안전한 추출 경로

`automation/platform-submission-identity-export.mjs`를 추가해 지정된 Supabase 프로젝트와 세션의
현재 `submission_item`만 서비스 역할로 읽고, 분석 대조에 필요한 UUID·주제/조/순번·원문만
저장소 밖에 내보내도록 했다. 프로젝트 ref 불일치, 다른 세션 행, archive/중복 행, 빈 결과,
16MiB 초과 결과는 모두 파일 생성 전에 거부하고 DB mutation은 실행하지 않는다.

이 경로는 현재 행의 FK 대상 UUID를 확보하는 수단이다. S8의
`submission_item_archive`에는 삭제 전 `submission_item.id`가 저장되지 않으므로 이미 삭제된
과거 행의 원래 UUID는 현재 스키마만으로 복구할 수 없다. 따라서 8/29 분석 원문과 현재 행이
exact match되지 않으면 실데이터 provenance 완료 증거가 아니며, 임의 UUID 생성이나 archive
bigint ID 대체를 금지한다. 실제 자격증명 주입 실행과 private export 생성은 아직 하지 않았다.

### live read probe

환경에 이미 주입된 운영 URL·service role key를 값 노출 없이 사용해 새 exporter를 실행했다.
지정 세션의 첫 `SELECT`가 PostgreSQL 권한 코드 `42501`·HTTP 403으로 중단됐고 private output은
생성되지 않았다. 같은 자격증명으로 기존 `climate_vote.snapshots` 22행은 읽을 수 있었지만,
payload key만 비식별 검사한 결과 `submission_item`을 포함한 platform snapshot은 0행이었다.
따라서 현재 실 ID 확보 경로는 없다. 최소 테이블 SELECT 권한 또는 UUID를 반환하는 read-only
SECURITY DEFINER RPC를 운영에 추가하는 것은 권한 변경이므로 별도 승인 전에는 적용하지 않는다.

### 최소 권한 RPC 준비

직접 table SELECT를 넓히지 않고 지정 세션의 현재 identity source만 반환하는 service-role-only
RPC를 권고안으로 확정했다. exporter에는 명시적 `read_only_rpc` adapter를 추가하되 자동
fallback은 두지 않았다. RPC 응답의 schema version·root field·세션/행 관계를 전수 검증하고
private export에 source access method를 보존한다. 실제 migration SQL은 승인 전 작성하지 않았고,
적용·allow/deny·rollback·실 export 범위는
`docs/platform/SUBMISSION_IDENTITY_RPC_APPROVAL_PACKET.md`에 분리했다.

## B4/B5 기관 제출 지원 패키지

현재·휴면 migration의 `climate_vote` table과 legacy 4개 table을 9개 DB 업무 데이터셋에 정확히
한 번씩 매핑하고, 브라우저 메모리의 비영속 음성·전사 후보를 별도 데이터셋으로 추가한 catalog를
구축했다. 생성기는 기관 profile의 서비스 트랙, 처리 근거, 정치적
의견·음성 분류, 국외 이전, 수탁자, 고지/동의와 데이터셋별 기록 유형·단위과제·보존기간·
기산점·처분 방식·권한·파기 방법을 검증한다. 기관 검토가 `approved`인데 필수 근거가 비어 있으면 모순으로 거부하고,
그 밖의 미결정 값은 blocker로 보존해 제출 준비 완료를 표시하지 않는다.

기본 template 실행은 데이터셋 10개·table 37개를 포함하고 institution-owned blocker 80개를
보고했으며 `readyForInstitutionSubmission:false`, `complianceCertified:false`,
`legalAssessmentPerformedByProduct:false`, `databaseMutationExecuted:false`를 유지했다. 따라서
제품 측 자료 구조는 준비됐지만 B4/B5 자체는 기관 책임자 판단 전 완료가 아니다.

## B6 공공 IdP 연계 계획

GPKI를 SAML과 동일한 기술로 가정하지 않고 `saml2`와 `gpki_via_saml_gateway`를 분리했다.
기관 profile은 self-hosted Auth URL, application origin, IdP metadata source·entity ID·인증서
fingerprint, 불변 subject와 계정 연결 방식, assertion 검증 정책, gateway 소유자·근거 및 최종
검토를 요구한다. JIT provisioning과 외부 attribute 기반 application role 부여는 거부한다.

기본 template 실행은 institution-owned blocker 17개를 보고했으며
`readyForInstitutionIntegration:false`, `databaseMutationExecuted:false`,
`authProviderRegistered:false`, `credentialFieldSchemaIncluded:false`를 유지했다. 실제 Auth admin API·IdP·DB는
호출하지 않았으므로 B6 통합 자체는 기관 설정과 격리 시험 전 완료가 아니다.

## Phase C RTL·locale 기반

공개 다국어 surface의 locale 목록을 `src/lib/site-locales.ts`에 모으고 Arabic(`ar`)을 구조 전용
locale로 추가했다. `BaseLayout.astro`와 deprecated `Base.astro` 모두 문서 방향을 registry에서
계산하므로 Arabic 정적 페이지는 `lang="ar" dir="rtl"`을 출력한다. 홈·의제 목록·의제 상세·
원천 상세에는 Arabic 본문이 번역 완료된 것처럼 보이지 않도록 현지어 구조 전용 고지와 KO/EN
원문 링크를 표시한다. sitemap·hreflang·언어 전환·Open Graph locale도 같은 6개 locale 계약에
맞췄다.

이 단계는 RTL 기술 기반만 구현한 것이다. Arabic 본문 번역과 현지어 검수, 브라우저별 시각 검수,
스크린리더 수동 평가는 완료로 간주하지 않으며 Phase C의 데이터주권·라이선스·대규모 비동기 기능도
여전히 남아 있다. production DB/Auth 변경은 실행하지 않았다.

검증 결과:

- locale registry 집중 테스트: 1개 파일, 3건 통과
- Astro strict check: 454개 파일, 오류·경고 0건, 기존 hint 57건
- 정적 production build: 9,493개 페이지 생성
- 산출 HTML: Arabic 홈·의제 상세·원천 상세의 `lang="ar" dir="rtl"`, 구조 전용 고지,
  Arabic hreflang과 sitemap URL 확인
- 헤더 회귀 보완: 모든 구조 locale에서 로고·내부 탐색이 현재 locale을 유지하고, 모바일 메뉴에서도
  6개 언어 전환 링크를 제공하도록 source contract와 산출 HTML을 확인
- 프론트 전체 Vitest: 99개 파일 중 97개 파일, 1,756건 중 1,753건 통과. 실패 3건은
  Windows CRLF checkout에서 LF 문자열을 exact match하는 기존 source-contract 테스트이며 변경 로직과 무관하다.
