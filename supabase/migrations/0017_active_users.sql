-- 접속 기록(하루 1줄): DAU·WAU·MAU, 고착도, D1/D7/D30 잔존율 계산용
create table if not exists public.daily_active (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  household_id uuid references public.households(id) on delete set null,
  platform text check (platform in ('android','web')),
  first_at timestamptz not null default now(),
  primary key (user_id, day)
);
create index if not exists daily_active_day on public.daily_active(day);
alter table public.daily_active enable row level security;

-- 앱이 하루 한 번 부르는 함수: 자기 접속만 남길 수 있어요
create or replace function public.touch_active(p_platform text default 'web') returns void language sql security definer set search_path = '' as $$
  insert into public.daily_active(user_id, day, household_id, platform)
  select auth.uid(), (now() at time zone 'Asia/Seoul')::date,
         (select household_id from public.members where user_id = auth.uid() limit 1),
         case when p_platform = 'android' then 'android' else 'web' end
  where auth.uid() is not null
  on conflict (user_id, day) do nothing;
$$;
revoke all on function public.touch_active(text) from public, anon;
grant execute on function public.touch_active(text) to authenticated;

create or replace function public.admin_active() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not private.is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  select jsonb_build_object(
    'dau', (select count(*) from public.daily_active where day = today),
    'wau', (select count(distinct user_id) from public.daily_active where day > today - 7),
    'mau', (select count(distinct user_id) from public.daily_active where day > today - 30),
    'dau_avg30', (select round(coalesce(avg(n), 0), 1) from (select g.d, (select count(*) from public.daily_active a where a.day = g.d) n from generate_series(today - 29, today, interval '1 day') g(d)) x),
    'android_30', (select count(distinct user_id) from public.daily_active where day > today - 30 and platform = 'android'),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('d', to_char(g.d, 'MM-DD'), 'n', (select count(*) from public.daily_active a where a.day = g.d)) order by g.d), '[]')
      from generate_series(today - 29, today, interval '1 day') g(d)),
    'mau_series', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n) order by m), '[]') from (
      select to_char(day, 'YYYY-MM') m, count(distinct user_id) n from public.daily_active where day > today - 186 group by 1) z),
    -- 가입한 날 기준 N일째에 다시 들어온 비율 (D1/D7/D30), 최근 90일 가입자
    'retention', (select jsonb_build_object(
      'd1', jsonb_build_object('base', count(*) filter (where s <= today - 1), 'kept', count(*) filter (where s <= today - 1 and exists (select 1 from public.daily_active a where a.user_id = x.id and a.day = s + 1))),
      'd7', jsonb_build_object('base', count(*) filter (where s <= today - 7), 'kept', count(*) filter (where s <= today - 7 and exists (select 1 from public.daily_active a where a.user_id = x.id and a.day = s + 7))),
      'd30', jsonb_build_object('base', count(*) filter (where s <= today - 30), 'kept', count(*) filter (where s <= today - 30 and exists (select 1 from public.daily_active a where a.user_id = x.id and a.day = s + 30)))
    ) from (select u.id, (u.created_at at time zone 'Asia/Seoul')::date s from auth.users u where u.created_at > now() - interval '90 days') x),
    'since', (select min(day) from public.daily_active)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_active() from public, anon;
grant execute on function public.admin_active() to authenticated;
