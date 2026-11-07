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
