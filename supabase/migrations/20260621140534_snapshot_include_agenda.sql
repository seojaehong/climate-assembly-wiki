-- feat(integrity): snapshot RPC payload에 캔버스(agenda·agenda_link·agenda_vote·tally) 포함
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- WHY: 기존 백업 RPC는 votes·rounds·archive_log만 직렬화하고 권고안 원천인
--      캔버스 데이터(agenda·agenda_link·agenda_vote)와 집계 뷰(tally)는 누락.
--      PITR 미활성 상태에서 리셋·삭제 시 권고안 원천이 영구 손실됨.
--
-- WHAT: 두 RPC(cv_snapshot_now, cv_archive_round)의 payload jsonb에
--       agenda·agenda_link·agenda_vote·tally 4개 키를 ADDITIVE로 추가.
--       기존 키(votes·rounds·archive_log + cv_archive_round의 메타 키)는 그대로 유지.
--
-- SAFETY: 순수 additive. 함수 정의 교체(CREATE OR REPLACE)만. 시그니처·반환타입 동일.
--         데이터 테이블 스키마/데이터/트리거/정책 변경 없음.
--         agenda.embedding(pgvector) 은 to_jsonb 시 텍스트 표현 문자열로 직렬화됨(검증 완료).
--         모든 agg는 COALESCE(...,'[]') 로 NULL(빈 테이블, 예: agenda_vote 0행) 방어.
--         tally 는 뷰이므로 ORDER BY 생략(확인된 정렬 컬럼 없음 — 백업이라 순서 불요).
--
-- ROLLBACK: supabase/migrations/20260621140534_BEFORE_snapshot_rpc.sql 실행.

CREATE OR REPLACE FUNCTION climate_vote.cv_archive_round(p_round_id text, p_reason text DEFAULT NULL::text, p_archived_by text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_max_attempt int;
  v_archived_count int;
  v_snapshot_id bigint;
BEGIN
  -- 1) 리셋 직전 강제 snapshot (Layer 1-B 보장)
  INSERT INTO climate_vote.snapshots (label, source, votes_count, rounds_count, archive_log_count, payload)
  SELECT 'pre_archive_' || p_round_id || '_' || extract(epoch from now())::bigint,
         'pre_archive',
         (SELECT COUNT(*) FROM climate_vote.votes),
         (SELECT COUNT(*) FROM climate_vote.rounds),
         (SELECT COUNT(*) FROM climate_vote.archive_log),
         jsonb_build_object(
           'votes',       COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM climate_vote.votes v), '[]'::jsonb),
           'rounds',      COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY sort_order) FROM climate_vote.rounds r), '[]'::jsonb),
           'archive_log', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM climate_vote.archive_log l), '[]'::jsonb),
           -- ADDITIVE: 캔버스(권고안 원천) + 집계 뷰
           'agenda',      COALESCE((SELECT jsonb_agg(to_jsonb(a)  ORDER BY a.id)  FROM climate_vote.agenda a), '[]'::jsonb),
           'agenda_link', COALESCE((SELECT jsonb_agg(to_jsonb(al) ORDER BY al.id) FROM climate_vote.agenda_link al), '[]'::jsonb),
           'agenda_vote', COALESCE((SELECT jsonb_agg(to_jsonb(av) ORDER BY av.id) FROM climate_vote.agenda_vote av), '[]'::jsonb),
           'tally',       COALESCE((SELECT jsonb_agg(to_jsonb(t))                 FROM climate_vote.tally t), '[]'::jsonb),
           'about_to_archive_round', p_round_id,
           'reason', p_reason,
           'archived_by', p_archived_by
         )
  RETURNING id INTO v_snapshot_id;

  -- 2) 기존 archive 로직
  SELECT COALESCE(MAX(attempt), 1) INTO v_max_attempt
    FROM climate_vote.votes WHERE round_id = p_round_id AND archived_at IS NULL;

  UPDATE climate_vote.votes
     SET archived_at = NOW(), archive_reason = p_reason, archived_by = p_archived_by
   WHERE round_id = p_round_id AND archived_at IS NULL;
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  INSERT INTO climate_vote.archive_log (round_id, archived_by, reason, archived_count, attempt_archived, metadata)
  VALUES (p_round_id, p_archived_by, p_reason, v_archived_count, v_max_attempt,
          jsonb_build_object('source', 'cv_archive_round', 'pre_snapshot_id', v_snapshot_id));

  RETURN json_build_object(
    'round_id', p_round_id,
    'archived_count', v_archived_count,
    'archived_at', NOW(),
    'next_attempt', v_max_attempt + 1,
    'pre_snapshot_id', v_snapshot_id
  );
END $function$;

CREATE OR REPLACE FUNCTION climate_vote.cv_snapshot_now(p_label text DEFAULT NULL::text, p_source text DEFAULT 'cron'::text)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_id bigint;
  v_votes_count int;
  v_rounds_count int;
  v_archive_log_count int;
  v_payload jsonb;
BEGIN
  SELECT COUNT(*) INTO v_votes_count FROM climate_vote.votes;
  SELECT COUNT(*) INTO v_rounds_count FROM climate_vote.rounds;
  SELECT COUNT(*) INTO v_archive_log_count FROM climate_vote.archive_log;

  v_payload := jsonb_build_object(
    'votes',       COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM climate_vote.votes v), '[]'::jsonb),
    'rounds',      COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY sort_order) FROM climate_vote.rounds r), '[]'::jsonb),
    'archive_log', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM climate_vote.archive_log l), '[]'::jsonb),
    -- ADDITIVE: 캔버스(권고안 원천) + 집계 뷰
    'agenda',      COALESCE((SELECT jsonb_agg(to_jsonb(a)  ORDER BY a.id)  FROM climate_vote.agenda a), '[]'::jsonb),
    'agenda_link', COALESCE((SELECT jsonb_agg(to_jsonb(al) ORDER BY al.id) FROM climate_vote.agenda_link al), '[]'::jsonb),
    'agenda_vote', COALESCE((SELECT jsonb_agg(to_jsonb(av) ORDER BY av.id) FROM climate_vote.agenda_vote av), '[]'::jsonb),
    'tally',       COALESCE((SELECT jsonb_agg(to_jsonb(t))                 FROM climate_vote.tally t), '[]'::jsonb)
  );

  INSERT INTO climate_vote.snapshots (label, source, votes_count, rounds_count, archive_log_count, payload)
  VALUES (p_label, p_source, v_votes_count, v_rounds_count, v_archive_log_count, v_payload)
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'id', v_id,
    'taken_at', NOW(),
    'votes', v_votes_count,
    'rounds', v_rounds_count,
    'archive_log', v_archive_log_count,
    'bytes', length(v_payload::text)
  );
END $function$;
