-- VBL-medlemmer i Nord som ikke er kunder: ny prospekttype «vbl».
-- Kilde: vbl.no/medlemsoversikt (15.11.2026), adresser fra Enhetsregisteret, koordinater fra Kartverket.
-- Haaland AS: bare avdelingene for ventilasjon/blikk (Bodø og Rognan), ikke elektro og rør.
alter table public.prospekter drop constraint if exists prospekter_type_check;
alter table public.prospekter add constraint prospekter_type_check check (type = any (array['byggevare', 'tak', 'vbl']));

with ny(orgnr, navn, hovedorgnr, hovednavn, naering, adresse, postnr, poststed, kommunenr, lat, lon, ansatte, hjemmeside) as (values
  ('918998926', 'Alfa Byggtjenester AS', '918953558', 'ALFA BYGGTJENESTER AS', '43.320 Snekkerarbeid', 'Holsøyveien 24', '8370', 'Leknes', '1860', 68.140446, 13.644085, null::int, null),
  ('914848679', 'Båtsfjord Blikkenslagerservice AS', '914829348', 'BÅTSFJORD BLIKKENSLAGERSERVICE AS', '43.410 Takarbeid', 'Klausjorda 28', '9990', 'Båtsfjord', '5632', 70.631239, 29.699213, null, null),
  ('925036498', 'Haaland AS avd Bodø Ventilasjon', '920520146', 'HAALAND AS', '43.223 Ventilasjonsarbeid', 'Påls vei 4A', '8008', 'Bodø', '1804', 67.275776, 14.405532, 14, 'www.haaland.no'),
  ('934760573', 'Haaland AS avd Indre Salten Ventilasjon og blikk', '920520146', 'HAALAND AS', '43.223 Ventilasjonsarbeid', 'Lagerveien 5A', '8250', 'Rognan', '1840', 67.085839, 15.377643, 14, 'www.haaland.no'),
  ('924894806', 'Nordaførr Blikk AS', '924868147', 'NORDAFØRR BLIKK AS', '43.410 Takarbeid', 'Teglverkveien 17', '8006', 'Bodø', '1804', 67.29218, 14.411236, 8, null),
  ('972237566', 'VePro AS', '959463484', 'VEPRO AS', '25.990 Produksjon av andre metallvarer', 'Brugata 13', '8656', 'Mosjøen', '1824', 65.827356, 13.201176, 8, 'www.vepro.no')
)
insert into public.prospekter (orgnr, type, navn, kjede, naering, hovedorgnr, hovednavn, adresse, postnr, poststed, kommunenr, region, lat, lon, ansatte, hjemmeside, omraade)
select n.orgnr, 'vbl', n.navn, 'VBL-medlem', n.naering, n.hovedorgnr, n.hovednavn, n.adresse, n.postnr, n.poststed, n.kommunenr,
  coalesce((select p.region from public.prospekter p where p.kommunenr = n.kommunenr and p.region is not null limit 1),
           (select k.region from public.kunder k where lower(k.poststed) = lower(n.poststed) and k.region is not null limit 1)),
  n.lat, n.lon, n.ansatte, n.hjemmeside, 'nord'
from ny n
where not exists (select 1 from public.kunde_adresse a where a.orgnr = n.orgnr)
on conflict (orgnr) do update set type = 'vbl', kjede = 'VBL-medlem', naering = excluded.naering, region = coalesce(excluded.region, public.prospekter.region);

-- Omsetning fra siste årsregnskap (selskapsnivå)
update public.prospekter p set omsetning = (r.content::jsonb -> 0 #>> '{resultatregnskapResultat,driftsresultat,driftsinntekter,sumDriftsinntekter}')::bigint,
  regnskapsaar = left(r.content::jsonb -> 0 #>> '{regnskapsperiode,tilDato}', 4)::int
from (select distinct hovedorgnr from public.prospekter where type = 'vbl') h,
  lateral extensions.http_get('https://data.brreg.no/regnskapsregisteret/regnskap/' || h.hovedorgnr) r
where p.type = 'vbl' and p.hovedorgnr = h.hovedorgnr and r.status = 200;
