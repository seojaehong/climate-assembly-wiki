-- rollback for migrations/platform_p2_analysis_review.sql
-- 신설 객체 전부 제거. s1/s2/cv_snapshot_now가 만든 어떤 객체도 건드리지 않는다.
-- ⚠️ issue·issue_link·result_page 데이터가 쌓였다면 drop 전에 platform_snapshot_now()로 export 할 것.
--
-- 순서: RPC → 트리거(내 것만) → 트리거 함수 → 헬퍼 → issue_link → issue → result_page
--   (issue_link.issue_id는 CASCADE라 issue 먼저 지워도 링크가 딸려가지만, 명시적으로 링크부터 drop)

-- 1) RPC
drop function if exists climate_vote.platform_snapshot_now(text);
drop function if exists climate_vote.result_get(text);
drop function if exists climate_vote.result_unpublish(text, uuid);
drop function if exists climate_vote.result_publish(text, text, uuid, text);
drop function if exists climate_vote.issue_review(text, uuid);
drop function if exists climate_vote.issue_merge(text, uuid, uuid);
drop function if exists climate_vote.issue_link_set(text, uuid, uuid[], uuid);
drop function if exists climate_vote.issue_upsert(text, uuid, jsonb);
drop function if exists climate_vote.issue_list(text, uuid);
drop function if exists climate_vote.submission_save_v2(text, uuid, jsonb);

-- 2) 내가 붙인 트리거만 제거 (s1 submission_item_lock_guard는 유지)
drop trigger if exists issue_invalidate_guard on climate_vote.submission_item;
drop function if exists climate_vote.issue_invalidate_guard();
-- issue_org_derive 트리거는 issue 테이블 drop(4단계) 시 함께 사라지나 명시적으로 함수 제거
drop function if exists climate_vote.issue_org_derive() cascade;

-- 3) 헬퍼
drop function if exists climate_vote.platform_scope_belongs(text, uuid, uuid);
drop function if exists climate_vote.platform_org_of_code(text);

-- 4) 테이블 (자식 → 부모)
drop table if exists climate_vote.issue_link;
drop table if exists climate_vote.issue;
drop table if exists climate_vote.result_page;
