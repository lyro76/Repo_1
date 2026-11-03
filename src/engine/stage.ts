/**
 * Scène canvas : gère la taille (dpr), la boucle et les pointeurs (multi-touch).
 * Un module reçoit un `Env` et des événements de pointeur normalisés en pixels CSS.
 */
export interface Pointer { id: number; x: number; y: number; sx: number; sy: number; down: boolean }
export interface Env {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** premier pointeur actif (ou dernier connu) : suffit pour la plupart des modules */
  pointer: Pointer;
  /** tous les pointeurs actifs (Deux mains) */
  pointers: Map<number, Pointer>;
}

export interface StageHandlers {
  frame(dt: number, now: number): void;
  down?(p: Pointer): void;
  drag?(p: Pointer): void;
  up?(p: Pointer): void;
}

export class Stage {
  readonly ctx: CanvasRenderingContext2D;
  readonly env: Env;
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver | null = null;
  handlers: StageHandlers | null = null;
  private cleanup: (() => void)[] = [];

  constructor(readonly canvas: HTMLCanvasElement, readonly box: HTMLElement) {
    this.ctx = canvas.getContext("2d")!;
    const pointer: Pointer = { id: -1, x: 0, y: 0, sx: 0, sy: 0, down: false };
    this.env = { ctx: this.ctx, W: 0, H: 0, pointer, pointers: new Map() };
    this.resize();
    if (typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(box); }
    const pos = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const on = <K extends keyof HTMLElementEventMap>(k: K, f: (e: HTMLElementEventMap[K]) => void) => { canvas.addEventListener(k, f); this.cleanup.push(() => canvas.removeEventListener(k, f)); };
    on("pointerdown", (e) => {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const { x, y } = pos(e);
      const p: Pointer = { id: e.pointerId, x, y, sx: x, sy: y, down: true };
      this.env.pointers.set(e.pointerId, p);
      Object.assign(pointer, p);
      this.handlers?.down?.(p);
    });
    on("pointermove", (e) => {
      const p = this.env.pointers.get(e.pointerId);
      const { x, y } = pos(e);
      if (!p) { if (!pointer.down) { pointer.x = x; pointer.y = y; } return; }
      p.x = x; p.y = y;
      if (pointer.id === p.id) { pointer.x = x; pointer.y = y; }
      this.handlers?.drag?.(p);
    });
    const end = (e: PointerEvent) => {
      const p = this.env.pointers.get(e.pointerId);
      if (!p) return;
      const { x, y } = pos(e); p.x = x; p.y = y; p.down = false;
      this.env.pointers.delete(e.pointerId);
      if (pointer.id === p.id) { pointer.x = x; pointer.y = y; pointer.down = false; }
      this.handlers?.up?.(p);
    };
    on("pointerup", end); on("pointercancel", end);
  }

  resize() {
    const r = this.box.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.env.W = Math.max(1, r.width); this.env.H = Math.max(1, r.height);
    this.canvas.width = Math.round(this.env.W * dpr); this.canvas.height = Math.round(this.env.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  start() {
    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      this.ctx.clearRect(0, 0, this.env.W, this.env.H);
      try { this.handlers?.frame(dt, now / 1000); } catch (e) { console.error(e); }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    for (const c of this.cleanup) c();
  }
}
