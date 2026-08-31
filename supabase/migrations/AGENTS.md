# supabase/migrations — 이 폴더의 관례

## 적용 방식
- 파일명은 `YYYYMMDD_<태그>_<이름>.sql` 이고 **사전순으로 적용**된다.
  `20260828_s8_*` 처럼 태그가 겹친 파일이 이미 있으니, **새 마이그레이션은 다음 태그(s9…)를 쓸 것.**
- 스키마는 `public` 이 아니라 **`climate_vote`** 다. 표·함수 전부 여기에 만든다.

## RPC 를 새로 만들 때 (5종 세트)
`20260827_s7_hq_submissions.sql` 이 정본이다. 다섯 가지를 빠짐없이 한다.

1. `language plpgsql security definer`
2. `set search_path = climate_vote, extensions, pg_temp`
3. 토큰 검증 — `v_auth := climate_vote.attendance_token_row(p_token);` 뒤에
   `if v_auth.scope <> 'hq' then raise exception 'HQ authorization required'; end if;`
   (조 콘솔용은 조 코드 capability 를 쓴다. 두 경로를 섞지 말 것.)
4. `grant execute on function ... to anon, authenticated;`
5. `revoke execute on function ... from public;`
   ★ **PUBLIC 을 남겨두면 anon 만 revoke 해도 안 닫힌다.** 4·5 는 항상 짝이다.

반환 타입(컬럼)을 바꿀 때는 `create or replace` 로 안 된다 — `drop function if exists ...` 를
먼저 해야 한다(`20260828_s8_hq_reopen_and_history.sql` 참조). 시그니처를 바꾸면
`src/lib/*.ts` 의 손유지 타입도 같이 고칠 것.

## 새 표를 만들 때
```sql
alter table climate_vote.<t> enable row level security;
revoke all on climate_vote.<t> from anon, authenticated;
```
직접 접근은 막고 RPC 로만 연다. 실시간 반영이 필요하면 `supabase_realtime` 발행에 올리고
`replica identity full` 을 건다(중복은 `duplicate_object` 로 삼킨다 — s7 참조).

## 조 산출물(submission_*)을 건드릴 때 — 금지선
회의자료 260811 이 「조별 결과 임의 통합」·「좋은 의견 선정」·「소수의견 삭제」·「문장 신작」을
금지한다. 원문 표(`submission`, `submission_item`)를 고치거나 지우는 구문을 쓰지 말 것.
부가 정보(범주 배정·표시·검수 결과)는 **원문 옆에 붙는 별도 표**로 둔다.

- ★ **`submission_item` 으로 가는 외래키를 걸지 말 것.** `unique (submission_id, ordinal)` 이 있어
  복합 FK 가 가능해 보이는 게 함정이다. `submission_save` 는 항목을 **delete 후 insert** 로
  갈아끼우므로 — `on delete cascade` 면 조가 다시 저장할 때마다 부가 정보가 조용히 사라지고,
  cascade 없이 걸면 **부가 정보 때문에 조의 저장이 실패한다**(원문 표의 동작을 바꾸는 것이다).
  FK 는 `submission(id)` 로 건다. 제출물은 `archived_at` 으로 보관될 뿐 삭제되지 않는다.
- 항목을 가리키는 안정된 키는 **`(submission_id, item_ordinal)`** 이다. 항목 uuid 는 저장할 때마다
  바뀌고 `hq_submissions` 가 내주지도 않는다. 이 키는 본부 보드의 카드 id `topic:team:ordinal` 과
  같은 것을 가리킨다(`submission` 이 `(topic_id, team_id)` 로 유일하므로).

## 사람이 고친 것을 사건으로 쌓을 때
설계문서가 「누가·언제」와 「되돌릴 수 있어야 한다」를 함께 요구한다. 현재 상태만 덮어쓰면
되돌린 순간 앞 기록이 사라져 두 요구가 서로를 잡아먹는다. **append-only 사건 표**로 두고
현재 상태는 「항목별 마지막 사건」으로 읽는다(`submission_lock_event`,
`submission_item_archive`, `submission_category_event` 가 모두 이 꼴이다).

- ★ 마지막 사건을 뽑을 때 **해제(null)를 `distinct on` 앞에서 걸러내면 안 된다.**
  「배정 → 해제」한 항목에서 **해제 직전 배정이 되살아난다.** 마지막 사건을 먼저 뽑고 해제도
  그대로 내보내 화면이 판단하게 한다.
- 정렬 기준은 `created_at` 이 아니라 **identity `id` desc** 로 둘 것. 같은 초에 두 번 눌리면
  시각은 동점이 된다.

## 적용은 사람이 한다
이 폴더에 파일을 쓰는 것과 Supabase 에 적용하는 것은 별개다. 에이전트는 **파일 작성까지만** 한다.
적용 전 상태에서 새 RPC 를 화면에 붙이면 PostgREST 가 `PGRST202` 로 죽는다.

## 행 수 상한 드리프트 — 2026-08-31 판정 (US-001 / R0)

**판정: 파일로 고정됨.** 꼭지당 행 수 상한 200 은 저장소 파일에 재기준화돼 있다.
8.29 현장에서 파일 없이 적용했던 `raise_submission_item_cap_30_to_200` 의 드리프트는
`20260830_s15_submission_server_line_split.sql` 이 메웠다.

근거 (줄번호):

| 파일 | 줄 | 값 | 판정 |
|------|-----|-----|------|
| `20260830_s15_submission_server_line_split.sql` | 132-133 | 200 | `submission_save` 를 `create or replace` 로 200 재기준화 |
| `20260830_s15_submission_server_line_split.sql` | 193-194 | 200 | `submission_save_v2` 도 같은 파일에서 200 |
| `20260830_s15_submission_server_line_split.sql` | 140 · 200 | 200 | 분해 결과가 200 초과면 나누기를 포기(글자 유실 없음) |
| `20260808_s1_assembly_topic_submission.sql` | 201-202 | **30** | `submission_save` 의 옛 값. s15 가 사전순 뒤라 **덮인다** — 드리프트가 아니라 상위(supersede)다 |
| `src/islands/mod/submission-panel-logic.ts` | 29 | 200 | 화면 `MAX_SUBMISSION_ROWS` |
| `src/islands/mod/submission-guide.ts` | 20 | 200 | 안내문 `MAX_ROWS_PER_TOPIC` |

★ **행 수 상한에 대응하는 표 check 제약은 없다.** `submission_item` 의 check 는 `kind` ·
`content`(1~2000자) · `rationale`(≤2000자) 뿐이다(`20260808_s1_*.sql:76-78`). 상한은 오직
**RPC 안의 `jsonb_array_length(p_items) > N` 가드**로만 존재한다. 그래서 「제약을 고쳤나」가 아니라
「어느 파일이 그 함수를 마지막으로 정의하나」가 유일한 판정 기준이다.

### ★ `platform_*.sql` 은 날짜 파일보다 **뒤에** 온다 — 잔여 위험

파일명 사전순에서 숫자(`2`)가 알파벳(`p`)보다 앞이므로 `platform_*.sql` 은 **모든 `2026*` 파일보다
뒤에 적용된다.** 그리고 `platform_p2_analysis_review.sql:204-205` 가 `submission_save_v2` 를
**상한 30 으로 다시 정의한다.**

→ 폴더를 통째로 재생하거나 platform 트랙을 적용하면 **`submission_save_v2` 만 30 으로 되돌아간다.**

지금 당장 터지지 않는 이유(둘 다 확인함):
- 화면은 `submission_save_v2` 를 부르지 않는다. `src/lib/deliberation.ts:107` 이 `submission_save` 만 부른다
- `platform_p2_analysis_review.sql:3` 자체가 「8/29 라이브와 별개, 병합 전까지 프로덕션 미적용」이라고 적고 있다

**고칠 주체는 platform 트랙이다.** 그 트랙을 적용·병합할 때 p2 의 30 을 200 으로 올린다.
이 저장소(9.12 트랙)에서 p2 를 고치지 않는다 — 다른 트랙의 파일이다.

★ **`2026…_s17_item_cap_200.sql` 같은 날짜 파일을 새로 만들어도 이 구멍은 안 막힌다.**
그 파일도 `platform_p2` 보다 앞서기 때문이다. 그래서 US-001 은 파일을 만들지 않았다.
platform 트랙과 겹치는 함수를 다룰 때는 **새 마이그레이션을 쓰기 전에
`grep -n "<함수명>" supabase/migrations/platform_p*.sql` 을 먼저 돌릴 것.**

2026-08-31 전수 확인 결과, `2026*` 트랙과 `platform_*` 트랙이 **둘 다 정의하는 함수는
`submission_save_v2` 하나뿐**이다. `topic_list` 는 platform 쪽에 없다.

## `drop function` 뒤 권한이 실제로 어떻게 되나 — 2026-09-01 실측 (US-007 / s17)

`20260901_s17_topic_deadline.sql` 이 `topic_list` 를 drop 후 재생성하면서 버려도 되는 PostgreSQL 16
컨테이너에서 실제로 재현해 본 결과다. **설계문서·PRD 에 적힌 「grant 재부여를 빠뜨리면 조 화면이
전면 장애」는 이 저장소 환경에서 사실이 아니다.** 실제로 일어나는 일은 더 조용하고 더 나쁘다.

| 구문 | 기존 ACL | 결과 |
|------|----------|------|
| `create or replace function` | **보존된다** | 앞선 `revoke ... from public` 이 그대로 살아 있다 |
| `drop function` + `create function` | **날아간다** | 새 함수는 **PUBLIC EXECUTE 를 기본으로 갖는다** |

실측값 — grant 절을 뺀 s17 을 적용한 직후:
`anon=t authenticated=t public=t` (재부여 정상판은 `anon=t authenticated=t public=f`)

→ **조 화면은 안 죽는다.** anon 이 PUBLIC 에 얹혀 계속 호출되기 때문이다. 대신
① PUBLIC 노출이 되살아나고 ② 명시적 `anon`·`authenticated` grant 가 사라진다.
그 상태에서 누군가 나중에 위생 정리로 `revoke execute ... from public` 만 돌리면 그 순간
**anon 과 authenticated 가 동시에 권한을 잃는다** — `20260726_grant_authenticated_execute.sql`
머리말의 2026-07-26 라이브 장애(`42501 permission denied for function hq_teams`)와 같은 구조다.

★ 그러므로 `revoke from public` + `grant to anon, authenticated` 는 「조 화면을 살리는 주문」이
아니라 **「PUBLIC 에 얹힌 상태를 명시적 권한으로 갈아 끼우는 짝」**이다. 위 5종 세트의 4·5 를
항상 함께 쓰라는 규칙의 진짜 이유가 이것이다. 검증도 `anon=t` 만 보면 안 되고
**`public=f` 를 함께 봐야** 의미가 있다(`supabase/verify/20260901_s17_topic_deadline.sql` C4).

### 이 폴더 파일을 실제로 돌려보는 법 (운영 DB 무접촉)

`supabase/verify/README.md` 의 G1 하네스와 같은 방식이다. 요약:

```bash
docker run -d --name pgverify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify postgres:16
docker exec pgverify psql -U postgres -d verify -c "create role anon nologin; create role authenticated nologin; create role service_role nologin; create publication supabase_realtime; alter database verify set search_path=public,extensions,climate_vote;"
docker cp supabase/migrations/. pgverify:/tmp/ ; docker cp supabase/verify/00_prelude.sql pgverify:/tmp/ ; docker cp supabase/verify/driver_pass1.sql pgverify:/tmp/
MSYS_NO_PATHCONV=1 docker exec pgverify psql -U postgres -d verify -v ON_ERROR_STOP=1 -v verify_function_bodies=on -f /tmp/driver_pass1.sql
```

함정 셋:
- **Git Bash 는 `/tmp/...` 를 윈도 경로로 바꿔 버린다.** `MSYS_NO_PATHCONV=1` 을 붙일 것
- **`anon` 의 `usage on schema climate_vote` 는 어느 마이그레이션에도 없다.** 운영에서는
  Supabase 의 「노출 스키마」 설정이 준다. throwaway DB 에서는 직접 줘야 anon 호출 검사가 돈다
- **psql 은 문장마다 암시적 커밋**이라 `create temporary table ... on commit drop` 은 즉시 사라진다

### ★ `driver_pass1.sql` 은 s5~s17 을 싣지 않는다

CI(`.github/workflows/test.yml`)가 `supabase/**` 변경 시 돌리는 것은 `driver_pass1.sql` 인데,
그 파일이 `\i` 로 부르는 목록은 mod_console·attendance·s1·s2·s4 + platform 뿐이다.
**s5 이후의 `2026*` 파일은 CI 가 파싱조차 하지 않는다.** s17 도 마찬가지다 —
넣지 않은 것은 관례를 따른 것이며, 병합 시 트랙을 정리할 때 함께 배선한다.
그때까지 s17 의 파싱·권한·계약 근거는 위 하네스로 손수 돌린 결과
(`verify 7/7` · `contract 8/8`, progress.txt 2026-09-01 US-007 항)뿐이다.

## 시그니처를 바꿨으면 `src/lib` 쪽도 **기계로** 맞춰라 — 2026-09-01 (US-009)

위 「RPC 를 새로 만들 때」가 「`src/lib/*.ts` 의 손유지 타입도 같이 고칠 것」으로 끝나는데,
그 「같이 고쳤나」를 사람 눈으로 확인하는 한 언젠가 빠진다. tsc 는 이 어긋남을 못 잡는다.

`node scripts/verify-topic-contract.mjs` 가 s17 에 대해 그것을 센다 —
`topic_list` 반환 컬럼 ↔ `Topic` 타입 필드 **8/8**, `topic_set_deadline` 인자 ↔ `.rpc()` 호출부 키 **3/3**,
그리고 grant 재부여(`revoke from public` + `to anon, authenticated`)가 파일에 살아 있는지까지.
**도커도 DB 도 필요 없다.** 새 RPC 를 화면에 붙일 때 이 스크립트를 본떠 늘릴 것
(작성법은 `scripts/AGENTS.md` 「손유지 타입 ↔ SQL 대조」).

★ **반환 컬럼을 늘렸으면 TS 쪽은 선택 필드(`?:`)로 받는 편이 낫다.** 마이그레이션 적용과
배포는 순서가 어긋나고, 필수 필드로 받으면 옛 RPC 응답이 **타입에서** 막혀 두 작업이 서로에게 묶인다.
s17 의 `deadline_at`·`server_now` 가 그 예다 — 없으면 화면이 배너를 안 그리고 조용히 퇴화한다.
