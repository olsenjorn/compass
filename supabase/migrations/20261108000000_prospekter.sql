-- Prospekter: byggevarehus og takentreprenører i Nord-Norge som ikke står på kundelista.
-- Hentet fra Enhetsregisteret/Regnskapsregisteret (offentlige data). Lesbar for alle med tilgang.
create table if not exists public.prospekter (
  orgnr          text primary key,
  type           text not null check (type in ('byggevare','tak')),
  navn           text not null,
  kjede          text,
  naering        text,
  hovedorgnr     text,
  hovednavn      text,
  adresse        text,
  postnr         text,
  poststed       text,
  kommunenr      text,
  region         text,
  lat            double precision,
  lon            double precision,
  omsetning      bigint,
  regnskapsaar   int,
  ansatte        int,
  hjemmeside     text,
  skjult         boolean not null default false,
  hentet         timestamptz not null default now()
);
alter table public.prospekter enable row level security;

drop policy if exists "prospekt: lese med tilgang" on public.prospekter;
create policy "prospekt: lese med tilgang" on public.prospekter for select to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "prospekt: legge til (admin/leder)" on public.prospekter;
create policy "prospekt: legge til (admin/leder)" on public.prospekter for insert to authenticated
  with check (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "prospekt: endre (admin/leder)" on public.prospekter;
create policy "prospekt: endre (admin/leder)" on public.prospekter for update to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')))
  with check (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "prospekt: slette (admin/leder)" on public.prospekter;
create policy "prospekt: slette (admin/leder)" on public.prospekter for delete to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));

revoke all on public.prospekter from anon;
grant select, insert, update, delete on public.prospekter to authenticated;
