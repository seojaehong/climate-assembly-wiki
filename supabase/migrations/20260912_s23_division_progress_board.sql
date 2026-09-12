-- s23: 9/12-13 division agenda progress board.
-- Additive only: the eight discussion_topic rows remain the workshop stages.
-- The 9/8/8 agenda catalog, assignment history, and per-stage progress history
-- live beside the existing submission tables and never rewrite them.

begin;

create table if not exists climate_vote.agenda_item (
  id uuid primary key,
  session_id uuid not null references climate_vote.session(id),
  subgroup text not null check (subgroup in ('1분과','2분과','3분과')),
  ordinal int not null check (ordinal between 1 and 20),
  title text not null check (length(trim(title)) between 1 and 300),
  suggested_team_numbers int[] not null default '{}',
  source_sha256 text not null check (source_sha256 ~ '^[0-9A-F]{64}$'),
  created_at timestamptz not null default now(),
  unique (session_id, subgroup, ordinal)
);

create table if not exists climate_vote.agenda_source_utterance (
  id bigint generated always as identity primary key,
  agenda_id uuid not null references climate_vote.agenda_item(id),
  ordinal int not null check (ordinal between 1 and 100),
  content text not null check (length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (agenda_id, ordinal)
);

create table if not exists climate_vote.agenda_assignment_event (
  id bigint generated always as identity primary key,
  session_id uuid not null references climate_vote.session(id),
  agenda_id uuid not null references climate_vote.agenda_item(id),
  team_id uuid not null references climate_vote.team(id),
  assigned boolean not null,
  actor_scope text not null check (actor_scope = 'hq'),
  actor_label text not null,
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index if not exists agenda_assignment_latest_idx
  on climate_vote.agenda_assignment_event(session_id, agenda_id, team_id, id desc);

create table if not exists climate_vote.agenda_progress_event (
  id bigint generated always as identity primary key,
  session_id uuid not null references climate_vote.session(id),
  topic_id uuid not null references climate_vote.discussion_topic(id),
  agenda_id uuid not null references climate_vote.agenda_item(id),
  team_id uuid not null references climate_vote.team(id),
  action text not null check (action in (
    'start','save','confirm','submit','revision_request','reopen'
  )),
  status text not null check (status in (
    'waiting','discussing','drafting','team_confirmed','submitted'
  )),
  public_draft text check (public_draft is null or length(public_draft) <= 4000),
  feedback text check (feedback is null or length(feedback) <= 1000),
  actor_scope text not null check (actor_scope in ('team','hq')),
  actor_label text not null,
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index if not exists agenda_progress_latest_idx
  on climate_vote.agenda_progress_event(
    session_id, topic_id, agenda_id, team_id, id desc
  );

create or replace function climate_vote.agenda_event_append_only_guard()
returns trigger
language plpgsql
set search_path = climate_vote, pg_temp as $fn$
begin
  raise exception 'agenda event history is append-only';
end $fn$;
revoke all on function climate_vote.agenda_event_append_only_guard()
  from public, anon, authenticated;

drop trigger if exists agenda_assignment_event_append_only
  on climate_vote.agenda_assignment_event;
create trigger agenda_assignment_event_append_only
before update or delete on climate_vote.agenda_assignment_event
for each row execute function climate_vote.agenda_event_append_only_guard();
drop trigger if exists agenda_assignment_event_no_truncate
  on climate_vote.agenda_assignment_event;
create trigger agenda_assignment_event_no_truncate
before truncate on climate_vote.agenda_assignment_event
for each statement execute function climate_vote.agenda_event_append_only_guard();

drop trigger if exists agenda_progress_event_append_only
  on climate_vote.agenda_progress_event;
create trigger agenda_progress_event_append_only
before update or delete on climate_vote.agenda_progress_event
for each row execute function climate_vote.agenda_event_append_only_guard();
drop trigger if exists agenda_progress_event_no_truncate
  on climate_vote.agenda_progress_event;
create trigger agenda_progress_event_no_truncate
before truncate on climate_vote.agenda_progress_event
for each statement execute function climate_vote.agenda_event_append_only_guard();

alter table climate_vote.agenda_item enable row level security;
alter table climate_vote.agenda_source_utterance enable row level security;
alter table climate_vote.agenda_assignment_event enable row level security;
alter table climate_vote.agenda_progress_event enable row level security;

revoke all on climate_vote.agenda_item,
  climate_vote.agenda_source_utterance,
  climate_vote.agenda_assignment_event,
  climate_vote.agenda_progress_event
from public, anon, authenticated;

do $seed$
declare
  v_session_id uuid;
begin
  select id into v_session_id
    from climate_vote.session
   where slug='0912-deliberation' and status='active';
  if v_session_id is null then
    raise exception 's23 refused: active 0912-deliberation session not found';
  end if;

  create temporary table agenda_seed (
    id uuid, subgroup text, ordinal int, title text,
    suggested_team_numbers int[], source_sha256 text, utterances jsonb
  ) on commit drop;

  insert into agenda_seed values
    ('91210000-0000-4000-8000-000000000001','1분과',1,'세제혜택·인센티브 등 기업 지원 제도','{1,2,3,4,5}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["친환경적으로 노력하는 기업에게 비용을 지원해주는 접근이 어떨까 싶다.","기업이 탄소배출 감소로 얻는 메리트나 탄소배출 증가로 얻는 리스크가 적은 게 문제다.","인센티브와 브랜드 이미지 제고가 기업 경쟁력으로 이어질 수 있다."]'),
    ('91210000-0000-4000-8000-000000000002','1분과',2,'중소기업 맞춤형 지원 체계','{1,2,3,4}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["대기업보다 재정이 취약한 기업체를 대상으로 지원과 홍보가 필요하다.","중소기업은 기술력이나 인프라가 없어 감축을 못하고 있다."]'),
    ('91210000-0000-4000-8000-000000000003','1분과',3,'정책 일관성 확보·전담기구·중장기 로드맵','{1,2,3,4,5}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["정권이 바뀌더라도 지속적으로 갈 수 있는 목표와 체계가 필요하다.","정부 정책의 불확실성 때문에 기업의 설비투자가 어려워진다."]'),
    ('91210000-0000-4000-8000-000000000004','1분과',4,'탄소정보 공개·인증제 강화','{1,2,3,5}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["친환경 제품인지 확인할 수 있도록 사후 검증이 필요하다.","소비자가 ESG를 준수하는 회사와 그렇지 않은 회사를 구분할 제도가 필요하다."]'),
    ('91210000-0000-4000-8000-000000000005','1분과',5,'배출권거래제 개선','{1,2,3,4,5}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["배출권을 구매하는 것에 그치지 않고 실제 배출량을 줄이도록 제도를 개선해야 한다.","배출권 무상 할당과 기준·가이드라인을 다시 살펴볼 필요가 있다."]'),
    ('91210000-0000-4000-8000-000000000006','1분과',6,'재생에너지·전력 인프라 투자','{1,2,3,4}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["재생에너지와 친환경 설비의 초기 투자비용 부담을 줄여야 한다.","지역별 전력 가용량을 고려한 전력 인프라와 요금 체계가 필요하다."]'),
    ('91210000-0000-4000-8000-000000000007','1분과',7,'소비자 연계 유인책','{1,2,3,4,5}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["텀블러 이용처럼 탄소를 줄이는 행동에 직접적인 혜택이 필요하다.","저소득층도 친환경 제품을 선택할 수 있도록 형평성을 함께 고려해야 한다."]'),
    ('91210000-0000-4000-8000-000000000008','1분과',8,'기업 내부 인식·교육 강화','{1,2,3,4,5}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["기업 구성원이 탄소배출을 줄여야 한다는 인식을 갖도록 교육이 필요하다.","각 기업과 사람에게 실제로 와닿는 맞춤형 교육과 홍보가 필요하다."]'),
    ('91210000-0000-4000-8000-000000000009','1분과',9,'탄소포집 등 R&D·신소재 지원','{2,3}','8D82996A8AE6777A0EFC63BDA15AFBCE950838F0B2C54EFEB00D091ACFE41EFB','["효과적인 탄소포집 기술을 개발하고 안전하게 재사용할 방법을 연구해야 한다.","공정 자체에서 탄소가 발생하는 산업에는 감축기술 개발이 필요하다."]'),
    ('91220000-0000-4000-8000-000000000001','2분과',1,'다회용기·리필 시스템 확대','{1,2,3,4,5}','BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0','["음식점에서 개인 다회용기로 음식을 가져갈 수 있는 시스템이 필요하다.","생활용품을 필요한 만큼 소분·구매할 수 있는 리필 문화가 일상화되면 좋겠다."]'),
    ('91220000-0000-4000-8000-000000000002','2분과',2,'분리배출 기준 전국 표준화','{2,3,5}','BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0','["재활용품 분리배출과 선별 기준이 지자체마다 달라 혼란과 비용이 커진다.","소비자가 재활용 가능 여부를 쉽게 알 수 있는 단순한 표시가 필요하다."]'),
    ('91220000-0000-4000-8000-000000000003','2분과',3,'생산자책임 강화·포장재 규제(EPR)','{1,2,3,4,5}','BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0','["여러 재질이 섞인 과도한 포장재는 분리배출을 어렵게 한다.","일회용품을 대량 생산·유통하는 기업의 환경 책임을 강화해야 한다."]'),
    ('91220000-0000-4000-8000-000000000004','2분과',4,'보상·포인트 제도','{1,2,3,4,5}','BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0','["친환경 행동의 불편을 감수할 수 있도록 보상이나 포인트가 필요하다.","일회용품 대신 장바구니를 사용하는 개인에게 혜택을 줄 필요가 있다."]'),
    ('91220000-0000-4000-8000-000000000005','2분과',5,'재활용 처리 결과 투명 공개','{}','BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0','["시민이 분리배출한 뒤 실제로 어떻게 처리되고 얼마나 재활용되는지 투명하게 공개해야 한다."]'),
    ('91220000-0000-4000-8000-000000000006','2분과',6,'로컬푸드·공유경제·커뮤니티 순환','{1,2}','BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0','["먹거리의 유통·보관 거리가 길어지며 불필요한 포장재가 늘어난다.","물건을 버리기보다 수리하거나 중고거래로 순환하는 문화가 필요하다."]'),
    ('91220000-0000-4000-8000-000000000007','2분과',7,'수리권 보장·내구재 장기사용 촉진','{1,3,4,5}','BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0','["수리해서 다시 쓸 수 있는 제품도 새 제품으로 바꾸는 경우가 많다.","부품만 바꾸면 되는데 전체를 교체하게 만드는 생산 방식이 문제다."]'),
    ('91220000-0000-4000-8000-000000000008','2분과',8,'스마트 기술 기반 분류','{4}','BC5C96655F71752DF531DAC51582AB06D3A7378D184616EB9A0AD8926445F6B0','["스마트 분류함이 재질을 자동으로 분석·분류하면 분리배출의 노동과 고민을 줄일 수 있다."]'),
    ('91230000-0000-4000-8000-000000000001','3분과',1,'생애주기별 의무 환경교육 체계화','{1,2,3,4,5}','158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3','["어린이부터 성인까지 생애주기에 맞는 정기적인 환경교육이 필요하다.","반복되는 교육이 올바른 인식과 자연스러운 실천으로 연결되면 좋겠다."]'),
    ('91230000-0000-4000-8000-000000000002','3분과',2,'체험형·재미있는 콘텐츠 개발','{1,2,3,5}','158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3','["앉아서 듣는 환경교육보다 몸으로 체험하고 재미를 느낄 수 있는 교육이 필요하다.","재활용센터 같은 기존 공간을 활용한 실습형 교육을 확대하면 좋겠다."]'),
    ('91230000-0000-4000-8000-000000000003','3분과',3,'참여 인센티브·포인트 제도','{1,2,3,4,5}','158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3','["환경 보호 행동을 했을 때 포인트나 보상을 주는 방식이 필요하다.","강요와 규제만이 아니라 실천동기를 높일 보상 체계가 필요하다."]'),
    ('91230000-0000-4000-8000-000000000004','3분과',4,'전문 강사·교육 인프라·예산 확충','{2,5}','158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3','["지속적으로 운영할 수 있는 전문 강사와 프로그램이 부족하다.","환경 교과를 담당할 별도의 전문 교사를 배치하면 좋겠다."]'),
    ('91230000-0000-4000-8000-000000000005','3분과',5,'환경교과 정규화·입시 반영','{1,3}','158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3','["정규 교과수업에서 환경 수업이 부족하다.","환경 과목의 중요도를 높여 학생들의 관심과 지식을 넓힐 필요가 있다."]'),
    ('91230000-0000-4000-8000-000000000006','3분과',6,'미디어·홍보 캠페인 강화','{1,2,3,4,5}','158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3','["인플루언서와 다양한 미디어를 활용해 환경교육과 실천을 알릴 필요가 있다.","이론보다 생활 속 실천으로 이어지는 홍보가 부족하다."]'),
    ('91230000-0000-4000-8000-000000000007','3분과',7,'정책결정자 대상 전문교육','{2,4}','158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3','["공무원과 정책결정자가 기후환경을 어떻게 이해하고 정책에 반영하는지 점검할 필요가 있다."]'),
    ('91230000-0000-4000-8000-000000000008','3분과',8,'지역사회 기반 접근성 확대','{2,3,5}','158A3B1946B8BC5FFA64CBE4980F18854C15A007CAFE6E28666DF4E5E2E6BBB3','["주민센터처럼 시민이 쉽게 접할 수 있는 곳에서 환경교육을 제공해야 한다.","지역별 참여단과 생활권 교육을 확대해 누구나 쉽게 참여할 수 있게 해야 한다."]');

  insert into climate_vote.agenda_item(
    id,session_id,subgroup,ordinal,title,suggested_team_numbers,source_sha256
  )
  select id,v_session_id,subgroup,ordinal,title,suggested_team_numbers,source_sha256
    from agenda_seed
  on conflict (id) do update set
    subgroup=excluded.subgroup,
    ordinal=excluded.ordinal,
    title=excluded.title,
    suggested_team_numbers=excluded.suggested_team_numbers,
    source_sha256=excluded.source_sha256;

  insert into climate_vote.agenda_source_utterance(agenda_id,ordinal,content)
  select s.id,u.ordinal,u.content
    from agenda_seed s
    cross join lateral jsonb_array_elements_text(s.utterances)
      with ordinality as u(content,ordinal)
  on conflict (agenda_id,ordinal) do update set content=excluded.content;

  if (select count(*) from climate_vote.agenda_item where session_id=v_session_id) <> 25 then
    raise exception 's23 failed: expected 25 agenda rows';
  end if;
  if exists (
    select 1 from (
      select subgroup,count(*) n from climate_vote.agenda_item
       where session_id=v_session_id group by subgroup
    ) counts
    where (subgroup='1분과' and n<>9)
       or (subgroup in ('2분과','3분과') and n<>8)
  ) then
    raise exception 's23 failed: expected 9/8/8 agenda distribution';
  end if;
end
$seed$;

create or replace function climate_vote.agenda_board_v1(
  p_token text, p_session_slug text)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_team_subgroup text;
  v_active_topic_id uuid;
  v_result jsonb;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  if p_session_slug is distinct from '0912-deliberation' then
    raise exception 'agenda board session mismatch';
  end if;
  select id into v_session_id from climate_vote.session
   where slug=p_session_slug and status='active';
  if v_session_id is null then raise exception 'active agenda session required'; end if;
  if v_auth.session_id is distinct from v_session_id then
    raise exception 'agenda board token session mismatch';
  end if;
  if v_auth.scope='team' then
    select subgroup into v_team_subgroup from climate_vote.team
     where id=v_auth.team_id and session_id=v_session_id and status='active';
    if v_team_subgroup is null then raise exception 'team outside agenda session'; end if;
  elsif v_auth.scope<>'hq' then
    raise exception 'agenda board authorization required';
  end if;

  select id into v_active_topic_id from climate_vote.discussion_topic
   where session_id=v_session_id and status='open'
   order by ordinal limit 1;

  select jsonb_build_object(
    'sessionSlug',p_session_slug,
    'scope',v_auth.scope,
    'teamId',v_auth.team_id,
    'activeStage',(
      select jsonb_build_object('id',dt.id,'ordinal',dt.ordinal,'prompt',dt.prompt,'status',dt.status)
      from climate_vote.discussion_topic dt where dt.id=v_active_topic_id
    ),
    'stages',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',dt.id,'ordinal',dt.ordinal,'prompt',dt.prompt,'status',dt.status
      ) order by dt.ordinal)
      from climate_vote.discussion_topic dt
      where dt.session_id=v_session_id and dt.status<>'archived'
    ),'[]'::jsonb),
    'teams',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',t.id,'name',t.name,'subgroup',t.subgroup,'tableNo',t.table_no
      ) order by t.subgroup,t.name)
      from climate_vote.team t
      where t.session_id=v_session_id and t.status='active'
        and (v_auth.scope='hq' or t.id=v_auth.team_id)
    ),'[]'::jsonb),
    'agendas',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ai.id,
        'subgroup',ai.subgroup,
        'ordinal',ai.ordinal,
        'title',ai.title,
        'suggestedTeamNumbers',to_jsonb(ai.suggested_team_numbers),
        'sourceUtterances',coalesce((
          select jsonb_agg(su.content order by su.ordinal)
          from climate_vote.agenda_source_utterance su where su.agenda_id=ai.id
        ),'[]'::jsonb),
        'assignments',coalesce((
          select jsonb_agg(jsonb_build_object(
            'teamId',latest.team_id,
            'teamName',t.name,
            'status',coalesce(progress.status,'waiting'),
            'publicDraft',progress.public_draft,
            'feedback',progress.feedback,
            'updatedAt',coalesce(progress.created_at,latest.created_at)
          ) order by t.name)
          from (
            select distinct on (e.team_id)
              e.team_id,e.assigned,e.created_at
            from climate_vote.agenda_assignment_event e
            where e.session_id=v_session_id and e.agenda_id=ai.id
            order by e.team_id,e.id desc
          ) latest
          join climate_vote.team t on t.id=latest.team_id
          left join lateral (
            select p.status,p.public_draft,p.feedback,p.created_at
            from climate_vote.agenda_progress_event p
            where p.session_id=v_session_id
              and p.topic_id=v_active_topic_id
              and p.agenda_id=ai.id and p.team_id=latest.team_id
            order by p.id desc limit 1
          ) progress on true
          where latest.assigned
            and (v_auth.scope='hq' or latest.team_id=v_auth.team_id)
        ),'[]'::jsonb)
      ) order by ai.subgroup,ai.ordinal)
      from climate_vote.agenda_item ai
      where ai.session_id=v_session_id
        and (v_auth.scope='hq' or ai.subgroup=v_team_subgroup)
        and (
          v_auth.scope='hq'
          or true=(
            select e.assigned from climate_vote.agenda_assignment_event e
            where e.session_id=v_session_id and e.agenda_id=ai.id
              and e.team_id=v_auth.team_id
            order by e.id desc limit 1
          )
        )
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $fn$;

create or replace function climate_vote.agenda_assignment_set_v1(
  p_token text, p_session_slug text, p_agenda_id uuid, p_team_id uuid,
  p_assigned boolean, p_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_subgroup text;
  v_team_subgroup text;
  v_prior climate_vote.agenda_assignment_event;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  if v_auth.scope<>'hq' then raise exception 'HQ authorization required'; end if;
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  select * into v_prior from climate_vote.agenda_assignment_event
   where request_id=p_request_id;
  if found then
    return jsonb_build_object('id',v_prior.id,'assigned',v_prior.assigned);
  end if;
  select id into v_session_id from climate_vote.session
   where slug=p_session_slug and slug='0912-deliberation' and status='active';
  if v_session_id is null then raise exception 'agenda assignment session mismatch'; end if;
  if v_auth.session_id is distinct from v_session_id then
    raise exception 'agenda assignment token session mismatch';
  end if;
  select subgroup into v_subgroup from climate_vote.agenda_item
   where id=p_agenda_id and session_id=v_session_id;
  select subgroup into v_team_subgroup from climate_vote.team
   where id=p_team_id and session_id=v_session_id and status='active';
  if v_subgroup is null or v_team_subgroup is null then
    raise exception 'agenda or team outside selected session';
  end if;
  if v_subgroup<>v_team_subgroup then raise exception 'cross-division assignment denied'; end if;
  insert into climate_vote.agenda_assignment_event(
    session_id,agenda_id,team_id,assigned,actor_scope,actor_label,request_id
  ) values(
    v_session_id,p_agenda_id,p_team_id,p_assigned,'hq',v_auth.actor_label,p_request_id
  ) returning * into v_prior;
  return jsonb_build_object('id',v_prior.id,'assigned',v_prior.assigned);
end $fn$;

create or replace function climate_vote.agenda_progress_write_v1(
  p_token text, p_session_slug text, p_topic_id uuid, p_agenda_id uuid,
  p_team_id uuid, p_action text, p_public_draft text,
  p_feedback text, p_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = climate_vote, extensions, pg_temp as $fn$
declare
  v_auth climate_vote.attendance_auth_session;
  v_session_id uuid;
  v_current_status text:='waiting';
  v_current_draft text;
  v_current_feedback text;
  v_next_status text;
  v_assigned boolean:=false;
  v_topic_status text;
  v_prior climate_vote.agenda_progress_event;
begin
  v_auth:=climate_vote.attendance_token_row(p_token);
  if p_request_id is null then raise exception 'idempotency key required'; end if;
  select id into v_session_id from climate_vote.session
   where slug=p_session_slug and slug='0912-deliberation' and status='active';
  if v_session_id is null then raise exception 'agenda progress session mismatch'; end if;
  if v_auth.session_id is distinct from v_session_id then
    raise exception 'agenda progress token session mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'agenda-progress:'||p_topic_id::text||':'||p_agenda_id::text||':'||p_team_id::text,0));
  select * into v_prior from climate_vote.agenda_progress_event where request_id=p_request_id;
  if found then
    return jsonb_build_object('id',v_prior.id,'status',v_prior.status,'updatedAt',v_prior.created_at);
  end if;
  if not exists(select 1 from climate_vote.agenda_item where id=p_agenda_id and session_id=v_session_id)
     or not exists(select 1 from climate_vote.team where id=p_team_id and session_id=v_session_id and status='active') then
    raise exception 'agenda or team outside selected session';
  end if;
  select status into v_topic_status from climate_vote.discussion_topic
   where id=p_topic_id and session_id=v_session_id and status<>'archived';
  if v_topic_status is null then raise exception 'workflow stage outside selected session'; end if;
  if v_auth.scope='team' and (v_auth.team_id is distinct from p_team_id or v_topic_status<>'open') then
    raise exception 'team progress authorization required';
  end if;
  if v_auth.scope='hq' and p_action not in ('revision_request','reopen') then
    raise exception 'HQ may only request revision or reopen';
  elsif v_auth.scope='team' and p_action not in ('start','save','confirm','submit') then
    raise exception 'team progress action denied';
  elsif v_auth.scope not in ('team','hq') then
    raise exception 'agenda progress authorization required';
  end if;

  select assigned into v_assigned from climate_vote.agenda_assignment_event
   where session_id=v_session_id and agenda_id=p_agenda_id and team_id=p_team_id
   order by id desc limit 1;
  if not coalesce(v_assigned,false) then raise exception 'agenda is not assigned to this team'; end if;

  select status,public_draft,feedback
    into v_current_status,v_current_draft,v_current_feedback
    from climate_vote.agenda_progress_event
   where session_id=v_session_id and topic_id=p_topic_id
     and agenda_id=p_agenda_id and team_id=p_team_id
   order by id desc limit 1;
  if not found then v_current_status:='waiting'; end if;

  case p_action
    when 'start' then
      if v_current_status not in ('waiting','discussing') then raise exception 'invalid start transition'; end if;
      v_next_status:='discussing';
    when 'save' then
      if length(trim(coalesce(p_public_draft,'')))=0 then raise exception 'public draft required'; end if;
      if length(p_public_draft)>4000 then raise exception 'public draft too long'; end if;
      if v_current_status='submitted' then raise exception 'submitted agenda requires HQ revision'; end if;
      v_current_draft:=trim(p_public_draft); v_current_feedback:=null; v_next_status:='drafting';
    when 'confirm' then
      if v_current_status<>'drafting' or length(trim(coalesce(v_current_draft,'')))=0 then
        raise exception 'draft required before team confirmation';
      end if;
      v_next_status:='team_confirmed';
    when 'submit' then
      if v_current_status<>'team_confirmed' then raise exception 'team confirmation required before submit'; end if;
      v_next_status:='submitted';
    when 'revision_request' then
      if v_current_status not in ('team_confirmed','submitted') then raise exception 'confirmed agenda required for revision'; end if;
      if length(trim(coalesce(p_feedback,'')))<2 then raise exception 'revision feedback required'; end if;
      v_current_feedback:=trim(p_feedback); v_next_status:='drafting';
    when 'reopen' then
      if v_current_status not in ('team_confirmed','submitted') then raise exception 'confirmed agenda required to reopen'; end if;
      v_current_feedback:=null; v_next_status:='drafting';
    else raise exception 'unknown agenda progress action';
  end case;

  insert into climate_vote.agenda_progress_event(
    session_id,topic_id,agenda_id,team_id,action,status,public_draft,feedback,
    actor_scope,actor_label,request_id
  ) values(
    v_session_id,p_topic_id,p_agenda_id,p_team_id,p_action,v_next_status,
    v_current_draft,v_current_feedback,v_auth.scope,v_auth.actor_label,p_request_id
  ) returning * into v_prior;
  return jsonb_build_object('id',v_prior.id,'status',v_prior.status,'updatedAt',v_prior.created_at);
end $fn$;

grant execute on function climate_vote.agenda_board_v1(text,text) to anon, authenticated;
grant execute on function climate_vote.agenda_assignment_set_v1(text,text,uuid,uuid,boolean,uuid) to anon, authenticated;
grant execute on function climate_vote.agenda_progress_write_v1(text,text,uuid,uuid,uuid,text,text,text,uuid) to anon, authenticated;
revoke execute on function climate_vote.agenda_board_v1(text,text) from public;
revoke execute on function climate_vote.agenda_assignment_set_v1(text,text,uuid,uuid,boolean,uuid) from public;
revoke execute on function climate_vote.agenda_progress_write_v1(text,text,uuid,uuid,uuid,text,text,text,uuid) from public;

do $realtime$
begin
  begin
    alter publication supabase_realtime add table climate_vote.agenda_assignment_event;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table climate_vote.agenda_progress_event;
  exception when duplicate_object then null;
  end;
end
$realtime$;

commit;
