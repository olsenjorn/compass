-- Invitasjoner: når en selger legger en kollega på et kundebesøk, får kollegaen en forespørsel
-- som må godtas eller avslås. Godtatte invitasjoner vises i kollegaens kalender og legges
-- automatisk inn i kollegaens egen planlegging den dagen.
create table if not exists public.invitasjoner (
  id          uuid primary key default gen_random_uuid(),
  rute_id     uuid not null references public.ruteplaner(id) on delete cascade,
  stopp_uid   text not null,
  fra_epost   text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  til_epost   text not null check (til_epost = lower(til_epost)),
  dag         int  not null default 0,
  dato        date,
  fra_kl      int,
  til_kl      int,
  kundenr     text,
  kundenavn   text,
  sted        text,
  lat         double precision,
  lon         double precision,
  rute_tittel text,
  status      text not null default 'ventende' check (status in ('ventende','godtatt','avslatt')),
  svart       timestamptz,
  opprettet   timestamptz not null default now(),
  endret      timestamptz not null default now(),
  unique (rute_id, stopp_uid, til_epost)
);
create index if not exists invitasjoner_til_idx on public.invitasjoner (til_epost, status);
alter table public.invitasjoner enable row level security;

drop policy if exists "inv: lese egne" on public.invitasjoner;
create policy "inv: lese egne" on public.invitasjoner for select to authenticated
  using (fra_epost = lower((select auth.jwt() ->> 'email')) or til_epost = lower((select auth.jwt() ->> 'email')));

drop policy if exists "inv: sende fra egen rute" on public.invitasjoner;
create policy "inv: sende fra egen rute" on public.invitasjoner for insert to authenticated
  with check (fra_epost = lower((select auth.jwt() ->> 'email'))
    and exists (select 1 from public.ruteplaner r where r.id = rute_id and r.laget_av = lower((select auth.jwt() ->> 'email')))
    and exists (select 1 from public.tilgang t where t.epost = til_epost));

drop policy if exists "inv: endre (avsender) eller svare (mottaker)" on public.invitasjoner;
create policy "inv: endre (avsender) eller svare (mottaker)" on public.invitasjoner for update to authenticated
  using (fra_epost = lower((select auth.jwt() ->> 'email')) or til_epost = lower((select auth.jwt() ->> 'email')))
  with check (fra_epost = lower((select auth.jwt() ->> 'email')) or til_epost = lower((select auth.jwt() ->> 'email')));

drop policy if exists "inv: slette (avsender)" on public.invitasjoner;
create policy "inv: slette (avsender)" on public.invitasjoner for delete to authenticated
  using (fra_epost = lower((select auth.jwt() ->> 'email')));

-- Mottakeren kan bare endre status (svaret). Avsenderen kan endre alt unntatt status.
create or replace function public.invitasjoner_vakt() returns trigger
language plpgsql set search_path = '' as $$
declare meg text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  new.endret := now();
  if new.fra_epost <> old.fra_epost or new.til_epost <> old.til_epost or new.rute_id <> old.rute_id then
    raise exception 'Avsender, mottaker og rute kan ikke endres';
  end if;
  if meg = old.til_epost and meg <> old.fra_epost then
    if new.status is distinct from old.status then new.svart := now(); end if;
    -- alt annet låses til gamle verdier
    new.dag := old.dag; new.dato := old.dato; new.fra_kl := old.fra_kl; new.til_kl := old.til_kl;
    new.kundenr := old.kundenr; new.kundenavn := old.kundenavn; new.sted := old.sted; new.lat := old.lat; new.lon := old.lon;
    new.rute_tittel := old.rute_tittel; new.stopp_uid := old.stopp_uid;
  elsif meg = old.fra_epost then
    new.status := old.status; new.svart := old.svart;
  end if;
  return new;
end $$;
drop trigger if exists invitasjoner_vakt on public.invitasjoner;
create trigger invitasjoner_vakt before update on public.invitasjoner for each row execute function public.invitasjoner_vakt();
revoke execute on function public.invitasjoner_vakt() from public, anon, authenticated;

drop policy if exists "krev tofaktor" on public.invitasjoner;
create policy "krev tofaktor" on public.invitasjoner as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

revoke all on public.invitasjoner from anon;
grant select, insert, update, delete on public.invitasjoner to authenticated;
