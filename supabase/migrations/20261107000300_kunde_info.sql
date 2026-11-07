-- Ekstra kundeopplysninger: kjede, konstellasjon, VBL-medlemskap og om kunden er byggvareforhandler.
create table if not exists public.kunde_info (
  kundenr        text primary key references public.kunder (kundenr) on delete cascade,
  kjede          text,
  konstellasjon  text,
  vbl            boolean not null default false,
  byggvare       boolean not null default false,
  endret_av      text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  endret         timestamptz not null default now()
);
alter table public.kunde_info enable row level security;

drop policy if exists "info: lese med tilgang" on public.kunde_info;
create policy "info: lese med tilgang" on public.kunde_info for select to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "info: legge til (admin/leder)" on public.kunde_info;
create policy "info: legge til (admin/leder)" on public.kunde_info for insert to authenticated
  with check (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "info: endre (admin/leder)" on public.kunde_info;
create policy "info: endre (admin/leder)" on public.kunde_info for update to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')))
  with check (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "info: slette (admin/leder)" on public.kunde_info;
create policy "info: slette (admin/leder)" on public.kunde_info for delete to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));

revoke all on public.kunde_info from anon;
grant select, insert, update, delete on public.kunde_info to authenticated;
