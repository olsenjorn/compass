/* Adresseoppslag: Enhetsregisteret (Brønnøysund) + Kartverkets adresse-API.
   Kjøres i nettleseren til admin/leder. Forslag godkjennes før de lagres. */
(() => {
const BRREG = "https://data.brreg.no/enhetsregisteret/api";
const GEO_API = "https://ws.geonorge.no/adresser/v1/sok";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
// Ligger kommunen i kundens salgsområde? (nord: Nordland/Troms/Finnmark/Svalbard, rogaland: Rogaland)
const IOMR = (k, c) => (c && c.om === "rogaland" ? /^11/ : /^(18|55|56|21)/).test(String(k || ""));
const STOP = new Set(["as", "asa", "a/s", "ans", "da", "enk", "ba", "sa", "nuf", "avd", "avdeling", "kontant", "inaktiv", "firma", "slettet", "og", "&", "-"]);

function cleanName(n) {
  let s = String(n || "");
  let avd = null;
  const m = s.match(/\bavd(?:eling)?\.?\s+([^,()]+)/i);
  if (m) { avd = m[1].replace(/\d{6,}/g, "").trim(); s = s.slice(0, m.index) }
  s = s.replace(/^\s*(kontant|inaktiv)\s*[-–:]?\s*/i, "").replace(/-\s*firma slettet.*/i, "")
       .replace(/\d{6,}/g, "").replace(/\bA\/S\b/gi, "AS").replace(/\s+/g, " ").trim();
  return { query: s.replace(/\b(AS|ASA|ANS|DA|ENK|BA|SA)\b\.?$/i, "").trim() || s, full: s, avd };
}
function tokens(s) {
  return new Set(String(s || "").toLowerCase().replace(/a\/s/g, "as").replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(t => t && !STOP.has(t)));
}
function sim(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach(t => { if (B.has(t)) inter++ });
  if (inter === A.size && inter === B.size) return 1;
  return inter / Math.max(A.size, B.size);
}
async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { Accept: "application/json" } });
      if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 800 * (i + 1))); continue }
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await new Promise(res => setTimeout(res, 600)) }
  }
  return null;
}
function addrOf(a) {
  if (!a) return null;
  const line = (a.adresse || []).filter(Boolean).join(", ");
  return { adresse: line, postnr: a.postnummer || "", poststed: a.poststed ? a.poststed.charAt(0) + a.poststed.slice(1).toLowerCase() : "", kommune: (a.kommune || "").toLowerCase(), kommunenr: a.kommunenummer || "" };
}
async function brregSearch(name) {
  const q = encodeURIComponent(name);
  const [u, e] = await Promise.all([
    getJSON(`${BRREG}/underenheter?navn=${q}&size=30`),
    getJSON(`${BRREG}/enheter?navn=${q}&size=30`)
  ]);
  const out = [];
  ((u && u._embedded && u._embedded.underenheter) || []).forEach(x => {
    if (x.slettedato || x.nedleggelsesdato) return;
    const a = addrOf(x.beliggenhetsadresse); if (!a) return;
    out.push({ type: "underenhet", orgnr: x.organisasjonsnummer, parent: x.overordnetEnhet, navn: x.navn, ...a });
  });
  ((e && e._embedded && e._embedded.enheter) || []).forEach(x => {
    if (x.slettedato || x.konkurs || x.underAvvikling || x.underTvangsavviklingEllerTvangsopplosning) return;
    const a = addrOf(x.forretningsadresse || x.postadresse); if (!a) return;
    out.push({ type: "enhet", orgnr: x.organisasjonsnummer, navn: x.navn, ...a });
  });
  return out;
}
function score(c, cand, nm) {
  const s = sim(nm.full, cand.navn);
  let p = 0, placeHit = false;
  const ps = (c.ps || "").toLowerCase(), kom = (c.kom || "").toLowerCase();
  if (ps && cand.poststed.toLowerCase() === ps) { p += .35; placeHit = true }
  else if (kom && cand.kommune === kom) { p += .25; placeHit = true }
  if (nm.avd) {
    const av = nm.avd.toLowerCase();
    if (cand.poststed.toLowerCase().includes(av) || cand.kommune.includes(av)) { p += .35; placeHit = true }
  }
  if (IOMR(cand.kommunenr, c)) p += .1;
  else if (c.ps && c.r && !/^Utenfor /.test(c.r)) p -= .25;
  if (cand.type === "underenhet") p += .05;
  if (!cand.adresse) p -= .3;
  return { total: s + p, s, placeHit };
}
async function geocode(adresse, postnr, kommunenr) {
  if (!adresse) return null;
  const base = `${GEO_API}?sok=${encodeURIComponent(adresse)}&treffPerSide=1&utkoordsys=4258`;
  let j = postnr ? await getJSON(`${base}&postnummer=${postnr}`) : null;
  if (!(j && j.adresser && j.adresser.length) && kommunenr) j = await getJSON(`${base}&kommunenummer=${kommunenr}`);
  const a = j && j.adresser && j.adresser[0];
  if (!a || !a.representasjonspunkt) return null;
  return { lat: +a.representasjonspunkt.lat, lon: +a.representasjonspunkt.lon, adresse: a.adressetekst, postnr: a.postnummer, poststed: a.poststed ? a.poststed.charAt(0) + a.poststed.slice(1).toLowerCase() : "", kommunenr: a.kommunenummer };
}
async function geocodeFree(text) {
  const m = text.match(/^(.*?)[,\s]+(\d{4})\s*(.*)$/);
  const street = m ? m[1].trim() : text.trim();
  const pnr = m ? m[2] : "";
  const j = await getJSON(`${GEO_API}?sok=${encodeURIComponent(street)}${pnr ? `&postnummer=${pnr}` : ""}&treffPerSide=1&utkoordsys=4258`);
  const a = j && j.adresser && j.adresser[0];
  if (!a || !a.representasjonspunkt) return null;
  return { lat: +a.representasjonspunkt.lat, lon: +a.representasjonspunkt.lon, adresse: a.adressetekst, postnr: a.postnummer, poststed: a.poststed ? a.poststed.charAt(0) + a.poststed.slice(1).toLowerCase() : "", kommunenr: a.kommunenummer };
}

async function lookup(c) {
  const nm = cleanName(c.n);
  let cands = await brregSearch(nm.query);
  if (!cands.length && nm.query !== nm.full) cands = await brregSearch(nm.full);
  if (!cands.length) return { c, status: "ingen" };
  cands.forEach(x => x.sc = score(c, x, nm));
  cands.sort((a, b) => b.sc.total - a.sc.total);
  const best = cands[0], second = cands[1];
  const tie = second && Math.abs(second.sc.total - best.sc.total) < .02 && second.adresse !== best.adresse;
  let sikkerhet = "lav";
  if (best.sc.s >= .99 && (best.sc.placeHit || (!c.ps && IOMR(best.kommunenr, c) && !tie))) sikkerhet = "høy";
  else if (best.sc.s >= .66 && (best.sc.placeHit || (!c.ps && IOMR(best.kommunenr, c))) && !tie) sikkerhet = "middels";
  if (best.sc.s < .5) return { c, status: "ingen", best };
  const g = await geocode(best.adresse, best.postnr, best.kommunenr);
  const KK = window.KK;
  let lat = g ? g.lat : null, lon = g ? g.lon : null, precise = !!g;
  if (!g) {
    const ps = Object.keys(KK.GEO.poststeder).find(p => p.toLowerCase() === best.poststed.toLowerCase());
    if (ps) { lat = KK.GEO.poststeder[ps][0]; lon = KK.GEO.poststeder[ps][1] }
    if (sikkerhet === "høy") sikkerhet = "middels";
  }
  const kommunenr = (g && g.kommunenr) || best.kommunenr;
  return {
    c, status: "treff", best, sikkerhet, precise,
    row: {
      kundenr: c.k, adresse: (g && g.adresse) || best.adresse || "(ingen gateadresse)", postnr: (g && g.postnr) || best.postnr,
      poststed: (g && g.poststed) || best.poststed, kommunenr, region: KK.GEO.regmap[kommunenr] || (KK.utenfor ? KK.utenfor(c.om) : "Utenfor Nord-Norge"),
      lat, lon, orgnr: best.orgnr, kilde: best.type === "underenhet" ? "Enhetsregisteret (avdeling)" : "Enhetsregisteret", sikkerhet
    }
  };
}

/* ---------- panel ---------- */
let results = [], running = false, abort = false, filter = "alle";
function open() {
  const P = $("adrDlg"); P.hidden = false;
  renderPanel();
}
function renderPanel() {
  const KK = window.KK;
  const have = Object.keys(KK.ADR).length;
  const counts = { høy: 0, middels: 0, lav: 0, ingen: 0 };
  results.forEach(r => counts[r.status === "ingen" ? "ingen" : r.sikkerhet]++);
  const sel = results.filter(r => r.checked && r.row).length;
  const show = results.filter(r => filter === "alle" || (filter === "ingen" ? r.status === "ingen" : r.sikkerhet === filter && r.status !== "ingen"));
  $("adrBody").innerHTML = `
    <div class="adrtop">
      <p>Søker i Enhetsregisteret etter hver kunde, velger det beste treffet ut fra navn og sted, og finner koordinatene hos Kartverket. Ingenting lagres før du trykker «Lagre valgte».</p>
      <div class="acts">
        <label class="chk"><input type="checkbox" id="adrSkip" ${have ? "checked" : ""}> Hopp over kunder som har adresse (${have})</label>
        ${running ? `<button type="button" class="btn" id="adrStop">Stopp</button>` : `<button type="button" class="btn pri" id="adrRun">${results.length ? "Søk på nytt" : "Start søk"}</button>`}
      </div>
      <div class="status" id="adrProg">${running ? "" : results.length ? `${results.length} kunder sjekket.` : ""}</div>
    </div>
    ${results.length ? `
    <div class="adrtabs" role="tablist">
      ${[["alle", "Alle", results.length], ["høy", "Høy", counts.høy], ["middels", "Middels", counts.middels], ["lav", "Lav", counts.lav], ["ingen", "Ingen treff", counts.ingen]].map(([k, l, n]) => `<button type="button" class="chip" data-f="${k}" aria-pressed="${filter === k}">${l} (${n})</button>`).join("")}
    </div>
    <div class="adrtable"><table>
      <thead><tr><th></th><th>Kunde</th><th>Foreslått adresse</th><th>Treff i registeret</th><th>Sikkerhet</th></tr></thead>
      <tbody>${show.map(r => {
        const i = results.indexOf(r);
        if (r.status === "ingen") return `<tr class="none"><td></td><td><b>${esc(r.c.n)}</b><div class="mut">${esc(r.c.ps || "Mangler sted")} · ${esc(r.c.k)}</div></td><td colspan="2" class="mut">${r.best ? `Nærmeste treff: ${esc(r.best.navn)} (${esc(r.best.poststed)})` : "Ingen treff i Enhetsregisteret"}</td><td><span class="sk ingen">Ingen</span></td></tr>`;
        return `<tr><td><input type="checkbox" data-i="${i}" ${r.checked ? "checked" : ""} aria-label="Velg ${esc(r.c.n)}"></td>
          <td><b>${esc(r.c.n)}</b><div class="mut">${esc(r.c.ps || "Mangler sted")} · ${esc(r.c.k)}</div></td>
          <td>${esc(r.row.adresse)}<div class="mut">${esc(r.row.postnr)} ${esc(r.row.poststed)} · ${esc(r.row.region)}${r.precise ? "" : " · bare poststed"}</div></td>
          <td>${esc(r.best.navn)}<div class="mut">Org.nr. ${esc(r.best.orgnr)} · ${r.best.type === "underenhet" ? "avdeling" : "hovedenhet"}</div></td>
          <td><span class="sk ${r.sikkerhet}">${r.sikkerhet[0].toUpperCase() + r.sikkerhet.slice(1)}</span></td></tr>`;
      }).join("")}</tbody></table></div>
    <div class="acts adrsave"><button type="button" class="btn pri" id="adrSave" ${sel && !running ? "" : "disabled"}>Lagre valgte (${sel})</button><span class="status" id="adrSaveMsg"></span></div>` : ""}`;
  if ($("adrRun")) $("adrRun").onclick = run;
  if ($("adrStop")) $("adrStop").onclick = () => abort = true;
  if ($("adrSave")) $("adrSave").onclick = save;
  document.querySelectorAll("#adrBody [data-f]").forEach(b => b.onclick = () => { filter = b.dataset.f; renderPanel() });
  document.querySelectorAll("#adrBody input[data-i]").forEach(cb => cb.onchange = () => { results[+cb.dataset.i].checked = cb.checked; const s = results.filter(r => r.checked && r.row).length; $("adrSave").textContent = `Lagre valgte (${s})`; $("adrSave").disabled = !s });
}
async function run() {
  const KK = window.KK;
  const skip = $("adrSkip") && $("adrSkip").checked;
  const list = KK.RAW.filter(c => !(skip && KK.ADR[c.k]));
  results = []; running = true; abort = false; filter = "alle"; renderPanel();
  let i = 0, done = 0;
  const worker = async () => {
    while (i < list.length && !abort) {
      const c = list[i++];
      let r;
      try { r = await lookup(c) } catch (e) { r = { c, status: "ingen", err: e.message } }
      r.checked = r.status === "treff" && (r.sikkerhet === "høy" || r.sikkerhet === "middels");
      results.push(r); done++;
      const p = $("adrProg"); if (p) p.textContent = `Søker … ${done} av ${list.length}`;
    }
  };
  try {
    const probe = await fetch(`${BRREG}/enheter?navn=lindab&size=1`);
    if (!probe.ok) throw new Error("HTTP " + probe.status);
  } catch (e) {
    running = false; renderPanel();
    $("adrProg").textContent = "Får ikke kontakt med Enhetsregisteret fra denne nettleseren (" + e.message + "). Prøv et annet nettverk, eller send feilen til Jørn.";
    return;
  }
  await Promise.all([worker(), worker(), worker()]);
  const order = new Map(KK.RAW.map((c, n) => [c.k, n]));
  const rank = r => r.status === "ingen" ? 4 : { høy: 1, middels: 2, lav: 3 }[r.sikkerhet];
  results.sort((a, b) => rank(a) - rank(b) || order.get(a.c.k) - order.get(b.c.k));
  running = false; renderPanel();
  if (abort) $("adrProg").textContent = `Stoppet etter ${results.length} kunder.`;
}
async function save() {
  const KK = window.KK;
  const rows = results.filter(r => r.checked && r.row).map(r => r.row);
  const msg = $("adrSaveMsg"); msg.textContent = "Lagrer …"; $("adrSave").disabled = true;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const { data, error } = await KK.sb.from("kunde_adresse").upsert(chunk).select();
    if (error) { msg.textContent = "Kunne ikke lagre: " + error.message; $("adrSave").disabled = false; return }
    KK.setAdr(data);
  }
  msg.textContent = `${rows.length} adresser lagret.`;
  results.forEach(r => { if (r.checked) { r.checked = false; r.saved = true } });
  results = results.filter(r => !r.saved);
  setTimeout(renderPanel, 1200);
}

document.addEventListener("click", e => {
  if (e.target.closest("#tAdr")) open();
  if (e.target.closest("#adrClose")) $("adrDlg").hidden = true;
});
window.KKAdr = { geocodeFree, cleanName, sim, lookup };
})();
