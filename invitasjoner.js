/* Invitasjoner til kundemøter. En kollega som legges på et besøk får en forespørsel her,
   og kan godta eller avslå. Godtatte møter vises i kalenderen og legges automatisk inn i
   kollegaens egen planlegging den dagen. */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KK = () => window.KK;
const hm = v => v == null ? "" : `${String(Math.floor(((v % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(Math.round(v) % 60).padStart(2, "0")}`;
const dato = s => { if (!s) return ""; const d = new Date(s + "T12:00:00"); return d.toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" }) };
const me = () => (KK().ME || {}).epost || "";
let list = [], timer = null, loaded = false, seen = new Set();
try { seen = new Set(JSON.parse(localStorage.getItem("kk_inv_seen") || "[]")) } catch (e) { }

const navn = e => (window.KKPlan && window.KKPlan.kollNavn) ? window.KKPlan.kollNavn(e) : String(e || "").split("@")[0];
const incoming = () => list.filter(i => i.til_epost === me());
const pending = () => incoming().filter(i => i.status === "ventende");
const accepted = () => incoming().filter(i => i.status === "godtatt");
const outgoing = () => list.filter(i => i.fra_epost === me());

async function load(quiet) {
  const sb = KK() && KK().sb; if (!sb || !me()) return;
  const { data, error } = await sb.from("invitasjoner").select("*").order("dato");
  if (error) return;
  const before = JSON.stringify(list.map(i => [i.id, i.status, i.dato, i.fra_kl]));
  list = data || []; loaded = true;
  badge();
  if (!quiet || before !== JSON.stringify(list.map(i => [i.id, i.status, i.dato, i.fra_kl]))) document.dispatchEvent(new CustomEvent("kk:inv"));
  // nytt varsel i appen
  const fresh = pending().filter(i => !seen.has(i.id));
  if (fresh.length && quiet) toast(`${fresh.length === 1 ? "Ny invitasjon" : fresh.length + " nye invitasjoner"} til kundemøte fra ${[...new Set(fresh.map(i => navn(i.fra_epost)))].join(", ")}.`);
}
function badge() {
  const n = pending().length;
  ["tPlan", "tCal"].forEach(id => { const b = $(id); if (!b) return; let s = b.querySelector(".nbadge"); if (!n) { if (s) s.remove(); return } if (!s) { s = document.createElement("span"); s.className = "nbadge"; b.appendChild(s) } s.textContent = n });
  const o = $("invBanner");
  if (o) { o.hidden = !n; o.innerHTML = n ? `<span>${n === 1 ? "Du har 1 invitasjon til kundemøte som venter på svar." : `Du har ${n} invitasjoner til kundemøter som venter på svar.`}</span><button type="button" class="btn pri" id="invGo">Se invitasjonene</button>` : ""; const g = $("invGo"); if (g) g.onclick = () => { window.KKCal && window.KKCal.toggle(true) } }
}
let toastT = null;
function toast(msg) {
  let t = $("invToast"); if (!t) { t = document.createElement("div"); t.id = "invToast"; t.className = "toast"; document.body.appendChild(t) }
  t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true }, 8000);
}
async function respond(id, status) {
  const { error } = await KK().sb.from("invitasjoner").update({ status }).eq("id", id);
  if (error) { toast("Kunne ikke svare: " + error.message); return false }
  seen.add(id); try { localStorage.setItem("kk_inv_seen", JSON.stringify([...seen])) } catch (e) { }
  await load(false);
  if (window.KKCal && window.KKCal.load) window.KKCal.load();
  if (window.KKPlan && window.KKPlan.recompute) window.KKPlan.recompute();
  return true;
}
function markSeen() { pending().forEach(i => seen.add(i.id)); try { localStorage.setItem("kk_inv_seen", JSON.stringify([...seen])) } catch (e) { } }

/* HTML for panelet (brukes av kalender og planlegger) */
function html(opts = {}) {
  const inn = incoming().filter(i => i.status !== "avslatt" || !opts.hideDeclined), ut = outgoing();
  if (!inn.length && !ut.length) return "";
  const row = i => `<div class="inv ${i.status}">
      <div class="invb"><b>${esc(i.kundenavn || "Kundemøte")}</b> <span class="mut">${esc(dato(i.dato))}${i.fra_kl != null ? ` kl. ${hm(i.fra_kl)}–${hm(i.til_kl)}` : ""}${i.sted ? " · " + esc(i.sted) : ""}</span>
        <div class="mut">Invitert av ${esc(navn(i.fra_epost))}${i.rute_tittel ? ` · ruta «${esc(i.rute_tittel)}»` : ""}</div></div>
      <div class="inva">${i.status === "ventende" ? `<button type="button" class="btn pri" data-inv="${i.id}" data-s="godtatt">Godta</button><button type="button" class="btn" data-inv="${i.id}" data-s="avslatt">Avslå</button>`
        : i.status === "godtatt" ? `<span class="stbadge avtalt">✓ Godtatt</span><button type="button" class="linkbtn" data-inv="${i.id}" data-s="avslatt">Trekk deg</button>`
        : `<span class="stbadge avlyst">Avslått</span><button type="button" class="linkbtn" data-inv="${i.id}" data-s="godtatt">Godta likevel</button>`}</div></div>`;
  const outRow = i => `<div class="inv out ${i.status}"><div class="invb"><b>${esc(navn(i.til_epost))}</b> <span class="mut">· ${esc(i.kundenavn || "")} ${esc(dato(i.dato))}${i.fra_kl != null ? ` kl. ${hm(i.fra_kl)}` : ""}</span></div>
      <div class="inva">${i.status === "ventende" ? `<span class="stbadge">Venter på svar</span>` : i.status === "godtatt" ? `<span class="stbadge avtalt">✓ Godtatt</span>` : `<span class="stbadge avlyst">Avslått</span>`}</div></div>`;
  const p = inn.filter(i => i.status === "ventende"), rest = inn.filter(i => i.status !== "ventende");
  return `<section class="invbox">
    ${p.length ? `<h3>Invitasjoner som venter på svar</h3>${p.map(row).join("")}` : ""}
    ${rest.length && !opts.pendingOnly ? `<h3>Kundemøter du er invitert til</h3>${rest.map(row).join("")}` : ""}
    ${ut.length && !opts.pendingOnly ? `<h3>Kolleger du har invitert</h3>${ut.map(outRow).join("")}` : ""}
  </section>`;
}
function bind(root) {
  (root || document).querySelectorAll("[data-inv]").forEach(b => b.onclick = async () => { b.disabled = true; await respond(b.dataset.inv, b.dataset.s) });
}

/* Eierens side: synk invitasjoner fra ruta når den lagres */
async function syncFromPlan(plan, sum) {
  const sb = KK().sb; if (!plan || !plan.id || plan.laget_av !== me()) return;
  const want = [];
  (plan.data.dager || []).forEach((d, di) => (d.stopp || []).forEach(st => {
    if (!st.uid || st.type === "avtale" || !(st.deltakere || []).length) return;
    if (st.status === "avlyst" || st.status === "utsatt") return;
    const c = (KK().DATA || []).find(x => x.k === st.k) || {};
    const s = sum && sum[di] && sum[di].stopp.find(x => x.type === "kunde" && x.k === st.k);
    st.deltakere.forEach(e => want.push({ rute_id: plan.id, stopp_uid: st.uid, til_epost: e, dag: di, dato: d.dato || null, fra_kl: s ? s.fra : null, til_kl: s ? s.til : null,
      kundenr: st.k, kundenavn: c.n || st.k, sted: [c.adr, c.ps].filter(Boolean).join(", "), lat: c.lat ?? null, lon: c.lon ?? null, rute_tittel: plan.tittel || "" }));
  }));
  const { data: have } = await sb.from("invitasjoner").select("id,stopp_uid,til_epost,dato,fra_kl,til_kl,kundenr,rute_tittel").eq("rute_id", plan.id);
  const key = x => x.stopp_uid + "|" + x.til_epost;
  const wantK = new Set(want.map(key));
  const gone = (have || []).filter(h => !wantK.has(key(h))).map(h => h.id);
  if (gone.length) await sb.from("invitasjoner").delete().in("id", gone);
  const changed = want.filter(w => { const h = (have || []).find(x => key(x) === key(w)); return !h || h.dato !== w.dato || h.fra_kl !== w.fra_kl || h.til_kl !== w.til_kl || h.kundenr !== w.kundenr || h.rute_tittel !== w.rute_tittel });
  if (changed.length) { const { error } = await sb.from("invitasjoner").upsert(changed, { onConflict: "rute_id,stopp_uid,til_epost" }); if (error) console.warn("invitasjoner:", error.message) }
  if (gone.length || changed.length) load(true);
}
/* status per stopp for eieren (vises på besøket) */
function statusFor(planId, uid, epost) { const i = list.find(x => x.rute_id === planId && x.stopp_uid === uid && x.til_epost === epost); return i ? i.status : null }

function start() {
  if (!KK() || !KK().ME) return setTimeout(start, 500);
  load(false);
  clearInterval(timer); timer = setInterval(() => load(true), 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(true) });
}
start();
window.KKInv = { get list() { return list }, pending, accepted, outgoing, load, respond, html, bind, syncFromPlan, statusFor, markSeen, get loaded() { return loaded } };
})();
