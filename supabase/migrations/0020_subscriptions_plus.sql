-- 플레이 결제·관리자 지급이 쓰는 plan 'plus', period 'comp' 허용 (전에는 제약에 막혀 저장이 안 됐어요)
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.subscriptions'::regclass and contype = 'c' and (pg_get_constraintdef(oid) like '%period%' or pg_get_constraintdef(oid) like '%plan%') loop
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.subscriptions add constraint subscriptions_plan_check check (plan in ('free','solo','duo','trio','family','plus'));
alter table public.subscriptions add constraint subscriptions_period_check check (period is null or period in ('month','year','comp'));
-- 앱 안내와 맞추기: 무료 2명, 체험·플러스는 최대 12명
create or replace function private.seat_limit(hh uuid) returns integer language sql stable security definer set search_path to 'public' as $$
  select case
    when h.trial_ends_at > now() then 12
    when s.status = 'active' and coalesce(s.plan, 'free') <> 'free' and (s.expires_at is null or s.expires_at > now()) then 12
    else 2 end
  from public.households h left join public.subscriptions s on s.household_id = h.id
  where h.id = hh
$$;
