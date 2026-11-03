/** Afficheur à points 128×32, façon flipper des années 90 : score, messages, animations. */
import { blit, textWidth } from "./font";
import { type Game, fmt, BALLS_PER_PLAYER } from "../game/game";
import { WORLDS } from "../table/worlds";

export const DW = 128, DH = 32;

export class Dmd {
  grid = new Uint8Array(DW * DH);
  private prev = new Float32Array(DW * DH); // rémanence
  constructor(private canvas: HTMLCanvasElement) {}

  private clear() { this.grid.fill(0); }
  private center(s: string, y: number, scale = 1) { blit(this.grid, DW, DH, s, Math.floor((DW - textWidth(s) * scale) / 2), y, scale); }
  private right(s: string, y: number, x = DW - 1, scale = 1) { blit(this.grid, DW, DH, s, x - textWidth(s) * scale, y, scale); }

  compose(g: Game) {
    this.clear(); const t = g.time;
    const msg = g.msgs[0];
    if (g.screen === "menu") {
      const phase = Math.floor(g.attractT / 3) % 3;
      if (phase === 0) { this.center("NOVA", 2, 3); this.center("FLIPPER", 25); }
      else if (phase === 1) { this.center("1 A 6 JOUEURS", 4); this.center("CHOISIS ET LANCE", 14); this.center(`${WORLDS.length} MONDES A TRAVERSER`, 24); }
      else { this.center("MEILLEURS SCORES", 2); const hs = g.highScores.slice(0, 3); if (!hs.length) this.center("AUCUN POUR L'INSTANT", 16); hs.forEach((h, i) => { blit(this.grid, DW, DH, `${i + 1}. ${h.name}`, 10, 11 + i * 7); this.right(fmt(h.score), 11 + i * 7, 118); }); }
      return;
    }
    if (g.screen === "gameover") {
      this.center("FIN DE PARTIE", 1); const ranked = g.players.map((p, i) => ({ i, s: p.score })).sort((a, b) => b.s - a.s).slice(0, 3);
      ranked.forEach((r, k) => { blit(this.grid, DW, DH, `${k + 1}. JOUEUR ${r.i + 1}`, 6, 10 + k * 7); this.right(fmt(r.s), 10 + k * 7, 122); });
      if (Math.floor(t * 2) % 2 === 0 && ranked.length < 3) this.center("LANCER = MENU", 25); return;
    }
    if (g.screen === "bonus") {
      if (!g.wheelStopped) { this.center("ROUE NOVA", 2, 2); this.center(Math.floor(t * 3) % 2 ? "TOUCHE LANCER" : "POUR ARRETER", 22); }
      else if (msg) { this.center(msg.text, 4, msg.text.length > 10 ? 1 : 2); if (msg.sub) this.center(msg.sub, 24); }
      return;
    }
    const p = g.player;
    if (msg && g.screen !== "tilt") {
      const big = msg.text.length <= 10; this.center(msg.text, big ? 4 : 8, big ? 2 : 1); if (msg.sub) this.center(msg.sub, 24);
      // score en petit à gauche pendant un message long
      if (!msg.sub) this.center(fmt(p.score), 24);
      return;
    }
    if (g.screen === "tilt") { if (Math.floor(t * 4) % 2 === 0) this.center("TILT", 4, 3); return; }
    // affichage normal : score en gros, joueur / bille / monde en bas
    const sc = fmt(p.score); const scale = sc.length <= 7 ? 3 : sc.length <= 10 ? 2 : 1;
    this.right(sc, scale === 3 ? 1 : 3, DW - 2, scale);
    blit(this.grid, DW, DH, g.players.length > 1 ? `J${g.current + 1}/${g.players.length}` : "J1", 1, 25);
    this.center(`BILLE ${BALLS_PER_PLAYER - p.balls + 1}`, 25);
    this.right(WORLDS[p.world].name, 25, DW - 2);
    if (g.multiball) blit(this.grid, DW, DH, "MULTI", 1, 2);
    else if (g.ballInPlunger && Math.floor(t * 2) % 2 === 0) blit(this.grid, DW, DH, "LANCE", 1, 2);
    else if (g.ballSave > 0 && Math.floor(t * 4) % 2 === 0) blit(this.grid, DW, DH, "SAUVE", 1, 2);
  }

  draw(color = "#ff9a2a") {
    const c = this.canvas, dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth || 384, h = Math.round(w / 4);
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#1a0d05"; ctx.fillRect(0, 0, w, h);
    const sx = w / DW, sy = h / DH, r = Math.min(sx, sy) * 0.36;
    ctx.fillStyle = "#2a1408"; for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) { ctx.beginPath(); ctx.arc(x * sx + sx / 2, y * sy + sy / 2, r * 0.8, 0, 7); ctx.fill(); }
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 6;
    for (let i = 0; i < this.grid.length; i++) { const target = this.grid[i]; this.prev[i] = target ? 1 : this.prev[i] * 0.35; const a = this.prev[i]; if (a < 0.05) continue; const x = i % DW, y = Math.floor(i / DW); ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x * sx + sx / 2, y * sy + sy / 2, r, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
}
