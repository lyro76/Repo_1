/** Petits utilitaires de dessin partagés par tous les modules. */
export const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export function label(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, size: number, color: string, weight = 700) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${Math.round(size)}px Urbanist, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(txt, x, y);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Couleurs de contenu (encre Stroop, formes) : identiques dans les deux thèmes. */
export const INK: Record<string, string> = { rouge: "#e5484d", vert: "#2f9e5b", bleu: "#3b82f6", jaune: "#e9b949" };
