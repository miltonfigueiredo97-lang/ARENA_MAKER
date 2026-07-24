-- Arena Maker V12 — libera os formatos Milton e Liga Fábio no banco.
-- Execute uma vez no SQL Editor do Supabase.
-- Não apaga campeonatos, jogadores, resultados ou imagens existentes.

begin;

alter table public.tournaments
  drop constraint if exists tournaments_format_check;

alter table public.tournaments
  add constraint tournaments_format_check
  check (format in ('league', 'knockout', 'mixed', 'milton', 'fabio'));

commit;
