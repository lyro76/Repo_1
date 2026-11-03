export interface V { x: number; y: number }
export const v = (x: number, y: number): V => ({ x, y });
export const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
export const dot = (a: V, b: V) => a.x * b.x + a.y * b.y;
export const len = (a: V) => Math.hypot(a.x, a.y);
export const norm = (a: V): V => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const perp = (a: V): V => ({ x: -a.y, y: a.x });
export const rot = (a: V, ang: number): V => { const c = Math.cos(ang), s = Math.sin(ang); return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }; };
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
