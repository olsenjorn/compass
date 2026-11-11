# Kundekart Nord

Kundeoversikt og kart for Lindabs selgere i Nord-Norge (Profil og Ventilasjon).

- `index.html`, `app.js` – appen (statisk side, GitHub Pages)
- `config.js` – Supabase-URL og publishable key (offentlige verdier)
- `data/` – kommunegrenser, poststeder og regioner (offentlige data, Kartverket)
- `supabase/migrations/` – tabeller og tilgangsregler

Kundedata ligger kun i Supabase og vises bare for innloggede brukere som står i tabellen `tilgang`.
Legg aldri kundefiler (xlsx, seed-SQL) i dette repoet.

## Ladestasjoner (NOBIL)

Edge Function `nobil-ladere` henter datadump fra NOBIL, filtrerer på Nord-Norge og bufrer i
`ladestasjon_cache` i 24 timer. API-nøkkelen ligger som secret `NOBIL_API_KEY`, aldri i koden.

    supabase secrets set NOBIL_API_KEY=<nøkkel> --project-ref zvrwunzxhlzowtokecjb
    supabase functions deploy nobil-ladere --project-ref zvrwunzxhlzowtokecjb --no-verify-jwt

Funksjonen sjekker selv at kalleren er innlogget og står i `tilgang`.

## Kundedata (Excel)

Admin og leder har «Kundedata (Excel)» i kontomenyen:

- **Last ned** gir en Excel-fil med alle kundene (arket «Kunder») og en veiledning.
- **Last opp** leser fila, viser nye, endrede og manglende kunder og advarsler før noe lagres.
  Kolonner som mangler i fila, endres ikke. Eksporter med Axapta/Lime-overskrifter kjennes igjen.
- Lagringen skjer i databasefunksjonen `importer_kunder` (én transaksjon). Radene slik de var før,
  lagres i `import_logg`, og siste opplasting kan angres (`angre_import`).

## Vegmeldinger (Statens vegvesen, DATEX II 3.1)

Edge Function `vegmeldinger` henter `GetSituation/pullsnapshotdata` med Basic Auth (secrets `DATEX_USER`/`DATEX_PASS`),
beholder meldinger i Nordland, Troms og Finnmark, klassifiserer dem (stengt, kolonne, periodevis stengt, ras, ulykke,
føre, ferje, begrensning, vegarbeid), regner om geometri fra UTM 33 og bufrer i `vegmelding_cache` i 5 minutter.
Funksjonen sjekker selv at kalleren er innlogget med tofaktor og står i `tilgang`.

`vegmeldinger.js` viser kartlaget og sjekker hver etappe i planleggeren mot meldingene i tidsrommet man kjører der
(inkludert tidsrom som «kl. 21–06:30 man–ons»). Data: Statens vegvesen, norsk lisens for offentlige data (NLOD).
