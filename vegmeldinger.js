/* Vegmeldinger fra Statens vegvesen (DATEX via serverfunksjonen «vegmeldinger»):
   kartlag med stengte veger, kolonnekjøring, ras, ulykker m.m., og sjekk av planlagte etapper mot meldingene
   på tidspunktet man faktisk kjører der. Data: Statens vegvesen (NLOD). */
(function () {
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ON = "kk_veg_on", REFRESH = 5 * 60000;
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };

const KAT = {
  stengt:      { l: "Stengt veg",           ik: "⛔", f: "#c62828", rang: 1, varsle: true },
  kolonne:     { l: "Kolonnekjøring",       ik: "🚚", f: "#6a1b9a", rang: 2, varsle: true },
  periodevis:  { l: "Periodevis stengt",    ik: "⏸", f: "#e65100", rang: 3, varsle: true },
  ras:         { l: "Ras / skred",          ik: "⛰", f: "#795548", rang: 4, varsle: true },
  ulykke:      { l: "Ulykke / hindring",    ik: "⚠", f: "#d84315", rang: 5, varsle: true },
  fore:        { l: "Vanskelig føre",       ik: "❄", f: "#1565c0", rang: 6, varsle: true },
  ferje:       { l: "Ferje",                ik: "⛴", f: "#00838f", rang: 7, varsle: true },
  begrensning: { l: "Begrensning",          ik: "⚖", f: "#546e7a", rang: 8, varsle: false },
  vegarbeid:   { l: "Vegarbeid",            ik: "🚧", f: "#8d6e63", rang: 9, varsle: false },
  annet:       { l: "Trafikkmelding",       ik: "ℹ", f: "#607d8b", rang: 10, varsle: false }
};
let data = null, hentet = null, feil = null, layer = null, btn = null, timer = null, laster = null;

/* ---------- henting ---------- */
async function load(force) {
  if (laster) return laster;
  if (!force && data && Date.now() - (hentet || 0) < REFRESH) return data;
  laster = (async () => {
    try {
      const sb = window.KK && window.KK.sb; if (!sb) throw new Error("ikke klar");
      const { data: d, error } = await sb.functions.invoke("vegmeldinger", { method: "GET" });
      if (error) throw error;
      if (!d || !Array.isArray(d.meldinger)) throw new Error((d && d.error) || "ukjent svar");
      data = d.meldinger; hentet = Date.now(); feil = null;
      document.dispatchEvent(new CustomEvent("kk:veg"));
    } catch (e) { feil = e.message || String(e) }
    finally { laster = null; sync(); draw() }
    return data;
  })();
  return laster;
}

/* ---------- tid ---------- */
const lokal = (dato, min) => { const d = new Date(dato + "T00:00:00"); d.setMinutes(Math.round(min)); return d };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hmStr = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m };
function aktivVed(m, T) {
  const t = T.getTime();
  if (m.start && t < Date.parse(m.start)) return false;
  if (m.slutt && t > Date.parse(m.slutt)) return false;
  if (!m.perioder || !m.perioder.length) return true;
  const dag = ymd(T), tod = T.getHours() * 60 + T.getMinutes(), wd = T.getDay();
  return m.perioder.some(([fra, til, s, e, dager]) => {
    if (fra && dag < fra.slice(0, 10)) return false;
    if (til && dag > til.slice(0, 10)) return false;
    if (dager && dager.length && !dager.includes(wd)) return false;
    if (!s || !e) return (!fra || t >= Date.parse(fra)) && (!til || t <= Date.parse(til));
    const a = hmStr(s), b = hmStr(e);
    return a <= b ? tod >= a && tod <= b : tod >= a || tod <= b;
  });
}
// Aktiv en eller annen gang mellom to klokkeslett (minutter fra midnatt) på en dato
function aktivMellom(m, dato, fraMin, tilMin) {
  const a = Math.max(0, fraMin ?? 0), b = Math.max(a, tilMin ?? a);
  for (let x = a; x <= b + 0.1; x += 10) if (aktivVed(m, lokal(dato, x))) return true;
  return aktivVed(m, lokal(dato, b));
}

/* ---------- geometri ---------- */
const R = 6371000, rad = Math.PI / 180;
function avstand(p, a, b) { // meter fra punkt p til linjestykket a-b (lat,lon), flatt nær p
  const kx = Math.cos(p[0] * rad) * rad * R, ky = rad * R;
  const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
  const x = ax + t * dx, y = ay + t * dy; return Math.sqrt(x * x + y * y);
}
function bbox(pts, pad) {
  let a = 90, b = 180, c = -90, d = -180;
  for (const [la, lo] of pts) { if (la < a) a = la; if (la > c) c = la; if (lo < b) b = lo; if (lo > d) d = lo }
  return [a - pad, b - pad * 2.5, c + pad, d + pad * 2.5];
}
const inni = (p, bb) => p[0] >= bb[0] && p[0] <= bb[2] && p[1] >= bb[1] && p[1] <= bb[3];
function naerRute(p, rute, bb, maks) {
  if (!inni(p, bb)) return false;
  for (let i = 0; i + 1 < rute.length; i++) {
    const a = rute[i], b = rute[i + 1];
    if (Math.abs(a[0] - p[0]) > 0.02 && Math.abs(b[0] - p[0]) > 0.02) continue;
    if (avstand(p, a, b) <= maks) return true;
  }
  return false;
}
// Ligger meldingen på ruta? Linjer: minst to punkter (eller halvparten) nær ruta. Punkter: innen 60 m.
function paaGeom(m, rute, bb) {
  const linjer = (m.geom || []).filter(g => g.length > 1), pkt = (m.geom || []).filter(g => g.length === 1).map(g => g[0]);
  for (const g of linjer) {
    let n = 0; const krav = Math.min(2, g.length);
    for (const p of g) if (naerRute(p, rute, bb, 45) && ++n >= krav) return true;
  }
  if (!linjer.length) { for (const p of (pkt.length ? pkt : [[m.lat, m.lon]])) if (naerRute(p, rute, bb, 60)) return true }
  return false;
}

/* ---------- offentlig: meldinger på en etappe ---------- */
function paaRute(rute, dato, fraMin, tilMin) {
  if (!data || !rute || rute.length < 2 || !dato) return [];
  const bb = bbox(rute, 0.01);
  return data.filter(m => {
    const mb = m.geom && m.geom.length ? m.geom.flat() : [[m.lat, m.lon]];
    if (!mb.some(p => inni(p, bb))) return false;
    return paaGeom(m, rute, bb) && aktivMellom(m, dato, fraMin, tilMin);
  }).sort((a, b) => KAT[a.kat].rang - KAT[b.kat].rang);
}
const tekst = m => `${(KAT[m.kat] || KAT.annet).l}: ${[m.veg, stedKort(m)].filter(Boolean).join(" ")}`;
const kort = m => `${(KAT[m.kat] || KAT.annet).ik} ${tekst(m)}`;
function stedKort(m) {
  let s = (m.sted || m.vegnavn || "").replace(/^(E\d+|[RFK]v\. ?\d+)\s*/, "");
  s = s.replace(/ i [^,–-]+, (Nordland|Troms|Finnmark)/g, "").replace(/\s*-\s*(E\d+|[rfk]v\. ?\d+)\s*/gi, " – ");
  return s.length > 70 ? s.slice(0, 68) + "…" : s;
}
const DAGER = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
function tidsrom(m) {
  const f = d => d ? new Date(d).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const p = (m.perioder || []).filter(x => x[2] && x[3]);
  const kl = [...new Set(p.map(x => `${x[2]}–${x[3] === "23:59" ? "24:00" : x[3]}${x[4] && x[4].length && x[4].length < 7 ? " " + x[4].map(d => DAGER[d]).join(", ") : ""}`))].slice(0, 4);
  return { fra: f(m.start), til: m.slutt ? f(m.slutt) : "inntil videre", kl };
}
function html(m, kompakt) {
  const k = KAT[m.kat] || KAT.annet, t = tidsrom(m);
  return `<div class="vegmeld${kompakt ? " kompakt" : ""}" style="--vk:${k.f}">
    <div class="vmhead"><span class="vmik">${k.ik}</span><b>${esc(k.l)}</b>${m.veg ? ` · <b>${esc(m.veg)}</b>` : ""}</div>
    <div class="vmsted">${esc(m.sted || m.vegnavn || "")}</div>
    ${m.tekst ? `<div class="vmtekst">${esc(m.tekst)}</div>` : ""}
    <div class="vmtid mut">${t.kl.length ? "Gjelder " + esc(t.kl.join(" · ")) + " · " : ""}${esc(t.fra)} → ${esc(t.til)}</div>
  </div>`;
}

/* ---------- kart ---------- */
function ikon(m, smaa) {
  const k = KAT[m.kat] || KAT.annet;
  return L.divIcon({ className: "", html: `<div class="vegicon${smaa ? " sm" : ""}" style="--vk:${k.f}" aria-hidden="true">${k.ik}</div>`, iconSize: smaa ? [18, 18] : [24, 24], iconAnchor: smaa ? [9, 9] : [12, 12] });
}
function draw() {
  const map = window.KK && window.KK.map; if (!map || !data) return;
  if (!layer) { layer = L.layerGroup(); map.on("zoomend", draw) }
  layer.clearLayers();
  const z = map.getZoom(), naa = new Date();
  data.forEach(m => {
    const k = KAT[m.kat] || KAT.annet, lav = !k.varsle;
    if (lav && z < 9) return;                       // vegarbeid o.l. først når man zoomer inn
    const aktiv = aktivVed(m, naa);
    (m.geom || []).filter(g => g.length > 1).forEach(g => L.polyline(g, { color: k.f, weight: lav ? 3 : 5, opacity: aktiv ? .85 : .4, dashArray: aktiv ? null : "4 6", interactive: false }).addTo(layer));
    L.marker([m.lat, m.lon], { icon: ikon(m, lav), zIndexOffset: 400 - k.rang * 20, keyboard: false, opacity: aktiv ? 1 : .6 })
      .bindTooltip(esc(kort(m)) + (aktiv ? "" : " (ikke nå)"), { direction: "top" })
      .bindPopup(() => html(m) + `<div class="vmkilde mut">Kilde: Statens vegvesen · <a href="https://www.vegvesen.no/trafikk/" target="_blank" rel="noopener">vegvesen.no/trafikk ↗</a></div>`, { maxWidth: 320, minWidth: 240 })
      .addTo(layer);
  });
  if (store.get(ON, true)) layer.addTo(map); else layer.remove();
}
function sync() {
  if (!btn) return;
  const on = store.get(ON, true), n = data ? data.filter(m => (m.kat === "stengt" || m.kat === "kolonne") && aktivVed(m, new Date())).length : 0;
  btn.setAttribute("aria-pressed", String(on));
  btn.innerHTML = `<span aria-hidden="true">⛔</span>Vegmeldinger<span class="tstate">${feil && !data ? "Feil" : !data ? "Henter …" : on ? (n ? n + " stengt nå" : "Vises") : "Skjult"}</span>`;
  btn.title = feil ? "Kunne ikke hente vegmeldinger: " + feil : on ? "Skjul vegmeldingene fra Statens vegvesen" : "Vis stengte veger, kolonnekjøring, ras og vegarbeid fra Statens vegvesen";
}
function init() {
  const map = window.KK && window.KK.map, sb = window.KK && window.KK.sb;
  const tools = document.querySelector(".maptools");
  if (!map || !sb || !tools || !(window.KK.ME)) return setTimeout(init, 500);
  btn = document.createElement("button"); btn.className = "tool"; btn.id = "tVeg"; btn.dataset.order = 11;
  const after = [...tools.children].find(x => +(x.dataset.order || 0) > 11);
  after ? tools.insertBefore(btn, after) : tools.appendChild(btn);
  btn.onclick = () => { const on = !store.get(ON, true); store.set(ON, on); if (!on) map.closePopup(); sync(); draw(); if (on) load() };
  sync(); load();
  clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(true) }, REFRESH);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - (hentet || 0) > REFRESH) load(true) });
}
init();
window.KKVeg = { load, paaRute, aktivVed, kort, tekst, html, tidsrom, KAT, get data() { return data }, get hentet() { return hentet }, get feil() { return feil } };
})();
