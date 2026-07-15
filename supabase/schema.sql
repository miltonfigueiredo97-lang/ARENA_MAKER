-- Arena Maker V2 — Execute no SQL Editor do Supabase.

create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  nickname text not null default '',
  color text not null default '#7c5cff',
  avatar_url text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  game text not null,
  mode text not null check (mode in ('individual', 'teams')),
  format text not null check (format in ('league', 'knockout', 'mixed')),
  status text not null default 'active' check (status in ('active', 'finished', 'archived')),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_owner_idx on public.players(owner_id);
create index if not exists tournaments_owner_idx on public.tournaments(owner_id);
create index if not exists tournaments_updated_idx on public.tournaments(owner_id, updated_at desc);

alter table public.players enable row level security;
alter table public.tournaments enable row level security;

-- Permite executar este arquivo novamente sem duplicar políticas.
drop policy if exists "players_select_own" on public.players;
drop policy if exists "players_insert_own" on public.players;
drop policy if exists "players_update_own" on public.players;
drop policy if exists "players_delete_own" on public.players;
drop policy if exists "tournaments_select_own" on public.tournaments;
drop policy if exists "tournaments_insert_own" on public.tournaments;
drop policy if exists "tournaments_update_own" on public.tournaments;
drop policy if exists "tournaments_delete_own" on public.tournaments;

create policy "players_select_own" on public.players for select to authenticated using (auth.uid() = owner_id);
create policy "players_insert_own" on public.players for insert to authenticated with check (auth.uid() = owner_id);
create policy "players_update_own" on public.players for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "players_delete_own" on public.players for delete to authenticated using (auth.uid() = owner_id);

create policy "tournaments_select_own" on public.tournaments for select to authenticated using (auth.uid() = owner_id);
create policy "tournaments_insert_own" on public.tournaments for insert to authenticated with check (auth.uid() = owner_id);
create policy "tournaments_update_own" on public.tournaments for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "tournaments_delete_own" on public.tournaments for delete to authenticated using (auth.uid() = owner_id);

-- Realtime opcional: habilita sincronização futura entre telas abertas.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players') then
    alter publication supabase_realtime add table public.players;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournaments') then
    alter publication supabase_realtime add table public.tournaments;
  end if;
end $$;
