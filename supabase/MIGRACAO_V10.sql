-- Execute este arquivo uma vez no SQL Editor do Supabase antes de usar imagens.
-- Ele não apaga campeonatos nem resultados existentes.

begin;

alter table public.tournaments
  add column if not exists cover_image_url text;

alter table public.tournaments
  drop constraint if exists tournaments_mode_check;
alter table public.tournaments
  add constraint tournaments_mode_check
  check (mode in ('individual', 'teams', 'dynamic'));

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'arena-media', 'arena-media', true, 5242880,
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
on storage.objects for select to anon, authenticated
using (bucket_id = 'arena-media');

create policy "arena_media_public_insert"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'arena-media');

create policy "arena_media_public_update"
on storage.objects for update to anon, authenticated
using (bucket_id = 'arena-media')
with check (bucket_id = 'arena-media');

create policy "arena_media_public_delete"
on storage.objects for delete to anon, authenticated
using (bucket_id = 'arena-media');

commit;
