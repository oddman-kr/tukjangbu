-- 가계부 정식판 1단계: 가구·구성원·초대·권한 + 가계부 데이터
-- 원칙: 모든 데이터는 가구(household) 단위. 권한은 행 단위 보안(RLS)으로 서버가 강제.
-- 자녀(child): 자기 내역·자기 요청만 보기/쓰기. 개인정보는 이름(별명)만.

create extension if not exists pgcrypto;

-- ---------- 기본 테이블 ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) <= 30),
  created_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  kind text not null default 'married' check (kind in ('solo','couple','married','family')),
  owner_id uuid not null references public.profiles(id),
  base_currency char(3) not null default 'KRW',
  trial_ends_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('owner','adult','child')),
  display_name text not null check (char_length(display_name) between 1 and 20),
  color text,
  guardian_consent_by uuid references public.profiles(id),
  guardian_consent_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, user_id),
  check (role <> 'child' or guardian_consent_at is not null)
);
create index on public.members(user_id);

create table public.invites (
  code text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references public.profiles(id),
  used_at timestamptz
);

create table public.subscriptions (
  household_id uuid primary key references public.households(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','solo','duo','trio','family')),
  seats int not null default 1 check (seats between 1 and 12),
  period text check (period in ('month','year')),
  status text not null default 'none',
  expires_at timestamptz,
  source text,
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('지출','수입','저축')),
  name text not null check (char_length(name) between 1 and 30),
  budget bigint not null default 0 check (budget >= 0),
  keywords text not null default '',
  sort int not null default 0,
  archived boolean not null default false,
  unique (household_id, type, name)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 40),
  kind text not null default '기타' check (kind in ('생일','기념일','명절','여행','기타')),
  date date not null,
  end_date date,
  yearly boolean not null default false,
  expected_amount bigint not null default 0 check (expected_amount >= 0),
  currency char(3),
  remind_days int not null default 7 check (remind_days between 0 and 60),
  member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key,                       -- 휴대폰에서 만든 ID(재전송해도 중복 안 됨)
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  date date not null,
  type text not null check (type in ('지출','수입','저축')),
  category text not null default '',
  amount numeric(14,2) not null check (amount <> 0),
  currency char(3) not null default 'KRW',
  fx_rate numeric(18,8) not null default 1,
  amount_base bigint not null,               -- 기준 통화(원) 환산액, 통계는 이 값으로
  scope text not null default '공용' check (scope in ('공용','개인')),
  description text not null default '' check (char_length(description) <= 100),
  method text not null default '',
  memo text not null default '' check (char_length(memo) <= 300),
  receipt_path text,
  event_id uuid references public.events(id) on delete set null,
  source text not null default 'manual' check (source in ('manual','voice','receipt','recurring','allowance','wish','import')),
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.transactions(household_id, date);
create index on public.transactions(household_id, updated_at);

create table public.recurring (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  type text not null check (type in ('지출','수입','저축')),
  category text not null default '',
  description text not null default '',
  amount bigint not null check (amount > 0),
  day int not null check (day between 1 and 31),
  method text not null default '',
  scope text not null default '공용' check (scope in ('공용','개인')),
  member_id uuid references public.members(id) on delete set null,
  active boolean not null default true,
  last_run_month text
);

create table public.wishes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  price bigint not null default 0 check (price >= 0),
  currency char(3) not null default 'KRW',
  link text check (link is null or link ~* '^https?://'),
  kind text not null default '기타',
  memo text not null default '',
  reason text not null default '' check (char_length(reason) <= 300),
  need_by date,
  cond text not null default '없음' check (cond in ('없음','저축','부수입','남은예산')),
  target bigint not null default 0 check (target >= 0),
  status text not null default '원함' check (status in ('원함','요청','승인','거절','구매함')),
  requested_by uuid references public.members(id) on delete set null,
  request_msg text not null default '' check (char_length(request_msg) <= 300),
  reply text not null default '' check (char_length(reply) <= 300),
  handled_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create table public.allowances (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  child_member_id uuid not null references public.members(id) on delete cascade,
  amount bigint not null check (amount > 0),
  cycle text not null default 'monthly' check (cycle in ('weekly','monthly')),
  day int not null default 1 check (day between 1 and 31),
  active boolean not null default true,
  last_paid date
);

create table public.usage_counters (
  household_id uuid not null references public.households(id) on delete cascade,
  month text not null,
  ocr_count int not null default 0,
  primary key (household_id, month)
);

create table public.fx_rates (
  date date not null,
  currency char(3) not null,
  rate_to_krw numeric(18,8) not null,
  primary key (date, currency)
);

-- ---------- 권한 판단 함수 (RLS에서 사용) ----------
create or replace function public.my_member_id(hh uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.members where household_id = hh and user_id = auth.uid()
$$;

create or replace function public.my_role(hh uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where household_id = hh and user_id = auth.uid()
$$;

create or replace function public.is_member(hh uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.members where household_id = hh and user_id = auth.uid())
$$;

create or replace function public.is_adult(hh uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.members where household_id = hh and user_id = auth.uid() and role in ('owner','adult'))
$$;

-- 사용 가능한 인원: 체험 기간이면 4명, 아니면 구독 인원(무료 1명)
create or replace function public.seat_limit(hh uuid) returns int
language sql stable security definer set search_path = public as $$
  select case
    when h.trial_ends_at > now() then greatest(4, coalesce(s.seats, 1))
    when s.status = 'active' and (s.expires_at is null or s.expires_at > now()) then s.seats
    else 1 end
  from public.households h left join public.subscriptions s on s.household_id = h.id
  where h.id = hh
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.subscriptions enable row level security;
alter table public.categories enable row level security;
alter table public.events enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring enable row level security;
alter table public.wishes enable row level security;
alter table public.allowances enable row level security;
alter table public.usage_counters enable row level security;
alter table public.fx_rates enable row level security;

create policy profiles_self_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_self_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_self_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy households_member_select on public.households for select to authenticated using (public.is_member(id));
create policy households_owner_update on public.households for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create policy members_select on public.members for select to authenticated using (public.is_member(household_id));
-- 자기 이름은 각자 바꾸고, 대표·어른은 다른 구성원 이름도 바꿀 수 있음(역할 변경은 함수로만)
create policy members_update on public.members for update to authenticated
  using (user_id = (select auth.uid()) or public.is_adult(household_id))
  with check (user_id = (select auth.uid()) or public.is_adult(household_id));

create policy invites_adult_select on public.invites for select to authenticated using (public.is_adult(household_id));

create policy subs_member_select on public.subscriptions for select to authenticated using (public.is_member(household_id));

create policy categories_select on public.categories for select to authenticated using (public.is_member(household_id));
create policy categories_write on public.categories for all to authenticated using (public.is_adult(household_id)) with check (public.is_adult(household_id));

create policy events_select on public.events for select to authenticated using (public.is_member(household_id));
create policy events_write on public.events for all to authenticated using (public.is_adult(household_id)) with check (public.is_adult(household_id));

create policy recurring_select on public.recurring for select to authenticated using (public.is_adult(household_id));
create policy recurring_write on public.recurring for all to authenticated using (public.is_adult(household_id)) with check (public.is_adult(household_id));

-- 내역: 어른은 가구 전체, 자녀는 자기 것만(쓸 때는 개인 범위만)
create policy tx_select on public.transactions for select to authenticated using (
  public.is_adult(household_id) or member_id = public.my_member_id(household_id));
create policy tx_insert on public.transactions for insert to authenticated with check (
  public.is_adult(household_id)
  or (public.my_role(household_id) = 'child' and member_id = public.my_member_id(household_id) and scope = '개인'));
create policy tx_update on public.transactions for update to authenticated
  using (public.is_adult(household_id) or member_id = public.my_member_id(household_id))
  with check (public.is_adult(household_id) or (member_id = public.my_member_id(household_id) and scope = '개인'));
create policy tx_delete on public.transactions for delete to authenticated using (
  public.is_adult(household_id) or member_id = public.my_member_id(household_id));

-- 위시: 어른은 전체, 자녀는 자기 요청만(새 요청은 '요청' 상태로만)
create policy wishes_select on public.wishes for select to authenticated using (
  public.is_adult(household_id) or requested_by = public.my_member_id(household_id));
create policy wishes_insert on public.wishes for insert to authenticated with check (
  public.is_adult(household_id)
  or (requested_by = public.my_member_id(household_id) and status = '요청'));
create policy wishes_update on public.wishes for update to authenticated
  using (public.is_adult(household_id) or (requested_by = public.my_member_id(household_id) and status in ('요청','거절')))
  with check (public.is_adult(household_id) or (requested_by = public.my_member_id(household_id) and status = '요청'));
create policy wishes_delete on public.wishes for delete to authenticated using (
  public.is_adult(household_id) or (requested_by = public.my_member_id(household_id) and status in ('요청','거절')));

create policy allowances_select on public.allowances for select to authenticated using (
  public.is_adult(household_id) or child_member_id = public.my_member_id(household_id));
create policy allowances_write on public.allowances for all to authenticated using (public.is_adult(household_id)) with check (public.is_adult(household_id));

create policy usage_select on public.usage_counters for select to authenticated using (public.is_member(household_id));
create policy fx_select on public.fx_rates for select to authenticated using (true);

-- ---------- 갱신 시각 ----------
create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
create trigger tx_touch before update on public.transactions for each row execute function public.touch_updated_at();

-- 내역의 구성원은 같은 가구여야 함
create or replace function public.check_tx_member() returns trigger language plpgsql set search_path = public as $$
begin
  if new.member_id is not null and not exists (select 1 from public.members m where m.id = new.member_id and m.household_id = new.household_id) then
    raise exception '다른 가구의 구성원으로 기록할 수 없어요';
  end if;
  return new;
end $$;
create trigger tx_member_check before insert or update on public.transactions for each row execute function public.check_tx_member();

-- ---------- 가입·가구·초대 함수 ----------
create or replace function public.seed_categories(hh uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.categories(household_id, type, name, budget, keywords, sort) values
  (hh,'지출','장보기',0,'마트,이마트,홈플러스,롯데마트,코스트코,트레이더스,쿠팡,컬리,시장,식자재,반찬',1),
  (hh,'지출','외식·배달',0,'점심,저녁,아침,식당,외식,배달,배민,요기요,쿠팡이츠,치킨,피자,김밥,국밥,회식,술,술값,고기,초밥',2),
  (hh,'지출','카페·간식',0,'카페,커피,스타벅스,스벅,메가커피,빽다방,컴포즈,이디야,투썸,편의점,간식,빵,디저트,GS25,CU,세븐일레븐',3),
  (hh,'지출','주거·관리비',0,'월세,관리비,전기,가스,수도,전세이자,대출이자,난방',4),
  (hh,'지출','통신',0,'통신,통신비,휴대폰,핸드폰,인터넷,요금제',5),
  (hh,'지출','교통·차량',0,'교통,버스,지하철,택시,카카오T,주유,기름,주차,톨게이트,하이패스,KTX,SRT',6),
  (hh,'지출','생활용품',0,'다이소,생활용품,세제,휴지,샴푸,청소,주방용품',7),
  (hh,'지출','의류·미용',0,'옷,의류,신발,미용실,헤어,무신사,화장품,올리브영,네일',8),
  (hh,'지출','의료·건강',0,'병원,약국,약,치과,한의원,헬스,필라테스,요가,영양제',9),
  (hh,'지출','문화·여가',0,'영화,공연,전시,책,게임,여가,취미,노래방',10),
  (hh,'지출','구독',0,'구독,유튜브,넷플릭스,티빙,웨이브,디즈니,멜론,쿠팡와우',11),
  (hh,'지출','경조사·선물',0,'축의금,조의금,부조,경조사,선물,생일,기념일,명절',12),
  (hh,'지출','육아·교육',0,'학원,교육,유치원,어린이집,기저귀,분유,장난감,교재',13),
  (hh,'지출','여행',0,'여행,숙소,호텔,펜션,항공,비행기,렌터카',14),
  (hh,'지출','용돈',0,'용돈,개인 용돈',15),
  (hh,'지출','기타지출',0,'',16),
  (hh,'수입','급여',0,'월급,급여',17),
  (hh,'수입','상여',0,'상여,보너스,성과급',18),
  (hh,'수입','부수입',0,'부수입,부업,중고,당근,알바',19),
  (hh,'수입','용돈받음',0,'용돈 받,세뱃돈',20),
  (hh,'수입','기타수입',0,'환급,이자,배당,캐시백',21),
  (hh,'저축','비상금',0,'비상금,파킹',22),
  (hh,'저축','적금·예금',0,'적금,예금',23),
  (hh,'저축','연금',0,'연금저축,IRP,연금',24),
  (hh,'저축','투자',0,'ISA,주식,ETF,펀드,투자',25),
  (hh,'저축','청약',0,'청약',26)
  on conflict do nothing;
end $$;
revoke execute on function public.seed_categories(uuid) from public, anon, authenticated;

create or replace function public.create_household(p_name text, p_kind text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); hh uuid;
begin
  if uid is null then raise exception '로그인이 필요해요'; end if;
  insert into public.profiles(id, display_name) values (uid, p_display_name) on conflict (id) do update set display_name = coalesce(public.profiles.display_name, excluded.display_name);
  insert into public.households(name, kind, owner_id) values (p_name, p_kind, uid) returning id into hh;
  insert into public.members(household_id, user_id, role, display_name, joined_at) values (hh, uid, 'owner', p_display_name, now());
  insert into public.subscriptions(household_id) values (hh);
  perform public.seed_categories(hh);
  return hh;
end $$;

-- 초대: 어른만. 자녀를 초대하려면 초대하는 어른이 법정대리인 동의를 함께 기록해야 함
create or replace function public.create_invite(p_household uuid, p_role text, p_display_name text, p_guardian_consent boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mid uuid; c text; used int;
begin
  if not public.is_adult(p_household) then raise exception '초대 권한이 없어요'; end if;
  if p_role not in ('adult','child') then raise exception '역할이 올바르지 않아요'; end if;
  if p_role = 'child' and not p_guardian_consent then raise exception '자녀 초대에는 법정대리인 동의가 필요해요'; end if;
  select count(*) into used from public.members where household_id = p_household;
  if used >= public.seat_limit(p_household) then raise exception '요금제 인원(%)을 모두 사용했어요', public.seat_limit(p_household); end if;
  insert into public.members(household_id, role, display_name, guardian_consent_by, guardian_consent_at)
    values (p_household, p_role, p_display_name, case when p_role = 'child' then uid end, case when p_role = 'child' then now() end)
    returning id into mid;
  c := upper(substr(translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=0O1Il', 'XYZ23456'), 1, 8));
  insert into public.invites(code, household_id, member_id, created_by) values (c, p_household, mid, uid);
  return c;
end $$;

create or replace function public.accept_invite(p_code text, p_display_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); inv public.invites%rowtype;
begin
  if uid is null then raise exception '로그인이 필요해요'; end if;
  select * into inv from public.invites where code = upper(trim(p_code)) for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then raise exception '초대 코드가 없거나 만료됐어요'; end if;
  if exists(select 1 from public.members where household_id = inv.household_id and user_id = uid) then raise exception '이미 이 가계부의 구성원이에요'; end if;
  insert into public.profiles(id, display_name) values (uid, p_display_name) on conflict (id) do nothing;
  update public.members set user_id = uid, joined_at = now(), display_name = coalesce(nullif(trim(p_display_name), ''), display_name) where id = inv.member_id;
  update public.invites set used_by = uid, used_at = now() where code = inv.code;
  return inv.household_id;
end $$;

-- 구성원 내보내기(대표만), 대표 자신은 불가
create or replace function public.remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  select household_id into hh from public.members where id = p_member;
  if public.my_role(hh) <> 'owner' then raise exception '대표만 구성원을 내보낼 수 있어요'; end if;
  if exists(select 1 from public.members where id = p_member and role = 'owner') then raise exception '대표는 내보낼 수 없어요'; end if;
  delete from public.members where id = p_member;
end $$;

revoke execute on function public.create_household(text, text, text) from public, anon;
revoke execute on function public.create_invite(uuid, text, text, boolean) from public, anon;
revoke execute on function public.accept_invite(text, text) from public, anon;
revoke execute on function public.remove_member(uuid) from public, anon;
grant execute on function public.create_household(text, text, text) to authenticated;
grant execute on function public.create_invite(uuid, text, text, boolean) to authenticated;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;

-- ---------- 열 단위 권한: 역할·소유자·체험 기간은 함수로만 바뀜 ----------
revoke update on public.members from authenticated;
grant update (display_name, color) on public.members to authenticated;
revoke update on public.households from authenticated;
grant update (name, kind, base_currency) on public.households to authenticated;
revoke insert, update, delete on public.subscriptions, public.usage_counters, public.fx_rates, public.invites from authenticated, anon;
revoke all on all tables in schema public from anon;
