-- Arena Maker V13 — banco compartilhado (projeto football-legacy).
-- Tudo do Arena Maker usa o prefixo "arena" para não misturar com os outros
-- sistemas da mesma base: tabela public.arena_tournaments e bucket arena-media.
-- Pode ser executado novamente sem apagar campeonatos existentes.

begin;

create extension if not exists pgcrypto;

create table if not exists public.arena_tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  game text not null default '',
  mode text not null default 'individual',
  format text not null default 'league',
  status text not null default 'active',
  cover_image_url text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arena_tournaments_mode_check check (mode in ('individual', 'teams', 'dynamic')),
  constraint arena_tournaments_format_check check (format in ('league', 'knockout', 'mixed', 'milton', 'fabio')),
  constraint arena_tournaments_status_check check (status in ('active', 'finished', 'archived'))
);

comment on table public.arena_tournaments is 'Arena Maker: campeonatos (estado completo em JSON).';

create index if not exists arena_tournaments_updated_idx
  on public.arena_tournaments(updated_at desc);

alter table public.arena_tournaments enable row level security;

grant select, insert, update, delete on public.arena_tournaments to anon, authenticated;

-- O Arena Maker não tem login: qualquer pessoa com a URL do sistema pode editar.
drop policy if exists "arena_tournaments_public_all" on public.arena_tournaments;
create policy "arena_tournaments_public_all"
on public.arena_tournaments
for all
to anon, authenticated
using (true)
with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arena-media', 'arena-media', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "arena_media_public_read" on storage.objects;
drop policy if exists "arena_media_public_insert" on storage.objects;
drop policy if exists "arena_media_public_update" on storage.objects;
drop policy if exists "arena_media_public_delete" on storage.objects;

create policy "arena_media_public_read" on storage.objects
for select to anon, authenticated using (bucket_id = 'arena-media');

create policy "arena_media_public_insert" on storage.objects
for insert to anon, authenticated with check (bucket_id = 'arena-media');

create policy "arena_media_public_update" on storage.objects
for update to anon, authenticated using (bucket_id = 'arena-media') with check (bucket_id = 'arena-media');

create policy "arena_media_public_delete" on storage.objects
for delete to anon, authenticated using (bucket_id = 'arena-media');

commit;
