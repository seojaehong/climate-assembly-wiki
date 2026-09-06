# 9월 12–13일 현장 운영 런북

이 문서는 `/mod` 조 진행 화면과 `/hq` 본부 화면의 개통·운영·중단·복구 기준이다. 자동 리허설은 합성 fixture만 사용하며 **합성 리허설의 운영 DB 변경 0건**을 JSON으로 증명한다. 실제 백업 snapshot과 토큰 폐기는 별도 승인을 받은 운영 DB 변경이며, 승인되지 않은 운영 변경과 합성 리허설의 운영 변경은 모두 0건이어야 한다. 브라우저 fixture는 화면의 요청·응답·복구 흐름만 검증하며 권한, 토큰 수명, 동시성, DB 제약의 보안 증거가 아니다. 해당 계약의 정본은 격리 PostgreSQL에서 실행하는 `scripts/verify-0912-postgres.sh` 결과다. 실제 행사 데이터 변경은 본부 화면 또는 감사 기록이 남는 승인된 RPC만 사용한다.

## 0. Ready 판정과 증거 신뢰선

> **현재 기본 상태:** `docs/operations/0912-evidence-trust-policy.json`이 `status: "unconfigured"`이면 구조적으로 `ready`가 될 수 없다. 운영 환경 식별값과 세 공개키 지문을 승인 commit에 고정하기 전까지는 결과를 `not_ready`로 유지한다.

### 한눈에 보는 개통 조건

| 확인 축 | `ready`에 필요한 상태 | 없거나 맞지 않을 때 |
|---|---|---|
| 승인 소스와 배포 | 승인한 40자리 source commit, clean tree, 배포 endpoint에서 직접 읽은 동일 target revision | `not_ready` |
| 운영 환경 | web origin, Supabase project ref, DB TLS SPKI SHA-256, 조직·공론화·세션 UUID, `0912-deliberation`이 trust policy와 operator log에서 일치 | `not_ready` |
| 서명 신뢰 | operator·backup·restore용으로 서로 다른 Ed25519 공개키 3개가 승인 commit의 trust policy와 일치 | `not_ready` |
| 실행 묶음 | 한 실행에서 만든 UUID `releaseRunId`가 readiness·backup·restore·operator 증거에 모두 일치 | `not_ready` |
| 증거 시각 | UTC millisecond 형식, 검증 시각 기준 24시간 이내, 미래 허용 오차 5분 이내, 승인·실행·백업·복원·operator·보고 순서가 일치 | `not_ready` |
| 현장·수동 gate | production 직접 확인, 수동 보조기술 평가, 현장 기기·네트워크 리허설, 실제 백업, 격리 복원, 서명 operator log가 모두 완료 | `not_ready` |

로컬 테스트와 합성 브라우저 리허설이 모두 통과해도 production 직접 확인, 수동 평가, 현장 리허설, 실제 백업·복원, operator 증거 중 하나라도 없으면 `ready`로 올리지 않는다. 이때 종료코드 `1`과 `releaseDecision: "not_ready"`는 검증 실패를 숨긴 것이 아니라 현재 상태를 정직하게 표현한 정상 결과다.

### 정본 계획과 디지털 기록 경계

- 운영 내용의 정본은 `0. 기후시민회의 제6-7차 회의 추진계획안-ADR수정.hwpx`이며 SHA-256은 `00952e23145bb41953abd2da6414656ed502204b4a9758f1e8e6de3ae6099c67`이다.
- 기계 판독 계약은 `docs/operations/0912-13-plan-contract.json`의 `0912-13-adr-final-v1`이다. 참가자 수는 162명이고 행사 산출물은 확정 의결안이 아닌 `조별 권고안 초안`이다.
- PM 확인 전 작업 기준은 `현장 카드 정본·디지털 미러`다. 둘이 다르면 현장 카드를 보존하고 디지털 값을 자동 덮어쓰지 않으며, 기록 담당이 차이를 인계한다.
- 기존 `supabase/migrations/20260902_s20_open_0912_topics.sql`과 대응 verifier는 과거 6개 주제를 담고 있으므로 **적용 금지·동결** 상태다. PM 결정 8건과 승인된 교정 SQL이 준비되고 사용자가 DB 변경을 별도 승인하기 전에는 실행하지 않는다.

| 순서 | 공식 시각 | 디지털 미러 체크포인트 |
|---:|---|---|
| 1 | 9/12 13:45 | 숙의 주제·범주 확인 및 보완안 |
| 2 | 9/12 14:45 | 권고별 배경·문제점 |
| 3 | 9/12 16:15 | 권고별 기대효과 |
| 4 | 9/12 17:00 | 권고문 한 문장 |
| 5 | 9/13 09:10 | 세부 정책제안 |
| 6 | 9/13 13:00 | 정책제안 정리·일정·대표 제목·기타 의견 |
| 7 | 9/13 14:30 | 5개 원칙 확인·기타 의견·반대 의견 |
| 8 | 9/13 15:45 | 중복 유형·대표 제목·제8차 이관 메모 |

### 3개 분리 Ed25519 키와 trust policy

1. `operator`, `backup`, `restore`마다 별도 Ed25519 키쌍을 만든다. 같은 키를 다른 역할에 재사용하지 않는다.
2. 공개키의 SPKI SHA-256 지문만 `ed25519-sha256:<64자리 소문자 hex>` 형식으로 `docs/operations/0912-evidence-trust-policy.json`의 각 `keyIds`에 기록한다.
3. 같은 policy에 실제 운영 DB TLS SPKI SHA-256과 조직·공론화·세션 UUID를 기록하고 `status`를 `configured`로 바꾼 뒤 검토·승인·commit한다. verifier는 작업 트리 값이 아니라 `--expected-commit`의 Git 객체를 정본으로 읽는다.
4. 세 지문이 같거나 누락됐거나, policy가 `unconfigured`이거나, 전달한 공개키가 policy 지문과 다르면 `ready`를 거부한다.
5. 검증 CLI에는 **공개키 PEM만** 전달한다. private PEM이나 private `KeyObject`는 검증기가 거부한다.

개인키 원문은 저장소, `evaluation/`, 환경변수, 명령행, CI log, 운영일지에 넣지 않는다. 승인된 외부 비밀 저장소의 symlink가 아닌 접근 제한 일반 파일로 보관하고 서명 CLI에는 원문이 아닌 파일 경로만 `--private-key`로 전달한다. 파일 경로 자체도 사용자명 등 민감한 정보를 포함하지 않게 한다. 아래 `C:\secure\0912`는 예시이므로 실제 승인된 보관 위치로 바꾼다.

```powershell
$releaseRunId = [guid]::NewGuid().ToString('D').ToLowerInvariant()
$evidenceDir = Join-Path $env:TEMP ("0912-evidence-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidenceDir | Out-Null
$unsignedBackup = Join-Path $evidenceDir '0912-13-backup-manifest.unsigned.json'
$signedBackup = Join-Path $evidenceDir '0912-13-backup-manifest.json'
$unsignedRestore = Join-Path $evidenceDir '0912-13-restore-report.unsigned.json'
$signedRestore = Join-Path $evidenceDir '0912-13-restore-report.json'
$operatorDraft = ".tmp-verify/0912-operator/$releaseRunId/operator-draft.json"
$unsignedOperator = ".tmp-verify/0912-operator/$releaseRunId/operator-final.unsigned.json"
$signedOperator = 'evaluation/0912-13-operator-log.json'
$operatorPrivateKey = 'C:\secure\0912\operator-ed25519-private.pem'
$backupPrivateKey = 'C:\secure\0912\backup-ed25519-private.pem'
$restorePrivateKey = 'C:\secure\0912\restore-ed25519-private.pem'

Copy-Item 'evaluation/0912-13-backup-manifest.template.json' $unsignedBackup
Copy-Item 'evaluation/0912-13-restore-report.template.json' $unsignedRestore
npm.cmd run prepare:0912:operator -- --template-output $operatorDraft
```

먼저 backup·restore unsigned 사본의 `null` 값을 실제 증거로 채우고 두 사람이 비밀 누출·source commit·`releaseRunId`·archive 동일성·시각 순서를 검토한다. 같은 PowerShell 세션에서 각각 서명한다.

```powershell
node scripts/0912-sign-evidence.mjs --type backup --input $unsignedBackup --output $signedBackup --private-key $backupPrivateKey
node scripts/0912-sign-evidence.mjs --type restore --input $unsignedRestore --output $signedRestore --private-key $restorePrivateKey
$canonicalBackup = 'evaluation/0912-13-backup-manifest.json'
$canonicalRestore = 'evaluation/0912-13-restore-report.json'
if ((Test-Path -LiteralPath $canonicalBackup) -or (Test-Path -LiteralPath $canonicalRestore)) {
  throw 'canonical evidence already exists; archive it under the approved retention procedure before a new releaseRunId'
}
Copy-Item -LiteralPath $signedBackup -Destination $canonicalBackup
Copy-Item -LiteralPath $signedRestore -Destination $canonicalRestore
```

두 서명본을 canonical 경로에 확정하고 자동·수동 보고서, P3·P4 운영 결과, 구현·보안 검토 파일까지 12개 정본 파일을 모두 준비한 다음에만 operator draft를 채운다. draft에는 운영 환경의 `id`, HTTPS origin, 20자리 Supabase project ref, DB TLS SPKI SHA-256, 서로 다른 조직·공론화·세션 UUID, `0912-deliberation`을 기록한다. 승인·gate·rollout·control 결과를 draft 한 곳에만 입력한 뒤 finalizer가 receipt 56개를 만들고 68개 파일의 실제 SHA-256을 결속한다. finalizer 입력·출력은 소스 덮어쓰기를 막기 위해 `.tmp-verify/0912-operator/` 아래 상대 JSON 경로만 허용한다.

```powershell
npm.cmd run prepare:0912:operator -- --input $operatorDraft --output $unsignedOperator
node scripts/0912-sign-evidence.mjs --type operator --input $unsignedOperator --output $signedOperator --private-key $operatorPrivateKey
```

서명 입력의 `attestation`은 `null`이어야 하고 입력과 출력은 다른 정규 파일이어야 한다. 출력 경로가 이미 있으면 덮어쓰지 않고 실패하므로 실행별 빈 staging 폴더를 사용한다. `--signed-at`을 생략하면 현재 시각이 기록되며, 과거 증거를 새 실행에 재사용하거나 시각을 임의로 당기지 않는다.

### `releaseRunId`, 결속 파일과 receipt

실행을 시작할 때 아래처럼 새 UUID를 한 번 만들고 실행별 서명 증거(backup·restore·operator·receipt)에 그대로 쓴다. 실패한 실행의 UUID를 다음 실행에 재사용하지 않는다. traceability·PostgreSQL·field·HQ·자동·수동 접근성 보고서는 source commit과 실제 파일 SHA-256으로 operator 서명에 결속되는 commit-scoped 증거이며, 생성 시각이 대응 gate보다 앞선 경우에만 사용할 수 있다.

```powershell
$releaseRunId = [guid]::NewGuid().ToString('D').ToLowerInvariant()
```

최종 검증자는 보고서에서 읽은 값을 신뢰하지 않고, 이 단계에서 외부 운영일지와 대조한 `$releaseRunId`를 `--expected-release-run-id`로 다시 받는다. 검증기는 report·operator·backup·restore의 실행 ID가 이 값과 모두 같을 때만 `ready`를 허용한다. 실행 ID 재사용을 막는 외부 불변 대장은 본 저장소 범위가 아니므로, 운영일지에서 각 ID를 1회성으로 관리하고 같은 ID의 패킷을 다시 개통 근거로 사용하지 않는다.

operator log의 `artifactBindings`는 정본 JSON 10개, 구현·보안 검토 Markdown 2개와 결정적 receipt 56개의 **실제 파일 바이트 SHA-256**을 경로순으로 모두 결속한다. 전체 결속 파일은 68개다. 임의 경로 추가, 하나라도 누락, 순서 변경, 서명 뒤 파일 변경은 실패다.

- 정본 파일: `0912-13-backup-manifest.json`, `0912-13-field-rehearsal.json`, `0912-13-hq-rehearsal.json`, `0912-13-restore-report.json`, `0912-13-traceability-report.json`, `0912-hq-dashboard-accessibility.json`, `0912-p1a-postgres-report.json`, `platform-accessibility-manual-evaluation.json` (`evaluation/` 아래)
- gate receipt: `evaluation/0912-operator/gates/<0부터 시작하는 순번>-<gate-id>.json`
- rollout receipt: `evaluation/0912-operator/rollout/<0부터 시작하는 순번>-<rollout-id>.json`
- control receipt: `evaluation/0912-operator/controls/<0부터 시작하는 순번>-<control-id>.json`

각 receipt는 operator log의 대응 항목과 `releaseRunId`, source commit, target revision, 운영 환경 ID, 상태·실측값·운영 접근 방식이 일치해야 하고 비밀·토큰·접속코드·비밀번호를 포함하지 않아야 한다. operator log는 모든 정본 파일과 receipt가 확정된 뒤 마지막으로 만들고 서명한다.

operator 서명은 운영자가 이 승인 기록을 확인하고 패킷에 결속했다는 증거이지, 상황 책임자의 승인을 독립 키로 직접 서명한 증거는 아니다. 따라서 승인자와 조작자는 같은 사람이 될 수 없고, 두 사람이 원 승인 채널의 시각·승인자·범위와 operator log를 수동 대조해야 한다. 승인 기록이 없거나 독립 확인자를 확보하지 못한 상태를 사용자 승인으로 추정하지 않으며 `not_ready`를 유지한다.

## 1. 역할과 승인선

| 역할 | 담당 | 할 수 있는 일 | 단독으로 하면 안 되는 일 |
|---|---|---|---|
| 상황 책임자 | 당일 지정 1인 | 개통, 일시 중단, 재개, 종료 결정 | 근거 없이 충돌 강제 덮어쓰기 |
| HQ 조작자 | 교대 2인 | 꼭지 개방·마감, 기기 조회·토큰 폐기 | 접속코드·토큰을 채팅이나 보고서에 기록 |
| 기록 담당 | 당일 지정 1인 | 시각·조작자·RPC 결과·증거 경로 기록 | 비밀번호·원문 개인정보 기록 |
| 복구 담당 | 당일 지정 1인 | 백업 확인, 격리 복원, 복구 결과 대조 | 운영 DB에 복원 리허설 실행 |
| 증거·키 보관 담당 | operator·backup·restore 역할별 분리 지정 | unsigned 증거 확인, 역할별 서명, 공개키 전달 | 개인키 공유·교차 역할 재사용·개인키 원문 기록 |

HQ 변경은 `요청자 → 조작자 → 확인자` 순서로 읽어 확인한다. 동일 인물이 조작과 확인을 겸하지 않는다. 비상 RPC도 같은 승인선을 따른다.

## 2. 개통 전 체크리스트

### 전날

- [ ] `docs/operations/0912-evidence-trust-policy.json`이 승인 commit에서 `configured`이고, 운영 환경 식별값과 서로 다른 operator·backup·restore 공개키 지문 3개가 확정됐다. `unconfigured` 상태에서 readiness 필드만 고치지 않는다.
- [ ] 이번 실행 전용 `releaseRunId` UUID, backup·restore용 저장소 밖 빈 staging 폴더, operator용 `.tmp-verify/0912-operator/<releaseRunId>/` 빈 staging 폴더를 만들고 모든 JSON 시각을 UTC millisecond 형식으로 기록할 담당자를 정한다.
- [ ] 배포 revision이 승인 commit과 일치한다.
- [ ] 저장소가 요구하는 Node 20에서 `npm.cmd exec --yes --package=node@20.20.1 -- node node_modules/vitest/vitest.mjs run`과, `automation` 폴더의 `npm.cmd exec --yes --package=node@20.20.1 -- node node_modules/vitest/vitest.mjs run`이 통과한다. 시스템 기본 Node 버전으로 대신 실행하지 않는다.
- [ ] 같은 Node 20에서 `node_modules/astro/astro.js check`, `node_modules/astro/astro.js build`, `scripts/write-deployment-revision.mjs`를 순서대로 실행해 프로덕션 산출물과 revision 표식을 만든다. 추적 파일을 다시 만드는 `prebuild`는 검증 중 실행하지 않는다.
- [ ] 저장소 밖 임시 증거 폴더를 만들고 Node 20으로 `scripts/verify-0912-readiness.mjs --output <임시폴더>\0912-13-traceability-report.json`을 실행한다.
- [ ] 프로덕션 build/preview에서 Node 20으로 `scripts/verify-field-rehearsal.mjs --base http://127.0.0.1:4331 --report <임시폴더>\0912-13-field-rehearsal.json`을 실행한다.
- [ ] 같은 preview에서 `scripts/verify-0912-hq-rehearsal.mjs --base http://127.0.0.1:4331 --report <임시폴더>\0912-13-hq-rehearsal.json`을 실행해 HQ v3 충돌·전체 비우기·로그아웃 실패 복구 흐름을 확인한다.
- [ ] 승인 기준 branch와 작업 branch의 보안 diff를 검토하고 `evaluation/0912-13-security-diff-review.md`에 위험 경계·검증 결과·미실행 외부 게이트를 기록한다.
- [ ] 필드 리허설 JSON의 `safety.liveNetworkRequestCount`와 `safety.liveDatabaseMutationCount`가 모두 `0`이고 `networkContract.escapedExternalRequestCount`가 `0`, `capabilityValuesLeakedToDraftQueueOrEvidence`가 실제 scan 결과 `false`다. workshop access token의 session 저장은 `networkContract.workshopSessionPersisted: true`로 따로 확인한다. `/mod`·`/hq`는 외부 CDN 글꼴 없이 시스템 한글 글꼴로 정상 표시돼야 한다.
- [ ] `/mod`, `/hq` 자동 접근성 감사 결과와 수동 보조기술 평가의 미실행·실패 항목을 상황 책임자가 확인한다.
- [ ] 162명의 확정 분과·조 명단과 테이블 번호를 별도 정본과 맞춘다. 현재 코드의 15개 조 구조와 임시 8월 roster 복사본은 PM 승인 명단을 대신하거나 개통 근거로 사용하지 않는다.
- [ ] 합성 fixture에서 세 번째 기기 거부, 두 기기 동시 편집 충돌, 토큰 폐기 후 재사용 거부의 **화면 처리**를 재현한다. 같은 항목의 권한·수명·동시성·폐기 계약은 격리 PostgreSQL 검증에서도 각각 통과해야 하며 fixture 결과로 대체하지 않는다.
- [ ] `scripts/verify-0912-postgres.sh`가 CLI 생성 seed SQL의 정상 15개 조 생성과 partial tenancy 불일치의 fail-closed를 일회용 PostgreSQL 16에서 통과하고, `seedCliCapabilityValuesLogged`가 `0`인지 확인한다.
- [ ] 운영 DB에는 쓰지 않는 읽기 전용 `pg_proc`/ACL inventory를 뽑아 P2a verifier의 identity-argument allowlist와 대조한다. 승인 목록 밖의 `climate_vote` 실행 가능 routine이나 `public.cv_set_active(text)`가 하나라도 있으면 cutover를 중단한다. 과거 inventory는 참고일 뿐 당일 조회를 대신하지 않는다.
- [ ] 배포된 접속코드 교환 endpoint에서 외부 클라이언트가 `x-forwarded-for`·`x-real-ip` 값을 바꿔 보내도 서버의 throttle source가 바뀌지 않는지 직접 probe한다. 게이트웨이가 해당 헤더를 신뢰 가능한 값으로 덮어쓴다는 증거가 없으면 브라우저에서 RPC를 직접 열지 않고 신뢰 가능한 edge-only 교환 경로를 먼저 배포한다.

### 행사 시작 60분 전

- [ ] `/hq`에서 대상 세션 slug가 `0912-deliberation`인지 소리 내어 확인한다.
- [ ] `0912-13-plan-contract.json`의 8개 단계 ID·순서·문구·공식 시각과 승인된 교정 SQL을 대조한다. 다음 단계만 열 수 있는지 확인한다.
- [ ] 접속코드는 필요한 시점에만 1회 전달하고 화면 캡처·운영일지·메신저에 남기지 않는다.
- [ ] HQ 토큰은 개인 브라우저 세션에만 두며 공용 문서, 셸 기록, JSON 증거에 복사하지 않는다.
- [ ] 등록된 HQ 운영자 전원이 자기 이름과 개인 비밀번호로 로그인되는지 확인한다. 공유 비밀번호·임의 표시 이름 경로는 P2a cutover 뒤 사용할 수 없으며, 한 명이라도 개인 로그인이 준비되지 않았으면 개통하지 않는다.
- [ ] 새 비밀번호는 8자 이상이고 UTF-8 기준 72바이트 이하인지 화면의 byte 표시로 확인한다. 기존 `current credential`은 한글·이모지를 포함한 과거 값을 계속 확인할 수 있도록 72바이트 사전 제한을 적용하지 않는다.
- [ ] `approval-backup-snapshot`을 다른 rollout 승인과 분리해 기록한 뒤 새 백업을 만든다. snapshot 생성은 승인된 운영 DB 변경이며 실제 연결·변경 건수를 operator receipt에 기록한다.
- [ ] 백업의 immutable object ref, 실제 byte 크기, SHA-256, 생성 시각, 세션 slug, 조/제출 건수를 기록하고 backup 전용 키로 서명한다.
- [ ] 같은 archive를 **운영 DB가 아닌 격리 PostgreSQL**에 복원해 행 수와 checksum을 대조하고 restore 전용 키로 서명한다.

### 개통 직전

- [ ] 상태 레일에서 연결 상태·마지막 확인 시각·미저장·대기·충돌을 읽을 수 있다.
- [ ] 꼭지①에 합성 글을 입력한 채 꼭지②를 열어 입력·포커스·스크롤이 유지된다.
- [ ] `/hq`와 `/mod`를 데스크톱·모바일 폭에서 키보드만으로 열고 본문 바로가기가 작동한다.
- [ ] `evaluation/0912-13-readiness-report.template.json`을 실행 사본으로 복제하고 모든 critical gate에 실제 증거 경로를 붙인다.
- [ ] `.tmp-verify/0912-operator/<releaseRunId>/`의 operator draft 한 곳에 승인·실행 결과를 채우고 `prepare:0912:operator -- --input ... --output ...`을 실행해 receipt 56개와 binding 68개를 자동 생성한 뒤, operator log를 operator 전용 키로 서명한다.
- [ ] 아래처럼 실행 보고서를 검증한다. `$backupArchive`에는 manifest 파일이 아니라 서명된 `archiveObjectRef`와 같은 실제 archive를 내려받은 로컬 파일을 지정하며, 예시의 `C:\secure\0912` 경로는 실제 승인된 보관 위치로 바꾼다.

  ```powershell
  $approvedSourceCommit = Read-Host '승인한 40자리 source commit'
  $deployedTargetRevision = Read-Host '배포 endpoint에서 직접 확인한 40자리 revision'
  $expectedReleaseRunId = Read-Host '외부 운영일지에 기록한 releaseRunId'
  $operatorPublicKey = 'C:\secure\0912\operator-ed25519-public.pem'
  $backupPublicKey = 'C:\secure\0912\backup-ed25519-public.pem'
  $restorePublicKey = 'C:\secure\0912\restore-ed25519-public.pem'
  $backupArchive = 'C:\secure\0912\snapshots\0912-archive.json'
  $latestBackup = 'C:\secure\0912\snapshots\latest.json'

  node scripts/verify-0912-release-report.mjs `
    --report evaluation/0912-13-readiness-report.json `
    --expected-commit $approvedSourceCommit `
    --expected-target-revision $deployedTargetRevision `
    --expected-release-run-id $expectedReleaseRunId `
    --trusted-operator-public-key $operatorPublicKey `
    --trusted-backup-public-key $backupPublicKey `
    --trusted-restore-public-key $restorePublicKey `
    --backup-archive $backupArchive `
    --latest-backup $latestBackup
  ```

  검증기는 정본 template과 trust policy를 승인 commit의 Git 객체에서 읽고, 공개키 지문·운영 환경·`releaseRunId`·고정 증거 경로·receipt·파일 바이트·생성 시각 순서를 교차검증한다. `--backup-archive`의 실제 byte 크기와 SHA-256은 backup·restore 서명값 모두와 일치해야 하며, `--latest-backup`의 실제 파일 SHA-256은 backup manifest의 `latest.checksumSha256`과 일치해야 한다. 필수 gate, 운영 rollout, production 직접 확인, 수동·현장 검증 중 하나라도 미실행이면 `not_ready`와 종료코드 `1`이 정상이며 개통하지 않는다.

### 정본 운영 패킷과 적용 순서

아래 순서는 개통 정본이다. 운영 DB에 적용하는 각 변경 단계는 **사용자의 명시적 승인 뒤에만** 실행한다. 파일을 검토하거나 `--print-seed-sql`로 SQL을 출력하는 것은 적용 승인이 아니며, 자동 검증은 격리된 `verify` DB에서만 실행한다.

이미 적용된 migration은 재실행하지 않는다. 대신 운영 DB의 migration 이력과 승인된 정본 checksum을 읽기 전용으로 대조하고, 해당 rollout receipt의 `productionAccess.mode`를 `verified-already-applied`, `connectionCount`를 실제 양수, `mutationCount`를 `0`으로 기록한다. 이 mode는 P1·P1a·P2·P1b/P1c·P2a·P3·P4 migration에만 쓸 수 있다. P3·P4는 각각 `evaluation/0912-p3-production-result.template.json`, `evaluation/0912-p4-production-result.template.json`을 복사해 canonical 경로의 `.json`으로 채운다. 결과에는 같은 `releaseRunId`·commit·revision·환경·mode·승인 ID, 승인 뒤의 시작/종료 시각, migration 이력 1건과 정본 SHA-256, post-apply 스크립트 SHA-256·종료코드·실패 건수, 실제 연결·변경 건수를 기록한다. P4는 추가로 동일한 읽기 전용 `supabase/verify/platform_audit_history_snapshot.sql`을 적용 직전과 직후에 실행하고, 두 기존 감사 테이블의 행 수와 `sha256-canonical-jsonb-v1` digest가 각각 같은지 결과 파일의 `legacyHistory`에 기록한다. verifier는 이 두 파일의 실제 bytes를 operator 서명에 결속하고 정본 Git 객체의 SQL 해시, P4 snapshot SQL 해시, rollout receipt, 전후 행 수·digest 일치를 교차검증한다. 운영 DB 조회를 verifier가 자체 재실행하지는 않으므로 신뢰된 operator의 고의 위조는 여전히 서명자 신뢰 경계다. 독립 확인자가 원 migration 이력·정본 checksum·post-apply 원출력·P4 전후 snapshot 원출력과 결과 파일을 대조하지 못하면 `not_ready`로 둔다. 적용하지 않은 migration은 `approved-db-rollout`과 실제 양수의 연결·변경 건수를 기록한다.

| 순서 | 정본 파일·명령 | 기대 결과와 승인 gate |
|---|---|---|
| 1. 명단 확정 | `scripts/session-rosters.mjs` | `0912-deliberation`의 개인정보 없는 조 구조를 162명 PM 승인 명단의 이름·분과·ordinal과 대조한다. 현재 15개 조 구조는 잠정값이며 불일치하면 개통하지 않는다. |
| 2. P1 tenancy — 미적용 시 별도 운영 승인 | `supabase/migrations/platform_p1_tenancy.sql` | migration 이력과 정본 checksum을 확인한다. 이미 적용됐으면 건너뛰고, 미적용이면 사용자 승인 뒤 먼저 적용한다. seed와 s20은 `org_id`·`assembly_id`를 쓰므로 P1보다 앞서 실행하면 안 된다. |
| 3. 세션·조 비밀 SQL packet 생성·적용 | 새 세션: `node scripts/seed-0829-teams.mjs --print-seed-sql`<br>기존 세션: `node scripts/seed-0829-teams.mjs --print-sync-sql` | P1 확인 뒤 실행한다. 두 명령은 `crypto.randomInt` 기반의 서로 다른 6자리 코드 15개가 포함된 원자 트랜잭션을 stdout으로 만든다. 새 세션에만 seed, 이미 있는 세션·조에는 sync를 쓰며 stdout은 화면에 표시하지 말고 승인된 비밀 scratch 파일로 즉시 리디렉션한다. 별도 승인 후 **세션 1개·active 팀 15개**와 session의 `org_id`·`assembly_id`·`held_on`, 모든 team의 동일 `org_id`를 확인한다. sync가 기존 session 조직·assembly·행사일 또는 team 조직 불일치를 발견하면 fail-closed로 중단하고 SQL을 적용하지 않는다. 인자 없는 실행은 종료코드 `2`로 끝나며 direct live-write 경로는 완전히 비활성화되어 있다. |
| 4. 단계 생성 — **현재 차단** | `supabase/migrations/20260902_s20_open_0912_topics.sql` | 이 파일은 과거 6개 주제이므로 실행하지 않는다. PM 결정 8건을 반영한 교정 migration·verifier를 새로 승인하고 사용자가 DB 변경을 명시 승인한 뒤에만, 계획 계약의 8개 단계와 정확히 일치하는지 검증한다. |
| 5. P1a additive 적용 — **운영 승인 gate 1** | `supabase/migrations/platform_p1a_0912_event_access.sql` | P1→seed→s20 선행 상태와 checksum을 확인하고 사용자가 P1a를 명시적으로 승인한 뒤 적용한다. 새 token/exchange RPC를 만들되 아직 anon/auth에 실행 권한을 주지 않고, HQ rotate/status와 staff RPC만 먼저 노출한다. legacy 권한도 이 단계에서는 끊지 않는다. HQ/team bootstrap과 기존 token 사용은 조직·공론화·세션이 모두 `active`이고 세션의 비어 있지 않은 hard expiry가 미래일 때만 허용된다. 대상은 정확한 `0912-deliberation`이며 임의 최신 세션이나 36시간 기본값으로 대체하지 않는다. 토큰 만료가 **2026-09-13 22:00 KST**인지 확인한다. |
| 6. P1a 행동 검증 | `supabase/verify/platform_p1a_0912_event_access.sql` | 두 기기·OCC·proxy vote v3 멱등성·HQ CAS·닫힌 꼭지의 조 재오픈 거부·코드 회전·개별 로그아웃·비밀번호 변경 시 운영자 전 기기 토큰 폐기·감사 불변식과 P1a 공개 권한 경계를 확인한다. CI/로컬 리허설은 `scripts/verify-0912-postgres.sh`로 disposable PostgreSQL만 사용한다. |
| 7. 예측 코드 선교체 | `workshop_hq_rotate_join_codes(p_token, p_session_slug, p_confirmation, p_idempotency_key)` | P1a 검증 뒤 maintenance 진입을 확인하고 `ROTATE 0912-deliberation`과 새 UUID 멱등키로 1회 실행한다. 같은 조작의 재시도에만 같은 UUID를 쓴다. 새 6자리 코드는 봉인된 오프라인 전달표로 옮기되 P2a 검증 전에는 배포하지 않고, 평문을 로그·보고서에 남기지 않는다. |
| 8. 분석·조직 기반 적용 — **운영 승인 gate 2** | `platform_p2_analysis_review.sql` → `platform_p1b_backfill.sql` → `platform_p1c_org_selection.sql` → `platform_p1c_activation_preflight.sql` → `platform_p1c_org_selection_activation.sql` | 단순 파일명 정렬로 실행하지 않는다. P2 테이블을 먼저 만든 뒤 backfill·조직 선택 preflight·activation 순으로 적용하고, 각 preflight 결과가 승인본과 일치해야 한다. 이미 적용된 파일은 migration 이력과 정본 checksum을 대조하고 건너뛴다. |
| 9. maintenance token/staff client 배포 | `src/lib/workshop-access.ts`, `src/lib/deliberation.ts`, `src/lib/mod-console.ts`, `src/lib/platform.ts`, `src/lib/workshop-hq.ts`, `src/lib/attendance.ts` | 승인 revision을 배포하고 `/mod`가 코드 교환 뒤 토큰 RPC만 호출하도록 구성됐는지, 생성·proxy 요청이 UUID 멱등키가 있는 `mod_create_round_v3`·`mod_proxy_vote_v3`·`ballot_create_v3`인지, staff ballot이 `platform_ballot_list_v2`·`platform_ballot_results_v2`인지, `/hq` 로그아웃이 로컬 저장소를 지우기 전에 `workshop_hq_logout_v2`로 서버 토큰을 폐기하는지 정적·합성 리허설 증거로 대조한다. P2a 전에는 team token RPC positive 호출이 공개 권한상 거부되는 것이 정상이다. |
| 10. P2a 원자 cutover — **운영 승인 gate 3** | `supabase/migrations/platform_p2a_0912_token_only_activation.sql` | P2·P1b/P1c, 배포 revision, 당일 read-only routine inventory, 운영자별 개인 로그인 완료를 확인한 뒤, 앞선 gate와 별개의 사용자 명시 승인을 받아 적용한다. 한 트랜잭션에서 token RPC 실행 권한을 열고 legacy code 기반 실행 권한, 공유 HQ 비밀번호·임의 행위자 경로, 운영자 credential-state 표 조회, unscoped readiness·eligible-count·org lookup, PIN/by-code unlock, 비멱등 v2 create/proxy, owner-rights vote view와 `public.cv_set_active`를 폐기한다. `cv_snapshot_now`와 `cv_archive_round`는 브라우저 역할에서 회수하고 `service_role`에만 남긴다. |
| 11. activation positive·negative 검증 | `supabase/verify/platform_p2a_0912_token_only_activation.sql` | 새 token v2/v3와 staff 경로가 성공하고 legacy moderator, cross-session HQ deadline, 비멱등 v2 create/proxy negative 경로가 권한 오류로 거부되는지 확인한다. HQ 로그아웃 토큰의 재사용 거부와 비밀번호 변경 뒤 같은 운영자의 두 기기 토큰이 모두 거부되는지도 확인한다. `pg_proc`의 실제 identity argument 기준으로 PUBLIC 실행 0건, anon/auth 승인목록 밖 실행 0건인지 확인하고, workshop token으로 scoped attendance·eligible count가 정상인지도 확인한다. rollback 정본은 `supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql`, rollback 검증은 `supabase/verify/platform_p2a_0912_token_only_activation_rollback.sql`이다. 이 검증 통과 뒤에만 새 접속코드를 전달한다. |
| 12. P3 design provisioning — 별도 운영 승인 | `supabase/migrations/platform_p3_design_provisioning.sql` | 사용자 승인 뒤 적용하고 읽기 전용 `supabase/verify/design_provisioning_post_apply.sql`로 구조·매핑을 검증한다. 원출력과 이력 대조값을 `evaluation/0912-p3-production-result.json`에 기록한다. 코드 생성기는 차단된 예측 범위 `091201`~`091215`를 만들지 않아야 한다. |
| 13. P4 audit log — 별도 운영 승인 | `supabase/migrations/platform_p4_audit_log.sql` | P3 검증 뒤 별도 사용자 승인을 받아 적용한다. 운영에서는 DML fixture가 있는 `platform_audit_test.sql`을 실행하지 않는다. 적용 직전·직후에 `platform_audit_history_snapshot.sql`을 실행해 기존 attendance/workshop 감사 행 수와 SHA-256이 같은지 확인하고, 직후에는 repeatable-read·read-only인 `platform_audit_post_apply.sql`로 구조·권한·15개 trigger와 검증 중 이력 불변을 확인한다. 두 snapshot과 post-apply 원출력을 `evaluation/0912-p4-production-result.json`에 기록한다. |
| 14. P3/P4 이후 legacy 재개방 방지 | `supabase/verify/platform_p2a_0912_token_only_activation.sql` 재실행 | P3·P4 뒤에도 legacy와 cross-session HQ deadline 권한이 다시 열리지 않았고 token/staff positive 경로가 유지되는지 재검증한다. |
| 15. 최종 상태 확인 | HQ의 `workshop_hq_status`·`workshop_hq_devices` | session slug, PM 승인 조 수, 승인된 **8개 계획 단계**, 열린 단계, 활성 기기 수, 코드 전달 완료, 운영 로그 위치를 두 사람이 확인한 뒤에만 개통한다. 기존 s20 파일로는 이 조건을 충족할 수 없다. |

P4 전후 snapshot은 서로 다른 쿼리를 쓰지 않는다. 승인된 운영 연결에서 같은 commit의 `platform_audit_history_snapshot.sql`을 적용 직전에 한 번 실행해 원출력과 UTC 시각을 보관하고, 승인된 P4 적용과 `platform_audit_post_apply.sql` 성공 직후 같은 파일을 다시 실행한다. `attendance.rowCount`·`attendance.sha256`·`workshop.rowCount`·`workshop.sha256` 네 값이 모두 같아야 `p4-legacy-history-preserved`를 `pass`로 기록한다. post-apply 출력의 `historyStableDuringVerification`은 읽기 전용 검증 자체가 이력을 바꾸지 않았다는 뜻일 뿐, 적용 전후 보존 증거를 대신하지 않는다. snapshot 원출력에는 행 본문 대신 건수와 digest만 남지만, 승인 ID·환경 ID·두 실행 시각과 함께 접근 통제된 운영 증거 위치에 보관한다.

순서가 어긋났거나 기대 건수가 다르면 즉시 중단한다. 검증된 핵심 migration 순서는 `P1 → seed/s20 → P1a → P2 → P1b/P1c → P2a → P3 → P4`다. 여기서 `s20`은 기존 파일이 아니라 향후 승인될 교정 migration을 뜻한다. 현장 절차는 `session-rosters 정본 확인(읽기) → P1 적용 이력·checksum 확인 및 미적용 시 승인·적용 → atomic seed/sync SQL 별도 승인·적용 → s20 별도 승인·적용 → P1a 승인·검증 → 4인자 HQ rotate 선교체 → P2 및 P1b/P1c 승인·검증 → maintenance token/staff client 배포 → P2a 별도 승인·원자 cutover → positive/legacy negative 검증 → P3 별도 승인·검증 → P4 별도 승인·검증 → post-P4 legacy negative 재검증 → 최종 상태` 순서를 바꾸지 않는다. 앞선 승인은 뒤 단계 승인을 포함하지 않으며, 사용자의 명시적 운영 승인 전에 어느 DB 단계도 적용하거나 코드를 교체하지 않는다.

`--dry-run`은 코드 칸을 `******`로 가려 구조만 보여 준다. 반면 `--print-seed-sql`과 `--print-sync-sql`의 출력 전체는 접속코드가 든 **비밀 SQL packet**이다. 이 packet을 일반 terminal 출력, shell transcript, CI log, Git, `evaluation/` 증거에 남기지 않는다. 승인된 비밀 scratch에서 검토·적용한 뒤 조직의 비밀 폐기 절차를 따른다.

구형 개별 코드 helper인 `scripts/rotate-join-code.mjs`도 direct Supabase write 경로가 없고, 정확히 하나의 조 이름과 `--dry-run` 또는 `--print-sql` 중 하나가 없으면 종료코드 `2`로 중단한다. 정상 운영은 감사 기록이 남는 HQ RPC를 우선하며, `--print-sql` 출력이 꼭 필요한 비상 상황에도 별도 승인과 위 비밀 scratch·폐기 규칙을 그대로 적용한다.

## 3. 정상 운영

1. HQ 조작자는 `/hq`의 세션 제목·현재 열린 꼭지·활성 기기 수를 확인한다.
2. 상황 책임자가 다음 꼭지 개방을 승인한다.
3. HQ 조작자는 “기대 순번”을 읽고 개방한다. 이미 다른 조작자가 열었다면 충돌을 정상 상태로 보고 새 snapshot을 다시 읽는다.
4. 기록 담당은 시각, 조작자 역할, 대상 순번, 결과(`opened` 또는 `conflict`)만 기록한다. 토큰과 접속코드는 기록하지 않는다.
5. 조 화면의 새 꼭지 알림을 확인한다. 기존 입력은 자동으로 지우거나 다른 꼭지로 이동시키지 않는다.
6. 저장 충돌 시 서버 snapshot과 이 기기 내용을 나란히 보여 준다. 기본 동작은 서버 보존이며 강제 저장은 확인자 승인 뒤에만 한다.

### 9월 12일 야간 인계와 9월 13일 재개

1. 9월 12일 20:00에 새 단계를 열지 않고 각 조의 현장 카드, 마지막 디지털 저장 시각, 미완료 항목을 대조해 인계표에 남긴다.
2. 자동 snapshot은 9월 13일 09:00까지 이어가되 행사 토큰과 브라우저 세션을 임의 폐기하지 않는다. 야간 인계는 행사 전체 종료로 처리하지 않는다.
3. 9월 13일 08:30에 백업 가용성, 열린 단계, 조별 카드와 디지털 사본의 차이를 읽기 전용으로 확인한다. 차이가 있으면 현장 카드를 보존하고 상황 책임자에게 보고한다.
4. 09:10 세부 정책제안 단계 개방 전 두 사람이 계획 계약과 현재 단계를 다시 확인한다.
5. 17:00에는 미완성 초안을 지우거나 확정 처리하지 않고 제8차 이관 메모와 함께 보존한 뒤 종료·백업·복원 절차로 이동한다.

### Canvas 익명 의견조사 운영 제한

`/v`의 모든 공개 QR 투표와 public ballot은 caller가 제공한 기기 식별자로 중복만 줄이는 **비구속 현장 조사**다. 개인별 1회 참여를 증명하지 못하므로 공식 의사결정, 정족수 또는 대표성 판단의 단독 근거로 사용하지 않는다. 조 모더레이터가 책임 아래 입력하는 대리 기록과도 별개다. Canvas 운영자는 `pending → active → closed` 순서로만 상태를 바꾸고, 마감 뒤 공개되는 집계만 참고 자료로 기록한다. ballot 응답은 ballot·조직·공론화·세션이 모두 active이고 hard expiry 전일 때만 수락하며, 마감과 제출은 같은 ballot 행 잠금으로 순서를 확정한다. 마감이 먼저 확정되면 대기하던 제출도 거부되는 것이 정상이다. 강한 1회용 개인 ballot capability가 필요한 공식 표결은 별도 개인정보·배포 설계와 운영 승인을 거쳐 후속 구현한다.

## 4. HQ와 비상 RPC

정상 경로는 `/hq`다. 화면이 열리지 않지만 Supabase RPC가 정상일 때만 아래 **비상 RPC**를 사용한다. 직접 `update`·`delete` SQL은 사용하지 않는다.

| 목적 | RPC | 필수 확인 |
|---|---|---|
| 현재 상태 | `workshop_hq_status(p_token, p_session_slug)` | 세션 slug, 현재 순번, 열린 꼭지 |
| 다음 꼭지 열기 | `workshop_hq_open_next_topic(p_token, p_session_slug, p_expected_ordinal, p_idempotency_key)` | 기대 순번, 새 멱등키, 확인자 |
| 꼭지 상태 변경 | `workshop_hq_set_topic_status(p_token, p_session_slug, p_topic_id, p_expected_status, p_status, p_idempotency_key)` | topic id, 기대 상태, 목표 상태 |
| 꼭지 마감 변경 | `workshop_hq_set_deadline(p_token, p_session_slug, p_topic_id, p_expected_deadline_at, p_deadline_at, p_idempotency_key)` | topic id, 기존 마감(CAS), 새 마감 또는 해제 `null` |
| 활성 기기 조회 | `workshop_hq_devices(p_token, p_session_slug)` | 조명, 기기 라벨, 마지막 사용 시각 |
| 토큰 폐기 | `workshop_hq_revoke_device(p_token, p_session_slug, p_token_hash, p_reason, p_idempotency_key)` | token hash, 사유, 영향받는 조 |
| 현재 조 기기 연결 종료 | `workshop_team_logout_v2(p_token)` | 서버가 `true`를 반환한 뒤에만 `/mod`의 로컬 토큰을 지운다. 실패하면 토큰을 유지하고 다시 시도한다. |
| 현재 HQ 기기 로그아웃 | `workshop_hq_logout_v2(p_token)` | 서버가 `true`를 반환한 뒤에만 브라우저의 로컬 토큰을 지운다. 실패하면 토큰을 유지하고 다시 시도한다. |
| 접속코드 전체 교체 | `workshop_hq_rotate_join_codes(p_token, p_session_slug, p_confirmation, p_idempotency_key)` | 확인 문자열 `ROTATE 0912-deliberation`, UUID 멱등키, 책임자 승인. 같은 세션의 기존 workshop·attendance 팀 토큰이 모두 폐기되는지 확인 |

비상 RPC 실행 규칙:

- HQ 토큰은 승인된 비밀 입력 경로로만 전달하고 명령행 인자·스크린샷·로그에 넣지 않는다.
- 멱등키는 조작 1건마다 새 UUID를 만들고 재시도할 때만 같은 값을 쓴다.
- `conflict`면 성공으로 바꾸려 재호출하지 않는다. 상태를 다시 읽고 새 승인을 받는다.
- 결과에는 RPC명, 대상의 비밀 아닌 식별자, 결과 상태, 실행·확인 역할만 남긴다.
- 접속코드 전체 교체 결과는 1회만 보인다. 승인된 오프라인 전달표에 옮긴 뒤 화면·클립보드를 닫는다.
- HQ 비밀번호 변경이 `current_password_incorrect` 또는 `rate_limited`를 반환하면 화면의 실패 안내를 그대로 보여 주고 성공으로 간주하지 않는다. 오답 기록은 예외 롤백으로 지우지 않으며, 짧은 시간 안의 다섯 번 실패 뒤 추가 시도는 잠긴다. 반복 시도하지 말고 상황 책임자에게 인계한다. 기존 `current credential`은 과거 값과의 호환을 위해 UTF-8 72바이트 제한으로 선차단하지 않는다. 새 비밀번호만 8자 이상·UTF-8 72바이트 이하를 적용하고, 한글·이모지는 한 글자가 여러 byte일 수 있으므로 화면의 byte 표시를 기준으로 확인한다. 성공하면 해당 운영자 이름으로 발급된 모든 HQ 토큰이 즉시 폐기되므로 현재 기기와 다른 기기 모두 새 비밀번호로 다시 로그인한다.

## 5. 토큰 폐기

다음 경우 즉시 개별 **토큰 폐기**를 검토한다: 기기 분실, 화면 공유 중 권한 노출, 알 수 없는 세 번째 기기, 담당자 교대 후 공용 기기 미반납.

1. `workshop_hq_devices`로 조·기기 라벨·마지막 사용 시각을 대조한다.
2. 상황 책임자가 폐기 대상을 읽고 확인한다.
3. `workshop_hq_revoke_device`를 실행한다. 원문 토큰이 아니라 `token_hash`를 지정한다.
4. 해당 기기에서 `mod_session_get`이 거부되는지 확인한다.
5. 정상 기기 한 대가 계속 조회·저장 가능한지 확인한다.
6. 접속코드 자체가 노출됐으면 개별 폐기 뒤 전체 코드 교체를 별도 승인한다.

P2a 직후의 폐기 검증과 행사 종료 cleanup은 서로 다른 gate다. P2a positive 검증에서는 로그아웃한 HQ token 재사용 거부, 비밀번호 변경 뒤 같은 운영자의 모든 기기 거부, 조 기기 폐기를 확인하고 `p2a-token-revocation-verification` receipt를 닫은 뒤에만 P3로 간다. 행사 종료 때는 격리 복원까지 끝낸 후 별도 `approval-final-token-cleanup`을 먼저 기록하고, 그 다음 남은 임시 event token 수를 읽기 전용으로 확인한다. 남은 수가 양수이면 승인 범위 안에서만 폐기하고 실제 연결·변경 건수를 기록한다. 처음부터 0이면 같은 승인 뒤 `read-only-observation`과 변경 0건으로 기록한다. 어느 경우든 `final-token-cleanup` gate의 실측값이 `remaining_temporary_event_token_count = 0`이어야 최종 판정으로 간다.

## 6. 백업

백업은 “파일이 생겼다”가 아니라 “읽을 수 있고 복원된다”까지가 완료다.

1. 상황 책임자가 백업 snapshot만을 위한 `approval-backup-snapshot`을 승인하고, 승인 시각·승인자·`backup` gate·source commit·target revision을 operator log에 기록한다. 다른 migration 또는 rollout 승인을 백업 승인으로 재사용하지 않는다.
2. 승인된 운영 환경에서 snapshot workflow를 수동 실행한다. `cv_snapshot_now`·`cv_archive_round` 실행은 `service_role` 전용이며 서비스 역할 키와 HMAC 키는 비밀 저장소에서만 읽는다. 브라우저나 authenticated 사용자 세션에서 직접 실행하지 않는다.
3. snapshot 행 생성은 **승인된 production mutation**이다. 실제 연결·변경 건수는 backup gate receipt와 operator log의 `productionAccess`에 양수로 기록하고 `approval-backup-snapshot`에 결속한다. readiness 보고서의 `approvedProductionMutationCount`는 operator 집계와 일치해야 하며, `unapprovedProductionMutationCount`와 `syntheticRehearsalProductionMutationCount`는 모두 `0`이어야 한다.
4. 워크플로 산출물의 source commit, workflow run ID, HMAC key ID, snapshot ID, HMAC 검증 결과를 기록한다. 이 실행의 `releaseRunId`와 workflow 자체의 run ID를 혼동하지 않는다.
5. archive를 나중에도 같은 byte로 다시 지정할 수 있는 정규 S3 version ID 형식 `s3://bucket/object?versionId=...`의 `archiveObjectRef`로 기록한다. fragment, 추가 query, `latest`·`current` 같은 가변 별칭은 허용하지 않는다. 다른 provider를 쓰려면 해당 provider의 불변 버전 문법과 재취득 검증을 코드·테스트에 먼저 추가한다. 동시에 실제 파일의 `archiveSizeBytes`와 64자리 소문자 `archiveSha256`을 기록한다.
6. archive를 승인된 로컬 보관 위치에 내려받고 symlink가 아닌 일반 파일인지 확인한다. archive 내부 `audit`의 repository, workflow run/ref, source commit, key ID, snapshot ID, HMAC 알고리즘·대상은 backup·restore의 `archiveAudit`와 같아야 한다. 이 파일은 최종 release verifier의 `--backup-archive`에 전달하며, verifier가 동일 파일 descriptor에서 읽은 실제 byte 크기·SHA-256·내부 audit를 두 서명본 모두와 대조한다.
7. `evaluation/0912-13-backup-manifest.template.json` 기반 unsigned manifest를 채우고 backup 전용 키로 서명한다. 서명 뒤 archive ref·크기·hash 또는 manifest byte를 수정하지 않는다.
8. 조별 산출물 보조 백업은 기존 스크립트를 세션 인자와 함께 쓸 수 있다. 이름은 과거 날짜지만 `--session 0912-deliberation`을 반드시 명시한다. 조회 RPC 자체는 읽기 전용이지만 named HQ 로그인은 서버 token을 만들고 종료 시 로그아웃 RPC가 그 token을 폐기한다. 따라서 운영자 이름·비밀번호가 필요하며 전체 실행을 무변경 작업으로 기록하지 않는다.

   ```powershell
   $env:HQ_OPERATOR = Read-Host '운영자 표시 이름'
   $env:HQ_PASSWORD = Read-Host '본부 비밀번호'
   node scripts/backup-0829.mjs --session 0912-deliberation --out '..\10_작업산출물\2026-09-12_백업'
   Remove-Item Env:HQ_PASSWORD
   ```

9. `latest.json`의 session, captured time, 조·항목·최종제출 건수를 기록한다. `latest.checksumSha256`에는 내부 `checksum` 필드가 아니라 `Get-FileHash -Algorithm SHA256`으로 계산한 **파일 전체 실제 byte SHA-256**을 소문자로 기록하고, 최종 검증의 `--latest-backup`에 같은 파일을 전달한다. 파일 내용에는 원문과 운영자 표시 이름이 있으므로 Git·공개 평가 산출물에 넣지 않는다.
10. 백업 실패가 이어지거나 immutable ref·크기·hash 중 하나라도 확정되지 않으면 새 꼭지를 열지 않고 중단 기준으로 이동한다.

## 7. 복원 리허설

운영 DB에는 복원 리허설을 하지 않는다.

1. 백업 무결성을 `node automation/snapshot-db.mjs --verify <archive.json>`으로 확인한다.
2. `SNAPSHOT_RESTORE_DATABASE`를 임시 DB 이름으로 설정하고 `--prepare-restore-rehearsal`로 SQL을 만든다.
3. 네트워크가 격리된 임시 PostgreSQL 16 컨테이너에만 SQL을 실행한다.
4. `submission_item_lock_guard`를 포함한 업무 trigger는 복원 전·중·후 모두 활성 상태로 유지한다. `DISABLE TRIGGER`, `session_replication_role=replica` 또는 동등한 우회는 사용하지 않는다.
5. 순환 순서 해소가 필요한 정확한 FK만 같은 복원 transaction 안에서 `DEFERRABLE INITIALLY DEFERRED`로 바꾼다. `submission_item`을 먼저, 원래 상태의 `submission`을 다음에 넣은 뒤 `SET CONSTRAINTS ... IMMEDIATE`로 즉시 검사한다. 이 변경은 transaction 밖에 남기지 않는다.
6. 원본 counts와 복원 counts, archive의 모든 행, 제약·trigger 상태를 대조한 뒤 전체 transaction을 rollback한다. rollback 뒤 대상 테이블 0행, `submission_item_lock_guard` 활성, 해당 FK의 원래 `NOT DEFERRABLE`·초기 즉시 상태가 모두 확인돼야 한다.
7. 결과 로그에 `restore_rehearsal_passed`, `businessTriggersEnabledBefore/DuringRestore/After`, archive checksum, immutable object ref, byte 크기, 컨테이너 이름, 실행 commit을 남긴다.
8. `evaluation/0912-13-restore-report.template.json` 기반 unsigned 보고서에 backup과 같은 `releaseRunId`, snapshot ID, `archiveObjectRef`, `archiveSizeBytes`, `archiveSha256`, 테이블별 counts를 기록하고 restore 전용 키로 서명한다. backup 서명이 끝나기 전에 restore 증거를 만들지 않는다.
9. 임시 컨테이너를 폐기한다. 복원 SQL과 archive는 운영 원문을 포함한 민감 자료로 취급하고 승인된 보관 위치로 옮기며, 일반 로그나 Git에는 넣지 않는다.

CI의 `Rehearse signed snapshot restore in isolated PostgreSQL` 단계는 코드 경로의 회귀를 막는다. 행사 직전 실제 archive 복원 확인을 대신하지는 않는다.

### P2a 비상 rollback 안전선

P2a rollback은 구형 클라이언트를 살리는 대신 예측 가능한 접속코드 권한과 넓은 vote 접근을 의도적으로 다시 연다. 일반 migration 실행으로는 시작되지 않으며, 상황 책임자의 별도 승인·사고 참조번호·복구 종료시각을 먼저 기록한 뒤 같은 `psql` 연결에서 아래 두 설정을 하고 실행한다.

```sql
set climate_vote.emergency_rollback_ack = 'I_ACCEPT_LEGACY_ACCESS_REOPEN';
set climate_vote.emergency_rollback_incident = '승인된-사고-참조번호';
\i supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql
reset climate_vote.emergency_rollback_ack;
reset climate_vote.emergency_rollback_incident;
```

승인값이나 사고 참조번호가 없으면 rollback 파일은 첫 변경 전에 실패한다. rollback 직후에는 새 꼭지를 열지 않고 영향 시간을 기록하며, 정한 종료시각 안에 P2a를 재적용하고 `supabase/verify/platform_p2a_0912_token_only_activation.sql`을 다시 통과시킨다. 구형 권한이 열린 상태를 정상 운영이나 단순 검증 완료로 기록하지 않는다.

## 8. 중단 기준과 재개

아래 중 하나면 **새 단계 개방과 조별 초안 제출을 중단**한다.

- 서로 다른 두 기기의 정상 저장이 경고 없이 덮어써진다.
- 서버 조회 실패 뒤 마지막 정상 입력이나 꼭지 목록이 화면에서 사라진다.
- 폐기한 토큰으로 조회·저장이 된다.
- 세 번째 활성 기기가 허용된다.
- 잘못된 세션 slug 또는 승인되지 않은 꼭지가 보인다.
- 최근 검증된 백업이 없거나 격리 복원이 실패한다.
- 운영 DB를 향한 합성 리허설 요청이 한 건이라도 관찰된다.
- `/hq` 조작 결과와 `/mod` 상태가 재조회 두 번 뒤에도 일치하지 않는다.
- 접근성 필수 과업에서 키보드 포커스가 갇히거나 오류·충돌 상태를 읽을 수 없다.

중단 시 조에는 “입력은 지우지 말고 현재 화면을 유지해 달라”고 안내한다. 기록 담당은 최초 시각·영향 범위·마지막 성공 조작을 적고, HQ 조작자는 상태 조회만 한다. 원인이 확인되고 합성 리허설·토큰·백업 gate가 다시 통과한 뒤 상황 책임자와 확인자가 함께 재개한다.

## 9. 종료·증거 서명·최종 판정

검증 도중 생성한 파일 때문에 후속 보고서의 `sourceTreeClean`이 거짓으로 바뀌지 않도록, JSON·로그는 먼저 저장소 밖의 임시 폴더에 만든다. operator draft와 finalizer 출력만 소스 덮어쓰기 방지가 적용된 ignore 경로 `.tmp-verify/0912-operator/<releaseRunId>/`를 쓴다. 모든 검증이 끝난 뒤 비밀·개인정보가 없고 source commit과 clean 상태가 정확한지 확인한 승인본만 `evaluation/`에 한 번 반입한다. 예시는 다음과 같다.

```powershell
$evidenceDir = Join-Path $env:TEMP ("0912-evidence-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidenceDir | Out-Null
node scripts/verify-0912-readiness.mjs --output (Join-Path $evidenceDir '0912-13-traceability-report.json')
node scripts/verify-field-rehearsal.mjs --base http://127.0.0.1:4331 --report (Join-Path $evidenceDir '0912-13-field-rehearsal.json')
```

현장 리허설 JSON의 `screenshots`에는 절대 로컬 경로가 아니라 `.tmp-verify/rehearsal-*.png` 같은 저장소 기준 portable 경로만 기록한다. 스크린샷은 합성 화면만 포함하는지 확인한 뒤 별도 증거 묶음으로 보관한다. readiness/field CLI는 절대 출력 경로를 지원하며, 임시 폴더의 검증본을 반입하기 전에는 `evaluation/`을 쓰지 않는다.

증거 packet은 다음 순서로 닫는다.

1. 한 `releaseRunId` 아래 자동·수동·현장·production 증거와 결정적 receipt를 모두 확정한다.
2. 실제 archive byte를 기준으로 backup manifest를 채우고 backup 전용 키로 서명한다.
3. 같은 archive의 격리 복원을 마친 뒤 restore report를 채우고 restore 전용 키로 서명한다.
4. 승인 시각이 대응 production 실행보다 빠른지, rollout과 검증 gate의 선후관계가 맞는지 operator DAG를 대조한다.
   각 단계의 승인은 직전 단계의 rollout·검증 gate가 완료된 뒤에만 유효하다. 특히 P2a 승인은 배포 revision·ACL inventory·실명 운영자 확인 뒤, P4 승인은 P3 post-apply 검증을 포함한 signed rollout receipt 뒤, backup 승인은 post-P4·현장·수동 접근성 gate 뒤에만 기록한다.
5. 실행별 operator draft를 `.tmp-verify/0912-operator/<releaseRunId>/`에 채우고 finalizer를 실행한다. finalizer가 gate 35개, rollout 14개, control 7개의 receipt 56개를 결정적으로 만들고 정본 파일 12개를 더해 binding 68개를 완성한다. 소스 파일이나 canonical signed operator 경로를 `--force` 출력 대상으로 쓸 수 없다.
6. finalizer가 만든 unsigned operator log를 마지막으로 operator 전용 키로 서명한다. 그 뒤 결속된 파일은 고치지 않는다.
7. readiness report를 operator 서명 뒤에 생성하고 검증한다. 모든 evidence의 생성·서명 시각은 검증 시각 기준 24시간 이내이고 미래 허용 오차는 5분 이내여야 한다.

finalizer 도중 프로세스·OS가 중단되면 숨김 `.stage`·`.backup` 파일을 임의로 지우거나 정본으로 이름을 바꾸지 않는다. 해당 `releaseRunId` 디렉터리를 그대로 보존하고, 목표 파일과 남은 stage/backup의 실제 SHA-256을 별도 기록한 뒤 상황 책임자에게 인계한다. 자동 rollback 완료를 추정하지 말고 파일별 원본·설치본 상태를 확인하며, 정합성을 증명할 수 없으면 그 packet은 서명하지 않고 새 `releaseRunId`로 처음부터 만든다. 같은 계정이 검증과 게시 사이에 상위 폴더를 junction으로 바꾸거나 OS가 디스크 반영 중 종료되는 상황은 로컬 파일 트랜잭션만으로 완전히 배제할 수 없으므로, 증거 디렉터리는 접근권한이 제한된 로컬 볼륨에서 운영하고 종료 후 독립 백업에 보관한다.

자동·수동 증거 JSON, receipt, operator log 전체에는 capability 원문, 접속코드, `Authorization` 값, cookie, 비밀번호, private key가 없어야 한다. 비밀 탐지가 한 곳에서라도 발생하면 해당 실행 packet을 폐기하고 새 `releaseRunId`로 다시 시작한다.

- [ ] 마지막 꼭지 상태와 제출 건수를 저장하고 새 백업을 만든다.
- [ ] 격리 복원 결과를 확인한다.
- [ ] 격리 복원 뒤 별도 `approval-final-token-cleanup`을 기록하고, 남은 행사 임시 기기 토큰을 폐기하거나 이미 0개임을 읽기 전용으로 확인한다.
- [ ] 필요하면 접속코드를 교체한다.
- [ ] `evaluation/0912-13-readiness-report.template.json` 기반 실행 보고서에 실제 증거 경로를 채운다.
- [ ] operator·backup·restore에 서로 다른 공개키를 사용했고 각 지문이 승인 commit의 configured trust policy와 일치하는지 확인한다.
- [ ] `scripts/verify-0912-release-report.mjs`에 세 공개키, 실제 `--backup-archive`, 같은 실행의 `--latest-backup`을 전달해 실행 보고서가 승인 source commit, 배포 revision, production 환경, `releaseRunId`, receipt 및 실제 파일 byte와 결합되어 있는지 확인한다.
- [ ] operator의 `rollbackArtifactSha256`가 승인 source commit의 `supabase/rollbacks/platform_p2a_0912_token_only_activation_BEFORE.sql` 실제 byte SHA-256과 일치하는지 확인한다. 현재 작업 트리의 파일이나 임의 hex를 복사하지 않는다.
- [ ] `approvedProductionMutationCount`가 서명 operator log의 승인된 변경 집계와 일치하고 0보다 크며, `unapprovedProductionMutationCount`와 `syntheticRehearsalProductionMutationCount`는 각각 `0`인지 확인한다.
- [ ] 운영일지에는 비밀·접속코드·원문 개인정보가 없는지 두 사람이 확인한다.
- [ ] trust policy가 `unconfigured`이거나 production 직접 확인, 수동 보조기술 평가, 현장 기기·네트워크 리허설, 실제 백업, 격리 복원, 서명 operator log 중 하나라도 없으면 `releaseDecision`을 `not_ready` 또는 `stopped`로 유지한다.
