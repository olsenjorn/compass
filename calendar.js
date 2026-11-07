/* Kalender: reisedager fra ruteplanene i uke- eller månedsvisning. Klikk åpner dagen i planleggeren. */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } }
};
const KK = () => window.KK;
const hm = v => v == null ? "" : `${String(Math.floor(((v % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(Math.round(v) % 60).padStart(2, "0")}`;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monday = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x };
const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x };
const weekNo = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7) };
const seller = e => String(e || "").split("@")[0].split(/[._-]/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

let jumped = false, open = false, view = store.get("kk_calview", "uke"), cursor = new Date(), events = [], loading = false, err = "";

async function load() {
  loading = true; err = ""; render();
  const { data, error } = await KK().sb.from("ruteplaner").select("id,tittel,laget_av,data");
  loading = false;
  if (error) { err = error.message; render(); return }
  const mine = (KK().ME || {}).epost;
  const people = [...new Set((data || []).map(p => p.laget_av))].sort((a, b) => (a === mine ? -1 : b === mine ? 1 : a.localeCompare(b)));
  events = [];
  (data || []).forEach(p => (p.data && p.data.dager || []).forEach((d, i) => {
    const s = p.data.sammendrag && p.data.sammendrag[i];
    events.push({ id: p.id, day: i, dato: d.dato, tittel: p.tittel, av: p.laget_av, mine: p.laget_av === mine, farge: people.indexOf(p.laget_av) % 6,
      start: s ? s.start : null, slutt: s ? s.slutt : null, km: s ? s.km : null, besok: s ? s.besok : d.stopp.length, fra: s ? s.fra : "",
      stopp: s ? s.stopp : d.stopp.map(x => ({ type: "kunde", navn: (KK().DATA.find(c => c.k === x.k) || {}).n || x.k })),
      hotell: d.slutt && d.slutt.type === "hotell" ? d.slutt.navn : "" });
  }));
  events.sort((a, b) => a.dato.localeCompare(b.dato) || (a.start ?? 0) - (b.start ?? 0));
  render();
}

function chip(e) {
  return `<button type="button" class="cev c${e.farge}${e.mine ? " mine" : ""}" data-id="${e.id}" data-day="${e.day}" title="${esc(e.tittel)} · dag ${e.day + 1}">
    <b>${esc(e.mine ? e.tittel : seller(e.av))}</b><span>${e.mine ? "" : esc(e.tittel) + " · "}${e.besok} besøk${e.hotell ? " · " + esc(e.hotell) : ""}</span></button>`;
}
function card(e) {
  const kunder = e.stopp.filter(x => x.type === "kunde");
  return `<button type="button" class="ccard c${e.farge}${e.mine ? " mine" : ""}" data-id="${e.id}" data-day="${e.day}">
    <div class="cct"><b>${esc(e.tittel)}</b>${e.mine ? "" : `<span class="who">${esc(seller(e.av))}</span>`}</div>
    <div class="ccm">${e.start != null ? `${hm(e.start)}–${hm(e.slutt)}` : "Ikke beregnet"}${e.km != null ? ` · ${e.km} km` : ""} · dag ${e.day + 1}</div>
    <ol>${kunder.slice(0, 8).map(x => `<li>${x.fra != null ? `<span class="t">${hm(x.fra)}</span>` : ""}${esc(x.navn)}</li>`).join("")}${kunder.length > 8 ? `<li class="more">+${kunder.length - 8} til</li>` : ""}</ol>
    ${e.hotell ? `<div class="cch">Hotell: ${esc(e.hotell)}</div>` : ""}
  </button>`;
}
function render() {
  const P = $("calendar"); if (!P || !open) return;
  const today = iso(new Date());
  let title, body;
  if (view === "uke") {
    const m = monday(cursor), days = [...Array(7)].map((_, i) => addD(m, i));
    title = `Uke ${weekNo(m)} · ${m.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}–${days[6].toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" })}`;
    body = `<div class="cweek">${days.map(d => { const k = iso(d), ev = events.filter(e => e.dato === k);
      return `<div class="ccol${k === today ? " today" : ""}"><div class="cdh">${d.toLocaleDateString("nb-NO", { weekday: "short" })} <b>${d.getDate()}</b></div>${ev.map(card).join("") || `<div class="cempty"></div>`}</div>` }).join("")}</div>`;
  } else {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12), start = monday(first);
    title = first.toLocaleDateString("nb-NO", { month: "long", year: "numeric" });
    title = title[0].toUpperCase() + title.slice(1);
    const cells = [...Array(42)].map((_, i) => addD(start, i));
    body = `<div class="cmonth"><div class="cmh">${["man", "tir", "ons", "tor", "fre", "lør", "søn"].map(d => `<span>${d}</span>`).join("")}</div>
      <div class="cgrid">${cells.map(d => { const k = iso(d), ev = events.filter(e => e.dato === k);
        return `<div class="ccell${d.getMonth() !== first.getMonth() ? " out" : ""}${k === today ? " today" : ""}"><span class="cn">${d.getDate()}</span>${ev.slice(0, 3).map(chip).join("")}${ev.length > 3 ? `<span class="more">+${ev.length - 3}</span>` : ""}</div>` }).join("")}</div></div>`;
  }
  const people = [...new Map(events.map(e => [e.av, e])).values()];
  P.innerHTML = `<div class="chead">
      <div class="cnav"><button type="button" class="ib" id="cPrev" aria-label="Forrige">‹</button><button type="button" class="btn" id="cToday">I dag</button><button type="button" class="ib" id="cNext" aria-label="Neste">›</button></div>
      <h2>${esc(title)}</h2>
      <div class="cview" role="group" aria-label="Visning"><button type="button" class="chip" data-v="uke" aria-pressed="${view === "uke"}">Uke</button><button type="button" class="chip" data-v="maned" aria-pressed="${view === "maned"}">Måned</button></div>
      <button type="button" class="x" id="cClose" aria-label="Lukk kalenderen">×</button>
    </div>
    ${people.length > 1 ? `<div class="clegend">${people.map(e => `<span class="c${e.farge}"><i></i>${esc(e.mine ? "Mine ruter" : seller(e.av))}</span>`).join("")}</div>` : ""}
    ${loading ? `<div class="status cpad">Henter ruter …</div>` : err ? `<div class="status cpad">Kunne ikke hente ruter: ${esc(err)}</div>` : ""}
    ${!loading && !err && !events.length ? `<div class="status cpad">Ingen ruter ennå. Lag en i Planleggeren, så dukker reisedagene opp her.</div>` : ""}
    ${body}`;
  $("cPrev").onclick = () => { cursor = view === "uke" ? addD(cursor, -7) : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1, 12); render() };
  $("cNext").onclick = () => { cursor = view === "uke" ? addD(cursor, 7) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12); render() };
  $("cToday").onclick = () => { cursor = new Date(); render() };
  $("cClose").onclick = () => toggle(false);
  P.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { view = b.dataset.v; store.set("kk_calview", view); render() });
  P.querySelectorAll("[data-id]").forEach(b => b.onclick = async () => {
    toggle(false);
    if (!window.KKPlan.open) await window.KKPlan.toggle(true);
    await window.KKPlan.openPlan(b.dataset.id, +b.dataset.day);
  });
}
function toggle(force) {
  open = force ?? !open;
  $("calendar").hidden = !open;
  document.dispatchEvent(new Event("kk:view"));
  if (open) {
    KK().closeDetail();
    if (window.innerWidth <= 760) { $("main").dataset.view = "map"; $("vMap").setAttribute("aria-pressed", "true"); $("vList").setAttribute("aria-pressed", "false") }
    load().then(() => {
      // Første gang: står uka tom, hopp til neste planlagte reisedag
      if (jumped) return; jumped = true;
      const m = monday(cursor), end = iso(addD(m, 6)), startW = iso(m);
      if (!events.some(e => e.dato >= startW && e.dato <= end)) { const n = events.find(e => e.dato >= iso(new Date())); if (n) { cursor = new Date(n.dato + "T12:00"); render() } }
    });
  }
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && open && !document.querySelector(".dlg:not([hidden])")) toggle(false) });
window.KKCal = { toggle, load, get open() { return open }, get events() { return events } };
})();
