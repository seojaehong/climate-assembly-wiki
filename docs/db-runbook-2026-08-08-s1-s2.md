# 8/29 런칭 런북 — S1·S2 시스템 스키마 적용

- 작성: 2026-08-08 · spec: `10_작업산출물/2026-08-08_숙의운영시스템_스키마_spec.md`
- 대상 DB: labor_money (pleyuknjnprsckssxvrh) `climate_vote` 스키마
- 전례 런북: `wiki/docs/db-runbook-2026-07-26.md`

## 순서 (사용자 실행 2단계 + 검증)

### 1. SQL Editor 수동 실행 — 3파일, 각각 통째로 한 번에

Supabase 대시보드 → SQL Editor에서 순서대로:

| # | 파일 | 내용 | 실패 시 |
|---|---|---|---|
| 1 | `supabase/migrations/20260808_s1_assembly_topic_submission.sql` | 위계+산출물+잠금 | `supabase/rollbacks/20260808_BEFORE_s1.sql` |
| 2 | `supabase/migrations/20260808_s2_ballot_multi_agenda.sql` | 다의제 투표 | `supabase/rollbacks/20260808_BEFORE_s2.sql` |
| 3 | `supabase/migrations/20260808_s3_seed_0829.sql` | assembly·backfill·주제 시드(멱등) | 시드만 실패 시 재실행 가능 |
| 4 | `supabase/migrations/20260808_s4_ballot_subgroup.sql` | **분과별 투표 스코프** (ballot.subgroup + RPC 개정) | `supabase/rollbacks/20260808_BEFORE_s4.sql` + S2 RPC 섹션 재실행 |

> S4는 함수 drop→재생성 구간이 있어 **반드시 통째로 실행**. 1~3 적용 후 언제든 단독 적용 가능.

⚠️ **각 파일을 통째로 실행** — 중간에 끊기면 함수가 없는 채로 남는다(7/26 hq_teams 교훈).
⚠️ 3번 시드의 토론 주제 2건은 `[확정 전]` 문안 + `draft` 상태로 심어진다. **세부실행계획 확정 후 prompt UPDATE + `status='open'` 전환**해야 조 콘솔에 노출된다.

### 2. 적용 검증 — anon 키, 코드 배포와 무관하게 즉시 가능

```bash
cd wiki && node scripts/verify-s1-s2.mjs            # 12/12 적용 확인이면 통과
node scripts/verify-s1-s2.mjs --code <실제 join_code>  # topic_list 실데이터까지 보려면
```

판정 규칙(스크립트가 자동 적용): `PGRST202`+`climate_vote.<fn>`=미적용 · 도메인 에러(invalid join code 등)=적용됨 · `42501`=grant 누락.

### 3. 코드 배포 (푸시 승인 후)

wiki main 푸시 → Cloudflare 자동 빌드. **DB와 코드는 독립 배포** — DB 먼저 적용해도 기존 화면에 영향 없음(순수 additive).

### 4. 런칭 전 체크리스트 (8/29 D-1)

- [ ] 토론 주제 문안 확정 → UPDATE + open 전환
- [ ] `readiness_check(session_id)` → ok:true (topics_open·teams_active·roster_loaded)
- [ ] 조 코드 1개로 리허설: /mod → 산출물 저장→최종제출→(HQ 재오픈)→재제출
- [ ] /mod → 다의제 투표 생성→QR 폰 스캔→/b 제출→마감→결과 공개 E2E
- [ ] `attendance_secret.hq_password` 유효 확인 (submission_reopen이 HQ 토큰 재사용)
- [ ] 스냅샷: `cv_snapshot_now` 페이로드에 신규 테이블 미포함 — 필요 시 후속(P1)

## 신규 RPC 계약 요약

| RPC | 인자 | 권한 | 비고 |
|---|---|---|---|
| topic_list | p_code | anon | open·closed 주제만 |
| submission_get / save / finalize | p_code, p_topic_id(, p_items) | anon | save는 open 주제 + draft/reopened만, 항목≤30 |
| submission_reopen | p_token(HQ), p_submission_id, p_reason | anon(토큰 검증) | attendance HQ 토큰 재사용, reason 필수 |
| readiness_check | p_session | anon | PII 없음 |
| ballot_create / set_status / list | p_code, … | anon | 전이 역행 금지 |
| ballot_get / submit | p_token(, p_client_id, p_answers) | anon | open만 제출, 1디바이스 1회 |
| ballot_results | p_token, p_code? | anon | p_code=잠정, 없으면 published만 |
