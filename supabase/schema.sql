-- Arena Maker V10 — mídia no Supabase Storage, edição e equipes rotativas.
-- Pode ser executado novamente sem apagar campeonatos existentes.

begin;

create extension if not exists pgcrypto;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  game text not null default '',
  mode text not null default 'individual',
  format text not null default 'league',
  status text not null default 'active',
  cover_image_url text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tournaments
  add column if not exists cover_image_url text;

alter table public.tournaments
  drop constraint if exists tournaments_mode_check;
alter table public.tournaments
  add constraint tournaments_mode_check
  check (mode in ('individual', 'teams', 'dynamic'));

alter table public.tournaments
  drop constraint if exists tournaments_format_check;
alter table public.tournaments
  add constraint tournaments_format_check
  check (format in ('league', 'knockout', 'mixed'));

alter table public.tournaments
  drop constraint if exists tournaments_status_check;
alter table public.tournaments
  add constraint tournaments_status_check
  check (status in ('active', 'finished', 'archived'));

create index if not exists tournaments_updated_idx
  on public.tournaments(updated_at desc);

alter table public.tournaments enable row level security;

do $block$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'tournaments'
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$block$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tournaments to anon, authenticated;

create policy "tournaments_public_all"
on public.tournaments
for all
to anon, authenticated
using (true)
with check (true);

-- Bucket público para capas e fotos. O arquivo físico fica no Storage;
-- a URL pública fica salva dentro do estado do campeonato.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'arena-media',
  'arena-media',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "arena_media_public_read" on storage.objects;
drop policy if exists "arena_media_public_insert" on storage.objects;
drop policy if exists "arena_media_public_update" on storage.objects;
drop policy if exists "arena_media_public_delete" on storage.objects;

create policy "arena_media_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'arena-media');

create policy "arena_media_public_insert"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'arena-media');

create policy "arena_media_public_update"
on storage.objects
for update
to anon, authenticated
using (bucket_id = 'arena-media')
with check (bucket_id = 'arena-media');

create policy "arena_media_public_delete"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'arena-media');

commit;
