/* Kundekart Nord – Lindab. Innlogging via Supabase, kundedata beskyttet av RLS. */
(() => {
const CFG = window.KK_CONFIG || {};
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "kk-auth" }
});

const REG_ORDER = ["Sør-Helgeland","Midt-Helgeland","Nord-Helgeland","Salten","Ofoten","Indre Lofoten","Ytre Lofoten","Vesterålen","Hålogaland","Indre Troms","Midt-Troms","Tromsøregionen","Nord-Troms","Vest-Finnmark","Midt-Finnmark","Indre Finnmark","Øst-Finnmark","Svalbard","Utenfor Nord-Norge"];
const FYLKE = r => /Helgeland|Salten|Ofoten|Lofoten|Vesterålen/.test(r) ? "Nordland" : /Finnmark/.test(r) ? "Finnmark" : (r === "Svalbard" || r === "Utenfor Nord-Norge") ? "Annet" : "Troms";

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch (e) { return false } }
};
const nf = new Intl.NumberFormat("nb-NO");
const kr = v => nf.format(Math.round(v)) + " kr";
const krK = v => v >= 1e6 ? (v / 1e6).toLocaleString("nb-NO", { maximumFractionDigits: 1 }) + " mill." : nf.format(Math.round(v / 1000)) + " k";
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

let GEO = null;          // {kommuner, regmap, reglab, poststeder}
let RAW = [];            // kunder fra databasen
let RETT = {};           // kundenr -> rettelse
let ADR = {};            // kundenr -> besøksadresse (kunde_adresse)
let DATA = [];
let ME = null;           // {epost, navn, rolle}
let CHARGERS = store.get("kk_chargers", null);
const st = { q: "", reg: "", by: "", eier: "", kat: "", seg: new Set(), sort: store.get("kk_sort", "reg"), sel: null };

/* ---------------- innlogging ---------------- */
function showLogin(msg) {
  $("app").hidden = true; $("login").hidden = false;
  $("lErr").textContent = msg || "";
}
$("lForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("lBtn"); btn.disabled = true; btn.textContent = "Logger inn …"; $("lErr").textContent = "";
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim().toLowerCase(), password: $("lPass").value });
  btn.disabled = false; btn.textContent = "Logg inn";
  if (error) { $("lErr").textContent = /invalid/i.test(error.message) ? "Feil e-post eller passord." : "Innloggingen feilet: " + error.message; return }
  $("lPass").value = "";
  start();
});
$("logout").onclick = async () => { await sb.auth.signOut(); RAW = []; DATA = []; showLogin("Du er logget ut.") };

/* bytt passord */
$("pwBtn").onclick = () => { $("pwDlg").hidden = false; $("pwNew").focus() };
$("pwCancel").onclick = () => { $("pwDlg").hidden = true; $("pwMsg").textContent = "" };
$("pwForm").addEventListener("submit", async e => {
  e.preventDefault();
  const a = $("pwNew").value, b = $("pwNew2").value;
  if (a.length < 8) { $("pwMsg").textContent = "Passordet må ha minst 8 tegn."; return }
  if (a !== b) { $("pwMsg").textContent = "Passordene er ikke like."; return }
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) { $("pwMsg").textContent = "Kunne ikke bytte passord: " + error.message; return }
  $("pwMsg").textContent = "Passordet er byttet.";
  $("pwNew").value = $("pwNew2").value = "";
  setTimeout(() => { $("pwDlg").hidden = true; $("pwMsg").textContent = "" }, 1200);
});

async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showLogin(); return }
  $("login").hidden = true; $("app").hidden = false;
  $("lstatus").textContent = "Henter kunder …"; $("lstatus").hidden = false;
  try {
    if (!GEO) {
      const [kommuner, regmap, reglab, poststeder] = await Promise.all(
        ["kommuner", "regmap", "reglab", "poststeder"].map(f => fetch(`data/${f}.json`).then(r => r.json())));
      GEO = { kommuner, regmap, reglab, poststeder };
    }
    const [me, k, r, a] = await Promise.all([
      sb.from("tilgang").select("epost,navn,rolle").maybeSingle(),
      sb.from("kunder").select("*"),
      sb.from("sted_rettelse").select("*"),
      sb.from("kunde_adresse").select("*")
    ]);
    if (k.error) throw k.error;
    ME = me.data;
    if (!ME) {
      $("lstatus").hidden = true;
      await sb.auth.signOut();
      showLogin("Brukeren din har ikke tilgang til kundekartet. Kontakt Jørn Winge.");
      return;
    }
    $("who").textContent = ME.navn;
    RAW = k.data.map(fromDb);
    RETT = {}; (r.data || []).forEach(x => RETT[x.kundenr] = x);
    ADR = {}; (a.data || []).forEach(x => ADR[x.kundenr] = x);
    $("tAdr").hidden = !(ME.rolle === "admin" || ME.rolle === "leder");
    $("lstatus").hidden = true;
    initMap();
    refreshData(true);
  } catch (err) {
    $("lstatus").textContent = "Kunne ikke hente kundene: " + (err.message || err) + ". Last siden på nytt.";
  }
}
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") showLogin() });

function fromDb(c) {
  return { k: c.kundenr, n: c.navn, kat: c.kategori, e: c.eier, v: +c.oms_ventilasjon || 0, p: +c.oms_profil || 0, t: +c.oms_total || 0, s: c.segment,
    ps: c.poststed || "", src: c.poststed_kilde || "", kom: c.kommune || "", r: c.region || "", lat: c.lat, lon: c.lon, pr: c.presisjon || "",
    adr: c.besoksadresse || "", pnr: c.postnr || "", br: c.bransje || "", st: c.status || "" };
}
function applyFix(c) {
  const a = ADR[c.k];
  if (a && a.lat != null) return Object.assign({}, c, { adr: a.adresse, pnr: a.postnr || "", ps: a.poststed || c.ps, lat: a.lat, lon: a.lon, r: a.region || c.r, pr: "adresse", orgnr: a.orgnr, akilde: a.kilde, asikk: a.sikkerhet });
  if (a) c = Object.assign({}, c, { adr: a.adresse, pnr: a.postnr || "", orgnr: a.orgnr, akilde: a.kilde, asikk: a.sikkerhet });
  const f = RETT[c.k];
  return f ? Object.assign({}, c, { ps: f.poststed, lat: f.lat, lon: f.lon, r: f.region || c.r, pr: "rettet", rettAv: f.endret_av }) : c;
}

/* ---------------- filtre og liste ---------------- */
function opts(sel, values, all, counts) {
  sel.innerHTML = `<option value="">${all}</option>` + values.map(v => {
    if (v && v.group) return `<optgroup label="${esc(v.group)}">` + v.items.map(i => `<option value="${esc(i)}">${esc(i)} (${counts[i] || 0})</option>`).join("") + `</optgroup>`;
    return `<option value="${esc(v)}">${esc(v)}${counts ? ` (${counts[v] || 0})` : ""}</option>`
  }).join("");
}
function count(key) { const m = {}; DATA.forEach(c => { const v = c[key] || ""; m[v] = (m[v] || 0) + 1 }); return m }
function buildFilters() {
  const rc = count("r");
  const groups = ["Nordland", "Troms", "Finnmark", "Annet"].map(g => ({ group: g, items: REG_ORDER.filter(r => FYLKE(r) === g && rc[r]) })).filter(g => g.items.length);
  opts($("fReg"), groups, "Alle regioner", rc);
  if (rc[""]) $("fReg").insertAdjacentHTML("beforeend", `<option value="__none">Mangler sted (${rc[""]})</option>`);
  const bc = count("ps");
  opts($("fBy"), Object.keys(bc).filter(Boolean).sort((a, b) => a.localeCompare(b, "nb")), "Alle steder", bc);
  opts($("fEier"), [...new Set(DATA.map(c => c.e).filter(Boolean))].sort(), "Alle eiere", count("e"));
  opts($("fKat"), [...new Set(DATA.map(c => c.kat).filter(Boolean))].sort(), "Begge kategorier", count("kat"));
  $("fSeg").innerHTML = `<span class="seglbl">Segment</span>` +
    ["A", "B", "C", "D"].map(s => `<button type="button" class="chip" data-seg="${s}" aria-pressed="${st.seg.has(s)}"><span class="dot" style="background:var(--seg${s})"></span>${s}</button>`).join("");
  syncFromState();
}
function syncFromState() { $("q").value = st.q; $("fReg").value = st.reg; $("fBy").value = st.by; $("fEier").value = st.eier; $("fKat").value = st.kat; $("sort").value = st.sort }
function filtered() {
  const q = st.q.trim().toLowerCase();
  return DATA.filter(c => {
    if (q && !(c.n.toLowerCase().includes(q) || c.k.includes(q) || c.ps.toLowerCase().includes(q) || c.kom.toLowerCase().includes(q) || c.br.toLowerCase().includes(q))) return false;
    if (st.reg === "__none") { if (c.r) return false } else if (st.reg && c.r !== st.reg) return false;
    if (st.by && c.ps !== st.by) return false;
    if (st.eier && c.e !== st.eier) return false;
    if (st.kat && c.kat !== st.kat) return false;
    if (st.seg.size && !st.seg.has(c.s)) return false;
    return true;
  });
}
function sorted(arr) {
  const a = arr.slice(), ro = r => { const i = REG_ORDER.indexOf(r); return i < 0 ? 99 : i };
  if (st.sort === "tot") a.sort((x, y) => y.t - x.t);
  else if (st.sort === "navn") a.sort((x, y) => x.n.localeCompare(y.n, "nb"));
  else if (st.sort === "by") a.sort((x, y) => (x.ps || "~").localeCompare(y.ps || "~", "nb") || y.t - x.t);
  else a.sort((x, y) => ro(x.r || "~") - ro(y.r || "~") || x.ps.localeCompare(y.ps, "nb") || y.t - x.t);
  return a;
}
function rowHtml(c) {
  const where = [c.ps, c.r && c.r !== c.ps ? c.r : ""].filter(Boolean).join(" · ");
  return `<button type="button" class="row${st.sel === c.k ? " sel" : ""}" data-k="${esc(c.k)}">
    <span class="seg ${esc(c.s)}" title="Segment ${esc(c.s)}">${esc(c.s)}</span>
    <span class="nm">${esc(c.n)}</span>
    <span class="amt">${krK(c.t)}<small>${esc(c.k)}</small></span>
    <span class="meta"><span class="kat ${esc(c.kat)}"></span>${esc(c.kat)} · ${esc(c.e)}${where ? " · " + esc(where) : ""}${c.lat == null ? '<span class="nopin">mangler sted</span>' : ""}</span>
  </button>`;
}
function renderList(arr) {
  const L = $("list");
  if (!arr.length) { L.innerHTML = `<div class="empty">Ingen kunder passer filtrene. Prøv et annet søk eller trykk Nullstill.</div>`; return }
  let html = "";
  const groupKey = st.sort === "reg" ? c => c.r || "Mangler sted" : st.sort === "by" ? c => c.ps || "Mangler sted" : null;
  if (groupKey) {
    let cur = null, buf = [];
    const flush = () => { if (cur !== null) { const sum = buf.reduce((s, c) => s + c.t, 0); html += `<div class="grp"><span>${esc(cur)}</span><span>${buf.length} · ${krK(sum)}</span></div>` + buf.map(rowHtml).join("") } };
    arr.forEach(c => { const g = groupKey(c); if (g !== cur) { flush(); cur = g; buf = [] } buf.push(c) }); flush();
  } else html = arr.map(rowHtml).join("");
  L.innerHTML = html;
}

/* ---------------- kart ---------------- */
let map, tiles, komLayer, custLayer, chargeLayer, labelLayer, lastBounds = null, tileFails = 0;
function initMap() {
  if (map) return;
  map = L.map("map", { zoomSnap: .25, preferCanvas: true, minZoom: 4, zoomControl: false }).setView([68.6, 18], 5.5);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  tiles = L.tileLayer("https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/{z}/{y}/{x}.png",
    { maxZoom: 18, attribution: '© <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>' }).addTo(map);
  tiles.on("tileerror", () => {
    if (++tileFails === 6) {
      tiles.remove();
      tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 18, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(map);
      tiles.bringToBack();
    }
  });
  custLayer = L.layerGroup().addTo(map); chargeLayer = L.layerGroup(); labelLayer = L.layerGroup();
  komLayer = L.geoJSON(GEO.kommuner, {
    style: komStyle,
    onEachFeature: (f, l) => l.bindTooltip(`${f.properties.kommunenavn} · ${GEO.regmap[f.properties.kommunenummer] || ""}`, { sticky: true, direction: "top", opacity: .9 })
  }).addTo(map);
  Object.entries(GEO.reglab).forEach(([r, [la, lo]]) => L.marker([la, lo], { interactive: false, icon: L.divIcon({ className: "rlabel", html: esc(r), iconSize: null }) }).addTo(labelLayer));
  const syncLabels = () => { const z = map.getZoom(); if (z >= 6 && z < 9) labelLayer.addTo(map); else labelLayer.remove() };
  map.on("zoomend", syncLabels); syncLabels();
  map.on("popupopen", e => e.popup.getElement().querySelectorAll("button[data-k]").forEach(b => b.onclick = () => { map.closePopup(); select(b.dataset.k, false) }));
  window.addEventListener("resize", () => map.invalidateSize());
}
function komStyle(f) {
  const hit = st.reg && GEO.regmap[f.properties.kommunenummer] === st.reg;
  return { color: css("--kom-line"), weight: hit ? 1.2 : .6, fillColor: css("--accent"), fillOpacity: hit ? .12 : 0 };
}
function renderMap(arr, fit) {
  custLayer.clearLayers();
  const groups = new Map();
  arr.forEach(c => { if (c.lat == null) return; const key = (+c.lat).toFixed(4) + "," + (+c.lon).toFixed(4); (groups.get(key) || groups.set(key, []).get(key)).push(c) });
  const pts = [];
  groups.forEach(list => {
    const c0 = list[0], ll = [c0.lat, c0.lon]; pts.push(ll);
    let m;
    if (list.length === 1) {
      m = L.circleMarker(ll, { radius: { A: 10, B: 8.5, C: 7, D: 5.5 }[c0.s] || 6, color: "#fff", weight: 1.5, fillColor: css(c0.kat === "Profil" ? "--profil" : "--vent"), fillOpacity: .95 });
      m.bindTooltip(`${esc(c0.n)} · ${krK(c0.t)}`, { direction: "top" });
      m.on("click", () => select(c0.k, false));
    } else {
      const sz = Math.min(44, 20 + Math.sqrt(list.length) * 4);
      m = L.marker(ll, { icon: L.divIcon({ className: "", html: `<div class="stackicon" style="width:${sz}px;height:${sz}px">${list.length}</div>`, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] }) });
      const s = list.slice().sort((a, b) => b.t - a.t);
      m.bindPopup(`<div class="pop"><h4>${esc(c0.ps)} · ${list.length} kunder</h4>${s.map(c => `<button type="button" data-k="${esc(c.k)}"><span class="kat ${esc(c.kat)}"></span>${esc(c.n)} <span class="mut">· ${esc(c.s)} · ${krK(c.t)}</span></button>`).join("")}</div>`, { maxWidth: 300 });
    }
    m.addTo(custLayer);
  });
  $("sPin").textContent = nf.format(arr.filter(c => c.lat != null).length);
  if (fit && pts.length) {
    const np = pts.filter(p => p[0] > 64.5 && p[0] < 72);
    const b = L.latLngBounds(np.length && st.reg !== "Utenfor Nord-Norge" && st.reg !== "Svalbard" ? np : pts);
    lastBounds = [b.pad(.2), pts.length === 1 ? 12 : 11];
    if (map.getSize().x > 0) map.fitBounds(lastBounds[0], { maxZoom: lastBounds[1] });
  }
  komLayer.setStyle(komStyle);
}

/* ---------------- detaljer ---------------- */
function hav(a, b, c, d) { const R = 6371, t = x => x * Math.PI / 180, dl = t(c - a), dn = t(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
function select(k, pan = true) {
  st.sel = k; const c = DATA.find(x => x.k === k); if (!c) return;
  document.querySelectorAll(".row.sel").forEach(r => r.classList.remove("sel"));
  const r = document.querySelector(`.row[data-k="${CSS.escape(k)}"]`); if (r) r.classList.add("sel");
  const share = c.t ? Math.round(c.p / c.t * 100) : 0;
  const q = encodeURIComponent([c.n, c.adr, c.ps].filter(Boolean).join(", "));
  let near = "";
  if (CHARGERS && c.lat != null) {
    const n = CHARGERS.list.map(s => [hav(c.lat, c.lon, s[0], s[1]), s]).sort((a, b) => a[0] - b[0]).slice(0, 3);
    near = `<div class="sub">Nærmeste ladestasjoner</div><div class="chg">${n.map(([d, s]) => `<div><span>${esc(s[2])}${s[4] ? ` · ${s[4]} kW` : ""}</span><span>${d < 1 ? "<1" : d.toFixed(d < 10 ? 1 : 0)} km</span></div>`).join("")}</div>`;
  }
  const rett = RETT[c.k];
  $("detail").innerHTML = `<button type="button" class="x" id="dx" aria-label="Lukk">×</button>
    <h2>${esc(c.n)}</h2>
    <dl class="kv">
      <dt>Kundenr.</dt><dd>${esc(c.k)}</dd>
      <dt>Sted</dt><dd>${c.ps ? esc(c.ps) + (c.kom && c.kom !== c.ps ? `, ${esc(c.kom)} kommune` : "") : "<em>Ikke oppgitt</em>"}</dd>
      ${c.adr ? `<dt>Besøksadr.</dt><dd>${esc(c.adr)}${c.pnr ? `, ${esc(c.pnr)}` : ""}</dd>` : ""}
      <dt>Region</dt><dd>${esc(c.r || "–")}</dd>
      <dt>Eier</dt><dd><span class="kat ${esc(c.kat)}"></span>${esc(c.e)} (${esc(c.kat)})</dd>
      ${c.br ? `<dt>Bransje</dt><dd>${esc(c.br.replace(/;/g, ", "))}</dd>` : ""}
      ${c.st ? `<dt>Status</dt><dd>${esc(c.st)}</dd>` : ""}
      <dt>Segment</dt><dd>${esc(c.s)}</dd>
      <dt>Omsetning</dt><dd><b>${kr(c.t)}</b></dd>
    </dl>
    <div><div class="bar" title="Profil ${share} %"><span style="width:${share}%"></span><span style="width:${100 - share}%"></span></div>
      <div class="barlbl"><span>Profil ${kr(c.p)}</span><span>Ventilasjon ${kr(c.v)}</span></div></div>
    ${c.lat == null ? `<div class="box warn">Kunden mangler sted og vises ikke i kartet. Legg inn poststed under, så ser alle kunden i kartet.</div>` :
      rett ? `<div class="box warn">Sted satt av ${esc(rett.endret_av)}. Plassert midt i ${esc(c.ps)}.</div>` :
      c.pr === "adresse" ? `<div class="status">Adresse fra ${esc(c.akilde || "register")}${c.orgnr ? `, org.nr. ${esc(c.orgnr)}` : ""}${c.asikk && c.asikk !== "høy" ? ` · sikkerhet ${esc(c.asikk)}` : ""}.</div>` :
      c.pr !== "postnr" ? `<div class="box warn">Plassert midt i ${esc(c.ps)}. Nøyaktig plassering krever besøksadresse.</div>` : ""}
    ${(ME.rolle === "admin" || ME.rolle === "leder") ? `<form id="adrForm" class="fixrow">
      <label class="f">Besøksadresse
        <input id="adrIn" placeholder="Gate 1, 9008 Tromsø" value="${esc(c.adr ? c.adr + (c.pnr ? ", " + c.pnr : "") + (c.ps ? " " + c.ps : "") : "")}" autocomplete="off">
      </label>
      <button class="btn" type="submit">Lagre</button>
    </form><div class="status" id="adrMsg"></div>` : ""}
    <form id="fixForm" class="fixrow">
      <label class="f">Sett eller endre poststed
        <input id="fixIn" list="psList" placeholder="Skriv poststed" value="${esc(rett ? rett.poststed : "")}" autocomplete="off">
      </label>
      <button class="btn" type="submit">Lagre</button>
    </form>
    <div class="status" id="fixMsg"></div>
    <div class="acts">
      <a class="btn pri" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Åpne i Google Maps ↗</a>
      ${c.lat != null ? `<button type="button" class="btn" id="dZoom">Vis i kart</button>` : ""}
      ${rett ? `<button type="button" class="btn" id="dUnfix">Fjern rettelse</button>` : ""}
    </div>
    ${near}`;
  $("detail").hidden = false;
  $("dx").onclick = () => { $("detail").hidden = true; st.sel = null; document.querySelectorAll(".row.sel").forEach(r => r.classList.remove("sel")) };
  if ($("dZoom")) $("dZoom").onclick = () => { showMap(); map.setView([c.lat, c.lon], Math.max(map.getZoom(), 12)) };
  if ($("dUnfix")) $("dUnfix").onclick = async () => {
    const { error } = await sb.from("sted_rettelse").delete().eq("kundenr", c.k);
    if (error) { $("fixMsg").textContent = "Kunne ikke fjerne: " + error.message; return }
    delete RETT[c.k]; refreshData(false); select(k, false);
  };
  if ($("adrForm")) $("adrForm").onsubmit = async e => {
    e.preventDefault();
    const v = $("adrIn").value.trim(); if (!v) return;
    $("adrMsg").textContent = "Slår opp adressen hos Kartverket …";
    try {
      const g = await window.KKAdr.geocodeFree(v);
      if (!g) { $("adrMsg").textContent = "Fant ikke adressen hos Kartverket. Skriv gate, nummer og postnummer."; return }
      const row = { kundenr: c.k, adresse: g.adresse, postnr: g.postnr, poststed: g.poststed, kommunenr: g.kommunenr, region: GEO.regmap[g.kommunenr] || "Utenfor Nord-Norge", lat: g.lat, lon: g.lon, orgnr: c.orgnr || null, kilde: "Lagt inn manuelt", sikkerhet: "manuell" };
      const { data, error } = await sb.from("kunde_adresse").upsert(row).select().single();
      if (error) { $("adrMsg").textContent = "Kunne ikke lagre: " + error.message; return }
      ADR[c.k] = data; refreshData(false); select(k, false);
    } catch (err) { $("adrMsg").textContent = "Oppslaget feilet: " + err.message }
  };
  $("fixForm").onsubmit = async e => {
    e.preventDefault();
    const v = $("fixIn").value.trim();
    const hit = Object.keys(GEO.poststeder).find(p => p.toLowerCase() === v.toLowerCase());
    if (!hit) { $("fixMsg").textContent = "Fant ikke poststedet i Nord-Norge. Velg et sted fra lista."; return }
    const [lat, lon, region] = GEO.poststeder[hit];
    $("fixMsg").textContent = "Lagrer …";
    const { data, error } = await sb.from("sted_rettelse").upsert({ kundenr: c.k, poststed: hit, lat, lon, region }).select().single();
    if (error) { $("fixMsg").textContent = "Kunne ikke lagre: " + error.message; return }
    RETT[c.k] = data; refreshData(false); select(k, false);
  };
  if (pan && c.lat != null && window.innerWidth > 760) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 10));
}
function refreshData(fit) { DATA = RAW.map(applyFix); buildFilters(); render(fit) }

/* ---------------- ladestasjoner (NOBIL-fil) ---------------- */
function parseNobil(json) {
  const out = [];
  const arr = Array.isArray(json) ? json : json.chargerstations || json.stations || json.data || [];
  arr.forEach(s => {
    let lat, lon, name, owner, pts, addr, kw = 0;
    if (s.csmd) {
      const m = String(s.csmd.Position || "").match(/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/); if (!m) return;
      lat = +m[1]; lon = +m[2]; name = s.csmd.name; owner = s.csmd.Owned_by || s.csmd.Operator || ""; pts = +s.csmd.Number_charging_points || 0;
      addr = [s.csmd.Street, s.csmd.House_number].filter(Boolean).join(" ") + (s.csmd.City ? ", " + s.csmd.City : "");
      const conn = s.attr && s.attr.conn || {};
      Object.values(conn).forEach(c => Object.values(c).forEach(a => {
        const t = String(a.trans || a.attrval || "");
        const k = t.match(/(\d+[.,]?\d*)\s*kW/i);
        if (k) kw = Math.max(kw, parseFloat(k[1].replace(",", ".")));
        else { const v = t.match(/(\d{3})\s*V/i), i = t.match(/(\d+)\s*A/i); if (v && i) kw = Math.max(kw, Math.round(+v[1] * +i[1] * (/3-?phase|3-fas/i.test(t) ? 1.732 : 1) / 1000)) }
      }));
    } else {
      lat = +(s.lat ?? s.latitude); lon = +(s.lon ?? s.lng ?? s.longitude); name = s.name || s.navn; owner = s.owner || s.operator || ""; pts = +(s.points || 0); addr = s.address || ""; kw = +(s.max_kw || s.kw || 0);
    }
    if (!isFinite(lat) || !isFinite(lon) || lat < 64.5) return;
    out.push([+lat.toFixed(5), +lon.toFixed(5), String(name || "Ladestasjon"), String(owner), Math.round(kw) || 0, pts || 0, addr || ""]);
  });
  return out;
}
function drawChargers() {
  chargeLayer.clearLayers(); if (!CHARGERS) return;
  const fast = $("cFast") && $("cFast").checked;
  CHARGERS.list.forEach(s => {
    if (fast && s[4] < 50) return;
    L.circleMarker([s[0], s[1]], { radius: s[4] >= 50 ? 5 : 3.5, color: "#fff", weight: 1, fillColor: css("--charge"), fillOpacity: 1 })
      .bindPopup(`<div class="pop"><h4>⚡ ${esc(s[2])}</h4>${esc(s[3])}<br>${s[4] ? `Inntil ${s[4]} kW · ` : ""}${s[5] ? `${s[5]} ladepunkt` : ""}<br><span class="mut">${esc(s[6])}</span></div>`).addTo(chargeLayer);
  });
}
function chargePanel() {
  const P = $("cpanel");
  const when = CHARGERS ? new Date(CHARGERS.ts).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" }) : "";
  P.innerHTML = `<button type="button" class="x" id="cx" aria-label="Lukk">×</button>
  <h3>Ladestasjoner fra NOBIL</h3>
  ${CHARGERS ? `<div class="status">${nf.format(CHARGERS.list.length)} stasjoner i Nord-Norge, lastet inn ${when}.</div>
    <label class="chk"><input type="checkbox" id="cFast"> Bare hurtigladere (50 kW og mer)</label>
    <div class="acts"><button type="button" class="btn" id="cOff">Skjul fra kartet</button><button type="button" class="btn" id="cClear">Fjern lagrede data</button></div>
    <div class="sub">Oppdatere data</div>` :
    `<div>Kartet viser ladestasjoner når du har lastet inn et uttrekk fra NOBIL. Uttrekket lagres i denne nettleseren. Automatisk henting kommer når Lindab har fått API-nøkkel.</div>`}
  <div class="drop" id="cdrop" tabindex="0" role="button">Slipp NOBIL-fil (.json) her, eller klikk for å velge</div>
  <input type="file" id="cfile" accept=".json,application/json" hidden>
  <div class="status" id="cstat"></div>
  <div class="status">Ladedata: NOBIL / Enova, CC BY 4.0.</div>`;
  P.hidden = false;
  $("cx").onclick = () => P.hidden = true;
  const D = $("cdrop"), F = $("cfile");
  D.onclick = () => F.click(); D.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); F.click() } };
  D.ondragover = e => { e.preventDefault(); D.classList.add("on") }; D.ondragleave = () => D.classList.remove("on");
  D.ondrop = e => { e.preventDefault(); D.classList.remove("on"); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]) };
  F.onchange = () => F.files[0] && loadFile(F.files[0]);
  if ($("cFast")) $("cFast").onchange = drawChargers;
  if ($("cOff")) $("cOff").onclick = () => { chargeLayer.remove(); $("tCharge").setAttribute("aria-pressed", "false"); P.hidden = true };
  if ($("cClear")) $("cClear").onclick = () => { CHARGERS = null; try { localStorage.removeItem("kk_chargers") } catch (e) { } chargeLayer.clearLayers(); chargeLayer.remove(); $("tCharge").setAttribute("aria-pressed", "false"); chargePanel() };
}
function loadFile(file) {
  $("cstat").textContent = "Leser fila …";
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const list = parseNobil(JSON.parse(rd.result));
      if (!list.length) { $("cstat").textContent = "Fant ingen ladestasjoner i Nord-Norge i fila. Sjekk at det er en NOBIL-datadump i JSON-format."; return }
      CHARGERS = { ts: Date.now(), list };
      const saved = store.set("kk_chargers", CHARGERS);
      drawChargers(); chargeLayer.addTo(map); $("tCharge").setAttribute("aria-pressed", "true"); chargePanel();
      if (!saved) $("cstat").textContent = "Lastet inn, men nettleseren lot ikke appen lagre dataene. De forsvinner når siden lukkes.";
      if (st.sel) select(st.sel, false);
    } catch (e) { $("cstat").textContent = "Fila kunne ikke leses som JSON. Last ned datadumpen på nytt i JSON-format." }
  };
  rd.readAsText(file);
}
$("tCharge").onclick = () => {
  const on = $("tCharge").getAttribute("aria-pressed") === "true";
  if (on) { chargeLayer.remove(); $("tCharge").setAttribute("aria-pressed", "false"); $("cpanel").hidden = true; return }
  if (CHARGERS) { drawChargers(); chargeLayer.addTo(map); $("tCharge").setAttribute("aria-pressed", "true") }
  chargePanel();
};

/* ---------------- lim ---------------- */
function render(fit) {
  const arr = sorted(filtered());
  const tot = arr.reduce((s, c) => s + c.t, 0);
  $("sCount").textContent = nf.format(arr.length); $("sTot").textContent = krK(tot) + " kr";
  $("lCount").textContent = `${arr.length} av ${DATA.length} kunder`;
  renderList(arr); renderMap(arr, fit);
}
$("q").oninput = e => { st.q = e.target.value; render(false) };
$("fReg").onchange = e => { st.reg = e.target.value; st.by = ""; $("fBy").value = ""; render(true) };
$("fBy").onchange = e => { st.by = e.target.value; render(true) };
$("fEier").onchange = e => { st.eier = e.target.value; render(true) };
$("fKat").onchange = e => { st.kat = e.target.value; render(false) };
$("fSeg").onclick = e => { const b = e.target.closest("[data-seg]"); if (!b) return; const s = b.dataset.seg; st.seg.has(s) ? st.seg.delete(s) : st.seg.add(s); b.setAttribute("aria-pressed", st.seg.has(s)); render(false) };
$("sort").onchange = e => { st.sort = e.target.value; store.set("kk_sort", st.sort); render(false) };
$("reset").onclick = () => { Object.assign(st, { q: "", reg: "", by: "", eier: "", kat: "" }); st.seg.clear(); buildFilters(); render(true) };
$("list").onclick = e => { const r = e.target.closest(".row"); if (r) select(r.dataset.k) };
function showMap() {
  if (window.innerWidth <= 760) {
    $("main").dataset.view = "map"; $("vMap").setAttribute("aria-pressed", "true"); $("vList").setAttribute("aria-pressed", "false");
    setTimeout(() => { map.invalidateSize(); if (lastBounds && !st.sel) map.fitBounds(lastBounds[0], { maxZoom: lastBounds[1] }) }, 0);
  }
}
$("vMap").onclick = showMap;
$("vList").onclick = () => { $("main").dataset.view = "list"; $("vList").setAttribute("aria-pressed", "true"); $("vMap").setAttribute("aria-pressed", "false") };
const reTheme = () => { if (map && DATA.length) { render(false); drawChargers() } };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", reTheme);

window.KK = {
  sb, get RAW() { return RAW }, get GEO() { return GEO }, get ADR() { return ADR }, get ME() { return ME },
  setAdr(rows) { rows.forEach(x => ADR[x.kundenr] = x); refreshData(false) }
};
/* datalist med poststeder lastes når geodata er hentet */
const _start = start;
start = async function () {
  await _start();
  if (GEO && !$("psList")) document.body.insertAdjacentHTML("beforeend", `<datalist id="psList">${Object.keys(GEO.poststeder).sort((a, b) => a.localeCompare(b, "nb")).map(p => `<option value="${esc(p)}">`).join("")}</datalist>`);
};
start();
})();
