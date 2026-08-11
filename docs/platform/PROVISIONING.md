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

### 1-1. A1·A2 활성화 전 읽기 전용 점검

`platform_p1b_backfill.sql` 또는 staff용 GRANT를 실행하기 전에 현재 데이터 준비도를 비식별 집계로 확인한다.

```powershell
cd automation
npm.cmd run preflight:platform-activation
```

- 입력은 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`(또는 `SUPABASE_SERVICE_ROLE`)다. Auth 세션은 저장하지 않는다.
- 12개 NOT NULL 대상 테이블의 전체 행·`org_id IS NULL` 건수와 assembly→session→topic→하위 행의 권위 있는 조직 경로 일치 여부를 점검한다. 활성 조직별 `org_admin`·`hq` 커버리지, 활성 membership의 활성 조직 귀속, 다중 조직 활성 사용자, membership이 가리키는 이메일 확인 완료·비익명 Supabase Auth 사용자의 존재·비활성 여부, 만료 전 HQ 세션의 활성 조직 바인딩도 확인한다.
- 출력은 집계와 blocker 코드만 포함하며 조직·사용자 UUID, 토큰, 원문을 포함하지 않는다. `databaseMutationExecuted`는 항상 `false`다.
- 종료 상태는 `ready`만 성공이다. `not_ready`는 실제 데이터 blocker, `not_verified`는 읽기 증거 자체가 불완전한 상태다. 두 상태 모두 활성화를 중단한다.
- 현재 프로덕션의 custom schema 원시 테이블은 service role에도 SELECT가 열려 있지 않아 실측 결과가 `not_verified / read_access_unavailable`이다. 이를 우회하려고 임의 GRANT를 추가하지 않는다. 전용 읽기 함수 또는 일시적 감사 권한은 사용자 승인 후 별도 변경으로 다룬다.
- 이 도구는 여러 읽기 요청의 결과를 합치는 preflight이며 단일 DB transaction snapshot은 아니다. 승인된 활성화 직전 쓰기를 잠시 멈춘 상태에서 다시 실행해야 하며, transactionally consistent 전용 읽기 함수가 필요하면 별도 DB 변경 승인을 받는다.
- `ready` 결과는 `ACTIVATION_PREFLIGHT_AUDIT_HMAC_KEY`(32자 이상)와 `ACTIVATION_PREFLIGHT_AUDIT_KEY_ID`가 모두 있을 때만 생성된다. report 전체와 source commit·정확한 스크립트 SHA-256·실행 ID·key ID를 외부 키 기반 HMAC-SHA256으로 결속하며 키는 JSON·stdout·오류에 포함하지 않는다.
- 활성화 직전 아래 검증을 같은 checkout에서 실행한다. 현재 HEAD·스크립트 hash·승인 대상 host·key ID·HMAC·미래 시각·기본 10분 freshness 중 하나라도 다르면 실패한다. `--max-age-seconds` 완화는 승인 기록이 있을 때만 사용한다.

```powershell
cd automation
npm.cmd run verify:platform-activation -- ..\evaluation\platform-activation-preflight.json --expected-host pleyuknjnprsckssxvrh.supabase.co
```

- HMAC 키는 GitHub secret 한 곳에만 두지 말고 key ID별 외부 보안 저장소에 별도 백업한다. 회전은 활성화를 중단한 상태에서 과거 evidence 검증→새 key ID 발급→새 evidence 생성 순서로 진행하며, 과거 키 폐기는 별도 승인 기록 뒤 수행한다.
- `ready` + 검증 성공도 활성화 행위를 자동 승인하지 않는다. 쓰기 동결 상태의 즉시 재실행 결과와 사용자의 DB·권한 변경 승인이 모두 필요하다.
- 최신 비식별 실행 증거: `evaluation/platform-activation-preflight.json`.
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
