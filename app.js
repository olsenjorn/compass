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
const st = { q: "", reg: new Set(), by: new Set(), eier: new Set(), kat: new Set(), seg: new Set(), sort: store.get("kk_sort", "reg"), sel: null };

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
const FKEYS = { reg: { label: "Region", field: "r", none: "Mangler sted" }, by: { label: "By / poststed", field: "ps", none: "Mangler sted", search: true },
  eier: { label: "Eier", field: "e" }, kat: { label: "Kategori", field: "kat" } };
const NONE = "__none";
function loadFilters() {
  const f = store.get("kk_filters", null);
  ["reg", "by", "eier", "kat", "seg"].forEach(k => st[k] = new Set(f && Array.isArray(f[k]) ? f[k] : []));
}
function saveFilters() { store.set("kk_filters", { reg: [...st.reg], by: [...st.by], eier: [...st.eier], kat: [...st.kat], seg: [...st.seg] }) }
loadFilters();
function count(key) { const m = {}; DATA.forEach(c => { const v = c[key] || NONE; m[v] = (m[v] || 0) + 1 }); return m }
function optionsFor(k) {
  const def = FKEYS[k], cnt = count(def.field);
  let items;
  if (k === "reg") {
    items = [];
    ["Nordland", "Troms", "Finnmark", "Annet"].forEach(g => {
      const rs = REG_ORDER.filter(r => FYLKE(r) === g && cnt[r]);
      if (rs.length) { items.push({ group: g, values: rs }); rs.forEach(r => items.push({ value: r, label: r, n: cnt[r] })) }
    });
  } else {
    items = Object.keys(cnt).filter(v => v !== NONE).sort((a, b) => a.localeCompare(b, "nb")).map(v => ({ value: v, label: v, n: cnt[v] }));
  }
  if (cnt[NONE] && def.none) items.push({ value: NONE, label: def.none, n: cnt[NONE] });
  [...st[k]].forEach(v => { if (!items.some(i => i.value === v)) items.push({ value: v, label: v === NONE ? (def.none || "Tom") : v, n: 0 }) });
  return items;
}
function msButtonText(k) {
  const n = st[k].size, def = FKEYS[k];
  if (!n) return `<span class="msph">Alle</span>`;
  if (n === 1) { const v = [...st[k]][0]; return esc(v === NONE ? def.none : v) }
  return `${n} valgt`;
}
function buildFilters() {
  Object.keys(FKEYS).forEach(k => {
    const el = $("f" + k[0].toUpperCase() + k.slice(1));
    el.innerHTML = `<span class="mslbl">${FKEYS[k].label}</span>
      <button type="button" class="msbtn" aria-haspopup="true" aria-expanded="false" data-k="${k}">${msButtonText(k)}<span class="caret" aria-hidden="true">▾</span></button>
      <div class="mspop" hidden></div>`;
  });
  $("fSeg").innerHTML = `<span class="seglbl">Segment</span>` +
    ["A", "B", "C", "D"].map(s => `<button type="button" class="chip" data-seg="${s}" aria-pressed="${st.seg.has(s)}"><span class="dot" style="background:var(--seg${s})"></span>${s}</button>`).join("");
  syncFromState();
  renderActive();
}
function openPop(k) {
  closePops(k);
  const wrap = $("f" + k[0].toUpperCase() + k.slice(1)), pop = wrap.querySelector(".mspop"), btn = wrap.querySelector(".msbtn");
  if (!pop.hidden) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); return }
  const items = optionsFor(k);
  pop.innerHTML = `${FKEYS[k].search || items.length > 12 ? `<input type="search" class="mssearch" placeholder="Søk …" aria-label="Søk i ${FKEYS[k].label.toLowerCase()}">` : ""}
    <div class="mslist">${items.map(i => i.group
      ? `<button type="button" class="msgrp" data-group="${esc(i.group)}">${esc(i.group)}<span>Velg alle</span></button>`
      : `<label class="msopt" data-v="${esc(i.value)}"><input type="checkbox" value="${esc(i.value)}" ${st[k].has(i.value) ? "checked" : ""}><span>${esc(i.label)}</span><span class="n">${i.n}</span></label>`).join("")}</div>
    <div class="msfoot"><button type="button" class="linkbtn msclear">Fjern valg</button><button type="button" class="btn pri msdone">Ferdig</button></div>`;
  pop.hidden = false; btn.setAttribute("aria-expanded", "true");
  const S = pop.querySelector(".mssearch");
  if (S) { S.focus(); S.oninput = () => { const q = S.value.toLowerCase(); pop.querySelectorAll(".msopt").forEach(o => o.hidden = !o.textContent.toLowerCase().includes(q)); pop.querySelectorAll(".msgrp").forEach(g => g.hidden = !!q) } }
  pop.onchange = e => { const cb = e.target; if (cb.type !== "checkbox") return; cb.checked ? st[k].add(cb.value) : st[k].delete(cb.value); applyFilters(k) };
  pop.onclick = e => {
    const g = e.target.closest(".msgrp");
    if (g) {
      const vals = items.find(i => i.group === g.dataset.group).values;
      const all = vals.every(v => st[k].has(v));
      vals.forEach(v => all ? st[k].delete(v) : st[k].add(v));
      pop.querySelectorAll(".msopt input").forEach(cb => cb.checked = st[k].has(cb.value));
      applyFilters(k);
    }
    if (e.target.closest(".msclear")) { st[k].clear(); pop.querySelectorAll(".msopt input").forEach(cb => cb.checked = false); applyFilters(k) }
    if (e.target.closest(".msdone")) closePops();
  };
}
function closePops(except) {
  document.querySelectorAll(".ms").forEach(w => { if (except && w.id === "f" + except[0].toUpperCase() + except.slice(1)) return; const p = w.querySelector(".mspop"); if (p && !p.hidden) { p.hidden = true; w.querySelector(".msbtn").setAttribute("aria-expanded", "false") } });
}
function applyFilters(k) {
  saveFilters();
  if (k) { const w = $("f" + k[0].toUpperCase() + k.slice(1)); w.querySelector(".msbtn").innerHTML = msButtonText(k) + `<span class="caret" aria-hidden="true">▾</span>` }
  renderActive();
  render(true);
}
function renderActive() {
  const chips = [];
  Object.keys(FKEYS).forEach(k => [...st[k]].forEach(v => chips.push({ k, v, label: v === NONE ? FKEYS[k].none : v })));
  [...st.seg].sort().forEach(v => chips.push({ k: "seg", v, label: "Segment " + v }));
  if (st.q.trim()) chips.push({ k: "q", v: st.q, label: `«${st.q.trim()}»` });
  const A = $("activeF");
  A.hidden = !chips.length;
  A.innerHTML = chips.map(c => `<button type="button" class="achip" data-k="${c.k}" data-v="${esc(c.v)}" title="Fjern filter">${esc(c.label)}<span aria-hidden="true">×</span></button>`).join("") +
    (chips.length > 1 ? `<button type="button" class="linkbtn aclear">Fjern alle</button>` : "");
}
function syncFromState() { $("q").value = st.q; $("sort").value = st.sort }
function filtered() {
  const q = st.q.trim().toLowerCase();
  const inSet = (set, v) => !set.size || set.has(v || NONE);
  return DATA.filter(c => {
    if (q && !(c.n.toLowerCase().includes(q) || c.k.includes(q) || c.ps.toLowerCase().includes(q) || c.kom.toLowerCase().includes(q) || c.br.toLowerCase().includes(q) || (c.adr || "").toLowerCase().includes(q))) return false;
    return inSet(st.reg, c.r) && inSet(st.by, c.ps) && inSet(st.eier, c.e) && inSet(st.kat, c.kat) && inSet(st.seg, c.s);
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
  const hit = st.reg.size > 0 && st.reg.has(GEO.regmap[f.properties.kommunenummer]);
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
    const b = L.latLngBounds(np.length && !st.reg.has("Utenfor Nord-Norge") && !st.reg.has("Svalbard") ? np : pts);
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

/* ---------------- ladestasjoner (NOBIL via Edge Function) ---------------- */
function drawChargers() {
  chargeLayer.clearLayers(); if (!CHARGERS) return;
  const fast = store.get("kk_fast", false);
  CHARGERS.list.forEach(s => {
    if (fast && s[4] < 50) return;
    L.circleMarker([s[0], s[1]], { radius: s[4] >= 50 ? 5 : 3.5, color: "#fff", weight: 1, fillColor: css("--charge"), fillOpacity: 1 })
      .bindPopup(`<div class="pop"><h4>⚡ ${esc(s[2])}</h4>${esc(s[3])}<br>${s[4] ? `Inntil ${s[4]} kW · ` : ""}${s[5] ? `${s[5]} ladepunkt` : ""}<br><span class="mut">${esc(s[6])}</span></div>`).addTo(chargeLayer);
  });
}
const CH_TTL = 12 * 3600 * 1000;
let chLoading = null;
async function fetchChargers(force) {
  if (!force && CHARGERS && CHARGERS.src === "nobil" && Date.now() - CHARGERS.ts < CH_TTL) return CHARGERS;
  if (chLoading) return chLoading;
  chLoading = (async () => {
    const { data, error } = await sb.functions.invoke("nobil-ladere" + (force ? "?oppdater=1" : ""), { method: "GET" });
    if (error) {
      let msg = error.message;
      try { const b = await error.context.json(); if (b && b.error) msg = b.error } catch (e) { }
      throw new Error(msg);
    }
    if (!data || !Array.isArray(data.stasjoner)) throw new Error("Uventet svar fra ladetjenesten");
    CHARGERS = { ts: Date.now(), hentet: data.hentet, src: "nobil", list: data.stasjoner, advarsel: data.advarsel };
    store.set("kk_chargers", CHARGERS);
    return CHARGERS;
  })();
  try { return await chLoading } finally { chLoading = null }
}
function chargePanel(msg) {
  const P = $("cpanel");
  const when = CHARGERS && CHARGERS.hentet ? new Date(CHARGERS.hentet).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const canRefresh = ME && (ME.rolle === "admin" || ME.rolle === "leder");
  P.innerHTML = `<button type="button" class="x" id="cx" aria-label="Lukk">×</button>
  <h3>Ladestasjoner</h3>
  ${CHARGERS ? `<div class="status">${nf.format(CHARGERS.list.length)} stasjoner i Nord-Norge${when ? `, oppdatert fra NOBIL ${when}` : ""}.</div>
    <label class="chk"><input type="checkbox" id="cFast" ${store.get("kk_fast", false) ? "checked" : ""}> Bare hurtigladere (50 kW og mer)</label>
    <div class="acts"><button type="button" class="btn" id="cOff">Skjul fra kartet</button>${canRefresh ? `<button type="button" class="btn" id="cRef">Hent på nytt fra NOBIL</button>` : ""}</div>` : ""}
  <div class="status" id="cstat">${msg ? esc(msg) : CHARGERS && CHARGERS.advarsel ? esc(CHARGERS.advarsel) : ""}</div>
  <div class="status">Ladedata: NOBIL / Enova, CC BY 4.0.</div>`;
  P.hidden = false;
  $("cx").onclick = () => P.hidden = true;
  if ($("cFast")) $("cFast").onchange = e => { store.set("kk_fast", e.target.checked); drawChargers() };
  if ($("cOff")) $("cOff").onclick = () => { chargeLayer.remove(); $("tCharge").setAttribute("aria-pressed", "false"); P.hidden = true };
  if ($("cRef")) $("cRef").onclick = async () => {
    $("cstat").textContent = "Henter fra NOBIL … (kan ta opptil et halvt minutt)";
    try { await fetchChargers(true); drawChargers(); chargePanel("Oppdatert.") } catch (e) { $("cstat").textContent = "Kunne ikke hente: " + e.message }
  };
}
$("tCharge").onclick = async () => {
  const on = $("tCharge").getAttribute("aria-pressed") === "true";
  if (on) { chargeLayer.remove(); $("tCharge").setAttribute("aria-pressed", "false"); $("cpanel").hidden = true; return }
  $("tCharge").setAttribute("aria-pressed", "true");
  if (!CHARGERS || CHARGERS.src !== "nobil") chargePanel("Henter ladestasjoner …");
  try {
    await fetchChargers(false);
    drawChargers(); chargeLayer.addTo(map); chargePanel();
    if (st.sel) select(st.sel, false);
  } catch (e) {
    $("tCharge").setAttribute("aria-pressed", "false");
    chargePanel("Kunne ikke hente ladestasjoner: " + e.message);
  }
};

/* ---------------- lim ---------------- */
function render(fit) {
  const arr = sorted(filtered());
  const tot = arr.reduce((s, c) => s + c.t, 0);
  $("sCount").textContent = nf.format(arr.length); $("sTot").textContent = krK(tot) + " kr";
  $("lCount").textContent = `${arr.length} av ${DATA.length} kunder`;
  renderList(arr); renderMap(arr, fit);
}
let qT = null;
$("q").oninput = e => { st.q = e.target.value; clearTimeout(qT); qT = setTimeout(() => { renderActive(); render(false) }, 120) };
document.querySelector(".filters").addEventListener("click", e => { const b = e.target.closest(".msbtn"); if (b) openPop(b.dataset.k) });
document.addEventListener("click", e => { if (!e.target.closest(".ms")) closePops() });
document.addEventListener("keydown", e => { if (e.key === "Escape") closePops() });
$("fSeg").onclick = e => { const b = e.target.closest("[data-seg]"); if (!b) return; const s = b.dataset.seg; st.seg.has(s) ? st.seg.delete(s) : st.seg.add(s); b.setAttribute("aria-pressed", st.seg.has(s)); applyFilters() };
$("activeF").onclick = e => {
  if (e.target.closest(".aclear")) return $("reset").click();
  const c = e.target.closest(".achip"); if (!c) return;
  const k = c.dataset.k, v = c.dataset.v;
  if (k === "q") { st.q = ""; $("q").value = "" } else st[k].delete(v);
  if (k === "seg") document.querySelector(`[data-seg="${v}"]`).setAttribute("aria-pressed", "false");
  if (FKEYS[k]) { const w = $("f" + k[0].toUpperCase() + k.slice(1)); w.querySelector(".msbtn").innerHTML = msButtonText(k) + `<span class="caret" aria-hidden="true">▾</span>` }
  saveFilters(); renderActive(); render(true);
};
$("sort").onchange = e => { st.sort = e.target.value; store.set("kk_sort", st.sort); render(false) };
$("reset").onclick = () => { st.q = ""; ["reg", "by", "eier", "kat", "seg"].forEach(k => st[k].clear()); saveFilters(); buildFilters(); render(true) };
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
