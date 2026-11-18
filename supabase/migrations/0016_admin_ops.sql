-- 운영 기능: 공지, 앱 운영 설정(최소 버전·점검·무료 한도), 의견 답변, 관리자 역할, 성장 지표
create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 80),
  body text check (body is null or char_length(body) <= 2000),
  level text not null default 'info' check (level in ('info','warn','event')),
  audience text not null default 'all' check (audience in ('all','free','paid')),
  link text check (link is null or link ~ '^https://'),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.notices enable row level security;
drop policy if exists notices_read on public.notices;
create policy notices_read on public.notices for select to anon, authenticated
  using (active and starts_at <= now() and (ends_at is null or ends_at > now()));

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.app_config enable row level security;
drop policy if exists app_config_read on public.app_config;
create policy app_config_read on public.app_config for select to anon, authenticated using (true);
insert into public.app_config(key, value) values
  ('min_version', '0'::jsonb),
  ('maintenance', '{"on": false, "message": ""}'::jsonb),
  ('free_limits', '{"members": 2, "ocr": 10}'::jsonb)
on conflict (key) do nothing;

alter table public.feedback add column if not exists reply text check (reply is null or char_length(reply) <= 2000);
alter table public.feedback add column if not exists replied_at timestamptz;
alter table public.feedback add column if not exists reply_seen boolean not null default false;
-- 이용자는 자기 의견의 '답변 읽음'만 표시할 수 있어요
create or replace function public.mark_feedback_seen() returns void language sql security definer set search_path = '' as $$
  update public.feedback set reply_seen = true where user_id = auth.uid() and reply is not null and not reply_seen;
$$;
revoke all on function public.mark_feedback_seen() from public, anon;
grant execute on function public.mark_feedback_seen() to authenticated;

alter table public.admin_emails add column if not exists role text not null default 'owner' check (role in ('owner','support'));

-- 성장 지표: 일별 활동 가족, 주별 가입 묶음의 재방문, 체험→유료 전환, 구독 목록
create or replace function public.admin_metrics() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not private.is_admin() then raise exception '관리자만 볼 수 있어요'; end if;
  select jsonb_build_object(
    'dau', (select coalesce(jsonb_agg(jsonb_build_object('d', to_char(g.d, 'MM-DD'), 'n',
        (select count(distinct t.household_id) from public.transactions t where (t.created_at at time zone 'Asia/Seoul')::date = g.d)) order by g.d), '[]')
      from generate_series(today - 29, today, interval '1 day') g(d)),
    'cohorts', (select coalesce(jsonb_agg(c order by c->>'week' desc), '[]') from (
      select jsonb_build_object('week', to_char(w, 'MM-DD'), 'size', count(*),
        'w1', count(*) filter (where exists (select 1 from public.members m join public.transactions t on t.household_id = m.household_id
               where m.user_id = u.id and t.created_by = u.id and t.created_at >= u.created_at + interval '7 days' and t.created_at < u.created_at + interval '14 days')),
        'w4', count(*) filter (where exists (select 1 from public.members m join public.transactions t on t.household_id = m.household_id
               where m.user_id = u.id and t.created_by = u.id and t.created_at >= u.created_at + interval '28 days' and t.created_at < u.created_at + interval '35 days')),
        'ripe1', w + 14 <= today, 'ripe4', w + 35 <= today) c
      from auth.users u, lateral (select date_trunc('week', (u.created_at at time zone 'Asia/Seoul'))::date w) x
      where u.created_at > now() - interval '10 weeks' and not coalesce(u.is_anonymous, false)
      group by w) z),
    'conversion', jsonb_build_object(
      'households_past_trial', (select count(*) from public.households where trial_ends_at <= now()),
      'paid_ever', (select count(distinct household_id) from public.subscriptions where source = 'play'),
      'paid_now', (select count(*) from public.subscriptions where source = 'play' and status = 'active' and (expires_at is null or expires_at > now())),
      'churned_30d', (select count(*) from public.subscriptions where source = 'play' and (status <> 'active' or expires_at <= now()) and updated_at > now() - interval '30 days'),
      'comp_now', (select count(*) from public.subscriptions where source = 'admin' and status = 'active' and expires_at > now())),
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('household_id', s.household_id, 'household', h.name, 'owner_id', h.owner_id, 'plan', s.plan, 'period', s.period,
        'status', s.status, 'source', s.source, 'product', s.product_id, 'expires_at', s.expires_at, 'updated_at', s.updated_at) order by s.updated_at desc), '[]')
      from public.subscriptions s left join public.households h on h.id = s.household_id where s.plan <> 'free'),
    'storage', jsonb_build_object('db_bytes', pg_database_size(current_database()),
      'files', (select count(*) from storage.objects),
      'file_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects))
  ) into r;
  return r;
end $$;
revoke all on function public.admin_metrics() from public, anon;
grant execute on function public.admin_metrics() to authenticated;

-- 관리자 역할 확인(화면에서 버튼을 숨기는 용도. 실제 권한 검사는 admin-api가 해요)
create or replace function public.my_admin_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.admin_emails where lower(email) = lower(auth.jwt()->>'email') limit 1;
$$;
revoke all on function public.my_admin_role() from public, anon;
grant execute on function public.my_admin_role() to authenticated;
