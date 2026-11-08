/* Lunsjstopp: bakerier, bensinstasjoner, matbutikker, kafeer og gatekjøkken fra OpenStreetMap (Overpass).
   Hentes for kartutsnittet når du har zoomet inn, av/på med knappen under Ladestasjoner. */
(function () {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
const ON = "kk_lunsj_on", MINZ = 10;
const TYPES = {
  bakeri: { e: "🥐", l: "Bakeri" },
  bensin: { e: "⛽", l: "Bensinstasjon" },
  butikk: { e: "🛒", l: "Matbutikk" },
  kiosk: { e: "🥪", l: "Kiosk / nærbutikk" },
  kafe: { e: "☕", l: "Kafé" },
  gatekjokken: { e: "🍔", l: "Gatekjøkken" }
};
function typeOf(t) {
  if (t.shop === "bakery" || t.amenity === "bakery") return "bakeri";
  if (t.amenity === "fuel") return (t.automated === "yes" || t.self_service === "only" || /automat/i.test(t.name || "")) ? null : "bensin";
  if (t.shop === "supermarket") return "butikk";
  if (t.shop === "convenience") return "kiosk";
  if (t.amenity === "cafe") return "kafe";
  if (t.amenity === "fast_food") return "gatekjokken";
  return null;
}
const SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M7 2v8a2 2 0 0 0 2 2v10h2V12a2 2 0 0 0 2-2V2h-1.5v6h-1V2h-1v6h-1V2H7zm10 0c-1.7 0-3 2-3 5v6h2v9h2V2h-1z"/></svg>';

let map, layer, btn, places = new Map(), done = [], busy = false, timer = null;
const placeTool = (b, order) => {
  b.dataset.order = order;
  const tools = document.querySelector(".maptools");
  const after = [...tools.children].find(x => +(x.dataset.order || 0) > order);
  after ? tools.insertBefore(b, after) : tools.appendChild(b);
};
const isOn = () => btn.getAttribute("aria-pressed") === "true";
function sync(msg) {
  const on = isOn();
  const lg = document.querySelector(".lglunch"); if (lg) lg.hidden = !on;
  btn.innerHTML = `${SVG}Lunsjstopp<span class="tstate">${!on ? "Skjult" : msg || (map.getZoom() < MINZ ? "Zoom inn" : "Vises")}</span>`;
  btn.title = on ? "Skjul lunsjstopp" : "Vis bakerier, bensinstasjoner, matbutikker og gatekjøkken";
}
const covered = b => done.some(d => d.contains(b));
async function fetchView() {
  if (!isOn() || map.getZoom() < MINZ || busy) return draw();
  const view = map.getBounds();
  if (covered(view)) return draw();
  const b = view.pad(.4), bb = `${b.getSouth().toFixed(4)},${b.getWest().toFixed(4)},${b.getNorth().toFixed(4)},${b.getEast().toFixed(4)}`;
  const q = `[out:json][timeout:25];(nwr["shop"~"^(bakery|supermarket|convenience)$"](${bb});nwr["amenity"~"^(fuel|cafe|fast_food)$"](${bb}););out center tags 600;`;
  busy = true; sync("Henter …");
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    if (!r.ok) throw new Error("Overpass svarte " + r.status);
    const j = await r.json();
    j.elements.forEach(e => {
      const t = e.tags || {}, ty = typeOf(t), lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
      if (!ty || lat == null) return;
      places.set(e.type + e.id, { ty, lat, lon, n: t.name || t.brand || TYPES[ty].l, brand: t.brand || "", oh: t.opening_hours || "", adr: [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" "), ps: t["addr:city"] || "" });
    });
    done.push(b); busy = false; sync();
  } catch (e) { busy = false; sync("Feil"); btn.title = "Kunne ikke hente lunsjstopp: " + e.message }
  draw();
}
function draw() {
  layer.clearLayers();
  if (!isOn() || map.getZoom() < MINZ) return;
  const v = map.getBounds().pad(.2);
  places.forEach(p => {
    if (!v.contains([p.lat, p.lon])) return;
    const T = TYPES[p.ty], q = encodeURIComponent([p.n, p.adr, p.ps].filter(Boolean).join(", ") || `${p.lat},${p.lon}`);
    L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<div class="lunchicon ${p.ty}">${T.e}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: -400, keyboard: false })
      .bindTooltip(`${esc(p.n)} · ${T.l}`, { direction: "top" })
      .bindPopup(`<div class="pop"><h4>${T.e} ${esc(p.n)}</h4>${esc(T.l)}${p.brand && p.brand !== p.n ? ` · ${esc(p.brand)}` : ""}${p.adr ? `<br>${esc(p.adr)}${p.ps ? ", " + esc(p.ps) : ""}` : ""}
        ${p.oh ? `<br><span class="mut">Åpningstider: ${esc(p.oh)}</span>` : `<br><span class="mut">Åpningstider ikke oppgitt</span>`}
        <br><a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Åpne i Google Maps ↗</a></div>`, { maxWidth: 260 })
      .addTo(layer);
  });
}
function init() {
  map = window.KK && window.KK.map;
  if (!map) return setTimeout(init, 400);
  layer = L.layerGroup().addTo(map);
  btn = document.createElement("button"); btn.className = "tool"; btn.id = "tLunch";
  btn.setAttribute("aria-pressed", String(store.get(ON, false)));
  placeTool(btn, 30); sync();
  btn.onclick = () => { const on = !isOn(); btn.setAttribute("aria-pressed", String(on)); store.set(ON, on); sync(); if (!on) map.closePopup(); fetchView() };
  map.on("moveend zoomend", () => { sync(); clearTimeout(timer); timer = setTimeout(fetchView, 500) });
  fetchView();
}
init();
})();
