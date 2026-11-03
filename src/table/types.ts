import type { World } from "../physics/world";

export interface Lamp { id: string; x: number; y: number; r: number; shape: "round" | "arrow" | "tri"; color: string; ang?: number }
export interface Plastic { pts: [number, number][]; color: string; label?: string; lx?: number; ly?: number }
export interface Label { text: string; x: number; y: number; size?: number; color?: string }
export interface RampDef { outer: string; inner: string; labels?: Label[] }

export interface TableDef {
  id: string;
  name: string;
  /** lettres des couloirs du haut, dans l'ordre des capteurs lane0..laneN */
  lanes: string[];
  build(w: World): void;
  lamps: Lamp[];
  plastics: Plastic[];
  labels: Label[];
  ramps: RampDef[];
  /** où la bille réapparaît en arrivant dans ce monde */
  eject: { x: number; y: number; vx: number; vy: number };
  /** trou noir : attire la bille dans son rayon */
  attractor?: { x: number; y: number; r: number; force: number };
  /** peinture spécifique du plateau */
  art?(ctx: CanvasRenderingContext2D, t: number, accent: string): void;
}
