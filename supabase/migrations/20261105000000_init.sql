-- Kundekart Nord: tabeller, tilgangsstyring og RLS
-- Bare e-postadresser i public.tilgang får lese kundedata.

create table if not exists public.tilgang (
  epost text primary key check (epost = lower(epost)),
  navn  text not null,
  rolle text not null default 'selger' check (rolle in ('selger','leder','admin')),
  opprettet timestamptz not null default now()
);

create table if not exists public.kunder (
  kundenr          text primary key,
  navn             text not null,
  kategori         text,
  eier             text,
  oms_ventilasjon  numeric(14,0) not null default 0,
  oms_profil       numeric(14,0) not null default 0,
  oms_total        numeric(14,0) not null default 0,
  segment          text check (segment in ('A','B','C','D')),
  poststed         text,
  poststed_kilde   text,
  kommune          text,
  region           text,
  lat              double precision,
  lon              double precision,
  presisjon        text,
  besoksadresse    text,
  postnr           text,
  bransje          text,
  status           text,
  oppdatert        timestamptz not null default now()
);
create index if not exists kunder_region_idx on public.kunder (region);
create index if not exists kunder_eier_idx on public.kunder (eier);

-- Felles rettelser av sted når kunden mangler eller har feil poststed
create table if not exists public.sted_rettelse (
  kundenr   text primary key references public.kunder (kundenr) on delete cascade,
  poststed  text not null,
  lat       double precision not null,
  lon       double precision not null,
  region    text,
  endret_av text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  endret    timestamptz not null default now()
);

alter table public.tilgang       enable row level security;
alter table public.kunder        enable row level security;
alter table public.sted_rettelse enable row level security;

-- Hver bruker kan se sin egen tilgangsrad (brukes av policyene under og av appen)
create policy "tilgang: se egen rad" on public.tilgang
  for select to authenticated
  using (epost = lower((select auth.jwt() ->> 'email')));

create policy "kunder: lese med tilgang" on public.kunder
  for select to authenticated
  using (exists (select 1 from public.tilgang t
                 where t.epost = lower((select auth.jwt() ->> 'email'))));

create policy "rettelse: lese med tilgang" on public.sted_rettelse
  for select to authenticated
  using (exists (select 1 from public.tilgang t
                 where t.epost = lower((select auth.jwt() ->> 'email'))));

create policy "rettelse: legge til med tilgang" on public.sted_rettelse
  for insert to authenticated
  with check (exists (select 1 from public.tilgang t
                      where t.epost = lower((select auth.jwt() ->> 'email'))));

create policy "rettelse: endre med tilgang" on public.sted_rettelse
  for update to authenticated
  using (exists (select 1 from public.tilgang t
                 where t.epost = lower((select auth.jwt() ->> 'email'))))
  with check (exists (select 1 from public.tilgang t
                      where t.epost = lower((select auth.jwt() ->> 'email'))));

create policy "rettelse: slette med tilgang" on public.sted_rettelse
  for delete to authenticated
  using (exists (select 1 from public.tilgang t
                 where t.epost = lower((select auth.jwt() ->> 'email'))));

revoke all on public.tilgang, public.kunder, public.sted_rettelse from anon;
grant select on public.tilgang, public.kunder to authenticated;
grant select, insert, update, delete on public.sted_rettelse to authenticated;
