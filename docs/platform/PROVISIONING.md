# 플랫폼 프로덕션 프로비저닝 런북 (턴키)

로컬 HTTP E2E(`supabase/verify/e2e_http.md`)로 스키마·RLS·검수/공개 파이프라인·G2가 실 전송에서 검증됨. 실제 Supabase 프로젝트에 올리는 절차. **8/29 라이브(labor_money)와 별개 프로젝트 권장**(격리).

## 0. 결정 선행 (플랜 §5 — 이것부터)
- [ ] 전용 Supabase 프로젝트 신설 vs 기존 labor_money에 additive (권장: **신설** — 격리·소재지·헤드룸)
- [ ] Supabase Auth 도입 범위: 운영자·기관관리자만(권장) / 진행자까지
- [ ] HQ 공유비밀 → membership 인증 전환(Phase 2 선행조건, G2 최종형)

## 1. 스키마 적용 (SQL Editor, 순서·통째)
1. `platform_p1_tenancy.sql` — org·membership·invitation·org_id·헬퍼·RLS
2. `platform_p2_analysis_review.sql` — issue·result_page·검수/공개 RPC
3. (데이터 있으면) `platform_p1b_backfill.sql` — 기본 org backfill + NOT NULL(G3)
> Supabase는 pgcrypto가 `extensions`에 있고 search_path에 포함 → 마이그레이션 그대로 동작.
> 적용 검증: anon 키로 `POST /rest/v1/rpc/result_get {"p_token":"0..0"}` → `200 null` = 적용됨.

## 2. Auth 활성화 (staff RLS 경로)
P1의 RLS 정책은 `revoke all from authenticated` 때문에 **휴면**. 활성화:
```sql
grant select on climate_vote.assembly, climate_vote.session, climate_vote.discussion_topic,
                climate_vote.membership to authenticated;
-- (쓰기 필요 테이블은 operator/org_admin 정책이 이미 있으므로 select+정책으로 게이트)
```
- Supabase Auth로 운영자 계정 생성 → `climate_vote.membership(org_id,user_id,role)` 행 삽입(초대 플로우 `invitation` 활용).
- `auth.uid()`는 Supabase 기본 제공(JWT sub). 우리 정책이 이를 membership과 대조.

## 3. 프론트 배포
- `/platform/*`·`/r/*` 라우트는 정적 빌드 + 클라이언트 라우팅. **딥링크 새로고침** 위해 Cloudflare Pages SPA fallback rewrite 필요:
  - `_redirects`에 `/platform/* /platform/app/index.html 200`, `/r/* /r/[token] 200` (또는 SSR 어댑터 도입).
- `PUBLIC_SUPABASE_URL`·`PUBLIC_SUPABASE_ANON_KEY`를 신 프로젝트 값으로.

## 4. G2 최종형 (Phase 2)
현재 `result_publish`는 attendance HQ 토큰(공유비밀 유래) 서명. Phase 2에서:
- HQ 토큰 발급을 membership(role in hq/org_admin) 인증으로 교체.
- `attendance_auth_session.org_id`를 membership에서 채워 `result_publish`의 org 일치 검사 활성.

## 5. 라이브 E2E (프로비저닝 후)
`supabase/verify/e2e_http.md`의 8단계를 **실 프로젝트 anon 키 + Auth JWT**로 재현. 전부 통과하면 런칭 가능.

## 남은 하드 게이트
- **G3**(NOT NULL): `platform_p1b_backfill.sql` = 단일 테넌트 가정. 다중 org 도입 시 org별 재배치 후 적용.
- 분석코어 어댑터(consensus/DQI → issue, service_role): 8/29 산출물로 첫 실전.
- 설계 마법사(Phase 3): assembly/session/topic 생성 UI(§5-4 결정 시).
