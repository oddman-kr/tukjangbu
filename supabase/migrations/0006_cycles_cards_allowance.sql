-- 정기 지출 주기(주·달·년·N일마다) + 미리 알림, 카드 색깔·주인, 구성원별 한 달 용돈
alter table public.recurring add column if not exists cycle text not null default '월' check (cycle in ('주','월','년','일'));
alter table public.recurring add column if not exists every smallint not null default 1 check (every between 1 and 365);
alter table public.recurring add column if not exists starts_on date not null default current_date;
alter table public.recurring add column if not exists remind_days smallint not null default 0 check (remind_days between 0 and 60);
alter table public.recurring add column if not exists created_at timestamptz not null default now();
alter table public.recurring alter column day drop not null;

alter table public.cards add column if not exists color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
alter table public.cards drop constraint if exists cards_kind_check;
alter table public.cards add constraint cards_kind_check check (kind in ('신용','체크','현금','계좌이체','페이','기타'));
-- 카드 이름·색은 자녀도 결제수단 표시에 필요해서 읽을 수 있게 (혜택·실적은 화면에서 어른만)
drop policy if exists cards_select on public.cards;
create policy cards_select on public.cards for select to authenticated using (private.is_member(household_id));

alter table public.members add column if not exists monthly_allowance bigint not null default 0 check (monthly_allowance >= 0);
-- 용돈 금액은 어른만 정할 수 있게 별도 함수로
create or replace function public.set_allowance(p_member uuid, p_amount bigint) returns void
language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  select household_id into hh from public.members where id = p_member;
  if hh is null or not private.is_adult(hh) then raise exception '용돈은 어른만 정할 수 있어요'; end if;
  update public.members set monthly_allowance = greatest(0, p_amount) where id = p_member;
end $$;
revoke execute on function public.set_allowance(uuid, bigint) from public, anon;
grant execute on function public.set_allowance(uuid, bigint) to authenticated;
