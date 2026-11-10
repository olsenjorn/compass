/* Min profil: hjemmeadresse, bil (reell ladeeffekt), kontaktinfo og standarder for planleggeren.
   Lagres i public.profil (bare egen rad). */
(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KK = () => window.KK;

// Omtrentlige verdier (brukbar batterikapasitet kWh, maks DC kW, maks AC kW). Sjekk bilens papirer ved behov.
const BILER = [
  ["Audi Q4 e-tron 45/55", 77, 175, 11], ["BMW iX xDrive50", 105, 195, 11], ["BMW iX3", 74, 150, 11],
  ["BYD Atto 3", 60, 88, 11], ["Ford E-Transit (varebil)", 68, 115, 11], ["Ford Mustang Mach-E Extended", 91, 150, 11],
  ["Hyundai Ioniq 5 (84 kWh)", 84, 240, 11], ["Kia EV6 (84 kWh)", 84, 240, 11], ["Kia EV9", 96, 210, 11],
  ["Mercedes EQB", 66, 100, 11], ["Mercedes eVito / eSprinter", 81, 115, 11], ["MG4 Long Range", 74, 140, 11],
  ["Nissan Ariya 87 kWh", 87, 130, 22], ["Polestar 2 Long Range", 79, 205, 11], ["Polestar 3", 107, 250, 11],
  ["Skoda Enyaq 85", 77, 175, 11], ["Tesla Model 3 Long Range", 75, 250, 11], ["Tesla Model Y Long Range", 75, 250, 11],
  ["Toyota bZ4X", 71, 150, 11], ["Volvo EX30 Extended", 64, 153, 11], ["Volvo EX40 / XC40 Recharge", 79, 200, 11],
  ["Volvo EX90", 107, 250, 11], ["VW ID.4 / ID.5 Pro", 77, 135, 11], ["VW ID.4 GTX / ID.7", 86, 200, 11],
  ["VW ID. Buzz (varebil)", 86, 200, 11]
];
const DEF = { telefon: "", tittel: "", hjem: null, flyplass: "", drivstoff: "el", bil: "", batteri: null, dcKw: null, acKw: null,
  startKl: "07:00", besokMin: 60, lunsjMin: 30, pause: true, ferge: "auto", flyTransport: "leiebil" };
let P = { ...DEF }, loaded = false, homeMarker = null;

async function load() {
  const sb = KK() && KK().sb; if (!sb || !KK().ME) return setTimeout(load, 500);
  const { data } = await sb.from("profil").select("data").maybeSingle();
  P = { ...DEF, ...((data && data.data) || {}) };
  // tidligere lagret hjemmeadresse i nettleseren tas med første gang
  if (!P.hjem) { try { const h = JSON.parse(localStorage.getItem("kk_home") || "null"); if (h && h.lat != null) P.hjem = { adresse: h.adresse, lat: h.lat, lon: h.lon } } catch (e) { } }
  loaded = true; syncLocal(); drawHome();
  document.dispatchEvent(new Event("kk:profil"));
}
function syncLocal() { if (P.hjem) try { localStorage.setItem("kk_home", JSON.stringify({ adresse: P.hjem.adresse, lat: P.hjem.lat, lon: P.hjem.lon })) } catch (e) { } }
async function save(next) {
  P = { ...P, ...next };
  const { error } = await KK().sb.from("profil").upsert({ epost: KK().ME.epost, data: P, endret: new Date().toISOString() });
  if (error) throw new Error(error.message);
  syncLocal(); drawHome(); document.dispatchEvent(new Event("kk:profil"));
}
function drawHome() {
  const map = KK() && KK().map; if (!map) return setTimeout(drawHome, 500);
  if (homeMarker) { homeMarker.remove(); homeMarker = null }
  if (!P.hjem || P.hjem.lat == null) return;
  homeMarker = L.marker([P.hjem.lat, P.hjem.lon], { icon: L.divIcon({ className: "", html: `<div class="homeicon" title="Hjem">⌂</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1500, keyboard: false })
    .bindPopup(`<div class="pop"><h4>⌂ Hjem</h4>${esc(P.hjem.adresse)}</div>`).addTo(map);
}

/* Reell lading for valgt bil */
function lade(stasjonKw) {
  if (P.drivstoff !== "el" || !P.batteri || !stasjonKw) return null;
  const dc = stasjonKw >= 40;
  const kw = Math.min(stasjonKw, dc ? (P.dcKw || 50) : (P.acKw || 11));
  const snitt = dc ? kw * 0.72 : kw * 0.95; // DC trapper ned mot 80 %
  return { kw: Math.round(kw), min: Math.round(P.batteri * 0.7 / snitt * 60), dc };
}
function ladeTekst(stasjonKw) {
  const l = lade(stasjonKw); if (!l) return "";
  const t = l.min >= 60 ? `${Math.floor(l.min / 60)} t ${l.min % 60} min` : `${l.min} min`;
  return `<div class="ladeinfo">Din bil: maks ${l.kw} kW her · 10–80 % ca. ${t}</div>`;
}

function dialog() {
  const fly = (window.KKPlan && window.KKPlan.FLYPLASSER) || [];
  const D = $("profDlg");
  D.innerHTML = `<form class="card profcard" id="profForm">
    <h1 style="font-size:24px">Min profil</h1>
    <div class="mut">${esc(KK().ME.navn)} · ${esc(KK().ME.epost)}</div>
    <fieldset><legend>Kontakt</legend>
      <label class="f">Mobil<input id="pfTlf" type="tel" value="${esc(P.telefon)}" placeholder="+47 …" autocomplete="tel"></label>
      <label class="f">Stilling<input id="pfTit" value="${esc(P.tittel)}" placeholder="F.eks. Distriktssjef salg Profil"></label>
    </fieldset>
    <fieldset><legend>Hjem og reise</legend>
      <label class="f">Hjemmeadresse<input id="pfHjem" value="${esc(P.hjem ? P.hjem.adresse : "")}" placeholder="Gate nr, postnr sted" autocomplete="street-address"></label>
      <div class="mut" id="pfHjemMsg">${P.hjem && P.hjem.lat != null ? "✓ Funnet i kartet" : ""}</div>
      <label class="f">Nærmeste flyplass<select id="pfFly"><option value="">–</option>${fly.map(f => `<option value="${esc(f[0])}" ${P.flyplass === f[0] ? "selected" : ""}>${esc(f[1])}</option>`).join("")}</select></label>
      <label class="f">Til og fra flyplass<select id="pfFlyTr"><option value="leiebil" ${P.flyTransport === "leiebil" ? "selected" : ""}>Leiebil</option><option value="taxi" ${P.flyTransport === "taxi" ? "selected" : ""}>Taxi</option></select></label>
    </fieldset>
    <fieldset><legend>Bil</legend>
      <label class="f">Drivstoff<select id="pfDriv"><option value="el" ${P.drivstoff === "el" ? "selected" : ""}>Elbil</option><option value="hybrid" ${P.drivstoff === "hybrid" ? "selected" : ""}>Ladbar hybrid</option><option value="fossil" ${P.drivstoff === "fossil" ? "selected" : ""}>Bensin / diesel</option></select></label>
      <div id="pfElbil" ${P.drivstoff === "el" ? "" : "hidden"}>
        <label class="f">Modell<input id="pfBil" list="pfBilList" value="${esc(P.bil)}" placeholder="Skriv eller velg modell"></label>
        <datalist id="pfBilList">${BILER.map(b => `<option value="${esc(b[0])}"></option>`).join("")}</datalist>
        <div class="plrow small wrap">
          <label>Batteri <input type="number" id="pfBat" min="10" max="200" step="1" value="${P.batteri ?? ""}"> kWh</label>
          <label>Maks hurtiglading <input type="number" id="pfDc" min="20" max="500" step="5" value="${P.dcKw ?? ""}"> kW</label>
          <label>Maks lading AC <input type="number" id="pfAc" min="3" max="22" step="0.1" value="${P.acKw ?? ""}"> kW</label>
        </div>
        <div class="mut">Velger du en modell fylles verdiene inn. De er omtrentlige, så juster dem gjerne etter bilens papirer. Brukes til å vise reell ladeeffekt og ladetid på ladestasjonene.</div>
      </div>
    </fieldset>
    <fieldset><legend>Standarder i planleggeren</legend>
      <div class="plrow small wrap">
        <label>Start fra hjem kl. <input type="time" id="pfStart" value="${esc(P.startKl)}"></label>
        <label>Besøk <input type="number" id="pfBesok" min="10" step="5" value="${P.besokMin}"> min</label>
        <label>Lunsj <input type="number" id="pfLunsj" min="10" step="5" value="${P.lunsjMin}"> min</label>
      </div>
      <div class="plrow small wrap">
        <label class="chk"><input type="checkbox" id="pfPause" ${P.pause ? "checked" : ""}> 30 min pause etter 4 timer kjøring</label>
        <label>Ferge <select id="pfFerge"><option value="auto" ${P.ferge !== "vei" ? "selected" : ""}>Velg raskeste</option><option value="vei" ${P.ferge === "vei" ? "selected" : ""}>Unngå ferge</option></select></label>
      </div>
      <div class="mut">Gjelder nye ruter. Eksisterende ruter beholder sine innstillinger.</div>
    </fieldset>
    <div class="err" id="pfMsg" role="status"></div>
    <div class="acts"><button class="btn pri" type="submit">Lagre</button><button class="btn" type="button" id="pfX">Avbryt</button></div>
  </form>`;
  D.hidden = false;
  $("pfX").onclick = () => D.hidden = true;
  $("pfDriv").onchange = e => $("pfElbil").hidden = e.target.value !== "el";
  $("pfBil").onchange = e => { const b = BILER.find(x => x[0].toLowerCase() === e.target.value.trim().toLowerCase()); if (b) { $("pfBat").value = b[1]; $("pfDc").value = b[2]; $("pfAc").value = b[3] } };
  $("profForm").onsubmit = async e => {
    e.preventDefault(); const M = $("pfMsg"); M.textContent = "Lagrer …";
    let hjem = P.hjem; const ha = $("pfHjem").value.trim();
    if (ha && (!hjem || ha !== hjem.adresse)) {
      const g = await window.KKAdr.geocodeFree(ha).catch(() => null);
      if (!g) { M.textContent = "Fant ikke hjemmeadressen. Skriv gate, nummer og postnummer."; return }
      hjem = { adresse: `${g.adresse}, ${g.postnr} ${g.poststed}`, lat: g.lat, lon: g.lon };
    } else if (!ha) hjem = null;
    const num = (id, d) => { const v = parseFloat($(id).value); return isNaN(v) ? d : v };
    try {
      await save({ telefon: $("pfTlf").value.trim(), tittel: $("pfTit").value.trim(), hjem, flyplass: $("pfFly").value, flyTransport: $("pfFlyTr").value,
        drivstoff: $("pfDriv").value, bil: $("pfBil").value.trim(), batteri: num("pfBat", null), dcKw: num("pfDc", null), acKw: num("pfAc", null),
        startKl: $("pfStart").value || "07:00", besokMin: Math.max(10, num("pfBesok", 60)), lunsjMin: Math.max(10, num("pfLunsj", 30)), pause: $("pfPause").checked, ferge: $("pfFerge").value });
      D.hidden = true;
    } catch (err) { M.textContent = "Kunne ikke lagre: " + err.message }
  };
}

function init() {
  if (!$("acctMenu")) return setTimeout(init, 300);
  if (!$("profBtn")) {
    const b = document.createElement("button"); b.type = "button"; b.id = "profBtn"; b.textContent = "Min profil";
    const pw = $("pwBtn"); pw.parentNode.insertBefore(b, pw);
    b.onclick = () => dialog();
  }
  if (!$("profDlg")) { const d = document.createElement("div"); d.className = "dlg"; d.id = "profDlg"; d.hidden = true; document.body.appendChild(d) }
  load();
}
init();
window.KKProfil = { get p() { return P }, get loaded() { return loaded }, load, save, lade, ladeTekst, open: dialog, BILER };
})();
