-- 관리자 통계(admin_stats/admin_feedback/admin_set_feedback)와 관리자 이메일 명단, 관리 기록. 실제 적용분은 Supabase 마이그레이션 admin_dashboard, admin_accounts 참고
create table if not exists public.admin_emails (email text primary key, note text, created_at timestamptz not null default now());
alter table public.admin_emails enable row level security;
create table if not exists public.admin_audit (id bigserial primary key, at timestamptz not null default now(), admin_email text, action text not null, target text, detail jsonb);
alter table public.admin_audit enable row level security;
