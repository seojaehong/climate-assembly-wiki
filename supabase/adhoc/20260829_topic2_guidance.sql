-- 2026-08-29 현장 요청 — ②꼭지 안내문에서 「앞 꼭지와 짝이 맞는지 확인」 문장 삭제.
-- 이슈와 바라는 변화가 1:1로 맞지 않을 수 있다는 의견이 있어, 맞춰야 한다는 인상을
-- 주는 문장을 뺀다. 개수 관계만 남긴다.

update climate_vote.discussion_topic dt
   set guidance = '이 문제가 제대로 해결되었다면 무엇이 어떻게 달라져 있어야 하는가 — 도달 상태 문형(~된다, ~한 상태가 된다)으로 적습니다. 정책수단이 아니라 상태를 씁니다. 이슈 하나에 바라는 변화 하나 이상으로 적습니다.'
  from climate_vote.session s
 where s.id = dt.session_id and s.slug = '0829-deliberation'
   and dt.ordinal = 2;

select ordinal, prompt, guidance
  from climate_vote.discussion_topic dt
  join climate_vote.session s on s.id = dt.session_id
 where s.slug = '0829-deliberation'
 order by ordinal;
