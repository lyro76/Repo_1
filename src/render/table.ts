/** Rendu du plateau en Canvas 2D, piloté par la définition de table : décor du monde, plastiques, lampes, rails, éléments, bille, roue, portail. */
import { type Game, WHEEL } from "../game/game";
import { TW, TH, PLUNGER } from "../table/shell";
import { shellPlastics } from "../table/shell";
import { WORLDS, type WorldTheme } from "../table/worlds";
import { flipperTip, BALL_R, type Segment, type Disc, type Flipper } from "../physics/world";
import { Rng } from "../engine/rng";
import type { Lamp, TableDef } from "../table/types";

export class TableRenderer {
  private deco: { x: number; y: number; r: number; a: number }[];
  private stars: { x: number; y: number; r: number }[];
  constructor(private canvas: HTMLCanvasElement) {
    const rng = new Rng(7); this.deco = Array.from({ length: 60 }, () => ({ x: rng.range(0, TW), y: rng.range(0, TH), r: rng.range(6, 40), a: rng.range(0, 7) }));
    this.stars = Array.from({ length: 120 }, () => ({ x: rng.range(0, TW), y: rng.range(0, TH), r: rng.range(0.5, 2) }));
  }

  draw(g: Game, scale: number, ox: number, oy: number) {
    const c = this.canvas, ctx = c.getContext("2d")!; const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, c.width / dpr, c.height / dpr);
    const shake = g.shake > 0 ? Math.sin(g.time * 60) * g.shake * 12 : 0;
    ctx.translate(ox + shake, oy); ctx.scale(scale, scale);
    const th = WORLDS[g.player ? g.player.world : Math.floor(g.attractT / 5) % WORLDS.length], tb = g.table;
    this.background(ctx, g, th);
    tb.art?.(ctx, g.time, th.accent);
    this.decor(ctx, g, th, tb);
    for (const l of tb.lamps) this.lamp(ctx, l, this.lampOn(g, l.id), th);
    this.elements(ctx, g, th, tb);
    this.balls(ctx, g, 0);
    this.ramps(ctx, g, th, tb);
    this.balls(ctx, g, 1);
    if (g.screen === "bonus") this.wheel(ctx, g, th);
    if (g.screen === "warp") this.warp(ctx, g, th);
    if (g.flash.has("world")) { ctx.fillStyle = th.accent; ctx.globalAlpha = g.flash.get("world")! * 0.35; ctx.fillRect(0, 0, TW, TH); ctx.globalAlpha = 1; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private background(ctx: CanvasRenderingContext2D, g: Game, th: WorldTheme) {
    const grad = ctx.createLinearGradient(0, 0, 0, TH); grad.addColorStop(0, th.bg1); grad.addColorStop(1, th.bg2);
    ctx.fillStyle = "#050508"; ctx.fillRect(0, 0, TW, TH);
    ctx.save(); ctx.beginPath(); ctx.moveTo(10, 200); ctx.arc(200, 200, 190, Math.PI, 0); ctx.lineTo(390, 775); ctx.lineTo(10, 775); ctx.closePath(); ctx.clip();
    ctx.fillStyle = grad; ctx.fillRect(0, 0, TW, TH);
    ctx.globalAlpha = 0.35;
    if (th.pattern === "stars") { ctx.fillStyle = "#fff"; for (const s of this.stars) { ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(g.time * 1.5 + s.x)); ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); } }
    else if (th.pattern === "circuit") { ctx.strokeStyle = th.ink; ctx.lineWidth = 2; for (const d of this.deco) { ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(d.a) * d.r * 2, d.y); ctx.lineTo(d.x + Math.cos(d.a) * d.r * 2, d.y + Math.sin(d.a) * d.r * 2); ctx.stroke(); ctx.fillStyle = th.ink; ctx.beginPath(); ctx.arc(d.x, d.y, 2.5, 0, 7); ctx.fill(); } }
    else if (th.pattern === "lava") { for (const d of this.deco) { const r = d.r * (1 + 0.15 * Math.sin(g.time + d.a)); const gr = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, r); gr.addColorStop(0, "#ff8a3c"); gr.addColorStop(1, "rgba(120,20,0,0)"); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 7); ctx.fill(); } }
    else if (th.pattern === "ice") { ctx.strokeStyle = th.accent; ctx.lineWidth = 1.2; for (const d of this.deco) for (let k = 0; k < 6; k++) { const a = d.a + (k * Math.PI) / 3; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + Math.cos(a) * d.r, d.y + Math.sin(a) * d.r); ctx.stroke(); } }
    else { ctx.fillStyle = th.ink; for (const d of this.deco) { ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.a + Math.sin(g.time + d.a) * 0.05); ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.4, 0, 0, 7); ctx.fill(); ctx.restore(); } }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(186, 598); ctx.font = `800 34px Urbanist, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = th.accent; ctx.globalAlpha = 0.5; ctx.fillText("NOVA", 0, 0); ctx.font = `700 10px Urbanist, system-ui, sans-serif`; ctx.fillText(th.name, 0, 24); ctx.restore();
    ctx.restore();
    ctx.strokeStyle = "#3a2a1a"; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(10, 775); ctx.lineTo(10, 200); ctx.arc(200, 200, 190, Math.PI, 0); ctx.lineTo(390, 775); ctx.stroke();
    ctx.strokeStyle = th.rail; ctx.lineWidth = 3; ctx.stroke();
  }

  private decor(ctx: CanvasRenderingContext2D, g: Game, th: WorldTheme, tb: TableDef) {
    const t = g.time;
    const plastic = (pts: [number, number][], color: string, label?: string, lx = 0, ly = 0) => { ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = color; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 0.9; ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.stroke(); if (label) { ctx.fillStyle = "#fff"; ctx.font = `800 9px Urbanist, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, lx, ly); } ctx.restore(); };
    for (const p of [...shellPlastics(th.bg1), ...tb.plastics]) plastic(p.pts, p.color, p.label, p.lx, p.ly);
    // lettres des couloirs
    ctx.font = `800 14px Urbanist, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    g.world.sensors.filter((s) => s.tag === "lane").forEach((s) => { const i = Number(s.id.slice(4)); ctx.fillStyle = (g.lamps.get(s.id) ?? 0) ? th.lamp : "rgba(255,255,255,.35)"; ctx.fillText(tb.lanes[i] ?? "", s.c.x, s.c.y - 28); ctx.fillStyle = (g.lamps.get(s.id) ?? 0) ? th.lamp : "rgba(255,255,255,.15)"; ctx.beginPath(); ctx.arc(s.c.x, s.c.y + 22, 6, 0, 7); ctx.fill(); });
    ctx.fillStyle = "rgba(255,255,255,.45)";
    for (const l of tb.labels) { ctx.font = `700 ${l.size ?? 8}px Urbanist, system-ui, sans-serif`; ctx.fillStyle = l.color ?? "rgba(255,255,255,.45)"; ctx.fillText(l.text, l.x, l.y); }
    for (const side of [-1, 1] as const) for (let i = 0; i < 6; i++) { const x = side === -1 ? 48 + i * 10 : 324 - i * 10, y = 612 + i * 13; const on = (Math.floor(t * 8) + i) % 6 === 0 || (g.player && g.ballSave > 0); ctx.fillStyle = on ? th.lamp : "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }
    for (let i = 0; i <= 20; i++) { const a = Math.PI + (i / 20) * Math.PI, x = 200 + Math.cos(a) * 178, y = 200 + Math.sin(a) * 178; const on = (Math.floor(t * 6) + i) % 5 === 0; ctx.fillStyle = on ? th.accent : "rgba(255,255,255,.1)"; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill(); }
    for (const [x0, x1] of [[10, 120], [252, 362]] as const) { const gr = ctx.createLinearGradient(0, 700, 0, 775); gr.addColorStop(0, "#232334"); gr.addColorStop(1, "#0d0d16"); ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x0, 700); ctx.lineTo(x1, 700); ctx.lineTo(x1, 775); ctx.lineTo(x0, 775); ctx.closePath(); ctx.fill(); ctx.strokeStyle = th.rail; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.fillStyle = th.accent; ctx.globalAlpha = 0.5; ctx.font = `700 9px Urbanist, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.fillText("NOVA FLIPPER · 5 MONDES", 65, 740); ctx.fillText("1 A 6 JOUEURS", 307, 740); ctx.globalAlpha = 1;
    ctx.fillStyle = "#0a0a12"; ctx.fillRect(362, 222, 28, 554); ctx.fillStyle = "rgba(255,255,255,.08)"; for (let y = 260; y < 700; y += 24) ctx.fillRect(366, y, 20, 2);
  }

  private lampOn(g: Game, id: string) { const s = g.lamps.get(id) ?? 0; return s === 1 ? 1 : s === 2 ? (Math.sin(g.time * 10) > 0 ? 1 : 0.15) : 0; }
  private lamp(ctx: CanvasRenderingContext2D, l: Lamp, on: number, th: WorldTheme) {
    const color = l.id.startsWith("lane") ? th.lamp : l.color;
    ctx.save(); ctx.translate(l.x, l.y); if (l.ang) ctx.rotate(l.ang);
    ctx.beginPath(); if (l.shape === "round") ctx.arc(0, 0, l.r, 0, 7); else if (l.shape === "arrow") { ctx.moveTo(l.r, 0); ctx.lineTo(-l.r * 0.6, -l.r * 0.8); ctx.lineTo(-l.r * 0.3, 0); ctx.lineTo(-l.r * 0.6, l.r * 0.8); ctx.closePath(); } else { ctx.moveTo(0, -l.r); ctx.lineTo(l.r, l.r); ctx.lineTo(-l.r, l.r); ctx.closePath(); }
    ctx.fillStyle = color; ctx.globalAlpha = 0.18 + on * 0.82; if (on > 0.5) { ctx.shadowColor = color; ctx.shadowBlur = 14; } ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }

  private elements(ctx: CanvasRenderingContext2D, g: Game, th: WorldTheme, tb: TableDef) {
    const w = g.world; void tb;
    for (const c of w.colliders) {
      if (c.kind === "seg" && c.layer === 0 && c.enabled) {
        if (c.tag === "drop" || c.tag === "target" || c.tag === "plungerStop" || c.gate) continue;
        const sling = c.tag === "sling" || c.id.startsWith("sling"); const hot = g.flash.has(c.id);
        ctx.lineCap = "round"; ctx.lineWidth = sling ? 6 : 5; ctx.strokeStyle = sling ? (hot ? "#fff" : "#e0506a") : "#2b2b36"; ctx.beginPath(); ctx.moveTo(c.a.x, c.a.y); ctx.lineTo(c.b.x, c.b.y); ctx.stroke();
        ctx.lineWidth = sling ? 2.5 : 2; ctx.strokeStyle = sling ? "#ff8aa0" : th.rail; ctx.beginPath(); ctx.moveTo(c.a.x, c.a.y); ctx.lineTo(c.b.x, c.b.y); ctx.stroke();
      }
    }
    for (const id of ["L", "R"]) { const a = w.byId<Segment>(`sling${id}`), b = w.byId<Segment>(`sling${id}b`); if (!a || !b) continue; ctx.fillStyle = g.flash.has(a.id) ? "#ffd0d8" : "#5a1a28"; ctx.beginPath(); ctx.moveTo(a.a.x, a.a.y); ctx.lineTo(a.b.x, a.b.y); ctx.lineTo(b.a.x, b.a.y); ctx.closePath(); ctx.fill(); }
    for (const c of w.colliders) if (c.kind === "seg" && (c.tag === "drop" || c.tag === "target")) {
      if (!c.enabled) { ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(c.a.x, c.a.y); ctx.lineTo(c.b.x, c.b.y); ctx.stroke(); continue; }
      const hot = g.flash.has(c.id); ctx.lineCap = "butt"; ctx.strokeStyle = c.tag === "drop" ? (hot ? "#fff" : "#ff5a3c") : (hot ? "#fff" : "#4ad1ff"); ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(c.a.x, c.a.y); ctx.lineTo(c.b.x, c.b.y); ctx.stroke();
      ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const c of w.colliders) if (c.kind === "disc") {
      if (c.tag === "bumper") this.bumper(ctx, c, g.flash.has(c.id), th);
      else if (c.tag === "planet") { const hot = g.flash.has(c.id); const gr = ctx.createRadialGradient(c.c.x - c.r * 0.3, c.c.y - c.r * 0.3, 1, c.c.x, c.c.y, c.r); gr.addColorStop(0, hot ? "#fff" : th.accent); gr.addColorStop(1, hot ? th.accent : "#2a1a4a"); ctx.fillStyle = gr; ctx.shadowColor = th.accent; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r, 0, 7); ctx.fill(); ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(c.c.x, c.c.y, c.r * 1.6, c.r * 0.45, -0.4, 0, 7); ctx.stroke(); }
      else if (c.tag === "volcano") { ctx.strokeStyle = "rgba(255,120,60,.5)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r, 0, 7); ctx.stroke(); }
      else if (c.tag === "peg") { ctx.fillStyle = "#dfe8f0"; ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r, 0, 7); ctx.fill(); ctx.fillStyle = th.accent; ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r * 0.45, 0, 7); ctx.fill(); }
      else { ctx.fillStyle = "#c8c8d8"; ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r, 0, 7); ctx.fill(); ctx.fillStyle = c.e > 0.8 ? "#e0506a" : "#404050"; ctx.beginPath(); ctx.arc(c.c.x, c.c.y, c.r * 0.6, 0, 7); ctx.fill(); }
    }
    for (const s of w.sensors) {
      if (s.tag === "spinner") { ctx.save(); ctx.translate(s.c.x, s.c.y); const sc = Math.cos(g.spinnerAngle); ctx.fillStyle = "#ffd24a"; ctx.strokeStyle = "#806020"; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(0, 0, 13, Math.max(1, Math.abs(sc) * 7), 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }
      if (s.tag === "saucer" || s.tag === "lock") { const { x, y } = s.c; const gr = ctx.createRadialGradient(x, y, 2, x, y, 13); gr.addColorStop(0, "#000"); gr.addColorStop(1, "#30303c"); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 13, 0, 7); ctx.fill(); ctx.strokeStyle = th.rail; ctx.lineWidth = 2; ctx.stroke(); }
      if (s.tag === "orbit" || s.tag === "liane") { ctx.strokeStyle = g.flash.has(s.id) ? "#fff" : "rgba(255,255,255,.25)"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(s.c.x, s.c.y, s.r, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    }
    for (const f of w.flippers()) this.flipper(ctx, f, th);
    const comp = g.plungerPower * 26; ctx.strokeStyle = "#999"; ctx.lineWidth = 3; ctx.beginPath(); for (let i = 0; i < 8; i++) { const y = PLUNGER.y + 12 + comp + i * 3; ctx.moveTo(368, y); ctx.lineTo(384, y + 1.5); } ctx.stroke();
    ctx.fillStyle = "#d8402c"; ctx.beginPath(); ctx.roundRect(366, PLUNGER.y + 8 + comp, 20, 8, 3); ctx.fill();
    const gl = ctx.createLinearGradient(0, 0, TW, TH); gl.addColorStop(0, "rgba(255,255,255,.06)"); gl.addColorStop(0.5, "rgba(255,255,255,0)"); gl.addColorStop(1, "rgba(255,255,255,.04)"); ctx.fillStyle = gl; ctx.fillRect(0, 0, TW, TH);
  }

  private bumper(ctx: CanvasRenderingContext2D, c: Disc, hot: boolean, th: WorldTheme) {
    const { x, y } = c.c; ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.arc(x + 3, y + 4, c.r + 5, 0, 7); ctx.fill();
    ctx.fillStyle = hot ? "#fff" : th.accent; ctx.shadowColor = th.accent; ctx.shadowBlur = hot ? 30 : 12; ctx.beginPath(); ctx.arc(x, y, c.r + 5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = "#e8e8f0"; ctx.beginPath(); ctx.arc(x, y, c.r, 0, 7); ctx.fill();
    const gr = ctx.createRadialGradient(x - 4, y - 5, 2, x, y, c.r - 2); gr.addColorStop(0, "#fff"); gr.addColorStop(1, hot ? "#ffd24a" : "#d8402c"); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, c.r - 3, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.font = `800 ${Math.round(c.r * 0.55)}px Urbanist, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("100", x, y + 1);
  }

  private flipper(ctx: CanvasRenderingContext2D, f: Flipper, th: WorldTheme) {
    const tip = flipperTip(f); ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = f.r * 2 + 4; ctx.beginPath(); ctx.moveTo(f.pivot.x + 2, f.pivot.y + 3); ctx.lineTo(tip.x + 2, tip.y + 3); ctx.stroke();
    ctx.strokeStyle = "#f0f0f4"; ctx.lineWidth = f.r * 2; ctx.beginPath(); ctx.moveTo(f.pivot.x, f.pivot.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.strokeStyle = th.accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(f.pivot.x, f.pivot.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.fillStyle = "#333"; ctx.beginPath(); ctx.arc(f.pivot.x, f.pivot.y, 3, 0, 7); ctx.fill();
  }

  private ramps(ctx: CanvasRenderingContext2D, g: Game, th: WorldTheme, tb: TableDef) {
    for (const r of tb.ramps) {
      const segs = g.world.colliders.filter((c): c is Segment => c.kind === "seg" && c.layer === 1);
      const outer = segs.filter((s) => s.id.startsWith(r.outer + ".")), inner = segs.filter((s) => s.id.startsWith(r.inner + "."));
      if (!outer.length || !inner.length) continue;
      ctx.save(); ctx.globalAlpha = 0.28; ctx.fillStyle = th.accent; ctx.beginPath(); ctx.moveTo(outer[0].a.x, outer[0].a.y); for (const s of outer) ctx.lineTo(s.b.x, s.b.y); for (let i = inner.length - 1; i >= 0; i--) ctx.lineTo(inner[i].b.x, inner[i].b.y); ctx.lineTo(inner[0].a.x, inner[0].a.y); ctx.closePath(); ctx.fill(); ctx.restore();
      for (const list of [outer, inner]) { ctx.strokeStyle = "#dfe6f0"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(list[0].a.x, list[0].a.y); for (const s of list) ctx.lineTo(s.b.x, s.b.y); ctx.stroke(); }
      ctx.fillStyle = th.accent; ctx.font = `800 8px Urbanist, system-ui, sans-serif`; ctx.textAlign = "center"; for (const l of r.labels ?? []) ctx.fillText(l.text, l.x, l.y);
    }
  }

  private balls(ctx: CanvasRenderingContext2D, g: Game, layer: number) {
    for (const b of g.world.balls) {
      if (b.layer !== layer || !b.alive) continue;
      ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = BALL_R; ctx.lineCap = "round"; ctx.beginPath(); b.trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.beginPath(); ctx.arc(b.p.x + 3, b.p.y + 4, BALL_R, 0, 7); ctx.fill();
      const gr = ctx.createRadialGradient(b.p.x - 3, b.p.y - 3, 1, b.p.x, b.p.y, BALL_R); gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.35, "#d8dce6"); gr.addColorStop(1, "#4a4e5c"); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(b.p.x, b.p.y, BALL_R, 0, 7); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.beginPath(); ctx.arc(b.p.x - 3, b.p.y - 3.5, 2, 0, 7); ctx.fill();
    }
  }

  private warp(ctx: CanvasRenderingContext2D, g: Game, th: WorldTheme) {
    const k = 1 - g.warpT / 2.2, next = WORLDS[g.warpTo];
    ctx.fillStyle = `rgba(0,0,0,${0.5 + 0.5 * Math.min(1, k * 2)})`; ctx.fillRect(0, 0, TW, TH);
    ctx.save(); ctx.translate(186, 380); ctx.rotate(g.time * 2);
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r0 = 20 + k * 80, r1 = 420 * (0.3 + k); ctx.strokeStyle = i % 2 ? th.accent : next.accent; ctx.globalAlpha = 0.6; ctx.lineWidth = 2 + (i % 3); ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a + k * 2) * r1, Math.sin(a + k * 2) * r1); ctx.stroke(); }
    ctx.restore(); ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff"; ctx.font = `800 30px Urbanist, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("PORTAIL", 186, 300); ctx.fillStyle = next.accent; ctx.font = `800 22px Urbanist, system-ui, sans-serif`; ctx.fillText(`→ ${next.name}`, 186, 340); ctx.font = `600 12px Urbanist, system-ui, sans-serif`; ctx.fillStyle = "#ccc"; ctx.fillText(`multiplicateur x${next.mult}`, 186, 366);
  }

  private wheel(ctx: CanvasRenderingContext2D, g: Game, th: WorldTheme) {
    ctx.fillStyle = "rgba(4,4,12,.78)"; ctx.fillRect(0, 0, TW, TH);
    const cx = 186, cy = 380, R = 130, n = WHEEL.length;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(g.wheelAngle);
    for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2; ctx.fillStyle = i % 2 ? th.accent : th.bg1; if (g.wheelStopped && g.wheelPrize === i && Math.floor(g.time * 6) % 2 === 0) ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath(); ctx.fill(); ctx.strokeStyle = "#000"; ctx.stroke();
      ctx.save(); ctx.rotate((a0 + a1) / 2); ctx.fillStyle = i % 2 ? "#000" : "#fff"; ctx.font = `800 13px Urbanist, system-ui, sans-serif`; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(WHEEL[i].label, R - 10, 0); ctx.restore(); }
    ctx.restore();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fill(); ctx.fillStyle = th.accent; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 7); ctx.fill();
    ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.moveTo(cx + R + 18, cy); ctx.lineTo(cx + R + 2, cy - 10); ctx.lineTo(cx + R + 2, cy + 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `800 26px Urbanist, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.fillText("ROUE NOVA", cx, 190); ctx.font = `600 13px Urbanist, system-ui, sans-serif`; ctx.fillStyle = th.accent; ctx.fillText(g.wheelStopped ? WHEEL[g.wheelPrize]?.label ?? "" : "Touche LANCER pour arrêter la roue", cx, 560);
  }
}
