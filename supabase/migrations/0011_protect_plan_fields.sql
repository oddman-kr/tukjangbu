create or replace function private.guard_household_fields() returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    if new.trial_ends_at is distinct from old.trial_ends_at or new.owner_id is distinct from old.owner_id then
      raise exception '바꿀 수 없는 항목이에요';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_household_fields on public.households;
create trigger guard_household_fields before update on public.households for each row execute function private.guard_household_fields();
alter table public.subscriptions add column if not exists purchase_token text, add column if not exists product_id text;
create unique index if not exists subscriptions_household_key on public.subscriptions(household_id);
