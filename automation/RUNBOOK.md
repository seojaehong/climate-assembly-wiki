# B-008a 자동 캡쳐 운영 매뉴얼

> 워크숍 1회당 1회만 쓰는 시스템. 사전 검증이 본 운영 안정성을 결정한다.

## 적용 워크숍

| 일자 | 명칭 | 시간(KST) | round_id |
| --- | --- | --- | --- |
| 2026-07-04 | 7월_행사 | 09:00 ~ 18:00 | 2 |
| 2026-08-29 | 2차_의제선정 | 09:00 ~ 18:00 | 3 |
| 2026-09-12 | 6차_분과권고안의결_경주합숙1일차 | 09:00 ~ 21:00 | 6 (행사 전 확인) |
| 2026-09-13 | 7차_분과권고안의결_경주합숙2일차 | 09:00 ~ 18:00 | 7 (행사 전 확인) |
| 2026-10-17 | 8차_전체법정의결 | 09:00 ~ 18:00 | 8 (행사 전 확인) |

신규 워크숍 추가 시: `automation/workshop-schedule.yml`의 `workshops:` 배열에 날짜순 row를 추가하고 고유한 이름·`supabase_round_id`를 확인한 뒤 capture·snapshot·finalize workflow의 정적 cron을 함께 추가해 PR로 머지한다. capture·snapshot은 GitHub Actions가 지원하는 5분 간격을 사용하며 각 시점이 별도 증거이므로 concurrency coalescing을 사용하지 않는다. automation 테스트는 정본 일정에서 파생한 세 workflow cron과 scheduled finalize의 실제 `WORKSHOP` 전달이 정확히 일치하는지 검사한다. cron에는 연도가 없으므로 scheduled finalize는 해당 정본 일자의 KST 당일 또는 종료 직후 다음 날에만 실행하고, 다른 연도 재발화는 건너뛴다.

## D-30 — Secrets 등록 (GitHub repo Settings → Secrets and variables → Actions)

| Secret | 용도 | 비고 |
| --- | --- | --- |
| `DRIVE_SA_JSON` | Drive SA 키 (JSON 통째) | 기존 `climatevoice-scraper@...` 재사용 가능 |
| `DRIVE_PARENT_ID` | Drive "기후시민회의_워크숍자동아카이브" 부모 폴더 ID | SA를 Editor로 추가 필수 |
| `SUPABASE_URL` | 프로젝트 URL | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE` | service role 키 | `cv_snapshot_now` RPC 권한 |
| `SHEETS_ID` | "워크숍 아카이브" Sheets 문서 ID | `워크숍_아카이브` 탭 + A~E 열 헤더 (date / workshop / captureSets / snapshotCount / finalVotes) |
| `DISCORD_WEBHOOK` | 알림 채널 webhook URL | critical/warning/info 동일 채널 사용 |

### 플랫폼 스냅샷 자동 export 활성화 게이트

- GitHub Actions repository variable `PLATFORM_SNAPSHOT_ENABLED`가 없거나 `false`이면 기존 `cv_snapshot_now`만 호출한다. 현재 기본값이다.
- 승인 후 값을 정확히 `true`로 설정하면 각 실행에서 기존 snapshot을 먼저 보존하고 `platform_snapshot_now`를 추가 호출한다. 기존 투표·의제 payload를 플랫폼 snapshot으로 대체하지 않는다.
- 비활성 상태의 Drive JSON은 기존 `cv_snapshot_now` 반환 형상을 그대로 유지한다. 활성화 상태에서는 생성된 platform snapshot 행을 ID로 다시 읽어 실제 `payload`를 포함한 `{ legacy, platform, audit }` JSON으로 Drive에 올린다.
- 새 `audit` schema v2 manifest는 GitHub run ID·repository·commit SHA·workflow ref·export 시각·snapshot ID·`keyId`와 `legacy` RPC 결과·`platform` 전체 행을 HMAC-SHA256으로 함께 결속한다. 복구 시 `audit.keyId`에 해당하며 Drive 파일 밖에 보관한 키를 `verifySnapshotArchiveIntegrity()`에 전달해 provenance와 두 snapshot의 서명을 확인한다. 오류 없는 RPC가 빈 legacy receipt를 반환해도 platform RPC 전에 실패한다.
- 복구 검증기는 `{ legacy, platform, audit }` 최상위와 platform snapshot 행, audit·integrity manifest를 exact-field 계약으로 읽는다. `platform`은 최소 `id|source|payload`가 있어야 하고, payload collection과 선언 count도 정본 필드만 허용한다. 새 DB 열·manifest 메모·count가 생기면 무시하지 않고 실패하므로 export 계약과 복원기를 함께 검토·갱신한 뒤 다시 생성한다.
- 활성화하면 `climate_vote.snapshots`에 실행당 행이 1개에서 2개로 늘고 Drive 저장량도 증가한다. 프로덕션 행 증가와 저장량을 승인한 뒤에만 켠다.
- `platform_p2_analysis_review.sql` 적용, service role의 `platform_snapshot_now(text)` 실행 권한, `climate_vote.snapshots` SELECT 권한을 먼저 확인한다. GitHub Actions secret `SNAPSHOT_AUDIT_HMAC_KEY`에는 32자 이상의 무작위 키를 두고 Drive JSON·로그·저장소에는 기록하지 않는다. repository variable `SNAPSHOT_AUDIT_KEY_ID`에는 비밀값이 아닌 불변 키 버전을 둔다. 키·key ID·GitHub provenance 중 하나라도 없으면 platform RPC 전에 실패한다.
- 플랫폼 생성 또는 payload 조회 실패는 기존 snapshot을 지우지 않지만 workflow를 실패 처리하고 Discord 경보 대상으로 남긴다.
- 이 manifest는 개별 export의 provenance·무결성 증거다. PITR/WAL 설정이나 사용자 행위까지 기록하는 별도 운영 감사로그를 구현하지 않으며, 두 운영 통제는 계속 별도 작업이다.

#### HMAC 키 수명주기

1. 키 생성 시 `snapshot-audit-YYYY-MM-vN` 형식의 새 key ID를 부여하고, 실제 키는 GitHub 밖의 승인된 비밀관리 저장소에 같은 ID로 백업한다. GitHub Actions secret 값은 설정 후 다시 읽을 수 없으므로 GitHub만 유일한 보관처로 두지 않는다.
2. 교체 전 `PLATFORM_SNAPSHOT_ENABLED=false`로 추가 snapshot 생성을 멈추고, 최근 Drive archive가 기존 키로 검증되는지 확인한다.
3. 새 키를 `SNAPSHOT_AUDIT_HMAC_KEY`에, 대응 ID를 `SNAPSHOT_AUDIT_KEY_ID`에 설정한 뒤 함께 활성화한다. 키와 ID가 어긋난 기간에는 export를 실행하지 않는다.
4. 과거 키는 해당 key ID의 archive 보존기간이 끝날 때까지 읽기 전용으로 보관한다. 폐기 시 대상 key ID·보존기간 종료 근거·승인자를 운영 감사기록에 남긴다.

#### 내려받은 archive 읽기 전용 복구 점검

Drive에서 내려받은 활성화 상태의 `{ legacy, platform, audit }` JSON은 DB나 Drive에 연결하지 않고 로컬에서 먼저 검증한다. `audit.keyId`를 확인해 외부 비밀관리 저장소에서 대응 키를 선택한 뒤 PowerShell에서 실행한다.

```powershell
Set-Location automation
$env:SNAPSHOT_AUDIT_HMAC_KEY = Read-Host -MaskInput 'HMAC key for audit.keyId'
node snapshot-db.mjs --verify 'C:\secure\snapshots\archive.json'
node snapshot-db.mjs --rehearse 'C:\secure\snapshots\archive.json'
Remove-Item Env:SNAPSHOT_AUDIT_HMAC_KEY
```

- `--verify` 성공 시 snapshot ID·source·key ID·GitHub provenance, `integrityTarget`, `legacyIntegrityVerified`와 collection별 건수만 JSON으로 출력한다. 제출 원문이나 참여 데이터는 출력하지 않는다. 새 schema v2는 `legacy+platform+provenance`와 `legacyIntegrityVerified:true`여야 한다.
- `verifySnapshotArchiveIntegrity()` 기본 boolean은 전체 archive를 결속한 schema v2만 `true`다. 과거 schema v1 archive의 `platform+provenance` HMAC은 `--verify|--rehearse` 파일 호환 경로가 명시적으로 `allowPlatformOnlyV1`을 선택할 때만 검증하고 `legacyIntegrityVerified:false`로 보고한다. 직접 API에서 v1 platform-only 검증이 꼭 필요할 때도 세 번째 인자 `{ allowPlatformOnlyV1: true }`를 명시해야 한다. v1의 legacy 내용은 그 HMAC이 보호하지 않으므로 검증된 것으로 취급하지 말고, 별도 원본·Drive version history 등 독립 증거와 대조한다. v1 파일을 v2로 다시 포장하거나 새 시각의 원본이라고 주장하지 않는다.
- HMAC이 다르거나 JSON이 손상됐거나 envelope 필드가 누락·추가됐거나 `platform` source가 아니거나 필수 collection이 빠졌거나 선언 count 필드·건수와 실제 배열 길이가 다르면 nonzero로 종료한다. 오류에는 알 수 없는 필드명·값이나 archive 원문을 출력하지 않는다.
- 필수 collection은 `submission`, `submission_item`, `issue`, `issue_link`, `result_page`, `ballot`, `ballot_item`, `ballot_response`다.
- `--rehearse`는 위 검증 후 archive 내부 ID·FK(외래키: 다른 행을 가리키는 값), DB 고유키, submission 상태와 item 순서·종류·본문·근거, issue의 제목·방향·빈도·origin·검수 상태와 link 작성 주체, result page 제목·scope, ballot 제목·상태와 문항 순서·본문·허용 척도·필수 여부 boolean, 응답 client ID의 DB 길이 범위를 읽기 전용으로 점검한다. UUID 컬럼인 모든 행 ID, 내부 FK, 외부 부모 참조와 nullable `issue_link.cluster_id`·`ballot_response.org_id`는 PostgreSQL JSON export와 같은 소문자 8-4-4-4-12 canonical 형식이어야 한다. submission 상태는 `draft|final|reopened|archived`, item 종류는 `core|extra`, 순서는 PostgreSQL `integer` 범위만 허용한다. 본문은 PostgreSQL `trim`·`length` 의미로 1~2,000자, nullable 근거는 원문 기준 최대 2,000자다. issue 제목은 같은 의미로 1~200자이며 nullable 방향·빈도와 필수 origin·검수 상태·link 작성 주체는 migration enum만 허용한다. result page 제목은 1~300자다. `jsonb NOT NULL`은 SQL `NULL`만 막고 JSON 값 `null`은 허용하므로 archive의 provenance와 body가 JSON `null`인 것만으로 거부하지 않는다. ballot 제목과 문항 본문은 각각 1~200자와 1~300자를 검사하고, 상태는 `draft|open|closed|published|archived`만 허용한다. 각 issue link는 RPC와 같은 규칙으로 원문 submission과 topic·조직이 같아야 하며, `ballot_response.org_id`가 명시된 경우에는 상위 ballot 조직과 같아야 한다. 익명 응답의 nullable org는 계속 허용한다. 각 응답의 모든 문항 키가 archive에 존재하고 응답이 속한 같은 ballot의 문항인지도 전수 확인한다. 성공 요약에는 내부 참조·테넌트 관계·응답 점검 건수, 복원 순서, archive 밖 `org`·`discussion_topic`·`team`·`session`·`assembly` 부모의 중복 제거 건수와 `databaseRestoreExecuted: false`만 남기며 원문·ID·응답 값은 출력하지 않는다. nullable인 `ballot_response.org_id`도 값이 있으면 조직 부모 집합에 포함하고 형식을 검사한다. `result_page.scope`는 `topic`·`session`·`assembly`별 부모 건수에 합산하고 다른 값은 거부한다.
- 현재 platform payload에는 `discussion_topic`, `team`, `session`과 공론화·조직 상위 경로가 포함되지 않는다. 따라서 `--rehearse`는 이 외부 의존을 건수로 드러내는 복구 preflight이며 독립 복원이 가능한 archive라는 뜻이 아니다. 부모 collection 추가는 snapshot DB 계약 변경이므로 별도 승인·migration 검토가 필요하다.
- 두 명령은 DB나 Drive에 연결하지 않는다. FK·업무 규칙 전수 검증, PITR/WAL, 사용자 행위 감사로그를 수행하거나 대체하지 않는다.

#### 격리 PostgreSQL 복원 rehearsal

서명 archive의 행을 실제 PostgreSQL 제약 아래 복원해 보려면 신규 `verify` 데이터베이스에 현재 migration chain을 먼저 적용한다. 운영 DB나 기존 데이터가 있는 DB에는 사용하지 않는다. SQL 생성기는 데이터베이스 이름이 정확히 `verify`가 아니면 거부하고, 생성된 SQL도 `current_database()`와 대상 8개 테이블의 빈 상태를 다시 확인한다.

```powershell
Set-Location automation
$env:SNAPSHOT_AUDIT_HMAC_KEY = Read-Host -MaskInput 'HMAC key for audit.keyId'
$env:SNAPSHOT_RESTORE_DATABASE = 'verify'
node snapshot-db.mjs --prepare-restore-rehearsal 'C:\secure\snapshots\archive.json' "$env:TEMP\snapshot-restore.sql"
psql --dbname verify --set ON_ERROR_STOP=1 --file "$env:TEMP\snapshot-restore.sql"
Remove-Item -LiteralPath "$env:TEMP\snapshot-restore.sql"
Remove-Item Env:SNAPSHOT_AUDIT_HMAC_KEY
Remove-Item Env:SNAPSHOT_RESTORE_DATABASE
```

생성 단계는 HMAC·구조·내부 관계 preflight를 다시 통과한 payload만 SQL에 넣고 DB에는 연결하지 않는다. 생성 SQL에는 archive 행이 포함되므로 archive와 같은 민감 자료로 취급하고 접근이 제한된 임시 위치에 저장한 뒤 실행 직후 삭제한다. 실행 단계는 archive 밖 `org`·`discussion_topic`·`team`·`session`·`assembly`를 합성 부모로 만든 뒤 `submission`부터 `ballot_response`까지 복원 순서대로 실제 삽입한다. `final` submission의 item은 정상 운영용 `submission_item_lock_guard`가 차단하므로, SQL은 시작 시 해당 이름의 user trigger가 정확히 활성 상태인지 확인하고 `submission_item` 삽입 구간에만 그 trigger를 비활성화한 뒤 즉시 다시 활성화한다. 다른 trigger나 FK·check·unique 제약은 우회하지 않으며, trigger가 없거나 이미 비활성화됐거나 재활성화되지 않으면 실패한다. 삽입 뒤 8개 collection의 모든 composite row를 archive에서 PostgreSQL 타입으로 다시 만든 기대 행과 identity key로 대조해 status·metadata·시각·조직·부모·본문·응답 값의 drift나 기대 행 누락을 거부한다. collection별 실측 건수, 모든 archive 행 전체 일치와 trigger 원상 활성화가 확인될 때만 `restore_rehearsal_passed`, `archiveRowsVerified: true`, `businessTriggerRestored: true`, `databaseRestoreExecuted: true`를 출력하고 전체 트랜잭션을 rollback한다. rollback 뒤 대상 테이블이 비어 있지 않아도 실패한다. 합성 부모는 제약 실행 가능성을 검증하며 원래 부모 행의 내용이나 권위 관계를 재현하지 않는다. CI는 PostgreSQL 16 일회성 `verify` DB에서 비활성 trigger 거부, 테스트용 ballot 변조 trigger가 만든 행 drift 거부, `final` submission을 포함한 전체 archive 행 복원과 최종 잔존 0행을 검사한다. PITR/WAL과 운영 감사로그는 별도 미구현 범위다.

## D-30 — `workshop-schedule.yml` 잠금

- Drive 부모 폴더는 일정 파일에 중복 저장하지 않고 GitHub Actions secret `DRIVE_PARENT_ID` 한 곳에서 주입한다. secret이 실제 폴더를 가리키고 SA에 Editor 권한이 있는지 확인
- `supabase_round_id`가 climate_vote.rounds의 실제 round_id와 일치하는지 확인 (현재 7월=2, 8월=3 가정)
- 정본 일정의 날짜순·고유 이름·양의 round ID와 capture·snapshot·finalize workflow의 5분/종료+4시간 cron, capture·snapshot 비병합, finalize concurrency/job 이름·scheduled 날짜 게이트가 automation 테스트를 통과하는지 확인
- PR로 머지 → main에 cron이 발화하기 시작

## 수동 dry-run 실행법 (로컬 / env 없는 환경)

env(`SUPABASE_SERVICE_ROLE`)가 없거나 오늘이 워크숍 날이 아닐 때 스냅샷 RPC만 직접 검증하는 방법.

### 방법 A — CLI 강제 실행 (env 보유 시)

```bash
cd automation
npm ci

# 오늘이 workshop-schedule.yml 날짜가 아니어도 snapshotRound를 직접 호출
node -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const { snapshotRound } = await import('./snapshot-db.mjs');
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE);
  const data = await snapshotRound({ client, roundId: 2, label: 'TEST_DISCARD_manual-dry-run' });
  console.log(JSON.stringify(data, null, 2));
});
"
```

- `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE` 를 셸 환경에 미리 export해야 함
- `label`에 `TEST_DISCARD_` 접두사 필수 (사후 relabel 기준)
- 생성된 row는 Supabase SQL Editor에서 `UPDATE climate_vote.snapshots SET label='TEST_DISCARD_...' WHERE id=<id>` 로 relabel (DELETE 금지)

### 방법 B — Supabase MCP / SQL Editor (env 없는 환경)

```sql
-- 1. RPC 직접 실행
SELECT climate_vote.cv_snapshot_now(
  p_label := 'TEST_DISCARD_dry-run-YYYY-MM-DD',
  p_source := 'cron'
);
-- → {id, taken_at, votes, rounds, archive_log, bytes} 반환 = PGRST202 없음 확인

-- 2. payload 키 확인
SELECT jsonb_object_keys(payload) FROM climate_vote.snapshots WHERE id = <returned_id>;
-- 기대 키: agenda, agenda_link, agenda_vote, tally, votes, rounds, archive_log

-- 3. relabel (DELETE 금지)
UPDATE climate_vote.snapshots
SET label = 'TEST_DISCARD_dry-run-YYYY-MM-DD'
WHERE id = <returned_id>;
```

### 소스 레벨 확인 (grep)

```bash
grep -n "p_label\|p_source\|p_round_id" automation/snapshot-db.mjs
# 기대 출력 (p_round_id 없음):
# 16:    const { data, error } = await client.rpc('cv_snapshot_now', { p_label: label, p_source: 'cron' });
```

**검증 기록 (2026-06-22)**: 방법 B로 DB 함수 레벨 검증 완료. snapshot id=4, payload 7키(agenda·agenda_link·agenda_vote·tally·votes·rounds·archive_log) 확인, relabel 완료.

**⚠️ 런타임 차단 결함 발견 (별도 수정 필요)**: `snapshot-db.mjs`의 `client.rpc('cv_snapshot_now', ...)` 호출이 스키마를 지정하지 않음. supabase-js 기본값은 `public`이지만 함수는 `climate_vote` 스키마에만 존재. 이 상태로 cron 실행 시 PGRST202("function not found in schema cache") 재발 가능성 있음. 수정: `client.schema('climate_vote').rpc('cv_snapshot_now', ...)` (참고: 전체 repo에서 climate_vote 접근은 모두 `.schema('climate_vote')` 경유, `export-snapshots-onedrive.mjs`도 동일 패턴 사용).

---

## D-7 — 통합 dry-run (워크숍 4시간 전 절대 금지, 최소 일주일 여유)

```bash
gh workflow run capture.yml -f dry_run=true -f workshop=test-dry-run
gh workflow run snapshot.yml
gh workflow run finalize.yml -f workshop=test-dry-run
```

체크리스트 (spec §5-B 참조):

- [ ] schedule.yml 파싱 OK — capture.out.json 안에 workshop 필드 존재
- [ ] Drive SA 인증 OK — `test-dry-run` 폴더가 Drive 부모 폴더 안에 생성됨
- [ ] Supabase RPC OK — `snapshot.out.json` 안에 `outPath` 존재
- [ ] 플랫폼 export 승인 시에만 `PLATFORM_SNAPSHOT_ENABLED=true`이고, Drive JSON의 `platform.payload`·`legacy`·`audit` 결과가 모두 존재
- [ ] `audit.keyId`로 선택한 Drive 밖의 현재 HMAC 키로 `verifySnapshotArchiveIntegrity()`가 내려받은 schema v2 JSON에 `true`를 반환하고 `integrityTarget=legacy+platform+provenance`·`legacyIntegrityVerified=true`·run ID·commit SHA가 실행 기록과 일치
- [ ] Playwright 4페이지 모두 PNG 생성 — Drive `test-dry-run/{ts}/`에 page-{board,event,race-40,event-bar}.png
- [ ] PNG Drive 업로드 OK — UI에서 4 파일 직접 확인
- [ ] Sheets `워크숍_아카이브!A:E`에 test-dry-run row append
- [ ] Discord 알림 도착 — 채널에 ✅/⚠️ 메시지

## D-7 — 카오스 테스트 (선택, 안전 마진 점검)

DRIVE_SA_JSON을 임시로 깨뜨려 capture 실행 → artifact PNG 보존 + Discord critical alert 확인 → secret 복구. 실제 사용한 secret은 복구 후 1회 더 dry-run으로 정상 확인.

## D-Day 08:30 KST — Smoke 테스트

운영지원단이 워크숍 시작 30분 전 1회:

```bash
gh workflow run capture.yml -f workshop=<실제 워크숍명>
gh workflow run snapshot.yml
```

→ Drive에 1 set + 1 snapshot 생성 확인 → OK 신호. 이후 cron이 자동 발화.

## D+1 09:00 KST — 사후 검증

로컬에서:

```bash
cd automation
DRIVE_SA_JSON=$(cat /secure/sa.json) DRIVE_PARENT_ID=<archive-root-id> \
  node scripts/verify-drive.mjs <workshop-name> 109
```

결과:
- `status: ok` → `actual/expected`와 `snapshotCount`를 회고에 기록 (드물게 over-capture도 ok로 분류됨)
- `status: issue` → `missing` 수 확인 + GHA Actions 탭에서 실패 시간대 분석 → BACKLOG에 회고 항목 추가
- `finalize-report.mjs`도 같은 Drive 실측 경로를 사용한다. KST 행사 일자·시작·종료와 5분 간격으로 기대 UTC timestamp 집합을 만들고, 범위 밖 capture는 누락을 상쇄하지 못하도록 Sheets 기록 전에 실패한다. 각 기대 timestamp 폴더의 schedule상 필수 페이지 PNG가 모두 1개씩 있는지 확인하며, capture/snapshot timestamp 중복과 snapshot JSON 0건도 실패한다. 기대 timestamp 누락이 5%를 넘으면 경고 알림을 보낸 뒤 workflow를 실패 처리한다. finalize workflow concurrency group은 워크숍 이름별로 분리한다. 동일 워크숍의 중복 대기 실행은 최신 실행으로 합쳐질 수 있지만 서로 다른 워크숍 실행은 취소하지 않으며, 같은 일자·워크숍 Sheets 행은 append하지 않고 update한다. 기존 중복 행이 이미 있으면 자동 선택하지 않고 실패한다.
- 최종 표 수는 회차별 정본 집계가 연결될 때까지 `미집계`/빈 Sheets 셀로 남긴다. 전역 votes 수를 회차 최종 표로 오인하지 않는다.

## GHA cron drift 캐비엇

GitHub Actions schedules는 트래픽 폭주 시 5~15분 지연될 수 있다. 현재 시작·종료 시각을 모두 포함하므로 09:00~18:00 워크숍은 109 set, 09:00~21:00 워크숍은 145 set이 기준이다. 5% threshold가 종종 false alarm 낼 수 있으니 issue 발생 시:

1. Actions 탭에서 capture workflow의 실제 발화 간격 확인
2. 누락 set의 timestamp가 연속 구간(>3개 연속)이면 진짜 장애
3. 흩어져 있으면 GHA drift — 회고에 "drift {N분}" 기록하고 다음 워크숍은 cron 빈도 검토

## M1 Canvas DB contract preflight

`canvas-db-contract.mjs`는 실제 DB나 환경변수에 접근하지 않고 production Canvas source와
`supabase/migrations/*.sql`과 `docs/platform/CANVAS_DB_CONTRACT.md`만 읽어 durable platform의
저장 계약이 저장소에 완전히 표현됐는지 검사한다. `supabase/verify/00_prelude.sql`의 base table
stub은 migration이 아니므로 증거에서 의도적으로 제외한다.

```powershell
cd automation
npm.cmd run audit:canvas-db-contract -- --output-json ../evaluation/canvas-db-contract.json
```

- 대상은 `session`, `participant`, `agenda`, `agenda_link`, `agenda_edit_log`, `rounds`,
  `attendance`다.
- browser source의 select/insert/update/delete/upsert와 attendance RPC, agenda realtime 구독을
  migration-owned table column/FK, 최종 RLS/policy/GRANT 상태, realtime publication과 대조한다.
- policy는 operation·role별 `USING`/`WITH CHECK`, table GRANT와 조직/세션 경계를 함께 요구하며
  `true` 전면 허용을 거부한다. 뒤 migration의 DROP/REVOKE/RLS disable/publication drop도 최종
  상태에 반영한다.
- attendance는 RLS + anon/authenticated table 권한 회수뿐 아니라 production에서 호출하는 각
  RPC의 SECURITY DEFINER, 고정 search_path, PUBLIC EXECUTE 회수와 허용 role grant를 확인한다.
- 누락이 있으면 JSON을 먼저 저장하고 `not_ready`와 종료 코드 1을 반환한다. 이는 diagnostic
  blocker 증거이며 schema 적용 실패나 live DB 상태를 뜻하지 않는다.
- 이 정적 검사는 SQL·RLS·함수 본문의 의미를 증명하지 않으며 어떤 입력에도 M1 `ready`를
  발급하지 않는다. `verification.semantic_review_required`는 승인된 migration SQL 리뷰,
  rollback stage rehearsal, 실제 role별 권한 테스트가 별도 필요하다는 영구 경계다.
- source inventory는 literal Supabase `.from('table')` builder만 탐지한다. wrapper나 변수 보관
  query가 추가되면 matrix와 verifier를 함께 갱신해야 하며, report의 `staticAccessPattern`과
  `staticPatternComplete`는 의미 검증이 아니라 정규식 패턴 일치만 뜻한다.
- 현재 20개 migration에는 6개 Canvas base table의 저장소 소유 DDL·정책이 없고, 일부 기존
  attendance RPC도 explicit PUBLIC 회수 증거가 부족하다. contract 문서는 draft이며 사용자 승인,
  rollback SQL과 stage rehearsal이 없어 M1 완료로 승격하지 않는다. 정확한 blocker 수는 JSON을
  정본으로 삼는다.
- 로컬 미커밋 source에서 증거를 재생성할 때만 `--allow-dirty-source`를 쓰며 보고서에는
  `sourceTreeClean:false`가 남는다. 승인 근거로 사용할 clean 증거는 커밋 뒤 다시 생성해야 한다.
- 이 명령은 migration을 생성·적용하지 않는다. 정책 초안과 write failure/rollback 경계는
  `docs/platform/CANVAS_DB_CONTRACT.md`에 정리했지만 승인·rollback SQL·stage rehearsal은 미완료다.
  migration 작성·실 DB 적용은 별도 사용자 승인과 live preflight 이후에만 진행한다.

## 분석 UID provenance map 생성

`platform-submission-identity-export.mjs`는 승인된 운영 점검에서 지정 세션의
현재 참조 가능한 `submission_item.id`와 분석 입력 대조에 필요한 최소 원문 좌표만 읽기 전용으로 내보낸다.
서비스 역할 키는 환경변수로만 받고, `PLATFORM_EXPORT_EXPECTED_PROJECT_REF`가 URL의 프로젝트와
정확히 일치하지 않으면 연결 전에 실패한다. 모든 조회는 `climate_vote` 스키마의 `SELECT`이며
RPC나 쓰기 호출은 없다. 출력에는 join code·근거·사용자·토큰을 넣지 않고 저장소 밖의 새 파일만
허용한다. 기존 파일은 덮어쓰지 않는다.

```powershell
$env:SUPABASE_URL='https://<project-ref>.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
$env:PLATFORM_EXPORT_EXPECTED_PROJECT_REF='<project-ref>'
npm.cmd run export:platform-submission-identities -- --session-slug '0829-deliberation' --output 'C:\approved\submission-items.json'
```

완료 출력의 `databaseMutationExecuted:false`, 프로젝트 ref, 세션 slug, 행 수를 확인한 뒤 아래
provenance 생성기에 전달한다. 자격증명이나 원문 export는 저장소·로그·메신저에 남기지 않는다.
export 본문은 source project ref·session UUID/slug와
`identityScope:current_submission_item`, `historicalArchiveIncluded:false`를 명시한다.
기존 `submission_item_archive`는 삭제 당시 UUID를 보존하지 않으므로 이미 삭제된 과거 행의 UUID를
이 도구로 복원할 수 없다. 과거 분석 원문과 현재 행이 정확히 일치하지 않으면 UUID를 합성하거나
archive의 bigint ID로 대체하지 말고 provenance 생성을 중단한다.

`platform-analysis-provenance-map.mjs`는 분석코어 입력의 source UID를 원 `submission_item.id`에
결정적으로 연결한다. 문장을 새로 만들거나 유사도 매칭하지 않고, 조 이름·꼭지 순번·항목 순번과
원문이 모두 정확히 같은 행만 채택한다. 하나라도 없거나 중복되거나 본문이 달라지면 출력하지 않는다.

입력 두 파일과 출력은 시민 원문과 내부 UUID를 포함하므로 모두 저장소 밖의 승인된 비공개 경로에 둔다.
분석 입력은 `uid|team|topic|topic_no|text` exact-field 배열이어야 한다. 제출 export는 배열 또는
`submissions` 배열을 가진 객체이며 각 행에 최소한 다음 필드가 있어야 한다.

```json
{
  "topic_id": "주제 UUID",
  "topic_ordinal": 1,
  "team_name": "1분과 1조",
  "item_id": "submission_item UUID",
  "item_ordinal": 1,
  "item_content": "원문 한 줄",
  "cluster_id": null
}
```

기존 8/29 `latest.json`은 `item_id`가 없으므로 provenance 근거로 사용할 수 없다. UUID를 임의로
합성하지 말고, 승인된 read-only export 또는 이미 보존된 platform snapshot에서 실제 ID를 포함한
flattened export를 준비한다.

```powershell
npm.cmd run plan:platform-analysis-provenance -- --analysis-sources 'C:\approved\analysis-sources.json' --submission-export 'C:\approved\submission-items.json' --topic-id '주제 UUID' --output 'C:\approved\provenance.json'
```

- 결과는 importer가 받는 schema version 1 provenance map이며 source UID·item UUID·nullable cluster UUID만 담는다.
- 입력·출력은 저장소 밖 일반 파일만 허용하고 16MiB를 넘기지 않는다. 기존 출력은 `--force` 없이는 덮어쓰지 않는다.
- 이 명령은 환경변수·credential·Supabase client·DB RPC를 사용하지 않으며 DB와 공개 파일을 변경하지 않는다.

## 분석코어 import plan dry-run

`platform-analysis-import.mjs`는 분석 산출을 DB에 쓰지 않고 사람 검수 전용 계획 JSON으로만 변환한다.
분석의 `meta.recommendations`(또는 최상위 `recommendations`)와 `meta.quality`를 읽으며,
recommendation은 결정이 아닌 후보, quality는 진실 점수가 아닌 검토 신호로만 취급한다.
소수 우려는 부모 recommendation과 분리된 `minority` 초안으로 보존한다.

provenance map 형식:

```json
{
  "schemaVersion": 1,
  "topicId": "주제 UUID",
  "sourceMappings": [
    {
      "sourceUid": "분석 산출의 원문 UID",
      "transcriptChunkId": "원문 chunk ID(생략 시 sourceUid와 동일)",
      "itemId": "submission item UUID",
      "clusterId": "cluster UUID 또는 null"
    }
  ]
}
```

분석코어 `recommendation_pipeline.py`의 실제 산출은 최종 문안 자동생성을 막기 위해
recommendation `title`이 비어 있을 수 있고, `minority`가 인용 ID 없는 문자열 배열일 수 있다.
이 형상을 가져올 때는 원문→submission item 매핑과 별도로 사람이 준비한 후보 표시명 및
소수 우려별 provenance를 schema version 2 `candidateMappings`에 명시해야 한다. importer는
이 overlay가 없거나 index가 남거나 모자라면 계획 생성을 중단하며, overlay 적용 뒤에도
모든 issue는 `origin: ai`, `reviewStatus: draft`, `requiresHumanReview: true`다.

```json
{
  "schemaVersion": 2,
  "topicId": "주제 UUID",
  "sourceMappings": [
    {
      "sourceUid": "260829/A조/토론1/c000s0000",
      "transcriptChunkId": "chunk-main",
      "itemId": "submission item UUID",
      "clusterId": null
    }
  ],
  "candidateMappings": [
    {
      "recommendationId": "rec_0",
      "title": "사람이 준비한 검토용 후보 표시명",
      "sourceRecommendationSha256": "88b7c0cde3192f97dd3eb657a554170a4068eb225f78b05a3ff566e652e67705",
      "minorityMappings": [
        {
          "index": 0,
          "minorityId": "minority-cost",
          "title": "사람이 준비한 소수 우려 표시명",
          "sourceTextSha256": "be4ed6b8ed40828ead890e204a37cdd8f27497f377ce67d841c9bbda36424621",
          "citedUids": ["소수 우려 근거 source UID"]
        }
      ]
    }
  ]
}
```

실행:

```powershell
cd automation
npm.cmd run plan:platform-analysis-import -- --analysis 'C:\approved\analysis.json' --provenance-map 'C:\approved\provenance.json' --output 'C:\approved\import-plan.json'
```

생성된 계획을 같은 원본 두 파일로 다시 검증:

```powershell
npm.cmd run plan:platform-analysis-import -- --verify-plan 'C:\approved\import-plan.json' --analysis 'C:\approved\analysis.json' --provenance-map 'C:\approved\provenance.json'
```

- 출력은 항상 `dryRun: true`, `databaseMutationExecuted: false`, `requiresHumanReview: true`다.
- import plan schema version 2 출력은 analysis·provenance map 원본 파일의 정확한 바이트 SHA-256과 canonical plan self-checksum을 포함한다. provenance map은 기존 구조의 schema version 1과 분석코어 호환 overlay가 있는 schema version 2를 지원한다. `--verify-plan`은 로컬 파일 3개만 읽어 입력 해시와 self-checksum을 확인하고, 같은 입력으로 계획을 다시 만들어 전체 canonical 내용이 일치하는지 검사한다.
- raw `--analysis`, `--provenance-map`과 검수 전 `--verify-plan`은 symlink/junction을 실제 경로로 해석한 뒤 repository 밖의 기존 일반 파일만 읽는다. `--output`도 실제 상위 경로가 repository 밖이어야 하며 repository·`public/`·Git 안에는 시민 분석 산출, 매핑 ID, 검수 전 plan을 두지 않는다. 기존 출력을 `--force`로 교체할 때는 symlink나 hard-link가 아닌 외부 단일-link 일반 파일만 허용하고 새 파일은 사용자 전용 모드로 생성한다.
- `--analysis`, `--provenance-map`, `--verify-plan` JSON은 각각 비어 있지 않은 16MiB 이하 파일이어야 한다. CLI는 읽기 전 파일 크기와 읽은 뒤 byte 수를 모두 대조해 oversized 입력과 읽는 중 byte 수가 바뀐 입력을 JSON parse 전에 거부한다. 새 plan도 직렬화 결과가 16MiB를 넘으면 파일을 쓰기 전에 중단해 CLI가 만든 plan을 같은 검증 모드가 읽을 수 있게 보장한다. 같은 `--analysis|--provenance-map|--verify-plan|--output` 또는 `--force`를 두 번 주면 마지막 값을 선택하지 않고 중복 argument로 중단한다.
- 이 해시들은 오래되거나 서로 맞지 않는 입력, 우발적인 파일 변경을 탐지하기 위한 내부 일관성 증거다. 해시와 계획이 같은 수정 가능한 파일에 있고 외부 secret·서명이 없으므로 작성자 진위, 외부 시점 증명 또는 의도적 재생성에 대한 tamper-evident 증거가 아니다.
- 모든 후보는 `origin: ai`, `reviewStatus: draft`이며 원문 인용이 하나 이상 있어야 한다. 각 인용의 source UID·transcript chunk ID·submission item UUID·cluster UUID를 provenance에 함께 남긴다.
- schema version 2에서는 모든 source mapping에 실제 transcript chunk ID가 있어야 하고, candidate mapping은 원 recommendation canonical JSON SHA-256에 결속된다. source UID를 transcript chunk ID로 대체 추정하지 않는다.
- source UID 매핑 누락·중복, 후보 ID 중복, 허용되지 않은 stance/frequency, reviewed/decision 주장, 빈 후보 집합, 빈 문자열 소수의견, candidate mapping 누락·중복·미사용 index, recommendation·소수의견 원문 SHA-256 불일치는 파일 생성 전에 실패한다. provenance root는 schema v1의 `schemaVersion|topicId|sourceMappings`와 v2의 동일 필드+`candidateMappings`만 허용하며, source·candidate·minority mapping도 문서화된 필드 외 값을 거부한다. 따라서 `clusterID` 같은 오타나 내부 메모가 조용히 무시되지 않는다. 두 원문 해시는 오래된 overlay가 변경된 recommendation 또는 같은 index의 다른 소수의견에 잘못 결합되는 것을 막는다.
- 기존 출력 파일은 기본적으로 덮어쓰지 않는다. 검토 후 의도적으로 교체할 때만 `--force`를 사용한다.
- 이 명령은 Supabase client, service role key, 환경변수 또는 DB RPC를 사용하지 않는다. 실제 적재는 8/29 산출물과 사용자 승인을 받은 별도 단계다.

## Canvas ontology review bridge

`canvas-ontology-bridge.mjs`는 `cv_snapshot_now`로 보존된 snapshot JSON의
`payload.agenda`·`payload.agenda_link`를 DB에 쓰지 않고 온톨로지 검수 계획으로 변환한다.
일반 의제 카드를 `Issue`·`Claim`·`Proposal` 등으로 자동 단정하지 않으며,
action→parent와 일반 연결도 사람이 관계 종류를 고르기 전에는 `relation: null`이다.

검수 계획 생성:

```powershell
cd automation
npm.cmd run bridge:canvas-ontology -- --snapshot 'C:\approved\snapshot_42.json' --output-plan 'C:\approved\canvas-review-plan.json'
```

같은 snapshot 원본으로 계획의 exact-byte hash와 canonical self-checksum 재검증:

```powershell
npm.cmd run bridge:canvas-ontology -- --snapshot 'C:\approved\snapshot_42.json' --verify-plan 'C:\approved\canvas-review-plan.json'
```

M3 DB 적재 전에 검수 큐 행 형상만 만드는 local seed dry-run:

```powershell
npm.cmd run bridge:canvas-ontology -- --snapshot 'C:\approved\snapshot_42.json' --seed-plan 'C:\approved\canvas-review-plan.json' --output-seed 'C:\approved\ontology-review-seed.json'
```

생성된 seed를 같은 snapshot·plan에서 다시 만들 수 있는지와 canonical self-checksum을 확인:

```powershell
npm.cmd run bridge:canvas-ontology -- --snapshot 'C:\approved\snapshot_42.json' --seed-plan 'C:\approved\canvas-review-plan.json' --verify-seed 'C:\approved\ontology-review-seed.json'
```

- seed mode는 먼저 같은 snapshot으로 plan checksum과 source 재구성을 검증한다. 변조되거나 다른
  snapshot의 plan이면 출력 파일을 만들지 않는다.
- batch 후보 source는 `sourceKind: canvas_snapshot`, `sourceUid: canvas-snapshot:<snapshotId>`,
  `snapshotSha256`으로 고정해 승인 후 같은 source의 중복 적재를 식별할 수 있게 한다.
- node/relation/cluster를 `sourceUid`, nullable `transcriptChunkId`, node kind/label, relation type,
  cited UID 목록, moderator-only metadata, review status, reviewer/timestamp 필드로 정규화한다.
- source가 kind·relation·검수 결과를 선결정한 plan은 거부하며 모든 seed item은 `proposed`로 시작한다.
- 보관 의제와 비활성 endpoint 관계는 queue item으로 만들지 않고 `excluded` provenance에 보존한다.
- 결과는 `dryRun:true`, `databaseMutationExecuted:false`, `requiresApproval:true`, contract `draft`다.
  DB table/RLS/RPC 초안과 승인·rollback 경계는 `docs/platform/ONTOLOGY_REVIEW_QUEUE_CONTRACT.md`가
  정본이며 migration은 아직 만들거나 적용하지 않았다.
- seed self-checksum과 `--verify-seed`는 우발 변경과 source plan 불일치를 탐지한다. 같은 seed와
  checksum을 함께 의도적으로 다시 만든 경우, 작성자 진위, 외부 시점 또는 승인자 인증은 증명하지 않는다.

검수자는 계획 JSON에서 다음 결정 필드만 수정한다.

- node: `kind`, `label`, `text`, `reviewStatus`, `reviewer`, `reviewedAt`
- relation: `relation`, `reviewStatus`, `reviewer`, `reviewedAt`
- cluster: `reviewStatus`, `issueNodeId`, `reviewer`, `reviewedAt`

직접 JSON을 편집하는 대신 로컬 검수 작업대를 사용할 수 있다.

1. 위 명령으로 sealed `canvas-review-plan.json`과 그 plan을 만든 원 `snapshot_42.json`을 준비한다.
2. `/ko/moderator/ontology-review/`를 열어 두 파일을 각각 선택한다.
3. 화면에 표시된 `auth-user:<Supabase 사용자 UUID>` 인증 검수자 ID를 확인하고 `로컬 검수 시작`을 누른다.
4. node를 먼저 판단하고, 승인된 `Issue` node를 대표로 골라 relation과 cluster까지 모두 판단한다.
5. `검수 완료 plan 다운로드`로 reviewed plan을 내려받은 뒤 아래 `--reviewed-plan` 명령으로 다시 검증한다.

이 화면은 파일을 브라우저 메모리에서만 처리하고 browser storage, Supabase, 공개 graph에 쓰지 않는다.
화면은 Supabase Auth 세션이 있어야 마이크·파일·검수 작업대를 마운트하고 로그아웃 시 로컬 state를 폐기한다. 세 검수 흐름의 reviewer는 현재 세션 사용자 UUID에서 canonical `auth-user:<lowercase uuid>`로 파생되며 이메일은 내보내지 않는다. 작업대의 결정 함수와 다운로드 exporter도 같은 형식만 허용하고 임의 역할 alias나 변조된 reviewer를 fail-closed한다. 유효한 UUID를 얻지 못하면 작업대를 열지 않는다. `noindex`와 운영 메뉴 자체는 접근통제가 아니며, 다운로드 파일은 외부 서명된 신원 증명이 아니므로 승인된 운영 계정과 장치만 사용한다. plan self-checksum은 우발 변경 탐지용이며 작성자 인증이나 외부 서명을 제공하지 않는다.

node는 `accepted`, `edited`(label/text 수정), 또는 `rejected`, relation과 cluster는 `accepted` 또는 `rejected`로 끝나야 한다. 수정된 node는 반드시 `edited`를 사용한다. 승인 node는 허용된 온톨로지 kind,
승인 relation은 허용된 관계와 승인된 양 끝 node를 가져야 한다. cluster 승인은 같은 group의
승인된 `Issue` node를 지정해야 한다. 보관 의제와 보관 endpoint를 가진 연결은 조용히 삭제하지
않고 계획의 `excluded`에 사유와 원 ID를 남긴다.

사람 검수가 끝난 계획을 현재 workshop graph JSON 스키마의 내부 export로 변환:

```powershell
npm.cmd run bridge:canvas-ontology -- --snapshot 'C:\approved\snapshot_42.json' --reviewed-plan 'C:\approved\canvas-review-plan.json' --output-graph 'C:\approved\canvas-reviewed-graph.json'
```

- 출력 node는 `review_state: accepted|edited`, `is_public: false`이고 원 snapshot·agenda ID와 원문 hash, 수정 여부를 `cited`와 `meta`에 보존한다.
- 출력 meta는 `publication_status: internal_reviewed_export`, `requires_publication_review: true`다.
- CLI는 저장소 `public` 아래 어디에도 직접 쓰는 것을 거부한다. 공개 반영은 별도 사람 검토와 승인 절차다.
- 검수 결정 필드를 편집하면 최초 plan self-checksum은 의도대로 달라진다. reviewed export는 같은 snapshot의 exact-byte hash를 확인한 뒤, 편집 불가 source 부분을 snapshot에서 재구성해 전부 대조하고 허용된 검수 필드만 소비한다.
- self-checksum은 우발 변경 탐지용이며 외부 서명·작성자 진위를 제공하지 않는다. 웹 작업대에서 내려받은 reviewer는 현재 Supabase Auth 사용자 UUID에서 파생한 canonical `auth-user:<lowercase uuid>`이며 이메일·시민 실명·연락처를 기록하지 않는다. reviewed-plan CLI도 이 형식만 허용하지만 임의 파일의 UUID가 실제 계정 소유자에게 속한다는 진위를 독립 검증하는 것은 아니다.
- 명령은 Supabase/API/환경변수에 접근하지 않으며 `databaseMutationExecuted: false`, `publicGraphWritten: false`를 유지한다.

## M5 workshop graph 읽기 어댑터

`/workshop-graph/`는 `public/workshop-graph/sources.json`의 정적 source를 항상 정본 fallback으로 먼저 읽는다.
승인된 공개 graph snapshot API가 마련된 뒤에만 manifest에 다음 선택 항목을 추가한다.

```json
{
  "database": {
    "endpoint": "https://approved.example/rest/v1/rpc/approved_graph_snapshots"
  }
}
```

endpoint는 공개 읽기 전용이어야 하며 URL query, 응답, 브라우저 저장소에 service-role key·개인 token을 넣지 않는다.
응답 계약은 다음과 같다.

```json
{
  "sources": [
    {
      "id": "immutable-snapshot-id",
      "label": "사람 검수 완료 snapshot",
      "review_state": "approved",
      "is_public": true,
      "row_count": 1,
      "snapshot": {
        "elements": { "nodes": [], "edges": [] },
        "meta": {}
      }
    }
  ]
}
```

- `review_state=approved`이면서 `is_public=true`인 row만 `DB` source로 dropdown에 추가한다.
- DB catalog 요청은 20초 timeout과 1회 retry를 사용한다. 양의 정수 `row_count`, 허용 node 역할, 비어 있지 않은 node label·edge relation, 고유 node/edge ID 또는 존재하는 endpoint 계약을 위반하면 로그를 남기고 DB catalog 전체를 거부한 뒤 정적 source만 유지한다. DB node는 모두 `is_public=true`와 사람 검수 상태(`accepted` 또는 `edited`)여야 한다.
- endpoint는 same-origin 상대경로 또는 HTTPS만 허용한다. query·credential·fragment가 있거나 평문 HTTP인 URL은 adapter가 네트워크 요청 전에 거부한다.
- 선택 source는 실제 node/edge 수를 다시 세고 DB source에는 `row_count`도 표시한다. node의 `cited`와 `cited_uids`에 공백이 아닌 출처 ID가 없으면 화면 advisory와 footer에 누락 건수를 표시한다.
- source 전환·즉시 갱신은 기존 polling을 먼저 중단하고 generation guard로 늦은 응답을 폐기한다. 자동갱신은 이전 요청 완료 뒤 다음 회차를 예약해 요청이 겹치지 않는다. 최신 요청 실패는 console error와 live 안내로 노출하고, 마지막 정상 source의 선택값·URL·그래프와 기존 live polling을 복구한다.
- 현재는 승인 graph snapshot RPC/table과 공개 RLS 계약이 없으므로 `sources.json`에 `database.endpoint`를 설정하지 않았다. 정적 fallback만 활성 상태이며 DB endpoint·RLS·schema 생성은 별도 사용자 승인 대상이다.

## A2 activation bundle dry-run

production 적용 전에 exact SQL과 실행 순서가 drift하지 않았는지 다음 manifest로 확인한다.

```powershell
cd automation
npm.cmd run plan:platform-a2-activation -- --output ..\evaluation\platform-a2-activation-bundle.candidate.json
npm.cmd run verify:platform-a2-activation -- ..\evaluation\platform-a2-activation-bundle.json
```

- prerequisite 3개, activation 6단계, rollback 4단계의 순서와 source byte hash를 전체 재구성해 검증한다.
- 출력은 dry-run 승인 자료이며 DB/API/credential을 사용하지 않는다. 실제 apply·Auth/membership·GRANT·traffic open은 수행하지 않는다.
- tracked manifest만 고쳐 checksum을 다시 계산해도 현재 source와 다르면 실패한다. manifest와 builder는 A2 ready evidence의 clean source 범위에도 포함된다.
- 생성기는 기존 파일을 기본적으로 덮어쓰지 않는다. candidate diff 승인 뒤에만 `--force`로 추적 manifest를 교체한다.
- 자세한 단계와 승인 경계는 `docs/platform/PROVISIONING.md` §1-2를 따른다.

## A3 organization access provisioning plan

기관 접근 화면에서 내려받은 민감 계획은 저장소 밖 승인된 로컬 폴더에서만 다음과 같이 변환·검증한다.

```powershell
cd automation
$source = Join-Path $env:LOCALAPPDATA 'climate-assembly-private\organization-access-plan.json'
$plan = Join-Path $env:LOCALAPPDATA 'climate-assembly-private\organization-access-provisioning-plan.json'
npm.cmd run plan:platform-access-provisioning -- --source $source --output $plan
npm.cmd run verify:platform-access-provisioning -- $plan --source $source
```

- provisioning plan schema v2는 shared `access-plan-contract.json`의 schema와 canonical SHA-256을 결속하며, exact source byte hash, canonical checksum과 현재 contract·source 기반 전체 재생성 비교를 모두 통과해야 한다. 브라우저 source plan은 contract schema v1을 유지한다.
- contract identity가 없던 provisioning plan schema v1이나 checksum을 다시 계산한 contract digest 위조본은 거부한다. 과거 plan은 같은 source file로 다시 생성해야 한다.
- 출력은 stable operation ID와 lookup-before-mutation·stop-on-failure·audit receipt·partial-success reconciliation·15분 HMAC 승인 요구를 기록하는 dry-run이다.
- 이 도구는 DB·Auth·메일·credential을 읽거나 변경하지 않는다. 계획 파일에는 이메일·Auth UUID가 있으므로 저장소, `evaluation/`, `public/`, 브라우저 저장소와 일반 로그에 복사하지 않는다.
- Executor core는 승인 integrity·stable lookup·순차 apply·response-loss reconciliation·첫 실패 중단·비식별 receipt persistence를 실행 테스트한다. Receipt도 같은 trusted key로 서명하며 verifier가 HMAC·plan checksum·시간·상태별 count를 fail-closed 확인한다. 승인 key는 GitHub secret만을 유일한 보관처로 삼지 않고 key ID별 외부 보안 저장소에 보존해야 한다.
- Execution adapter는 `appendOnlyReceiptPersistence:true`, `readReceipt(runId)`, `appendReceipt(receipt)`를 모두 제공해야 한다. Core는 같은 run의 exact HMAC receipt를 operation 전에 복구하고, 신규 receipt도 append 뒤 read-back이 생성본과 일치할 때만 반환한다. terminal 저장본은 원 approval integrity를 검증해 실행 창 만료 뒤에도 mutation 없이 복구할 수 있지만 저장본이 없으면 current-time freshness를 다시 요구한다. append 응답 유실은 read-back으로 복구하지만 누락·위조·run/approval 불일치는 실패한다.
- `platform-access-provisioning-durable-store.mjs`는 repository 밖의 기존 빈 절대경로에서만 초기화하는 local rehearsal receipt adapter다. Exact marker·owned `receipts/`·HMAC 검증·hard-link 원자 게시로 restart recovery와 append conflict 원본 보존을 검증하며 relative/internal/nonempty 경로와 symlink/junction 탈출을 거부한다. Supabase·Auth·메일·credential을 사용하지 않으며 production adapter로 주입하면 안 된다.
- A4 inventory checkpoint는 rehearsal store와 repository 밖의 별도 빈 절대경로에 local anchor store를 초기화한 뒤 `persistLocalDesignProvisioningRehearsalStoreCheckpoint()`로 게시한다. Adapter는 생성시각 해시별 immutable hard-link record를 append하고 같은 checkpoint를 다시 읽어 canonical 일치를 확인한다. 저장 뒤 응답 유실은 read-back으로 복구하고 동일 생성시각 conflict·record 변조·marker/layout drift는 실패한다. 이 로컬 분리 저장소는 운영 외부 durable anchor나 독립 timestamp authority가 아니다.
- A4 production-bound lifecycle adapter는 `revisionedLiveAuthorization:true`와 SHA-256 revision을 snapshot·claim/finalize 응답에 제공해야 한다. Claim은 `authorizationRevision`을 보존하고 이후 모든 execution/reconciliation/receipt/finalize 경계가 같은 revision을 요구한다. Active→inactive→active ABA도 새 revision이면 중단한다. In-memory provider와 key-registry 결합 wrapper는 contract rehearsal일 뿐 실제 membership row-version transaction adapter가 아니다.
- Production-bound execution/reconciliation adapter는 각각 `revisionFencedExecution:true`, `revisionFencedReconciliation:true`를 선언하고 core가 전달한 exact authorization fence의 revision을 응답에 그대로 되돌려야 한다. Wrapper는 capability 누락을 authorization·receipt·key read 전에 차단하고 revision mismatch면 claim을 열린 상태로 둔다. 휴면 A4 migration 초안에는 Auth 사용자·기관과 active `org_admin|hq` membership/org row version을 SHA-256으로 만든 helper, exact fence를 받는 mutation 3-인자·reconciliation 2-인자 overload, authorization 행 transaction lock과 revision echo가 있다. `platform-design-provisioning-supabase-adapter.mjs`는 이미 인증된 client를 주입받아 이 두 overload만 exact 인자로 호출하고 20초 timeout·무재시도·revision echo·오류 비노출을 강제하는 비활성 adapter 초안이다. 실제 Supabase JS client를 custom fetch에 연결한 fixture도 `/rest/v1/rpc/*`, `Content-Profile: climate_vote`, exact POST body·abort signal과 HTTP 503 단일 호출을 확인하지만 외부 네트워크·DB·실제 credential은 사용하지 않는다. client 생성·환경 credential read·Auth/CAS/receipt/key adapter·GRANT·실행 wiring은 없으며 세 SQL 함수도 모든 runtime role에서 revoke 상태다. 이 row-version revision은 짧은 live fence이지 restore 뒤 보존되는 감사 ID가 아니다.
- 같은 revision 왕복에 성공한 경우에만 receipt에 `authorizationRevision`을 HMAC 결속한다. Production-bound 복구는 현재 authorization snapshot/claim과 receipt revision이 같아야 하며 legacy 또는 다른 revision receipt는 terminal finalize하지 않는다. Legacy receipt는 저수준 회귀 호환용이고 production evidence가 아니다.
- production Supabase Auth/authorization·receipt·key adapter와 CLI는 미연결이다. 특히 invitation의 안정 idempotency key/ledger, 메일 provider, production-grade 외부 append-only receipt 저장소가 별도 승인·검증되기 전에는 core를 production에 연결하거나 사람이 plan을 수동 SQL/API 작업 목록으로 사용해서도 안 된다.

## A5 자동 Chromium 접근성 증거

사용자 도메인 재검증은 실제 배포가 성공한 checkout에서 실행한다.

```powershell
cd automation
$env:PLATFORM_A11Y_BASE_URL='https://climate-assembly.org'
$env:PLATFORM_A11Y_REPORT='..\evaluation\platform-accessibility-audit.json'
npm.cmd run audit:platform-accessibility
```

- 보고서는 실제 `git rev-parse HEAD`의 전체 commit을 감사기·UI `sourceCommit`으로 기록한다. 감사 대상 소스 경로에 미커밋 변경이 있거나 GitHub Actions의 `GITHUB_SHA`가 실제 checkout과 다르면 감사 전에 실패한다.
- 정상 `npm run build`의 postbuild는 Cloudflare `CF_PAGES_COMMIT_SHA`, GitHub `GITHUB_SHA`, 로컬 checkout 순서로 전체 commit을 해석해 배포 artifact의 `/deployment-revision.json`에 exact-field manifest를 생성한다. 감사기는 같은 origin의 최종 URL·JSON MIME·256 byte 상한·schema·전체 SHA를 확인하고 checkout과 정확히 같을 때만 `targetRevision.status:verified`를 기록한다. endpoint 누락·redirect·캐시 오염·schema drift·SHA 불일치는 브라우저 감사 전에 실패한다.
- `/deployment-revision.json`은 `no-store`이며 시민 데이터·환경값·branch 이름을 포함하지 않는다. 이 manifest는 현재 정적 artifact의 source commit을 증명하지만 Cloudflare 계정 소유권, 독립 timestamp 또는 실제 스크린리더 평가를 대신하지 않는다.
- 로그인 진입·로그인 실패·인증 셸·접근성 성명·미공개/공개 결과·온톨로지 검수 7개 경로를 데스크톱·모바일로 나눠 HTTP 상태, axe 자동 규칙, 건너뛰기 링크 포커스, 콘텐츠 폭과 내부 표 키보드 스크롤을 검사한다. 로그인 진입 경로는 합성 값을 채운 뒤 이메일→비밀번호→로그인→접근성 링크의 순방향·역방향 실제 Tab 순서와 양 끝 포커스 탈출을 확인하고, 각 컨트롤의 계산된 포커스 외곽선이 2px 이상이며 인접 불투명 배경과 3:1 이상 대비되는지도 기록한다.
- 인증 셸과 공개 결과의 데이터는 production 컴포넌트에 격리된 읽기 fixture를 주입한다. 따라서 이 결과는 배포된 UI 코드의 자동 회귀 증거이며 실제 운영 계정·공개 토큰이나 수동 보조기술 평가를 대신하지 않는다.

## A5 수동 보조기술 평가 증거

자동 axe/Chromium 감사는 스크린리더와 실제 모바일 보조기기 평가를 대체하지 않는다.
추적 파일 `evaluation/platform-accessibility-manual-evaluation.json`은 데스크톱·모바일 프로필과
로그인·인증 셸·접근성 성명·미공개 결과·공개 결과·온톨로지 검수와 KWCAG 표면 간 공통 검수의
14개 케이스, 82개 필수 검사를 정의한다.
초기값은 모두 `not_run`이며 전체 상태는 `needs_review`다. 이 파일은 품질인증 완료 증거가 아니다.

평가자는 각 실행 케이스에 다음을 기록한다.

- 프로필의 보조기술·브라우저·운영체제 이름과 버전, 기기
- 평가자 실명 대신 승인된 역할 ID 또는 비식별 별칭과 ISO 8601 UTC 형식의 평가 시각. 평가 시각은 템플릿 생성시각보다 빠르거나 검증 시각보다 미래일 수 없다.
- 각 검사의 `pass`, `fail`, `blocked`, `not_run` 상태
- 실행한 모든 `pass`, `fail`, `blocked` 검사에 실제 관찰 설명. 공개 결과 토큰·참여 코드·개인정보는 기록하지 않는다.

검증 명령:

```powershell
cd automation
npm.cmd run audit:platform-accessibility-manual -- --verify ../evaluation/platform-accessibility-manual-evaluation.json --expected-base-url https://climate-assembly.org --repo-root ..
```

검증기는 누락·중복 케이스, 필수 검사 누락, 실행 환경 정보 누락, 설명 없는 실패를 거부한다.
한 건이라도 `fail`이면 종료 코드 1, `blocked` 또는 `not_run`이 남으면 종료 코드 0과
`needs_review`, 모든 필수 검사가 통과해야만 `pass`를 출력한다. CI는 추적 파일의 구조와
판정 일관성을 확인하지만 실제 사람 평가를 대신하지 않는다. 새 템플릿 생성은 기존 평가 기록을
기본적으로 덮어쓰지 않는다. 별도 경로에서 생성해 사람이 diff를 확인하고 백업한 경우에만
명시적 `--force`를 사용한다. `pass` 증거는 기록된 커밋이 현재 HEAD의 조상이고 그 이후 접근성
대상 소스가 바뀌지 않았으며 현재 checkout에도 staged·unstaged·untracked 대상 변경이 없을 때만
유효하다. 페이지 공통 구조를 바꾸는 `src/layouts`도 대상 소스에 포함한다. 승인된 사용자 도메인과
다르거나 대상 소스가 바뀌면 CI가 stale 증거를 거부하므로 해당 clean commit을 기준으로 수동평가를
다시 수행한다.

## R0 전사 fixture → 내부 온톨로지 graph

실제 음성·원문 전사·개인정보·DB를 사용하기 전에, 비식별 synthetic fixture로 시간 구간과 사람이 검수한 온톨로지 후보의 연결을 확인한다.

```powershell
cd automation
npm.cmd run bridge:transcript-ontology -- --fixture fixtures/transcript-ontology-reviewed.example.json --output-graph ../evaluation/transcript-ontology-r0-graph.json
npm.cmd run bridge:transcript-ontology -- --fixture fixtures/transcript-ontology-reviewed.example.json --verify-graph ../evaluation/transcript-ontology-r0-graph.json
```

- chunk에는 stable opaque UID, millisecond time range, `speaker-a` 같은 짧은 synthetic 화자 표기 또는 화자 미식별을 뜻하는 정확한 `speaker-unknown`, text가 필요하다. 실제 이름·전화번호·계정은 허용하지 않는다.
- node/relation 후보는 허용된 온톨로지 vocabulary와 존재하는 chunk UID를 인용해야 한다. 관계 endpoint도 같은 fixture의 node 후보여야 한다.
- 출력 ID는 후보 UID에서 결정적으로 생성되며 현재 workshop graph의 `elements.nodes`/`elements.edges` 형식과 `cited`/`cited_uids` 역추적 계약을 따른다.
- `reviewedBy`는 개인 이름이 아닌 `moderator-fixture`, `reviewer-test` 같은 R0 synthetic 역할 alias만 허용한다.
- graph source에는 전체 fixture canonical SHA-256을 넣고 verifier는 fixture에서 graph 전체를 다시 만들어 비교한다. 출력은 source 변경 검출을 위한 self-contained 재현성 점검이며 외부 서명·작성자 진위 증거가 아니다.
- CLI는 기존 파일을 덮어쓰지 않고 저장소 `public` 아래 출력을 거부한다. 생성물은 `is_public:false`이고 별도 공개 검토가 필요하다.
- 실제 마이크/STT, 원문 보관, 브라우저 공개, API/DB 쓰기, retention 정책과 사람 reviewer 인증은 R0 범위 밖이며 별도 승인 뒤 진행한다.

## R1 합성 검수 fixture → 공개 live graph

실제 회의 데이터 없이 현재 graph source adapter와 polling UI를 검증하려면 별도 publication metadata가 있는 synthetic fixture만 공개 live graph로 생성한다.

```powershell
cd automation
npm.cmd run bridge:transcript-ontology -- --fixture fixtures/transcript-ontology-live-reviewed.example.json --output-live-graph ../public/workshop-graph/data/live-transcript-reviewed-fixture.json
npm.cmd run bridge:transcript-ontology -- --fixture fixtures/transcript-ontology-live-reviewed.example.json --verify-live-graph ../public/workshop-graph/data/live-transcript-reviewed-fixture.json
```

- publication mode는 정확히 `synthetic-reviewed-demo`여야 하고 역할형 `approvedBy`와 검수 이후 canonical `approvedAt`이 필요하다.
- 공개 출력은 실제 경로 기준 `public/workshop-graph/data/live-*.json`만 허용하며 기존 파일을 덮어쓰지 않는다.
- 생성 graph는 검수·공개 승인된 node/edge와 chunk UID 인용만 포함한다. time-coded chunk table, 화자 pseudonym, 시작·종료 시각은 공개 payload에 넣지 않는다.
- `sources.json`의 `live-transcript-reviewed-fixture`는 15초 기본 polling source다. adapter는 재요청마다 cache-busting URL을 만들고, 화면은 합성 데모를 미검수 시민 발언으로 표시하지 않는다.
- 이는 synthetic 정적 JSON polling prototype이다. 실제 음성/STT, 실제 시민 발언, reviewer 계정 인증, 자동 publication, API/DB 쓰기와 retention 정책은 구현하거나 승인하지 않았다.

## R2 합성 전사 후보 → 비공개 moderator 검수 plan

`/ko/moderator/ontology-review`의 `전사 ontology 후보 검수` 영역은 R2 전용 fixture 또는 R4 검수 batch에 결속된 provider-neutral 후보를 브라우저 메모리에서만 열어 node/relation 후보를 검수한다.

- 입력 예제는 `automation/fixtures/transcript-ontology-review-candidates.example.json`이다. R0와 같은 time-coded chunk·opaque UID·synthetic speaker·역할형 fixture reviewer·허용 ontology vocabulary를 다시 fail-closed 검증한다.
- R4 연결 입력은 `private-transcript-review-batch` 원문 bytes와 `private-transcript-ontology-candidates` JSON 두 파일이다. 후보 파일의 `reviewBatchSha256`은 batch exact bytes, capture/session/audio SHA는 batch source와 모두 같아야 하고 후보 언어도 batch 언어와 일치해야 하며 candidate node/relation의 모든 인용은 검수 완료 chunk UID를 가리켜야 한다. batch의 room·language·capture method, Auth reviewer·검수 시각·원 STT provenance는 생성 fixture와 reviewed plan에 보존한다.
- R4 handoff 검증이 끝나면 화면의 `R4 결속 fixture 다운로드`로 생성 당시 exact fixture bytes를 로컬에 보존한다. 이 파일은 R3 CLI의 `--fixture` 입력이며, reviewed plan의 `source.fixtureSha256`과 일치해야 한다. 다운로드는 DB·서버·public graph를 쓰지 않는다.
- candidate node 카드는 인용 전사 구간, speaker pseudonym, millisecond range, Habermas 역할, 표시 이름과 검수 내용을 함께 보여 준다. 선택한 역할에 따라 함께 확인할 진행 질문도 카드 안에 표시되며 역할을 바꾸면 즉시 다시 계산한다. 이 질문은 검수 전 확인을 돕는 비결정 제안이며 moderator가 `후속 확인 요청`을 선택한 경우에만 현재 질문·Auth reviewer·시각을 세션 메모리에 기록한다. relation 카드도 인용 전사와 endpoint, 논증 관계 및 해당 연결의 근거·성립 조건을 묻는 후속 확인 질문을 제공한다.
- node/relation은 각각 승인·수정 승인·반려하거나 `후속 확인 요청`, `나중에 검수`를 선택할 수 있다. node의 `소수 우려로 표시`는 역할을 `Concern`으로 바꾸고 `minorityConcern:true`를 별도 신호로 남기며, 이미 끝낸 node·연결 relation 판단을 무효화해 수정 승인을 다시 요구한다. 해제도 같은 재판단 절차를 거친다. 후속 확인과 보류는 완료 건수로 세지 않고 plan 다운로드·publication approval을 계속 잠근다. 후속 확인 질문은 응답이나 추가 근거를 확인한 뒤 초안을 수정하거나 승인·수정 승인·반려로 재판단해야 해제되며, pending 질문은 완료 reviewed plan이나 공개 graph에 포함하지 않는다. 같은 batch에서 이미 승인·수정 승인한 동일 역할 node에는 `기존 node에 병합`할 수 있다. 병합 결정은 중복 후보의 원 source text·UID·인용을 private plan에 그대로 남기고 대상 ID를 기록한다. 대상 내용을 바꾸거나 병합을 해제하면 관련 병합·relation 판단을 다시 `proposed`로 돌리며, 병합으로 source와 target이 같아지는 relation은 승인할 수 없다. relation 승인은 병합 endpoint를 따라간 두 node가 모두 승인 또는 수정 승인 상태일 때만 허용한다. endpoint node를 후속 확인·보류로 바꾸거나 판단 뒤 입력을 다시 바꾸면 이미 승인했거나 후속 확인 중인 연결 relation도 `proposed`로 되돌려 stale 관계 판단·질문을 내보내지 않는다. 반려 node를 endpoint로 둔 relation 승인은 거부하고, 이미 승인한 relation의 endpoint node 반려도 거부한다.
- 모든 후보를 판단한 경우에만 `transcript-ontology-reviewed-plan`을 로컬 다운로드한다. export는 원 fixture에서 workspace를 다시 만들어 exact SHA-256, 원 chunk 인용, source text, 판단 audit, summary와 safety를 대조한다. plan은 `databaseMutationExecuted:false`, `publicGraphWritten:false`, `requiresPublicationReview:true`를 명시한다.
- 인증 작업대의 `운영자용 graph 초안 보기`는 현재 브라우저 메모리 workspace를 1초마다 다시 읽어 승인·수정 승인 node와 유효한 relation만 표시한다. `merged` source의 인용·source UID는 target에 합치고, 아직 미검수·보류·후속 확인·반려 후보는 부분 graph에서 제외한다. 화면은 항상 `검수 중 초안 · 공개 아님`으로 표시하며 DB·API·public 파일을 쓰지 않는다. 대상 수정으로 판단이 무효화되면 다음 polling에서 해당 node·병합·relation이 즉시 초안에서 빠져야 한다.
- 같은 Auth 세션에서 현재 plan 다운로드가 성공한 뒤에만 `live-*` source ID를 입력해 별도 `transcript-ontology-publication-approval` artifact를 내려받을 수 있다. artifact는 exact canonical plan SHA-256, canonical Auth reviewer ID와 모든 판단 이후 승인 시각을 결속하며, plan·fixture·source ID가 바뀐 비동기 결과는 폐기한다. 이 단계도 브라우저 로컬 다운로드일 뿐 DB나 public graph를 쓰지 않는다.
- 브라우저 verifier는 실제 production 페이지에서 R4 검수 batch를 먼저 내려받고 그 exact SHA에 결속한 provider-neutral 후보를 업로드한 뒤, 원문·역할 표시, node 수정 승인, node/relation 반려와 private plan 직렬화를 실행한다. Canvas 검수 흐름과 별개로 같은 페이지에서 두 기능을 모두 검증한다.
- 같은 Chromium 실행에서 다운로드한 R4 결속 fixture, private plan과 publication approval을 R3 `buildPublishedTranscriptReviewGraph()`에 직접 전달한다. verifier가 fixture exact bytes SHA-256과 plan source를 먼저 결속하고, builder가 세 artifact를 전수 대조해 승인 node만 남긴 graph, 반려·병합 건수, 검수된 `Concern`의 `minority_concern` 신호, 신원 종류 비식별화와 raw 전사 시각·speaker 비노출을 모두 만족해야 통과한다. 병합 source의 인용 UID는 target node에 합치고 relation endpoint도 target으로 바꾸되 self-loop는 fail-closed한다. 공개 graph 상세 화면은 소수 우려 신호를 `소수 우려 보존` 배지로 표시한다. graph는 메모리에서만 만들며 public 파일을 쓰지 않는다.
- 실제 시민 발언·음성/STT·DB/API 저장·R3 graph export/publication은 포함하지 않는다. 검수 결정과 private plan exporter는 현재 Supabase Auth 사용자 UUID에서 파생한 canonical reviewer ID만 허용하지만 다운로드 plan의 외부 서명이나 독립 신원 검증은 포함하지 않는다. 이 prototype에 실제 시민 발언 파일을 넣지 않는다.

## R3 검수 plan → 합성 live graph source

R2의 complete reviewed plan을 공개 graph source로 바꾸려면 원 synthetic fixture, reviewed plan, 별도 publication approval 세 파일을 함께 검증한다. 예제는 실제 시민 발언이 아닌 synthetic 데이터다.

```powershell
npm.cmd --prefix automation run bridge:transcript-ontology -- --fixture fixtures/transcript-ontology-review-candidates.example.json --reviewed-plan fixtures/transcript-ontology-reviewed-plan.example.json --publication fixtures/transcript-ontology-publication-approval.example.json --output-reviewed-preview ../evaluation/live-transcript-r2-reviewed.preview.json
npm.cmd --prefix automation run bridge:transcript-ontology -- --fixture 'C:\approved\private-transcript-ontology-fixture-candidate-set.json' --reviewed-plan 'C:\approved\transcript-ontology-reviewed-candidate-set.json' --publication 'C:\approved\transcript-ontology-publication-approval-live-source.json' --output-reviewed-bundle-report '../evaluation/transcript-ontology-reviewed-bundle-report.json'
npm.cmd --prefix automation run bridge:transcript-ontology -- --fixture 'C:\approved\private-transcript-ontology-fixture-candidate-set.json' --reviewed-plan 'C:\approved\transcript-ontology-reviewed-candidate-set.json' --publication 'C:\approved\transcript-ontology-publication-approval-live-source.json' --verify-reviewed-bundle-report '../evaluation/transcript-ontology-reviewed-bundle-report.json'
npm.cmd --prefix automation run bridge:transcript-ontology -- --fixture fixtures/transcript-ontology-review-candidates.example.json --reviewed-plan fixtures/transcript-ontology-reviewed-plan.example.json --publication fixtures/transcript-ontology-publication-approval.example.json --verify-reviewed-preview ../evaluation/live-transcript-r2-reviewed.preview.json
npm.cmd --prefix automation run bridge:transcript-ontology -- --fixture fixtures/transcript-ontology-review-candidates.example.json --reviewed-plan fixtures/transcript-ontology-reviewed-plan.example.json --publication fixtures/transcript-ontology-publication-approval.example.json --reviewed-preview ../evaluation/live-transcript-r2-reviewed.preview.json --output-reviewed-live-graph ../public/workshop-graph/data/live-transcript-r2-reviewed.json
npm.cmd --prefix automation run bridge:transcript-ontology -- --fixture fixtures/transcript-ontology-review-candidates.example.json --reviewed-plan fixtures/transcript-ontology-reviewed-plan.example.json --publication fixtures/transcript-ontology-publication-approval.example.json --verify-reviewed-live-graph ../public/workshop-graph/data/live-transcript-r2-reviewed.json
```

- `--output-reviewed-preview`는 동일 R3 builder의 exact 공개 후보를 `public` 밖에 no-overwrite로 기록하고 결과에 `publicGraphWritten:false`를 남긴다. `--verify-reviewed-preview`가 원 세 파일에서 전체 payload를 재생성해 일치해야 한다. `--output-reviewed-live-graph`는 `--reviewed-preview`를 필수로 받아 다시 검증한 그 payload만 no-overwrite로 승격하며 direct output 우회를 거부한다. preview input/output/verify는 symlink/junction을 포함해 `public` 아래 경로를 거부한다.
- `--output-reviewed-bundle-report`는 R4 결속 fixture·R2 reviewed plan·publication approval의 exact-byte SHA-256, canonical plan SHA-256, source/fixture/session ID, handoff batch/candidate ID, 공개 후보·반려 건수를 비식별 local report로 no-overwrite 기록한다. 세 artifact를 R3 builder로 전수 검증하지만 graph 파일은 만들지 않으며 `databaseMutationExecuted:false`, `publicGraphWritten:false`를 고정한다. `--verify-reviewed-bundle-report`는 현재 세 파일로 report 전체를 다시 계산한다. 두 명령 모두 `public` 경로를 거부하며 reviewer ID·전사 원문을 report/stdout에 싣지 않는다.
- publication approval은 canonical reviewed plan SHA-256, `live-*` source ID, 역할형 승인자와 모든 item 판단 이후 시각을 결속한다. moderator UI가 만든 artifact는 현재 Auth reviewer를 사용하지만 외부 서명이나 다운로드 이후 계정 소유의 독립 검증을 대신하지 않으며, CLI 실행·public 파일 생성은 별도 명시 작업이다.
- exporter는 원 fixture exact-byte SHA-256, node/relation 전체 source UID 집합, 원문·인용·endpoint·판단 상태를 다시 대조한다. `accepted`와 `edited` node를 내보내고, `merged` node는 target에 source UID·인용을 합친 뒤 생략한다. relation endpoint도 target으로 재지정하며 self-loop는 거부한다. rejected·merged·uncited 후보 건수는 각각 graph meta에 남긴다.
- 공개 payload의 `publication`은 `content_mode: reviewed-summary-only`, `raw_transcript_included:false`, `audio_included:false`를 선언하고 모든 node는 `content_mode: reviewed_summary`를 사용한다. public loader는 이 계약이 없거나 node/relation 아래에 raw chunk·transcript·speaker·time range·audio 필드가 있으면 static live와 DB snapshot을 모두 거부한다. 모든 node detail은 검수 요약과 `cited`/`cited_uids` 원 chunk UID만 표시한다.
- `sources.json`의 `live-transcript-r2-reviewed`는 `/workshop-graph/?source=live-transcript-r2-reviewed`에서 로드되며 label과 meta 모두 synthetic 사람 검수 결과임을 표시한다.
- `sources.json`에서 `live-*` 또는 `live` category인 source는 `publicationMode: "reviewed_snapshot"`을 명시해야 한다. 모든 정적 source는 query·fragment·상위 경로가 없는 `data/<file>.json`, 중복 없는 허용 view와 2D 지원을 선언해야 하며, live source는 ID와 정확히 같은 `data/<source-id>.json` 및 양의 정수 polling 간격까지 갖춰야 한다. public source adapter는 node와 relation 모두 `is_public:true` 및 `review_state:accepted|edited`, `source_review_status:reviewed`, `requires_publication_review:false`, manifest와 같은 `source_id`, canonical 승인 시각, 실제 element 건수와 같은 meta counts를 요구한다. 또한 각 live node·relation은 공백·중복이 없는 canonical `cited`/`cited_uids`를 하나 이상 보존해야 하며, 전사 인용이 없는 운영자 생성 항목만 명시적 `moderator_created:true`로 예외를 선언할 수 있다. 하나라도 어긋나면 기존 graph를 새 payload로 교체하지 않고 오류를 표시한다. DB 승인 snapshot도 node와 relation에 같은 공개·검수 상태를 요구한다. 검증을 통과한 일반 `reviewed_snapshot`은 footer·advisory에 `사람 검수 완료 스냅샷`, 상태 pill에 `LIVE · 검수 완료`를 표시한다. `synthetic_reviewed_demo`는 같은 검수 완료 상태를 유지하되 실제 시민 발언이 아닌 합성 데모임을 별도로 표시한다. source 선택 그룹은 두 종류를 포괄하는 `검수 완료 스냅샷`으로 표시한다. live node 상세의 `text`는 사람 검수 요약으로만 표시하고 출처 UID를 함께 제공하며, raw time-coded transcript·음성은 public snapshot에 포함하지 않고 `공개 원문 미포함` 경계를 화면에 명시한다.
- 실제 정적 화면 검증은 `python -m http.server 4323 --bind 127.0.0.1 --directory public`로 public surface를 제공한 뒤 `node automation/verify-workshop-graph-advisory.mjs`를 실행한다. 결과 JSON과 PNG는 `evaluation/2026-08-14-workshop-graph-reviewed-snapshot-browser.*`에 기록되며, reviewed R2 source의 node/relation 상태, reviewed-summary-only 정책, private transcript 필드 부재, manifest mode, served 파일 해시, 합성 reviewed 데모 안내 및 일반 reviewed snapshot의 footer·advisory·pill을 함께 대조한다.
- 이번 R3는 추적 synthetic JSON export다. 검수 결정은 예제 plan의 정확한 legacy synthetic reviewer `moderator-r2-test` 또는 운영 Auth reviewer ID만 허용하고, 공개 승인자는 제한된 synthetic 역할 alias 또는 canonical Auth reviewer ID만 허용한다. 공개 graph에는 두 원시 값을 모두 싣지 않고 각각 `authenticated_user` 또는 `synthetic_fixture` identity kind만 남긴다. 원 승인 artifact에는 승인자가 보존되지만 외부 서명이나 Auth 서버 재조회는 하지 않으므로 실제 계정 소유 진위를 독립 증명하지 않는다. 이는 실제 시민 발언, 자동 publication, DB snapshot adapter/API 쓰기와 retention 정책을 포함하거나 승인한 것이 아니다.

## R4 브라우저 MediaRecorder·테이블 녹음 파일·전사 chunk 검수 proof of concept

`/ko/moderator/ontology-review`의 R4 패널은 명시적 세션 메모리 처리 동의와 회차 ID, 테이블·분과 ID, 전사 언어가 있을 때만 `MediaRecorder`를 시작하거나 로컬 테이블 녹음 파일을 읽는다. 이 단계는 실제 STT provider 연동이 아니라 브라우저 녹음 또는 운영자 파일 선택, provider-neutral 후보 import, 사람 검수 순서를 확인하는 synthetic proof of concept다.

- 녹음 Blob과 선택한 로컬 파일은 현재 페이지의 메모리와 local object URL에만 존재한다. 새 녹음·파일을 가져오거나 동의를 철회하거나 페이지를 닫으면 폐기하며, DB·서버·public 경로·`localStorage`·IndexedDB로 보내거나 보존하지 않는다.
- 테이블 녹음 파일은 브라우저가 `audio/*`로 확인한 비어 있지 않은 256MB 이하 파일만 받는다. 파일명·경로·bytes는 capture/batch에 넣지 않고, 운영자가 확인해 입력한 녹음 시작 시각과 브라우저가 metadata에서 읽은 길이로 종료 시각을 계산한다. metadata 읽기는 20초 안에 끝나야 하며 늦은 파일 결과는 generation guard로 폐기한다.
- 녹음 또는 파일 처리가 끝나면 exact audio SHA-256, MIME type, byte length, 시작·종료 시각과 `sessionId`·`roomId`·`language`·`captureMethod`를 local capture session에 결속한다. `captureMethod`는 브라우저 녹음과 테이블 파일 가져오기를 구분한다. 내려받는 전사 batch에는 음성 bytes/object URL을 포함하지 않는다.
- 선택적인 `private-stt-candidates` schema v2 JSON은 현재 capture ID·session ID·room ID·language·capture method·audio SHA-256·duration과 모두 일치할 때만 기존 local draft를 교체한다. 파일은 1MB 이하이며 exact-key 계약을 사용해 raw audio/object URL/임의 provider metadata를 거부한다. `candidateSetId`와 각 `sourceUid`는 provider-neutral provenance로 schema v2 review batch까지 보존하며 모든 imported chunk는 `proposed`에서 시작한다.
- moderator가 time-coded chunk, speaker pseudonym 또는 `speaker-unknown`, 전사 원문을 수동 입력하고 각 chunk를 승인·수정 승인·반려해야 한다. 화자를 구분할 수 없을 때 UI 기본값은 `speaker-unknown`이며 임의 이름을 추정하지 않는다. 화면 문구를 다시 바꾸면 해당 판단을 `proposed`로 되돌리고 extraction handoff 다운로드를 다시 잠근다.
- 모든 chunk가 결정되고 승인 또는 수정 승인된 chunk가 하나 이상 있을 때만 `private-transcript-review-batch`를 내려받는다. 이 batch는 `localOnly:true`, `extractionExecuted:false`, `requiresExtractionReview:true`이며 candidate extraction을 자동 실행하지 않는다.
- 내려받기 직전 capture source, chunk 순서·시간·화자 가명, 판단 상태·검수자·검수 시각, 원문 보존 규칙과 summary를 실제 chunk에서 다시 검증한다. 캐시된 summary만 바꾸거나 판단 뒤 원문·audit metadata를 바꾼 session은 fail-closed한다.
- 내려받은 batch는 R2 패널에서 provider-neutral ontology 후보와 함께 다시 열 수 있다. 후보 파일은 batch exact-byte SHA-256과 capture/session/audio SHA를 모두 선언하며, 후보 언어는 batch 언어와 같아야 한다. 일치할 때만 room·language·capture method를 포함한 R4 source audit가 R2 handoff와 R3 bundle report까지 보존된다. 이 단계는 extraction provider를 호출하지 않는다.
- 브라우저 verifier는 synthetic MediaRecorder adapter로 동의→녹음→정지를 먼저 검증한 뒤 실제 1초 WAV 파일을 production React 파일 input으로 가져와 metadata·16,044 bytes·SHA-bound capture를 만든다. 이어 현재 audio-bound STT 후보 import→검수 전 차단→수정 승인→재편집 차단→재판단→download를 실행하고 candidate provenance와 write request 0건을 확인한다.
- 실제 시민 발언·지속 저장·외부 STT webhook/provider 호출·provider credential·음성 retention·DB/API·자동 extraction/publication은 구현하거나 승인하지 않았다. 검수 결정과 batch exporter는 현재 Supabase Auth 사용자 UUID에서 파생한 canonical reviewer ID만 허용하지만 다운로드 batch의 외부 서명이나 독립 신원 검증은 포함하지 않는다. 실제 운영 전에는 별도 승인된 consent·보존·삭제·접근 정책이 필요하다.

## R5 검수 온톨로지 기반 진행 제안

`/ko/moderator/ontology-review`의 `진행 질문`은 현재 브라우저 메모리의 사람 검수 결과만 읽어 다음 다섯 검토 지점을 즉시 계산한다.

- `Claim`에 검수된 `Evidence` 연결이 없으면 뒷받침 자료·경험·사례를 물어볼 것을 제안한다.
- `Proposal`에 검수된 `Condition` 연결이 없으면 실행 전제 조건을 물어볼 것을 제안한다.
- `Concern`이 검수된 `Issue`와 연결되지 않으면 소수 우려를 보존한 채 어느 쟁점과 함께 검토할지 제안한다.
- 승인된 근거 군집의 `Evidence` 일부가 `Claim`/`Issue`와 연결되지 않으면 각 근거의 대상과 공통점·차이를 명료화할 것을 제안한다.
- 검수된 두 `Value`가 `opposes` 관계이면 어느 하나를 선택하라고 지시하지 않고 가치 긴장을 함께 이름 붙일 것을 제안한다.

모든 제안은 질문형이며 이유, source session·agenda·node ID, 관련 node ID와 원문을 함께 표시한다. 출처·관련 node 링크는 결정적 fragment를 사용해 같은 페이지의 focusable 검수 카드로 이동하며 중복 node ID는 한 번만 노출한다. 브라우저 verifier는 질문 출처 링크를 실행한 뒤 정확한 node 검수 카드가 포커스를 받는지 확인한다. 미검수·반려 상태는 근거로 쓰지 않고, 질문은 review plan·DB·browser storage·public graph에 저장하지 않는다. 이는 moderator 지원 규칙이며 합의문·진실·우선순위를 자동 결정하지 않는다.

## 알림 레벨 정책

| 레벨 | 상황 | 대응 |
| --- | --- | --- |
| critical | Drive 권한 박탈, schedule.yml 파싱 실패 | 즉시 운영자 개입 |
| warning | 페이지 1~2개 skip, Supabase 1회 실패 | 회고에서 누적 확인 |
| info | smoke OK, finalize 완료 | 채널 기록만 |

snapshot-db는 cumulativeFailures ≥3 시 자동으로 warning → critical 격상.

---

## [B-007] reset 안전 불변식 (2026-06-21 확정)

> 6/14 ~150표 영구 손실 원인 = PITR 미활성 + raw reset. 이 섹션은 같은 사고가 재발하지 않도록
> reset 경로를 **구조적으로** 봉쇄한 결과와, 8/29 admin 재설계의 하드 요구사항을 기록한다.

### 현재 reset 경로 상태 (2026-06-21 조사 완료)

**admin(vote-admin) 페이지**: 6/15에 archive 이동·503 stub 처리됨 — **현재 완전 비활성**.
in-repo에 reset/DELETE/cv_archive_round를 호출하는 활성 코드 경로가 **존재하지 않는다**.

조사 범위:
- `src/pages/`, `src/islands/`, `src/lib/` 전수 grep — reset·DELETE·cv_archive_round 호출 없음
- `automation/` 스크립트 전수 — `cv_snapshot_now` 호출만 존재, archive/reset 없음
- Supabase edge functions 전수(7개): suggest-merges·build-corpus·corpus-search·agenda-knn·build-kb·kb-search·chat — 모두 votes에 쓰기 없음
- Supabase DB 함수: `cv_archive_round`, `cv_snapshot_now`, `set_active` 3개만 존재

### 구조적 가드 (Supabase 권한 확인)

`climate_vote.votes` 테이블 grants (2026-06-21 live 확인):

| 역할 | INSERT | SELECT | UPDATE | DELETE | rolbypassrls |
|------|--------|--------|--------|--------|--------------|
| anon | O | O | — | — | false |
| authenticated | O | O | — | — | false |
| service_role | — | — | — | — | **true** |
| postgres (내부) | O | O | O | O | true |

`cv_archive_round` 함수 속성 (2026-06-21 live 확인):
- `prosecdef = false` → **SECURITY INVOKER** (호출자 권한으로 실행)
- EXECUTE 권한: `authenticated`, `service_role` 만 (anon 없음)

**결론**: `cv_archive_round`가 SECURITY INVOKER이므로, 호출자 역할의 권한이 실제 실행 권한을 결정한다.
- `authenticated` 호출 → votes에 UPDATE 권한 없음 → **내부 UPDATE 실패** → 실질적으로 archive 불가
- `service_role` 호출 → rolbypassrls=true + EXECUTE 보유 → **실제 archive 가능** (자동화 스크립트 경로)

즉, votes를 실제로 아카이브할 수 있는 것은 `service_role` 키를 가진 서버 사이드 스크립트/자동화뿐이다.
브라우저(anon/authenticated)는 votes를 직접 삭제·수정하는 것이 **구조적으로 불가능**하다.

이 함수는 단일 트랜잭션이므로 **snapshot INSERT가 실패하면 votes UPDATE도 자동 롤백** — snapshot 실패 시
reset이 강행되는 경로는 현재 없다.

### 불변식 3개

다음 불변식은 현재 이미 구조적으로 보장되어 있으며, 8/29 admin 재설계 이후에도 반드시 유지해야 한다.

1. **모든 reset은 `cv_archive_round` 경유** — 이 RPC가 유일한 sanctioned reset 경로.
   직접 `DELETE` 또는 `UPDATE archived_at` 쿼리를 admin UI·스크립트·대시보드에서 실행 금지.

2. **snapshot 실패 시 reset 금지** — `cv_archive_round`는 단일 트랜잭션이므로 snapshot INSERT
   실패 → 전체 롤백. 이 동작을 절대 우회하지 말 것(분리 트랜잭션·EXCEPTION 무시 금지).

3. **reset 전 OneDrive export 권장** — `automation/export-snapshots-onedrive.mjs`로 최신
   snapshot을 off-Supabase에 내보낸 후 cv_archive_round 호출. PITR 미활성 상태이므로
   Supabase snapshots 테이블 손상 시 유일한 복구 수단. 같은 이름의 기존 export는 현재
   source row와 byte 단위로 같을 때만 skip한다. 다르면 기존 파일을 덮어쓰지 않고 실패하므로,
   충돌 파일을 임의 삭제하거나 교체하지 말고 원본 DB row와 off-DB 사본을 별도로 조사한다.

### 8/29 admin 재설계 하드 요구사항

admin 기능을 재활성화하기 전에 다음 조건을 **모두** 충족해야 한다:

- [ ] **reset 버튼 → 서버 사이드에서 service_role 키로 cv_archive_round 호출**
  (브라우저에서 직접 RPC 호출 금지 — authenticated는 실제로 votes UPDATE 불가, 혼선 방지)
- [ ] **2단계 확인 다이얼로그** — "라운드 {id}를 아카이브합니다. 되돌릴 수 없습니다. 계속하시겠습니까?"
- [ ] **snapshot 실패 시 UI에서 reset 차단** — cv_archive_round 반환 오류를 catch해 사용자에게
  표시, reset 완료 처리 금지
- [ ] **reset 전 OneDrive export 트리거** — admin UI가 export-snapshots-onedrive 실행 또는
  운영자에게 수동 export 완료 확인을 요구
- [ ] **admin 접근 제어 게이트** — authenticated 역할로도 cv_archive_round EXECUTE 가능하므로
  admin 기능은 인증된 운영자(특정 이메일/역할)만 접근 가능하도록 RLS/미들웨어 게이트 필수
- [ ] **anon/authenticated에 votes DELETE/UPDATE 권한 부여 금지** — 현재 grants 상태 유지
- [ ] **PITR 활성화 확인** — 8/29 이전에 Supabase Pro PITR add-on 활성화 권장 (미활성 시
  이 문서의 불변식 3개가 유일한 복구 수단)

### 알려진 한계 (B-007 범위 밖, 의도적 보류)

- `climate_vote.agenda` UPDATE status='archived' 및 `agenda_link` hard DELETE:
  캔버스(canvas) 운영 기능으로 votes 손실과 무관. snapshot payload에 agenda/agenda_link가
  포함되어 있으므로 cv_archive_round/cv_snapshot_now 실행 후 복구 가능.
  별도 agenda-soft-delete 개선 시 검토.

---

## A7 원문 공개 승인 전 publish plan

현재 공개 `result_get` 캡처, 같은 범위의 `issue_items` 캡처, 운영진의 원문별 공개 결정을 하나의 replace-all 후보 body로 결속할 때만 사용한다.

```powershell
cd automation
npm.cmd run plan:platform-result-sources -- --result <result.json> --issue-items <issue-items.json> --reviews <reviews.json> --output <outside-repository\source-publication-plan.json>
node platform-result-source-plan.mjs --result <result.json> --issue-items <issue-items.json> --reviews <reviews.json> --verify-plan <outside-repository\source-publication-plan.json>
```

`reviews.json`은 모든 연결된 issue/item 쌍에 `reviewed` 또는 `withheld` 결정을 하나씩 가져야 한다. 공개 결정은 원문과 byte 단위로 같은 canonical 발췌, `auth-user:<uuid>` 검수자, `org_admin|hq` 역할, 결과 발행 뒤이면서 관찰 시각 이전인 canonical UTC 시각을 요구한다. 보류 결정의 발췌는 `null`이어야 한다. 일부 결정 누락·중복·알 수 없는 연결·미검수 쟁점·계약 밖 필드는 전체 plan 생성을 차단한다.

인증 `issue-items` capture와 reviewer identity가 있는 `reviews.json`은 모두 repository·`public/`·Git 밖의 기존 일반 파일이어야 한다. CLI는 symlink/junction을 실제 경로로 해석해 repository 안을 가리키는 우회도 읽기 전에 거부한다. publication plan 역시 승인 원문을 포함하므로 repository 밖에만 no-overwrite·사용자 전용 파일 모드로 기록하며 stdout에는 원문이나 검수자 ID를 출력하지 않는다. schema v2 plan은 전체 `atomicResultBody`, 전후 SHA-256, 원문 exact UTF-8 SHA-256, 검수 patch, canonical self-checksum과 입력 재생성 검증에 더해 `source-reference-contract.json`의 schema와 canonical SHA-256을 결속한다. 현재 verifier는 이 identity가 없는 legacy schema v1 또는 self-rechecksummed contract drift를 거부한다. DB·RPC·Drive·public 파일은 쓰지 않으며 실제 `result_publish`, migration, 게시에는 별도 사용자 승인이 필요하다.

`--reviews`가 없는 기존 명령은 원문을 싣지 않는 provenance plan을 계속 생성한다.

---

## A7 이행추적 승인 전 publish plan

현재 공개 `result_get` 캡처와 운영진이 검수한 기관 응답으로 다음 전체 `result_page.body` 후보를 만들 때만 사용한다.

```powershell
cd automation
npm.cmd run plan:platform-implementations -- --result <result.json> --responses <responses.json> --output <plan.json>
node platform-implementation-plan.mjs --result <result.json> --responses <responses.json> --verify-plan <plan.json>
```

plan은 scope·쟁점·상태·HTTPS 근거·역할형 검수자·시각 순서를 검증하고, 갱신하지 않은 쟁점을 포함한 전체 body를 재구성한다. 기존 output을 덮어쓰지 않으며 DB·RPC·Drive·public 파일을 쓰지 않는다. 실제 기관 응답과 plan은 `public/` 또는 Git에 두지 않는다.

schema v2 출력은 `implementation-status-contract.json`의 schema와 canonical SHA-256을 함께 결속하고, 현재 verifier는 identity가 없는 legacy schema v1과 self-rechecksummed contract drift를 거부한다. plan self-checksum은 우발적 변경 탐지용이며 외부 서명, 기관 응답 진위, 검수자 인증, 게시 승인을 증명하지 않는다. 실제 `result_publish` 변경과 이행 데이터 저장 migration은 사용자 승인 전 실행하지 않는다.

---

## 알려진 한계 (B-008a 범위 밖)

- 시민 모바일 디바이스 화면 캡쳐 → B-008b (별도 spec)
- 회의장 전체 영상 (OBS·카메라) → B-008c (별도 spec)
- finalize-report의 `captureSets`·`snapshotCount`는 Drive 실측으로 전환했다. `finalVotes`는 회차별 정본 집계 seam이 없어 의도적으로 `미집계`로 남긴다.
