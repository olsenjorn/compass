/* Fergeleier i kartet: alle bilfergekaier i Nord-Norge (Entur), alltid synlige.
   Klikk på en kai for avgangstabell for valgt dag. */
(function () {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ENTUR = "https://api.entur.io/journey-planner/v3/graphql";
const CACHE = "kk_fergeleier_v2", TTL = 7 * 864e5, ON = "kk_ferger_on";
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
async function entur(query, variables) {
  const r = await fetch(ENTUR, { method: "POST", headers: { "Content-Type": "application/json", "ET-Client-Name": "lindab-kundekartnord" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json(); if (j.errors) throw new Error(j.errors[0].message); return j.data;
}
const SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M5 15h14l-2.2 4.2c-.2.5-.7.8-1.2.8H8.4c-.5 0-1-.3-1.2-.8L5 15zm3-6h8l1.5 5h-11L8 9zm2.5-4h3v3h-3V5z"/></svg>';
const kai = n => String(n || "").replace(/\s*(ferjekai|fergekai|ferjeleie)\b/ig, "").trim();
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hhmm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` };

let quays = null, layer = null;
async function loadQuays() {
  const c = store.get(CACHE, null);
  if (c && Date.now() - c.ts < TTL && c.list.length) return c.list;
  const d = await entur(`{ lines(transportModes:[water]){ name transportSubmode quays{ stopPlace{ id name latitude longitude } } } }`);
  const sp = {};
  d.lines.filter(l => /^(local|national|regional)CarFerry$/.test(l.transportSubmode) && !/Bergen\s*-\s*Kirkenes/i.test(l.name))
    .forEach(l => l.quays.forEach(q => {
      const s = q.stopPlace; if (!s || s.latitude < 64.9 || /kystrutekai/i.test(s.name)) return;
      const o = sp[s.id] || (sp[s.id] = { id: s.id, n: kai(s.name), a: s.latitude, o: s.longitude, l: [] });
      if (!o.l.includes(l.name)) o.l.push(l.name);
    }));
  const list = Object.values(sp);
  // Kaier som finnes i Entur, men mangler i rutemønstrene (f.eks. Skutvik): legg til og finn linjer ut fra avganger
  try {
    const hv = (a, b, c, d) => { const R = 6371, t = x => x * Math.PI / 180, dl = t(c - a), dn = t(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) };
    const bb = await entur(`{ stopPlacesByBbox(minimumLatitude:64.9, maximumLatitude:71.4, minimumLongitude:10.5, maximumLongitude:31.5){ id name latitude longitude transportMode } }`);
    const extra = bb.stopPlacesByBbox.filter(x => (x.transportMode || []).includes("water") && /ferjekai|fergekai|ferjeleie|fergeleie/i.test(x.name) && !/kystrutekai/i.test(x.name))
      .filter(x => !list.some(q => hv(q.a, q.o, x.latitude, x.longitude) < 1.5));
    const seen = [];
    for (const x of extra) {
      if (seen.some(q => hv(q.a, q.o, x.latitude, x.longitude) < 1.5)) continue;
      const q = { id: x.id, n: kai(x.name), a: x.latitude, o: x.longitude, l: [], ekstra: true };
      try {
        const d = await entur(`query($id:String!){ stopPlace(id:$id){ estimatedCalls(timeRange:604800, numberOfDepartures:40, whiteListedModes:[water]){ serviceJourney{ line{ name transportSubmode } } } } }`, { id: x.id });
        const ln = new Set(((d.stopPlace || {}).estimatedCalls || []).filter(c => /CarFerry/.test(c.serviceJourney.line.transportSubmode || "")).map(c => c.serviceJourney.line.name));
        q.l = [...ln];
      } catch (e) { }
      // Navnet på linjen avslører ofte kaia (Svolvær - Skrova - Skutvik)
      if (!q.l.length) list.forEach(o => o.l.forEach(l => { if (new RegExp("\\b" + q.n.split(" ")[0] + "\\b", "i").test(l) && !q.l.includes(l)) q.l.push(l) }));
      seen.push(q);
    }
    list.push(...seen);
  } catch (e) { /* ekstra kaier er ikke kritisk */ }
  if (list.length) store.set(CACHE, { ts: Date.now(), list });
  return list;
}

function popup(q) {
  const el = document.createElement("div"); el.className = "pop ferrypop";
  let day = 0, when = new Date();
  const draw = async () => {
    const base = new Date(); base.setHours(0, 0, 0, 0); base.setDate(base.getDate() + day);
    const start = day === 0 ? new Date(Math.max(Date.now() - 10 * 60000, base.getTime())) : base;
    el.innerHTML = `<h4>⛴ ${esc(q.n)}</h4>
      <div class="status">${q.l.map(esc).join(" · ")}</div>
      <div class="ftdir">${["I dag", "I morgen", "Overmorgen"].map((t, i) => `<button type="button" class="chip" data-day="${i}" aria-pressed="${day === i}">${t}</button>`).join("")}
        <input type="date" class="ftdate" value="${ymd(base)}" aria-label="Velg dato"></div>
      <div class="ftbody"><div class="status">Henter avganger fra Entur …</div></div>
      <a href="https://entur.no" target="_blank" rel="noopener">Åpne i Entur ↗</a>`;
    el.querySelectorAll("[data-day]").forEach(b => b.onclick = e => { e.stopPropagation(); day = +b.dataset.day; draw() });
    el.querySelector(".ftdate").onchange = e => { const v = e.target.value; if (!v) return; const t = new Date(v + "T00:00:00"), t0 = new Date(); t0.setHours(0, 0, 0, 0); day = Math.round((t - t0) / 864e5); draw() };
    const body = el.querySelector(".ftbody");
    try {
      const end = base.getTime() + 864e5;
      const d = await entur(`query($id:String!,$t:DateTime!){ stopPlace(id:$id){ estimatedCalls(startTime:$t, timeRange:${Math.ceil((end - start) / 1000)}, numberOfDepartures:120, whiteListedModes:[water]){ expectedDepartureTime aimedDepartureTime cancellation realtime destinationDisplay{frontText} serviceJourney{ line{ name transportSubmode } } } } }`, { id: q.id, t: start.toISOString() });
      const rows = (d.stopPlace ? d.stopPlace.estimatedCalls : []).filter(c => new Date(c.expectedDepartureTime).getTime() < end && !/Bergen\s*-\s*Kirkenes/i.test(c.serviceJourney.line.name));
      body.innerHTML = rows.length ? `<table class="fttab"><thead><tr><th>Avgang</th><th>Til</th></tr></thead><tbody>${rows.map(c => {
        const late = c.realtime && c.expectedDepartureTime !== c.aimedDepartureTime;
        return `<tr class="${c.cancellation ? "cx" : ""}"><td>${hhmm(c.expectedDepartureTime)}${late ? ` <span class="mut">(rute ${hhmm(c.aimedDepartureTime)})</span>` : ""}</td><td>${esc(c.destinationDisplay.frontText)}${c.cancellation ? " (innstilt)" : ""}</td></tr>`;
      }).join("")}</tbody></table>` : `<div class="status">${day === 0 ? "Ingen flere avganger i dag." : "Fant ingen avganger denne dagen."}</div>`;
    } catch (e) { body.innerHTML = `<div class="status">Kunne ikke hente avganger: ${esc(e.message)}</div>` }
  };
  draw();
  return el;
}

function draw(map) {
  if (!layer) layer = L.layerGroup();
  layer.clearLayers();
  quays.forEach(q => {
    L.marker([q.a, q.o], { icon: L.divIcon({ className: "", html: `<div class="ferryicon quay"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M5 15h14l-2.2 4.2c-.2.5-.7.8-1.2.8H8.4c-.5 0-1-.3-1.2-.8L5 15zm3-6h8l1.5 5h-11L8 9zm2.5-4h3v3h-3V5z"/></svg></div>`, iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: -200, keyboard: false })
      .bindTooltip(`${esc(q.n)} · klikk for fergetider`, { direction: "top" })
      .bindPopup(() => popup(q), { maxWidth: 320, minWidth: 270, autoPanPadding: [20, 60] })
      .on("popupopen", function () { this.closeTooltip() })
      .addTo(layer);
  });
  if (store.get(ON, true)) layer.addTo(map);
}
function sizeByZoom(map) { map.getContainer().classList.toggle("quays-far", map.getZoom() < 7) }

async function init() {
  const map = window.KK && window.KK.map;
  if (!map) return setTimeout(init, 400);
  const tools = document.querySelector(".maptools");
  const btn = document.createElement("button");
  btn.className = "tool"; btn.id = "tFerry";
  btn.dataset.order = 10;
  const after = [...tools.children].find(x => +(x.dataset.order || 0) > 10);
  after ? tools.insertBefore(btn, after) : tools.appendChild(btn);
  const sync = on => {
    btn.setAttribute("aria-pressed", String(on));
    btn.innerHTML = `${SVG}Fergeleier<span class="tstate">${on ? "Vises" : "Skjult"}</span>`;
    btn.title = on ? "Skjul fergeleiene fra kartet" : "Vis fergeleiene i kartet";
  };
  sync(store.get(ON, true));
  btn.onclick = () => {
    const on = btn.getAttribute("aria-pressed") !== "true";
    sync(on); store.set(ON, on);
    if (layer) on ? layer.addTo(map) : (map.closePopup(), layer.remove());
  };
  map.on("zoomend", () => sizeByZoom(map)); sizeByZoom(map);
  const lg = document.querySelector(".legend");
  map.on("popupopen", () => lg && lg.classList.add("hidepop"));
  map.on("popupclose", () => lg && lg.classList.remove("hidepop"));
  try { quays = await loadQuays(); draw(map) }
  catch (e) { btn.title = "Kunne ikke hente fergeleier: " + e.message }
}
init();
window.KKFerry = { get quays() { return quays }, async reload() { localStorage.removeItem(CACHE); quays = await loadQuays(); draw(window.KK.map) } };
})();
