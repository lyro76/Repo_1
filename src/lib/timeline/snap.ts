import type { Project } from '@/types';
import { clipEnd } from './clips';

export type SnapOptions = {
  excludeClipIds?: string[];
  playhead?: number;
};

/** Points d'aimantation : bords des clips, tête de lecture et origine. */
export function collectSnapPoints(project: Project, options: SnapOptions = {}): number[] {
  const exclude = new Set(options.excludeClipIds ?? []);
  const points = new Set<number>([0]);
  if (options.playhead !== undefined) points.add(options.playhead);
  for (const clip of Object.values(project.clips)) {
    if (exclude.has(clip.id)) continue;
    points.add(clip.start);
    points.add(clipEnd(clip));
  }
  return [...points].sort((a, b) => a - b);
}

export type SnapResult = { time: number; snapped: boolean; point?: number };

/** Aimante `time` sur le point le plus proche si celui-ci est à moins de `threshold` secondes. */
export function snapTime(time: number, points: number[], threshold: number): SnapResult {
  let best: number | undefined;
  let bestDistance = threshold;
  for (const p of points) {
    const d = Math.abs(p - time);
    if (d <= bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best === undefined ? { time, snapped: false } : { time: best, snapped: true, point: best };
}

/**
 * Aimante un clip déplacé : on teste son bord gauche et son bord droit,
 * et on garde le meilleur candidat.
 */
export function snapClipStart(desiredStart: number, duration: number, points: number[], threshold: number): SnapResult {
  const startSnap = snapTime(desiredStart, points, threshold);
  const endSnap = snapTime(desiredStart + duration, points, threshold);
  const startDistance = startSnap.snapped ? Math.abs(startSnap.time - desiredStart) : Number.POSITIVE_INFINITY;
  const endDistance = endSnap.snapped ? Math.abs(endSnap.time - (desiredStart + duration)) : Number.POSITIVE_INFINITY;
  if (!startSnap.snapped && !endSnap.snapped) return { time: desiredStart, snapped: false };
  if (startDistance <= endDistance) return startSnap;
  return { time: endSnap.time - duration, snapped: true, point: endSnap.point };
}
