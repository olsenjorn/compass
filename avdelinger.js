/* Lindab-avdelinger: faste markører i kartet, alltid synlige. Legg til nye avdelinger i lista. */
(function () {
const AVD = [
  { navn: "Lindab Tromsø", adresse: "Ringvegen 13", postnr: "9018", sted: "Tromsø", lat: 69.693196, lon: 19.008256, orgnr: "" },
  { navn: "Lindab Harstad", adresse: "Mercurveien 33", postnr: "9408", sted: "Harstad", lat: 68.789530, lon: 16.552683, orgnr: "" }
];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LOGO = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M9 7v10h6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function init() {
  const map = window.KK && window.KK.map;
  if (!map) return setTimeout(init, 400);
  const layer = L.layerGroup().addTo(map);
  AVD.forEach(a => {
    const q = encodeURIComponent(`${a.adresse}, ${a.postnr} ${a.sted}`);
    L.marker([a.lat, a.lon], {
      icon: L.divIcon({ className: "", html: `<div class="avdicon">${LOGO}<span>${esc(a.sted)}</span></div>`, iconSize: null, iconAnchor: [14, 14] }),
      zIndexOffset: 2000, keyboard: false
    }).bindPopup(`<div class="pop"><h4>${esc(a.navn)}</h4>${esc(a.adresse)}, ${esc(a.postnr)} ${esc(a.sted)}<br>
      <a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Åpne i Google Maps ↗</a></div>`, { maxWidth: 260 })
      .addTo(layer);
  });
}
init();
window.KKAvd = AVD;
})();
