/** Décor : ciel, piste en perspective, bandes qui défilent, obstacles, pièces. */

import { Camera } from "../engine/project";
import { drawCharacter } from "../char/draw";
import { drawCreature } from "../char/creatures";
import { LANE_X, type Coin, type Obstacle, type World } from "./world";
import type { Player } from "./player";
import { obstacleBox } from "./collision";

export interface Theme {
  skyTop: string;
  skyBottom: string;
  far: string;
  road: string;
  roadLine: string;
  side: string;
  coin: string;
}

export const THEMES: Theme[] = [
  { skyTop: "#0b1026", skyBottom: "#3b2a6b", far: "#1f1a3d", road: "#2a2f4a", roadLine: "#4a5588", side: "#1a1f36", coin: "#ffd54f" },
  { skyTop: "#ff7e5f", skyBottom: "#feb47b", far: "#8a3b5c", road: "#3c2f4a", roadLine: "#6c5d85", side: "#2a2235", coin: "#fff176" },
  { skyTop: "#0f2027", skyBottom: "#2c5364", far: "#1c3a44", road: "#23353d", roadLine: "#3e6b7a", side: "#15262c", coin: "#80deea" },
];

export class Renderer {
  cam: Camera;
  stripe = 0;

  constructor(public ctx: CanvasRenderingContext2D, public w: number, public h: number) {
    this.cam = new Camera(w, h, h * 0.36);
  }

  resize(w: number, h: number) {
    this.w = w; this.h = h;
    this.cam.sw = w; this.cam.sh = h; this.cam.horizonY = h * 0.36;
  }

  draw(world: World, player: Player, theme: Theme, time: number, shake: number) {
    const { ctx, cam } = this;
    // Caméra qui suit un peu le joueur latéralement.
    cam.x += (player.x * 0.55 - cam.x) * 0.1;
    cam.roll = -player.ch.lean * 0.25;
    const sx = (Math.random() - 0.5) * shake * 6, sy = (Math.random() - 0.5) * shake * 6;
    ctx.save();
    ctx.translate(sx, sy);

    // Ciel.
    const sky = ctx.createLinearGradient(0, 0, 0, cam.horizonY);
    sky.addColorStop(0, theme.skyTop);
    sky.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(-10, -10, this.w + 20, cam.horizonY + 10);
    // Silhouettes lointaines.
    ctx.fillStyle = theme.far;
    for (let i = 0; i < 12; i++) {
      const bx = ((i * 97 + world.distance * 0.3) % (this.w + 80)) - 40;
      const bh = 20 + ((i * 37) % 50);
      ctx.fillRect(this.w - bx, cam.horizonY - bh, 26, bh);
    }
    // Sol.
    ctx.fillStyle = theme.side;
    ctx.fillRect(-10, cam.horizonY, this.w + 20, this.h - cam.horizonY + 10);
    // Piste : trapèze.
    const near = 0.5, farZ = 60;
    const halfW = 2.7;
    const a = cam.project({ x: -halfW, y: 0, z: near })!, b = cam.project({ x: halfW, y: 0, z: near })!;
    const c = cam.project({ x: halfW, y: 0, z: farZ })!, d = cam.project({ x: -halfW, y: 0, z: farZ })!;
    ctx.fillStyle = theme.road;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
    // Lignes de voie et bandes qui défilent.
    ctx.strokeStyle = theme.roadLine;
    for (const lx of [-0.8, 0.8]) {
      const p0 = cam.project({ x: lx, y: 0, z: near })!, p1 = cam.project({ x: lx, y: 0, z: farZ })!;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    const period = 4;
    const off = world.distance % period;
    ctx.fillStyle = theme.roadLine;
    for (let z = -off; z < farZ; z += period) {
      const z0 = Math.max(near, z), z1 = z + 1.2;
      if (z1 <= near) continue;
      const q0 = cam.project({ x: -halfW, y: 0.001, z: z0 }), q1 = cam.project({ x: -halfW + 0.25, y: 0.001, z: z0 });
      const q2 = cam.project({ x: -halfW + 0.25, y: 0.001, z: z1 }), q3 = cam.project({ x: -halfW, y: 0.001, z: z1 });
      if (!q0 || !q1 || !q2 || !q3) continue;
      ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.lineTo(q3.x, q3.y); ctx.fill();
      const r0 = cam.project({ x: halfW, y: 0.001, z: z0 }), r1 = cam.project({ x: halfW - 0.25, y: 0.001, z: z0 });
      const r2 = cam.project({ x: halfW - 0.25, y: 0.001, z: z1 }), r3 = cam.project({ x: halfW, y: 0.001, z: z1 });
      if (!r0 || !r1 || !r2 || !r3) continue;
      ctx.beginPath(); ctx.moveTo(r0.x, r0.y); ctx.lineTo(r1.x, r1.y); ctx.lineTo(r2.x, r2.y); ctx.lineTo(r3.x, r3.y); ctx.fill();
    }

    // Objets triés du plus loin au plus proche.
    type Item = { z: number; draw: () => void };
    const items: Item[] = [];
    for (const o of world.obstacles) items.push({ z: o.z + o.length, draw: () => this.drawObstacle(o, theme) });
    for (const cn of world.coins) items.push({ z: cn.z, draw: () => this.drawCoin(cn, theme, time) });
    for (const cr of world.creatures) items.push({ z: cr.pos.z, draw: () => drawCreature(ctx, cam, cr) });
    items.push({ z: player.z, draw: () => drawCharacter(ctx, cam, player.ch, time) });
    items.sort((p, q) => q.z - p.z);
    for (const it of items) it.draw();
    ctx.restore();
  }

  drawObstacle(o: Obstacle, theme: Theme) {
    const { ctx, cam } = this;
    const b = obstacleBox(o);
    const w = 0.55;
    const corners = (y: number, z: number) => [cam.project({ x: b.x - w, y, z }), cam.project({ x: b.x + w, y, z })];
    const [fl, fr] = corners(b.yMin, b.zMin), [bl, br] = corners(b.yMin, b.zMax);
    const [tl, tr] = corners(b.yMax, b.zMin), [tbl, tbr] = corners(b.yMax, b.zMax);
    if (!fl || !fr || !bl || !br || !tl || !tr || !tbl || !tbr) return;
    const col = o.kind === "low" ? "#e74c3c" : o.kind === "high" ? "#f1c40f" : "#95a5a6";
    const dark = o.kind === "low" ? "#922b21" : o.kind === "high" ? "#9a7d0a" : "#5d6d7e";
    if (o.kind === "high") {
      // Portique : deux montants + barre haute.
      ctx.strokeStyle = dark;
      ctx.lineWidth = Math.max(2, 0.08 * fl.s);
      const gl = cam.project({ x: b.x - w, y: 0, z: b.zMin })!, gr = cam.project({ x: b.x + w, y: 0, z: b.zMin })!;
      ctx.beginPath(); ctx.moveTo(gl.x, gl.y); ctx.lineTo(tl.x, tl.y); ctx.moveTo(gr.x, gr.y); ctx.lineTo(tr.x, tr.y); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y); ctx.closePath(); ctx.fill();
      return;
    }
    // Dessus (plus clair), puis face avant.
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tbr.x, tbr.y); ctx.lineTo(tbl.x, tbl.y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fr.x, fr.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(tl.x, tl.y); ctx.closePath(); ctx.fill();
    if (o.kind === "low") {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(1, 0.03 * fl.s);
      ctx.beginPath(); ctx.moveTo(fl.x, (fl.y + tl.y) / 2); ctx.lineTo(fr.x, (fr.y + tr.y) / 2); ctx.stroke();
    }
    void theme;
  }

  drawCoin(c: Coin, theme: Theme, time: number) {
    const p = this.cam.project({ x: LANE_X[c.lane], y: c.y + Math.sin(time * 4 + c.z) * 0.05, z: c.z });
    if (!p) return;
    const r = 0.22 * p.s;
    const squash = Math.abs(Math.cos(time * 5 + c.z * 0.7));
    this.ctx.fillStyle = theme.coin;
    this.ctx.beginPath();
    this.ctx.ellipse(p.x, p.y, Math.max(0.5, r * squash), r, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.strokeStyle = "rgba(0,0,0,0.25)";
    this.ctx.lineWidth = Math.max(0.5, r * 0.15);
    this.ctx.stroke();
  }
}
