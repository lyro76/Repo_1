/**
 * Créatures procédurales qui courent vers le joueur. Chacune a sa démarche :
 * - blob : sautille (squash & stretch) ;
 * - spider : quatre pattes en IK, pas alternés ;
 * - hopper : grand bond périodique (il faut passer dessous quand il est en l'air ? non : on l'évite).
 */

import { ik2, v3, type V3 } from "../engine/math";
import type { Camera } from "../engine/project";
import { drawShadow } from "./draw";

export type CreatureKind = "blob" | "spider" | "hopper";

export interface Creature {
  kind: CreatureKind;
  pos: V3;
  t: number;
  color: string;
  color2: string;
  /** hauteur de collision (le joueur peut-il glisser dessous ? sauter par-dessus ?) */
  hitHeight: number;
  seed: number;
}

export function makeCreature(kind: CreatureKind, lane: number, z: number, seed: number): Creature {
  const palettes: Record<CreatureKind, [string, string]> = { blob: ["#8e44ad", "#5e2a7a"], spider: ["#222", "#444"], hopper: ["#e67e22", "#a04e0e"] };
  const [c1, c2] = palettes[kind];
  return { kind, pos: v3(lane, 0, z), t: seed % 10, color: c1, color2: c2, hitHeight: kind === "spider" ? 0.5 : 1.1, seed };
}

export function updateCreature(c: Creature, dt: number) {
  c.t += dt;
  if (c.kind === "blob") c.pos.y = Math.max(0, Math.sin(c.t * 7) * 0.35);
  else if (c.kind === "hopper") {
    const ph = (c.t * 1.6) % 1;
    c.pos.y = ph < 0.6 ? Math.sin((ph / 0.6) * Math.PI) * 1.4 : 0;
  } else c.pos.y = 0;
}

export function drawCreature(ctx: CanvasRenderingContext2D, cam: Camera, c: Creature) {
  const body = cam.project({ x: c.pos.x, y: c.pos.y + 0.45, z: c.pos.z });
  if (!body) return;
  const s = body.s;
  drawShadow(ctx, cam, c.pos, 0.45);
  if (c.kind === "blob") {
    const ph = Math.sin(c.t * 7);
    const sq = 1 + ph * 0.2;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(body.x, body.y, 0.42 * s * (2 - sq), 0.42 * s * sq, 0, 0, Math.PI * 2);
    ctx.fill();
    eye(ctx, body.x - 0.14 * s, body.y - 0.08 * s, 0.09 * s, c.t);
    eye(ctx, body.x + 0.14 * s, body.y - 0.08 * s, 0.09 * s, c.t);
    ctx.strokeStyle = c.color2;
    ctx.lineWidth = Math.max(1, 0.05 * s);
    ctx.beginPath();
    ctx.arc(body.x, body.y + 0.12 * s, 0.14 * s, 0.1, Math.PI - 0.1);
    ctx.stroke();
  } else if (c.kind === "spider") {
    const b = cam.project({ x: c.pos.x, y: 0.35, z: c.pos.z })!;
    ctx.strokeStyle = c.color;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, 0.05 * b.s);
    const root = v3(c.pos.x, 0.35, c.pos.z);
    for (let i = 0; i < 4; i++) {
      const side = i < 2 ? -1 : 1;
      const k = i % 2;
      const ph = c.t * 10 + i * Math.PI / 2;
      const lift = Math.max(0, Math.sin(ph)) * 0.2;
      const foot = v3(c.pos.x + side * (0.55 + k * 0.15), lift, c.pos.z + (k ? 0.25 : -0.25) + Math.cos(ph) * 0.12);
      const knee = ik2(root, foot, 0.45, 0.45, v3(side, 1.2, 0));
      const pk = cam.project(knee), pf = cam.project(foot);
      if (!pk || !pf) continue;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(pk.x, pk.y);
      ctx.lineTo(pf.x, pf.y);
      ctx.stroke();
    }
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, 0.3 * b.s, 0.22 * b.s, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 4; i++) eye(ctx, b.x - 0.12 * b.s + i * 0.08 * b.s, b.y - 0.06 * b.s - (i % 2) * 0.06 * b.s, 0.035 * b.s, c.t + i, "#f00");
  } else {
    // Hopper : corps ovale, grandes pattes repliées, oreilles.
    const inAir = c.pos.y > 0.05;
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.ellipse(body.x, body.y, 0.35 * s, (inAir ? 0.5 : 0.38) * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.color2;
    ctx.lineWidth = Math.max(1, 0.08 * s);
    ctx.lineCap = "round";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(body.x + sx * 0.12 * s, body.y - 0.4 * s);
      ctx.lineTo(body.x + sx * 0.22 * s, body.y - (inAir ? 0.95 : 0.8) * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(body.x + sx * 0.2 * s, body.y + 0.25 * s);
      ctx.lineTo(body.x + sx * 0.38 * s, body.y + (inAir ? 0.6 : 0.42) * s);
      ctx.stroke();
    }
    eye(ctx, body.x - 0.12 * s, body.y - 0.1 * s, 0.07 * s, c.t);
    eye(ctx, body.x + 0.12 * s, body.y - 0.1 * s, 0.07 * s, c.t);
  }
}

function eye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, pupil = "#111") {
  const blink = Math.sin(t * 1.3 + x) > 0.985;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  if (blink) ctx.ellipse(x, y, r, r * 0.15, 0, 0, Math.PI * 2);
  else ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (!blink) {
    ctx.fillStyle = pupil;
    ctx.beginPath();
    ctx.arc(x, y + r * 0.2, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
