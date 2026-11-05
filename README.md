# Kundekart Nord

Kundeoversikt og kart for Lindabs selgere i Nord-Norge (Profil og Ventilasjon).

- `index.html`, `app.js` – appen (statisk side, GitHub Pages)
- `config.js` – Supabase-URL og publishable key (offentlige verdier)
- `data/` – kommunegrenser, poststeder og regioner (offentlige data, Kartverket)
- `supabase/migrations/` – tabeller og tilgangsregler

Kundedata ligger kun i Supabase og vises bare for innloggede brukere som står i tabellen `tilgang`.
Legg aldri kundefiler (xlsx, seed-SQL) i dette repoet.
