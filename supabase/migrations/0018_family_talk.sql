-- 가족톡: 내역 댓글 + 가족 메모판
create table if not exists public.tx_comments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  tx_id uuid not null references public.transactions(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists tx_comments_hh on public.tx_comments(household_id, created_at);
create index if not exists tx_comments_tx on public.tx_comments(tx_id);
alter table public.tx_comments enable row level security;
-- 볼 수 있는 내역의 댓글만 보여요 (개인 내용 숨기기 그대로 따라가요)
create policy tx_comments_select on public.tx_comments for select to authenticated
  using (private.my_member_id(household_id) is not null and exists (select 1 from public.transactions t where t.id = tx_id));
create policy tx_comments_insert on public.tx_comments for insert to authenticated
  with check (member_id = private.my_member_id(household_id) and exists (select 1 from public.transactions t where t.id = tx_id and t.household_id = tx_comments.household_id));
create policy tx_comments_delete on public.tx_comments for delete to authenticated
  using (member_id = private.my_member_id(household_id) or private.is_adult(household_id));

-- 앱은 내역을 client_id로 알아서, 서버가 찾아 붙여요 (호출한 사람 권한으로 실행)
create or replace function public.add_tx_comment(p_household uuid, p_tx_key text, p_body text)
returns public.tx_comments language plpgsql security invoker set search_path = '' as $$
declare t uuid; r public.tx_comments;
begin
  select id into t from public.transactions where household_id = p_household and deleted_at is null
    and (client_id = p_tx_key or id::text = p_tx_key) limit 1;
  if t is null then raise exception '내역을 찾지 못했어요'; end if;
  insert into public.tx_comments(household_id, tx_id, member_id, body)
    values (p_household, t, private.my_member_id(p_household), left(btrim(p_body), 500)) returning * into r;
  return r;
end $$;
revoke all on function public.add_tx_comment(uuid, text, text) from public, anon;
grant execute on function public.add_tx_comment(uuid, text, text) to authenticated;

create table if not exists public.family_notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  pinned boolean not null default false,
  adults_only boolean not null default false,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists family_notes_hh on public.family_notes(household_id, created_at);
alter table public.family_notes enable row level security;
create policy family_notes_select on public.family_notes for select to authenticated
  using (private.my_member_id(household_id) is not null and (not adults_only or private.is_adult(household_id)));
create policy family_notes_insert on public.family_notes for insert to authenticated
  with check (member_id = private.my_member_id(household_id) and (not adults_only or private.is_adult(household_id)));
create policy family_notes_update on public.family_notes for update to authenticated
  using (member_id = private.my_member_id(household_id) or private.is_adult(household_id))
  with check (not adults_only or private.is_adult(household_id));
create policy family_notes_delete on public.family_notes for delete to authenticated
  using (member_id = private.my_member_id(household_id) or private.is_adult(household_id));
