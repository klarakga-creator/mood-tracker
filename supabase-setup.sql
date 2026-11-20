-- Mood Tracker database. Paste all of this into Supabase: SQL Editor -> New query -> Run.
-- Row-level security means each person can only ever read and change their own rows.

create table if not exists public.entries (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null,
  rating smallint check (rating between 0 and 10),
  note text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  daily boolean not null default false,
  reminder_time text not null default '20:00',
  timezone text not null default 'UTC',
  monthly boolean not null default false,
  email text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.entries enable row level security;
alter table public.settings enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "Own entries" on public.entries;
create policy "Own entries" on public.entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Own settings" on public.settings;
create policy "Own settings" on public.settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Own push subscriptions" on public.push_subscriptions;
create policy "Own push subscriptions" on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
