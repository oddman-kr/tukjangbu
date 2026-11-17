alter table public.cards
  add column if not exists pay_day smallint check (pay_day between 1 and 31),
  add column if not exists use_from smallint check (use_from between 1 and 31),
  add column if not exists use_back smallint check (use_back in (1,2)),
  add column if not exists bills jsonb not null default '{}'::jsonb;
