-- Buffer for medieomtale per kunde (Edge Function «nyheter»). Bare service role.
create table if not exists public.nyhet_cache (
  kundenr text primary key,
  sok     text not null,
  hentet  timestamptz not null default now(),
  data    jsonb not null default '[]'::jsonb
);
alter table public.nyhet_cache enable row level security;
revoke all on public.nyhet_cache from anon, authenticated;
grant all on public.nyhet_cache to service_role;
