-- fix(mod-console): 최종리뷰 드리프트 발견 — uniq_votes_round_client_active 인덱스가
-- live DB에는 존재하나 저장소 마이그레이션에는 없음(누가/언제 적용했는지 이력 미상).
-- WHY: castBallot()의 23505 중복 방어(src/lib/mod-console.ts)가 의존하는 백스톱 인덱스.
--      리포지토리를 source of truth로 유지하기 위해 사후 캡처한다.
-- WHAT: (round_id, client_id) 부분 유니크 인덱스 — client_id not null and archived_at is null.
-- SAFETY: if-not-exists이므로 이 파일 재적용/리빌드는 안전(live에는 재적용하지 않음 — 이미 존재).
-- NOTE: 이 인덱스는 컨트롤러가 live DB에 이미 적용함(시점 미상) — 이 파일은 저장소를
--       source of truth로 유지하기 위한 사후 기록.

create unique index if not exists uniq_votes_round_client_active
  on climate_vote.votes using btree (round_id, client_id)
  where ((client_id is not null) and (archived_at is null));
