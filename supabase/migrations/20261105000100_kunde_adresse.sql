-- Besøksadresser funnet via Enhetsregisteret og Kartverket, godkjent i appen.
create table if not exists public.kunde_adresse (
  kundenr    text primary key references public.kunder (kundenr) on delete cascade,
  adresse    text not null,
  postnr     text,
  poststed   text,
  kommunenr  text,
  region     text,
  lat        double precision,
  lon        double precision,
  orgnr      text,
  kilde      text,
  sikkerhet  text check (sikkerhet in ('høy','middels','lav','manuell')),
  endret_av  text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  endret     timestamptz not null default now()
);

alter table public.kunde_adresse enable row level security;

drop policy if exists "adresse: lese med tilgang" on public.kunde_adresse;
create policy "adresse: lese med tilgang" on public.kunde_adresse
  for select to authenticated
  using (exists (select 1 from public.tilgang t
                 where t.epost = lower((select auth.jwt() ->> 'email'))));

drop policy if exists "adresse: legge til (admin/leder)" on public.kunde_adresse;
create policy "adresse: legge til (admin/leder)" on public.kunde_adresse
  for insert to authenticated
  with check (exists (select 1 from public.tilgang t
                      where t.epost = lower((select auth.jwt() ->> 'email'))
                        and t.rolle in ('admin','leder')));

drop policy if exists "adresse: endre (admin/leder)" on public.kunde_adresse;
create policy "adresse: endre (admin/leder)" on public.kunde_adresse
  for update to authenticated
  using (exists (select 1 from public.tilgang t
                 where t.epost = lower((select auth.jwt() ->> 'email'))
                   and t.rolle in ('admin','leder')))
  with check (exists (select 1 from public.tilgang t
                      where t.epost = lower((select auth.jwt() ->> 'email'))
                        and t.rolle in ('admin','leder')));

drop policy if exists "adresse: slette (admin/leder)" on public.kunde_adresse;
create policy "adresse: slette (admin/leder)" on public.kunde_adresse
  for delete to authenticated
  using (exists (select 1 from public.tilgang t
                 where t.epost = lower((select auth.jwt() ->> 'email'))
                   and t.rolle in ('admin','leder')));

revoke all on public.kunde_adresse from anon;
grant select, insert, update, delete on public.kunde_adresse to authenticated;
