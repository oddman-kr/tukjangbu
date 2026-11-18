create extension if not exists pgcrypto;
create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen timestamptz
);
alter table public.device_tokens enable row level security;
create or replace function public.register_device(p_household uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  if auth.uid() is null or not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = auth.uid()) then
    raise exception '가족 정보를 찾지 못했어요';
  end if;
  t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.device_tokens(user_id, household_id, token_hash) values (auth.uid(), p_household, encode(extensions.digest(t, 'sha256'), 'hex'));
  delete from public.device_tokens where user_id = auth.uid() and id not in (select id from public.device_tokens where user_id = auth.uid() order by created_at desc limit 5);
  return t;
end $$;
revoke all on function public.register_device(uuid) from public, anon;
grant execute on function public.register_device(uuid) to authenticated;
