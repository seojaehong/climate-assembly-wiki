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

## D-30 — `workshop-schedule.yml` 잠금

- `automation/workshop-schedule.yml`에서 `drive_folder_root: REPLACE_WITH_DRIVE_PARENT_ID` placeholder를 실제 ID로 치환
- `supabase_round_id`가 climate_vote.rounds의 실제 round_id와 일치하는지 확인 (현재 7월=2, 8월=3 가정)
- PR로 머지 → main에 cron이 발화하기 시작

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

## 알려진 한계 (B-008a 범위 밖)

- 시민 모바일 디바이스 화면 캡쳐 → B-008b (별도 spec)
- 회의장 전체 영상 (OBS·카메라) → B-008c (별도 spec)
- finalize-report의 captureSets/snapshotCount 실시간 카운트 → 현재 placeholder 0. D+1에 verify-drive로 수동 보완. 다음 iteration에서 finalize-report가 verify-drive를 호출하도록 통합.
