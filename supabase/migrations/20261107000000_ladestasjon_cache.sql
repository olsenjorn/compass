-- Hurtigbuffer for ladestasjoner fra NOBIL. Bare Edge Function (service role) leser og skriver.
create table if not exists public.ladestasjon_cache (
  id      int primary key default 1 check (id = 1),
  hentet  timestamptz not null default now(),
  antall  int not null default 0,
  data    jsonb not null default '[]'::jsonb
);
alter table public.ladestasjon_cache enable row level security;
revoke all on public.ladestasjon_cache from anon, authenticated;
grant all on public.ladestasjon_cache to service_role;
