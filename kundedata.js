/* Kundedata: last ned Excel-mal med dagens kunder, last opp endret fil, se forskjeller før lagring, angre.
   Kun for admin/leder. Selve lagringen skjer i databasefunksjonen importer_kunder (én transaksjon). */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";

const COLS = [
  { f: "kundenr", h: "Kundenummer", req: true, a: ["kundenr", "kundenummer", "kunde nr", "kundenr."] },
  { f: "navn", h: "Kundenavn", req: true, a: ["kundenavn", "navn", "firmanavn", "kunde"] },
  { f: "omraade", h: "Område", a: ["område", "omrade", "omraade", "salgsområde"] },
  { f: "kategori", h: "Kategori", a: ["kategori", "kundekategori"] },
  { f: "eier", h: "Eier", a: ["eier", "ansvarlig", "selger", "kundeansvarlig"] },
  { f: "status", h: "Status", a: ["status", "kundestatus"] },
  { f: "bransje", h: "Bransje", a: ["bransje"] },
  { f: "oms_ventilasjon", h: "Omsetning ventilasjon", num: true, a: ["omsetning ventilasjon", "ventilasjon", "oms ventilasjon"] },
  { f: "oms_profil", h: "Omsetning profil", num: true, a: ["omsetning profil", "profil", "oms profil"] },
  { f: "oms_total", h: "Omsetning total", num: true, a: ["omsetning total", "total", "omsetning", "oms total", "omsetning - netto 12m"] },
  { f: "segment", h: "Segment", a: ["segment"] },
  { f: "besoksadresse", h: "Besøksadresse", a: ["besøksadresse", "besoksadresse", "adresse"] },
  { f: "postnr", h: "Postnr", a: ["postnr", "postnummer", "besøkadresse postnummer", "besøksadresse postnummer"] },
  { f: "poststed", h: "Poststed", a: ["poststed", "sted"] },
  { f: "kjede", h: "Kjede", info: true, a: ["kjede"] },
  { f: "konstellasjon", h: "Konstellasjon", info: true, a: ["konstellasjon"] },
  { f: "vbl", h: "VBL-medlem", info: true, bool: true, a: ["vbl", "vbl-medlem", "vbl medlem"] },
  { f: "byggvare", h: "Byggvareforhandler", info: true, bool: true, a: ["byggvare", "byggvareforhandler"] }
];
const KUNDE_F = ["kundenr", "omraade", "navn", "kategori", "eier", "oms_ventilasjon", "oms_profil", "oms_total", "segment", "poststed", "poststed_kilde", "kommune", "region", "lat", "lon", "presisjon", "besoksadresse", "postnr", "bransje", "status"];
const VIS = { omraade: "Område", navn: "Navn", kategori: "Kategori", eier: "Eier", status: "Status", bransje: "Bransje", oms_ventilasjon: "Oms. ventilasjon", oms_profil: "Oms. profil", oms_total: "Oms. total", segment: "Segment", besoksadresse: "Besøksadresse", postnr: "Postnr", poststed: "Poststed", region: "Region", kjede: "Kjede", konstellasjon: "Konstellasjon", vbl: "VBL", byggvare: "Byggvare" };
const KATEGORIER = ["Profil", "Ventilasjon"];
const STATUSER = ["Aktiv kunde", "Prospekt", "Tidligere kunde"];
const omNavn = om => { const O = (window.KK && window.KK.OMRAADER) || {}; return (O[om] || {}).navn || om || "" };
function omKey(v) {
  const O = (window.KK && window.KK.OMRAADER) || {}, n = norm(v);
  return Object.keys(O).find(k => k === n || norm(O[k].navn) === n || (n.length > 3 && norm(O[k].navn).startsWith(n))) || null;
}
const SEG = t => t >= 1e6 ? "A" : t >= 25e4 ? "B" : t >= 5e4 ? "C" : "D";

let plan = null, busy = false, logg = [], fane = "endret";

function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = XLSX_URL; s.onload = res; s.onerror = () => rej(new Error("Fikk ikke lastet Excel-modulen")); document.head.appendChild(s) });
}
const norm = s => String(s ?? "").toLowerCase().replace(/\*/g, "").replace(/\s+/g, " ").trim();
const txt = v => { if (v == null) return null; const s = String(v).replace(/\s+/g, " ").trim(); return s === "" ? null : s };
function num(v) {
  if (v == null || v === "") return { ok: true, v: null };
  if (typeof v === "number") return isFinite(v) ? { ok: true, v: Math.round(v) } : { ok: false };
  const s = String(v).replace(/[\s ]/g, "").replace(/kr\.?|nok/gi, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (s === "" || s === "-") return { ok: true, v: null };
  const n = Number(s); return isFinite(n) ? { ok: true, v: Math.round(n) } : { ok: false };
}
function bool(v) {
  if (v == null || v === "") return { ok: true, v: false };
  if (typeof v === "boolean") return { ok: true, v };
  const s = norm(v);
  if (["ja", "j", "yes", "y", "x", "1", "true", "sann"].includes(s)) return { ok: true, v: true };
  if (["nei", "n", "no", "0", "false", "usann", "-"].includes(s)) return { ok: true, v: false };
  return { ok: false };
}
const fmtKr = v => v == null ? "" : Math.round(v).toLocaleString("nb-NO");
const dbOf = c => ({ kundenr: c.k, omraade: c.om || "nord", navn: c.n, kategori: c.kat || null, eier: c.e || null, oms_ventilasjon: c.v || 0, oms_profil: c.p || 0, oms_total: c.t || 0, segment: c.s || null,
  poststed: c.ps || null, poststed_kilde: c.src || null, kommune: c.kom || null, region: c.r || null, lat: c.lat ?? null, lon: c.lon ?? null, presisjon: c.pr || null,
  besoksadresse: c.adr || null, postnr: c.pnr || null, bransje: c.br || null, status: c.st || null });
const ws_ = v => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v;
const same = (a, b) => (ws_(a) ?? "") === (ws_(b) ?? "") || (typeof a === "number" || typeof b === "number") && Number(a || 0) === Number(b || 0);

/* ---------- nedlasting ---------- */
async function lastNed(tom) {
  const KK = window.KK, msg = $("kdDlMsg");
  try {
    msg.textContent = "Lager Excel-fil …"; await loadXlsx();
    const X = window.XLSX, INFO = KK.INFO || {};
    const rows = tom ? [] : KK.RAW.slice().sort((a, b) => (b.t || 0) - (a.t || 0)).map(c => {
      const i = INFO[c.k] || {};
      return [c.k, c.n, omNavn(c.om), c.kat || "", c.e || "", c.st || "", c.br || "", c.v || 0, c.p || 0, c.t || 0, c.s || "", c.adr || "", c.pnr || "", c.ps || "", i.kjede || "", i.konstellasjon || "", i.vbl ? "Ja" : "Nei", i.byggvare ? "Ja" : "Nei"];
    });
    const ws = X.utils.aoa_to_sheet([COLS.map(c => c.req ? c.h + " *" : c.h), ...rows]);
    ws["!cols"] = COLS.map(c => ({ wch: c.f === "navn" ? 38 : c.f === "besoksadresse" ? 28 : c.num ? 18 : c.f === "kundenr" ? 13 : 15 }));
    ws["!autofilter"] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: COLS.length - 1 } }) };
    for (let r = 1; r <= rows.length; r++) [7, 8, 9].forEach(cn => { const a = X.utils.encode_cell({ r, c: cn }); if (ws[a]) ws[a].z = "#,##0" });
    const eiere = [...new Set(KK.RAW.map(c => c.e).filter(Boolean))].sort();
    const veil = [
      ["Kundekart Nord – vedlikehold av kundedata"], [""],
      ["Slik gjør du det"],
      ["1. Endre, legg til eller slett rader i arket «Kunder». Ikke endre overskriftene."],
      ["2. Lagre fila og last den opp under Kundedata i Kundekart Nord."],
      ["3. Du får se alle endringene før noe lagres. Hver opplasting kan angres."], [""],
      ["Kolonner"],
      ["Kundenummer *", "Påkrevd. Brukes til å kjenne igjen kunden. Ikke endre nummeret på en eksisterende kunde."],
      ["Kundenavn *", "Påkrevd."],
      ["Område", "Salgsområdet kunden hører til: " + Object.values(KK.OMRAADER || {}).map(o => o.navn).join(" eller ") + ". Selgere ser bare kundene i sitt område. Står den tom, beholdes området (nye kunder får området du velger ved opplasting)."],
      ["Kategori", "Profil eller Ventilasjon."],
      ["Eier", "Selgeren som har kunden, f.eks. " + (eiere.slice(0, 3).join(", ") || "Jørn") + "."],
      ["Status", STATUSER.join(", ") + "."],
      ["Omsetning ventilasjon / profil / total", "Hele kroner, siste 12 måneder. Står total tom, regnes den ut som ventilasjon + profil. Endrer du ventilasjon eller profil uten å røre total, justeres total med det samme beløpet."],
      ["Segment", "A, B, C eller D. Står den tom, settes den fra total: A ≥ 1 000 000, B ≥ 250 000, C ≥ 50 000, ellers D."],
      ["Besøksadresse, Postnr, Poststed", "Poststed gir plassering på kartet. Nye eller endrede adresser kan slås opp hos Kartverket ved opplasting."],
      ["Kjede, Konstellasjon", "Fritekst."],
      ["VBL-medlem, Byggvareforhandler", "Ja eller Nei."], [""],
      ["Godt å vite"],
      ["Kolonner du fjerner fra fila, blir ikke endret. Kunder som mangler i fila, beholdes, med mindre du krysser av for å slette dem ved opplasting."],
      ["Fila kan også være en eksport fra Axapta/Lime med kolonner som Firmanavn, Ansvarlig, Kundestatus og Kundekategori. De kjennes igjen automatisk."],
      ["Kundedata er fortrolig. Ikke send fila videre utenfor Lindab."]
    ];
    const ws2 = X.utils.aoa_to_sheet(veil); ws2["!cols"] = [{ wch: 40 }, { wch: 110 }];
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Kunder");
    X.utils.book_append_sheet(wb, ws2, "Veiledning");
    const d = new Date().toISOString().slice(0, 10);
    X.writeFile(wb, tom ? "Kundekart Nord - tom mal.xlsx" : `Kundekart Nord - kunder ${d}.xlsx`);
    msg.textContent = tom ? "Tom mal lastet ned." : `${rows.length} kunder lastet ned.`;
  } catch (e) { msg.textContent = "Kunne ikke lage fila: " + e.message }
}

/* ---------- lesing og sammenligning ---------- */
async function lesFil(file) {
  await loadXlsx();
  const X = window.XLSX, buf = await file.arrayBuffer();
  let wb;
  if (/\.csv$/i.test(file.name)) {
    let s = new TextDecoder("utf-8").decode(buf); if (s.includes("�")) s = new TextDecoder("windows-1252").decode(buf);
    const first = s.split(/\r?\n/)[0] || "";
    wb = X.read(s, { type: "string", FS: (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : "," , raw: true });
  } else wb = X.read(buf, { type: "array" });
  const name = wb.SheetNames.find(n => norm(n) === "kunder") || wb.SheetNames[0];
  const rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
  let hi = -1, map = null;
  for (let r = 0; r < Math.min(rows.length, 15) && hi < 0; r++) {
    const m = {}; (rows[r] || []).forEach((h, ci) => { const n = norm(h); const col = COLS.find(c => c.a.includes(n) || norm(c.h) === n); if (col && m[col.f] == null) m[col.f] = ci });
    if (m.kundenr != null && m.navn != null) { hi = r; map = m }
  }
  if (hi < 0) throw new Error(`Fant ikke kolonnene «Kundenummer» og «Kundenavn» i arket «${name}».`);
  return { ark: name, map, data: rows.slice(hi + 1), hi };
}

function lagPlan(fil, filnavn, nyOm) {
  const KK = window.KK, GEO = KK.GEO, INFO = KK.INFO || {};
  nyOm = nyOm || (KK.mittOmraade ? KK.mittOmraade() : "nord");
  const gamle = new Map(KK.RAW.map(c => [c.k, c]));
  const eiere = new Set(KK.RAW.map(c => c.e).filter(Boolean));
  const psKey = {}; Object.keys(GEO.poststeder).forEach(p => psKey[p.toLowerCase()] = p);
  const has = f => fil.map[f] != null, harInfo = COLS.some(c => c.info && has(c.f));
  const feil = [], sett = new Set(), kunder = [], info = [], adr = [];
  const rader = []; let sumNy = 0, sumGml = 0;
  fil.data.forEach((row, ri) => {
    const lin = fil.hi + ri + 2, cell = f => has(f) ? row[fil.map[f]] : undefined;
    if (!row || row.every(v => v == null || String(v).trim() === "")) return;
    const k = txt(cell("kundenr"));
    if (!k) { feil.push(`Rad ${lin}: mangler kundenummer.`); return }
    if (sett.has(k)) { feil.push(`Rad ${lin}: kundenummer ${k} står flere ganger i fila.`); return }
    sett.add(k);
    const g = gamle.get(k), old = g ? dbOf(g) : null;
    const ny = Object.assign(old ? { ...old } : { kundenr: k, omraade: nyOm, navn: null, kategori: null, eier: null, oms_ventilasjon: 0, oms_profil: 0, oms_total: 0, segment: null, poststed: null, poststed_kilde: null, kommune: null, region: null, lat: null, lon: null, presisjon: null, besoksadresse: null, postnr: null, bransje: null, status: "Aktiv kunde" }), adv = [];
    const navn = txt(cell("navn"));
    if (!navn) { feil.push(`Rad ${lin} (${k}): mangler kundenavn.`); return }
    ny.navn = navn;
    if (has("omraade")) { const v = txt(cell("omraade")); if (v) { const key = omKey(v); if (!key) { feil.push(`Rad ${lin} (${k}): ukjent område «${v}». Bruk ${Object.values(KK.OMRAADER || {}).map(o => o.navn).join(" eller ")}.`); return } ny.omraade = key } }
    if (!old && !(has("omraade") && txt(cell("omraade")))) ny._nyOm = true;
    ["eier", "bransje", "besoksadresse"].forEach(f => { if (has(f)) ny[f] = txt(cell(f)) });
    if (has("postnr")) { const p = txt(cell("postnr")); ny.postnr = p && /^\d{1,4}$/.test(p) ? p.padStart(4, "0") : p }
    if (has("kategori")) { const v = txt(cell("kategori")); const hit = v && KATEGORIER.find(x => x.toLowerCase() === v.toLowerCase()); ny.kategori = hit || v; if (v && !hit) adv.push(`ukjent kategori «${v}»`) }
    if (has("status")) { const v = txt(cell("status")); const hit = v && STATUSER.find(x => x.toLowerCase() === v.toLowerCase()); ny.status = hit || v; if (v && !hit) adv.push(`ukjent status «${v}»`) }
    if (ny.eier && has("eier") && !eiere.has(ny.eier)) adv.push(`ny eier «${ny.eier}»`);
    let numFeil = false;
    ["oms_ventilasjon", "oms_profil", "oms_total"].forEach(f => {
      if (!has(f)) return; const r = num(cell(f));
      if (!r.ok) { feil.push(`Rad ${lin} (${k}): «${cell(f)}» er ikke et tall (${VIS[f]}).`); numFeil = true; return }
      ny[f] = r.v;
    });
    if (numFeil) return;
    if (has("oms_ventilasjon") || has("oms_profil")) { ny.oms_ventilasjon = ny.oms_ventilasjon || 0; ny.oms_profil = ny.oms_profil || 0 }
    const delEndret = old && (!same(old.oms_ventilasjon, ny.oms_ventilasjon) || !same(old.oms_profil, ny.oms_profil));
    const totUrort = !has("oms_total") || (old && same(old.oms_total, ny.oms_total));
    if (ny.oms_total == null || !old && !has("oms_total")) ny.oms_total = (ny.oms_ventilasjon || 0) + (ny.oms_profil || 0);
    else if (delEndret && totUrort) ny.oms_total = (old.oms_total || 0) + (ny.oms_ventilasjon || 0) - (old.oms_ventilasjon || 0) + (ny.oms_profil || 0) - (old.oms_profil || 0);
    let seg = has("segment") ? txt(cell("segment")) : old ? old.segment : null;
    if (seg) seg = seg.toUpperCase();
    if (seg && !/^[ABCD]$/.test(seg)) { adv.push(`segment «${seg}» er ugyldig, satt automatisk`); seg = null }
    const totEndret = old && !same(old.oms_total, ny.oms_total), segUrort = !has("segment") || (old && seg === old.segment);
    const autoSeg = !seg || totEndret && segUrort;
    ny.segment = autoSeg ? SEG(ny.oms_total || 0) : seg;
    if (has("poststed")) {
      const ps = txt(cell("poststed"));
      const endret = !old || (ps || "").toLowerCase() !== (old.poststed || "").toLowerCase();
      if (endret) {
        const hit = ps && psKey[ps.toLowerCase()];
        if (hit) { const [la, lo, reg] = GEO.poststeder[hit]; Object.assign(ny, { poststed: hit, lat: la, lon: lo, region: reg, kommune: null, presisjon: "poststed", poststed_kilde: "import" }) }
        else { Object.assign(ny, { poststed: ps, lat: null, lon: null, region: KK.utenfor ? KK.utenfor(ny.omraade) : null, kommune: null, presisjon: null, poststed_kilde: ps ? "import" : null }); if (ps) adv.push(`fant ikke poststedet «${ps}» – vises ikke på kartet`); else adv.push("mangler poststed – vises ikke på kartet") }
      }
    }
    if (!old && !has("poststed")) adv.push("mangler poststed – vises ikke på kartet");
    sumNy += ny.oms_total || 0; if (old) sumGml += old.oms_total || 0;
    const endringer = old ? KUNDE_F.filter(f => !["poststed_kilde", "kommune", "lat", "lon", "presisjon"].includes(f) && !same(old[f], ny[f])).map(f => [f, old[f], ny[f]]) : [];
    const kEndret = !old || KUNDE_F.some(f => !same(old[f], ny[f]));
    if (kEndret) kunder.push(ny);
    if (harInfo) {
      const gi = INFO[k] || { kjede: null, konstellasjon: null, vbl: false, byggvare: false };
      const ni = { kundenr: k, kjede: gi.kjede ?? null, konstellasjon: gi.konstellasjon ?? null, vbl: !!gi.vbl, byggvare: !!gi.byggvare };
      if (has("kjede")) ni.kjede = txt(cell("kjede"));
      if (has("konstellasjon")) ni.konstellasjon = txt(cell("konstellasjon"));
      ["vbl", "byggvare"].forEach(f => { if (!has(f)) return; const r = bool(cell(f)); if (!r.ok) adv.push(`«${cell(f)}» tolket som Nei (${VIS[f]})`); ni[f] = r.ok ? r.v : false });
      const iEndret = ["kjede", "konstellasjon", "vbl", "byggvare"].filter(f => !same(gi[f] ?? (f === "vbl" || f === "byggvare" ? false : null), ni[f]));
      if (iEndret.length || (!INFO[k] && (ni.kjede || ni.konstellasjon || ni.vbl || ni.byggvare))) {
        info.push(ni);
        if (old) iEndret.forEach(f => endringer.push([f, gi[f], ni[f]]));
      }
    }
    if (ny.besoksadresse && (!old || old.besoksadresse !== ny.besoksadresse || old.postnr !== ny.postnr)) adr.push(ny);
    const type = !old ? "ny" : endringer.length ? "endret" : "uendret";
    rader.push({ k, navn, type, endringer, adv, ny });
  });
  const mangler = KK.RAW.filter(c => !sett.has(c.k));
  const advarsler = [];
  if (sumGml > 0 && sumNy > 0) { const f = sumNy / sumGml; if (f > 20 || f < .05) advarsler.push(`Omsetningen i fila er ${f > 1 ? Math.round(f) + " ganger høyere" : Math.round(1 / f) + " ganger lavere"} enn i dag. Sjekk at tallene er i hele kroner (ikke tusen).`) }
  if (sett.size && mangler.length > KK.RAW.length * .5) advarsler.push(`${mangler.length} av ${KK.RAW.length} kunder mangler i fila. Er det riktig fil?`);
  return { nyOm, filnavn, ark: fil.ark, kolonner: COLS.filter(c => has(c.f)).map(c => c.h), feil, advarsler, rader, kunder, info, adr, mangler, slett: false, slaOpp: true, antall: sett.size };
}

/* ---------- visning ---------- */
const vis = (f, v) => f === "omraade" ? omNavn(v) : v == null || v === "" ? "–" : typeof v === "boolean" ? (v ? "Ja" : "Nei") : /^oms_/.test(f) ? fmtKr(v) + " kr" : String(v);
function render() {
  const B = $("kdBody"); if (!B) return;
  const KK = window.KK;
  const p = plan;
  const tell = t => p ? p.rader.filter(r => r.type === t).length : 0;
  B.innerHTML = `
  <section class="kdsec">
    <h2>1. Last ned</h2>
    <p class="mut">Excel-fil med alle ${KK.RAW.length} kundene slik de er i dag. Gjør endringene i fila og last den opp igjen under.</p>
    <div class="acts kdacts"><button type="button" class="btn pri" id="kdDl">Last ned kundeliste (Excel)</button><button type="button" class="btn" id="kdDlTom">Tom mal</button><span class="status" id="kdDlMsg"></span></div>
  </section>
  <section class="kdsec">
    <h2>2. Last opp</h2>
    <p class="mut">Excel (.xlsx) eller CSV. Ingenting lagres før du har sett gjennom endringene.</p>
    <label class="kdfile"><input type="file" id="kdFil" accept=".xlsx,.xls,.csv"><span class="btn">Velg fil …</span><span class="mut" id="kdFilNavn">${p ? esc(p.filnavn) : "Ingen fil valgt"}</span></label>
    <div class="status" id="kdLes"></div>
    ${p ? planHtml(p, tell) : ""}
  </section>
  <section class="kdsec">
    <h2>Tidligere opplastinger</h2>
    ${logg.length ? `<div class="adrtable"><table class="kdlog"><thead><tr><th>Tid</th><th>Av</th><th>Fil</th><th>Nye</th><th>Endret</th><th>Slettet</th><th></th></tr></thead><tbody>
      ${logg.map((l, i) => `<tr${l.angret ? ' class="none"' : ""}><td>${new Date(l.tid).toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td><td>${esc(navnAv(l.av))}</td><td>${esc(l.filnavn || "")}</td><td>${l.nye}</td><td>${l.endret}</td><td>${l.slettet}</td>
        <td>${l.angret ? '<span class="mut">Angret</span>' : i === logg.findIndex(x => !x.angret) ? `<button type="button" class="btn sm" data-angre="${l.id}">Angre</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="mut">Ingen opplastinger ennå.</p>'}
    <div class="status" id="kdLogMsg"></div>
  </section>`;
  $("kdDl").onclick = () => lastNed(false);
  $("kdDlTom").onclick = () => lastNed(true);
  $("kdFil").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    $("kdLes").textContent = "Leser fila …";
    try { const fil = await lesFil(f); plan = lagPlan(fil, f.name); fane = plan.feil.length ? "feil" : plan.rader.some(r => r.type === "endret") ? "endret" : "ny"; render() }
    catch (err) { plan = null; render(); $("kdLes").textContent = "Kunne ikke lese fila: " + err.message }
  };
  B.querySelectorAll("[data-fane]").forEach(b => b.onclick = () => { fane = b.dataset.fane; render() });
  B.querySelectorAll("[data-angre]").forEach(b => b.onclick = () => angre(+b.dataset.angre, b));
  if ($("kdSlett")) $("kdSlett").onchange = e => { plan.slett = e.target.checked; render() };
  if ($("kdSla")) $("kdSla").onchange = e => { plan.slaOpp = e.target.checked };
  if ($("kdOm")) $("kdOm").onchange = e => { plan.nyOm = e.target.value; plan.rader.forEach(r => { if (r.ny._nyOm) r.ny.omraade = plan.nyOm }) };
  if ($("kdLagre")) $("kdLagre").onclick = lagre;
  if ($("kdAvbryt")) $("kdAvbryt").onclick = () => { plan = null; render() };
}
const navnAv = e => { const KK = window.KK; return (KK.ME && KK.ME.epost === e) ? "Deg" : String(e || "").split("@")[0] };
function planHtml(p, tell) {
  const endringer = tell("ny") + tell("endret") + (p.slett ? p.mangler.length : 0);
  const medAdv = p.rader.filter(r => r.adv.length);
  const liste = fane === "feil" ? null : fane === "adv" ? medAdv : fane === "mangler" ? null : p.rader.filter(r => r.type === fane);
  return `
  <div class="kdsum">
    <div class="mut">Ark «${esc(p.ark)}» · ${p.antall} kunder i fila · kolonner: ${esc(p.kolonner.join(", "))}</div>
    ${p.advarsler.map(a => `<div class="kdwarn">⚠ ${esc(a)}</div>`).join("")}
    <div class="adrtabs" role="tablist">
      ${p.feil.length ? `<button type="button" class="chip" data-fane="feil" aria-pressed="${fane === "feil"}">Feil (${p.feil.length})</button>` : ""}
      <button type="button" class="chip" data-fane="ny" aria-pressed="${fane === "ny"}">Nye (${tell("ny")})</button>
      <button type="button" class="chip" data-fane="endret" aria-pressed="${fane === "endret"}">Endret (${tell("endret")})</button>
      <button type="button" class="chip" data-fane="adv" aria-pressed="${fane === "adv"}">Sjekk disse (${medAdv.length})</button>
      <button type="button" class="chip" data-fane="mangler" aria-pressed="${fane === "mangler"}">Ikke i fila (${p.mangler.length})</button>
    </div>
    ${fane === "feil" ? `<div class="kderr">${p.feil.slice(0, 200).map(f => `<div>${esc(f)}</div>`).join("")}${p.feil.length > 200 ? `<div>… og ${p.feil.length - 200} til</div>` : ""}<p>Rett feilene i fila og last den opp på nytt.</p></div>` : ""}
    ${fane === "mangler" ? `<div class="kdmangler">
        <p class="mut">Disse kundene finnes i kundekartet, men ikke i fila. De beholdes som de er, med mindre du krysser av under.</p>
        <div class="kdnames">${p.mangler.slice(0, 300).map(c => `<span>${esc(c.n)} <span class="mut">${esc(c.k)}</span></span>`).join("")}${p.mangler.length > 300 ? `<span class="mut">… og ${p.mangler.length - 300} til</span>` : ""}</div>
      </div>` : ""}
    ${liste ? (liste.length ? `<div class="adrtable kdtab"><table><thead><tr><th>Kunde</th><th>${fane === "ny" ? "Opplysninger" : "Endring"}</th></tr></thead><tbody>
      ${liste.slice(0, 400).map(r => `<tr><td><b>${esc(r.navn)}</b><div class="mut">${esc(r.k)}${r.type === "ny" ? " · ny" : ""}</div></td><td>
        ${r.type === "ny" ? `<div>${esc([omNavn(r.ny.omraade), r.ny.kategori, r.ny.eier, r.ny.poststed, r.ny.status].filter(Boolean).join(" · "))}</div><div class="mut">Total ${fmtKr(r.ny.oms_total)} kr · segment ${esc(r.ny.segment)}</div>`
          : r.endringer.map(([f, a, b]) => `<div class="kdchg"><span class="mut">${esc(VIS[f] || f)}:</span> <s>${esc(vis(f, a))}</s> → <b>${esc(vis(f, b))}</b></div>`).join("")}
        ${r.adv.map(a => `<div class="kdwarn sm">⚠ ${esc(a)}</div>`).join("")}</td></tr>`).join("")}
      </tbody></table>${liste.length > 400 ? `<p class="mut">Viser 400 av ${liste.length}.</p>` : ""}</div>` : '<p class="mut">Ingen.</p>') : ""}
    <div class="kdopts">
      ${p.rader.some(r => r.type === "ny" && r.ny._nyOm) && Object.keys(window.KK.OMRAADER || {}).length > 1 ? `<label class="kdcheck">Nye kunder uten område legges i <select id="kdOm">${Object.entries(window.KK.OMRAADER).map(([k, o]) => `<option value="${k}" ${k === p.nyOm ? "selected" : ""}>${esc(o.navn)}</option>`).join("")}</select></label>` : ""}
      ${p.mangler.length ? `<label class="kdcheck"><input type="checkbox" id="kdSlett" ${p.slett ? "checked" : ""}> Slett de ${p.mangler.length} kundene som ikke er i fila <span class="mut">(også adresser, rettelser og kjede-info for dem)</span></label>` : ""}
      ${p.adr.length ? `<label class="kdcheck"><input type="checkbox" id="kdSla" ${p.slaOpp ? "checked" : ""}> Slå opp ${p.adr.length} nye eller endrede besøksadresser hos Kartverket <span class="mut">(gir presis plassering på kartet)</span></label>` : ""}
    </div>
    <div class="acts">
      <button type="button" class="btn pri" id="kdLagre" ${p.feil.length || !endringer || busy ? "disabled" : ""}>${p.feil.length ? "Rett feilene først" : endringer ? `Lagre ${endringer} endringer` : "Ingen endringer å lagre"}</button>
      <button type="button" class="btn" id="kdAvbryt">Avbryt</button>
      <span class="status" id="kdSaveMsg"></span>
    </div>
  </div>`;
}

/* ---------- lagring og angre ---------- */
async function lagre() {
  const KK = window.KK, p = plan; if (!p || busy) return;
  const msg = $("kdSaveMsg"); busy = true; $("kdLagre").disabled = true; msg.textContent = "Lagrer …";
  const { data, error } = await KK.sb.rpc("importer_kunder", { p_kunder: p.kunder.map(({ _nyOm, ...r }) => r), p_info: p.info, p_slett: p.slett ? p.mangler.map(c => c.k) : [], p_filnavn: p.filnavn });
  if (error) { busy = false; $("kdLagre").disabled = false; msg.textContent = "Kunne ikke lagre: " + error.message; return }
  let adrTxt = "";
  if (p.slaOpp && p.adr.length && window.KKAdr) {
    const rows = []; let i = 0, ikke = 0;
    const worker = async () => { while (i < p.adr.length) { const c = p.adr[i++]; msg.textContent = `Lagret. Slår opp adresser … ${Math.min(i, p.adr.length)} av ${p.adr.length}`;
      try { const g = await window.KKAdr.geocodeFree(`${c.besoksadresse}${c.postnr ? ", " + c.postnr : ""}${c.poststed ? " " + c.poststed : ""}`);
        if (g) rows.push({ kundenr: c.kundenr, adresse: g.adresse, postnr: g.postnr, poststed: g.poststed, kommunenr: g.kommunenr, region: KK.GEO.regmap[g.kommunenr] || KK.utenfor(c.omraade), lat: g.lat, lon: g.lon, orgnr: (KK.ADR[c.kundenr] && KK.ADR[c.kundenr].orgnr) || null, kilde: "Import", sikkerhet: "manuell" }); else ikke++ } catch (e) { ikke++ } } };
    await Promise.all([worker(), worker(), worker()]);
    for (let j = 0; j < rows.length; j += 100) { const { error: e2 } = await KK.sb.from("kunde_adresse").upsert(rows.slice(j, j + 100)); if (e2) { ikke += rows.length - j; break } }
    adrTxt = ` ${rows.length} adresser plassert${ikke ? `, ${ikke} ikke funnet hos Kartverket` : ""}.`;
  }
  try { await KK.reloadKunder() } catch (e) { }
  busy = false; plan = null;
  await hentLogg(); render();
  $("kdLes").textContent = `Lagret: ${data.nye} nye, ${data.endret} endret, ${data.slettet} slettet.${adrTxt}`;
}
async function angre(id, btn) {
  const KK = window.KK, l = logg.find(x => x.id === id);
  const m = $("kdLogMsg");
  if (btn.dataset.ok !== "1") { btn.dataset.ok = "1"; btn.textContent = "Bekreft angre"; m.textContent = `Setter kundene tilbake slik de var før opplastingen ${new Date(l.tid).toLocaleString("nb-NO")}. ${l.nye ? l.nye + " nye kunder fjernes." : ""}`; return }
  btn.disabled = true; m.textContent = "Angrer …";
  const { error } = await KK.sb.rpc("angre_import", { p_id: id });
  if (error) { m.textContent = "Kunne ikke angre: " + error.message; btn.disabled = false; return }
  try { await KK.reloadKunder() } catch (e) { }
  await hentLogg(); render(); $("kdLogMsg").textContent = "Opplastingen er angret.";
}
async function hentLogg() {
  const { data } = await window.KK.sb.from("import_logg").select("id,tid,av,filnavn,nye,endret,slettet,angret").order("id", { ascending: false }).limit(10);
  logg = data || [];
}
async function open() {
  $("kdDlg").hidden = false; render();
  await hentLogg(); if (!busy) render();
  loadXlsx().catch(() => { });
}
document.addEventListener("click", e => {
  if (e.target.closest("#tKd")) { const m = $("acctMenu"); if (m) m.hidden = true; open() }
  if (e.target.closest("#kdClose")) { if (!busy) $("kdDlg").hidden = true }
});
window.KKData = { lagPlan, lesFil, num, bool, SEG };
})();
