import type { V3 } from "./math";

/**
 * Projection perspective de la piste : x latéral, y hauteur (vers le haut),
 * z profondeur (vers l'horizon). La caméra est derrière et au-dessus du coureur.
 */
export class Camera {
  /** position caméra */
  x = 0;
  y = 2.3;
  z = -4.6;
  /** focale en unités écran */
  f = 2.0;
  /** léger roulis lors des changements de voie */
  roll = 0;

  constructor(public sw: number, public sh: number, public horizonY: number) {}

  project(p: V3): { x: number; y: number; s: number } | null {
    const dz = p.z - this.z;
    if (dz < 0.3) return null;
    const s = (this.f * this.sw * 0.5) / dz;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    let x = dx * s, y = -dy * s;
    if (this.roll) {
      const c = Math.cos(this.roll), sn = Math.sin(this.roll);
      [x, y] = [x * c - y * sn, x * sn + y * c];
    }
    return { x: this.sw / 2 + x, y: this.horizonY + y, s };
  }
}
