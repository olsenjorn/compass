-- Kommentar/agenda per besøk eller avtale i en rute. Eieren av ruta og alle som er invitert
-- til møtet kan lese og skrive. De ruta er delt med kan lese.
create table if not exists public.stopp_notat (
  rute_id    uuid not null references public.ruteplaner(id) on delete cascade,
  stopp_uid  text not null,
  tekst      text not null default '',
  endret_av  text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  endret     timestamptz not null default now(),
  primary key (rute_id, stopp_uid)
);
alter table public.stopp_notat enable row level security;

create or replace function public.notat_tilgang(r uuid, s text, skrive boolean) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.ruteplaner p where p.id = r
                 and (p.laget_av = lower((select auth.jwt() ->> 'email'))
                      or (not skrive and lower((select auth.jwt() ->> 'email')) = any (p.delt_med))))
      or exists (select 1 from public.invitasjoner i where i.rute_id = r and i.stopp_uid = s
                 and i.til_epost = lower((select auth.jwt() ->> 'email')))
$$;
revoke execute on function public.notat_tilgang(uuid, text, boolean) from public, anon;
grant execute on function public.notat_tilgang(uuid, text, boolean) to authenticated;

drop policy if exists "notat: lese" on public.stopp_notat;
create policy "notat: lese" on public.stopp_notat for select to authenticated using (public.notat_tilgang(rute_id, stopp_uid, false));
drop policy if exists "notat: skrive" on public.stopp_notat;
create policy "notat: skrive" on public.stopp_notat for insert to authenticated with check (public.notat_tilgang(rute_id, stopp_uid, true) and endret_av = lower((select auth.jwt() ->> 'email')));
drop policy if exists "notat: endre" on public.stopp_notat;
create policy "notat: endre" on public.stopp_notat for update to authenticated using (public.notat_tilgang(rute_id, stopp_uid, true)) with check (public.notat_tilgang(rute_id, stopp_uid, true) and endret_av = lower((select auth.jwt() ->> 'email')));
drop policy if exists "notat: slette (eier)" on public.stopp_notat;
create policy "notat: slette (eier)" on public.stopp_notat for delete to authenticated using (exists (select 1 from public.ruteplaner p where p.id = rute_id and p.laget_av = lower((select auth.jwt() ->> 'email'))));
drop policy if exists "krev tofaktor" on public.stopp_notat;
create policy "krev tofaktor" on public.stopp_notat as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

revoke all on public.stopp_notat from anon;
grant select, insert, update, delete on public.stopp_notat to authenticated;
