# 운영 DB 적용 런북 — 2026-07-26 미적용 마이그레이션 2건

> ## ✅ 2026-07-26 적용 완료
> §1·§2 모두 실행됐고 §3 검증을 anon 키로 교차 확인했다.
> `hq_teams()` 6열(`table_no` 포함) · 16행 유지 · `table_no` 전부 null(입력 전 정상) ·
> `attendance_team_unlock` → `42501 permission denied` · `attendance_team_unlock_by_code` 정상 ·
> `attendance_hq_set_table_no` 무효 토큰에 `P0001 attendance authorization required`.
> **이 문서는 이후 같은 상황의 참고용으로 남긴다. 다시 실행할 필요 없다.**

**대상**: 운영 Supabase (`PUBLIC_SUPABASE_URL`이 가리키는 프로젝트)
**실행 위치**: Supabase 대시보드 → SQL Editor
**소요**: 1분. 다운타임 없음. 단 §2 실행 중 `hq_teams()`가 **수 밀리초간 존재하지 않는다** — 행사 중에는 하지 말 것.

## 왜 필요한가

2026-07-26 `main`(`de41b75`)에 코드가 배포됐지만, 아래 두 마이그레이션은 DB에 적용되지 않았다.
anon 키로 운영 DB에 직접 확인한 결과다.

| 마이그레이션 | 상태 | 근거 |
|---|---|---|
| `20260726_attendance_unlock_by_join_code.sql` | ✅ 적용됨 | `attendance_team_unlock_by_code` 정상 응답 |
| `20260726_revoke_public_execute_attendance.sql` | ✅ 적용됨 | `attendance_token_row` → `42501 permission denied` |
| `20260726_revoke_pin_unlock.sql` | ❌ 미적용 → **✅ 2026-07-26 적용** | (적용 전) `attendance_team_unlock`이 anon 키로 실행됨 → (적용 후) `42501` |
| `20260726_team_table_no.sql` | ❌ 미적용 → **✅ 2026-07-26 적용** | (적용 전) `hq_teams()` 5열, `attendance_hq_set_table_no` → `PGRST202` → (적용 후) 6열, `P0001` |

**미적용 상태로 두면**

- 조 테이블 번호(US-017): `/hq?ops=1` 명단 탭의 '저장' 버튼이 **항상 실패**하고, 송출 카드에 번호가 영영 안 뜬다.
- PIN 회수: 폐기된 PIN 2단 인증 함수가 **아직 anon에게 열려 있다**. 새 경로(조 접속코드 단독)가
  이미 배포됐으므로 기능상 문제는 없지만, 적대적 리뷰에서 닫기로 확정한 표면이다.

나머지(`/hq` 송출·조 상세·출석 현황·`/mod` 투표·타이머·출석부)는 지금도 정상 동작한다.

---

## §0. 적용 전 현재 상태 확인 (선택, 읽기 전용)

```sql
-- hq_teams가 몇 열을 반환하는지 (적용 전 5열, 적용 후 6열)
select * from climate_vote.hq_teams() limit 1;

-- table_no 컬럼 존재 여부 (적용 전 0행)
select column_name from information_schema.columns
where table_schema = 'climate_vote' and table_name = 'team' and column_name = 'table_no';

-- PIN 함수의 현재 권한 (적용 전 anon 포함)
select grantee, privilege_type from information_schema.routine_privileges
where routine_schema = 'climate_vote' and routine_name = 'attendance_team_unlock';
```

---

## §1. PIN 2단 인증 경로 회수

`20260726_revoke_pin_unlock.sql` 전문이다.

```sql
revoke execute on function climate_vote.attendance_team_unlock(text,text) from anon, public;
```

---

## §2. 조 테이블 번호 컬럼 + 본부 전용 수정 RPC

`20260726_team_table_no.sql` 전문이다. **§1과 §2는 순서 상관없으나, §2는 통째로 한 번에 실행할 것**
— 중간에서 끊기면 `hq_teams()`가 drop된 채로 남아 `/hq`가 조 목록을 통째로 못 불러온다.

```sql
-- 테이블 번호는 당일에야 확정되므로 시드가 아니라 본부가 현장에서 입력한다.
-- 숫자가 아닐 수 있어(예: 'A-3') text로 둔다.
alter table climate_vote.team add column if not exists table_no text;

-- hq_teams()는 반환 타입이 바뀌므로 drop 후 재생성해야 한다.
drop function if exists climate_vote.hq_teams();

create or replace function climate_vote.hq_teams()
returns table(id uuid, name text, subgroup text, capacity int, status text, table_no text)
language sql security definer set search_path = climate_vote, pg_temp as $$
  select t.id, t.name, t.subgroup,
    coalesce(nullif(count(ta.id) filter (where ta.active and m.active), 0), t.capacity)::int,
    t.status, t.table_no
  from climate_vote.team t
  left join climate_vote.team_assignment ta on ta.team_id = t.id
  left join climate_vote.assembly_member m on m.id = ta.member_id
  group by t.id, t.name, t.subgroup, t.capacity, t.status, t.table_no;
$$;

revoke execute on function climate_vote.hq_teams() from public;
grant execute on function climate_vote.hq_teams() to anon;

-- 본부만 수정한다. 조 모더레이터가 자기 조 번호를 바꾸면 좌석표와 어긋나기 때문이다.
create or replace function climate_vote.attendance_hq_set_table_no(
  p_token text, p_team_id uuid, p_table_no text)
returns void
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $$
declare
  v_auth climate_vote.attendance_auth_session;
  v_team climate_vote.team;
  v_value text := nullif(btrim(coalesce(p_table_no, '')), '');
begin
  v_auth := climate_vote.attendance_token_row(p_token);
  if v_auth.scope <> 'hq' then
    raise exception 'hq authorization required';
  end if;
  if v_value is not null and length(v_value) > 20 then
    raise exception 'table number too long';
  end if;

  select * into v_team from climate_vote.team where id = p_team_id;
  if not found then raise exception 'team not found'; end if;

  update climate_vote.team set table_no = v_value where id = p_team_id;

  insert into climate_vote.attendance_audit_log
    (session_id, team_id, assignment_id, action, before_value, after_value, actor_scope, actor_label)
  values (v_team.session_id, v_team.id, null, 'team.table_no',
    jsonb_build_object('table_no', v_team.table_no),
    jsonb_build_object('table_no', v_value),
    v_auth.scope, v_auth.actor_label);
end
$$;

revoke execute on function climate_vote.attendance_hq_set_table_no(text,uuid,text) from public;
grant execute on function climate_vote.attendance_hq_set_table_no(text,uuid,text) to anon;
```

---

## §3. 적용 직후 검증 (전부 통과해야 함)

```sql
-- 1) 6열이 나오고 table_no가 있는가 (전부 null이 정상 — 아직 아무도 입력 안 했다)
select * from climate_vote.hq_teams() limit 1;

-- 2) 15개 조가 그대로 다 나오는가 (숫자가 줄었으면 즉시 롤백)
select count(*) from climate_vote.hq_teams();

-- 3) 권한: anon은 hq_teams 실행 가능, PIN 함수는 회수됨
select routine_name, grantee, privilege_type from information_schema.routine_privileges
where routine_schema = 'climate_vote'
  and routine_name in ('hq_teams','attendance_hq_set_table_no','attendance_team_unlock')
order by routine_name, grantee;
--   기대: hq_teams / attendance_hq_set_table_no → anon 있음
--         attendance_team_unlock → anon 없음 (행 자체가 안 나오면 정상)
```

**그 다음 화면에서** (SQL로는 확인되지 않는다):

- `/hq`가 조 카드 15개를 정상적으로 불러오는가 — **이게 제일 중요하다.** 못 불러오면 §2 롤백.
- `/hq?ops=1` → 명단 관리 잠금 해제 → 하단 '조 테이블 번호' 구역에서 한 조에 번호를 넣고 저장 →
  새로고침 후에도 남아 있고, 송출 카드에 그 번호가 뜨는가.
- `/mod`에서 조 접속코드만으로 출석부가 열리는가 (PIN 회수가 새 경로를 건드리지 않았는지 회귀 확인).

---

## §4. 롤백

§1은 되돌릴 일이 거의 없다. 필요하면:

```sql
grant execute on function climate_vote.attendance_team_unlock(text,text) to anon;
```

§2에서 `/hq`가 조 목록을 못 불러오면 `hq_teams()`를 **적용 전 5열 버전으로 되돌린다**.
컬럼(`table_no`)은 남겨둬도 무해하므로 굳이 drop하지 않는다.

```sql
drop function if exists climate_vote.hq_teams();

create or replace function climate_vote.hq_teams()
returns table(id uuid, name text, subgroup text, capacity int, status text)
language sql security definer set search_path = climate_vote, pg_temp as $$
  select t.id, t.name, t.subgroup,
    coalesce(nullif(count(ta.id) filter (where ta.active and m.active), 0), t.capacity)::int,
    t.status
  from climate_vote.team t
  left join climate_vote.team_assignment ta on ta.team_id = t.id
  left join climate_vote.assembly_member m on m.id = ta.member_id
  group by t.id, t.name, t.subgroup, t.capacity, t.status;
$$;

revoke execute on function climate_vote.hq_teams() from public;
grant execute on function climate_vote.hq_teams() to anon;
```

> 이 롤백 정의는 `20260725_attendance_roster_hq.sql`의 원본이 아니라 **`20260726_team_table_no.sql`에서
> `table_no`만 제거해 역산한 것**이다. 실행 전 원본과 한 번 대조할 것.

---

## §5. 적용 후 할 일

- 이 문서 맨 위 표의 ❌를 ✅로 바꾸고 적용 일시를 적는다.
- `evaluation/2026-07-26-hq-broadcast-mod-blockers.md` §5 'US-017' 절의 ★ 첫 항목(마이그레이션 적용 확인)을 체크한다.
