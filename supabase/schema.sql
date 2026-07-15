-- Arena Maker V4 — estrutura focada em campeonatos.
-- A tabela players antiga pode permanecer; esta versão não a utiliza.

begin;

create extension if not exists pgcrypto;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  game text not null default '',
  mode text not null check (mode in ('individual', 'teams')),
  format text not null check (format in ('league', 'knockout', 'mixed')),
  status text not null default 'active' check (status in ('active', 'finished', 'archived')),
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

commit;
