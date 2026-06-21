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

## 롤백 절차 (예시)

```sql
-- Supabase SQL Editor(project: labor_money / pleyuknjnprsckssxvrh) 에서 실행
-- 파일 내용을 그대로 붙여넣기 → Run
```

> ⚠️ 롤백 후에는 대응 migration을 migrations/ 에서 제거하거나 재적용 여부를 팀과 합의하십시오.
