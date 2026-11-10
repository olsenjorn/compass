-- Vedlikehold av kundedata (kunder + kunde_info) fra Excel, for admin/leder.
-- Appen slår sammen fila med dagens data og sender hele rader; funksjonen lagrer alt i én transaksjon
-- og tar vare på radene slik de var før, så en import kan angres.

-- Skriverettigheter på kunder for admin/leder (lesing er uendret)
drop policy if exists "kunder: legge til (admin/leder)" on public.kunder;
create policy "kunder: legge til (admin/leder)" on public.kunder for insert to authenticated
  with check (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "kunder: endre (admin/leder)" on public.kunder;
create policy "kunder: endre (admin/leder)" on public.kunder for update to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')))
  with check (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "kunder: slette (admin/leder)" on public.kunder;
create policy "kunder: slette (admin/leder)" on public.kunder for delete to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
grant select, insert, update, delete on public.kunder to authenticated;

-- Logg over importer, med kopi av radene før endring
create table if not exists public.import_logg (
  id        bigint generated always as identity primary key,
  tid       timestamptz not null default now(),
  av        text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  filnavn   text,
  nye       int not null default 0,
  endret    int not null default 0,
  slettet   int not null default 0,
  foer      jsonb not null default '{}'::jsonb,   -- {kunder:[...], info:[...], nye:[kundenr...]}
  angret    timestamptz
);
alter table public.import_logg enable row level security;
drop policy if exists "logg: lese (admin/leder)" on public.import_logg;
create policy "logg: lese (admin/leder)" on public.import_logg for select to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "logg: skrive (admin/leder)" on public.import_logg;
create policy "logg: skrive (admin/leder)" on public.import_logg for insert to authenticated
  with check (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "logg: angre (admin/leder)" on public.import_logg;
create policy "logg: angre (admin/leder)" on public.import_logg for update to authenticated
  using (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')))
  with check (exists (select 1 from public.tilgang t where t.epost = lower((select auth.jwt() ->> 'email')) and t.rolle in ('admin','leder')));
drop policy if exists "krev tofaktor" on public.import_logg;
create policy "krev tofaktor" on public.import_logg as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
revoke all on public.import_logg from anon;
grant select, insert, update on public.import_logg to authenticated;

-- Importen. SECURITY INVOKER: radreglene over gjelder, så bare admin/leder med tofaktor kommer gjennom.
create or replace function public.importer_kunder(p_kunder jsonb, p_info jsonb, p_slett text[], p_filnavn text)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_keys text[];
  v_nye int; v_endret int; v_slettet int := 0; v_id bigint;
  v_meg text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if not exists (select 1 from public.tilgang t where t.epost = v_meg and t.rolle in ('admin','leder')) then
    raise exception 'Bare admin eller leder kan laste opp kundedata';
  end if;
  select coalesce(array_agg(x ->> 'kundenr'), '{}') into v_keys from jsonb_array_elements(coalesce(p_kunder, '[]')) x;
  p_slett := coalesce(p_slett, '{}');

  select count(*) into v_nye from unnest(v_keys) k where not exists (select 1 from public.kunder c where c.kundenr = k);
  v_endret := cardinality(v_keys) - v_nye;

  insert into public.import_logg (filnavn, nye, endret, slettet, foer) values (
    p_filnavn, v_nye, v_endret, cardinality(p_slett),
    jsonb_build_object(
      'kunder', coalesce((select jsonb_agg(to_jsonb(c)) from public.kunder c where c.kundenr = any(v_keys) or c.kundenr = any(p_slett)), '[]'),
      'info',   coalesce((select jsonb_agg(to_jsonb(i)) from public.kunde_info i where i.kundenr = any(v_keys) or i.kundenr = any(p_slett)), '[]'),
      'adresse',coalesce((select jsonb_agg(to_jsonb(a)) from public.kunde_adresse a where a.kundenr = any(p_slett)), '[]'),
      'rettelse',coalesce((select jsonb_agg(to_jsonb(r)) from public.sted_rettelse r where r.kundenr = any(p_slett)), '[]'),
      'nye',    coalesce((select jsonb_agg(k) from unnest(v_keys) k where not exists (select 1 from public.kunder c where c.kundenr = k)), '[]')
    )) returning id into v_id;

  insert into public.kunder (kundenr, navn, kategori, eier, oms_ventilasjon, oms_profil, oms_total, segment, poststed, poststed_kilde,
                             kommune, region, lat, lon, presisjon, besoksadresse, postnr, bransje, status, oppdatert)
  select r.kundenr, r.navn, r.kategori, r.eier, coalesce(r.oms_ventilasjon, 0), coalesce(r.oms_profil, 0), coalesce(r.oms_total, 0), r.segment,
         r.poststed, r.poststed_kilde, r.kommune, r.region, r.lat, r.lon, r.presisjon, r.besoksadresse, r.postnr, r.bransje, r.status, now()
  from jsonb_populate_recordset(null::public.kunder, coalesce(p_kunder, '[]')) r
  on conflict (kundenr) do update set
    navn = excluded.navn, kategori = excluded.kategori, eier = excluded.eier,
    oms_ventilasjon = excluded.oms_ventilasjon, oms_profil = excluded.oms_profil, oms_total = excluded.oms_total, segment = excluded.segment,
    poststed = excluded.poststed, poststed_kilde = excluded.poststed_kilde, kommune = excluded.kommune, region = excluded.region,
    lat = excluded.lat, lon = excluded.lon, presisjon = excluded.presisjon, besoksadresse = excluded.besoksadresse, postnr = excluded.postnr,
    bransje = excluded.bransje, status = excluded.status, oppdatert = now();

  insert into public.kunde_info (kundenr, kjede, konstellasjon, vbl, byggvare, endret_av, endret)
  select r.kundenr, r.kjede, r.konstellasjon, coalesce(r.vbl, false), coalesce(r.byggvare, false), v_meg, now()
  from jsonb_populate_recordset(null::public.kunde_info, coalesce(p_info, '[]')) r
  on conflict (kundenr) do update set kjede = excluded.kjede, konstellasjon = excluded.konstellasjon,
    vbl = excluded.vbl, byggvare = excluded.byggvare, endret_av = excluded.endret_av, endret = now();

  if cardinality(p_slett) > 0 then
    delete from public.kunder where kundenr = any(p_slett);
    get diagnostics v_slettet = row_count;
  end if;

  return jsonb_build_object('id', v_id, 'nye', v_nye, 'endret', v_endret, 'slettet', v_slettet);
end $$;
revoke execute on function public.importer_kunder(jsonb, jsonb, text[], text) from public, anon;
grant execute on function public.importer_kunder(jsonb, jsonb, text[], text) to authenticated;

-- Angre en import: legger tilbake radene slik de var, fjerner kunder importen la til.
create or replace function public.angre_import(p_id bigint)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare l public.import_logg;
begin
  select * into l from public.import_logg where id = p_id for update;
  if l.id is null then raise exception 'Fant ikke importen'; end if;
  if l.angret is not null then raise exception 'Importen er allerede angret'; end if;
  if exists (select 1 from public.import_logg x where x.id > l.id and x.angret is null) then
    raise exception 'Angre de nyere importene først';
  end if;

  delete from public.kunder where kundenr in (select jsonb_array_elements_text(l.foer -> 'nye'));

  insert into public.kunder select * from jsonb_populate_recordset(null::public.kunder, l.foer -> 'kunder')
  on conflict (kundenr) do update set
    navn = excluded.navn, kategori = excluded.kategori, eier = excluded.eier,
    oms_ventilasjon = excluded.oms_ventilasjon, oms_profil = excluded.oms_profil, oms_total = excluded.oms_total, segment = excluded.segment,
    poststed = excluded.poststed, poststed_kilde = excluded.poststed_kilde, kommune = excluded.kommune, region = excluded.region,
    lat = excluded.lat, lon = excluded.lon, presisjon = excluded.presisjon, besoksadresse = excluded.besoksadresse, postnr = excluded.postnr,
    bransje = excluded.bransje, status = excluded.status, oppdatert = excluded.oppdatert;

  -- info som ikke fantes før importen, fjernes; resten legges tilbake
  delete from public.kunde_info i
   where i.kundenr in (select x ->> 'kundenr' from jsonb_array_elements(l.foer -> 'kunder') x)
     and not exists (select 1 from jsonb_array_elements(l.foer -> 'info') y where y ->> 'kundenr' = i.kundenr);
  insert into public.kunde_info select * from jsonb_populate_recordset(null::public.kunde_info, l.foer -> 'info')
  on conflict (kundenr) do update set kjede = excluded.kjede, konstellasjon = excluded.konstellasjon,
    vbl = excluded.vbl, byggvare = excluded.byggvare, endret_av = excluded.endret_av, endret = excluded.endret;
  insert into public.kunde_adresse select * from jsonb_populate_recordset(null::public.kunde_adresse, coalesce(l.foer -> 'adresse', '[]'))
  on conflict (kundenr) do nothing;
  insert into public.sted_rettelse select * from jsonb_populate_recordset(null::public.sted_rettelse, coalesce(l.foer -> 'rettelse', '[]'))
  on conflict (kundenr) do nothing;

  update public.import_logg set angret = now() where id = p_id;
  return jsonb_build_object('id', p_id);
end $$;
revoke execute on function public.angre_import(bigint) from public, anon;
grant execute on function public.angre_import(bigint) to authenticated;
