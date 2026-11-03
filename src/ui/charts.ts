/** Graphiques canvas pour l'onglet Statistiques (sans bibliothèque). */
import { cssVar } from "../engine/draw";

function prep(c: HTMLCanvasElement, h: number) {
  const w = c.clientWidth || c.parentElement?.clientWidth || 320, dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.height = `${h}px`;
  const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  ctx.font = `600 11px "Nunito Sans", system-ui, sans-serif`;
  return { ctx, w, h };
}

/** Barres : minutes par jour. */
export function bars(c: HTMLCanvasElement, data: { day: string; minutes: number }[]) {
  const { ctx, w, h } = prep(c, 140); const padL = 26, padB = 20, top = 8; void h;
  const max = Math.max(5, ...data.map((d) => d.minutes)); const bw = (w - padL - 6) / data.length;
  ctx.strokeStyle = cssVar("--line"); ctx.fillStyle = cssVar("--muted"); ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (const v of [0, max / 2, max]) { const y = top + (h - padB - top) * (1 - v / max); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillText(`${Math.round(v)}`, padL - 4, y); }
  data.forEach((d, i) => { const bh = ((h - padB - top) * d.minutes) / max; ctx.fillStyle = i === data.length - 1 ? cssVar("--accent-2") : cssVar("--accent"); ctx.beginPath(); ctx.roundRect(padL + i * bw + bw * 0.2, h - padB - bh, bw * 0.6, bh, 3); ctx.fill();
    const step = Math.ceil(data.length / 6); if (i === data.length - 1 || (i % step === 0 && data.length - 1 - i >= step / 2)) { ctx.fillStyle = cssVar("--muted"); ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(d.day.slice(8) + "/" + d.day.slice(5, 7), padL + i * bw + bw / 2, h - padB + 4); } });
}

/** Calendrier (12 semaines) : intensité = séances du jour. */
export function heatmap(c: HTMLCanvasElement, data: { day: string; count: number }[]) {
  const weeks = Math.ceil(data.length / 7) + 1; const cw = c.clientWidth || c.parentElement?.clientWidth || 320; const cell = Math.max(10, Math.min(28, (cw - 24) / weeks)), g = Math.max(2, cell * 0.14);
  const { ctx } = prep(c, 7 * cell + 18);
  const first = new Date(data[0].day + "T00:00:00"); const offset = (first.getDay() + 6) % 7; // lundi = 0
  ctx.fillStyle = cssVar("--muted"); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ["L", "M", "M", "J", "V", "S", "D"].forEach((d, i) => ctx.fillText(d, 0, 18 + i * cell + cell / 2));
  data.forEach((d, i) => { const k = i + offset, x = 20 + Math.floor(k / 7) * cell, y = 18 + (k % 7) * cell; const a = d.count === 0 ? 0 : Math.min(1, 0.35 + d.count * 0.25);
    ctx.fillStyle = cssVar("--surface-2"); ctx.beginPath(); ctx.roundRect(x, y, cell - g, cell - g, 3); ctx.fill(); if (a) { ctx.fillStyle = cssVar("--accent"); ctx.globalAlpha = a; ctx.beginPath(); ctx.roundRect(x, y, cell - g, cell - g, 3); ctx.fill(); ctx.globalAlpha = 1; } });
  const lastCol = Math.floor((data.length - 1 + offset) / 7);
  ctx.fillStyle = cssVar("--muted"); ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText(data[0].day.slice(5, 7) + "/" + data[0].day.slice(0, 4), 20, 2); ctx.textAlign = "right"; ctx.fillText("aujourd'hui", 20 + (lastCol + 1) * cell - g, 2);
}

/** Radar des régions (0-100). */
export function radar(c: HTMLCanvasElement, axes: { name: string; value: number }[]) {
  const { ctx, w } = prep(c, 260); const h = 260, cx = w / 2, cy = h / 2, R = Math.min(w - 120, h) * 0.38, n = axes.length;
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  ctx.strokeStyle = cssVar("--line"); for (const lv of [0.25, 0.5, 0.75, 1]) { ctx.beginPath(); for (let i = 0; i <= n; i++) { const [x, y] = pt(i % n, lv); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, 1); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); }
  ctx.beginPath(); for (let i = 0; i <= n; i++) { const [x, y] = pt(i % n, Math.max(0.03, axes[i % n].value / 100)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath();
  ctx.fillStyle = cssVar("--glow"); ctx.fill(); ctx.strokeStyle = cssVar("--accent"); ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = cssVar("--fg"); ctx.textBaseline = "middle";
  for (let i = 0; i < n; i++) { const [x, y] = pt(i, 1.22); ctx.textAlign = Math.abs(x - cx) < 10 ? "center" : x < cx ? "right" : "left"; ctx.fillText(axes[i].name, x, y); }
}

/** Mini-courbe des derniers scores. */
export function spark(c: HTMLCanvasElement, values: number[]) {
  const { ctx, w, h } = prep(c, 22); if (values.length < 2) return;
  ctx.strokeStyle = cssVar("--accent"); ctx.lineWidth = 1.5; ctx.beginPath();
  values.forEach((v, i) => { const x = 2 + (i / (values.length - 1)) * (w - 4), y = h - 2 - (v / 100) * (h - 4); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  const lx = w - 2, ly = h - 2 - (values[values.length - 1] / 100) * (h - 4); ctx.fillStyle = cssVar("--accent-2"); ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, 7); ctx.fill();
}

/** Courbe d'humeur sur 30 jours (index d'émotion → teinte), points absents = jours sans journal. */
export function moodLine(c: HTMLCanvasElement, values: (number | null)[], hues: number[], names: readonly string[]) {
  const { ctx, w, h } = prep(c, 90); const padL = 4, n = values.length, step = (w - padL * 2) / (n - 1);
  ctx.strokeStyle = cssVar("--line"); ctx.beginPath(); ctx.moveTo(padL, h - 12); ctx.lineTo(w - padL, h - 12); ctx.stroke();
  const y = (v: number) => 8 + (h - 24) * (1 - v / (names.length - 1)); // ordre : joie en haut … fatigue en bas
  ctx.strokeStyle = cssVar("--muted"); ctx.globalAlpha = 0.5; ctx.beginPath(); let started = false;
  values.forEach((v, i) => { if (v === null) { started = false; return; } const x = padL + i * step; started ? ctx.lineTo(x, y(v)) : ctx.moveTo(x, y(v)); started = true; }); ctx.stroke(); ctx.globalAlpha = 1;
  values.forEach((v, i) => { if (v === null) return; ctx.fillStyle = `hsl(${hues[v]} 65% 60%)`; ctx.beginPath(); ctx.arc(padL + i * step, y(v), 4, 0, 7); ctx.fill(); });
}
