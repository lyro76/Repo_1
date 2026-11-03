/**
 * Le canvas plein écran, en unités logiques : 360 de large, hauteur selon
 * l'écran. 1 unité ≈ 1/360 de la largeur. `mm(x)` convertit des millimètres
 * réels en unités, pour garantir des cibles tactiles assez grandes.
 */
export class Screen {
  ctx: CanvasRenderingContext2D;
  w = 360;
  h = 640;
  dpr = 1;
  /** unités logiques par millimètre réel (estimation à partir de la densité). */
  unitsPerMm = 2.5;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    const cw = window.innerWidth, ch = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(cw * this.dpr);
    this.canvas.height = Math.round(ch * this.dpr);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.w = 360;
    this.h = Math.round((360 * ch) / cw);
    // CSS px ≈ 96 dpi → 1 mm ≈ 3,78 px CSS ; en unités : 360 / cw par px.
    this.unitsPerMm = (3.78 * 360) / cw;
  }

  /** Applique l'échelle logique → pixels. */
  begin() {
    const s = (this.canvas.width / this.w);
    this.ctx.setTransform(s, 0, 0, s, 0, 0);
  }

  mm(x: number) {
    return x * this.unitsPerMm;
  }

  /** Coordonnées d'un événement en unités logiques. */
  toUnits(clientX: number, clientY: number) {
    return { x: (clientX / window.innerWidth) * this.w, y: (clientY / window.innerHeight) * this.h };
  }
}
