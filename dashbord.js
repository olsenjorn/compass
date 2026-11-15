/* «I dag»: hovedfanen. Kort oppsummering av dagens reisedag fra ruteplanene, en liten værmelding (MET Norway)
   og hindringer langs kjøreruta i tidsrommet man faktisk kjører: vegmeldinger (Statens vegvesen), farevarsler (MET)
   og fergestrekninger. Data: MET Norway (CC BY 4.0), Statens vegvesen (NLOD). */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KK = () => window.KK;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = v => v == null ? "–" : `${String(Math.floor(((v % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(Math.round(v) % 60).padStart(2, "0")}`;
const dur = v => { v = Math.round(v || 0); const h = Math.floor(v / 60), m = v % 60; return h ? `${h} t${m ? ` ${m} min` : ""}` : `${m} min` };
const naaMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() };
const tidspunkt = (dato, min) => { const d = new Date(dato + "T00:00:00"); d.setMinutes(Math.round(min || 0)); return d };
const datoTxt = s => new Date(s + "T12:00").toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" });
const ss = { get(k) { try { const v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null } catch (e) { return null } }, set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };

let open = false, laster = false, feil = "", sist = 0;
let dag = null;        // { plan, i, d, s } – dagens reisedag (første om det er flere)
let flere = [];        // alle mine reisedager i dag
let neste = null;      // neste reisedag når det ikke er noen i dag
let vaer = null, vaerFeil = "", hindre = null, hindreFeil = "";

/* ---------- data: mine ruteplaner ---------- */
async function hentDager() {
  const me = KK().ME, idag = iso(new Date());
  const { data, error } = await KK().sb.from("ruteplaner").select("id,tittel,laget_av,data").eq("laget_av", me.epost);
  if (error) throw error;
  const alle = [];
  (data || []).forEach(p => ((p.data && p.data.dager) || []).forEach((d, i) => { if (d && d.dato) alle.push({ plan: p, i, d, s: p.data.sammendrag && p.data.sammendrag[i] }) }));
  alle.sort((a, b) => a.d.dato.localeCompare(b.d.dato) || ((a.s && a.s.start) ?? 0) - ((b.s && b.s.start) ?? 0));
  flere = alle.filter(x => x.d.dato === idag);
  dag = flere[0] || null;
  neste = dag ? null : alle.find(x => x.d.dato > idag) || null;
}

/* ---------- punkter og etapper for dagen ---------- */
function hjem() {
  const p = window.KKProfil && window.KKProfil.p; if (p && p.hjem && p.hjem.lat != null) return [p.hjem.lat, p.hjem.lon];
  try { const h = JSON.parse(localStorage.getItem("kk_home") || "null"); if (h && h.lat != null) return [h.lat, h.lon] } catch (e) { }
  const o = KK().OMRAADER && KK().mittOmraade && KK().OMRAADER[KK().mittOmraade()]; return o && o.hjem ? [o.hjem.lat, o.hjem.lon] : null;
}
const kunde = k => (KK().DATA || []).find(c => c.k === k);
function startPt(x) {
  if (x.s && x.s.startPt) return x.s.startPt;
  const st = x.d.start || {};
  if (st.lat != null) return [st.lat, st.lon];
  if (st.type === "hjem") return hjem();
  if (st.type === "fly" && window.KKPlan) { const f = (window.KKPlan.FLYPLASSER || []).find(a => a[0] === st.flyplass || a[1] === st.flyplass); if (f) return [f[2], f[3]] }
  return null;
}
function stoppPt(e, x) {
  if (e.pt) return e.pt;
  if (e.type === "kunde") { const c = kunde(e.k); return c && c.lat != null ? [c.lat, c.lon] : null }
  const sl = x.d.slutt;
  if (sl && e.type === sl.type) { if (sl.lat != null) return [sl.lat, sl.lon]; if (sl.type === "hjem") return hjem() }
  return null;
}
function stedNavn(e) {
  if (e.type === "kunde") { const c = kunde(e.k); return c ? c.ps || "" : "" }
  if (e.type === "hjem") return "Hjemme";
  return (e.sted || "").split(",").pop().replace(/^\s*\d{4}\s*/, "").trim() || e.navn || "";
}
// Rekkefølge med tidsvindu for hver etappe: [fra-tidspunkt, ankomst]
function etapper(x) {
  if (!x.s) return [];
  let prev = startPt(x), prevNavn = (x.s.fra || "Start"), t = x.s.start ?? 480;
  const ut = [];
  (x.s.stopp || []).forEach(e => {
    if (e.type === "lunsj") { if (e.underveis) return; t = e.til ?? t; return }
    if (e.skip) return;
    const pt = stoppPt(e, x);
    if (pt && prev) ut.push({ fra: prev, til: pt, fraT: t, tilT: e.ankomst ?? t, mot: e, fraNavn: prevNavn });
    if (pt) { prev = pt; prevNavn = e.navn }
    t = e.til ?? e.ankomst ?? t;
  });
  return ut;
}

/* ---------- vær (MET locationforecast) ---------- */
const VTXT = { clearsky: "Klarvær", fair: "Lettskyet", partlycloudy: "Delvis skyet", cloudy: "Skyet", fog: "Tåke",
  lightrain: "Lett regn", rain: "Regn", heavyrain: "Kraftig regn", lightrainshowers: "Lette regnbyger", rainshowers: "Regnbyger", heavyrainshowers: "Kraftige regnbyger",
  lightsleet: "Lett sludd", sleet: "Sludd", heavysleet: "Kraftig sludd", lightsleetshowers: "Lette sluddbyger", sleetshowers: "Sluddbyger", heavysleetshowers: "Kraftige sluddbyger",
  lightsnow: "Lett snø", snow: "Snø", heavysnow: "Kraftig snø", lightsnowshowers: "Lette snøbyger", snowshowers: "Snøbyger", heavysnowshowers: "Kraftige snøbyger" };
function vIkon(code) {
  const c = String(code || ""), b = c.split("_")[0], natt = c.endsWith("_night") || c.endsWith("_polartwilight");
  if (c.includes("thunder")) return "⛈";
  if (b.includes("snow") || b.includes("sleet")) return "🌨";
  if (b.includes("rainshowers")) return "🌦";
  if (b.includes("rain")) return "🌧";
  return { fog: "🌫", cloudy: "☁️", partlycloudy: natt ? "☁️" : "⛅", fair: natt ? "🌙" : "🌤", clearsky: natt ? "🌙" : "☀️" }[b] || "🌡";
}
const vTekst = code => { const b = String(code || "").split("_")[0].replace("andthunder", ""); return (VTXT[b] || "") + (String(code).includes("thunder") ? " og torden" : "") };
async function prognose(pt) {
  const lat = pt[0].toFixed(2), lon = pt[1].toFixed(2), key = `kk_met_${lat},${lon}`, c = ss.get(key);
  if (c && Date.now() - c.t < 30 * 60000) return c.d;
  const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`);
  if (!r.ok) throw new Error("MET svarte " + r.status);
  const j = await r.json(), d = j.properties.timeseries.slice(0, 60).map(x => ({ t: Date.parse(x.time), i: x.data.instant.details,
    s1: x.data.next_1_hours && x.data.next_1_hours.summary.symbol_code, s6: x.data.next_6_hours && x.data.next_6_hours.summary.symbol_code,
    p1: x.data.next_1_hours ? x.data.next_1_hours.details.precipitation_amount : null, p6: x.data.next_6_hours ? x.data.next_6_hours.details.precipitation_amount : null }));
  ss.set(key, { t: Date.now(), d });
  return d;
}
const naermest = (ts, T) => ts.reduce((b, x) => Math.abs(x.t - T) < Math.abs(b.t - T) ? x : b, ts[0]);
async function farevarsler(pt) {
  const lat = pt[0].toFixed(2), lon = pt[1].toFixed(2), key = `kk_metal_${lat},${lon}`, c = ss.get(key);
  if (c && Date.now() - c.t < 15 * 60000) return c.d;
  const r = await fetch(`https://api.met.no/weatherapi/metalerts/2.0/current.json?lat=${lat}&lon=${lon}`);
  if (!r.ok) return [];
  const j = await r.json(), d = (j.features || []).map(f => f.properties).filter(p => p.geographicDomain !== "marine")
    .map(p => ({ id: p.id, navn: p.eventAwarenessName, farge: (p.riskMatrixColor || "Yellow").toLowerCase(), omr: p.area, tekst: p.description, slutt: p.eventEndingTime, tittel: p.title }));
  ss.set(key, { t: Date.now(), d });
  return d;
}
// Punkter å vise vær for: der dagen starter og hvert stopp (ved ankomst), maks seks unike steder
function vaerPunkter() {
  const idag = iso(new Date()), nu = naaMin();
  if (!dag || !dag.s) { const h = hjem() || (KK().map ? [KK().map.getCenter().lat, KK().map.getCenter().lng] : null); return h ? [{ pt: h, navn: hjem() ? "Hjemme" : "Kartutsnittet", T: Date.now(), naa: true }] : [] }
  const ut = [], sett = new Set(), legg = (pt, navn, min) => {
    if (!pt) return; const k = pt[0].toFixed(1) + "," + pt[1].toFixed(1); if (sett.has(k) || ut.length >= 6) return; sett.add(k);
    ut.push({ pt, navn, min, T: tidspunkt(idag, Math.max(min, nu - 30)).getTime() });
  };
  legg(startPt(dag), dag.s.fra || "Start", dag.s.start ?? 480);
  (dag.s.stopp || []).forEach(e => { if (e.type !== "lunsj" && !e.skip) legg(stoppPt(e, dag), stedNavn(e) || e.navn, e.ankomst ?? e.fra) });
  return ut;
}
async function hentVaer() {
  vaerFeil = "";
  const pk = vaerPunkter(); if (!pk.length) { vaer = { pk: [] }; return }
  const res = await Promise.all(pk.map(async p => {
    const [ts, fv] = await Promise.all([prognose(p.pt), farevarsler(p.pt).catch(() => [])]);
    const x = naermest(ts, p.T);
    const idag = iso(new Date()), dagTs = ts.filter(y => iso(new Date(y.t)) === idag && y.t >= Date.now() - 3600e3);
    const temp = dagTs.map(y => y.i.air_temperature);
    return { ...p, x, fv, lo: temp.length ? Math.min(...temp) : null, hi: temp.length ? Math.max(...temp) : null,
      nedbor: dagTs.filter(y => y.p1 != null).reduce((s, y) => s + y.p1, 0) };
  }));
  vaer = { pk: res };
}

/* ---------- hindringer langs ruta ---------- */
const VEG_ALVOR = ["stengt", "kolonne", "periodevis", "ras", "ulykke", "fore", "ferje"];
async function hentHindre() {
  hindreFeil = ""; hindre = { veg: [], ferger: [], estimert: false, etapper: 0 };
  if (!dag) return;
  const V = window.KKVeg, P = window.KKPlan;
  if (V && !V.data) await V.load();
  const E = etapper(dag); hindre.etapper = E.length;
  const sett = new Set(), fsett = new Set();
  for (const e of E) {
    const L = P ? await P.leg(e.fra, e.til).catch(() => null) : null;
    if (!L) continue;
    if (L.est) hindre.estimert = true;
    if (V && V.data && L.geom && L.geom.length > 1) V.paaRute(L.geom, dag.d.dato, e.fraT, e.tilT).forEach(m => {
      if (sett.has(m.id)) return; sett.add(m.id);
      hindre.veg.push({ m, e, alvor: VEG_ALVOR.includes(m.kat) });
    });
    (L.ferger || []).forEach(f => { const k = f.navn + "|" + e.mot.navn; if (fsett.has(k)) return; fsett.add(k); hindre.ferger.push({ f, e }) });
  }
  hindre.veg.sort((a, b) => (b.alvor - a.alvor) || ((V.KAT[a.m.kat] || {}).rang - (V.KAT[b.m.kat] || {}).rang));
}

/* ---------- om dagens kunder: fakta (Brreg) og omtale i media siste 2 måneder ---------- */
let fakta = null, faktaFor = "";
const ls = { get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null } catch (e) { return null } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
const BR = "https://data.brreg.no/enhetsregisteret/api/";
const jget = async u => { const r = await fetch(u, { headers: { Accept: "application/json" } }); return r.ok ? r.json() : null };
const personNavn = p => p && p.navn ? [p.navn.fornavn, p.navn.mellomnavn, p.navn.etternavn].filter(Boolean).join(" ") : "";
const tittel = s => String(s || "").toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(As|Asa|Ans|Da|Sa)\b/g, m => m.toUpperCase());
async function brregFakta(orgnr) {
  const key = "kk_fakta_" + orgnr, c = ls.get(key);
  if (c && Date.now() - c.t < 7 * 864e5) return c.d;
  let u = await jget(BR + "underenheter/" + orgnr).catch(() => null), e = null, hoved = orgnr;
  if (u && u.overordnetEnhet) hoved = u.overordnetEnhet; else u = null;
  e = await jget(BR + "enheter/" + hoved).catch(() => null);
  const roller = e ? await jget(BR + "enheter/" + hoved + "/roller").catch(() => null) : null;
  const finn = kode => { for (const g of (roller && roller.rollegrupper) || []) for (const r of g.roller || []) if (r.type && r.type.kode === kode && !r.avregistrert && r.person) return tittel(personNavn(r.person)); return "" };
  const d = e ? {
    hoved, navn: e.navn, stiftet: e.stiftelsesdato || e.registreringsdatoEnhetsregisteret || "", avdStart: u ? u.oppstartsdato || "" : "",
    ansatte: e.harRegistrertAntallAnsatte ? e.antallAnsatte : null, avdAnsatte: u && u.harRegistrertAntallAnsatte ? u.antallAnsatte : null,
    naering: e.naeringskode1 ? e.naeringskode1.beskrivelse : "", konsern: !!e.erIKonsern, web: e.hjemmeside || "",
    dagl: finn("DAGL"), styreleder: finn("LEDE"), kommune: e.forretningsadresse ? tittel(e.forretningsadresse.kommune) : ""
  } : null;
  ls.set(key, { t: Date.now(), d });
  return d;
}
async function regnskap(orgnrs) {
  const ut = {}, mangler = [];
  orgnrs.forEach(o => { const c = ls.get("kk_regn_" + o); if (c && Date.now() - c.t < 7 * 864e5) ut[o] = c.d; else mangler.push(o) });
  if (mangler.length) {
    const { data } = await KK().sb.functions.invoke("regnskap", { body: { orgnr: mangler } });
    mangler.forEach(o => { const r = data && data.regnskap ? data.regnskap[o] : null; ut[o] = r && !r.error ? r : null; if (!(r && r.error)) ls.set("kk_regn_" + o, { t: Date.now(), d: ut[o] }) });
  }
  return ut;
}
async function media(c) {
  const { data, error } = await KK().sb.functions.invoke(`nyheter?k=${encodeURIComponent(c.k)}&navn=${encodeURIComponent(c.n)}`, { method: "GET" });
  if (error || !data || data.error) throw new Error((data && data.error) || (error && error.message) || "feil");
  const grense = Date.now() - 61 * 864e5;
  return { sok: data.sok, saker: (data.saker || []).filter(x => Date.parse(x.dato) >= grense).slice(0, 4) };
}
async function nettside(orgnr) {
  const key = "kk_web_" + orgnr, c = ls.get(key);
  if (c && Date.now() - c.t < 12 * 3600e3) return c.d;
  const { data, error } = await KK().sb.functions.invoke(`nettside?orgnr=${orgnr}`, { method: "GET" });
  if (error || !data || data.error) throw new Error((data && data.error) || (error && error.message) || "feil");
  ls.set(key, { t: Date.now(), d: data });
  return data;
}
// Kundene på dagen (eller neste reisedag), i besøksrekkefølge
function dagensKunder() {
  const x = dag || neste; if (!x) return { x: null, liste: [] };
  const fra = x.s ? (x.s.stopp || []).filter(e => e.type === "kunde" && !e.skip).map(e => ({ k: e.k, kl: e.fra }))
    : (x.d.stopp || []).filter(st => st.type !== "avtale" && st.status !== "avlyst" && st.status !== "utsatt").map(st => ({ k: st.k, kl: null }));
  return { x, liste: fra.map(e => ({ ...e, c: kunde(e.k) })).filter(e => e.c) };
}
async function hentFakta() {
  const { x, liste } = dagensKunder();
  const id = x ? x.plan.id + "|" + x.i + "|" + liste.map(e => e.k).join(",") : "";
  if (fakta && faktaFor === id) return;
  faktaFor = id; fakta = { x, liste: liste.map(e => ({ ...e, br: undefined, regn: undefined, med: undefined })) };
  if (!liste.length) return;
  render();
  await Promise.all(fakta.liste.map(async e => { e.br = e.c.orgnr ? await brregFakta(e.c.orgnr).catch(() => null) : null }));
  render();
  const hoveder = [...new Set(fakta.liste.map(e => e.br && e.br.hoved).filter(Boolean))];
  const rg = hoveder.length ? await regnskap(hoveder).catch(() => ({})) : {};
  fakta.liste.forEach(e => e.regn = e.br ? rg[e.br.hoved] || null : null);
  render();
  await Promise.all([
    (async () => { for (const e of fakta.liste) { try { e.med = await media(e.c) } catch (er) { e.med = { feil: true, saker: [] } } render() } })(),
    (async () => { for (const e of fakta.liste) { try { e.web = e.c.orgnr ? await nettside(e.c.orgnr) : null } catch (er) { e.web = { feil: true } } render() } })()
  ]);
}
const mill = v => v == null ? "" : Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("nb-NO", { maximumFractionDigits: 1 }) + " mill." : Math.round(v / 1000).toLocaleString("nb-NO") + " k";
function faktaPunkter(e) {
  const b = e.br, r = e.regn, c = e.c, ut = [], idag = new Date(), aar = idag.getFullYear();
  // Eldste dato av selskapets stiftelse og avdelingens oppstart: firmaet kan være eldre enn dagens selskap
  const datoer = b ? [b.stiftet, b.avdStart].filter(Boolean).sort() : [];
  if (datoer.length) {
    const sd = new Date(datoer[0]), alder = aar - sd.getFullYear();
    const jubDag = new Date(aar, sd.getMonth(), sd.getDate()), diff = Math.round((jubDag - new Date(aar, idag.getMonth(), idag.getDate())) / 864e5);
    const rundt = alder > 0 && alder % 5 === 0, dt = sd.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
    if (rundt && Math.abs(diff) <= 30) ut.push(`🎉 <b>${alder}-årsjubileum</b> ${diff === 0 ? "i dag" : diff > 0 ? `om ${diff} dager (${jubDag.toLocaleDateString("nb-NO", { day: "numeric", month: "long" })})` : `for ${-diff} dager siden`} – i drift siden ${dt}`);
    else if (rundt) ut.push(`🎉 Fyller <b>${alder} år</b> i år – i drift siden ${dt}`);
    else ut.push(`I drift siden ${sd.getFullYear()} – <b>${alder} år</b>`);
  }
  if (b && b.navn && b.hoved !== c.orgnr && tittel(b.navn).replace(/\s+AS$/i, "") !== tittel(c.n).replace(/\s+AS$/i, "")) ut.push(`Avdeling av ${esc(tittel(b.navn))}`);
  if (b) { const her = b.hoved !== c.orgnr ? b.avdAnsatte : null, tot = b.ansatte; if (her != null && tot != null && her !== tot) ut.push(`<b>${her}</b> ansatte her, ${tot} i selskapet`); else if (tot != null || her != null) ut.push(`<b>${tot ?? her}</b> ansatte`) }
  if (r && r.omsetning != null) ut.push(`Omsetning ${r.aar || ""}: <b>${mill(r.omsetning)}</b>${r.resultat != null ? ` · resultat før skatt ${r.resultat < 0 ? "<span class=\"neg\">" + mill(r.resultat) + "</span>" : mill(r.resultat)}` : ""}`);
  if (b && b.dagl) ut.push(`Daglig leder: <b>${esc(b.dagl)}</b>${b.styreleder && b.styreleder !== b.dagl ? ` · styreleder ${esc(b.styreleder)}` : ""}`);
  if (b && b.naering) ut.push(esc(b.naering) + (b.konsern ? " · del av et konsern" : ""));
  if (c.t) ut.push(`Hos Lindab: <b>${mill(c.t)}</b> siste 12 mnd${c.s ? ` · segment ${esc(c.s)}` : ""}`);
  return ut;
}
const SOMEIK = { Facebook: "f", Instagram: "◎", LinkedIn: "in", YouTube: "▶", TikTok: "♪", X: "𝕏" };
function webHtml(e) {
  const w = e.web;
  if (w === undefined) return e.br && e.br.web ? `<div class="dweb mut">Sjekker nettsiden …</div>` : "";
  if (!w || w.feil || !w.nettside) return e.br && e.br.web ? `<a class="dweb" href="${esc(/^https?:/.test(e.br.web) ? e.br.web : "https://" + e.br.web)}" target="_blank" rel="noopener">${esc(e.br.web.replace(/^https?:\/\//, ""))} ↗</a>` : "";
  const host = w.nettside.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return `<div class="dmed dsome"><span class="lbl">Fra egen nettside${w.innlegg && w.innlegg.length ? " siste 2 mnd" : ""}</span>
    ${w.innlegg && w.innlegg.length ? `<ul>${w.innlegg.slice(0, 3).map(n => `<li>${n.lenke ? `<a href="${esc(n.lenke)}" target="_blank" rel="noopener">${esc(n.tittel)}</a>` : `<b>${esc(n.tittel)}</b>`}<small>${new Date(n.dato).toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}${n.utdrag ? " · " + esc(n.utdrag.slice(0, 110)) + (n.utdrag.length > 110 ? "…" : "") : ""}</small></li>`).join("")}</ul>` : w.strom ? `<span class="mut">Ingen nye innlegg på nettsiden.</span>` : ""}
    <div class="dsomel"><a class="schip" href="${esc(w.nettside)}" target="_blank" rel="noopener" title="Nettside">🌐 ${esc(host)}</a>${(w.some || []).map(x => `<a class="schip" href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.navn)}"><span class="sik">${SOMEIK[x.navn] || "↗"}</span>${esc(x.navn)}</a>`).join("")}</div>
  </div>`;
}
function faktaHtml() {
  if (!fakta || !fakta.x) return "";
  const { x, liste } = fakta;
  if (!liste.length) return "";
  const er = x === dag;
  return `<section class="dcard dfakta"><h3>${er ? "Om dagens kunder" : "Om kundene " + esc(datoTxt(x.d.dato))}</h3>
    <div class="dfgrid">${liste.map(e => {
      const p = e.br === undefined ? [`<span class="mut">Henter fakta …</span>`] : faktaPunkter(e);
      const m = e.med;
      return `<article class="dfk"><header><b>${esc(e.c.n)}</b><span class="mut">${e.kl != null ? hm(e.kl) + " · " : ""}${esc(e.c.ps || "")}</span></header>
        <ul class="dfl">${p.length ? p.map(t => `<li>${t}</li>`).join("") : `<li class="mut">Fant ikke firmaet i Brønnøysund${e.c.orgnr ? "" : " (mangler org.nr.)"}.</li>`}</ul>
        <div class="dmed"><span class="lbl">I media siste 2 mnd</span>${m === undefined ? `<span class="mut">Søker …</span>` : m.feil ? `<span class="mut">Fikk ikke søkt i nyhetene.</span>` : m.saker.length ? `<ul>${m.saker.map(n => `<li><a href="${esc(n.lenke)}" target="_blank" rel="noopener">${esc(n.tittel)}</a><small>${esc(n.kilde)} · ${new Date(n.dato).toLocaleDateString("nb-NO", { day: "numeric", month: "short" })}</small></li>`).join("")}</ul>` : `<span class="mut">Ingen treff på «${esc(m.sok || e.c.n)}».</span>`}</div>
        ${webHtml(e)}
      </article>` }).join("")}</div>
    <div class="dsrc">Fakta: Brønnøysundregistrene · Media: Google Nyheter (treff kan gjelde andre med samme navn) · Nettside og profiler: kundens egen nettside. Innlegg på sosiale medier kan ikke hentes automatisk – trykk på profilen for å se dem.</div></section>`;
}

/* ---------- visning ---------- */
const hilsen = () => { const h = new Date().getHours(); return h < 5 ? "God natt" : h < 10 ? "God morgen" : h < 17 ? "God dag" : "God kveld" };
const fornavn = () => { const me = KK().ME || {}; return (me.navn || "").split(" ")[0] || "" };
function oppsummering(x) {
  const s = x.s;
  if (!s) return `<div class="dsum"><b>${x.d.stopp.length} stopp</b> i «${esc(x.plan.tittel)}». Åpne ruta i planleggeren for tider.</div>`;
  const nu = naaMin(), stopp = (s.stopp || []).filter(e => e.type === "kunde" || e.type === "avtale");
  const besok = stopp.filter(e => e.type === "kunde" && !e.skip);
  const ferdig = nu > (s.slutt ?? 0), igang = nu >= (s.start ?? 0) && !ferdig;
  const nesteE = (s.stopp || []).find(e => e.type !== "lunsj" && !e.skip && (e.til ?? e.ankomst) > nu);
  const ikkeAvtalt = besok.filter(e => (e.status || "planlagt") === "planlagt").length;
  const slutt = (s.stopp || []).find(e => !["kunde", "avtale", "lunsj"].includes(e.type));
  const linje = e => {
    const fer = (e.til ?? e.ankomst) <= nu, er = e === nesteE;
    const c = e.type === "kunde" ? kunde(e.k) : null;
    const st = e.status === "avtalt" ? `<span class="dok" title="Avtalt med kunden">✓</span>` : e.skip ? `<span class="mut">${esc(e.status)}</span>` : e.type === "kunde" ? `<span class="dplan" title="Ikke avtalt med kunden ennå">ikke avtalt</span>` : "";
    return `<li class="${fer ? "ferdig" : ""}${er ? " naa" : ""}${e.skip ? " skip" : ""}"><span class="t">${e.type === "lunsj" ? hm(e.fra) : hm(e.fra ?? e.ankomst)}</span>
      <span class="n">${e.type === "avtale" ? "◆ " : e.type === "lunsj" ? "🥪 " : ""}${esc(e.navn)}<small>${esc(e.type === "lunsj" ? (e.underveis ? "underveis" : "") : stedNavn(e))}${e.vent >= 10 ? ` · 🗂 ${dur(e.vent)} ledig til adm før` : ""}</small></span>${st}</li>`;
  };
  return `<div class="dsum">
      <div class="dkpi">
        <div><b>${besok.length}</b><span>besøk</span></div>
        <div><b>${hm(s.start)}–${hm(s.slutt)}</b><span>${ferdig ? "ferdig" : igang ? "i gang" : "arbeidsdag"}</span></div>
        <div><b>${s.km ?? "–"} km</b><span>${s.kjoring != null ? dur(s.kjoring) + " kjøring" : "kjøring"}</span></div>
      </div>
      ${nesteE && !ferdig ? `<div class="dnext"><span class="lbl">${igang ? "Neste" : "Første stopp"}</span><b>${esc(nesteE.navn)}</b> kl. ${hm(nesteE.fra ?? nesteE.ankomst)}${nesteE.kjoring ? ` · ${dur(nesteE.kjoring)} kjøring dit` : ""}</div>` : ferdig ? `<div class="dnext"><span class="lbl">Ferdig</span>Dagens rute er kjørt.</div>` : ""}
      <ol class="dlist">${(s.stopp || []).filter(e => e.type !== "lunsj" || !e.underveis).filter(e => ["kunde", "avtale", "lunsj"].includes(e.type)).map(linje).join("")}
        ${slutt ? `<li class="${(slutt.ankomst ?? 0) <= nu ? "ferdig" : ""}"><span class="t">${hm(slutt.ankomst)}</span><span class="n">${slutt.type === "hjem" ? "⌂ " : slutt.type === "hotell" ? "🛏 " : slutt.type === "fly" ? "✈ " : ""}${esc(slutt.navn)}</span></li>` : ""}</ol>
      <div class="dflags">
        ${ikkeAvtalt ? `<button type="button" class="dflag" data-go="book">📞 ${ikkeAvtalt} ${ikkeAvtalt === 1 ? "besøk er" : "besøk er"} ikke avtalt med kunden</button>` : ""}
      </div>
      <div class="dacts"><button type="button" class="btn pri" data-open="${x.plan.id}" data-day="${x.i}">Åpne dagen i planleggeren</button><span class="mut">${esc(x.plan.tittel)} · dag ${x.i + 1}</span></div>
    </div>`;
}
function vaerHtml() {
  if (vaerFeil) return `<div class="status">Fikk ikke hentet værmeldingen: ${esc(vaerFeil)}</div>`;
  if (!vaer) return `<div class="status">Henter værmelding …</div>`;
  if (!vaer.pk.length) return `<div class="status">Legg inn hjemmeadresse i Min profil for å få værmelding.</div>`;
  const h = vaer.pk[0], i = h.x.i, sym = h.x.s1 || h.x.s6;
  const glatt = vaer.pk.some(p => p.x.i.air_temperature > -3 && p.x.i.air_temperature < 2 && ((p.x.p1 || 0) > 0 || /snow|sleet|rain/.test(p.x.s1 || "")));
  const vind = vaer.pk.filter(p => p.x.i.wind_speed >= 14);
  return `<div class="dwx">
      <div class="dwxnow"><span class="ik" aria-hidden="true">${vIkon(sym)}</span><div><b>${Math.round(i.air_temperature)}°</b><span>${esc(vTekst(sym))}</span></div></div>
      <div class="dwxmeta"><b>${esc(h.navn)}</b>${h.naa || h.min <= naaMin() ? " nå" : " kl. " + hm(h.min)}<br>
        ${h.lo != null ? `Resten av dagen ${Math.round(h.lo)}° til ${Math.round(h.hi)}° · ` : ""}vind ${Math.round(i.wind_speed)} m/s${h.nedbor >= 0.2 ? ` · ${h.nedbor.toFixed(1).replace(".", ",")} mm nedbør` : " · lite nedbør"}</div>
    </div>
    ${vaer.pk.length > 1 ? `<ul class="dwxrow">${vaer.pk.slice(1).map(p => `<li title="${esc(vTekst(p.x.s1 || p.x.s6))}"><span class="t">${hm(p.min)}</span><span class="ik" aria-hidden="true">${vIkon(p.x.s1 || p.x.s6)}</span><b>${Math.round(p.x.i.air_temperature)}°</b><span class="n">${esc(p.navn)}</span></li>`).join("")}</ul>` : ""}
    ${glatt ? `<div class="dwxwarn">❄ Nedbør rundt null grader – regn med glatte veger.</div>` : ""}
    ${vind.length ? `<div class="dwxwarn">💨 Sterk vind ved ${vind.map(p => esc(p.navn)).join(", ")}.</div>` : ""}
    <div class="dsrc">Vær: MET Norway</div>`;
}
function hindreHtml() {
  if (!dag) return `<div class="status">Ingen kjørerute i dag.</div>`;
  if (hindreFeil) return `<div class="status">Fikk ikke sjekket ruta: ${esc(hindreFeil)}</div>`;
  if (!hindre) return `<div class="status">Sjekker kjøreruta mot vegmeldinger og farevarsler …</div>`;
  const V = window.KKVeg, fv = [...new Map(((vaer && vaer.pk) || []).flatMap(p => p.fv.map(f => [f.id, { ...f, ved: p.navn }]))).values()];
  const rader = [];
  fv.forEach(f => rader.push(`<details class="dhin fare ${esc(f.farge)}"><summary><span class="ik">⚠</span><span><b>${esc(f.navn)}</b> · farevarsel ${f.farge === "red" ? "rødt" : f.farge === "orange" ? "oransje" : "gult"} nivå<small>${esc(f.omr)} · ved ${esc(f.ved)}${f.slutt ? " · til " + new Date(f.slutt).toLocaleString("nb-NO", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : ""}</small></span></summary><p>${esc(f.tekst)}</p></details>`));
  hindre.veg.filter(v => v.alvor).forEach(v => rader.push(`<details class="dhin" style="--vk:${(V.KAT[v.m.kat] || V.KAT.annet).f}"><summary><span class="ik">${(V.KAT[v.m.kat] || V.KAT.annet).ik}</span><span><b>${esc(V.tekst(v.m))}</b><small>På vei til ${esc(v.e.mot.navn)} · ca. kl. ${hm(v.e.fraT)}–${hm(v.e.tilT)}</small></span></summary>${V.html(v.m, true)}</details>`));
  hindre.ferger.forEach(({ f, e }) => rader.push(`<div class="dhin ferje"><span class="ik">⛴</span><span><b>Ferje: ${esc(f.navn)}</b><small>På vei til ${esc(e.mot.navn)} · ${f.min} min overfart. Sjekk avgangene i planleggeren.</small></span></div>`));
  const smaa = hindre.veg.filter(v => !v.alvor);
  if (!rader.length) rader.push(`<div class="dhin ok"><span class="ik">✓</span><span><b>Ingen kjente hindringer</b><small>Sjekket ${hindre.etapper} ${hindre.etapper === 1 ? "etappe" : "etapper"} mot stengte veger, kolonnekjøring, ras, ulykker, føre og farevarsler.</small></span></div>`);
  return rader.join("") + (smaa.length ? `<details class="dsmaa"><summary>${smaa.length} mindre ${smaa.length === 1 ? "melding" : "meldinger"} (vegarbeid o.l.)</summary>${smaa.map(v => V.html(v.m, true)).join("")}</details>` : "")
    + (hindre.estimert ? `<div class="status">Noen etapper kunne ikke beregnes nøyaktig, så sjekken er grovere der.</div>` : "")
    + `<div class="dsrc">Vegmeldinger: Statens vegvesen · Farevarsler: MET Norway</div>`;
}
function render() {
  const P = $("dash"); if (!P || !open) return;
  const idag = new Date(), me = KK().ME || {};
  const inv = window.KKInv ? window.KKInv.pending().length : 0;
  let hoved;
  if (laster && !dag && !neste) hoved = `<div class="status">Henter dagens plan …</div>`;
  else if (feil) hoved = `<div class="status">Kunne ikke hente rutene: ${esc(feil)}</div>`;
  else if (dag) hoved = oppsummering(dag) + (flere.length > 1 ? `<div class="status">Du har ${flere.length} ruter med dagens dato. Viser «${esc(dag.plan.tittel)}».</div>` : "");
  else hoved = `<div class="dsum"><div class="dnone"><b>Ingen reisedag planlagt i dag.</b>${neste ? `<span>Neste: ${esc(datoTxt(neste.d.dato))} · ${neste.s ? neste.s.besok + " besøk" : neste.d.stopp.length + " stopp"} · «${esc(neste.plan.tittel)}»</span>` : `<span>Lag en rute i Planleggeren, så vises dagen her.</span>`}</div>
      <div class="dacts">${neste ? `<button type="button" class="btn" data-open="${neste.plan.id}" data-day="${neste.i}">Åpne neste reisedag</button>` : ""}<button type="button" class="btn" data-go="plan">Planlegg en rute</button></div></div>`;
  P.innerHTML = `<div class="dwrap">
    <div class="dhead"><div><h2>${esc(hilsen())}${fornavn() ? ", " + esc(fornavn()) : ""}</h2><span class="mut">${esc(datoTxt(iso(idag)))}${me.omraader && me.omraader.length ? " · " + esc(me.omraader.map(o => (KK().OMRAADER && KK().OMRAADER[o] && KK().OMRAADER[o].navn) || o).join(", ")) : ""}</span></div>
      <button type="button" class="btn" id="dRef" ${laster ? "disabled" : ""}>${laster ? "Oppdaterer …" : "Oppdater"}</button></div>
    ${inv ? `<button type="button" class="dbanner" data-go="cal">✉ ${inv === 1 ? "1 invitasjon til kundemøte venter" : inv + " invitasjoner til kundemøter venter"} på svar</button>` : ""}
    <div class="dgrid">
      <section class="dcard dday"><h3>${dag ? "Dagens aktivitet" : "I dag"}</h3>${hoved}</section>
      <section class="dcard"><h3>Vær</h3>${vaerHtml()}</section>
      <section class="dcard"><h3>Langs kjøreruta</h3>${hindreHtml()}</section>
    </div>
    ${faktaHtml()}</div>`;
  $("dRef").onclick = () => last(true);
  P.querySelectorAll("[data-open]").forEach(b => b.onclick = async () => { const id = b.dataset.open, i = +b.dataset.day; toggle(false); if (!window.KKPlan.open) await window.KKPlan.toggle(true); await window.KKPlan.openPlan(id, i); document.dispatchEvent(new Event("kk:view")) });
  P.querySelectorAll("[data-go]").forEach(b => b.onclick = async () => {
    const g = b.dataset.go; toggle(false);
    if (g === "book") window.KKBook.toggle(true); else if (g === "cal") window.KKCal.toggle(true); else if (g === "plan" && !window.KKPlan.open) await window.KKPlan.toggle(true);
    document.dispatchEvent(new Event("kk:view"));
  });
}
async function last(force) {
  if (laster) return; if (!force && Date.now() - sist < 5 * 60000 && (dag || neste)) { render(); return }
  laster = true; feil = ""; render();
  try { await hentDager() } catch (e) { feil = e.message || String(e) }
  vaer = null; hindre = null; render();
  await Promise.all([
    hentVaer().catch(e => { vaerFeil = e.message || String(e) }).finally(render),
    hentHindre().catch(e => { hindreFeil = e.message || String(e) }).finally(render),
    hentFakta().catch(() => { }).finally(render)
  ]);
  laster = false; sist = Date.now(); render();
}
function toggle(force) {
  open = force ?? !open;
  $("dash").hidden = !open;
  document.body.classList.toggle("dashing", open);
  if (open) {
    KK().closeDetail();
    if (window.KKCal && window.KKCal.open) window.KKCal.toggle(false);
    if (window.KKBook && window.KKBook.open) window.KKBook.toggle(false);
    if (window.KKPlan && window.KKPlan.open) window.KKPlan.toggle(false);
    last(false);
  } else setTimeout(() => KK().invalidate(), 0);
  document.dispatchEvent(new Event("kk:view"));
}
document.addEventListener("kk:inv", () => { if (open) render() });
document.addEventListener("kk:veg", () => { if (open && dag && !laster) hentHindre().catch(() => { }).finally(render) });
document.addEventListener("visibilitychange", () => { if (open && !document.hidden && Date.now() - sist > 10 * 60000) last(true) });
// Hovedfane: åpnes når appen er klar (innlogget og kundedata lastet)
let forsok = 0;
(function start() { forsok++; if (!KK() || !KK().ME || !window.KKPlan || (!(KK().DATA || []).length && forsok < 25)) return setTimeout(start, 400); toggle(true) })();
window.KKDash = { toggle, last, get open() { return open } };
})();
