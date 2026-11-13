// vegmeldinger: trafikkmeldinger fra Statens vegvesen (DATEX II 3.1, GetSituation) for Nordland, Troms og Finnmark.
// Henter hele publikasjonen (Basic Auth), beholder meldinger i nord som ikke er utløpt, slår sammen records per
// situasjon, klassifiserer (stengt, kolonne, periodevis stengt, ras/hindring, føre, ferje, vegarbeid) og
// bufrer resultatet i public.vegmelding_cache i 5 minutter. Brukernavn/passord ligger som secrets DATEX_USER/DATEX_PASS.
// Data: Statens vegvesen, norsk lisens for offentlige data (NLOD).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const URL_SIT = "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetSituation/pullsnapshotdata";
const MAX_AGE_MS = 5 * 60 * 1000;
const NORD_FYLKER = new Set(["18", "55", "56", "11"]); // Nordland, Troms, Finnmark + Rogaland
const MIN_LAT = 64.9;
const FREMOVER_MS = 21 * 864e5; // ta med planlagte meldinger som starter innen tre uker

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function envKey(dictName: string, legacy: string): string | undefined {
  try {
    const d = JSON.parse(Deno.env.get(dictName) ?? "null");
    if (d && typeof d === "object") return d.default ?? Object.values(d)[0] as string;
  } catch (_) { /* ignorer */ }
  return Deno.env.get(legacy) ?? undefined;
}

// ---------- UTM sone 33 (EPSG:25833) -> grader ----------
const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), K0 = 0.9996, EP2 = E2 / (1 - E2);
const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
const MU_D = A * (1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 * E2 * E2 / 256);
export function utm33(e: number, n: number): [number, number] {
  const x = e - 500000, mu = n / K0 / MU_D;
  const p1 = mu + (3 * E1 / 2 - 27 * E1 ** 3 / 32) * Math.sin(2 * mu) + (21 * E1 ** 2 / 16 - 55 * E1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * E1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * E1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const C1 = EP2 * c * c, T1 = t * t, N1 = A / Math.sqrt(1 - E2 * s * s), R1 = A * (1 - E2) / Math.pow(1 - E2 * s * s, 1.5), D = x / (N1 * K0);
  const lat = p1 - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return [+(lat * 180 / Math.PI).toFixed(5), +(15 + lon * 180 / Math.PI).toFixed(5)];
}
// Douglas–Peucker i meter (UTM)
function forenkle(p: number[][], tol: number): number[][] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st: [number, number][] = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!; let md = 0, mi = -1;
    const [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    for (let i = a + 1; i < b; i++) {
      const tt = Math.max(0, Math.min(1, ((p[i][0] - ax) * dx + (p[i][1] - ay) * dy) / l2));
      const ex = ax + tt * dx - p[i][0], ey = ay + tt * dy - p[i][1], d = ex * ex + ey * ey;
      if (d > md) { md = d; mi = i }
    }
    if (mi > 0 && md > tol * tol) { keep[mi] = 1; st.push([a, mi], [mi, b]) }
  }
  return p.filter((_, i) => keep[i]);
}

// ---------- tolking ----------
const ent = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
const first = (s: string, re: RegExp) => { const m = s.match(re); return m ? ent(m[1]) : null };
const all = (s: string, re: RegExp) => [...s.matchAll(re)].map(m => ent(m[1]));

// rangering: lavere tall = viktigere
const KAT = { stengt: 1, kolonne: 2, periodevis: 3, ras: 4, ulykke: 5, fore: 6, ferje: 7, begrensning: 8, vegarbeid: 9, annet: 10 } as const;
type Kat = keyof typeof KAT;
function klassifiser(type: string, enums: string[], tekst: string, kunTunge = false): Kat {
  const t = tekst.toLowerCase(), e = new Set(enums);
  if (/kolonne/.test(t) || e.has("convoyService") || e.has("convoyServiceInOperation")) return "kolonne";
  const stengtNoe = e.has("roadClosed") || e.has("carriagewayClosures") || /stengt|stenges/.test(t);
  if (!e.has("roadClosed") && /\b(ett|et|ett av to|ene|ene av)? ?(kjøre)?felt (er )?stengt|stengt (kjøre)?felt|feltstenging/.test(t)) return "vegarbeid";
  if (stengtNoe && /(inntil|opp til|i inntil) \d+ ?(min|minutter)|korte perioder|stengt i perioder?\b|periodevis/.test(t)) return "periodevis";
  if (stengtNoe && (kunTunge || /gjelder for (totalvekt|kjøretøy|vogntog)|totalvekt (større|over)|personbiler[^.]*kan passere|kjøretøy[^.]*opp ?til[^.]*tonn[^.]*kan passere/.test(t))) return "begrensning";
  if (e.has("intermittentShortTermClosures") || e.has("trafficHeld") || /korte perioder|stengt i perioder|periodevis stengt|kortvarig(e)? stenging/.test(t)) return "periodevis";
  if (e.has("roadClosed") || e.has("closedPermanentlyForTheWinter") || e.has("carriagewayClosures") || /\b(vinterstengt|vegen er stengt|veien er stengt|stengt for all trafikk)\b/.test(t)) return "stengt";
  if (e.has("intermittentShortTermClosures") || e.has("trafficHeld") || /periodevis stengt|kortvarig stenging|stengt i perioder/.test(t)) return "periodevis";
  if (type === "EnvironmentalObstruction" || /\b(ras|skred|steinsprang|jordras|snøskred|flom)\b/.test(t)) return "ras";
  if (type === "Accident" || type === "VehicleObstruction" || type === "GeneralObstruction" || type === "InfrastructureDamageObstruction" || type === "AnimalPresenceObstruction" || type === "RoadsideAssistance") return "ulykke";
  if (type === "WeatherRelatedRoadConditions" || type === "NonWeatherRelatedRoadConditions" || type === "PoorEnvironmentConditions" || type === "WinterDrivingManagement") return "fore";
  if (type === "TransitInformation" || e.has("ferry")) return "ferje";
  if (e.has("weightRestrictionInOperation") || e.has("heightRestrictionInOperation")) return "begrensning";
  if (type === "MaintenanceWorks" || type === "ConstructionWorks" || type === "GeneralNetworkManagement" || type === "SpeedManagement" || type === "ReroutingManagement" || type === "RoadOrCarriagewayOrLaneManagement") return "vegarbeid";
  return "annet";
}
function vegnr(r: string | null): string {
  if (!r) return "";
  const m = r.match(/^([ERFK])(\d+)$/); if (!m) return r;
  return m[1] === "E" ? "E" + m[2] : ({ R: "Rv. ", F: "Fv. ", K: "Kv. " } as Record<string, string>)[m[1]] + m[2];
}

// Tidsrom: [fra ISO, til ISO, "HH:MM" start, "HH:MM" slutt, ukedager 0=søn..6=lør (tom = alle)]
export type Periode = [string | null, string | null, string | null, string | null, number[]];
export type Melding = { id: string; kat: Kat; veg: string; vegnavn: string; sted: string; tekst: string; start: string | null; slutt: string | null;
  endret: string | null; lat: number; lon: number; geom: [number, number][][]; km: number | null; fylke: string; perioder: Periode[] | null };
const DAG: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
function perioder(rec: string): Periode[] {
  return [...rec.matchAll(/<validPeriod>([\s\S]*?)<\/validPeriod>/g)].map(m => {
    const v = m[1];
    const hm = (re: RegExp) => { const x = first(v, re); return x ? x.slice(0, 5) : null };
    return [first(v, /<startOfPeriod>([^<]+)</), first(v, /<endOfPeriod>([^<]+)</), hm(/<startTimeOfPeriod>([^<]+)</), hm(/<endTimeOfPeriod>([^<]+)</),
      all(v, /<applicableDay>(\w+)<\/applicableDay>/g).map(d => DAG[d]).filter(d => d != null)] as Periode;
  });
}

export function tolk(xml: string, nowMs = Date.now()): Melding[] {
  const out: Melding[] = [];
  const parts = xml.split(/<ns12:situation (?=id=)/);
  for (let i = 1; i < parts.length; i++) {
    const sit = parts[i];
    const fylke = first(sit, /<ns9:subdivisionCode>(\d+)<\/ns9:subdivisionCode>/) ?? "";
    const dlat = +(first(sit, /<ns9:latitude>([\d.-]+)<\/ns9:latitude>/) ?? 0);
    if (!NORD_FYLKER.has(fylke) && !(dlat >= MIN_LAT)) continue;
    const id = first(sit, /^id="([^"]+)"/) ?? "s" + i;
    const recs = sit.split(/<ns12:situationRecord /).slice(1);
    const kandidater: { k: Kat; p: Periode[] }[] = [];
    let best: Kat = "annet", start: number | null = null, slutt: number | null = null, endret = "", aktive = 0;
    const tekster: string[] = [], geom: [number, number][][] = [];
    let lat = 0, lon = 0, sted = "", veg = "", vegnavn = "", km: number | null = null;
    for (const r of recs) {
      const s0 = first(r, /<overallStartTime>([^<]+)</), s1 = first(r, /<overallEndTime>([^<]+)</);
      const ts0 = s0 ? Date.parse(s0) : null, ts1 = s1 ? Date.parse(s1) : null;
      if (ts1 != null && ts1 < nowMs) continue;                 // utløpt
      if (ts0 != null && ts0 > nowMs + FREMOVER_MS) continue;  // for langt fram
      aktive++;
      const type = first(r, /xsi:type="ns12:(\w+)"/) ?? "";
      const enums = all(r, /<ns12:\w+Type>(\w+)<\/ns12:\w+Type>/g);
      const kom = all(r, /<ns12:comment><values><value[^>]*>([^<]*)<\/value>/g).flatMap(x => x.split("|")).map(x => x.trim()).filter(Boolean);
      kom.forEach(k => { if (!tekster.includes(k)) tekster.push(k) });
      const k = klassifiser(type, enums, kom.join(" "), /grossWeightCharacteristic|heightCharacteristic|lengthCharacteristic|widthCharacteristic|<(?:\w+:)?vehicleType>(lorry|heavyLorry|articulatedVehicle|trailer)</.test(r));
      kandidater.push({ k, p: perioder(r) });
      if (KAT[k] < KAT[best]) best = k;
      if (ts0 != null) start = start == null ? ts0 : Math.min(start, ts0);
      if (ts1 != null) slutt = slutt == null ? ts1 : Math.max(slutt, ts1);
      const vt = first(r, /<ns12:situationRecordVersionTime>([^<]+)</); if (vt && vt > endret) endret = vt;
      if (!sted) sted = first(r, /<ns9:locationDescription><values><value[^>]*>([^<]*)</) ?? "";
      if (!veg) veg = vegnr(first(r, /<ns9:roadNumber>([^<]+)</));
      if (!vegnavn) vegnavn = first(r, /<ns9:roadName>([^<]+)</) ?? "";
      if (!lat) { const a = first(r, /<ns9:coordinatesForDisplay><ns9:latitude>([\d.-]+)</), b = first(r, /<ns9:coordinatesForDisplay><ns9:latitude>[\d.-]+<\/ns9:latitude><ns9:longitude>([\d.-]+)</); if (a && b) { lat = +a; lon = +b } }
      if (km == null) { const l = first(r, /<ns9:lengthAffected>([\d.]+)</); if (l) km = Math.round(+l / 100) / 10 }
      if (!geom.length) {
        for (const m of r.matchAll(/<ns9:gmlLineString srsName="(\d+)"><ns9:posList>([^<]+)<\/ns9:posList>/g)) {
          const v = m[2].trim().split(/\s+/).map(Number), pts: number[][] = [];
          for (let j = 0; j + 1 < v.length; j += 2) pts.push([v[j], v[j + 1]]);
          if (m[1] === "25833") geom.push(forenkle(pts, 25).slice(0, 400).map(([e, n]) => utm33(e, n)));
          else if (m[1] === "4326") geom.push(forenkle(pts, .0003).slice(0, 400).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)] as [number, number]));
        }
        if (!geom.length) {
          const pts = [...r.matchAll(/<ns9:pointCoordinates><ns9:latitude>([\d.-]+)<\/ns9:latitude><ns9:longitude>([\d.-]+)</g)].map(m => [+(+m[1]).toFixed(5), +(+m[2]).toFixed(5)] as [number, number]);
          if (pts.length) geom.push(pts);
        }
      }
    }
    if (!aktive || (!lat && !geom.length)) continue;
    if (!lat && geom.length) { [lat, lon] = geom[0][Math.floor(geom[0].length / 2)] }
    if (!(lat >= MIN_LAT) && !NORD_FYLKER.has(fylke)) continue;
    out.push({ id, kat: best, veg, vegnavn, sted, tekst: tekster.slice(0, 6).join(" "), start: start != null ? new Date(start).toISOString() : null,
      slutt: slutt != null ? new Date(slutt).toISOString() : null, endret: endret || null, lat, lon, geom, km, fylke,
      perioder: (() => { const b = kandidater.filter(x => x.k === best); return b.some(x => !x.p.length) ? null : b.flatMap(x => x.p).slice(0, 20) })() });
  }
  out.sort((a, b) => KAT[a.kat] - KAT[b.kat] || (b.endret ?? "").localeCompare(a.endret ?? ""));
  return out;
}

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const pub = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const sec = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!pub || !sec) return json({ error: "Mangler Supabase-nøkler i funksjonsmiljøet" }, 500);

    // Innlogget og på tilgangslista (RLS + tofaktor gjør jobben)
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Ikke innlogget" }, 401);
    const userDb = createClient(url, pub, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: me, error: meErr } = await userDb.from("tilgang").select("rolle").maybeSingle();
    if (meErr || !me) return json({ error: "Ingen tilgang" }, 403);

    const admin = createClient(url, sec, { auth: { persistSession: false } });
    const { data: cache } = await admin.from("vegmelding_cache").select("hentet,sist_endret,data").eq("id", 1).maybeSingle();
    const alder = cache ? Date.now() - new Date(cache.hentet).getTime() : Infinity;
    const svar = (data: Melding[], hentet: string, kilde: string) => json({ hentet, kilde, meldinger: data.filter(m => !m.slutt || Date.parse(m.slutt) > Date.now()) });
    if (cache && alder < MAX_AGE_MS) return svar(cache.data, cache.hentet, "buffer");

    const user = Deno.env.get("DATEX_USER"), pass = Deno.env.get("DATEX_PASS");
    if (!user || !pass) return json({ error: "DATEX_USER/DATEX_PASS er ikke satt som secrets" }, 500);
    const headers: Record<string, string> = { Authorization: "Basic " + btoa(`${user}:${pass}`), "Accept-Encoding": "gzip" };
    if (cache?.sist_endret && cache.data?.length) headers["If-Modified-Since"] = cache.sist_endret;
    let r: Response;
    try { r = await fetch(URL_SIT, { headers, signal: AbortSignal.timeout(60000) }) }
    catch (e) { if (cache) return svar(cache.data, cache.hentet, "buffer (Vegvesenet svarte ikke)"); throw e }
    const nå = new Date().toISOString();
    if (r.status === 304 && cache) {
      await admin.from("vegmelding_cache").update({ hentet: nå }).eq("id", 1);
      return svar(cache.data, nå, "uendret");
    }
    if (!r.ok) {
      if (cache) return svar(cache.data, cache.hentet, `buffer (Vegvesenet svarte ${r.status})`);
      return json({ error: `Vegvesenet svarte ${r.status}` }, 502);
    }
    const data = tolk(await r.text());
    await admin.from("vegmelding_cache").upsert({ id: 1, hentet: nå, sist_endret: r.headers.get("last-modified"), antall: data.length, data });
    return svar(data, nå, "vegvesen");
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
