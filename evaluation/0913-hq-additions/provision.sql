-- Execute manually in the project's Supabase SQL Editor.
-- Enter the requested initial password only in the editor; do not save it.
-- This transaction refuses to overwrite any existing operator or credential.
begin;
do $provision$
declare
  v_password text := 'ENTER_INITIAL_PASSWORD_HERE';
  v_name text;
  v_names text[] := array['한만목','김상규','김진우'];
begin
  if v_password = 'ENTER_INITIAL_PASSWORD_HERE' or length(v_password) = 0 then
    raise exception 'Enter the user-approved initial password before execution';
  end if;
  if exists(select 1 from climate_vote.hq_operator where name = any(v_names))
     or exists(select 1 from climate_vote.attendance_secret where secret_key = any(array['hq:한만목','hq:김상규','hq:김진우'])) then
    raise exception 'An operator or credential already exists; inspect before proceeding';
  end if;
  foreach v_name in array v_names loop
    insert into climate_vote.hq_operator(name, default_subgroup, active, must_change_password)
    values(v_name, null, true, false);
    insert into climate_vote.attendance_secret(secret_key, secret_hash)
    values('hq:' || v_name, extensions.crypt(v_password, extensions.gen_salt('bf',10)));
  end loop;
end
$provision$;
select name, active, default_subgroup, must_change_password
from climate_vote.hq_operator
where name in ('한만목','김상규','김진우')
order by name;
commit;
-- After execution clear the editor and remove the saved snippet/history entry.
