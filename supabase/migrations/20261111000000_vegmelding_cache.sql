-- Hurtigbuffer for trafikkmeldinger fra Statens vegvesen (DATEX). Bare Edge Function (service role) leser og skriver.
create table if not exists public.vegmelding_cache (
  id          int primary key default 1 check (id = 1),
  hentet      timestamptz not null default now(),
  sist_endret text,
  antall      int not null default 0,
  data        jsonb not null default '[]'::jsonb
);
alter table public.vegmelding_cache enable row level security;
revoke all on public.vegmelding_cache from anon, authenticated;
grant all on public.vegmelding_cache to service_role;
