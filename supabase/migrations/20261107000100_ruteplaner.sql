-- Ruteplaner fra planleggeren. Hver selger ser og endrer sine egne; admin/leder ser alle.
create table if not exists public.ruteplaner (
  id         uuid primary key default gen_random_uuid(),
  tittel     text not null default 'Ny rute',
  laget_av   text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  data       jsonb not null default '{}'::jsonb,
  opprettet  timestamptz not null default now(),
  endret     timestamptz not null default now()
);
create index if not exists ruteplaner_laget_av_idx on public.ruteplaner (laget_av);

alter table public.ruteplaner enable row level security;

drop policy if exists "ruter: lese egne eller som leder" on public.ruteplaner;
create policy "ruter: lese egne eller som leder" on public.ruteplaner
  for select to authenticated
  using (
    laget_av = lower((select auth.jwt() ->> 'email'))
    or exists (select 1 from public.tilgang t
               where t.epost = lower((select auth.jwt() ->> 'email'))
                 and t.rolle in ('admin','leder'))
  );

drop policy if exists "ruter: lage egne" on public.ruteplaner;
create policy "ruter: lage egne" on public.ruteplaner
  for insert to authenticated
  with check (
    laget_av = lower((select auth.jwt() ->> 'email'))
    and exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')))
  );

drop policy if exists "ruter: endre egne" on public.ruteplaner;
create policy "ruter: endre egne" on public.ruteplaner
  for update to authenticated
  using (laget_av = lower((select auth.jwt() ->> 'email')))
  with check (laget_av = lower((select auth.jwt() ->> 'email')));

drop policy if exists "ruter: slette egne" on public.ruteplaner;
create policy "ruter: slette egne" on public.ruteplaner
  for delete to authenticated
  using (laget_av = lower((select auth.jwt() ->> 'email')));

revoke all on public.ruteplaner from anon;
grant select, insert, update, delete on public.ruteplaner to authenticated;
