# B-008a 자동 캡쳐 운영 매뉴얼

> 워크숍 1회당 1회만 쓰는 시스템. 사전 검증이 본 운영 안정성을 결정한다.

## 적용 워크숍

| 일자 | 명칭 | 시간(KST) | round_id |
| --- | --- | --- | --- |
| 2026-07-04 | 7월_행사 | 09:00 ~ 18:00 | 2 |
| 2026-08-29 | 2차_의제선정 | 09:00 ~ 18:00 | 3 |

신규 워크숍 추가 시: `automation/workshop-schedule.yml`의 `workshops:` 배열에 row 추가 + `drive_folder_root`·`supabase_round_id` 채우기 → PR 머지.

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
- `audit` manifest는 GitHub run ID·repository·commit SHA·workflow ref·export 시각·snapshot ID·`keyId`와 `platform` 전체 행을 HMAC-SHA256으로 결속한다. 복구 시 `audit.keyId`에 해당하며 Drive 파일 밖에 보관한 키를 `verifySnapshotArchiveIntegrity()`에 전달해 provenance·payload 서명을 확인한다.
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
Remove-Item Env:SNAPSHOT_AUDIT_HMAC_KEY
```

- 성공 시 snapshot ID·source·key ID·GitHub provenance와 collection별 건수만 JSON으로 출력한다. 제출 원문이나 참여 데이터는 출력하지 않는다.
- HMAC이 다르거나 JSON이 손상됐거나 `platform` source가 아니거나 필수 collection이 빠졌거나 선언 건수와 실제 배열 길이가 다르면 nonzero로 종료한다.
- 필수 collection은 `submission`, `submission_item`, `issue`, `issue_link`, `result_page`, `ballot`, `ballot_item`, `ballot_response`다.
- 이 명령은 archive의 서명·구조·기본 건수 정합성을 읽기 전용으로 확인한다. DB 복원, FK/업무 규칙 전수 검증, 실제 복구 rehearsal, PITR/WAL, 사용자 행위 감사로그를 수행하거나 대체하지 않는다.

## D-30 — `workshop-schedule.yml` 잠금

- `automation/workshop-schedule.yml`에서 `drive_folder_root: REPLACE_WITH_DRIVE_PARENT_ID` placeholder를 실제 ID로 치환
- `supabase_round_id`가 climate_vote.rounds의 실제 round_id와 일치하는지 확인 (현재 7월=2, 8월=3 가정)
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
- [ ] `audit.keyId`로 선택한 Drive 밖의 과거/현재 HMAC 키로 `verifySnapshotArchiveIntegrity()`가 내려받은 JSON에 `true`를 반환하고 run ID·commit SHA가 실행 기록과 일치
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
DRIVE_SA_JSON=$(cat /secure/sa.json) node scripts/verify-drive.mjs <workshop-name> 108
```

결과:
- `status: ok` → 회고에 "108/108 set 캡쳐 성공" 기록 (드물게 over-capture도 ok로 분류됨)
- `status: issue` → `missing` 수 확인 + GHA Actions 탭에서 실패 시간대 분석 → BACKLOG에 회고 항목 추가

## GHA cron drift 캐비엇

GitHub Actions schedules는 트래픽 폭주 시 5~15분 지연될 수 있다. 9h 워크숍 × 12 set/h = 108 expected지만 실제 95~108 사이가 정상 범위다. 5% threshold가 종종 false alarm 낼 수 있으니 issue 발생 시:

1. Actions 탭에서 capture workflow의 실제 발화 간격 확인
2. 누락 set의 timestamp가 연속 구간(>3개 연속)이면 진짜 장애
3. 흩어져 있으면 GHA drift — 회고에 "drift {N분}" 기록하고 다음 워크숍은 cron 빈도 검토

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
   Supabase snapshots 테이블 손상 시 유일한 복구 수단.

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

## 알려진 한계 (B-008a 범위 밖)

- 시민 모바일 디바이스 화면 캡쳐 → B-008b (별도 spec)
- 회의장 전체 영상 (OBS·카메라) → B-008c (별도 spec)
- finalize-report의 captureSets/snapshotCount 실시간 카운트 → 현재 placeholder 0. D+1에 verify-drive로 수동 보완. 다음 iteration에서 finalize-report가 verify-drive를 호출하도록 통합.
