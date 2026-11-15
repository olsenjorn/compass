-- Regnskapstall per kunde (selskapet kundens org.nr. hører til) for potensialbarometeret og filteret i kartet.
-- Fylles og holdes oppdatert av public.kunde_regnskap_oppdater() via pg_cron (hver kunde sjekkes på nytt etter 7 dager).
-- Data: Enhetsregisteret og Regnskapsregisteret (Brønnøysundregistrene), de samme tallene som Proff viser.
create table if not exists public.kunde_regnskap (
  kundenr text primary key references public.kunder(kundenr) on delete cascade,
  orgnr text, hoved text, avdelinger int,
  aar int, omsetning numeric, driftskostnad numeric, lonn numeric,
  status text not null default 'ok',   -- ok | mangler_orgnr | ingen_regnskap | feil
  hentet timestamptz not null default now()
);
alter table public.kunde_regnskap enable row level security;
grant select on public.kunde_regnskap to authenticated;
create policy "regnskap: lese i eget område" on public.kunde_regnskap for select to authenticated
  using (exists (select 1 from public.kunder k where k.kundenr = kunde_regnskap.kundenr));
create policy "krev tofaktor" on public.kunde_regnskap as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());

create or replace function public.kunde_regnskap_oppdater(porsjon int default 25)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rad record; r record; j jsonb; hoved text; avd int; antall int := 0;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '10');
  for rad in
    select k.kundenr, a.orgnr from public.kunder k
    left join public.kunde_adresse a on a.kundenr = k.kundenr
    left join public.kunde_regnskap g on g.kundenr = k.kundenr
    where g.kundenr is null or g.hentet < now() - interval '7 days' or g.orgnr is distinct from a.orgnr
    order by g.hentet nulls first limit porsjon
  loop
    antall := antall + 1;
    if rad.orgnr is null or rad.orgnr !~ '^\d{9}$' then
      insert into public.kunde_regnskap as g (kundenr, orgnr, status, hentet) values (rad.kundenr, rad.orgnr, 'mangler_orgnr', now())
      on conflict (kundenr) do update set orgnr = excluded.orgnr, status = excluded.status, hoved = null, aar = null, omsetning = null, driftskostnad = null, lonn = null, avdelinger = null, hentet = now();
      continue;
    end if;
    begin
      -- selskapet avdelingen hører til
      select * into r from extensions.http_get('https://data.brreg.no/enhetsregisteret/api/underenheter/' || rad.orgnr);
      hoved := case when r.status = 200 then coalesce(r.content::jsonb->>'overordnetEnhet', rad.orgnr) else rad.orgnr end;
      select * into r from extensions.http_get('https://data.brreg.no/enhetsregisteret/api/underenheter?size=1&overordnetEnhet=' || hoved);
      avd := case when r.status = 200 then (r.content::jsonb #>> '{page,totalElements}')::int end;
      select * into r from extensions.http_get('https://data.brreg.no/regnskapsregisteret/regnskap/' || hoved);
      if r.status = 200 then
        j := r.content::jsonb; if jsonb_typeof(j) = 'array' then j := (select x from jsonb_array_elements(j) x order by x #>> '{regnskapsperiode,tilDato}' desc limit 1) end if;
        insert into public.kunde_regnskap as g (kundenr, orgnr, hoved, avdelinger, aar, omsetning, driftskostnad, lonn, status, hentet)
        values (rad.kundenr, rad.orgnr, hoved, avd, left(j #>> '{regnskapsperiode,tilDato}', 4)::int,
          (j #>> '{resultatregnskapResultat,driftsresultat,driftsinntekter,sumDriftsinntekter}')::numeric,
          (j #>> '{resultatregnskapResultat,driftsresultat,driftskostnad,sumDriftskostnad}')::numeric,
          (j #>> '{resultatregnskapResultat,driftsresultat,driftskostnad,loennskostnad}')::numeric, 'ok', now())
        on conflict (kundenr) do update set orgnr = excluded.orgnr, hoved = excluded.hoved, avdelinger = excluded.avdelinger, aar = excluded.aar,
          omsetning = excluded.omsetning, driftskostnad = excluded.driftskostnad, lonn = excluded.lonn, status = 'ok', hentet = now();
      else
        insert into public.kunde_regnskap as g (kundenr, orgnr, hoved, avdelinger, status, hentet) values (rad.kundenr, rad.orgnr, hoved, avd, case when r.status in (204, 404) then 'ingen_regnskap' else 'feil' end, now())
        on conflict (kundenr) do update set orgnr = excluded.orgnr, hoved = excluded.hoved, avdelinger = excluded.avdelinger, status = excluded.status, aar = null, omsetning = null, driftskostnad = null, lonn = null,
          hentet = case when excluded.status = 'feil' then now() - interval '6 days' else now() end;  -- feil: prøv igjen neste dag
      end if;
    exception when others then
      insert into public.kunde_regnskap as g (kundenr, orgnr, status, hentet) values (rad.kundenr, rad.orgnr, 'feil', now() - interval '6 days')
      on conflict (kundenr) do update set status = 'feil', hentet = now() - interval '6 days';
    end;
  end loop;
  return jsonb_build_object('behandlet', antall);
end $$;
revoke execute on function public.kunde_regnskap_oppdater(int) from public, anon, authenticated;

-- Hvert 3. minutt: gjør ingenting når alle er ferske, fyller på i porsjoner ellers
select cron.unschedule(jobname) from cron.job where jobname = 'kunde-regnskap';
select cron.schedule('kunde-regnskap', '*/3 * * * *', 'select public.kunde_regnskap_oppdater()');
