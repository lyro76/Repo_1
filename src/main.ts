import "./style.css";
import { Game } from "./game/game";
import { Dmd } from "./render/dmd";
import { TableRenderer } from "./render/table";
import { TW, TH } from "./table/shell";
import { fmt } from "./game/game";

const $ = (id: string) => document.getElementById(id)!;
const game = new Game();
const dmd = new Dmd($("dmd") as HTMLCanvasElement);
const table = new TableRenderer($("table") as HTMLCanvasElement);
const field = $("field"), tcanvas = $("table") as HTMLCanvasElement;
let nPlayers = 1;

// ----- menu -----
const pick = $("pick");
for (let i = 1; i <= 6; i++) { const b = document.createElement("button"); b.textContent = String(i); b.className = i === 1 ? "on" : ""; b.addEventListener("click", () => { nPlayers = i; pick.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }); pick.appendChild(b); }
const start = () => { game.sfx.unlock(); game.startGame(nPlayers); $("menu").hidden = true; $("over").hidden = true; };
$("start").addEventListener("click", start);
$("again").addEventListener("click", start);
$("tomenu").addEventListener("click", () => { game.screen = "menu"; $("over").hidden = true; $("menu").hidden = false; });

// ----- commandes tactiles (barre du bas) et clavier -----
const hold = (id: string, on: () => void, off: () => void) => { const el = $(id); const down = (e: Event) => { e.preventDefault(); el.classList.add("down"); game.sfx.unlock(); on(); }; const up = (e: Event) => { e.preventDefault(); if (!el.classList.contains("down")) return; el.classList.remove("down"); off(); };
  el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("pointerleave", up); el.addEventListener("contextmenu", (e) => e.preventDefault()); };
hold("bL", () => game.flip("L", true), () => game.flip("L", false));
hold("bR", () => game.flip("R", true), () => game.flip("R", false));
hold("go", () => game.launch(true), () => game.launch(false));
hold("nL", () => game.nudge(-1), () => {});
hold("nR", () => game.nudge(1), () => {});
const keys: Record<string, () => void> = {};
window.addEventListener("keydown", (e) => { if (e.repeat) return; game.sfx.unlock(); const k = e.key.toLowerCase();
  if (k === "a" || k === "q" || k === "shift" && e.location === 1) game.flip("L", true); if (k === "p" || k === "m" || k === "shift" && e.location === 2) game.flip("R", true);
  if (k === " " || k === "enter") { if (game.screen === "menu") start(); else game.launch(true); e.preventDefault(); }
  if (k === "arrowleft") game.nudge(-1); if (k === "arrowright") game.nudge(1); if (k === "escape" && game.screen !== "menu") { game.screen = "menu"; $("menu").hidden = false; } });
window.addEventListener("keyup", (e) => { const k = e.key.toLowerCase(); if (k === "a" || k === "q" || k === "shift" && e.location === 1) game.flip("L", false); if (k === "p" || k === "m" || k === "shift" && e.location === 2) game.flip("R", false); if (k === " " || k === "enter") game.launch(false); });
void keys;
// toucher directement le plateau : moitié gauche = palette gauche, moitié droite = palette droite
tcanvas.addEventListener("pointerdown", (e) => { if (game.screen === "menu" || game.screen === "gameover") return; game.sfx.unlock(); const side = e.offsetX < tcanvas.clientWidth / 2 ? "L" : "R"; game.flip(side, true); (e.target as HTMLElement).setPointerCapture(e.pointerId); const up = () => { game.flip(side, false); tcanvas.removeEventListener("pointerup", up); tcanvas.removeEventListener("pointercancel", up); }; tcanvas.addEventListener("pointerup", up); tcanvas.addEventListener("pointercancel", up); if (game.screen === "bonus") game.launch(true); });

// ----- boucle -----
let last = performance.now(), acc = 0; const STEP = 1 / 120;
function resize() { const dpr = Math.min(2, window.devicePixelRatio || 1); const w = field.clientWidth, h = field.clientHeight; tcanvas.width = Math.round(w * dpr); tcanvas.height = Math.round(h * dpr); }
resize(); window.addEventListener("resize", resize);
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
  while (acc >= STEP) { game.update(STEP); acc -= STEP; }
  const w = field.clientWidth, h = field.clientHeight, scale = Math.min(w / TW, h / TH), ox = (w - TW * scale) / 2, oy = (h - TH * scale) / 2;
  table.draw(game, scale, ox, oy); dmd.compose(game); dmd.draw(game.screen === "tilt" ? "#ff4a3c" : game.screen === "multiball" ? "#7dff8a" : "#ff9a2a");
  if (game.screen === "gameover" && $("over").hidden) { $("over").hidden = false; const r = $("ranking"); r.innerHTML = ""; game.players.map((p, i) => ({ i, s: p.score })).sort((a, b) => b.s - a.s).forEach((p, k) => { const d = document.createElement("div"); d.innerHTML = `<span>${k + 1}. Joueur ${p.i + 1}</span><span>${fmt(p.s)}</span>`; r.appendChild(d); }); }
  if (game.screen === "menu" && $("menu").hidden) $("menu").hidden = false;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __nova: Game }).__nova = game;
