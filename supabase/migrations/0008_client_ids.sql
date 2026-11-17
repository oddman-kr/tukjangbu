-- 앱이 만든 ID(client_id)로 중복 없이 저장하고, 위시에 꼭 사야 할 것(need) 구분
alter table public.transactions add column if not exists client_id text check (client_id is null or char_length(client_id) <= 60);
create unique index if not exists tx_client_id on public.transactions(household_id, client_id) where client_id is not null;
alter table public.wishes add column if not exists client_id text check (client_id is null or char_length(client_id) <= 60);
create unique index if not exists wish_client_id on public.wishes(household_id, client_id) where client_id is not null;
alter table public.wishes add column if not exists need boolean not null default false;
alter table public.recurring add column if not exists client_id text check (client_id is null or char_length(client_id) <= 60);
create unique index if not exists rec_client_id on public.recurring(household_id, client_id) where client_id is not null;
