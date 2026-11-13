-- OPTIONAL: per-server settings store for the bot worker.
create table if not exists public.guild_settings (
  guild_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
-- RLS on with no policies: only the service role key (Railway) can read/write.
alter table public.guild_settings enable row level security;
