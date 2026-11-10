/* Møtebooking: oversikt over planlagte kundebesøk som ennå ikke er avtalt med kunden.
   Viser alle egne (og delte) ruter framover, med kontaktperson, status og kommentar. */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KK = () => window.KK;
const hm = v => v == null ? "" : `${String(Math.floor(((v % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(Math.round(v) % 60).padStart(2, "0")}`;
const dato = s => { if (!s) return "Uten dato"; const d = new Date(s + "T12:00:00"); return d.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" }) };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const STATUS = [["planlagt", "Planlagt"], ["avtalt", "Avtalt"], ["utsatt", "Utsatt"], ["avlyst", "Avlyst"]];
const navn = e => (window.KKPlan && window.KKPlan.kollNavn) ? window.KKPlan.kollNavn(e) : String(e || "").split("@")[0];

let open = false, plans = [], filter = "ubooket", showPast = false, showShared = false, loading = false, err = "", q = "";

async function load() {
  loading = true; err = ""; render();
  const { data, error } = await KK().sb.from("ruteplaner").select("id,tittel,laget_av,delt_med,data").order("endret", { ascending: false });
  loading = false; if (error) { err = error.message; render(); return }
  plans = data || []; render();
}
function rows() {
  const me = (KK().ME || {}).epost, today = iso(new Date()), out = [];
  plans.forEach(p => {
    const mine = p.laget_av === me;
    if (!mine && !showShared) return;
    (p.data && p.data.dager || []).forEach((d, di) => {
      if (!showPast && d.dato && d.dato < today) return;
      const sum = p.data.sammendrag && p.data.sammendrag[di];
      (d.stopp || []).forEach((st, si) => {
        if (st.type === "avtale") return;
        const c = (KK().DATA || []).find(x => x.k === st.k) || {};
        const s = sum && sum.stopp.find(x => x.type === "kunde" && x.k === st.k);
        out.push({ p, mine, di, si, st, c, dato: d.dato, fra: s ? s.fra : null, til: s ? s.til : null, status: st.status || "planlagt" });
      });
    });
  });
  const qq = q.trim().toLowerCase();
  return out.filter(r => (filter === "alle" || (filter === "ubooket" ? r.status === "planlagt" : r.status === filter)) && (!qq || (r.c.n || r.st.k).toLowerCase().includes(qq) || (r.c.ps || "").toLowerCase().includes(qq) || (r.st.kontakt || "").toLowerCase().includes(qq)))
    .sort((a, b) => (a.dato || "9").localeCompare(b.dato || "9") || (a.fra ?? 0) - (b.fra ?? 0));
}
function render() {
  const P = $("booking"); if (!P || !open) return;
  const prevF = filter; filter = "alle"; const all = rows(); filter = prevF;
  const n = { ubooket: all.filter(r => r.status === "planlagt").length, avtalt: all.filter(r => r.status === "avtalt").length, utsatt: all.filter(r => r.status === "utsatt").length, avlyst: all.filter(r => r.status === "avlyst").length, alle: all.length };
  const list = rows();
  let body = "", cur = null;
  list.forEach(r => {
    const key = r.dato || "";
    if (key !== cur) { cur = key; body += `<h3 class="bkd">${esc(dato(r.dato))}</h3>` }
    const ro = !r.mine;
    const note = window.KKInv && r.st.uid ? window.KKInv.note(r.p.id, r.st.uid) : null;
    body += `<div class="bk ${r.status}" data-p="${r.p.id}" data-d="${r.di}">
      <div class="bkt">${r.fra != null ? `<b>${hm(r.fra)}</b><span>${hm(r.til)}</span>` : `<span class="mut">–</span>`}</div>
      <div class="bkb">
        <div class="bkn"><b>${esc(r.c.n || r.st.k)}</b> <span class="mut">${esc([r.c.adr, r.c.ps].filter(Boolean).join(", "))}</span></div>
        <div class="mut">${esc(r.p.tittel)}${r.mine ? "" : ` · ${esc(navn(r.p.laget_av))}`} · dag ${r.di + 1}${(r.st.deltakere || []).length ? ` · med ${r.st.deltakere.map(navn).map(esc).join(", ")}` : ""}${r.c.kj && r.c.kj !== "Frittstående" ? ` · ${esc(r.c.kj)}` : ""}</div>
        <div class="plrow small wrap">
          <label>Status <select data-bs="1" ${ro ? "disabled" : ""}>${STATUS.map(([v, l]) => `<option value="${v}" ${r.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <input class="grow" data-bk="1" value="${esc(r.st.kontakt || "")}" placeholder="Kontaktperson hos kunden" ${ro ? "readonly" : ""}>
          <label>Avtalt kl. <input type="time" data-bt="1" value="${esc(r.st.avtalt || "")}" ${ro ? "readonly" : ""}></label>
        </div>
        ${window.KKInv && r.st.uid ? window.KKInv.noteHtml(r.p.id, r.st.uid, { readonly: ro, placeholder: "Agenda eller beskjed om bookingen …" }) : ""}
        <div class="bka"><button type="button" class="linkbtn" data-open="1">Åpne i planleggeren</button>${r.c.k ? `<button type="button" class="linkbtn" data-cust="${esc(r.c.k)}">Kundekort</button>` : ""}</div>
      </div></div>`;
  });
  P.innerHTML = `<div class="chead">
      <h2>Møtebooking</h2>
      <div class="cview" role="group" aria-label="Vis">${[["ubooket", "Ikke avtalt"], ["avtalt", "Avtalt"], ["utsatt", "Utsatt"], ["avlyst", "Avlyst"], ["alle", "Alle"]].map(([v, l]) => `<button type="button" class="chip" data-bf="${v}" aria-pressed="${filter === v}">${l} <span class="n">${n[v]}</span></button>`).join("")}</div>
      <button type="button" class="x" id="bkClose" aria-label="Lukk">×</button>
    </div>
    <div class="bktools"><input id="bkQ" placeholder="Søk kunde, sted eller kontaktperson" value="${esc(q)}"><label class="chk"><input type="checkbox" id="bkPast" ${showPast ? "checked" : ""}> Vis også tidligere datoer</label><label class="chk"><input type="checkbox" id="bkShared" ${showShared ? "checked" : ""}> Vis delte ruter og andres</label></div>
    ${loading ? `<div class="status cpad">Henter ruter …</div>` : err ? `<div class="status cpad">Kunne ikke hente: ${esc(err)}</div>` : ""}
    <div class="bklist">${list.length ? body : `<div class="status cpad">${filter === "ubooket" ? "Alle planlagte besøk er avtalt. 👍" : "Ingen besøk i denne visningen."}</div>`}</div>`;
  $("bkClose").onclick = () => toggle(false);
  P.querySelectorAll("[data-bf]").forEach(b => b.onclick = () => { filter = b.dataset.bf; render() });
  $("bkQ").oninput = e => { q = e.target.value; const keep = e.target.selectionStart; render(); const i = $("bkQ"); i.focus(); i.setSelectionRange(keep, keep) };
  $("bkPast").onchange = e => { showPast = e.target.checked; render() };
  $("bkShared").onchange = e => { showShared = e.target.checked; render() };
  if (window.KKInv) window.KKInv.bindNotes(P);
  P.querySelectorAll(".bk").forEach(el => {
    const p = plans.find(x => x.id === el.dataset.p), di = +el.dataset.d; if (!p) return;
    const r = list.find(x => x.p === p && x.di === di && el.querySelector(".bkn b").textContent === (x.c.n || x.st.k)); if (!r) return;
    const save = async () => { const { error } = await KK().sb.from("ruteplaner").update({ data: p.data, endret: new Date().toISOString() }).eq("id", p.id); if (error) { err = error.message; render() } else if (window.KKPlan && window.KKPlan.plan && window.KKPlan.plan.id === p.id) window.KKPlan.openPlan(p.id, di) };
    const sel = el.querySelector("[data-bs]"); if (sel && !sel.disabled) sel.onchange = () => { r.st.status = sel.value; save().then(render) };
    const kt = el.querySelector("[data-bk]"); if (kt && !kt.readOnly) kt.onchange = () => { r.st.kontakt = kt.value.trim(); save() };
    const tt = el.querySelector("[data-bt]"); if (tt && !tt.readOnly) tt.onchange = () => { r.st.avtalt = tt.value; save().then(render) };
    el.querySelector("[data-open]").onclick = async () => { toggle(false); if (!window.KKPlan.open) await window.KKPlan.toggle(true); await window.KKPlan.openPlan(p.id, di) };
    const cb = el.querySelector("[data-cust]"); if (cb) cb.onclick = () => { toggle(false); KK().select(cb.dataset.cust) };
  });
}
function toggle(force) {
  open = force ?? !open;
  $("booking").hidden = !open;
  document.dispatchEvent(new Event("kk:view"));
  if (open) { KK().closeDetail(); if (window.innerWidth <= 760) { $("main").dataset.view = "map" } load() }
}
async function badge() {
  const b = $("tBook"); if (!b || !KK() || !KK().sb || !KK().ME) return;
  const { data } = await KK().sb.from("ruteplaner").select("laget_av,data").eq("laget_av", KK().ME.epost);
  const today = iso(new Date());
  let n = 0; (data || []).forEach(p => (p.data && p.data.dager || []).forEach(d => { if (d.dato && d.dato < today) return; (d.stopp || []).forEach(st => { if (st.type !== "avtale" && (st.status || "planlagt") === "planlagt") n++ }) }));
  let s = b.querySelector(".nbadge.soft"); if (!n) { if (s) s.remove(); return } if (!s) { s = document.createElement("span"); s.className = "nbadge soft"; b.appendChild(s) } s.textContent = n;
}
document.addEventListener("keydown", e => { if (e.key === "Escape" && open && !document.querySelector(".dlg:not([hidden])")) toggle(false) });
document.addEventListener("kk:notat", () => { if (open) render() });
(function start() { if (!KK() || !KK().ME) return setTimeout(start, 600); badge(); setInterval(badge, 120000) })();
window.KKBook = { toggle, load, badge, get open() { return open } };
})();
