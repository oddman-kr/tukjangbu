-- 용돈 주기: 매달 또는 매주 (자녀는 남은 용돈이 50% 이하이면 부모에게 알림)
alter table public.members add column if not exists allowance_period text not null default '월' check (allowance_period in ('월','주'));
drop function if exists public.set_allowance(uuid, bigint);
create or replace function public.set_allowance(p_member uuid, p_amount bigint, p_period text default '월') returns void
language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  select household_id into hh from public.members where id = p_member;
  if hh is null or not private.is_adult(hh) then raise exception '용돈은 어른만 정할 수 있어요'; end if;
  if p_period not in ('월','주') then raise exception '용돈 주기는 매달 또는 매주예요'; end if;
  update public.members set monthly_allowance = greatest(0, p_amount), allowance_period = p_period where id = p_member;
end $$;
revoke execute on function public.set_allowance(uuid, bigint, text) from public, anon;
grant execute on function public.set_allowance(uuid, bigint, text) to authenticated;
