// nettside: leser kundens egen nettside (adressen hentes fra Enhetsregisteret, ikke fra klienten) og returnerer
//  - lenker til offentlige profiler i sosiale medier som nettsiden selv lenker til (Facebook, Instagram, LinkedIn, YouTube, TikTok, X)
//  - siste innlegg fra nettsidens nyhetsstrøm (RSS/Atom, f.eks. WordPress /feed) de siste 61 dagene.
// Innhold fra sosiale medier hentes ikke: plattformene tillater ikke automatisk lesing.
// Bare for innloggede brukere i public.tilgang. GET ?orgnr=123456789
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const DAGER = 61, MAKS_BYTES = 1_500_000, UA = "Mozilla/5.0 (compatible; Kundekart Nord; Lindab)";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function envKey(dictName: string, legacy: string): string | undefined {
  try {
    const d = JSON.parse(Deno.env.get(dictName) ?? "null");
    if (d && typeof d === "object") return d.default ?? Object.values(d)[0] as string;
  } catch (_) { /* ignorer */ }
  return Deno.env.get(legacy) ?? undefined;
}

// Bare vanlige nettadresser på port 80/443 med vertsnavn (ingen IP-adresser eller interne navn)
function trygg(u: URL): boolean {
  if (!/^https?:$/.test(u.protocol)) return false;
  if (u.port && !["80", "443"].includes(u.port)) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || /(^|\.)(localhost|local|internal|supabase\.co|supabase\.in)$/.test(h)) return false;
  return true;
}
async function hentTekst(url: string, ms = 8000): Promise<{ url: string; tekst: string; type: string } | null> {
  let u: URL; try { u = new URL(url) } catch { return null }
  for (let hopp = 0; hopp < 4; hopp++) {
    if (!trygg(u)) return null;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(u, { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5" } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = new URL(r.headers.get("location")!, u); await r.body?.cancel(); continue }
      if (!r.ok || !r.body) return null;
      const reader = r.body.getReader(); const deler: Uint8Array[] = []; let n = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; n += value.length; deler.push(value); if (n > MAKS_BYTES) { await reader.cancel(); break } }
      const buf = new Uint8Array(n); let o = 0; for (const d of deler) { buf.set(d.subarray(0, Math.min(d.length, n - o)), o); o += d.length; if (o >= n) break }
      const type = r.headers.get("content-type") ?? "";
      const cs = (type.match(/charset=([\w-]+)/i) || [])[1] || "utf-8";
      let tekst: string; try { tekst = new TextDecoder(cs).decode(buf) } catch { tekst = new TextDecoder().decode(buf) }
      return { url: u.toString(), tekst, type };
    } catch { return null } finally { clearTimeout(t) }
  }
  return null;
}

const SOME: [string, RegExp][] = [
  ["Facebook", /^https?:\/\/(www\.|m\.|nb-no\.)?facebook\.com\/(?!sharer|share|dialog|plugins|tr\b|groups\/?$)[^\s"'<>?#]+/i],
  ["Instagram", /^https?:\/\/(www\.)?instagram\.com\/(?!p\/|explore)[^\s"'<>?#\/]+/i],
  ["LinkedIn", /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/(company|school|showcase)\/[^\s"'<>?#\/]+/i],
  ["YouTube", /^https?:\/\/(www\.)?youtube\.com\/(@|c\/|channel\/|user\/)[^\s"'<>?#\/]+/i],
  ["TikTok", /^https?:\/\/(www\.)?tiktok\.com\/@[^\s"'<>?#\/]+/i],
  ["X", /^https?:\/\/(www\.)?(twitter|x)\.com\/(?!share|intent|home)[^\s"'<>?#\/]+/i],
];
function somelenker(html: string) {
  const ut: Record<string, string> = {};
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1].replace(/&amp;/g, "&").trim();
    for (const [navn, re] of SOME) { if (ut[navn]) continue; const x = href.match(re); if (x) ut[navn] = x[0].replace(/\/+$/, "") }
  }
  return Object.entries(ut).map(([navn, url]) => ({ navn, url }));
}
const dekod = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#8217;/g, "'").replace(/&#8211;/g, "–").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
const felt = (x: string, t: string) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? dekod(m[1]) : "" };
function lesStrom(xml: string, base: string) {
  const grense = Date.now() - DAGER * 864e5, ut: { tittel: string; lenke: string; dato: string; utdrag: string }[] = [];
  const poster = [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi), ...xml.matchAll(/<entry[\s>]([\s\S]*?)<\/entry>/gi)];
  for (const m of poster) {
    const x = m[1];
    const tittel = felt(x, "title");
    let lenke = felt(x, "link"); if (!lenke) { const l = x.match(/<link[^>]*href=["']([^"']+)["']/i); lenke = l ? l[1] : "" }
    const t = Date.parse(felt(x, "pubDate") || felt(x, "published") || felt(x, "updated") || felt(x, "dc:date"));
    if (!tittel || isNaN(t) || t < grense) continue;
    let ok = ""; try { const u = new URL(lenke, base); if (/^https?:$/.test(u.protocol)) ok = u.toString() } catch { /* */ }
    const utdrag = (felt(x, "description") || felt(x, "summary")).slice(0, 180);
    ut.push({ tittel: tittel.slice(0, 200), lenke: ok, dato: new Date(t).toISOString(), utdrag });
  }
  return ut.sort((a, b) => b.dato.localeCompare(a.dato)).slice(0, 5);
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

    const orgnr = (new URL(req.url).searchParams.get("orgnr") ?? "").replace(/\D/g, "");
    if (orgnr.length !== 9) return json({ error: "Mangler organisasjonsnummer" }, 400);

    // Nettadressen fra Enhetsregisteret: avdelingen først, så selskapet
    const br = async (sti: string) => { const r = await fetch("https://data.brreg.no/enhetsregisteret/api/" + sti, { headers: { Accept: "application/json" } }); return r.ok ? r.json() : null };
    const u = await br("underenheter/" + orgnr).catch(() => null);
    const e = await br("enheter/" + (u?.overordnetEnhet ?? orgnr)).catch(() => null);
    let hjem = (u?.hjemmeside || e?.hjemmeside || "").trim();
    if (!hjem) return json({ nettside: null, some: [], innlegg: [] });
    if (!/^https?:\/\//i.test(hjem)) hjem = "https://" + hjem;

    let side = await hentTekst(hjem);
    if (!side && hjem.startsWith("https://")) side = await hentTekst(hjem.replace(/^https:/, "http:"));
    if (!side) return json({ nettside: hjem, feil: "Fikk ikke kontakt med nettsiden", some: [], innlegg: [] });

    const some = somelenker(side.tekst);
    // Nyhetsstrøm: lenket fra siden, ellers WordPress-standarden /feed
    const kandidater: string[] = [];
    for (const m of side.tekst.matchAll(/<link[^>]+type=["']application\/(rss|atom)\+xml["'][^>]*>/gi)) {
      const h = m[0].match(/href=["']([^"']+)["']/i); if (h) try { kandidater.push(new URL(h[1].replace(/&amp;/g, "&"), side.url).toString()) } catch { /* */ }
    }
    kandidater.push(new URL("/feed/", side.url).toString());
    let innlegg: ReturnType<typeof lesStrom> = [], strom = "";
    for (const k of [...new Set(kandidater)].filter(k => !/comments/i.test(k)).slice(0, 3)) {
      const f = await hentTekst(k, 6000);
      if (f && /<(rss|feed)[\s>]/i.test(f.tekst)) { strom = k; innlegg = lesStrom(f.tekst, side.url); break }
    }
    return json({ nettside: side.url, some, strom: strom || null, innlegg });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
