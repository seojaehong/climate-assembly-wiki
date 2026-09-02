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
| A6 복구·export·감사 | 부분 완료 | 서명 snapshot/export·복원 rehearsal·workflow, 15-table append-only 사용자 행위 감사 migration/RPC/UI 초안 | 감사 migration production 적용·named actor 실계정 E2E, provider PITR/WAL 통제, production platform snapshot 활성화 |
| A7 이행추적·원문 역링크·HITL | 부분 완료 | source publication, implementation tracking, review queue 계약과 UI | production 저장·공개 adapter, 실제 기관 응답을 사용한 승인 흐름 |
| B1 데이터 분류 | 조건부 | Gate A 권고 방향 기록 | 실제 pilot 데이터 등급·CSAP 등급 확정 |
| B2 CSAP 인프라 | 미착수 | 아키텍처 선택 조건만 문서화 | 적격 provider/topology 확정 후 셀프호스트 구축 |
| B3 인증·조달 등록 | 외부 절차 | 요구 관문 문서화 | CSAP 심사와 디지털서비스 선정·등록 |
| B4 PIA 패키지 | 기관 입력 대기 | DB·비영속 음성 흐름을 포함한 11개 데이터셋·38개 table 카탈로그, 개인정보 판단 profile, fail-closed JSON/Markdown 생성기 | 기관 처리 근거·민감정보·국외 이전·수탁자·고지/동의 판단 확정 |
| B5 기록물 매핑 | 기관 입력 대기 | 모든 데이터셋의 기록 유형·단위과제·보존기간·기산점·처분 권한·파기 방법 입력 계약과 schema coverage CI | 기관 기록관리기준표와 책임자 검토값 확정 |
| B6 GPKI/SAML | 기관 입력 대기 | self-hosted SAML SP·IdP metadata·GPKI gateway·계정 연결·assertion 안전 정책의 fail-closed 계획 생성기 | 기관 metadata·gateway·책임자 승인과 격리 통합 시험 |
| B7 셀프호스트 부하 검증 | 선행조건 대기 | managed 환경 수치는 기준으로 사용하지 않음 | B2 환경 완성 후 동일 시나리오 재측정 |
| Phase C 글로벌 | 부분 구현 | 한국어 SSOT, 6개 locale 정적 빌드, locale별 글꼴·Arabic RTL, 테넌트 등록부 기반 데이터주권 격리 계획기 | 본문 번역·native review, 수동 보조기기 검수, 실제 별도 리전 provision·격리 E2E, 라이선스, 비동기 채널, 자동 진행 기능 |

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

## 9/3 후속 — A6 사용자 행위 감사로그

기관·membership·초대·설계·조별 기록·투표 설계·쟁점·공개 결과를 포함한 15개 table의
INSERT·UPDATE·DELETE를 같은 transaction에서 자동 등록하는 `platform_p4_audit_log.sql` 초안을
추가했다. 감사 행은 resource identity와 변경 column 이름만 저장하고 원문·이메일·token·응답 값은
저장하지 않는다. runtime 역할의 table 직접 접근과 감사 행 UPDATE·DELETE·TRUNCATE를 차단하며,
선택 기관의 active 관리자·운영자·본부만 `platform_audit_list`로 cursor 조회할 수 있다. 기관 기록
화면과 spreadsheet-safe CSV export도 같은 metadata 계약에 연결했다.

PostgreSQL 16 semantic rehearsal과 populated rollback 거부는 CI에 배선했다. 이 초안은 아직
production에 적용하지 않았고 기존 capability 호출은 named Auth 사용자가 없을 수 있으므로 A1 전환 전
actor가 `anon`으로만 남을 수 있다. 따라서 A6 전체가 아니라 감사로그 제품 계약을 준비한 상태다.

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

기본 template 실행은 데이터셋 11개·table 38개를 포함하고 institution-owned blocker 87개를
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

## 9/3 후속 — Windows 전체 회귀 기준 복구

위 3개 실패를 단순 면책으로 남기지 않고 source-contract 테스트가 파일을 읽을 때 CRLF를 LF로
정규화하도록 수정했다. 제품 소스와 배포 산출물은 바꾸지 않았고, Windows와 CI의 줄바꿈 방식에
관계없이 같은 계약 문자열을 검사한다.

검증 결과:

- 이전 실패 집중 테스트: 2개 파일, 53건 통과
- 저장소 전체 Vitest: 105개 파일, 1,775건 전부 통과

## 9/3 후속 — 기존 공개 결과의 이행조치 관리 재개

새로 발행한 결과만 현재 탭에서 관리할 수 있던 A7 콘솔에 기존 공개 결과를 다시 연결하는 경로를
추가했다. 32자리 공개 토큰 또는 현재 사이트의 `/r/<token>` URL을 입력하면 `result_get`으로
공개 snapshot을 다시 읽고, 현재 선택한 공론화·회차·주제 스코프와 정확히 일치하는 경우에만
이행조치 입력 화면을 연다. 외부 origin, URL credential, query, fragment, 잘못된 토큰과 다른
스코프의 결과는 fail-closed한다.

향후 `result_implementation_upsert` 계약은 브라우저에 내부 result UUID를 새로 노출하지 않도록
`p_result_token`을 사용한다. 공개 read에는 내부 UUID가 없으므로 기존 결과를 연결한 화면에서는
공개 해제 동작을 제공하지 않는다. RPC migration·DB/Auth/GRANT·실데이터는 변경하지 않았으며,
RPC가 없는 현재 운영 환경에서는 승인 필요 안내를 계속 표시한다.

검증 결과:

- 토큰·URL·스코프 결속 및 RPC adapter 집중 테스트: 4개 파일, 23건 통과
- 저장소 전체 Vitest: 105개 파일, 1,779건 전부 통과
- Astro strict check: 464개 파일, 오류·경고 0건, 기존 hint 57건
- `git diff --check`: 통과

## 9/3 후속 — Phase C 다국어 공통 셸과 검색 접근성

6개 공개 locale의 사이트명, 건너뛰기 링크, 탐색·검색·메뉴·테마 레이블, 검색 도움말,
푸터 고지·라이선스·연락처 문구를 `src/lib/site-locales.ts`의 typed registry에 모았다.
기존에는 일본어·중국어·스페인어·아랍어 경로의 푸터가 한국어로 되돌아갔지만, 이제 현재
locale의 공통 셸 문구를 유지한다. Arabic 데스크톱 하위 메뉴도 RTL 시작점에 맞춰 열린다.

공통 헤더가 검색 버튼을 표시하면서 검색 모달을 포함하지 않았던 deprecated `Base.astro`에도
`SearchModal`과 현지어 건너뛰기 링크를 연결했다. 모바일 메뉴에는 현지어 검색 동작을 추가했고,
테마 버튼의 `any` 캐스트는 dataset 기반 초기화 표식으로 교체했다.

이 단계는 공통 셸의 구조 번역과 동작을 보강한 것이다. 의제·본문·탐색 데이터는 구조 locale에서
계속 영어 또는 한국어 fallback임을 명시하며, Pagefind 결과 UI의 완전한 현지화와 원어민 검수는
Phase C 잔여 작업이다. production DB/Auth/GRANT와 실데이터는 변경하지 않았다.

검증 결과:

- locale·헤더 source contract 집중 테스트: 2개 파일, 8건 통과
- 저장소 전체 Vitest: 105개 파일, 1,782건 전부 통과
- Windows automation 전체: 32개 파일, 535건 전부 통과
- Astro strict check: 464개 파일, 오류·경고 0건, 기존 hint 57건
- 정적 production build: 9,493개 페이지 생성
- 로컬 실제 브라우저: Arabic 홈과 의제 목록의 `lang=ar`, `dir=rtl`, 현지어 사이트명·건너뛰기
  링크·푸터 고지, 데스크톱/모바일 검색 모달, 뷰포트 바깥 가로 넘침 없음, 콘솔 오류 0건

## 9/3 후속 — 기존 공개 결과 브라우저 회귀 게이트

정적 source contract에만 의존하지 않도록 기존 production fixture 브라우저 감사에 A7 기존 결과
재연결 흐름을 편입했다. 실제 Chromium에서 같은 버튼을 두 번 실행해도 공개 `result_get`은 한 번만
호출되며, 진행 중 입력 잠금, 선택 주제와 같은 스코프의 snapshot 결속, 발행 카드와 기관 이행조치
패널 표시를 확인한다. 공개 read가 내부 result UUID를 제공하지 않는 경우 공개 해제 버튼이 숨겨지고,
이 검증 과정에서 `result_implementation_upsert` 호출은 0건이어야 한다.

로컬 정적 빌드 fixture 검증 결과:

- 정적 production build: 9,493개 페이지 생성
- 브라우저 전체 운영 상호작용 보고서: `status:pass`, document HTTP 200
- 기존 결과 read 1건, 중복 read 차단, 스코프 결속·이행조치 패널 표시 확인
- 이행조치 mutation 0건, browser page error 0건, fixture failure 0건
- 보고서 schema version 13으로 상승해 CI가 새 필드를 필수 증거로 추적

전체 Windows automation 회귀에서는 줄바꿈에 따라 SQL source contract와 전사 fixture hash가
달라지고, 여러 Git/CLI subprocess를 실행하는 3개 검사가 공통 5초 제한을 넘는 기존 문제도
확인했다. SQL·fixture 검사는 CRLF를 LF로 정규화한 논리 source를 비교하고, A4 승인 번들은 모든
UTF-8 source의 줄바꿈만 canonical LF로 변환한 뒤 hash·byte count를 계산하도록 보강했다. UTF-8이
아닌 파일은 거부하고 그 밖의 content 변경은 계속 다른 hash가 된다. subprocess 검사는 기능 제한이
아니라 Windows 실행시간을 반영해 해당 3건에만 30초 제한을 부여했다. 갱신된 A4 번들은 여전히
`productionApplyApproved:false`, `databaseMutationExecuted:false`다.

- Windows automation 전체: 32개 파일, 535건 전부 통과
- 루트 Vitest 전체: 105개 파일, 1,779건 전부 통과
- Astro strict check: 464개 파일, 오류·경고 0건, 기존 hint 57건

## 9/3 후속 — Phase C 구조 locale 탐색 연속성

공통 셸이 현지어여도 헤더의 실제 탐색 항목과 `SiteSidebar`가 한국어·영어 이분법을 유지해
Arabic 의제 상세에서 사이드바 링크가 `/ko/`로 되돌아가던 공백을 닫았다. 6개 locale을 인식하는
typed navigation label helper를 추가하고, 상단 의제·현장 운영·운영 하위 메뉴·사이드바 제목과
의제 그룹명을 일본어·중국어·스페인어·아랍어로 제공한다. 의제 제목은 원문 번역·검수 전까지
영어 fallback을 유지하므로 구조 번역을 본문 번역 완료로 오인시키지 않는다.

production DB/Auth/GRANT와 실데이터는 변경하지 않았다.

검증 결과:

- locale·탐색 집중 테스트: 3개 파일, 11건 통과
- 저장소 전체 Vitest: 105개 파일, 1,784건 전부 통과
- Windows automation 전체: 32개 파일, 535건 전부 통과
- Astro strict check: 464개 파일, 오류·경고 0건, 기존 hint 57건
- 정적 production build: 9,493개 페이지 생성
- 로컬 실제 브라우저: Arabic 상단 메뉴·하위 메뉴·사이드바 제목·4개 그룹명이 현지어로 표시되고
  의제 내부 링크는 `/ar/`를 유지함. 데스크톱·모바일 RTL 가로 넘침 및 콘솔 오류 0건

## 9/3 후속 — Phase C 구조 locale 콘텐츠 배지

의제 카드의 분류·진행 상태, 내부 해설 초안, 영문 제공 여부와 신뢰도·번역 검수 배지가
한국어/영어 이분법에 묶여 있던 공백을 닫았다. 6개 공개 locale의 문구와 접근성 레이블을
`src/lib/site-locales.ts`의 typed registry에서 함께 관리하고, 홈의 분류 범례도 같은 문구를
사용한다. 일본어·중국어·스페인어·아랍어 문구는 구조 번역 초안이며 원어민 검수 완료로
간주하지 않는다.

구조 locale 홈 카드가 화면에 표시하는 한국어 원문 제목에 영문 번역의 trust status를 붙이던
의미 오류도 수정했다. 영문 경로만 영문 번역 상태를 사용하고, 나머지 구조 locale 카드는 현재
표시 중인 한국어 원문의 native 상태를 사용한다. production DB/Auth/GRANT와 실데이터는 변경하지
않았다.

검증 결과:

- locale 콘텐츠 UI 집중 테스트: 1개 파일, 5건 통과
- 저장소 전체 Vitest: 105개 파일, 1,785건 전부 통과
- Windows automation 전체: 32개 파일, 535건 전부 통과
- Astro strict check: 464개 파일, 오류·경고 0건, 기존 hint 57건
- 정적 production build: 9,493개 페이지 생성
- 로컬 실제 브라우저: Arabic 홈·의제 목록에서 현지어 분류 범례, 상태, 내부 초안, EN 제공 여부,
  4단계 신뢰 배지와 접근성 레이블을 확인했고 `lang=ar`, `dir=rtl`, 가로 넘침 없음 확인
- Arabic 검색 모달의 제목·닫기·도움말은 현지어로 확인. 로컬 Node 24에서는 저장소 설정상
  Pagefind integration을 생략하므로 결과 입력 UI는 main 배포 후 별도로 확인한다.

## 9/3 후속 — Pagefind 운영 로더 복구

위 배지 변경을 main에 배포한 뒤 운영 검색 모달을 다시 열어, `/pagefind/pagefind-ui.js`가 HTTP
200으로 존재하는데도 검색 입력 대신 인덱스 불가 안내가 표시되는 결함을 발견했다. 배포 번들은
ES module named export가 아니라 classic IIFE로 실행되어 `window.PagefindUI`를 등록하지만 기존
로더가 dynamic import의 named export를 요구해 항상 실패한 것이 원인이었다.

검색을 처음 열 때 classic script element로 번들을 한 번만 로드하고 전역 constructor를 확인한
후 UI를 생성하도록 바꿨다. Pagefind 기본 stylesheet도 연결했으며 로드 실패는 콘솔에 원인을
남기고 현지어 fallback을 표시한다. DB/Auth/GRANT와 실데이터는 변경하지 않았다.

검증 결과:

- Pagefind 로더 source contract: 1개 파일, 6건 통과
- 저장소 전체 Vitest: 105개 파일, 1,786건 전부 통과
- Windows automation 전체: 32개 파일, 535건 전부 통과
- Astro strict check: 464개 파일, 오류·경고 0건, 기존 hint 57건
- 정적 production build: 9,493개 페이지 생성
- 운영 사전 진단: 양쪽 도메인의 Pagefind JS/CSS HTTP 200, JS가 `window.PagefindUI`를 등록하는
  IIFE임을 직접 확인
- main 병합 `7ef0182e01256469e210611382af0492e30ab070` 후 양쪽 도메인 manifest 일치,
  감사·Cloudflare Pages·Workers 성공 확인
- 양쪽 운영 도메인의 Arabic 검색에서 입력 UI와 `climate` 결과·추가 로드 문구가 표시되고,
  인덱스 불가 fallback 미표시, `lang=ar`, `dir=rtl`, 가로 넘침 없음 확인

## 9/3 후속 — Phase C 리전별 데이터주권·locale 글꼴 계약

한국 공공 테넌트와 해외 테넌트를 서로 다른 데이터 평면에 고정하기 위한 fail-closed 계획
생성기를 추가했다. 리전은 application/API origin을 공유할 수 없고 DB·object storage·backup
국가가 일치해야 하며, 교차 리전 복제·backup과 브라우저 IP·언어 기반 추정 라우팅을 거부한다.
한국 계약 주체는 국내 CSAP 적격 트랙, 그 밖의 계약 주체는 별도 해외 트랙에만 배정할 수 있다.

기관·계약 승인 profile과 생성 계획은 저장소 밖에만 둘 수 있고 기존 출력을 덮어쓰지 않는다.
계획은 참여자 신원·숙의 원문·음성·전사·감사로그를 중앙 라우터에 저장하지 않으며 실제 DB,
DNS, 인프라를 변경하지 않는다. template은 미결정 인프라·책임자·검토를 blocker로 유지하므로
별도 리전이 실제 provision되고 격리 E2E를 통과하기 전에는 Phase C 완료가 아니다.

일본어·중국어·아랍어 공개 셸에는 각 문자권의 로컬 시스템 글꼴 stack을 추가했다. 새 외부 font
요청은 만들지 않으며 Arabic은 한국어 본문 자간과 Latin용 음수 제목 자간을 적용하지 않는다.

검증 결과:

- 데이터주권 계획기 집중 테스트: 1개 파일, 6건 통과
- locale 글꼴 집중 테스트: 1개 파일, 2건 통과
- 기본 profile 실행: 리전 2개, 미결정 blocker 15개,
  `readyForIsolatedDeployment:false`, DB·인프라·DNS 변경 0건, checksum 검증 통과
- 저장소 전체 Vitest: 106개 파일, 1,788건 전부 통과
- Windows automation 전체: 33개 파일, 541건 중 540건 통과. 기존 Git fixture 1건은 공통
  5초 제한을 넘겼고 해당 파일을 30초 제한으로 단독 재실행해 8건 전부 통과
- Astro strict check: 467개 파일, 오류·경고 0건, 기존 hint 57건
- 정적 production build: 9,493개 페이지 생성
- 로컬 실제 브라우저: Japanese·Chinese·Arabic의 body·대표 제목에 문자권별 font stack 적용,
  body·제목 자간 `normal`, Arabic `dir=rtl`, 세 locale 모두 가로 넘침 없음

## 9/3 후속 — Phase C 코드·콘텐츠 라이선스 경계 결정 준비

루트 CC BY-SA 4.0 선언이 코드와 콘텐츠를 함께 덮는 현재 상태, 루트 package license 공란,
콘텐츠 schema의 CC BY-SA, En-ROADS의 CC BY, vendored 패키지의 MIT·NOTICE·THIRD_PARTY를
각각 분리해 기록하는 fail-closed 계획 생성기를 추가했다. 직접 runtime·development 의존성은
lockfile과 linked vendor package metadata에서 실제 버전·license를 읽고, license metadata가
하나라도 없으면 변경 검토 준비 상태가 되지 않는다.

템플릿은 AGPL only/or-later 및 오픈소스/dual 전략을 미결정으로 유지한다. 저작권 소유,
기여자 재라이선스 권한, 제3자 고지, 최종 결정 검토가 모두 승인되고 dual 전략의 상용 제공
역할까지 확정돼야 `readyForLicenseChangeReview:true`가 된다. 이 값은 실제 재라이선스나 권리
부여가 아니라 별도 변경 PR을 검토할 준비만 뜻한다. 생성기는 법률 자문을 제공하지 않고
`LICENSE`, package metadata, DB를 변경하지 않으며, profile과 불변 출력은 저장소 밖에만 둔다.

기본 미결정 profile을 현재 저장소에 실행한 결과는 다음과 같다.

- 계획 생성기 집중 테스트: 1개 파일, 7건 통과
- 직접 의존성 26개, license metadata 누락 0개
- repository evidence 13개, 권리자 결정 blocker 6개
- `needs_rights_holder_decisions`, `readyForLicenseChangeReview:false`
- 권리 부여·license 파일·package metadata·DB 변경 0건
- 저장소 전체 Vitest: 106개 파일, 1,788건 전부 통과
- Windows automation 전체: 34개 파일, 548건 중 547건 통과. 기존 Git fixture 1건은 공통
  5초 제한을 넘겼고 해당 파일을 30초 제한으로 단독 재실행해 8건 전부 통과
- Astro strict check: 469개 파일, 오류·경고 0건, 기존 hint 57건
- 정적 production build: 9,493개 페이지 생성
- 검증 출력: `C:\Users\iceam\AppData\Local\Temp\platform-license-boundary-20260903-0614\plan.json`
