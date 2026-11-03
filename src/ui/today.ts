/** Onglet Aujourd'hui : le rituel de 5 minutes et le résumé du jour. */
import { html } from "./dom";
import { MODULES, moduleById } from "../modules";
import { dayKey, entryFor } from "../data/store";
import { suggestModules, streak, totals } from "../data/stats";
import type { App } from "./app";

export function renderToday(app: App): HTMLElement {
  const s = app.save, today = dayKey();
  const doneToday = new Set(s.sessions.filter((x) => dayKey(x.t) === today).map((x) => x.m));
  const entry = s.entries.find((e) => e.day === today);
  const picks = app.ritualPicks ?? (app.ritualPicks = suggestModules(s, 2));
  const steps = [
    { id: "souffle", title: "Souffle", sub: "1 min de respiration guidée", done: doneToday.has("souffle") },
    ...picks.map((id) => { const m = moduleById(id)!; return { id, title: m.name, sub: m.tagline, done: doneToday.has(id) }; }),
    { id: "journal", title: "Météo et Jardin", sub: "une émotion, une intention, trois mercis", done: !!(entry && entry.mood !== undefined && entry.intention) },
  ];
  const next = steps.find((st) => !st.done);
  const t = totals(s);
  const el = html(`<div class="list">
    <section class="card">
      <div class="eyebrow">Rituel du jour · ${steps.filter((x) => x.done).length}/${steps.length}</div>
      <h2>${next ? "Cinq minutes pour la tête" : "Rituel accompli, bravo"}</h2>
      <p class="muted">Souffle, puis deux exercices choisis pour les régions les moins travaillées cette semaine, puis le journal.</p>
      <div class="list" id="steps"></div>
      <div class="row">${next ? `<button class="btn" id="go">${steps.some((x) => x.done) ? "Continuer" : "Commencer"} · ${next.title}</button>` : ""}<button class="btn secondary small" id="reroll">Autres exercices</button></div>
    </section>
    <section class="card">
      <div class="eyebrow">En bref</div>
      <div class="tiles">
        <div class="tile"><b>${streak(s)}</b><span>jours d'affilée</span></div>
        <div class="tile"><b>${t.sessions}</b><span>séances au total</span></div>
        <div class="tile"><b>${t.minutes}</b><span>minutes d'entraînement</span></div>
        <div class="tile"><b>${t.avg7 ?? "–"}</b><span>indice moyen sur 7 jours</span></div>
      </div>
    </section>
  </div>`);
  const list = el.querySelector("#steps")!;
  for (const st of steps) {
    const b = html(`<button class="item ${st.done ? "done" : ""}"><b>${st.title}</b><span class="val">${st.done ? "fait" : "›"}</span><span class="sub">${st.sub}</span></button>`);
    b.addEventListener("click", () => (st.id === "journal" ? app.show("journal") : app.play(st.id)));
    list.appendChild(b);
  }
  el.querySelector("#go")?.addEventListener("click", () => (next!.id === "journal" ? app.show("journal") : app.play(next!.id)));
  el.querySelector("#reroll")!.addEventListener("click", () => { const pool = MODULES.filter((m) => m.id !== "souffle" && !picks.includes(m.id)).map((m) => m.id); app.ritualPicks = [pool[Math.floor(Math.random() * pool.length)], pool[Math.floor(Math.random() * pool.length)]].filter((v, i, a) => a.indexOf(v) === i); if (app.ritualPicks.length < 2) app.ritualPicks.push(pool.find((p) => !app.ritualPicks!.includes(p))!); app.refresh(); });
  void entryFor;
  return el;
}
