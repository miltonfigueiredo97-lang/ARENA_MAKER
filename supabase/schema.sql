-- Arena Maker V3 sem login.
-- Execute todo este arquivo no SQL Editor do Supabase.
-- O sistema abre diretamente e usa a publishable key no navegador.

create extension if not exists pgcrypto;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
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
  name text not null,
  game text not null,
  mode text not null check (mode in ('individual', 'teams')),
  format text not null check (format in ('league', 'knockout', 'mixed')),
  status text not null default 'active' check (status in ('active', 'finished', 'archived')),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migração automática caso você já tenha executado a versão antiga com login.
drop index if exists public.players_owner_idx;
drop index if exists public.tournaments_owner_idx;
alter table public.players drop constraint if exists players_owner_id_fkey;
alter table public.tournaments drop constraint if exists tournaments_owner_id_fkey;
alter table public.players drop column if exists owner_id;
alter table public.tournaments drop column if exists owner_id;

create index if not exists tournaments_updated_idx on public.tournaments(updated_at desc);

alter table public.players enable row level security;
alter table public.tournaments enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.players to anon, authenticated;
grant select, insert, update, delete on table public.tournaments to anon, authenticated;

-- Remove políticas da versão antiga.
drop policy if exists "players_select_own" on public.players;
drop policy if exists "players_insert_own" on public.players;
drop policy if exists "players_update_own" on public.players;
drop policy if exists "players_delete_own" on public.players;
drop policy if exists "tournaments_select_own" on public.tournaments;
drop policy if exists "tournaments_insert_own" on public.tournaments;
drop policy if exists "tournaments_update_own" on public.tournaments;
drop policy if exists "tournaments_delete_own" on public.tournaments;
drop policy if exists "players_public_all" on public.players;
drop policy if exists "tournaments_public_all" on public.tournaments;

create policy "players_public_all"
on public.players
for all
to anon, authenticated
using (true)
with check (true);

create policy "tournaments_public_all"
on public.tournaments
for all
to anon, authenticated
using (true)
with check (true);

-- Realtime opcional para manter telas abertas sincronizáveis no futuro.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournaments'
  ) then
    alter publication supabase_realtime add table public.tournaments;
  end if;
end $$;
