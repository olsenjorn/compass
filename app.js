/* Kundekart Nord – Lindab. Innlogging via Supabase, kundedata beskyttet av RLS. */
(() => {
const CFG = window.KK_CONFIG || {};
/* invitasjon / glemt passord: lenken logger inn uten passord, så be om nytt passord når appen er åpnet */
try { if (/type=(invite|recovery)/.test(location.hash + location.search)) sessionStorage.setItem("kk_nytt_pw", "1") } catch (e) { }
const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "kk-auth" }
});

/* Salgsområder. Selgere ser kundene i sine områder (tilgang.omraader); admin/leder ser alt. */
const OMRAADER = {
  nord: { navn: "Nord-Norge", senter: [68.6, 18], zoom: 5.5, utenfor: "Utenfor Nord-Norge", hjem: { adresse: "Tromsø sentrum", lat: 69.6496, lon: 18.956 } },
  rogaland: { navn: "Rogaland", senter: [58.95, 5.9], zoom: 8, utenfor: "Utenfor Rogaland", hjem: { adresse: "Stavanger sentrum", lat: 58.9699, lon: 5.7331 } }
};
const utenfor = om => (OMRAADER[om] || OMRAADER.nord).utenfor;
const REG_ORDER = ["Sør-Helgeland","Midt-Helgeland","Nord-Helgeland","Salten","Ofoten","Indre Lofoten","Ytre Lofoten","Vesterålen","Hålogaland","Indre Troms","Midt-Troms","Tromsøregionen","Nord-Troms","Vest-Finnmark","Midt-Finnmark","Indre Finnmark","Øst-Finnmark","Svalbard","Utenfor Nord-Norge","Haugalandet","Ryfylke","Nord-Jæren","Jæren","Dalane","Utenfor Rogaland"];
const FYLKE = r => /Helgeland|Salten|Ofoten|Lofoten|Vesterålen/.test(r) ? "Nordland" : /Finnmark/.test(r) ? "Finnmark" : /^(Haugalandet|Ryfylke|Nord-Jæren|Jæren|Dalane)$/.test(r) ? "Rogaland" : (r === "Svalbard" || /^Utenfor /.test(r) || !r) ? "Annet" : "Troms";

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
let PROS = [];           // prospekter (ikke kunder): byggevarehus og takentreprenører
let INFO = {};           // kundenr -> kjede, konstellasjon, vbl, byggvare (kunde_info)
let DATA = [];
let ME = null;           // {epost, navn, rolle, omraader}
// Området brukeren hører til: eneste område i tilgang, ellers området med flest synlige kunder
function mittOmraade() {
  const o = (ME && ME.omraader) || ["nord"];
  if (o.length === 1 && !(ME && (ME.rolle === "admin" || ME.rolle === "leder"))) return o[0];
  if (typeof RAW !== "undefined" && RAW && RAW.length) { const n = {}; RAW.forEach(c => n[c.om] = (n[c.om] || 0) + 1); return Object.keys(n).sort((a, b) => n[b] - n[a])[0] }
  return o[0] || "nord";
}
let CHARGERS = store.get("kk_chargers", null);
const st = { q: "", reg: new Set(), by: new Set(), eier: new Set(), kat: new Set(), seg: new Set(), kj: new Set(), ko: new Set(), flag: new Set(), sort: store.get("kk_sort", "reg"), sel: null };

/* ---------------- innlogging ---------------- */
function showLogin(msg) {
  $("app").hidden = true; $("login").hidden = false;
  $("lErr").textContent = msg || "";
}
let mfaFactor = null;
function loginStep(two) {
  $("lStep1").hidden = two; $("lStep2").hidden = !two; $("lBack").hidden = !two;
  $("lEmail").required = $("lPass").required = !two; $("lCode").required = two;
  $("lBtn").textContent = two ? "Bekreft kode" : "Logg inn";
  if (two) { $("lCode").value = ""; setTimeout(() => $("lCode").focus(), 0) }
}
$("lForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("lBtn"); $("lErr").textContent = "";
  if (!$("lStep2").hidden) {
    const code = $("lCode").value.replace(/\D/g, "");
    if (code.length !== 6) { $("lErr").textContent = "Koden har 6 siffer."; return }
    btn.disabled = true; btn.textContent = "Sjekker …";
    const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: mfaFactor.id, code });
    btn.disabled = false; btn.textContent = "Bekreft kode";
    if (error) { $("lErr").textContent = /invalid|expired/i.test(error.message) ? "Feil eller utløpt kode. Prøv den nye koden i appen." : "Kunne ikke bekrefte: " + error.message; $("lCode").select(); return }
    loginStep(false); start(); return;
  }
  btn.disabled = true; btn.textContent = "Logger inn …";
  const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim().toLowerCase(), password: $("lPass").value });
  btn.disabled = false; btn.textContent = "Logg inn";
  if (error) { $("lErr").textContent = /invalid/i.test(error.message) ? "Feil e-post eller passord." : /not confirmed/i.test(error.message) ? "Brukeren er ikke aktivert ennå. Kontakt Jørn Winge." : "Innloggingen feilet: " + error.message; return }
  $("lPass").value = "";
  start();
});
$("lBack").onclick = async () => { await sb.auth.signOut(); loginStep(false); showLogin("") };

/* ---------------- tofaktor (TOTP) ---------------- */
async function mfaState() {
  const [a, f] = await Promise.all([sb.auth.mfa.getAuthenticatorAssuranceLevel(), sb.auth.mfa.listFactors()]);
  const all = (f.data && f.data.all) || [];
  return { cur: a.data && a.data.currentLevel, next: a.data && a.data.nextLevel, verified: all.filter(x => x.factor_type === "totp" && x.status === "verified"), unverified: all.filter(x => x.status !== "verified") };
}
async function mfaRequired() { const { data } = await sb.from("app_innstilling").select("krev_mfa").maybeSingle(); return !!(data && data.krev_mfa) }
const fmtDato = d => new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" });
function closeMfa() { $("mfaDlg").hidden = true; $("mfaMsg").textContent = "" }
async function mfaSetup(opts = {}) {
  const D = $("mfaDlg"), B = $("mfaBody"), A = $("mfaActs"), M = $("mfaMsg");
  D.hidden = false; M.textContent = ""; B.innerHTML = `<div class="status">Lager QR-kode …</div>`; A.innerHTML = "";
  const st0 = await mfaState();
  for (const f of st0.unverified) await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Kundekart Nord " + new Date().toISOString().slice(0, 16), issuer: "Kundekart Nord" });
  if (error) { B.innerHTML = ""; M.textContent = "Kunne ikke starte oppsettet: " + error.message; A.innerHTML = `<button class="btn" type="button" id="mfaX">Lukk</button>`; $("mfaX").onclick = closeMfa; return }
  B.innerHTML = `${opts.forced ? `<div class="box warn">Tofaktor er påkrevd. Sett det opp for å komme videre.</div>` : ""}
    <ol class="mfasteps">
      <li>Åpne <b>Microsoft Authenticator</b> eller <b>Google Authenticator</b> på mobilen.</li>
      <li>Trykk <b>+</b> og velg å skanne en QR-kode.</li>
      <li>Skann koden under, og skriv inn de 6 sifrene appen viser.</li>
    </ol>
    <div class="mfaqr"><img id="mfaQrImg" alt="QR-kode for autentiseringsappen"></div>
    <details><summary class="status">Kan ikke skanne? Skriv inn nøkkelen manuelt</summary><div class="mfasecret">${esc(data.totp.secret)}</div></details>
    <label class="f">Kode fra appen<input id="mfaCode" class="codein" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required></label>`;
  $("mfaQrImg").src = data.totp.qr_code;
  A.innerHTML = `<button class="btn pri" type="submit">Aktiver</button>` + (opts.forced ? `<button class="btn" type="button" id="mfaOut">Logg ut</button>` : `<button class="btn" type="button" id="mfaLater">${opts.replace ? "Avbryt" : "Senere"}</button>`);
  setTimeout(() => $("mfaCode").focus(), 50);
  const cancel = async () => { await sb.auth.mfa.unenroll({ factorId: data.id }); closeMfa() };
  if ($("mfaLater")) $("mfaLater").onclick = async () => { if (!opts.replace) store.set("kk_mfa_snooze", Date.now() + 3 * 864e5); await cancel() };
  if ($("mfaOut")) $("mfaOut").onclick = async () => { await sb.auth.mfa.unenroll({ factorId: data.id }).catch(() => { }); closeMfa(); await sb.auth.signOut(); showLogin("") };
  $("mfaForm").onsubmit = async e => {
    e.preventDefault();
    const code = $("mfaCode").value.replace(/\D/g, "");
    if (code.length !== 6) { M.textContent = "Koden har 6 siffer."; return }
    M.textContent = "Sjekker …";
    const { error: ve } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code });
    if (ve) { M.textContent = /invalid|expired/i.test(ve.message) ? "Feil kode. Vent på neste kode i appen og prøv igjen." : "Kunne ikke bekrefte: " + ve.message; return }
    for (const f of st0.verified) await sb.auth.mfa.unenroll({ factorId: f.id }); // ved bytte av telefon
    B.innerHTML = `<p class="mfaok">✓ Tofaktor er satt opp.</p><p class="mfahint">Neste gang du logger inn, ber vi om en kode fra appen etter passordet.</p>`;
    M.textContent = ""; A.innerHTML = `<button class="btn pri" type="button" id="mfaDone">Ferdig</button>`;
    $("mfaDone").onclick = () => { closeMfa(); if (opts.forced) start() };
  };
}
$("mfaBtn").onclick = async () => {
  const s = await mfaState();
  if (!s.verified.length) return mfaSetup();
  $("mfaDlg").hidden = false; $("mfaMsg").textContent = "";
  $("mfaBody").innerHTML = `<p class="mfaok">✓ Tofaktor er på.</p><p class="mfahint">Satt opp ${fmtDato(s.verified[0].created_at)}. Har du fått ny telefon, setter du det opp på nytt her. Den gamle koblingen fjernes når den nye virker.</p>`;
  $("mfaActs").innerHTML = `<button class="btn" type="button" id="mfaNew">Sett opp på ny telefon</button><button class="btn pri" type="button" id="mfaX">Lukk</button>`;
  $("mfaX").onclick = closeMfa;
  $("mfaNew").onclick = () => mfaSetup({ replace: true });
  $("mfaForm").onsubmit = e => e.preventDefault();
};
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
  let mfa = null;
  try {
    mfa = await mfaState();
    if (mfa.next === "aal2" && mfa.cur !== "aal2") { mfaFactor = mfa.verified[0]; $("app").hidden = true; $("login").hidden = false; $("lErr").textContent = ""; loginStep(true); return }
    if (!mfa.verified.length && await mfaRequired()) { $("login").hidden = true; mfaSetup({ forced: true }); return }
  } catch (e) { /* MFA-sjekk feilet: databasen avgjør tilgang uansett */ }
  $("login").hidden = true; $("app").hidden = false;
  $("lstatus").textContent = "Henter kunder …"; $("lstatus").hidden = false;
  try {
    if (!GEO) {
      const [kommuner, regmap, reglab, poststeder] = await Promise.all(
        ["kommuner", "regmap", "reglab", "poststeder"].map(f => fetch(`data/${f}.json`).then(r => r.json())));
      GEO = { kommuner, regmap, reglab, poststeder };
    }
    const [me, k, r, a, inf, pr] = await Promise.all([
      sb.from("tilgang").select("epost,navn,rolle,omraader").maybeSingle(),
      sb.from("kunder").select("*"),
      sb.from("sted_rettelse").select("*"),
      sb.from("kunde_adresse").select("*"),
      sb.from("kunde_info").select("*"),
      sb.from("prospekter").select("*").eq("skjult", false)
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
    $("whoName").textContent = ME.navn; $("whoMail").textContent = ME.epost;
    $("whoInit").textContent = ME.navn.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
    RAW = k.data.map(fromDb);
    RETT = {}; (r.data || []).forEach(x => RETT[x.kundenr] = x);
    ADR = {}; (a.data || []).forEach(x => ADR[x.kundenr] = x);
    INFO = {}; (inf.data || []).forEach(x => INFO[x.kundenr] = x);
    PROS = (pr && pr.data || []).map(fromProsp);
    $("tAdr").hidden = $("tKd").hidden = !(ME.rolle === "admin" || ME.rolle === "leder");
    $("lstatus").hidden = true;
    initMap();
    refreshData(true);
    let nyttPw = false; try { nyttPw = sessionStorage.getItem("kk_nytt_pw") === "1" } catch (e) { }
    if (nyttPw) {
      try { sessionStorage.removeItem("kk_nytt_pw") } catch (e) { }
      setTimeout(() => { $("pwDlg").hidden = false; $("pwMsg").textContent = "Velg et passord du bruker når du logger inn neste gang."; $("pwNew").focus() }, 400);
    }
    if (mfa && !mfa.verified.length && Date.now() > store.get("kk_mfa_snooze", 0)) setTimeout(() => mfaSetup(), 600);
  } catch (err) {
    $("lstatus").textContent = "Kunne ikke hente kundene: " + (err.message || err) + ". Last siden på nytt.";
  }
}
sb.auth.onAuthStateChange((ev) => {
  if (ev === "SIGNED_OUT") showLogin();
  if (ev === "PASSWORD_RECOVERY") { try { sessionStorage.setItem("kk_nytt_pw", "1") } catch (e) { } }
});

function fromDb(c) {
  return { k: c.kundenr, n: c.navn, kat: c.kategori, e: c.eier, v: +c.oms_ventilasjon || 0, p: +c.oms_profil || 0, t: +c.oms_total || 0, s: c.segment,
    ps: c.poststed || "", src: c.poststed_kilde || "", kom: c.kommune || "", r: c.region || "", lat: c.lat, lon: c.lon, pr: c.presisjon || "",
    adr: c.besoksadresse || "", pnr: c.postnr || "", br: c.bransje || "", st: c.status || "", om: c.omraade || "nord" };
}
const PTYPE = { byggevare: "bv", tak: "tak" };
const PLABEL = { bv: "Byggevarehus", tak: "Takentreprenør" };
function fromProsp(x) {
  return { k: "P" + x.orgnr, pro: PTYPE[x.type] || x.type, n: x.navn, kat: "", e: "", v: 0, p: 0, t: 0, s: "", ps: x.poststed || "", src: "", kom: "", r: x.region || "",
    lat: x.lat, lon: x.lon, pr: x.lat != null ? "adresse" : "", adr: x.adresse || "", pnr: x.postnr || "", br: x.naering || "", st: "", kj: x.kjede || "", ko: "",
    orgnr: x.orgnr, oms: x.omsetning, aar: x.regnskapsaar, ans: x.ansatte, web: x.hjemmeside || "", hoved: x.hovedorgnr || "", raw: x };
}
const isPros = () => st.pros.size > 0;
const CUST = () => DATA.filter(c => !c.pro);
const base = () => isPros() ? DATA.filter(c => c.pro && st.pros.has(c.pro)) : CUST();
const mnok = v => v == null ? "" : (v / 1e6).toLocaleString("nb-NO", { maximumFractionDigits: v >= 1e8 ? 0 : 1 }) + " mill";
function applyFix(c) {
  const i = INFO[c.k];
  c = Object.assign({}, c, { kj: i && i.kjede || "", ko: i && i.konstellasjon || "", vbl: !!(i && i.vbl), bv: !!(i && i.byggvare) });
  const a = ADR[c.k];
  if (a && a.lat != null) return Object.assign({}, c, { adr: a.adresse, pnr: a.postnr || "", ps: a.poststed || c.ps, lat: a.lat, lon: a.lon, r: a.region || c.r, pr: "adresse", orgnr: a.orgnr, akilde: a.kilde, asikk: a.sikkerhet });
  if (a) c = Object.assign({}, c, { adr: a.adresse, pnr: a.postnr || "", orgnr: a.orgnr, akilde: a.kilde, asikk: a.sikkerhet });
  const f = RETT[c.k];
  return f ? Object.assign({}, c, { ps: f.poststed, lat: f.lat, lon: f.lon, r: f.region || c.r, pr: "rettet", rettAv: f.endret_av }) : c;
}

/* ---------------- filtre og liste ---------------- */
const FKEYS = { reg: { label: "Region", field: "r", none: "Mangler sted" }, by: { label: "By / poststed", field: "ps", none: "Mangler sted", search: true },
  eier: { label: "Eier", field: "e" }, kat: { label: "Kategori", field: "kat" },
  kj: { label: "Kjede", field: "kj", none: "Uten kjede", search: true }, ko: { label: "Konstellasjon", field: "ko", none: "Uten konstellasjon" } };
const FLAGS = { vbl: "VBL-medlem", bv: "Byggvareforhandler" };
const PROSF = { bv: "Byggevarehus (ikke kunde)", tak: "Takentreprenører >10 mill (ikke kunde)" };
const NONE = "__none";
function loadFilters() {
  const f = store.get("kk_filters", null);
  ["reg", "by", "eier", "kat", "seg", "kj", "ko", "flag", "pros"].forEach(k => st[k] = new Set(f && Array.isArray(f[k]) ? f[k] : []));
}
function saveFilters() { store.set("kk_filters", Object.fromEntries(["reg", "by", "eier", "kat", "seg", "kj", "ko", "flag", "pros"].map(k => [k, [...st[k]]]))) }
loadFilters();
function count(key) { const m = {}; base().forEach(c => { const v = c[key] || NONE; m[v] = (m[v] || 0) + 1 }); return m }
function optionsFor(k) {
  const def = FKEYS[k], cnt = count(def.field);
  let items;
  if (k === "reg") {
    items = [];
    ["Nordland", "Troms", "Finnmark", "Rogaland", "Annet"].forEach(g => {
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
  $("fFlag").innerHTML = `<span class="seglbl">Vis bare</span>` + Object.entries(FLAGS).map(([k, l]) => `<button type="button" class="chip" data-flag="${k}" aria-pressed="${st.flag.has(k)}">${l} <span class="n">${CUST().filter(c => c[k]).length}</span></button>`).join("");
  $("fPros").innerHTML = `<span class="seglbl">Prospekter</span>` + [["bv", "Byggevarehus"], ["tak", "Takentreprenører >10 mill"]].map(([k, l]) => `<button type="button" class="chip" data-pros="${k}" aria-pressed="${st.pros.has(k)}" title="${esc(PROSF[k])}">${l} <span class="n">${DATA.filter(c => c.pro === k).length}</span></button>`).join("");
  syncProsMode();
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
  [...st.flag].forEach(v => chips.push({ k: "flag", v, label: FLAGS[v] }));
  [...st.pros].forEach(v => chips.push({ k: "pros", v, label: PROSF[v] }));
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
  if (isPros()) return base().filter(c => {
    if (q && !(c.n.toLowerCase().includes(q) || (c.orgnr || "").includes(q) || c.ps.toLowerCase().includes(q) || (c.adr || "").toLowerCase().includes(q) || (c.kj || "").toLowerCase().includes(q))) return false;
    return inSet(st.reg, c.r) && inSet(st.by, c.ps) && inSet(st.kj, c.kj);
  });
  return CUST().filter(c => {
    if (q && !(c.n.toLowerCase().includes(q) || c.k.includes(q) || c.ps.toLowerCase().includes(q) || c.kom.toLowerCase().includes(q) || c.br.toLowerCase().includes(q) || (c.adr || "").toLowerCase().includes(q))) return false;
    if (st.flag.has("vbl") && !c.vbl) return false;
    if (st.flag.has("bv") && !c.bv) return false;
    return inSet(st.reg, c.r) && inSet(st.by, c.ps) && inSet(st.eier, c.e) && inSet(st.kat, c.kat) && inSet(st.seg, c.s) && inSet(st.kj, c.kj) && inSet(st.ko, c.ko);
  });
}
function sorted(arr) {
  const a = arr.slice(), ro = r => { const i = REG_ORDER.indexOf(r); return i < 0 ? 99 : i };
  if (st.sort === "tot") a.sort((x, y) => (y.t || y.oms || 0) - (x.t || x.oms || 0));
  else if (st.sort === "navn") a.sort((x, y) => x.n.localeCompare(y.n, "nb"));
  else if (st.sort === "by") a.sort((x, y) => (x.ps || "~").localeCompare(y.ps || "~", "nb") || y.t - x.t);
  else a.sort((x, y) => ro(x.r || "~") - ro(y.r || "~") || x.ps.localeCompare(y.ps, "nb") || y.t - x.t);
  return a;
}
function prosRowHtml(c) {
  const where = [c.ps, c.r && c.r !== c.ps ? c.r : ""].filter(Boolean).join(" · ");
  return `<button type="button" class="row${st.sel === c.k ? " sel" : ""}" data-k="${esc(c.k)}">
    <span class="seg P ${c.pro}" title="Prospekt: ${esc(PLABEL[c.pro])}">P</span>
    <span class="nm">${esc(c.n)}</span>
    <span class="amt">${c.oms != null ? mnok(c.oms) : ""}<small>${esc(c.orgnr)}</small></span>
    <span class="meta">${esc(PLABEL[c.pro])}${c.kj && c.kj !== "Frittstående" ? " · " + esc(c.kj) : ""}${where ? " · " + esc(where) : ""}${c.lat == null ? '<span class="nopin">mangler sted</span>' : ""}</span>
  </button>`;
}
function rowHtml(c) {
  if (c.pro) return prosRowHtml(c);
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
  if (!arr.length) { L.innerHTML = isPros() ? `<div class="empty">Ingen prospekter passer filtrene. Region, poststed, kjede og søk gjelder også for prospekter.</div>` : `<div class="empty">Ingen kunder passer filtrene. Prøv et annet søk eller trykk Nullstill.</div>`; return }
  let html = "";
  const groupKey = st.sort === "reg" ? c => c.r || "Mangler sted" : st.sort === "by" ? c => c.ps || "Mangler sted" : null;
  if (groupKey) {
    let cur = null, buf = [];
    const flush = () => { if (cur !== null) { const sum = buf.reduce((s, c) => s + c.t, 0); html += `<div class="grp"><span>${esc(cur)}</span><span>${buf.length}${isPros() ? "" : " · " + krK(sum)}</span></div>` + buf.map(rowHtml).join("") } };
    arr.forEach(c => { const g = groupKey(c); if (g !== cur) { flush(); cur = g; buf = [] } buf.push(c) }); flush();
  } else html = arr.map(rowHtml).join("");
  L.innerHTML = html;
}

/* ---------------- kart ---------------- */
let map, tiles, komLayer, custLayer, chargeLayer, labelLayer, lastBounds = null, tileFails = 0;
function initMap() {
  if (map) return;
  const O = OMRAADER[mittOmraade()] || OMRAADER.nord;
  map = L.map("map", { zoomSnap: .25, preferCanvas: true, minZoom: 4, maxZoom: 18, zoomControl: false }).setView(O.senter, O.zoom);
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
  // Kundene grupperes etter avstand på skjermen; gruppene deles opp når man zoomer inn.
  // Kunder på nøyaktig samme sted (samme bygg) spres i en vifte når man klikker på gruppen.
  custLayer = L.markerClusterGroup({
    maxClusterRadius: z => z >= 14 ? 22 : z >= 11 ? 34 : 46,
    showCoverageOnHover: false, spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true,
    spiderfyDistanceMultiplier: 1.8, chunkedLoading: true, removeOutsideVisibleBounds: true,
    iconCreateFunction: cl => {
      const n = cl.getChildCount(), sz = Math.min(44, 22 + Math.sqrt(n) * 4);
      const b = cl.getBounds(), samme = b.getNorthEast().equals(b.getSouthWest());
      return L.divIcon({ className: "", html: `<div class="stackicon${samme ? " samme" : ""}" style="width:${sz}px;height:${sz}px">${n}</div>`, iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] });
    }
  }).addTo(map);
  custLayer.on("clustermouseover", e => {
    const ms = e.layer.getAllChildMarkers(), b = e.layer.getBounds(), samme = b.getNorthEast().equals(b.getSouthWest());
    const navn = ms.slice(0, 6).map(m => esc(m.options.kkNavn || "")).join("<br>") + (ms.length > 6 ? `<br>… og ${ms.length - 6} til` : "");
    e.layer.bindTooltip(`<b>${ms.length} ${samme ? "på samme adresse" : "kunder her"}</b> · klikk for å ${samme ? "spre dem ut" : "zoome inn"}<br>${navn}`, { direction: "top", sticky: false }).openTooltip();
  });
  custLayer.on("clustermouseout", e => e.layer.closeTooltip());
  chargeLayer = L.layerGroup(); labelLayer = L.layerGroup();
  komLayer = L.geoJSON(GEO.kommuner, {
    style: komStyle,
    onEachFeature: (f, l) => l.bindTooltip(`${f.properties.kommunenavn} · ${GEO.regmap[f.properties.kommunenummer] || ""}`, { sticky: true, direction: "top", opacity: .9 })
  }).addTo(map);
  Object.entries(GEO.reglab).forEach(([r, [la, lo]]) => L.marker([la, lo], { interactive: false, icon: L.divIcon({ className: "rlabel", html: esc(r), iconSize: null }) }).addTo(labelLayer));
  const syncLabels = () => { const z = map.getZoom(); if (z >= 6 && z < 9) labelLayer.addTo(map); else labelLayer.remove() };
  map.on("zoomend", syncLabels); syncLabels();
  let downAt = null;
  map.getContainer().addEventListener("pointerdown", e => downAt = [e.clientX, e.clientY], true);
  map.getContainer().addEventListener("mousedown", e => downAt = [e.clientX, e.clientY], true);
  map.on("click", e => {
    const o = e.originalEvent;
    if (downAt && o && Math.hypot(o.clientX - downAt[0], o.clientY - downAt[1]) > 6) return; // var et dra, ikke et klikk
    closeDetail();
  });
  map.on("popupopen", e => e.popup.getElement().querySelectorAll("button[data-k]").forEach(b => b.onclick = () => { map.closePopup(); pickCustomer(b.dataset.k) }));
  window.addEventListener("resize", () => map.invalidateSize());
}
function komStyle(f) {
  const hit = st.reg.size > 0 && st.reg.has(GEO.regmap[f.properties.kommunenummer]);
  return { color: css("--kom-line"), weight: hit ? 1.2 : .6, fillColor: css("--accent"), fillOpacity: hit ? .12 : 0 };
}
function renderMap(arr, fit) {
  custLayer.clearLayers();
  const pts = [], ms = [];
  arr.forEach(c => {
    if (c.lat == null) return;
    const ll = [+c.lat, +c.lon]; pts.push(ll);
    let m;
    if (c.pro) {
      m = L.marker(ll, { kkNavn: c.n, icon: L.divIcon({ className: "", html: `<div class="prosicon" style="background:${css(c.pro === "tak" ? "--pros-tak" : "--pros-bv")}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }) });
      m.bindTooltip(`${esc(c.n)} · ${esc(PLABEL[c.pro])}${c.oms != null ? " · " + mnok(c.oms) : ""}`, { direction: "top" });
    } else {
      m = L.circleMarker(ll, { kkNavn: c.n, radius: { A: 10, B: 8.5, C: 7, D: 5.5 }[c.s] || 6, color: "#fff", weight: 1.5, fillColor: css(c.kat === "Profil" ? "--profil" : "--vent"), fillOpacity: .95, bubblingMouseEvents: false });
      m.bindTooltip(`${esc(c.n)} · ${krK(c.t)}${c.pr === "poststed" ? " · plassert på poststed" : ""}`, { direction: "top" });
    }
    m.on("click", () => pickCustomer(c.k));
    ms.push(m);
  });
  custLayer.addLayers(ms);
  $("sPin").textContent = nf.format(arr.filter(c => c.lat != null).length);
  if (fit && pts.length) {
    // Hold kartet på hovedområdet (ikke zoom ut for enkeltkunder i Oslo eller på Svalbard)
    const O = OMRAADER[mittOmraade()] || OMRAADER.nord, inn = p => Math.abs(p[0] - O.senter[0]) < 6 && Math.abs(p[1] - O.senter[1]) < 14;
    const np = pts.filter(inn);
    const b = L.latLngBounds(np.length && ![...st.reg].some(r => /^Utenfor /.test(r) || r === "Svalbard") ? np : pts);
    lastBounds = [b.pad(.2), pts.length === 1 ? 11 : 11];
    if (map.getSize().x > 0) map.fitBounds(lastBounds[0], { maxZoom: lastBounds[1] });
  }
  komLayer.setStyle(komStyle);
}

/* ---------------- detaljer ---------------- */
function pickCustomer(k) {
  if (window.KK.pick && window.KK.pick(k)) return; // planleggeren tok klikket
  select(k, false);
}
function closeDetail() {
  if ($("detail").hidden) return;
  $("detail").hidden = true; st.sel = null;
  document.querySelectorAll(".row.sel").forEach(r => r.classList.remove("sel"));
}
function hav(a, b, c, d) { const R = 6371, t = x => x * Math.PI / 180, dl = t(c - a), dn = t(d - b); const h = Math.sin(dl / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
function select(k, pan = true) {
  st.sel = k; const c = DATA.find(x => x.k === k); if (!c) return;
  document.querySelectorAll(".row.sel").forEach(r => r.classList.remove("sel"));
  const r = document.querySelector(`.row[data-k="${CSS.escape(k)}"]`); if (r) r.classList.add("sel");
  if (c.pro) return selectPros(c, pan);
  const share = c.t ? Math.round(c.p / c.t * 100) : 0;
  const q = encodeURIComponent([c.n, c.adr, c.ps].filter(Boolean).join(", "));
  let near = "";
  if (CHARGERS && c.lat != null) {
    const n = CHARGERS.list.map(s => [hav(c.lat, c.lon, s[0], s[1]), s]).sort((a, b) => a[0] - b[0]).slice(0, 3);
    near = `<div class="sub">Nærmeste ladestasjoner</div><div class="chg">${n.map(([d, s]) => `<div><span>${esc(s[2])}${s[4] ? ` · ${s[4]} kW` : ""}${window.KKProfil && window.KKProfil.lade(s[4]) ? ` <span class="mut">(din bil ${window.KKProfil.lade(s[4]).kw} kW, ~${window.KKProfil.lade(s[4]).min} min)</span>` : ""}</span><span>${d < 1 ? "<1" : d.toFixed(d < 10 ? 1 : 0)} km</span></div>`).join("")}</div>`;
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
      ${c.kj ? `<dt>Kjede</dt><dd>${esc(c.kj)}</dd>` : ""}
      ${c.ko ? `<dt>Konstellasjon</dt><dd>${esc(c.ko)}</dd>` : ""}
      ${c.vbl || c.bv ? `<dt>Merket</dt><dd>${[c.vbl ? "VBL-medlem" : "", c.bv ? "Byggvareforhandler" : ""].filter(Boolean).join(" · ")}</dd>` : ""}
      <dt>Omsetning</dt><dd><b>${kr(c.t)}</b></dd>
    </dl>
    <div><div class="bar" title="Profil ${share} %"><span style="width:${share}%"></span><span style="width:${100 - share}%"></span></div>
      <div class="barlbl"><span>Profil ${kr(c.p)}</span><span>Ventilasjon ${kr(c.v)}</span></div></div>
    ${c.lat == null ? `<div class="box warn">Kunden mangler sted og vises ikke i kartet. Legg inn poststed under, så ser alle kunden i kartet.</div>` :
      rett ? `<div class="box warn">Sted satt av ${esc(rett.endret_av)}. Plassert midt i ${esc(c.ps)}.</div>` :
      c.pr === "adresse" ? `<div class="status">Adresse fra ${esc(c.akilde || "register")}${c.orgnr ? `, org.nr. ${esc(c.orgnr)}` : ""}${c.asikk && c.asikk !== "høy" ? ` · sikkerhet ${esc(c.asikk)}` : ""}.</div>` :
      c.pr !== "postnr" ? `<div class="box warn">Plassert midt i ${esc(c.ps)}. Nøyaktig plassering krever besøksadresse.</div>` : ""}
    ${(ME.rolle === "admin" || ME.rolle === "leder") ? `<form id="infoForm" class="infoform">
      <label class="f">Kjede<input id="iKj" list="kjList" value="${esc(c.kj)}" autocomplete="off"></label>
      <label class="f">Konstellasjon<input id="iKo" list="koList" value="${esc(c.ko)}" autocomplete="off"></label>
      <label class="chk"><input type="checkbox" id="iVbl" ${c.vbl ? "checked" : ""}> VBL-medlem</label>
      <label class="chk"><input type="checkbox" id="iBv" ${c.bv ? "checked" : ""}> Byggvareforhandler</label>
      <button class="btn" type="submit">Lagre</button><span class="status" id="infoMsg"></span>
      <datalist id="kjList">${[...new Set(DATA.map(x => x.kj).filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join("")}</datalist>
      <datalist id="koList">${[...new Set(DATA.map(x => x.ko).filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join("")}</datalist>
    </form>` : ""}
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
  $("dx").onclick = closeDetail;
  if ($("dZoom")) $("dZoom").onclick = () => { showMap(); map.setView([c.lat, c.lon], Math.max(map.getZoom(), 12)) };
  if ($("dUnfix")) $("dUnfix").onclick = async () => {
    const { error } = await sb.from("sted_rettelse").delete().eq("kundenr", c.k);
    if (error) { $("fixMsg").textContent = "Kunne ikke fjerne: " + error.message; return }
    delete RETT[c.k]; refreshData(false); select(k, false);
  };
  if ($("infoForm")) $("infoForm").onsubmit = async e => {
    e.preventDefault();
    const row = { kundenr: c.k, kjede: $("iKj").value.trim() || null, konstellasjon: $("iKo").value.trim() || null, vbl: $("iVbl").checked, byggvare: $("iBv").checked };
    $("infoMsg").textContent = "Lagrer …";
    const { data, error } = await sb.from("kunde_info").upsert(row).select().single();
    if (error) { $("infoMsg").textContent = "Kunne ikke lagre: " + error.message; return }
    INFO[c.k] = data; refreshData(false); select(k, false);
  };
  if ($("adrForm")) $("adrForm").onsubmit = async e => {
    e.preventDefault();
    const v = $("adrIn").value.trim(); if (!v) return;
    $("adrMsg").textContent = "Slår opp adressen hos Kartverket …";
    try {
      const g = await window.KKAdr.geocodeFree(v);
      if (!g) { $("adrMsg").textContent = "Fant ikke adressen hos Kartverket. Skriv gate, nummer og postnummer."; return }
      const row = { kundenr: c.k, adresse: g.adresse, postnr: g.postnr, poststed: g.poststed, kommunenr: g.kommunenr, region: GEO.regmap[g.kommunenr] || utenfor(c.om), lat: g.lat, lon: g.lon, orgnr: c.orgnr || null, kilde: "Lagt inn manuelt", sikkerhet: "manuell" };
      const { data, error } = await sb.from("kunde_adresse").upsert(row).select().single();
      if (error) { $("adrMsg").textContent = "Kunne ikke lagre: " + error.message; return }
      ADR[c.k] = data; refreshData(false); select(k, false);
    } catch (err) { $("adrMsg").textContent = "Oppslaget feilet: " + err.message }
  };
  $("fixForm").onsubmit = async e => {
    e.preventDefault();
    const v = $("fixIn").value.trim();
    const hit = Object.keys(GEO.poststeder).find(p => p.toLowerCase() === v.toLowerCase());
    if (!hit) { $("fixMsg").textContent = "Fant ikke poststedet. Velg et sted fra lista, eller legg inn adressen over."; return }
    const [lat, lon, region] = GEO.poststeder[hit];
    $("fixMsg").textContent = "Lagrer …";
    const { data, error } = await sb.from("sted_rettelse").upsert({ kundenr: c.k, poststed: hit, lat, lon, region }).select().single();
    if (error) { $("fixMsg").textContent = "Kunne ikke lagre: " + error.message; return }
    RETT[c.k] = data; refreshData(false); select(k, false);
  };
  if (pan && c.lat != null && window.innerWidth > 760) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 10));
}
function refreshData(fit) { DATA = RAW.map(applyFix).concat(PROS); buildFilters(); render(fit) }

/* ---------------- prospekter ---------------- */
function syncProsMode() {
  const on = isPros();
  ["fEier", "fKat", "fKo", "fSeg", "fFlag"].forEach(id => $(id).classList.toggle("dim", on));
  document.querySelectorAll(".lgpros").forEach(e => e.hidden = !on);
  $("q").placeholder = on ? "Firmanavn, org.nr., kjede eller sted" : "Kundenavn, kundenr. eller sted";
}
function selectPros(c, pan) {
  const q = encodeURIComponent([c.n, c.adr, c.ps].filter(Boolean).join(", "));
  const canEdit = ME.rolle === "admin" || ME.rolle === "leder";
  const brregUrl = `https://virksomhet.brreg.no/nb/oppslag/${c.pro === "tak" ? "enheter" : "underenheter"}/${c.orgnr}`;
  let near = "";
  if (c.lat != null) {
    const n = CUST().filter(x => x.lat != null).map(x => [hav(c.lat, c.lon, x.lat, x.lon), x]).sort((a, b) => a[0] - b[0]).slice(0, 3);
    if (n.length) near = `<div class="sub">Nærmeste kunder</div><div class="chg">${n.map(([d, x]) => `<div><span>${esc(x.n)} · ${esc(x.s)}</span><span>${d < 1 ? "<1" : d.toFixed(d < 10 ? 1 : 0)} km</span></div>`).join("")}</div>`;
  }
  $("detail").innerHTML = `<button type="button" class="x" id="dx" aria-label="Lukk">×</button>
    <div><span class="ptag ${c.pro}">Prospekt · ${esc(PLABEL[c.pro])}</span></div>
    <h2>${esc(c.n)}</h2>
    <dl class="kv">
      <dt>Org.nr.</dt><dd>${esc(c.orgnr)}${c.hoved && c.hoved !== c.orgnr ? ` <span class="mut">(selskap ${esc(c.hoved)})</span>` : ""}</dd>
      <dt>Sted</dt><dd>${c.ps ? esc(c.ps) : "<em>Ikke oppgitt</em>"}</dd>
      ${c.adr ? `<dt>Adresse</dt><dd>${esc(c.adr)}${c.pnr ? `, ${esc(c.pnr)}` : ""}</dd>` : ""}
      <dt>Region</dt><dd>${esc(c.r || "–")}</dd>
      ${c.kj ? `<dt>Kjede</dt><dd>${esc(c.kj)}</dd>` : ""}
      ${c.br ? `<dt>Næring</dt><dd>${esc(c.br)}</dd>` : ""}
      ${c.ans != null ? `<dt>Ansatte</dt><dd>${esc(c.ans)}</dd>` : ""}
      <dt>Omsetning</dt><dd>${c.oms != null ? `<b>${kr(c.oms)}</b>${c.aar ? ` <span class="mut">(${c.aar}${c.pro === "bv" ? ", hele selskapet" : ""})</span>` : ""}` : `<span class="mut">${c.kj && c.kj !== "Frittstående" ? "Del av kjede, tall for butikken finnes ikke" : "Ikke tilgjengelig"}</span>`}</dd>
      ${c.web ? `<dt>Nettside</dt><dd><a href="${esc(/^https?:/.test(c.web) ? c.web : "https://" + c.web)}" target="_blank" rel="noopener">${esc(c.web)}</a></dd>` : ""}
    </dl>
    <div class="prosnote">Står ikke på kundelista vår. Hentet fra Brønnøysundregistrene${c.pro === "tak" ? " (næringskode takarbeid eller «tak» i navnet, omsetning over 10 mill)" : " (detalj- og engroshandel med byggevarer)"}.</div>
    <div class="acts">
      <a class="btn pri" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Åpne i Google Maps ↗</a>
      ${c.lat != null ? `<button type="button" class="btn" id="dZoom">Vis i kart</button>` : ""}
      <a class="btn" href="${brregUrl}" target="_blank" rel="noopener">Brønnøysund ↗</a>
      <a class="btn" href="https://www.proff.no/bransjesøk?q=${esc(c.hoved || c.orgnr)}" target="_blank" rel="noopener">Proff ↗</a>
      ${canEdit ? `<button type="button" class="btn" id="dHide" title="Fjern fra prospektlista for alle">Skjul prospekt</button>` : ""}
    </div>
    <div class="status" id="prosMsg"></div>
    ${near}`;
  $("detail").hidden = false;
  $("dx").onclick = closeDetail;
  if ($("dZoom")) $("dZoom").onclick = () => { showMap(); map.setView([c.lat, c.lon], Math.max(map.getZoom(), 12)) };
  if ($("dHide")) $("dHide").onclick = async () => {
    $("prosMsg").textContent = "Skjuler …";
    const { error } = await sb.from("prospekter").update({ skjult: true }).eq("orgnr", c.orgnr);
    if (error) { $("prosMsg").textContent = "Kunne ikke skjule: " + error.message; return }
    PROS = PROS.filter(x => x.k !== c.k); closeDetail(); refreshData(false);
  };
  if (pan && c.lat != null && window.innerWidth > 760) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 10));
}

/* ---------------- ladestasjoner (NOBIL via Edge Function) ---------------- */
function drawChargers() {
  chargeLayer.clearLayers(); if (!CHARGERS) return;
  const fast = store.get("kk_fast", false);
  CHARGERS.list.forEach(s => {
    if (fast && s[4] < 50) return;
    L.circleMarker([s[0], s[1]], { radius: s[4] >= 50 ? 5 : 3.5, color: "#fff", weight: 1, fillColor: css("--charge"), fillOpacity: 1 })
      .bindPopup(`<div class="pop"><h4>⚡ ${esc(s[2])}</h4>${esc(s[3])}<br>${s[4] ? `Inntil ${s[4]} kW · ` : ""}${s[5] ? `${s[5]} ladepunkt` : ""}<br><span class="mut">${esc(s[6])}</span>${window.KKProfil ? window.KKProfil.ladeTekst(s[4]) : ""}</div>`).addTo(chargeLayer);
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
  ${CHARGERS ? `<div class="status">${nf.format(CHARGERS.list.length)} stasjoner i Nord-Norge og Rogaland${when ? `, oppdatert fra NOBIL ${when}` : ""}.</div>
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
  $("sCount").textContent = nf.format(arr.length); $("sTot").textContent = isPros() ? mnok(arr.reduce((s, c) => s + (c.oms || 0), 0)) : krK(tot) + " kr";
  $("sCountL").textContent = isPros() ? "Prospekter" : "Kunder"; $("sTotL").textContent = isPros() ? "Kjent omsetning" : "Omsetning 12 mnd";
  $("lCount").textContent = isPros() ? `${arr.length} av ${base().length} prospekter` : `${arr.length} av ${CUST().length} kunder`;
  renderList(arr); renderMap(arr, fit);
}
let qT = null;
$("q").oninput = e => { st.q = e.target.value; clearTimeout(qT); qT = setTimeout(() => { renderActive(); render(false) }, 120) };
document.querySelector(".filters").addEventListener("click", e => { const b = e.target.closest(".msbtn"); if (b) openPop(b.dataset.k) });
document.addEventListener("click", e => { if (!e.target.closest(".ms")) closePops() });
document.addEventListener("keydown", e => { if (e.key === "Escape") { closePops(); if (!document.querySelector(".dlg:not([hidden])")) closeDetail() } });
/* Lukk kundekortet ved klikk utenfor: i kartet via Leaflet (ikke etter dra), ellers via dokumentet */
let ptrDown = null;
document.addEventListener("pointerdown", e => ptrDown = { x: e.clientX, y: e.clientY, t: e.target }, true);
document.addEventListener("click", e => {
  if ($("detail").hidden) return;
  if (ptrDown && (Math.hypot(e.clientX - ptrDown.x, e.clientY - ptrDown.y) > 6 || ptrDown.t.closest("#detail"))) return; // dra eller markering, ikke klikk
  if (e.target.closest("#detail, .row, .leaflet-container, .maptools, .legend, .dlg, #cpanel, .ms, .achip, .switch, .top")) return;
  closeDetail();
});
$("fFlag").onclick = e => { const b = e.target.closest("[data-flag]"); if (!b) return; const s = b.dataset.flag; st.flag.has(s) ? st.flag.delete(s) : st.flag.add(s); b.setAttribute("aria-pressed", st.flag.has(s)); applyFilters() };
$("fPros").onclick = e => { const b = e.target.closest("[data-pros]"); if (!b) return; const s = b.dataset.pros; st.pros.has(s) ? st.pros.delete(s) : st.pros.add(s); closeDetail(); saveFilters(); buildFilters(); render(true) };
$("fSeg").onclick = e => { const b = e.target.closest("[data-seg]"); if (!b) return; const s = b.dataset.seg; st.seg.has(s) ? st.seg.delete(s) : st.seg.add(s); b.setAttribute("aria-pressed", st.seg.has(s)); applyFilters() };
$("activeF").onclick = e => {
  if (e.target.closest(".aclear")) return $("reset").click();
  const c = e.target.closest(".achip"); if (!c) return;
  const k = c.dataset.k, v = c.dataset.v;
  if (k === "q") { st.q = ""; $("q").value = "" } else st[k].delete(v);
  if (k === "seg") document.querySelector(`[data-seg="${v}"]`).setAttribute("aria-pressed", "false");
  if (k === "flag") document.querySelector(`[data-flag="${v}"]`).setAttribute("aria-pressed", "false");
  if (k === "pros") { st.pros.delete(v); saveFilters(); buildFilters(); render(true); return }
  if (FKEYS[k]) { const w = $("f" + k[0].toUpperCase() + k.slice(1)); w.querySelector(".msbtn").innerHTML = msButtonText(k) + `<span class="caret" aria-hidden="true">▾</span>` }
  saveFilters(); renderActive(); render(true);
};
$("sort").onchange = e => { st.sort = e.target.value; store.set("kk_sort", st.sort); render(false) };
$("reset").onclick = () => { st.q = ""; ["reg", "by", "eier", "kat", "seg", "kj", "ko", "flag", "pros"].forEach(k => st[k].clear()); saveFilters(); buildFilters(); render(true) };
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
  sb, get map() { return map }, get DATA() { return DATA }, get CHARGERS() { return CHARGERS }, pick: null,
  select: (k) => select(k, false), closeDetail: () => closeDetail(), invalidate: () => map && map.invalidateSize(), get RAW() { return RAW }, get GEO() { return GEO }, get ADR() { return ADR }, get INFO() { return INFO }, OMRAADER, mittOmraade, utenfor, get ME() { return ME },
  async reloadKunder() {
    const [k, a, inf] = await Promise.all([sb.from("kunder").select("*"), sb.from("kunde_adresse").select("*"), sb.from("kunde_info").select("*")]);
    if (k.error) throw k.error;
    RAW = k.data.map(fromDb);
    ADR = {}; (a.data || []).forEach(x => ADR[x.kundenr] = x);
    INFO = {}; (inf.data || []).forEach(x => INFO[x.kundenr] = x);
    refreshData(false);
  },
  setAdr(rows) { rows.forEach(x => ADR[x.kundenr] = x); refreshData(false) }
};
/* ---------- toppmeny: faner og konto ---------- */
function syncTabs() {
  const cal = window.KKCal && window.KKCal.open, pl = window.KKPlan && window.KKPlan.open, bk = window.KKBook && window.KKBook.open;
  $("tKunder").setAttribute("aria-pressed", !cal && !pl && !bk);
  $("tPlan").setAttribute("aria-pressed", !cal && !bk && !!pl);
  $("tCal").setAttribute("aria-pressed", !!cal);
  $("tBook").setAttribute("aria-pressed", !!bk);
}
document.addEventListener("kk:view", syncTabs);
document.addEventListener("kk:profil", () => { if (CHARGERS && chargeLayer && map && map.hasLayer(chargeLayer)) drawChargers() });
const closeBook = () => { if (window.KKBook && window.KKBook.open) window.KKBook.toggle(false) };
$("tBook").onclick = () => { if (window.KKCal.open) window.KKCal.toggle(false); if (!window.KKBook.open) window.KKBook.toggle(true); syncTabs() };
$("tKunder").onclick = async () => { closeBook(); if (window.KKCal.open) window.KKCal.toggle(false); if (window.KKPlan.open) await window.KKPlan.toggle(false); syncTabs() };
$("tPlan").onclick = async () => { closeBook(); if (window.KKCal.open) window.KKCal.toggle(false); if (!window.KKPlan.open) await window.KKPlan.toggle(true); syncTabs() };
$("tCal").onclick = () => { closeBook(); if (!window.KKCal.open) window.KKCal.toggle(true); syncTabs() };
const acctMenu = $("acctMenu"), acctBtn = $("acctBtn");
const closeAcct = () => { acctMenu.hidden = true; acctBtn.setAttribute("aria-expanded", "false") };
acctBtn.onclick = e => { e.stopPropagation(); const o = acctMenu.hidden; acctMenu.hidden = !o; acctBtn.setAttribute("aria-expanded", String(o)) };
acctMenu.addEventListener("click", e => { if (e.target.closest("button")) setTimeout(closeAcct, 0) });
document.addEventListener("click", e => { if (!acctMenu.hidden && !e.target.closest(".acct")) closeAcct() });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeAcct() });
/* datalist med poststeder lastes når geodata er hentet */
const _start = start;
start = async function () {
  await _start();
  if (GEO && !$("psList")) document.body.insertAdjacentHTML("beforeend", `<datalist id="psList">${Object.keys(GEO.poststeder).sort((a, b) => a.localeCompare(b, "nb")).map(p => `<option value="${esc(p)}">`).join("")}</datalist>`);
};
start();
})();
