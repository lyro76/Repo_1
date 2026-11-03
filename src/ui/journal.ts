/** Onglet Journal : Météo intérieure, intention, trois mercis, et le Jardin (arbre procédural). */
import { html, esc, fmtDay } from "./dom";
import { cssVar } from "../engine/draw";
import { Rng } from "../engine/rng";
import { dayKey, entryFor, persist, EMOTIONS, EMOTION_HUES, type Save } from "../data/store";
import type { App } from "./app";

/** Jours « tenus » = entrées avec au moins une émotion ou une intention. */
export const heldDays = (s: Save) => s.entries.filter((e) => e.mood !== undefined || e.intention || e.thanks?.some(Boolean)).length;

interface Branch { x: number; y: number; nx: number; ny: number; w: number; depth: number }
export function buildTree(days: number, seed = 20261103): Branch[] {
  const out: Branch[] = []; const rng = new Rng(seed); const depthMax = Math.min(11, 1 + Math.floor(days / 2));
  const rec = (x: number, y: number, ang: number, len: number, depth: number, w: number) => {
    if (depth > depthMax || len < 0.01) return; const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len; out.push({ x, y, nx, ny, w, depth });
    const k = 2 + (rng.chance(0.3) ? 1 : 0); for (let i = 0; i < k; i++) { const spread = (i - (k - 1) / 2) * (0.55 + rng.next() * 0.3); rec(nx, ny, ang + spread + (rng.next() - 0.5) * 0.2, len * (0.68 + rng.next() * 0.1), depth + 1, w * 0.68); }
  };
  rec(0.5, 0.96, -Math.PI / 2, 0.2, 1, 9);
  return out;
}

export function drawTree(c: HTMLCanvasElement, days: number) {
  const w = c.clientWidth || 320, h = 220, dpr = Math.min(2, window.devicePixelRatio || 1); c.width = w * dpr; c.height = h * dpr; c.style.height = `${h}px`;
  const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.lineCap = "round";
  const br = buildTree(days), maxD = Math.max(1, ...br.map((b) => b.depth)); const leaves = days % 2 === 1; // jour impair : feuilles en bout
  for (const b of br) { ctx.strokeStyle = b.depth >= maxD - 1 ? cssVar("--accent") : cssVar("--fg"); ctx.globalAlpha = b.depth >= maxD - 1 ? 0.95 : 0.8; ctx.lineWidth = Math.max(1, b.w * (w / 360)); ctx.beginPath(); ctx.moveTo(b.x * w, b.y * h); ctx.lineTo(b.nx * w, b.ny * h); ctx.stroke();
    if (b.depth === maxD && leaves) { ctx.fillStyle = cssVar("--accent-2"); ctx.beginPath(); ctx.arc(b.nx * w, b.ny * h, 3, 0, 7); ctx.fill(); } }
  ctx.globalAlpha = 1; ctx.strokeStyle = cssVar("--line"); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w * 0.15, h * 0.96); ctx.lineTo(w * 0.85, h * 0.96); ctx.stroke();
  if (days === 0) { ctx.fillStyle = cssVar("--muted"); ctx.font = `600 13px "Nunito Sans", system-ui, sans-serif`; ctx.textAlign = "center"; ctx.fillText("Le premier jour tenu fera sortir une pousse.", w / 2, h * 0.5); }
}

export function renderJournal(app: App): HTMLElement {
  const s = app.save, today = dayKey(), e = entryFor(s, today), held = heldDays(s);
  const el = html(`<div class="list">
    <section class="card"><div class="eyebrow">Jardin</div><div class="row" style="justify-content:space-between"><h2>${held} jour${held > 1 ? "s" : ""} tenu${held > 1 ? "s" : ""}</h2><span class="muted">un arbre unique, qui attend les jours manqués</span></div><canvas class="chart" id="tree"></canvas></section>
    <section class="card"><div class="eyebrow">Météo intérieure · ${fmtDay(today)}</div><h2>Comment c'est, là, maintenant ?</h2><div class="emos" id="emos"></div></section>
    <section class="card"><div class="eyebrow">Le matin</div><label>Mon intention pour aujourd'hui<input type="text" id="intention" maxlength="140" placeholder="Une phrase, pas plus." value="${esc(e.intention ?? "")}"></label></section>
    <section class="card"><div class="eyebrow">Le soir</div><label>Trois choses qui ont bien marché<input type="text" id="t0" maxlength="120" value="${esc(e.thanks?.[0] ?? "")}"><input type="text" id="t1" maxlength="120" value="${esc(e.thanks?.[1] ?? "")}"><input type="text" id="t2" maxlength="120" value="${esc(e.thanks?.[2] ?? "")}"></label><label>Une note libre<textarea id="note" maxlength="1000">${esc(e.note ?? "")}</textarea></label><div class="row"><button class="btn" id="save">Enregistrer la journée</button><span class="muted" id="saved"></span></div></section>
    <section class="card"><div class="eyebrow">Journal</div><div class="list" id="entries"></div></section>
  </div>`);
  const emos = el.querySelector("#emos")!;
  EMOTIONS.forEach((name, i) => { const b = html(`<button class="${e.mood === i ? "on" : ""}"><i style="background:hsl(${EMOTION_HUES[i]} 65% 60%)"></i>${name}</button>`); b.addEventListener("click", () => { e.mood = i; persist(s); emos.querySelectorAll("button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); app.header(); drawTree(el.querySelector("#tree") as HTMLCanvasElement, heldDays(s)); }); emos.appendChild(b); });
  const commit = () => { e.intention = (el.querySelector("#intention") as HTMLInputElement).value.trim(); e.thanks = ["t0", "t1", "t2"].map((id) => (el.querySelector("#" + id) as HTMLInputElement).value.trim()); e.note = (el.querySelector("#note") as HTMLTextAreaElement).value.trim(); persist(s); };
  el.querySelector("#save")!.addEventListener("click", () => { commit(); el.querySelector("#saved")!.textContent = "Enregistré."; app.header(); drawTree(el.querySelector("#tree") as HTMLCanvasElement, heldDays(s)); listEntries(); });
  el.querySelector("#intention")!.addEventListener("change", commit);
  const listEntries = () => { const box = el.querySelector("#entries")!; box.innerHTML = ""; const past = s.entries.filter((x) => x.day !== today && (x.mood !== undefined || x.intention || x.thanks?.some(Boolean) || x.note)).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 30);
    if (!past.length) box.appendChild(html(`<p class="muted">Les journées enregistrées apparaîtront ici.</p>`));
    for (const x of past) box.appendChild(html(`<div class="entry"><small>${fmtDay(x.day)}${x.mood !== undefined ? ` · ${EMOTIONS[x.mood]}` : ""}</small>${x.intention ? `<div><b>Intention :</b> ${esc(x.intention)}</div>` : ""}${x.thanks?.some(Boolean) ? `<div><b>Merci :</b> ${x.thanks.filter(Boolean).map(esc).join(" · ")}</div>` : ""}${x.note ? `<div>${esc(x.note)}</div>` : ""}</div>`)); };
  listEntries();
  requestAnimationFrame(() => drawTree(el.querySelector("#tree") as HTMLCanvasElement, held));
  return el;
}
