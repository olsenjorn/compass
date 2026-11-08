// regnskap: henter siste årsregnskap (driftsinntekter) fra Brønnøysund Regnskapsregisteret.
// Regnskapsregisteret sender ikke CORS-hoder, så nettleseren må gå via denne funksjonen.
// Bare for innloggede brukere i public.tilgang. POST {orgnr: string[]} (maks 60 per kall).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function envKey(dictName: string, legacy: string): string | undefined {
  try {
    const d = JSON.parse(Deno.env.get(dictName) ?? "null");
    if (d && typeof d === "object") return d.default ?? Object.values(d)[0] as string;
  } catch (_) { /* ignorer */ }
  return Deno.env.get(legacy) ?? undefined;
}

type Regn = { omsetning: number | null; resultat: number | null; aar: number | null };

async function hent(orgnr: string): Promise<Regn | null> {
  const base = `https://data.brreg.no/regnskapsregisteret/regnskap/${orgnr}`;
  let r = await fetch(base, { headers: { Accept: "application/json", "User-Agent": "lindab-kundekartnord" } });
  if (r.status === 404) r = await fetch(base + "?regnskapstype=SELSKAP", { headers: { Accept: "application/json", "User-Agent": "lindab-kundekartnord" } });
  if (r.status === 404 || r.status === 204) return null;
  if (!r.ok) throw new Error(`Regnskapsregisteret svarte ${r.status}`);
  const arr = await r.json();
  const list = Array.isArray(arr) ? arr : [arr];
  let best: Regn | null = null;
  for (const x of list) {
    const aar = x?.regnskapsperiode?.tilDato ? Number(String(x.regnskapsperiode.tilDato).slice(0, 4)) : null;
    const oms = x?.resultatregnskapResultat?.driftsresultat?.driftsinntekter?.sumDriftsinntekter ?? null;
    const res = x?.resultatregnskapResultat?.ordinaertResultatFoerSkattekostnad ?? x?.resultatregnskapResultat?.aarsresultat ?? null;
    if (!best || (aar ?? 0) > (best.aar ?? 0)) best = { omsetning: oms, resultat: res, aar };
  }
  return best;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const pub = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    if (!pub) return json({ error: "Mangler Supabase-nøkler i funksjonsmiljøet" }, 500);
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Ikke innlogget" }, 401);
    const userDb = createClient(url, pub, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: me, error: meErr } = await userDb.from("tilgang").select("rolle").maybeSingle();
    if (meErr || !me) return json({ error: "Ingen tilgang" }, 403);

    const body = await req.json().catch(() => ({}));
    const orgnr: string[] = (Array.isArray(body?.orgnr) ? body.orgnr : [])
      .map((s: unknown) => String(s).replace(/\D/g, "")).filter((s: string) => s.length === 9).slice(0, 60);
    if (!orgnr.length) return json({ error: "Mangler organisasjonsnummer" }, 400);
    if (body?.debug) {
      const r = await fetch(`https://data.brreg.no/regnskapsregisteret/regnskap/${orgnr[0]}`, { headers: { Accept: "application/json" } });
      return json({ status: r.status, body: (await r.text()).slice(0, 3000) });
    }

    const out: Record<string, Regn | null | { error: string }> = {};
    let i = 0;
    const worker = async () => {
      while (i < orgnr.length) {
        const o = orgnr[i++];
        try { out[o] = await hent(o); } catch (e) { out[o] = { error: String((e as Error).message ?? e) }; }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return json({ regnskap: out });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
