create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.my_member_id(uuid) set schema private;
alter function public.my_role(uuid) set schema private;
alter function public.is_member(uuid) set schema private;
alter function public.is_adult(uuid) set schema private;
alter function public.seat_limit(uuid) set schema private;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;
alter function private.seat_limit(uuid) set search_path = public;

create or replace function public.create_invite(p_household uuid, p_role text, p_display_name text, p_guardian_consent boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mid uuid; c text; used int; lim int;
begin
  if not private.is_adult(p_household) then raise exception '초대 권한이 없어요'; end if;
  if p_role not in ('adult','child') then raise exception '역할이 올바르지 않아요'; end if;
  if p_role = 'child' and not p_guardian_consent then raise exception '자녀 초대에는 법정대리인 동의가 필요해요'; end if;
  select count(*) into used from public.members where household_id = p_household;
  lim := private.seat_limit(p_household);
  if used >= lim then raise exception '요금제 인원(%)을 모두 사용했어요', lim; end if;
  insert into public.members(household_id, role, display_name, guardian_consent_by, guardian_consent_at)
    values (p_household, p_role, p_display_name, case when p_role = 'child' then uid end, case when p_role = 'child' then now() end)
    returning id into mid;
  c := upper(substr(translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=0O1Il', 'XYZ23456'), 1, 8));
  insert into public.invites(code, household_id, member_id, created_by) values (c, p_household, mid, uid);
  return c;
end $$;

create or replace function public.remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  select household_id into hh from public.members where id = p_member;
  if coalesce(private.my_role(hh), '') <> 'owner' then raise exception '대표만 구성원을 내보낼 수 있어요'; end if;
  if exists(select 1 from public.members where id = p_member and role = 'owner') then raise exception '대표는 내보낼 수 없어요'; end if;
  delete from public.members where id = p_member;
end $$;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.check_tx_member() from public, anon, authenticated;
