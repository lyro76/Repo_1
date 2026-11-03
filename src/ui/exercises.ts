/** Onglet Exercices : les 16 modules, filtrables par région. */
import { html } from "./dom";
import { MODULES } from "../modules";
import { REGIONS, type RegionId } from "../data/regions";
import { bestOf } from "../data/stats";
import type { App } from "./app";

export function renderExercises(app: App): HTMLElement {
  const el = html(`<div class="list"><section class="card"><div class="eyebrow">Exercices</div><h2>Choisis un entraînement</h2><div class="select" id="filter"></div></section><div class="list" id="mods"></div></div>`);
  const filter = el.querySelector("#filter")!, list = el.querySelector("#mods")!;
  const draw = () => {
    list.innerHTML = "";
    for (const m of MODULES.filter((x) => !app.filterRegion || x.regions.includes(app.filterRegion))) {
      const best = bestOf(app.save, m.id);
      const b = html(`<button class="item"><b>${m.name}</b><span class="val">${best ? best.s : "–"}</span><span class="sub">${m.tagline} · ${Math.round(m.duration / 60 * 10) / 10 >= 1 ? Math.round(m.duration / 60) + " min" : m.duration + " s"} · ${m.regions.map((r) => REGIONS.find((x) => x.id === r)!.name).join(", ")}</span></button>`);
      b.addEventListener("click", () => app.play(m.id)); list.appendChild(b);
    }
  };
  const chips: { id: RegionId | null; name: string }[] = [{ id: null, name: "Tout" }, ...REGIONS.map((r) => ({ id: r.id, name: r.name }))];
  for (const c of chips) { const b = html(`<button class="${app.filterRegion === c.id ? "on" : ""}">${c.name}</button>`); b.addEventListener("click", () => { app.filterRegion = c.id; filter.querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); draw(); }); filter.appendChild(b); }
  draw();
  return el;
}
