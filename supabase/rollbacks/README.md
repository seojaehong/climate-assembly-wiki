# supabase/rollbacks/

이 디렉터리에는 **역방향(롤백) SQL 스크립트**만 보관합니다.

## 규칙
- `supabase db push` / Supabase Migration replay 대상 **아님** — 자동 적용되지 않습니다.
- 수동 롤백이 필요할 때만 Supabase SQL Editor 또는 psql로 직접 실행하십시오.
- 파일명은 대응하는 정방향 migration의 타임스탬프와 동일하게 유지합니다.

## 파일 목록

| 파일 | 대응 migration | 설명 |
|------|----------------|------|
| `20260621140534_BEFORE_snapshot_rpc.sql` | `migrations/20260621140534_snapshot_include_agenda.sql` | agenda·tally 키 추가 이전 cv_snapshot_now·cv_archive_round 원상복구 |
| `20260724_BEFORE_mod_console.sql` | `migrations/20260724_mod_console_core.sql` | Part A: team/timer_log 키 추가 이전 cv_snapshot_now 원상복구. Part B(파괴적): team·timer_log·module_state·chat_message 테이블 및 mod_*/hq_teams RPC 전체 drop |
| `platform_p1c_org_selection_BEFORE.sql` | `migrations/platform_p1c_org_selection.sql` | 탭별 기관 선택 컨텍스트·RPC를 제거하고 P1의 다중 소속 차단 함수와 휴면 RLS 정책을 복원 |
| `platform_p1c_org_selection_activation_BEFORE.sql` | `migrations/platform_p1c_org_selection_activation.sql` | 별도 승인으로 활성화한 staff 직접 테이블 권한을 회수하고 P1C 휴면 검증 상태로 복원 |

## 롤백 절차 (예시)

```sql
-- Supabase SQL Editor(project: labor_money / pleyuknjnprsckssxvrh) 에서 실행
-- 파일 내용을 그대로 붙여넣기 → Run
```

> ⚠️ 롤백 후에는 대응 migration을 migrations/ 에서 제거하거나 재적용 여부를 팀과 합의하십시오.
