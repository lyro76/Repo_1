/** Dessin d'un personnage : capsules épaisses entre articulations projetées, ombre, visage, cape. */

import type { Camera } from "../engine/project";
import type { V3 } from "../engine/math";
import type { Character } from "./skeleton";

type P2 = { x: number; y: number; s: number };

function capsule(ctx: CanvasRenderingContext2D, a: P2, b: P2, w: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, w);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function disc(ctx: CanvasRenderingContext2D, p: P2, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(p.x, p.y, Math.max(0.5, r), 0, Math.PI * 2);
  ctx.fill();
}

export function drawShadow(ctx: CanvasRenderingContext2D, cam: Camera, pos: V3, radius: number, alpha = 0.35) {
  const g = cam.project({ x: pos.x, y: 0, z: pos.z });
  if (!g) return;
  const h = Math.max(0, pos.y);
  ctx.fillStyle = `rgba(0,0,0,${alpha / (1 + h * 1.5)})`;
  ctx.beginPath();
  ctx.ellipse(g.x, g.y, radius * g.s / (1 + h * 0.6), radius * g.s * 0.35 / (1 + h * 0.6), 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawCharacter(ctx: CanvasRenderingContext2D, cam: Camera, ch: Character, time: number) {
  const j = ch.worldJoints();
  const P: Record<string, P2 | null> = {};
  for (const k in j) {
    P[k] = cam.project(j[k]);
    // Une articulation derrière la caméra (ragdoll projeté vers nous) : on ne dessine pas.
    if (!P[k]) return;
  }
  const s = P.hip!.s;
  const c = ch.costume;
  const thick = 0.11 * c.bulk * s;
  const g = (k: string) => P[k]!;
  drawShadow(ctx, cam, ch.pos, 0.45 * c.bulk, ch.ragdoll ? 0.15 : 0.35);

  // Cape derrière le corps.
  if (ch.cape) {
    const pts = ch.cape.pts.map((p) => cam.project(p)).filter((p): p is P2 => !!p);
    if (pts.length > 2) {
      ctx.fillStyle = c.cape!;
      ctx.beginPath();
      const w0 = 0.22 * s;
      ctx.moveTo(pts[0].x - w0, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x - w0 * (1 + i * 0.15), pts[i].y);
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].x + w0 * (1 + i * 0.15), pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Jambe arrière d'abord (celle qui a le plus grand z est devant).
  const legs: ["l" | "r", number][] = [["l", j.lFoot.z], ["r", j.rFoot.z]];
  legs.sort((a, b) => a[1] - b[1]);
  for (const [side] of legs) {
    capsule(ctx, g("hip"), g(`${side}Knee`), thick * 1.1, c.cloth2);
    capsule(ctx, g(`${side}Knee`), g(`${side}Foot`), thick, c.cloth2);
    disc(ctx, g(`${side}Foot`), thick * 0.75, "#222");
  }
  // Bras arrière.
  const arms: ["l" | "r", number][] = [["l", j.lHand.z], ["r", j.rHand.z]];
  arms.sort((a, b) => a[1] - b[1]);
  const drawArm = (side: "l" | "r") => {
    capsule(ctx, g(`${side}Shoulder`), g(`${side}Elbow`), thick * 0.9, c.cloth);
    capsule(ctx, g(`${side}Elbow`), g(`${side}Hand`), thick * 0.8, c.skin);
    disc(ctx, g(`${side}Hand`), thick * 0.55, c.skin);
  };
  drawArm(arms[0][0]);
  // Torse.
  capsule(ctx, g("hip"), g("chest"), thick * 2.2, c.cloth);
  capsule(ctx, g("lShoulder"), g("rShoulder"), thick * 1.6, c.cloth);
  capsule(ctx, g("chest"), g("neck"), thick * 0.9, c.skin);
  // Tête.
  const hr = 0.2 * c.headSize * s;
  disc(ctx, g("head"), hr, c.skin);
  // Cheveux : calotte.
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.arc(g("head").x, g("head").y - hr * 0.1, hr * 1.02, Math.PI * 1.05, Math.PI * 1.95);
  ctx.fill();
  // Yeux (de dos on voit les joues qui dépassent : on triche en les mettant sur les côtés).
  const blink = ch.blink > 0;
  const eyeY = g("head").y - hr * 0.05;
  for (const sx of [-1, 1]) {
    const ex = g("head").x + sx * hr * 0.55;
    if (blink) capsule(ctx, { x: ex - hr * 0.12, y: eyeY, s }, { x: ex + hr * 0.12, y: eyeY, s }, hr * 0.08, c.eyes);
    else disc(ctx, { x: ex, y: eyeY, s }, hr * 0.14, c.eyes);
  }
  // Chapeau.
  const hp = g("head");
  if (c.hat === "cap") {
    ctx.fillStyle = c.cloth2;
    ctx.fillRect(hp.x - hr * 1.1, hp.y - hr * 0.9, hr * 2.2, hr * 0.35);
  } else if (c.hat === "horns") {
    ctx.fillStyle = "#7a3a0a";
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hp.x + sx * hr * 0.6, hp.y - hr * 0.7);
      ctx.lineTo(hp.x + sx * hr * 1.1, hp.y - hr * 1.5);
      ctx.lineTo(hp.x + sx * hr * 0.25, hp.y - hr * 0.95);
      ctx.fill();
    }
  } else if (c.hat === "crown") {
    ctx.fillStyle = "#ffd700";
    ctx.beginPath();
    ctx.moveTo(hp.x - hr * 0.8, hp.y - hr * 0.7);
    for (let i = 0; i < 4; i++) {
      ctx.lineTo(hp.x - hr * 0.8 + hr * 0.4 * i + hr * 0.2, hp.y - hr * 1.35);
      ctx.lineTo(hp.x - hr * 0.8 + hr * 0.4 * (i + 1), hp.y - hr * 0.7);
    }
    ctx.lineTo(hp.x - hr * 0.8, hp.y - hr * 0.4);
    ctx.lineTo(hp.x + hr * 0.8, hp.y - hr * 0.4);
    ctx.fill();
  } else if (c.hat === "halo") {
    ctx.strokeStyle = "#fff59d";
    ctx.lineWidth = Math.max(1, hr * 0.12);
    ctx.beginPath();
    ctx.ellipse(hp.x, hp.y - hr * 1.3 + Math.sin(time * 3) * hr * 0.05, hr * 0.9, hr * 0.25, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Bras avant.
  drawArm(arms[1][0]);
}
