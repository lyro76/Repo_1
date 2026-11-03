/** Onglet Cerveau : progression par région. */
import { html } from "./dom";
import { REGIONS } from "../data/regions";
import { MODULES } from "../modules";
import { regionScores } from "../data/stats";
import type { App } from "./app";

export function renderBrain(app: App): HTMLElement {
  const rs = regionScores(app.save);
  const el = html(`<div class="list"><section class="card"><div class="eyebrow">Carte du cerveau</div><h2>Où en est chaque région</h2><p class="muted">Indice sur 30 jours : moyenne des scores, pondérée par la régularité (cinq séances pour un plein effet). Le cerveau travaille en réseaux ; cette carte est un repère, pas un diagnostic.</p></section></div>`);
  for (const r of REGIONS) {
    const mods = MODULES.filter((m) => m.regions.includes(r.id));
    const c = html(`<section class="card"><div class="row" style="justify-content:space-between"><h2 style="font-size:17px">${r.name}</h2><span class="pill">${rs[r.id].score}</span></div><div class="bar"><i style="width:${rs[r.id].score}%"></i></div><div class="muted">${r.role} · ${rs[r.id].sessions} séance${rs[r.id].sessions > 1 ? "s" : ""} sur 30 jours</div><div class="row" id="m"></div></section>`);
    const row = c.querySelector("#m")!;
    for (const m of mods) { const b = html(`<button class="btn secondary small">${m.name}</button>`); b.addEventListener("click", () => app.play(m.id)); row.appendChild(b); }
    if (r.id === "ganglions" || r.id === "limbique") { const b = html(`<button class="btn secondary small">Journal</button>`); b.addEventListener("click", () => app.show("journal")); row.appendChild(b); }
    el.appendChild(c);
  }
  return el;
}
