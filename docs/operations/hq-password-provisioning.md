# HQ 공유 비밀번호 프로비저닝 (운영 런북)

`/hq`의 관리자 기능(실명 명단 전체 관리, 수정이력, CSV, 조 PIN 교체)은
`climate_vote.attendance_secret` 의 `hq_password` 행이 있어야 열린다.
이 행이 없으면 `attendance_hq_unlock`이 어떤 비밀번호에도 `null`을 반환한다.

## 원칙

- 비밀번호 **원문을 저장소·문서·터미널 로그·채팅에 남기지 않는다.** DB에는 `crypt()` 해시만 들어간다.
- 실행은 Supabase SQL Editor에서 사람이 직접 한다. 아래 SQL을 복사한 뒤
  `여기에_비밀번호_입력` 자리만 실제 값으로 바꿔 실행하고, **실행 후 편집기 내용을 지운다.**
- SQL 편집기의 히스토리에 남을 수 있으므로, 끝나면 해당 스니펫을 삭제한다.

## 사전 확인

```sql
-- 0행이어야 한다. 1행이면 이미 설정돼 있으므로 아래 '교체' 절차를 쓴다.
select secret_key, updated_at from climate_vote.attendance_secret where secret_key = 'hq_password';
```

## 최초 설정

`Create a new query`로 빈 편집기를 연 뒤 실행한다. 단일 트랜잭션이며,
이미 행이 있으면 아무것도 바꾸지 않고 예외로 롤백된다.

```sql
begin;

do $$
declare
  v_password text := '여기에_비밀번호_입력';
  v_existing int;
begin
  if length(v_password) < 12 then
    raise exception '비밀번호는 12자 이상이어야 합니다';
  end if;
  if v_password = '여기에_비밀번호_입력' then
    raise exception '자리표시자를 실제 비밀번호로 바꾸세요';
  end if;

  select count(*) into v_existing
  from climate_vote.attendance_secret where secret_key = 'hq_password';
  if v_existing <> 0 then
    raise exception 'hq_password가 이미 존재합니다 — 교체 절차를 사용하세요';
  end if;

  insert into climate_vote.attendance_secret(secret_key, secret_hash)
  values ('hq_password', extensions.crypt(v_password, extensions.gen_salt('bf')));
end $$;

-- 검증: 1행이어야 하고, secret_hash는 '$2' 로 시작하는 bcrypt 해시여야 한다.
select secret_key, left(secret_hash, 4) as hash_prefix, updated_at
from climate_vote.attendance_secret where secret_key = 'hq_password';

commit;
```

## 교체

```sql
begin;

do $$
declare
  v_password text := '여기에_새_비밀번호_입력';
begin
  if length(v_password) < 12 then
    raise exception '비밀번호는 12자 이상이어야 합니다';
  end if;
  update climate_vote.attendance_secret
     set secret_hash = extensions.crypt(v_password, extensions.gen_salt('bf')),
         updated_at = now()
   where secret_key = 'hq_password';
  if not found then
    raise exception 'hq_password 행이 없습니다 — 최초 설정 절차를 사용하세요';
  end if;
end $$;

commit;
```

## 설정 후 확인

1. `/hq?ops=1` 로 접속한다. **송출 모드에서는 관리자 패널이 숨겨져 있으므로 `?ops=1`이 필요하다.**
2. 관리자 잠금 해제에 비밀번호와 **운영자 표시 이름**(2~80자)을 입력한다.
   이 이름이 감사로그 `actor_label`에 남는다 — 조 단위가 아니라 개인 단위로 남는 유일한 경로다.
3. 174명 조회, 수정이력, CSV 권한이 열리는지 확인한다.

## 잠금 해제가 안 될 때

`attendance_hq_unlock`은 15분 내 실패 5회면 **정답 비밀번호에도** `null`을 반환한다.
카운터는 `subject = 'hq'` 고정이라 누가 틀렸든 공유된다. 자동 초기화·만료 정리가 없다.

```sql
-- 최근 실패 확인
select count(*) from climate_vote.attendance_auth_attempt
where scope = 'hq' and subject = 'hq' and not succeeded
  and attempted_at > now() - interval '15 minutes';

-- 15분을 기다릴 수 없는 현장 상황이면 실패 기록만 지운다(성공 기록은 감사 목적으로 보존)
delete from climate_vote.attendance_auth_attempt
where scope = 'hq' and subject = 'hq' and not succeeded;
```

조 단위(`subject = <조 접속코드>`)도 같은 구조다. 조 PIN을 5회 틀리면 그 조 출석부가
15분간 잠기며, 위 delete에서 `scope = 'team' and subject = '<코드>'`로 바꿔 푼다.
**8/29 당일 이 SQL에 접근 가능한 사람이 최소 1명은 현장에 있어야 한다.**

## 관련

- 조 접속코드 발급·회전: `docs/operations/mod-console-join-codes.md`
- 출석·HQ 라이브 검증 기록: `evaluation/attendance-live-verification.md`
