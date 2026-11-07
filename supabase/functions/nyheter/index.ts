// nyheter: søker i Google Nyheter (RSS) etter omtale av en kunde de siste 183 dagene.
// Bare for innloggede brukere i public.tilgang. Svar bufres i public.nyhet_cache i 24 timer.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const MAX_AGE_MS = 24 * 3600 * 1000;
const DAYS = 183;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function envKey(dictName: string, legacy: string): string | undefined {
  try {
    const d = JSON.parse(Deno.env.get(dictName) ?? "null");
    if (d && typeof d === "object") return d.default ?? Object.values(d)[0] as string;
  } catch (_) { /* ignorer */ }
  return Deno.env.get(legacy) ?? undefined;
}

// Fjern selskapsform, avdelingsnavn og kundenummer-støy, så søket treffer det folk skriver i avisa.
export function cleanName(n: string): string {
  return n.replace(/^\s*(kontant|inaktiv)\s*[-–:]?\s*/i, "")
    .replace(/-\s*firma slettet.*/i, "")
    .replace(/\b(avd(eling)?\.?)\s+.*$/i, "")
    .replace(/\b(SRV|ENT|VEN|KUL)\b.*$/i, "")
    .replace(/\d{4,}/g, "")
    .replace(/\b(AS|ASA|ANS|DA|ENK|BA|SA|A\/S)\b\.?/gi, "")
    .replace(/[,()]+/g, " ").replace(/\s+/g, " ").trim();
}

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").trim();
const tag = (x: string, t: string) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : "" };

export function parseRss(xml: string, since: number) {
  const items: { tittel: string; kilde: string; lenke: string; dato: string }[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    const kilde = tag(x, "source");
    let tittel = tag(x, "title");
    if (kilde && tittel.endsWith(" - " + kilde)) tittel = tittel.slice(0, -(kilde.length + 3));
    const t = Date.parse(tag(x, "pubDate"));
    if (!tittel || isNaN(t) || t < since) continue;
    items.push({ tittel, kilde, lenke: tag(x, "link"), dato: new Date(t).toISOString() });
  }
  items.sort((a, b) => b.dato.localeCompare(a.dato));
  return items;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const pub = envKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const sec = envKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    if (!pub || !sec) return json({ error: "Mangler Supabase-nøkler i funksjonsmiljøet" }, 500);
    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Ikke innlogget" }, 401);
    const userDb = createClient(url, pub, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: me, error: meErr } = await userDb.from("tilgang").select("rolle").maybeSingle();
    if (meErr || !me) return json({ error: "Ingen tilgang" }, 403);

    const p = new URL(req.url).searchParams;
    const kundenr = (p.get("k") ?? "").slice(0, 20);
    const navn = cleanName(p.get("navn") ?? "").slice(0, 120);
    if (!kundenr || navn.length < 3) return json({ error: "Mangler kundenummer eller navn" }, 400);

    const admin = createClient(url, sec, { auth: { persistSession: false } });
    const { data: cache } = await admin.from("nyhet_cache").select("hentet,sok,data").eq("kundenr", kundenr).maybeSingle();
    if (cache && cache.sok === navn && Date.now() - new Date(cache.hentet).getTime() < MAX_AGE_MS)
      return json({ sok: navn, hentet: cache.hentet, kilde: "buffer", saker: cache.data });

    const q = `"${navn}" when:${DAYS}d`;
    const base = Deno.env.get("NEWS_BASE") ?? "https://news.google.com";
    const r = await fetch(`${base}/rss/search?q=${encodeURIComponent(q)}&hl=no&gl=NO&ceid=NO:no`, { headers: { "User-Agent": "Mozilla/5.0 (Kundekart Nord)" } });
    if (!r.ok) {
      if (cache) return json({ sok: navn, hentet: cache.hentet, kilde: "buffer", advarsel: `Nyhetssøket svarte ${r.status}`, saker: cache.data });
      return json({ error: `Nyhetssøket svarte ${r.status}` }, 502);
    }
    const saker = parseRss(await r.text(), Date.now() - DAYS * 864e5).slice(0, 8);
    const hentet = new Date().toISOString();
    await admin.from("nyhet_cache").upsert({ kundenr, sok: navn, hentet, data: saker });
    return json({ sok: navn, hentet, kilde: "google", saker });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
