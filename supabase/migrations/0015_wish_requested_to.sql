alter table public.wishes add column if not exists requested_to uuid references public.members(id) on delete set null;
