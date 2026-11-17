-- 첫 출시 기능: 한 달 시작일, 개인 용돈 숨기기, 고정·필수 카테고리, 할부, 가계부 여러 개, 실적 카드

-- 한 달 시작일 (월급날 기준)
alter table public.households add column if not exists month_start smallint not null default 1 check (month_start between 1 and 28);
grant update (name, kind, base_currency, month_start) on public.households to authenticated;

-- 개인 용돈 내용 숨기기 (가족에게는 금액만)
alter table public.members add column if not exists hide_personal boolean not null default false;
grant update (display_name, color, avatar_path, hide_personal) on public.members to authenticated;

-- 고정·필수 카테고리 (위시 '남은 생활 예산'에서 빠짐)
alter table public.categories add column if not exists fixed boolean not null default false;
update public.categories set fixed = true where name ~ '(주거|관리비|월세|통신|보험|대출|이자|세금|공과금|교육|학원|육아|의료|병원)';

-- 가계부 여러 개 (생활 / 여행 / 기타)
create table if not exists public.ledgers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  kind text not null default '생활' check (kind in ('생활','여행','기타')),
  currency char(3) not null default 'KRW',
  starts_on date, ends_on date,
  is_default boolean not null default false,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists ledgers_one_default on public.ledgers(household_id) where is_default;
alter table public.ledgers enable row level security;
create policy ledgers_select on public.ledgers for select to authenticated using (private.is_member(household_id));
create policy ledgers_write on public.ledgers for all to authenticated using (private.is_adult(household_id)) with check (private.is_adult(household_id));
revoke all on public.ledgers from anon;
insert into public.ledgers(household_id, name, is_default) select id, '우리 집', true from public.households h
  where not exists (select 1 from public.ledgers l where l.household_id = h.id and l.is_default);

alter table public.transactions add column if not exists ledger_id uuid references public.ledgers(id) on delete set null;
-- 할부: 같은 결제를 달마다 나눠 기록
alter table public.transactions add column if not exists installment_group uuid;
alter table public.transactions add column if not exists installment_no smallint check (installment_no between 1 and 60);
alter table public.transactions add column if not exists installment_total smallint check (installment_total between 2 and 60);
create index if not exists tx_inst_group on public.transactions(installment_group) where installment_group is not null;
create index if not exists tx_ledger on public.transactions(ledger_id);

-- 실적 카드: 한 달 목표 금액, 혜택, 실적 제외 항목
create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  name text not null check (char_length(name) between 1 and 30),
  kind text not null default '신용' check (kind in ('신용','체크','기타')),
  monthly_target bigint not null default 0 check (monthly_target >= 0),
  benefits text not null default '' check (char_length(benefits) <= 1000),
  exclude_categories text[] not null default '{}',
  memo text not null default '' check (char_length(memo) <= 300),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);
alter table public.cards enable row level security;
create policy cards_select on public.cards for select to authenticated using (private.is_adult(household_id));
create policy cards_write on public.cards for all to authenticated using (private.is_adult(household_id)) with check (private.is_adult(household_id));
revoke all on public.cards from anon;

-- 새 가족을 만들면 기본 가계부도 함께
create or replace function public.create_household(p_name text, p_kind text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); hh uuid;
begin
  if uid is null then raise exception '로그인이 필요해요'; end if;
  insert into public.profiles(id, display_name) values (uid, p_display_name) on conflict (id) do update set display_name = coalesce(public.profiles.display_name, excluded.display_name);
  insert into public.households(name, kind, owner_id) values (p_name, p_kind, uid) returning id into hh;
  insert into public.members(household_id, user_id, role, display_name, joined_at) values (hh, uid, 'owner', p_display_name, now());
  insert into public.subscriptions(household_id) values (hh);
  insert into public.ledgers(household_id, name, is_default) values (hh, '우리 집', true);
  perform public.seed_categories(hh);
  return hh;
end $$;

-- 개인 용돈 숨기기: 숨긴 사람의 개인 지출은 원본 행을 다른 가족이 직접 못 읽고,
-- 아래 함수로 '개인 지출 + 금액'만 받아요
drop policy if exists tx_select on public.transactions;
create policy tx_select on public.transactions for select to authenticated using (
  member_id = private.my_member_id(household_id)
  or (private.is_adult(household_id) and not (scope = '개인' and exists (
        select 1 from public.members m where m.id = transactions.member_id and m.hide_personal))));

create or replace function public.hidden_personal_tx(p_household uuid, p_from date, p_to date)
returns table (id uuid, date date, member_id uuid, amount_base bigint, ledger_id uuid)
language sql stable security definer set search_path = public as $$
  select t.id, t.date, t.member_id, t.amount_base, t.ledger_id
  from public.transactions t join public.members m on m.id = t.member_id
  where t.household_id = p_household and private.is_adult(p_household)
    and t.deleted_at is null and t.scope = '개인' and m.hide_personal
    and t.member_id <> private.my_member_id(p_household)
    and t.date between p_from and p_to;
$$;
revoke execute on function public.hidden_personal_tx(uuid, date, date) from public, anon;
grant execute on function public.hidden_personal_tx(uuid, date, date) to authenticated;
