-- feat(hq): 본부(/hq) 로그인 비밀번호 provisioning
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- WHY: /hq 진입 게이트 + 조별 산출물 재오픈(submission_reopen)에 쓰는 HQ 토큰은
--      climate_vote.attendance_hq_unlock(p_password, p_actor)가 발급한다.
--      그 함수는 attendance_secret의 'hq_password' 해시와 crypt 비교한다.
--      이 파일은 그 해시를 심는다(멱등 — 재실행 시 비번 갱신).
--
-- ⚠️ 비밀번호를 바꾸려면 아래 'climate2026' 자리만 교체 후 재실행.
-- ⚠️ 이 값은 과거 /vote-admin-614 평문 비번과 동일 — 노출 이력이 있으니
--    운영 안정화 후 강한 값으로 교체 권장(BACKLOG B-001/B-002).

create extension if not exists pgcrypto with schema extensions;

insert into climate_vote.attendance_secret (secret_key, secret_hash)
values ('hq_password', extensions.crypt('climate2026', extensions.gen_salt('bf', 10)))
on conflict (secret_key)
  do update set secret_hash = excluded.secret_hash, updated_at = now();

-- 확인: 방금 심은 비번이 매칭되는지 (true 나오면 성공)
select extensions.crypt('climate2026', secret_hash) = secret_hash as password_ok
from climate_vote.attendance_secret where secret_key = 'hq_password';
