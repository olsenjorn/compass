/* Planlegger: ruter dag for dag. Start (hjem/hotell/fly) = 1, kunder i klikkrekkefølge, hotell til slutt.
   Kjøretid fra OSRM (vei, inkl. ferger), med anslag som reserve. Lagres i public.ruteplaner. */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } }
};
const KK = () => window.KK;

const FLYPLASSER = [
  ["TOS", "Tromsø lufthavn", 69.6833, 18.9189], ["BOO", "Bodø lufthavn", 67.2692, 14.3653], ["EVE", "Harstad/Narvik lufthavn Evenes", 68.4913, 16.6781],
  ["BDU", "Bardufoss lufthavn", 69.0558, 18.5404], ["ANX", "Andøya lufthavn", 69.2925, 16.1442], ["SVJ", "Svolvær lufthavn", 68.2433, 14.6692],
  ["LKN", "Leknes lufthavn", 68.1525, 13.6094], ["SKN", "Stokmarknes lufthavn", 68.5788, 15.0334], ["SOJ", "Sørkjosen lufthavn", 69.7868, 20.9594],
  ["ALF", "Alta lufthavn", 69.9761, 23.3717], ["HFT", "Hammerfest lufthavn", 70.6797, 23.6686], ["LKL", "Lakselv lufthavn", 70.0688, 24.9735],
  ["KKN", "Kirkenes lufthavn", 69.7258, 29.8913], ["VDS", "Vadsø lufthavn", 70.0653, 29.8447], ["MQN", "Mo i Rana lufthavn", 66.3639, 14.3014],
  ["MJF", "Mosjøen lufthavn", 65.784, 13.2149], ["SSJ", "Sandnessjøen lufthavn", 65.9568, 12.4689], ["BNN", "Brønnøysund lufthavn", 65.4611, 12.2175],
  ["LYR", "Svalbard lufthavn", 78.2461, 15.4656]
];
const DEFAULT_HOME = "Eidhaugsvingen 6, 9105 Kvaløya";
const PAUSE_ETTER = 240, PAUSE_MIN = 30;           // 30 min pause per påbegynte 4 timer sammenhengende kjøring (4 t, 8 t …)
const FLY_BUFFER = { leiebil: 20, taxi: 10 };

/* ---------- tid ---------- */
const ceil15 = v => Math.ceil(Math.round(v) / 15) * 15; // runder opp til nærmeste kvarter
const toMin = s => { const m = String(s || "").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null };
const hm = v => { if (v == null) return "–"; v = Math.round(v); const d = Math.floor(v / 1440), r = ((v % 1440) + 1440) % 1440; return `${String(Math.floor(r / 60)).padStart(2, "0")}:${String(r % 60).padStart(2, "0")}${d > 0 ? ` (+${d})` : ""}` };
const dur = v => { v = Math.round(v); const h = Math.floor(v / 60), m = v % 60; return h ? `${h} t${m ? ` ${m} min` : ""}` : `${m} min` };
const km = v => `${Math.round(v)} km`;
const dato = s => { try { return new Date(s + "T12:00").toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" }) } catch (e) { return s } };
const addDays = (s, n) => { const d = new Date(s + "T12:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) };

/* ---------- kjøretid ---------- */
const RC = new Map(); let lastOsrm = 0;
function hav(a, b) { const R = 6371, t = x => x * Math.PI / 180, dl = t(b[0] - a[0]), dn = t(b[1] - a[1]); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a[0])) * Math.cos(t(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
async function leg(a, b) {
  const key = `${a[0].toFixed(4)},${a[1].toFixed(4)}>${b[0].toFixed(4)},${b[1].toFixed(4)}`;
  if (RC.has(key)) return RC.get(key);
  const p = (async () => {
    if (hav(a, b) < 0.05) return { min: 0, km: 0, geom: [a, b], est: false };
    try {
      const wait = Math.max(0, lastOsrm + 350 - Date.now()); lastOsrm = Date.now() + wait;
      if (wait) await new Promise(r => setTimeout(r, wait));
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=simplified&geometries=geojson&steps=true`);
      const j = await r.json();
      const rt = j && j.routes && j.routes[0];
      if (!rt) throw new Error("ingen rute");
      const ferger = [];
      (rt.legs || []).forEach(lg => { let off = 0; const sts = lg.steps || []; sts.forEach((st, i) => {
        if (st.mode === "ferry") { const nx = sts[i + 1]; ferger.push({ navn: st.name || "Ferge", min: Math.round(st.duration / 60), km: Math.round(st.distance / 1000), off: off / 60,
          fra: st.maneuver ? [st.maneuver.location[1], st.maneuver.location[0]] : null, til: nx && nx.maneuver ? [nx.maneuver.location[1], nx.maneuver.location[0]] : null }) }
        off += st.duration;
      }) });
      return { min: rt.duration / 60, km: rt.distance / 1000, geom: rt.geometry.coordinates.map(c => [c[1], c[0]]), est: false, ferger };
    } catch (e) {
      const d = hav(a, b) * 1.35;
      return { min: d / 65 * 60, km: d, geom: [a, b], est: true };
    }
  })();
  RC.set(key, p);
  const v = await p; if (v.est) RC.delete(key); // prøv igjen neste gang
  return v;
}


/* ---------- fergeavganger (Entur) ---------- */
const FERRY_CHECKIN = 10; // være på kaia 10 min før avgang
const ENTUR = "https://api.entur.io/journey-planner/v3/graphql";
const EC = new Map();
async function entur(query, variables) {
  const r = await fetch(ENTUR, { method: "POST", headers: { "Content-Type": "application/json", "ET-Client-Name": "lindab-kundekartnord" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json(); if (j.errors) throw new Error(j.errors[0].message); return j.data;
}
async function quayNear(pt) {
  const key = "q" + pt[0].toFixed(3) + "," + pt[1].toFixed(3);
  if (!EC.has(key)) EC.set(key, entur(`query($lat:Float!,$lon:Float!){ nearest(latitude:$lat, longitude:$lon, maximumDistance:4000, filterByModes:[water], filterByPlaceTypes:[stopPlace], first:1){ edges{ node{ place{ ... on StopPlace { id name } } } } } }`, { lat: pt[0], lon: pt[1] })
    .then(d => { const e = d.nearest.edges[0]; return e ? e.node.place : null }).catch(() => { EC.delete(key); return null }));
  return EC.get(key);
}
// Treff på destinasjon: helst skiltet destinasjon, ellers linjenavnets siste ledd
const goesTo = (c, w) => !w || (c.destinationDisplay && c.destinationDisplay.frontText ? c.destinationDisplay.frontText.toLowerCase().includes(w) : String(c.serviceJourney.line.name).toLowerCase().split(/\s*-\s*/).pop().includes(w));
const kaiNavn = n => String(n || "").replace(/\s*(ferjekai|fergekai|ferjeleie|kai)\b/ig, "").trim();
const word = n => String(n || "").toLowerCase().replace(/\b(ferjekai|fergekai|ferjeleie|kai)\b/g, "").trim().split(/[\s,-]+/)[0];
async function ferryDeparture(f, dateStr, fromMin) {
  if (!f.fra || !dateStr) return null;
  const [from, to] = await Promise.all([quayNear(f.fra), f.til ? quayNear(f.til) : null]);
  if (!from) return null;
  const base = new Date(dateStr + "T00:00:00"), start = new Date(base.getTime() + Math.round(fromMin) * 60000);
  const qStart = new Date(Math.floor(start.getTime() / 600000) * 600000); // spør per 10 minutter
  const key = `d${from.id}|${qStart.toISOString()}`;
  if (!EC.has(key)) EC.set(key, entur(`query($id:String!,$t:DateTime!){ stopPlace(id:$id){ estimatedCalls(startTime:$t, timeRange:86400, numberOfDepartures:20, whiteListedModes:[water]){ expectedDepartureTime destinationDisplay{frontText} serviceJourney{ line{ name } } } } }`, { id: from.id, t: qStart.toISOString() })
    .then(d => d.stopPlace ? d.stopPlace.estimatedCalls : []).catch(() => { EC.delete(key); return [] }));
  const calls = await EC.get(key);
  const w = to ? word(to.name) : "";
  const hit = calls.find(c => new Date(c.expectedDepartureTime) >= start && goesTo(c, w));
  if (!hit) return null;
  return { min: (new Date(hit.expectedDepartureTime) - base) / 60000, linje: hit.serviceJourney.line.name, fraKai: from, tilKai: to };
}

/* ---------- tilstand ---------- */
let open = false, plan = null, plans = [], active = 0, hotelMode = false, readonly = false, saveT = null, computed = [], planLayer = null, hotelLayer = null, delArm = false;
const me = () => (KK().ME || {});
function newPlan() {
  const home = store.get("kk_home", { adresse: DEFAULT_HOME });
  const d0 = new Date(); d0.setDate(d0.getDate() + 1);
  return { id: null, tittel: "Ny rute", laget_av: (me().epost || ""), data: { besokMin: 60, pause: true, fergeVent: 30, dager: [newDay(d0.toISOString().slice(0, 10), { type: "hjem", navn: home.adresse, lat: home.lat, lon: home.lon, kl: "06:00" })] } };
}
function newDay(d, start) { return { dato: d, start, stopp: [], slutt: null } }
const kunde = k => KK().DATA.find(c => c.k === k);

/* ---------- beregning ---------- */
async function ensureHome(day) {
  if (day.start.type === "hjem" && (day.start.lat == null)) {
    const g = await window.KKAdr.geocodeFree(day.start.navn || DEFAULT_HOME).catch(() => null);
    if (g) { day.start.lat = g.lat; day.start.lon = g.lon; day.start.navn = `${g.adresse}, ${g.postnr} ${g.poststed}`; store.set("kk_home", { adresse: day.start.navn, lat: g.lat, lon: g.lon }) }
  }
}
const SYM = { hjem: "⌂", hotell: "H", fly: "✈" };
async function computeDay(day, di = 0) {
  await ensureHome(day);
  const D = plan.data, out = { items: [], driveMin: 0, km: 0, visits: 0, est: false, end: null, warn: [], ferger: [] };
  let t = toMin(day.start.kl) ?? 480;
  if (day.start.type === "fly") t += FLY_BUFFER[day.start.transport || "leiebil"] || 15;
  const s = day.start;
  out.items.push({ kind: "start", n: SYM[s.type] || "S", pt: s.lat != null ? [s.lat, s.lon] : null, t });
  let prev = out.items[0].pt, n = 0;
  const legTo = async (pt) => {
    if (!prev || !pt) return null;
    const L = await leg(prev, pt);
    const pauses = D.pause ? Math.floor(L.min / PAUSE_ETTER) : 0;
    // Ferger: finn neste avgang i Entur ut fra når vi er på kaia; ellers fast ventetid
    let extra = 0;
    const ferger = [];
    for (const f0 of (L.ferger || [])) {
      const f = { ...f0 };
      const atQuay = t + f.off + extra;
      const dep = await ferryDeparture(f, day.dato, atQuay + FERRY_CHECKIN).catch(() => null);
      if (dep) { f.avgang = dep.min; f.linje = dep.linje; f.vent = Math.max(0, dep.min - atQuay); f.fraKai = dep.fraKai; f.tilKai = dep.tilKai; }
      else { f.vent = +D.fergeVent || 0; f.ukjent = true; }
      extra += f.vent; ferger.push(f);
    }
    const fw = extra;
    const total = L.min + pauses * PAUSE_MIN + fw;
    if (ferger.length) out.ferger.push(...ferger);
    out.driveMin += L.min; out.km += L.km; if (L.est) out.est = true;
    return { ...L, ferger, pauses, total, fw };
  };
  for (const st of day.stopp) {
    const c = kunde(st.k);
    const pt = c && c.lat != null ? [c.lat, c.lon] : null;
    const L = await legTo(pt);
    const arr = L ? ceil15(t + L.total) : t;
    const want = toMin(st.avtalt);
    const begin = want != null && want > arr ? want : arr;
    const late = want != null && arr > want + 1 ? arr - want : 0;
    const len = +st.min || D.besokMin || 60;
    n++;
    out.items.push({ kind: "kunde", n: `${di + 1}.${n}`, st, c, pt, leg: L, arr, begin, end: begin + len, wait: begin - arr, late });
    out.visits++;
    t = begin + len; if (pt) prev = pt;
  }
  if (day.slutt) {
    const pt = day.slutt.lat != null ? [day.slutt.lat, day.slutt.lon] : null;
    const L = await legTo(pt);
    t = L ? ceil15(t + L.total) : t;
    out.items.push({ kind: "slutt", n: SYM[day.slutt.type] || "H", pt, leg: L, arr: t });
  }
  out.end = t;
  if (out.end > 22 * 60) out.warn.push("Dagen slutter etter kl. 22.");
  return out;
}

/* ---------- lagring ---------- */
function setStatus(t) { const e = $("plStatus"); if (e) e.textContent = t }
function scheduleSave() {
  if (readonly) return;
  setStatus("Endringer ikke lagret …");
  clearTimeout(saveT); saveT = setTimeout(save, 900);
}
function summary() {
  return plan.data.dager.map((d, i) => {
    const c = computed[i]; if (!c) return null;
    const st = c.items[0];
    return {
      start: st.t, slutt: Math.round(c.end), km: Math.round(c.km), kjoring: Math.round(c.driveMin), besok: c.visits,
      fra: d.start.type === "fly" ? `Fly ${d.start.flyplass || ""}`.trim() : d.start.type === "hotell" ? (d.start.navn || "Hotell") : "Hjemme",
      stopp: c.items.filter(x => x.kind !== "start").map(x => x.kind === "kunde"
        ? { n: x.n, type: "kunde", k: x.st.k, navn: x.c ? x.c.n : x.st.k, sted: x.c ? [x.c.adr, x.c.ps].filter(Boolean).join(", ") : "", fra: Math.round(x.begin), til: Math.round(x.end), ankomst: Math.round(x.arr), kjoring: x.leg ? Math.round(x.leg.total) : 0 }
        : { n: x.n, type: d.slutt.type, navn: d.slutt.type === "hjem" ? "Hjem" : d.slutt.navn, sted: d.slutt.adr || "", ankomst: Math.round(x.arr), kjoring: x.leg ? Math.round(x.leg.total) : 0 })
    };
  });
}
let computing = Promise.resolve();
async function save() {
  if (readonly || !plan) return;
  await computing;
  const sb = KK().sb;
  plan.data.sammendrag = summary();
  const row = { tittel: plan.tittel || "Ny rute", data: plan.data, endret: new Date().toISOString() };
  let res;
  if (plan.id) res = await sb.from("ruteplaner").update(row).eq("id", plan.id).select("id,laget_av").single();
  else res = await sb.from("ruteplaner").insert(row).select("id,laget_av").single();
  if (res.error) { setStatus("Kunne ikke lagre: " + res.error.message); return }
  plan.id = res.data.id; plan.laget_av = res.data.laget_av;
  store.set("kk_plan", plan.id);
  setStatus("Lagret " + new Date().toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" }));
  loadList(true);
}
async function loadList(quiet) {
  const { data, error } = await KK().sb.from("ruteplaner").select("id,tittel,laget_av,endret").order("endret", { ascending: false });
  if (!error) plans = data || [];
  if (!quiet) render(); else renderPicker();
}
async function openPlan(id, dayIdx) {
  const { data, error } = await KK().sb.from("ruteplaner").select("*").eq("id", id).single();
  if (error || !data) { setStatus("Fant ikke ruten."); return }
  plan = { id: data.id, tittel: data.tittel, laget_av: data.laget_av, data: Object.assign({ besokMin: 60, pause: true, fergeVent: 30, dager: [] }, data.data || {}) };
  if (!plan.data.dager.length) plan.data.dager.push(newPlan().data.dager[0]);
  readonly = plan.laget_av !== (me().epost || "");
  active = Math.min(Math.max(0, dayIdx || 0), plan.data.dager.length - 1); hotelMode = false; overview = false; wantFit = true; store.set("kk_plan", id);
  return recompute();
}

/* ---------- endringer ---------- */
function day() { return plan.data.dager[active] }
function change() { scheduleSave(); recompute() }
function addStop(k) {
  if (overview) { overview = false; render() }
  const c = kunde(k);
  if (!c) return;
  if (c.lat == null) { flash(`${c.n} mangler sted og kan ikke legges i ruten.`); return }
  const d = day();
  if (d.stopp.some(s => s.k === k)) { flash(`${c.n} er allerede med på dag ${active + 1}.`); return }
  d.stopp.push({ k, min: plan.data.besokMin || 60, avtalt: "" });
  change();
}
let flashMsg = null;
function flash(t) { flashMsg = { t, until: Date.now() + 3500 }; showFlash(); clearTimeout(flash.tm); flash.tm = setTimeout(() => { flashMsg = null; showFlash() }, 3600) }
function showFlash() { const e = $("plFlash"); if (!e) return; const on = flashMsg && Date.now() < flashMsg.until; e.hidden = !on; if (on) e.textContent = flashMsg.t }
function setEnd(slutt) {
  const d = day(); d.slutt = slutt; hotelMode = false; clearHotels();
  // neste dag starter fra hotellet
  const nx = plan.data.dager[active + 1];
  if (nx && slutt.type === "hotell" && nx.start.type === "hotell") Object.assign(nx.start, { navn: slutt.navn, lat: slutt.lat, lon: slutt.lon });
  change();
}
function addDay() {
  const prev = plan.data.dager[plan.data.dager.length - 1];
  const home = store.get("kk_home", { adresse: DEFAULT_HOME });
  const s = prev.slutt && prev.slutt.type === "hotell"
    ? { type: "hotell", navn: prev.slutt.navn, lat: prev.slutt.lat, lon: prev.slutt.lon, kl: "08:00" }
    : { type: "hjem", navn: home.adresse, lat: home.lat, lon: home.lon, kl: "07:00" };
  plan.data.dager.push(newDay(addDays(prev.dato, 1), s));
  active = plan.data.dager.length - 1; change();
}

/* ---------- hotell ---------- */
function clearHotels() { if (hotelLayer) hotelLayer.clearLayers() }
let hotelState = { loading: false, list: [], err: "", from: null };
async function showHotels(recenter = true) {
  const map = KK().map, c = computed[active];
  const last = c && [...c.items].reverse().find(i => i.pt && i.kind !== "slutt");
  if (last && recenter) map.setView(last.pt, Math.max(map.getZoom(), 11));
  hotelMode = true; hotelState = { loading: true, list: [], err: "", from: last ? last.pt : null }; render();
  const b = map.getBounds().pad(.3);
  const q = `[out:json][timeout:20];nwr["tourism"~"^(hotel|motel|guest_house|hostel|apartment)$"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()});out center 80;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const list = (j.elements || []).map(e => ({ navn: (e.tags && (e.tags.name || e.tags.brand)) || "", lat: e.lat ?? (e.center && e.center.lat), lon: e.lon ?? (e.center && e.center.lon), typ: e.tags && e.tags.tourism,
      adr: e.tags ? [e.tags["addr:street"], e.tags["addr:housenumber"]].filter(Boolean).join(" ") + (e.tags["addr:city"] ? ", " + e.tags["addr:city"] : "") : "" }))
      .filter(h => h.lat != null && h.navn);
    if (last) list.sort((a, b2) => hav(last.pt, [a.lat, a.lon]) - hav(last.pt, [b2.lat, b2.lon]));
    hotelState = { loading: false, list, err: "", from: hotelState.from };
    drawHotels(list);
  } catch (e) { hotelState = { loading: false, list: [], err: e.message, from: hotelState.from } }
  if (hotelMode) render();
}
function hotelsHtml() {
  const H = hotelState;
  if (H.loading) return `<div class="status">Søker etter overnatting i kartutsnittet …</div>`;
  if (H.err) return `<div class="status">Fikk ikke hentet hoteller (${esc(H.err)}). Skriv adressen under.</div>`;
  if (!H.list.length) return `<div class="status">Fant ingen overnatting i utsnittet. Zoom ut og trykk «Søk på nytt», eller skriv adressen under.</div>`;
  return `<div class="status">${H.list.length} steder. Klikk på H i kartet eller velg i lista.</div><div class="hlist">${H.list.slice(0, 25).map((h, i) => `<button type="button" class="hrow" data-h="${i}"><b>${esc(h.navn)}</b><span>${esc(h.adr || TYP[h.typ] || "")}${H.from ? ` · ${hav(H.from, [h.lat, h.lon]).toFixed(1)} km` : ""}</span></button>`).join("")}</div>`;
}
const TYP = { hotel: "Hotell", motel: "Motell", guest_house: "Gjestehus", hostel: "Vandrerhjem", apartment: "Leilighet" };
function drawHotels(list) {
  const map = KK().map;
  if (!hotelLayer) hotelLayer = L.layerGroup().addTo(map);
  hotelLayer.clearLayers();
  list.forEach(h => L.marker([h.lat, h.lon], { icon: L.divIcon({ className: "", html: `<div class="hicon" title="${esc(h.navn)}">H</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 900 })
    .bindTooltip(`${esc(h.navn)}${h.adr ? " · " + esc(h.adr) : ""}`, { direction: "top" })
    .on("click", () => setEnd({ type: "hotell", navn: h.navn, lat: h.lat, lon: h.lon, adr: h.adr })).addTo(hotelLayer));
}


/* ---------- kunder langs ruta ---------- */
let nearOpen = store.get("kk_near", false), nearKm = store.get("kk_nearkm", 10), nearAB = store.get("kk_nearab", false), nearLayer = null;
const nf0 = new Intl.NumberFormat("nb-NO");
const kK = v => v >= 1e6 ? (v / 1e6).toLocaleString("nb-NO", { maximumFractionDigits: 1 }) + " mill." : nf0.format(Math.round(v / 1000)) + " k";
function routePoly(c) {
  const pts = [];
  c.items.forEach(it => { if (it.leg && it.leg.geom && it.leg.geom.length > 1) pts.push(...it.leg.geom); else if (it.pt) pts.push(it.pt) });
  return pts;
}
function distToRoute(p, poly) {
  const k = Math.cos(p[0] * Math.PI / 180), xy = q => [q[1] * 111.32 * k, q[0] * 110.57];
  const P = xy(p); let best = Infinity, along = 0, acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const A = xy(poly[i]), B = xy(poly[i + 1]), dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy, len = Math.sqrt(L2);
    const t = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)) : 0;
    const d = Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dy));
    if (d < best) { best = d; along = acc + t * len }
    acc += len;
  }
  return { d: best, along };
}
function nearCustomers() {
  const c = computed[active]; if (!c) return [];
  const poly = routePoly(c); if (poly.length < 2) return [];
  const inPlan = new Set(plan.data.dager.flatMap(d => d.stopp.map(x => x.k)));
  const pad = nearKm / 110;
  let s = 90, n = -90, w = 180, e = -180;
  poly.forEach(p => { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]) });
  const padLon = pad / Math.cos(((s + n) / 2) * Math.PI / 180);
  return KK().DATA.filter(x => x.lat != null && !inPlan.has(x.k) && (!nearAB || x.s === "A" || x.s === "B") && x.lat >= s - pad && x.lat <= n + pad && x.lon >= w - padLon && x.lon <= e + padLon)
    .map(x => ({ c: x, ...distToRoute([x.lat, x.lon], poly) })).filter(r => r.d <= nearKm).sort((a, b) => a.along - b.along);
}
function addNear(k) {
  const c = kunde(k), d = day(); if (!c) return;
  const pt = [c.lat, c.lon], comp = computed[active];
  const pts = d.stopp.map(x => { const cc = kunde(x.k); return cc ? [cc.lat, cc.lon] : null });
  const startPt = comp && comp.items[0].pt, endPt = d.slutt && d.slutt.lat != null ? [d.slutt.lat, d.slutt.lon] : null;
  let bestI = d.stopp.length, bestCost = Infinity;
  for (let i = 0; i <= d.stopp.length; i++) {
    const prev = i === 0 ? startPt : pts[i - 1], next = i < d.stopp.length ? pts[i] : endPt;
    if (!prev) continue;
    const cost = hav(prev, pt) + (next ? hav(pt, next) - hav(prev, next) : 0);
    if (cost < bestCost) { bestCost = cost; bestI = i }
  }
  d.stopp.splice(bestI, 0, { k, min: plan.data.besokMin || 60, avtalt: "" });
  flash(`${c.n} lagt inn som besøk ${active + 1}.${bestI + 1}.`);
  change();
}
function nearHtml(ro) {
  if (ro) return "";
  const c = computed[active]; if (!c || routePoly(c).length < 2) return "";
  const list = nearCustomers();
  return `<div class="near">
    <div class="nearhead"><button type="button" class="linkbtn" id="nearToggle" aria-expanded="${nearOpen}">${nearOpen ? "▾" : "▸"} Kunder langs ruta (${list.length})</button>
      <label class="chk"><input type="checkbox" id="nearAB" ${nearAB ? "checked" : ""}> Bare A/B</label><label>innen <select id="nearKm">${[2, 5, 10, 20, 30].map(v => `<option value="${v}" ${v === nearKm ? "selected" : ""}>${v} km</option>`).join("")}</select></label></div>
    ${nearOpen ? (list.length ? `<div class="nearlist">${list.map(r => `<div class="nrow"><button type="button" class="ib add" data-near="${esc(r.c.k)}" aria-label="Legg ${esc(r.c.n)} til i ruta">+</button>
        <div><b>${esc(r.c.n)}</b><span>${esc(r.c.ps)} · ${r.d < 1 ? "<1" : r.d.toFixed(r.d < 10 ? 1 : 0)} km fra ruta</span></div>
        <span class="nmeta"><span class="seg ${esc(r.c.s)}">${esc(r.c.s)}</span>${kK(r.c.t)}</span></div>`).join("")}</div>` : `<div class="status">Ingen andre kunder innen ${nearKm} km fra ruta.</div>`) : ""}
  </div>`;
}
function drawNear() {
  const map = KK().map; if (!map) return;
  if (!nearLayer) nearLayer = L.layerGroup().addTo(map);
  nearLayer.clearLayers();
  if (!open || !plan || !nearOpen || overview || readonly) return;
  nearCustomers().forEach(r => L.marker([r.c.lat, r.c.lon], { icon: L.divIcon({ className: "", html: `<div class="nearring"></div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false, zIndexOffset: -100 }).addTo(nearLayer));
}


/* ---------- fergeleier i kartet med avgangstabell ---------- */
async function departuresTable(fromKai, toKai, dateStr, crossMin, chosenMin) {
  const base = new Date(dateStr + "T00:00:00"), start = new Date(base.getTime() + 4 * 3600000);
  const d = await entur(`query($id:String!,$t:DateTime!){ stopPlace(id:$id){ name estimatedCalls(startTime:$t, timeRange:86400, numberOfDepartures:80, whiteListedModes:[water]){ expectedDepartureTime aimedDepartureTime cancellation destinationDisplay{frontText} serviceJourney{ line{ name } } } } }`, { id: fromKai.id, t: start.toISOString() });
  const w = toKai ? word(toKai.name) : "";
  const rows = (d.stopPlace ? d.stopPlace.estimatedCalls : [])
    .filter(c => goesTo(c, w))
    .filter(c => new Date(c.expectedDepartureTime) < new Date(base.getTime() + 28 * 3600000));
  if (!rows.length) return `<div class="status">Fant ingen avganger denne dagen.</div>`;
  return `<table class="fttab"><thead><tr><th>Avgang</th><th>Ankomst ca.</th><th>Til</th></tr></thead><tbody>${rows.map(c => {
    const m = (new Date(c.expectedDepartureTime) - base) / 60000, sel = chosenMin != null && Math.abs(m - chosenMin) < 1;
    return `<tr class="${sel ? "sel" : ""}${c.cancellation ? " cx" : ""}"><td>${hm(m)}${sel ? " ←" : ""}</td><td>${hm(m + crossMin)}</td><td>${esc(c.destinationDisplay.frontText)}${c.cancellation ? " (innstilt)" : ""}</td></tr>`;
  }).join("")}</tbody></table>`;
}
function ferryPopup(f, dateStr) {
  const el = document.createElement("div"); el.className = "pop ferrypop";
  let dir = 0;
  const draw = async () => {
    const A = dir === 0 ? f.fraKai : f.tilKai, B = dir === 0 ? f.tilKai : f.fraKai;
    el.innerHTML = `<h4>⛴ ${esc(f.navn)}</h4>
      <div class="ftdir"><button type="button" class="chip" data-dir="0" aria-pressed="${dir === 0}">${esc(kaiNavn(f.fraKai.name))} → ${esc(f.tilKai ? kaiNavn(f.tilKai.name) : "")}</button>${f.tilKai ? `<button type="button" class="chip" data-dir="1" aria-pressed="${dir === 1}">${esc(kaiNavn(f.tilKai.name))} → ${esc(kaiNavn(f.fraKai.name))}</button>` : ""}</div>
      <div class="status">${esc(dato(dateStr))} · overfart ca. ${f.min} min · være på kaia 10 min før</div>
      <div class="ftbody"><div class="status">Henter avganger fra Entur …</div></div>
      <a href="https://entur.no" target="_blank" rel="noopener">Åpne i Entur ↗</a>`;
    el.querySelectorAll("[data-dir]").forEach(b => b.onclick = e => { e.stopPropagation(); dir = +b.dataset.dir; draw() });
    try {
      const body = el.querySelector(".ftbody");
      body.innerHTML = await departuresTable(A, B, dateStr, f.min, dir === 0 ? f.avgang : null);
      const sel = body.querySelector("tr.sel"); if (sel) body.scrollTop = Math.max(0, sel.offsetTop - 60);
    }
    catch (e) { el.querySelector(".ftbody").innerHTML = `<div class="status">Kunne ikke hente avganger: ${esc(e.message)}</div>` }
  };
  draw();
  return el;
}
function drawFerries(layer, c, di) {
  const d = plan.data.dager[di];
  c.items.forEach(it => (it.leg && it.leg.ferger || []).forEach(f => {
    if (!f.fra) return;
    const mk = (pt, main) => L.marker(pt, { icon: L.divIcon({ className: "", html: `<div class="ferryicon${main ? "" : " small"}" title="${esc(f.navn)}">⛴</div>`, iconSize: main ? [30, 30] : [24, 24], iconAnchor: main ? [15, 15] : [12, 12] }), zIndexOffset: 1200 })
      .bindTooltip(`${esc(f.navn)}${f.avgang != null && main ? ` · avgang ${hm(f.avgang)}` : ""} · klikk for fergetider`, { direction: "top" });
    const pop = () => f.fraKai ? ferryPopup(f, d.dato) : `<div class="pop"><h4>⛴ ${esc(f.navn)}</h4><div class="status">Fant ikke fergekaia i Entur.</div><a href="https://entur.no" target="_blank" rel="noopener">Søk i Entur ↗</a></div>`;
    const add = m => m.bindPopup(pop, { maxWidth: 320, minWidth: 270 }).on("popupopen", () => m.closeTooltip()).addTo(layer);
    add(mk(f.fra, true));
    if (f.til) add(mk(f.til, false));
  }));
}

/* ---------- kart ---------- */
// Én farge per dag (gjentas etter sju dager). Første og siste etappe tegnes i mørkere nyanse.
const DAYC = ["#1d5aa8", "#c2410c", "#15803d", "#7e22ce", "#b45309", "#0e7490", "#be185d"];
const dayColor = i => DAYC[i % DAYC.length];
function shade(hex, f) { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, m = v => Math.round(v * f).toString(16).padStart(2, "0"); return "#" + m(r) + m(g) + m(b) }
let overview = false, legendEl = null;
function drawPlan() {
  const map = KK().map; if (!map) return;
  drawNear();
  if (!planLayer) planLayer = L.layerGroup().addTo(map);
  planLayer.clearLayers();
  drawLegend();
  if (!open || !plan) return;
  computed.forEach((c, di) => {
    if (!c) return;
    const act = di === active, col = dayColor(di), dark = shade(col, .55);
    const show = overview || act;
    const legs = c.items.filter(it => it.leg && it.leg.geom);
    legs.forEach(it => {
      const firstLeg = it === c.items.find(x => x.leg);
      const lastLeg = it.kind === "slutt";
      const isEdge = overview && (firstLeg || lastLeg);
      L.polyline(it.leg.geom, {
        color: show ? (isEdge ? dark : col) : css("--muted"),
        weight: show ? (isEdge ? 6 : 4.5) : 3, opacity: show ? .9 : .4,
        dashArray: it.leg.est ? "6 8" : null, interactive: false
      }).addTo(planLayer);
    });
    if (!show) return;
    drawFerries(planLayer, c, di);
    c.items.forEach(it => {
      if (!it.pt) return;
      const bg = it.kind === "kunde" ? col : dark;
      const label = it.n;
      const cls = it.kind === "start" ? "pn start" : it.kind === "slutt" ? "pn end" : "pn";
      L.marker(it.pt, { icon: L.divIcon({ className: "", html: `<div class="${cls}${overview ? " ov" : ""}" style="${overview ? `background:${bg};color:#fff` : ""}">${label}</div>`, iconSize: null, iconAnchor: [16, 14] }), zIndexOffset: 1000 + (act ? 100 : 0), interactive: false })
        .addTo(planLayer);
    });
  });
}
function drawLegend() {
  const wrap = document.querySelector(".mapwrap"); if (!wrap) return;
  if (!legendEl) { legendEl = document.createElement("div"); legendEl.className = "daylegend"; wrap.appendChild(legendEl) }
  if (!open || !plan || !overview) { legendEl.hidden = true; return }
  legendEl.hidden = false;
  legendEl.innerHTML = `<b>${esc(plan.tittel)}</b>` + plan.data.dager.map((d, i) => { const c = computed[i];
    return `<button type="button" data-lg="${i}"><i style="background:${dayColor(i)};border-color:${shade(dayColor(i), .55)}"></i>Dag ${i + 1} · ${esc(dato(d.dato))}<span>${c ? `${c.visits} besøk · ${km(c.km)}` : ""}</span></button>` }).join("") +
    `<div class="lgnote"><i class="dk"></i>Mørkere strek: til første og fra siste kunde</div>`;
  legendEl.querySelectorAll("[data-lg]").forEach(b => b.onclick = () => { overview = false; active = +b.dataset.lg; hotelMode = false; clearHotels(); render(); drawPlan(); fitDay() });
}
function fitAll() {
  const map = KK().map, pts = [];
  computed.forEach(c => c && c.items.forEach(i => { if (i.pt) pts.push(i.pt); if (i.leg && i.leg.geom) pts.push(...i.leg.geom) }));
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(.08), { maxZoom: 11 });
}
function fitDay() {
  if (overview) return fitAll();
  const c = computed[active], map = KK().map; if (!c || !map) return;
  const pts = c.items.filter(i => i.pt).map(i => i.pt);
  c.items.forEach(i => { if (i.leg && i.leg.geom) pts.push(...i.leg.geom) });
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(.15), { maxZoom: 12 });
}
let wantFit = true;
/* ---------- visning ---------- */
let recomputeSeq = 0;
function recompute() {
  computing = (async () => {
    const seq = ++recomputeSeq;
    render();
    const res = [];
    for (const [i, d] of plan.data.dager.entries()) res.push(await computeDay(d, i));
    if (seq !== recomputeSeq) return;
    computed = res; render(); drawPlan();
    if (wantFit) { wantFit = false; fitDay() }
  })();
  return computing;
}
function renderPicker() {
  const sel = $("plPick"); if (!sel) return;
  const mine = me().epost;
  sel.innerHTML = `<option value="">${plan && !plan.id ? "Ny rute (ikke lagret)" : "Velg rute …"}</option>` +
    plans.map(p => `<option value="${p.id}" ${plan && plan.id === p.id ? "selected" : ""}>${esc(p.tittel)}${p.laget_av !== mine ? ` · ${esc(p.laget_av.split("@")[0])}` : ""}</option>`).join("");
}
function render() {
  const P = $("planner"); if (!P || !open) return;
  if (!plan) { P.innerHTML = `<div class="empty">Laster ruter …</div>`; return }
  const D = plan.data, c = computed[active];
  const tot = computed.reduce((a, x) => x ? { km: a.km + x.km, drive: a.drive + x.driveMin, v: a.v + x.visits } : a, { km: 0, drive: 0, v: 0 });
  const ro = readonly ? "disabled" : "";
  P.innerHTML = `
  <div class="plhead">
    <div class="plrow"><select id="plPick" aria-label="Velg rute"></select><button type="button" class="btn" id="plNew">Ny rute</button><button type="button" class="btn" id="plIcs" title="Last ned som kalenderfil for Outlook">Til Outlook</button></div>
    <div class="plrow"><input id="plTitle" class="pltitle" value="${esc(plan.tittel)}" aria-label="Navn på ruten" ${ro}></div>
    ${readonly ? `<div class="box warn">Ruten er laget av ${esc(plan.laget_av)}. Du kan se den, men ikke endre den.</div>` : ""}
    <div class="plrow small">
      <label>Standard besøk <input type="number" id="plMin" min="5" step="5" value="${D.besokMin}" ${ro}> min</label>
      <label class="chk"><input type="checkbox" id="plPause" ${D.pause ? "checked" : ""} ${ro}> 30 min pause per 4 t kjøring</label>
      <label title="Brukes når ruteplanen for fergen ikke finnes">Ventetid ferge uten ruteplan <input type="number" id="plFerge" min="0" step="5" value="${+D.fergeVent || 0}" ${ro}> min</label>
    </div>
    <div class="plsum">${D.dager.length} dag${D.dager.length > 1 ? "er" : ""} · ${tot.v} besøk · ${km(tot.km)} · kjøring ${dur(tot.drive)} <span class="status" id="plStatus"></span></div>
    <div class="pltabs" role="tablist"><button type="button" class="chip ovbtn" id="plOverview" aria-pressed="${overview}">Hele ruta</button>${D.dager.map((d, i) => `<button type="button" role="tab" class="chip" data-day="${i}" aria-pressed="${!overview && i === active}"><span class="dot" style="background:${dayColor(i)}"></span>Dag ${i + 1} · ${esc(dato(d.dato))}</button>`).join("")}${readonly ? "" : `<button type="button" class="chip add" id="plAddDay">+ Dag</button>`}</div>
  </div>
  <div class="plbody">
    ${dayHtml(D.dager[active], c, ro)}
    <div class="flash" id="plFlash" hidden></div>
  </div>`;
  renderPicker();
  bind();
  showFlash();
}
function startHtml(d, ro) {
  const s = d.start;
  const typeSel = `<select id="stType" ${ro}>${[["hjem", "Hjemme"], ["hotell", "Hotell"], ["fly", "Fly"]].map(([v, l]) => `<option value="${v}" ${s.type === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  if (s.type === "fly") return `${typeSel}
    <select id="stFly" ${ro}>${FLYPLASSER.map(f => `<option value="${f[0]}" ${s.flyplass === f[0] ? "selected" : ""}>${f[1]} (${f[0]})</option>`).join("")}</select>
    <label>Landing <input type="time" id="stKl" value="${esc(s.kl)}" ${ro}></label>
    <select id="stTrans" ${ro}><option value="leiebil" ${s.transport !== "taxi" ? "selected" : ""}>Leiebil</option><option value="taxi" ${s.transport === "taxi" ? "selected" : ""}>Taxi</option></select>`;
  return `${typeSel}
    <input id="stNavn" class="grow" value="${esc(s.navn || "")}" placeholder="${s.type === "hjem" ? "Hjemmeadresse" : "Hotell eller adresse"}" ${ro}>
    <label>Avreise <input type="time" id="stKl" value="${esc(s.kl)}" ${ro}></label>`;
}
function legHtml(L) {
  if (!L) return "";
  if (L.km < 0.2) return `<div class="leg">↓ Samme sted</div>`;
  const fer = (L.ferger || []).map(f => f.avgang != null
    ? `<div class="ferry">⛴ ${esc(f.navn)} · avgang <b>${hm(f.avgang)}</b>${f.vent > 0 ? ` (venter ${dur(f.vent)})` : ""} · overfart ${f.min} min</div>`
    : `<div class="ferry">⛴ ${esc(f.navn)} · overfart ${f.min} min + ${f.vent} min ventetid <span class="est">fant ikke ruteplan</span> · <a href="https://entur.no" target="_blank" rel="noopener">sjekk avganger</a></div>`).join("");
  return `<div class="leg">↓ Kjøring ${dur(L.min)} · ${km(L.km)}${L.pauses ? ` · + ${L.pauses * PAUSE_MIN} min pause` : ""}${L.est ? ` <span class="est">anslått</span>` : ""}${fer}</div>`;
}
function dayHtml(d, c, ro) {
  const it = c ? c.items : null;
  const s = d.start;
  const startLbl = s.type === "fly" ? `Landing ${esc(s.flyplass || "")} ${esc(s.kl)} · ${s.transport === "taxi" ? "taxi" : "leiebil"}, kjører ${hm(it ? it[0].t : null)}` : `Avreise ${esc(s.kl)}`;
  let h = `<div class="day">
    <div class="plrow small"><label>Dato <input type="date" id="dDate" value="${esc(d.dato)}" ${ro}></label>${!ro && plan.data.dager.length > 1 ? `<button type="button" class="linkbtn" id="dDel">Fjern dagen</button>` : ""}</div>
    <div class="step start"><span class="pn start">${SYM[s.type] || "S"}</span><div class="sbody"><b>${s.type === "fly" ? "Fly" : s.type === "hotell" ? "Fra hotell" : "Hjemmefra"}</b><div class="mut">${startLbl}</div><div class="plrow wrap">${startHtml(d, ro)}</div></div></div>`;
  if (!it) h += `<div class="status">Regner ut kjøretider …</div>`;
  else {
    it.filter(x => x.kind === "kunde").forEach((x, i) => {
      h += legHtml(x.leg);
      h += `<div class="step"><span class="pn">${x.n}</span><div class="sbody">
        <b>${esc(x.c ? x.c.n : x.st.k)}</b>
        <div class="mut">${esc(x.c ? x.c.ps : "")} · ankomst ${hm(x.arr)}${x.wait > 1 ? ` · venter ${dur(x.wait)}` : ""}</div>
        ${x.late ? `<div class="late">Rekker ikke avtalen kl. ${esc(x.st.avtalt)}: ${dur(x.late)} for sent.</div>` : ""}
        <div class="when">Besøk <b>${hm(x.begin)}–${hm(x.end)}</b></div>
        <div class="plrow small">
          <label>Varighet <input type="number" min="5" step="5" data-i="${i}" data-f="min" value="${esc(x.st.min)}" ${ro}> min</label>
          <label>Avtalt kl. <input type="time" data-i="${i}" data-f="avtalt" value="${esc(x.st.avtalt || "")}" ${ro}></label>
          ${ro ? "" : `<span class="mv"><button type="button" class="ib" data-mv="${i}" data-d="-1" aria-label="Flytt opp" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="ib" data-mv="${i}" data-d="1" aria-label="Flytt ned" ${i === d.stopp.length - 1 ? "disabled" : ""}>↓</button><button type="button" class="ib" data-rm="${i}" aria-label="Fjern fra ruten">×</button></span>`}
        </div></div></div>`;
    });
    const end = it.find(x => x.kind === "slutt");
    if (end) {
      h += legHtml(end.leg);
      h += `<div class="step end"><span class="pn end">${end.n}</span><div class="sbody"><b>${d.slutt.type === "hjem" ? "Hjem" : esc(d.slutt.navn)}</b><div class="mut">Ankomst ${hm(end.arr)}${d.slutt.adr ? " · " + esc(d.slutt.adr) : ""}</div>${ro ? "" : `<button type="button" class="linkbtn" id="dEndRm">Fjern</button>`}</div></div>`;
    }
    if (!ro) {
      h += !d.stopp.length && !hotelMode ? `<div class="hint">Klikk på kundene i kartet i den rekkefølgen du vil besøke dem.</div>` : "";
      h += `<div class="acts endacts">
        <button type="button" class="btn ${hotelMode ? "pri" : ""}" id="dHotel">${d.slutt && d.slutt.type === "hotell" ? "Bytt hotell" : "Avslutt med hotell"}</button>
        <button type="button" class="btn" id="dHome">Kjør hjem</button></div>`;
      if (hotelMode) h += `<div class="hotels"><div id="plHotels">${hotelsHtml()}</div>
        <button type="button" class="linkbtn" id="hAgain">Søk på nytt i kartutsnittet</button>
        <form id="hForm" class="fixrow"><label class="f">Eller skriv adressen<input id="hAdr" placeholder="Torget 1, 8300 Svolvær"></label><button class="btn" type="submit">Bruk</button></form>
        <button type="button" class="linkbtn" id="hCancel">Avbryt</button></div>`;
    }
    h += `<div class="daysum">Dag ${active + 1}: ${c.visits} besøk · kjøring ${dur(c.driveMin)} · ${km(c.km)} · ferdig ${hm(c.end)}${c.est ? " · noen kjøretider er anslått" : ""}${c.ferger.length ? ` · ⛴ ${c.ferger.length} ferge${c.ferger.length > 1 ? "r" : ""}` : ""}${c.warn.map(w => `<div class="late">${esc(w)}</div>`).join("")}</div>`;
    h += nearHtml(ro);
  }
  return h + `</div>`;
}
function bind() {
  const D = plan.data, d = D.dager[active];
  $("plPick").onchange = e => { if (e.target.value) openPlan(e.target.value) };
  $("plIcs").onclick = exportIcs;
  $("plOverview").onclick = () => { overview = !overview; hotelMode = false; clearHotels(); render(); drawPlan(); fitDay() };
  $("plNew").onclick = () => { plan = newPlan(); plan.laget_av = me().epost; readonly = false; active = 0; computed = []; recompute(); };
  if (readonly) { document.querySelectorAll("#planner [data-day]").forEach(b => b.onclick = () => { overview = false; active = +b.dataset.day; hotelMode = false; render(); drawPlan(); fitDay() }); return }
  $("plTitle").oninput = e => { plan.tittel = e.target.value; scheduleSave() };
  $("plMin").onchange = e => { D.besokMin = Math.max(5, +e.target.value || 60); scheduleSave() };
  $("plPause").onchange = e => { D.pause = e.target.checked; change() };
  if ($("nearToggle")) $("nearToggle").onclick = () => { nearOpen = !nearOpen; store.set("kk_near", nearOpen); render(); drawNear() };
  if ($("nearAB")) $("nearAB").onchange = e => { nearAB = e.target.checked; store.set("kk_nearab", nearAB); render(); drawNear() };
  if ($("nearKm")) $("nearKm").onchange = e => { nearKm = +e.target.value; store.set("kk_nearkm", nearKm); render(); drawNear() };
  document.querySelectorAll("#planner [data-near]").forEach(b => b.onclick = () => addNear(b.dataset.near));
  $("plFerge").onchange = e => { D.fergeVent = Math.max(0, +e.target.value || 0); change() };
  document.querySelectorAll("#planner [data-day]").forEach(b => b.onclick = () => { overview = false; active = +b.dataset.day; hotelMode = false; clearHotels(); render(); drawPlan(); fitDay() });
  $("plAddDay").onclick = addDay;
  $("dDate").onchange = e => { d.dato = e.target.value; scheduleSave(); render() };
  if ($("dDel")) $("dDel").onclick = () => {
    if (!delArm) { delArm = true; $("dDel").textContent = "Trykk igjen for å fjerne"; setTimeout(() => { delArm = false; const b = $("dDel"); if (b) b.textContent = "Fjern dagen" }, 3000); return }
    delArm = false; D.dager.splice(active, 1); active = Math.max(0, active - 1); change();
  };
  $("stType").onchange = e => {
    const t = e.target.value, home = store.get("kk_home", { adresse: DEFAULT_HOME }), prev = D.dager[active - 1];
    if (t === "hjem") d.start = { type: "hjem", navn: home.adresse, lat: home.lat, lon: home.lon, kl: d.start.kl || "06:00" };
    if (t === "hotell") d.start = prev && prev.slutt && prev.slutt.type === "hotell" ? { type: "hotell", navn: prev.slutt.navn, lat: prev.slutt.lat, lon: prev.slutt.lon, kl: "08:00" } : { type: "hotell", navn: "", lat: null, lon: null, kl: "08:00" };
    if (t === "fly") { const f = FLYPLASSER[0]; d.start = { type: "fly", flyplass: f[0], navn: f[1], lat: f[2], lon: f[3], kl: "08:00", transport: "leiebil" } }
    change();
  };
  $("stKl").onchange = e => { d.start.kl = e.target.value; change() };
  if ($("stFly")) $("stFly").onchange = e => { const f = FLYPLASSER.find(x => x[0] === e.target.value); Object.assign(d.start, { flyplass: f[0], navn: f[1], lat: f[2], lon: f[3] }); change() };
  if ($("stTrans")) $("stTrans").onchange = e => { d.start.transport = e.target.value; change() };
  if ($("stNavn")) $("stNavn").onchange = async e => {
    const v = e.target.value.trim(); if (!v) return;
    const g = await window.KKAdr.geocodeFree(v).catch(() => null);
    if (!g) { flash("Fant ikke adressen. Skriv gate, nummer og postnummer."); return }
    Object.assign(d.start, { navn: d.start.type === "hotell" && !/\d{4}/.test(v) ? v : `${g.adresse}, ${g.postnr} ${g.poststed}`, lat: g.lat, lon: g.lon });
    if (d.start.type === "hjem") store.set("kk_home", { adresse: d.start.navn, lat: g.lat, lon: g.lon });
    change();
  };
  document.querySelectorAll("#planner input[data-f]").forEach(inp => inp.onchange = () => {
    const s = d.stopp[+inp.dataset.i]; if (!s) return;
    s[inp.dataset.f] = inp.dataset.f === "min" ? Math.max(5, +inp.value || 60) : inp.value; change();
  });
  document.querySelectorAll("#planner [data-mv]").forEach(b => b.onclick = () => { const i = +b.dataset.mv, j = i + +b.dataset.d; [d.stopp[i], d.stopp[j]] = [d.stopp[j], d.stopp[i]]; change() });
  document.querySelectorAll("#planner [data-rm]").forEach(b => b.onclick = () => { d.stopp.splice(+b.dataset.rm, 1); change() });
  if ($("dHotel")) $("dHotel").onclick = () => hotelMode ? (hotelMode = false, clearHotels(), render()) : showHotels();
  if ($("dHome")) $("dHome").onclick = () => { const home = store.get("kk_home", { adresse: DEFAULT_HOME }); setEnd({ type: "hjem", navn: home.adresse, lat: home.lat, lon: home.lon }) };
  if ($("dEndRm")) $("dEndRm").onclick = () => { d.slutt = null; change() };
  document.querySelectorAll("#planner .hrow").forEach(btn => btn.onclick = () => { const h = hotelState.list[+btn.dataset.h]; setEnd({ type: "hotell", navn: h.navn, lat: h.lat, lon: h.lon, adr: h.adr }) });
  if ($("hAgain")) $("hAgain").onclick = () => showHotels(false);
  if ($("hCancel")) $("hCancel").onclick = () => { hotelMode = false; clearHotels(); render() };
  if ($("hForm")) $("hForm").onsubmit = async e => {
    e.preventDefault();
    const v = $("hAdr").value.trim(); if (!v) return;
    const g = await window.KKAdr.geocodeFree(v).catch(() => null);
    if (!g) { flash("Fant ikke adressen. Skriv gate, nummer og postnummer."); return }
    setEnd({ type: "hotell", navn: v, lat: g.lat, lon: g.lon, adr: `${g.adresse}, ${g.postnr} ${g.poststed}` });
  };
}


/* ---------- eksport til kalender (.ics) ---------- */
function icsEsc(t) { return String(t || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1") }
function icsTime(dateStr, min) {
  const d = new Date(dateStr + "T00:00:00"); d.setMinutes(Math.round(min));
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}
function fold(line) { const out = []; while (line.length > 74) { out.push(line.slice(0, 74)); line = " " + line.slice(74) } out.push(line); return out.join("\r\n") }
function buildIcs() {
  const sum = summary(), now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lindab Kundekart Nord//NO", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE", "TZID:Europe/Oslo", "BEGIN:STANDARD", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "END:STANDARD",
    "BEGIN:DAYLIGHT", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "END:DAYLIGHT", "END:VTIMEZONE"];
  let uid = 0;
  const ev = (date, a, b, title, loc, desc) => {
    if (b - a < 1) return;
    L.push("BEGIN:VEVENT", `UID:${(plan.id || "ny")}-${uid++}@kundekart-nord`, `DTSTAMP:${now}`,
      `DTSTART;TZID=Europe/Oslo:${icsTime(date, a)}`, `DTEND;TZID=Europe/Oslo:${icsTime(date, b)}`,
      fold(`SUMMARY:${icsEsc(title)}`), ...(loc ? [fold(`LOCATION:${icsEsc(loc)}`)] : []), ...(desc ? [fold(`DESCRIPTION:${icsEsc(desc)}`)] : []), "END:VEVENT");
  };
  plan.data.dager.forEach((d, i) => {
    const s = sum[i]; if (!s) return;
    s.stopp.forEach(x => {
      const arr = x.ankomst;
      if (x.kjoring > 0) ev(d.dato, arr - x.kjoring, arr, `Kjøring til ${x.navn}`, "", `${plan.tittel} · dag ${i + 1}`);
      if (x.type === "kunde") ev(d.dato, x.fra, x.til, `Kundebesøk: ${x.navn}`, x.sted, `Kundenr. ${x.k} · ${plan.tittel} · dag ${i + 1}`);
      else if (x.type === "hotell") ev(d.dato, arr, arr + 15, `Hotell: ${x.navn}`, x.sted, `Innsjekk · ${plan.tittel}`);
    });
  });
  L.push("END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}
async function exportIcs() {
  await computing;
  if (!computed.length) return;
  const blob = new Blob([buildIcs()], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (plan.tittel || "rute").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "_") + ".ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  flash("Kalenderfila er lastet ned. Åpne den for å legge hendelsene inn i Outlook.");
}

/* ---------- av/på ---------- */
async function toggle(force) {
  open = force ?? !open;
  document.body.classList.toggle("planning", open);
  document.dispatchEvent(new Event("kk:view"));
  KK().closeDetail();
  KK().pick = open ? (k => { if (readonly) return false; addStop(k); return true }) : null;
  if (!open) { if (planLayer) planLayer.clearLayers(); if (nearLayer) nearLayer.clearLayers(); if (legendEl) legendEl.hidden = true; clearHotels(); hotelMode = false; setTimeout(() => KK().invalidate(), 0); return }
  if (window.innerWidth <= 760) { $("main").dataset.view = "list" }
  render();
  await loadList(true);
  const last = store.get("kk_plan", null);
  if (!plan) {
    if (last && plans.some(p => p.id === last)) await openPlan(last);
    else { plan = newPlan(); plan.laget_av = me().epost; readonly = false; recompute() }
  } else recompute();
  setTimeout(() => KK().invalidate(), 0);
}
window.KKPlan = { toggle, openPlan, computeDay, leg, ferryDeparture, departuresTable, hm, dur, buildIcs, get open() { return open }, get plan() { return plan }, get computed() { return computed } };
})();
