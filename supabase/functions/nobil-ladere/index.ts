// nobil-ladere: henter ladestasjoner i Nord-Norge fra NOBIL (datadump), bufrer i databasen i 24 timer
// og leverer en kompakt liste til innloggede brukere som står i public.tilgang.
// API-nøkkelen ligger som secret NOBIL_API_KEY og når aldri nettleseren (krav i NOBILs vilkår).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const MAX_AGE_MS = 24 * 3600 * 1000;
const MIN_LAT = 64.5; // sør for Helgeland
// Rogaland (salgsområde Stavanger), med litt margin mot Agder og Sunnhordland
const iRogaland = (lat: number, lon: number) => lat >= 58.0 && lat <= 59.95 && lon >= 4.7 && lon <= 7.4;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function envKey(dictName: string, legacy: string): string | undefined {
  try {
    const d = JSON.parse(Deno.env.get(dictName) ?? "null");
    if (d && typeof d === "object") return d.default ?? Object.values(d)[0] as string;
  } catch (_) { /* ignorer */ }
  return Deno.env.get(legacy) ?? undefined;
}

type Station = [number, number, string, string, number, number, string, string];

function parseKw(t: string): number {
  const k = t.match(/(\d+(?:[.,]\d+)?)\s*kW/i);
  if (k) return parseFloat(k[1].replace(",", "."));
  const v = t.match(/(\d{3})\s*V/i), a = t.match(/(\d+)\s*A\b/i);
  if (v && a) return Math.round(+v[1] * +a[1] * (/3-?phase|3-fas/i.test(t) ? 1.732 : 1) / 1000);
  return 0;
}

// deno-lint-ignore no-explicit-any
function parse(dump: any): Station[] {
  const out: Station[] = [];
  for (const s of dump?.chargerstations ?? []) {
    const c = s?.csmd; if (!c) continue;
    const m = String(c.Position ?? "").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!m) continue;
    const lat = +m[1], lon = +m[2];
    if (!(lat >= MIN_LAT) && !iRogaland(lat, lon)) continue;
    let kw = 0;
    for (const conn of Object.values(s?.attr?.conn ?? {}) as Record<string, { trans?: string; attrval?: string }>[]) {
      const cap = conn?.["5"];
      if (cap) kw = Math.max(kw, parseKw(String(cap.trans ?? cap.attrval ?? "")));
    }
    const addr = [c.Street, c.House_number].filter(Boolean).join(" ") + (c.City ? ", " + c.City : "");
    out.push([+lat.toFixed(5), +lon.toFixed(5), String(c.name ?? "Ladestasjon"), String(c.Owned_by || c.Operator || ""),
      Math.round(kw), +c.Number_charging_points || 0, addr, String(c.id ?? "")]);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const pub = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const sec = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!pub || !sec) return json({ error: "Mangler Supabase-nøkler i funksjonsmiljøet" }, 500);

    // Sjekk at kalleren er innlogget og står på tilgangslista (RLS gjør jobben).
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Ikke innlogget" }, 401);
    const userDb = createClient(url, pub, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: me, error: meErr } = await userDb.from("tilgang").select("rolle").maybeSingle();
    if (meErr || !me) return json({ error: "Ingen tilgang" }, 403);

    const admin = createClient(url, sec, { auth: { persistSession: false } });
    const wantRefresh = new URL(req.url).searchParams.get("oppdater") === "1" && ["admin", "leder"].includes(me.rolle);
    const { data: cache } = await admin.from("ladestasjon_cache").select("hentet,antall,data").eq("id", 1).maybeSingle();
    const fresh = cache && Date.now() - new Date(cache.hentet).getTime() < MAX_AGE_MS && cache.antall > 0;
    if (fresh && !wantRefresh) return json({ hentet: cache.hentet, kilde: "buffer", stasjoner: cache.data });

    const key = Deno.env.get("NOBIL_API_KEY");
    if (!key) return json({ error: "NOBIL_API_KEY er ikke satt som secret" }, 500);
    const base = Deno.env.get("NOBIL_BASE") ?? "https://nobil.no";
    const r = await fetch(`${base}/api/server/datadump.php?apikey=${encodeURIComponent(key)}&countrycode=NOR&format=json&file=false`);
    if (!r.ok) {
      if (cache?.antall) return json({ hentet: cache.hentet, kilde: "buffer", advarsel: `NOBIL svarte ${r.status}`, stasjoner: cache.data });
      return json({ error: `NOBIL svarte ${r.status}` }, 502);
    }
    const text = (await r.text()).replace(/^﻿/, "");
    const list = parse(JSON.parse(text));
    if (!list.length) return json({ error: "NOBIL-uttrekket inneholdt ingen stasjoner i Nord-Norge" }, 502);
    const hentet = new Date().toISOString();
    const { error: upErr } = await admin.from("ladestasjon_cache").upsert({ id: 1, hentet, antall: list.length, data: list });
    return json({ hentet, kilde: "nobil", advarsel: upErr ? "Kunne ikke lagre buffer: " + upErr.message : undefined, stasjoner: list });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
