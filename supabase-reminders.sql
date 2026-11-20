-- Mood Tracker reminders and monthly email.
-- Paste all of this into Supabase: SQL Editor -> New query -> Run (after the "mood" function is deployed).

alter table public.settings
  add column if not exists last_daily_sent text,
  add column if not exists last_report_month text;

-- Keys the server creates for itself. No policies, so the app can never read it.
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (name, value)
  values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (name) do nothing;

grant all on public.entries, public.settings, public.push_subscriptions, public.app_secrets to service_role;

-- Run the server every 15 minutes.
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.schedule(
  'mood-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://wcfbfyozhknogikbffrh.supabase.co/functions/v1/bright-handler?action=tick',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select value from public.app_secrets where name = 'cron')),
    body := '{}'::jsonb
  );
  $$
);
