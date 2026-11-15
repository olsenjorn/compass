-- Brreg-varsel: daglig sjekk av alle organisasjonsnumre (kunder og prospekter) mot Enhetsregisteret.
-- Fanger opp konkurs, avvikling, tvangsavvikling, sletting og nedlagte avdelinger (også når det er
-- morselskapet til en avdeling som er konkurs). Kjøres hver natt av pg_cron; resultatet vises i appen.
create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

create table if not exists public.brreg_status (
  orgnr       text primary key,
  type        text,                 -- enhet | underenhet | ukjent
  navn        text,
  status      text not null,        -- aktiv | konkurs | avvikling | tvangsavvikling | slettet | nedlagt | ukjent
  dato        date,                 -- dato for hendelsen når Brreg oppgir den
  hovedorgnr  text,
  hovednavn   text,
  sjekket     timestamptz not null default now(),
  endret      timestamptz not null default now()   -- når status sist endret seg
);
alter table public.brreg_status enable row level security;

-- Lesbar når organisasjonsnummeret hører til en kunde eller et prospekt brukeren ser (RLS gjelder i underspørringene)
drop policy if exists "brreg: lese" on public.brreg_status;
create policy "brreg: lese" on public.brreg_status for select to authenticated
  using (exists (select 1 from public.kunde_adresse a where a.orgnr = brreg_status.orgnr)
      or exists (select 1 from public.prospekter p where p.orgnr = brreg_status.orgnr));
drop policy if exists "krev tofaktor" on public.brreg_status;
create policy "krev tofaktor" on public.brreg_status as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
revoke all on public.brreg_status from anon;
grant select on public.brreg_status to authenticated;

drop function if exists public.brreg_sjekk();
drop function if exists public.brreg_sjekk(int);
-- Sjekker inntil «porsjon» orgnr per kall (eldst sjekket først) med Brregs masseoppslag
-- (?organisasjonsnummer=a,b,c), så én kjøring er noen få HTTP-kall og godt under tidsgrensen på 2 min.
create or replace function public.brreg_sjekk(porsjon int default 150)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  liste text[]; o text; r record; j jsonb; h jsonb; hs text; st text; dt date; typ text; hovn text;
  u jsonb := '{}'::jsonb;  -- underenheter funnet, orgnr -> json
  e jsonb := '{}'::jsonb;  -- enheter (egne og morselskap), orgnr -> json
  mangler text[]; x jsonb; antall int := 0; ikke_aktive int;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
  select array_agg(s.x) into liste from (
    select s.x from (select orgnr x from public.kunde_adresse where orgnr ~ '^\d{9}$'
                     union select orgnr from public.prospekter where orgnr ~ '^\d{9}$') s
    left join public.brreg_status b on b.orgnr = s.x
    where b.sjekket is null or b.sjekket < now() - interval '20 hours'
    order by b.sjekket nulls first limit porsjon) s;
  if liste is null then return jsonb_build_object('sjekket', 0); end if;

  select * into r from extensions.http_get('https://data.brreg.no/enhetsregisteret/api/underenheter?size=1000&organisasjonsnummer=' || array_to_string(liste, ','));
  if r.status = 200 then
    for x in select * from jsonb_array_elements(coalesce(r.content::jsonb #> '{_embedded,underenheter}', '[]')) loop
      u := u || jsonb_build_object(x->>'organisasjonsnummer', x);
    end loop;
  end if;
  -- enheter: de som ikke er underenheter, pluss morselskapene til underenhetene
  select array_agg(distinct y) into mangler from (
    select unnest(liste) y except select jsonb_object_keys(u)
    union select v->>'overordnetEnhet' from jsonb_each(u) t(k, v) where v ? 'overordnetEnhet') z where y is not null;
  if mangler is not null then
    select * into r from extensions.http_get('https://data.brreg.no/enhetsregisteret/api/enheter?size=1000&organisasjonsnummer=' || array_to_string(mangler, ','));
    if r.status = 200 then
      for x in select * from jsonb_array_elements(coalesce(r.content::jsonb #> '{_embedded,enheter}', '[]')) loop
        e := e || jsonb_build_object(x->>'organisasjonsnummer', x);
      end loop;
    end if;
  end if;

  foreach o in array liste loop
    antall := antall + 1; st := 'aktiv'; dt := null; hs := null; hovn := null;
    if u ? o then
      typ := 'underenhet'; j := u->o; hs := j->>'overordnetEnhet';
      if j ? 'slettedato' then st := 'slettet'; dt := (j->>'slettedato')::date;
      elsif j ? 'nedleggelsesdato' then st := 'nedlagt'; dt := (j->>'nedleggelsesdato')::date; end if;
      h := coalesce(e->hs, '{}'::jsonb); hovn := h->>'navn';
    elsif e ? o then
      typ := 'enhet'; j := e->o; h := j;
    else
      -- ikke i søket: trolig slettet. Slå opp enkeltvis (410 = slettet).
      typ := 'enhet'; j := '{}'::jsonb; h := '{}'::jsonb;
      select * into r from extensions.http_get('https://data.brreg.no/enhetsregisteret/api/enheter/' || o);
      if r.status = 410 then st := 'slettet';
      elsif r.status = 200 then j := r.content::jsonb; h := j;
      else
        select * into r from extensions.http_get('https://data.brreg.no/enhetsregisteret/api/underenheter/' || o);
        typ := 'underenhet';
        if r.status = 410 then st := 'slettet';
        elsif r.status = 200 then j := r.content::jsonb; if j ? 'slettedato' then st := 'slettet'; dt := (j->>'slettedato')::date; end if;
        else st := 'ukjent'; typ := 'ukjent'; end if;
      end if;
    end if;
    -- konkurs/avvikling ligger på enheten (for avdelinger: morselskapet)
    if st = 'aktiv' then
      if coalesce((h->>'konkurs')::boolean, false) then st := 'konkurs'; dt := nullif(h->>'konkursdato','')::date;
      elsif coalesce((h->>'underTvangsavviklingEllerTvangsopplosning')::boolean, false) then st := 'tvangsavvikling'; dt := nullif(h->>'tvangsavvikletPgaManglendeSlettingDato','')::date;
      elsif coalesce((h->>'underAvvikling')::boolean, false) then st := 'avvikling'; dt := nullif(h->>'underAvviklingDato','')::date;
      elsif h ? 'slettedato' then st := 'slettet'; dt := nullif(h->>'slettedato','')::date;
      end if;
    end if;
    insert into public.brreg_status as b (orgnr, type, navn, status, dato, hovedorgnr, hovednavn, sjekket, endret)
    values (o, typ, j->>'navn', st, dt, hs, hovn, now(), now())
    on conflict (orgnr) do update set type = excluded.type, navn = coalesce(excluded.navn, b.navn), dato = excluded.dato,
      hovedorgnr = excluded.hovedorgnr, hovednavn = excluded.hovednavn, sjekket = now(),
      endret = case when b.status is distinct from excluded.status then now() else b.endret end,
      status = excluded.status;
  end loop;
  select count(*) into ikke_aktive from public.brreg_status where status <> 'aktiv';
  return jsonb_build_object('sjekket', antall, 'ikke_aktive', ikke_aktive);
end $$;
revoke execute on function public.brreg_sjekk(int) from public, anon, authenticated;

-- Hver natt: hvert 5. minutt mellom 03:00 og 03:55 UTC (04–05 norsk vintertid), 150 orgnr per kjøring.
-- Hver orgnr sjekkes én gang per natt; kjøringer uten noe igjen å sjekke gjør ingenting.
select cron.unschedule(jobname) from cron.job where jobname in ('brreg-sjekk', 'brreg-forste');
select cron.schedule('brreg-sjekk', '*/5 3 * * *', 'select public.brreg_sjekk()');
