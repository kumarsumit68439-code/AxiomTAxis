create extension if not exists pgcrypto;

create table if not exists public.bots (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('simple','welcome','ai','music')),
  token text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  status text not null default 'offline',
  status_detail text,
  created_at timestamptz not null default now()
);

alter table public.bots enable row level security;

create policy "bots_select_own" on public.bots for select using (owner = auth.uid());
create policy "bots_insert_own" on public.bots for insert with check (owner = auth.uid());
create policy "bots_update_own" on public.bots for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy "bots_delete_own" on public.bots for delete using (owner = auth.uid());
