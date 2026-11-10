-- Personlig profil: hjemmeadresse, bil, standarder for planleggeren. Hver bruker ser bare sin egen.
create table if not exists public.profil (
  epost   text primary key default lower(coalesce(auth.jwt() ->> 'email', '')) check (epost = lower(epost)),
  data    jsonb not null default '{}'::jsonb,
  endret  timestamptz not null default now()
);
alter table public.profil enable row level security;

drop policy if exists "profil: egen" on public.profil;
create policy "profil: egen" on public.profil for all to authenticated
  using (epost = lower((select auth.jwt() ->> 'email')))
  with check (epost = lower((select auth.jwt() ->> 'email'))
              and exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "krev tofaktor" on public.profil;
create policy "krev tofaktor" on public.profil as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

revoke all on public.profil from anon;
grant select, insert, update, delete on public.profil to authenticated;
