/**
 * Entrées tactiles (et souris/clavier pour tester sur PC), traduites en gestes :
 * tap, glisser gauche/droite/haut/bas. Un glisser est reconnu dès que le
 * doigt a parcouru `threshold` unités, sans attendre qu'il se lève : c'est ce
 * qui rend un runner réactif.
 */
export type Gesture = "tap" | "left" | "right" | "up" | "down";

interface Pointer {
  id: number;
  x0: number;
  y0: number;
  t0: number;
  done: boolean;
}

export class Input {
  queue: Gesture[] = [];
  private pointers = new Map<number, Pointer>();
  /** unités logiques à parcourir pour un glisser. */
  threshold = 24;
  tapMaxMs = 250;

  constructor(private target: HTMLElement, private toUnits: (x: number, y: number) => { x: number; y: number }) {
    const opts = { passive: false } as AddEventListenerOptions;
    target.addEventListener("pointerdown", (e) => this.down(e), opts);
    target.addEventListener("pointermove", (e) => this.move(e), opts);
    target.addEventListener("pointerup", (e) => this.up(e), opts);
    target.addEventListener("pointercancel", (e) => this.cancel(e), opts);
    target.addEventListener("touchstart", (e) => e.preventDefault(), opts);
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      const map: Record<string, Gesture> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", " ": "tap", a: "left", d: "right", w: "up", s: "down", q: "left", z: "up" };
      const g = map[e.key];
      if (g) {
        this.queue.push(g);
        e.preventDefault();
      }
    });
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    this.target.setPointerCapture?.(e.pointerId);
    const p = this.toUnits(e.clientX, e.clientY);
    this.pointers.set(e.pointerId, { id: e.pointerId, x0: p.x, y0: p.y, t0: performance.now(), done: false });
  }

  private move(e: PointerEvent) {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr || ptr.done) return;
    const p = this.toUnits(e.clientX, e.clientY);
    const dx = p.x - ptr.x0, dy = p.y - ptr.y0;
    if (Math.hypot(dx, dy) < this.threshold) return;
    ptr.done = true;
    this.queue.push(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  }

  private up(e: PointerEvent) {
    const ptr = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!ptr || ptr.done) return;
    if (performance.now() - ptr.t0 <= this.tapMaxMs) this.queue.push("tap");
  }

  private cancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
  }

  /** Vide la file (à appeler une fois par pas de simulation). */
  drain(): Gesture[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}

/** Reconnaissance seule, testable sans DOM. */
export function recognize(x0: number, y0: number, x1: number, y1: number, ms: number, threshold = 24, tapMaxMs = 250): Gesture | null {
  const dx = x1 - x0, dy = y1 - y0;
  if (Math.hypot(dx, dy) >= threshold) return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  return ms <= tapMaxMs ? "tap" : null;
}
