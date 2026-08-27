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
