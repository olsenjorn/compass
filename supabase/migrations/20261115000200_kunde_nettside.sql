-- Kundens nettside, lagt inn av selgerne (brukes når Enhetsregisteret ikke har hjemmeside).
create table if not exists public.kunde_nettside (
  kundenr text primary key references public.kunder(kundenr) on delete cascade,
  url text not null check (url ~* '^https?://[a-z0-9.-]+\.[a-z]{2,}(/.*)?$' and length(url) <= 300),
  endret_av text default lower(auth.jwt() ->> 'email'),
  endret timestamptz not null default now()
);
alter table public.kunde_nettside enable row level security;
grant select, insert, update, delete on public.kunde_nettside to authenticated;

-- Alle som ser kunden (eget område via RLS på kunder) kan lese og endre nettsiden
create policy "nettside: lese" on public.kunde_nettside for select to authenticated
  using (exists (select 1 from public.kunder k where k.kundenr = kunde_nettside.kundenr));
create policy "nettside: legge til" on public.kunde_nettside for insert to authenticated
  with check (exists (select 1 from public.kunder k where k.kundenr = kunde_nettside.kundenr));
create policy "nettside: endre" on public.kunde_nettside for update to authenticated
  using (exists (select 1 from public.kunder k where k.kundenr = kunde_nettside.kundenr))
  with check (exists (select 1 from public.kunder k where k.kundenr = kunde_nettside.kundenr));
create policy "nettside: slette" on public.kunde_nettside for delete to authenticated
  using (exists (select 1 from public.kunder k where k.kundenr = kunde_nettside.kundenr));
create policy "krev tofaktor" on public.kunde_nettside as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
