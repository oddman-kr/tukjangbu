alter table public.members drop constraint members_guardian_consent_by_fkey, add constraint members_guardian_consent_by_fkey foreign key (guardian_consent_by) references public.profiles(id) on delete set null;
alter table public.invites alter column created_by drop not null;
alter table public.invites drop constraint invites_created_by_fkey, add constraint invites_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
alter table public.invites drop constraint invites_used_by_fkey, add constraint invites_used_by_fkey foreign key (used_by) references public.profiles(id) on delete set null;
alter table public.transactions drop constraint transactions_created_by_fkey, add constraint transactions_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
create table if not exists public.deletion_log (id bigserial primary key, deleted_at timestamptz not null default now(), household_removed boolean not null default false, reason text);
alter table public.deletion_log enable row level security;
