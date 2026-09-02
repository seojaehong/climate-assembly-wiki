-- s20: 9/12~13 6·7차 조별 입력 꼭지 6건 등재 (status='draft' — 여는 것은 행사 당일)
-- project: labor_money (pleyuknjnprsckssxvrh), schema: climate_vote
--
-- ── 왜 필요한가 ──────────────────────────────────────────────────────
-- `10_작업산출물/2026-09-12_0912_개통/0912_개통_세션조.sql` 이 세션 `0912-deliberation`
-- 과 조 15개(`091201`~`091215`)를 만든다. 거기까지만 하면 조가 링크로 들어와도
-- 입력할 주제가 하나도 안 보인다 — `topic_list` 가 `discussion_topic` 을 읽는데
-- 그 세션에 행이 0개이기 때문이다(8.29 전야에 겪은 것과 같은 상태,
-- `20260827_s6_open_0829_topics.sql` 머리말 참조).
--
-- ── 무엇을 하나 ──────────────────────────────────────────────────────
-- 세션 `0912-deliberation` 에 `discussion_topic` 6행을 `ordinal` 1~6 으로 심는다.
-- 스키마 변경 없음 — s1 의 `discussion_topic`/`submission` 구조와 RPC 를 그대로 쓴다.
--
-- ── 꼭지 정본 근거 ───────────────────────────────────────────────────
-- 전부 `10_작업산출물/5-9차_운영덱/2026-06-18_운영_세부계획_v2.md` 의
-- 「§6. 6·7차(9/12-13) 종합 분과토론(합숙) — 풀뎁스 큐시트」에서 끌어왔다.
-- `prompt` 는 큐시트 **결과물** 칸, `guidance` 는 **세션명·시각·수행과정** 칸이다.
-- 새 개념·새 기준을 만들지 않았다.
--
--   ① 13:30-15:30 이해관계자 의견청취(분과별 3명)+질의응답 → 결과물 「쟁점·입장 메모」
--   ② 15:50-17:50 분과별 제안정책 만들기(조별 발산)       → 결과물 「조별 제안정책 초안」
--   ③ 19:30-20:30 권고안 선정기준 합의(전체)              → 수행과정 「조별 선정기준 발산」
--      ★ 이 세션의 결과물 칸은 「권고안 선정기준 합의안」이지만 그것은 **전체 합의**의
--        산출이다. 조가 시스템에 넣는 것은 그 앞 단계인 조별 발산이라 제목을 그 층위로 적었다.
--   ④ 09:20-11:20 제안정책 장단점(분과 교차 토론)         → 결과물 「교차 검토표」
--   ⑤ 11:20-12:00 교차 검토 반영·제안정책 보완            → 결과물 「보완 제안정책안」
--   ⑥ 13:00-15:30 분과별 제안정책 최종 확정               → 결과물 「분과 제안정책(최종 확정)」
--
-- ★ `block` 은 `'am'|'pm'` 두 값뿐이라(`s1` 의 check 제약) **며칠인지를 담지 못한다.**
--   9/12 세 꼭지와 9/13 세 꼭지가 `block` 만으로는 구별되지 않으므로
--   「9/12(토) 1일차」·「9/13(일) 2일차」를 `guidance` 첫머리에 적는다.
--
-- ── ★ status='draft' 로 심는 이유 ────────────────────────────────────
-- `topic_list` 는 `status in ('open','closed')` 만 돌려준다(s1:151-162, s17 재정의).
-- draft 는 조 화면에 **안 보인다.** 6개를 미리 열어 두면 1일차 오전부터 6개가 다 보여
-- 조가 순서를 앞질러 쓴다. 행사 당일 세션이 시작될 때 하나씩 연다 —
-- 여는 SQL 은 `10_작업산출물/2026-09-12_0912_개통/꼭지_열기.sql` 이다.
--
-- ★★ 그래서 s6 와 **한 군데가 다르다.** s6 는 on conflict 갱신절에서 `status = 'open'`
--    을 함께 박았다. 그 꼴을 그대로 베껴 `'draft'` 로 두면, 행사 당일 ①~③ 을 연 뒤
--    이 파일을 한 번만 다시 돌려도 **열려 있던 꼭지가 조용히 draft 로 되돌아가
--    조 화면에서 사라진다.** 그래서 갱신절은 문안(prompt·guidance·block)만 손대고
--    `status` 는 건드리지 않는다.
--      · 이 파일  = 문안의 주인
--      · 꼭지_열기 = status 의 주인
--
-- ── SAFETY ───────────────────────────────────────────────────────────
-- 8.29 를 읽지도 쓰지도 않는다. `0829-deliberation` 이라는 문자열이 이 파일에 없다.
-- 조 산출물(`submission`·`submission_item`)에 손대는 구문도 없다(AGENTS.md 「금지선」).
--
-- 멱등 — 다시 돌려도 `on conflict (session_id, ordinal)` 이 문안을 같은 값으로
-- 덮어쓸 뿐이다. 행이 늘지 않고, 열린 상태도 제출물도 그대로다.
--
-- ROLLBACK: supabase/rollbacks/20260902_s20_open_0912_topics_BEFORE.sql
-- VERIFY  : supabase/verify/20260902_s20_open_0912_topics.sql
--
-- ★ 선행 조건 — `0912_개통_세션조.sql` 이 **먼저** 적용돼 있어야 한다.
--   세션이 없으면 아래 do 블록이 예외로 멈춘다(조용히 0건 심는 일이 없게).
--
-- ★ 적용 후 검증(anon 키, Content-Profile: climate_vote 필수):
--   POST /rest/v1/rpc/topic_list {"p_code":"091201"}
--     → 200 `[]`  = **정상**. 6건이 draft 라 아직 안 보이는 것이 맞다
--     → 200 에 6건이 보이면 누군가 이미 열어 둔 것이다(행사 전이라면 확인할 것)

do $$
declare
  v_session uuid;
  v_org uuid;
  v_total int;
begin
  select id, org_id into v_session, v_org
    from climate_vote.session where slug = '0912-deliberation';
  if v_session is null then
    raise exception 's20: session 0912-deliberation not found — 0912_개통_세션조.sql 을 먼저 적용할 것';
  end if;

  -- 여섯 꼭지를 ordinal 1~6 에 고정한다.
  -- ((session_id, ordinal) 이 unique 이므로 이 upsert 가 곧 자리 고정이다.)
  insert into climate_vote.discussion_topic
         (session_id, ordinal, block, prompt, guidance, status, org_id)
  select v_session, v.ordinal, v.block, v.prompt, v.guidance, 'draft', v_org
  from (values
    (1, 'pm',
     '쟁점·입장 메모',
     '9/12(토) 1일차 13:30~15:30 · 이해관계자 의견청취(분과별 3명)+질의응답 — 분과 의제별 이해관계자 3명의 입장 발제를 듣고, 조에서 던진 질문과 질의응답에서 드러난 쟁점·입장을 적습니다. 조별 질문도 함께 남기십시오.'),
    (2, 'pm',
     '조별 제안정책 초안',
     '9/12(토) 1일차 15:50~17:50 · 분과별 제안정책 만들기(조별 발산) — 정책제안 일반론 발제를 듣고 분과 의제에 대한 정책을 조에서 발산해 적습니다. 적은 것을 분류·정리해 전체 나누기에 씁니다.'),
    (3, 'pm',
     '권고안 선정기준(조별 발산)',
     '9/12(토) 1일차 19:30~20:30 · 권고안 선정기준 합의(전체) — 권고안을 고를 때 무엇을 기준으로 삼을지 조에서 발산해 적습니다. 여기 적은 것을 군집·정리해 전체 합의로 넘깁니다.'),
    (4, 'am',
     '교차 검토표',
     '9/13(일) 2일차 09:20~11:20 · 제안정책 장단점(분과 교차 토론) — 타 분과 초안을 받아 조에서 장단점을 토론한 결과를 적습니다. 적은 것을 분류·정리해 전체 나누기에 씁니다.'),
    (5, 'am',
     '보완 제안정책안',
     '9/13(일) 2일차 11:20~12:00 · 교차 검토 반영·제안정책 보완 — 교차 검토에서 받은 의견을 우리 분과 초안에 반영·수정한 결과를 적습니다.'),
    (6, 'pm',
     '분과 제안정책(최종 확정)',
     '9/13(일) 2일차 13:00~15:30 · 분과별 제안정책 최종 확정 — 선정기준 대비 숙의한 뒤 분과 출석 2/3 으로 채택한 최종 확정본을 적습니다. 이의 처리 결과도 함께 남기십시오.')
  ) as v(ordinal, block, prompt, guidance)
  on conflict (session_id, ordinal) do update
    set prompt   = excluded.prompt,
        guidance = excluded.guidance,
        block    = excluded.block,
        org_id   = coalesce(discussion_topic.org_id, excluded.org_id);
        -- ★ status 는 일부러 뺐다 — 위 「s6 와 한 군데가 다르다」 참조.

  select count(*) into v_total
    from climate_vote.discussion_topic
   where session_id = v_session;
  if v_total <> 6 then
    raise exception 's20: expected 6 topics on 0912-deliberation, got %', v_total;
  end if;
end $$;

-- 확인 1 — 심긴 여섯 행 (status 는 이 시점에 전부 draft 여야 정상)
--   ★ `dt.` 접두사를 빼면 안 된다 — `session` 에도 `ordinal` 컬럼이 있어(s1 이 회차용으로
--     추가) 접두사 없는 `ordinal` 은 42702 「ambiguous」로 죽는다.
select dt.ordinal, dt.block, dt.status, dt.prompt
from climate_vote.discussion_topic dt
join climate_vote.session s on s.id = dt.session_id
where s.slug = '0912-deliberation'
order by dt.ordinal;

-- 확인 2 — 조 콘솔이 실제로 보게 되는 목록.
--   ★ 지금은 **0건이 정상**이다. draft 는 topic_list 가 걸러낸다.
--     행사 당일 꼭지_열기.sql 로 open 으로 바꾼 만큼만 여기에 나타난다.
select ordinal, block, status, prompt
from climate_vote.topic_list('091201')
order by ordinal;
