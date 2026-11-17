create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  household_id uuid references public.households(id) on delete set null,
  kind text not null check (kind in ('불편','기능','칭찬','기타')),
  body text not null check (char_length(body) between 2 and 2000),
  contact text check (contact is null or char_length(contact) <= 120),
  app_ver text, device text,
  status text not null default '새 의견'
);
alter table public.feedback enable row level security;
create policy feedback_insert_own on public.feedback for insert to authenticated with check (user_id = auth.uid());
create policy feedback_read_own on public.feedback for select to authenticated using (user_id = auth.uid());
