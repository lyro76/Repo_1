/** Onglet Statistiques : résumé, calendrier, minutes par jour, radar des régions, tableau par module, humeur. */
import { html } from "./dom";
import { REGIONS } from "../data/regions";
import { EMOTIONS, EMOTION_HUES } from "../data/store";
import { moduleStats, regionScores, sessionsPerDay, streak, totals, moodSeries } from "../data/stats";
import { bars, heatmap, radar, spark, moodLine } from "./charts";
import type { App } from "./app";

export function renderStats(app: App): HTMLElement {
  const s = app.save, t = totals(s), ms = moduleStats(s), rs = regionScores(s);
  const days14 = sessionsPerDay(s, 14), days84 = sessionsPerDay(s, 84);
  const bestDay = days84.reduce((p, c) => (c.count > p.count ? c : p), days84[0]);
  const el = html(`<div class="list">
    <section class="card"><div class="eyebrow">Statistiques</div><h2>Ta progression</h2>
      <div class="tiles">
        <div class="tile"><b>${streak(s)}</b><span>jours d'affilée</span></div>
        <div class="tile"><b>${t.days}</b><span>jours actifs</span></div>
        <div class="tile"><b>${t.sessions}</b><span>séances</span></div>
        <div class="tile"><b>${t.minutes}</b><span>minutes</span></div>
        <div class="tile"><b>${t.avg7 ?? "–"}</b><span>indice moyen, 7 jours</span></div>
        <div class="tile"><b>${bestDay.count}</b><span>record de séances en un jour</span></div>
      </div></section>
    <section class="card"><div class="eyebrow">Régularité · 12 semaines</div><canvas class="chart" id="heat"></canvas><div class="legend"><span><i style="background:var(--surface-2)"></i>rien</span><span><i style="background:var(--accent);opacity:.5"></i>1 séance</span><span><i style="background:var(--accent)"></i>3 et plus</span></div></section>
    <section class="card"><div class="eyebrow">Minutes par jour · 14 jours</div><canvas class="chart" id="bars"></canvas></section>
    <section class="card"><div class="eyebrow">Régions · 30 jours</div><canvas class="chart" id="radar"></canvas><p class="muted">Un radar équilibré vaut mieux qu'une pointe : le rituel pousse vers les régions creuses.</p></section>
    <section class="card"><div class="eyebrow">Par exercice</div><div style="overflow-x:auto"><table><thead><tr><th>Exercice</th><th class="num">Séances</th><th class="num">Record</th><th class="num">Dernier</th><th>10 derniers</th><th class="num">Tendance</th></tr></thead><tbody id="rows"></tbody></table></div><p class="muted">Tendance : différence entre la moyenne des cinq derniers scores et celle des cinq précédents.</p></section>
    <section class="card"><div class="eyebrow">Météo intérieure · 30 jours</div><canvas class="chart" id="mood"></canvas><div class="legend" id="moodlegend"></div></section>
    <section class="card"><div class="eyebrow">Données</div><div class="row"><button class="btn secondary small" id="export">Copier mes données (JSON)</button><button class="btn secondary small" id="reset">Tout effacer</button></div><p class="muted" id="msg">Tout reste sur ce téléphone. Rien n'est envoyé.</p></section>
  </div>`);
  const rows = el.querySelector("#rows")!;
  for (const m of ms) {
    const tr = html(`<tr><td>${m.name}</td><td class="num">${m.count}</td><td class="num">${m.count ? Math.round(m.best) : "–"}</td><td class="num">${m.last === null ? "–" : Math.round(m.last)}</td><td><canvas class="spark"></canvas></td><td class="num ${m.trend > 0 ? "trend-up" : m.trend < 0 ? "trend-down" : ""}">${m.count >= 4 ? (m.trend > 0 ? "+" : "") + m.trend : "–"}</td></tr>`);
    rows.appendChild(tr); requestAnimationFrame(() => spark(tr.querySelector("canvas")!, m.recent));
  }
  const ml = el.querySelector("#moodlegend")!; EMOTIONS.forEach((e, i) => ml.appendChild(html(`<span><i style="background:hsl(${EMOTION_HUES[i]} 65% 60%);border-radius:50%"></i>${e}</span>`)));
  requestAnimationFrame(() => {
    heatmap(el.querySelector("#heat") as HTMLCanvasElement, days84);
    bars(el.querySelector("#bars") as HTMLCanvasElement, days14);
    radar(el.querySelector("#radar") as HTMLCanvasElement, REGIONS.map((r) => ({ name: r.short, value: rs[r.id].score })));
    moodLine(el.querySelector("#mood") as HTMLCanvasElement, moodSeries(s, 30), EMOTION_HUES, EMOTIONS);
  });
  el.querySelector("#export")!.addEventListener("click", async () => { const msg = el.querySelector("#msg")!; try { await navigator.clipboard.writeText(JSON.stringify(s)); msg.textContent = "Données copiées dans le presse-papiers."; } catch { msg.textContent = JSON.stringify(s).slice(0, 2000); } });
  el.querySelector("#reset")!.addEventListener("click", (ev) => { const b = ev.currentTarget as HTMLButtonElement; if (b.dataset.armed) { app.reset(); } else { b.dataset.armed = "1"; b.textContent = "Confirmer l'effacement"; setTimeout(() => { delete b.dataset.armed; b.textContent = "Tout effacer"; }, 4000); } });
  return el;
}
