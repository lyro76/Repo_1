import type { Clip, Transition } from '@/types';
import { clipEnd } from './clips';

export type TransitionState = {
  /** Opacité du clip (0..1). */
  opacity: number;
  /** Opacité d'un voile noir à dessiner par-dessus (0..1). */
  black: number;
};

function progress(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / duration));
}

function effectiveDuration(transition: Transition | undefined, clipDuration: number): number {
  if (!transition || transition.type === 'none') return 0;
  return Math.min(transition.duration, clipDuration / 2);
}

/** État visuel d'un clip à l'instant `time` selon ses transitions d'entrée et de sortie. */
export function transitionStateAt(clip: Clip, time: number): TransitionState {
  let opacity = 1;
  let black = 0;
  const inDuration = effectiveDuration(clip.transitionIn, clip.duration);
  const outDuration = effectiveDuration(clip.transitionOut, clip.duration);

  if (inDuration > 0 && time < clip.start + inDuration) {
    const p = progress(time - clip.start, inDuration);
    if (clip.transitionIn?.type === 'fade') opacity = Math.min(opacity, p);
    else if (clip.transitionIn?.type === 'fadeBlack') black = Math.max(black, 1 - p);
  }
  if (outDuration > 0 && time > clipEnd(clip) - outDuration) {
    const p = progress(clipEnd(clip) - time, outDuration);
    if (clip.transitionOut?.type === 'fade') opacity = Math.min(opacity, p);
    else if (clip.transitionOut?.type === 'fadeBlack') black = Math.max(black, 1 - p);
  }
  return { opacity, black };
}

/** Gain audio (0..1) induit par les transitions à l'instant `time`. */
export function transitionGainAt(clip: Clip, time: number): number {
  const state = transitionStateAt(clip, time);
  return state.opacity * (1 - state.black);
}

/** Durée pendant laquelle le clip suivant doit être « pré-dessiné » pour un fondu enchaîné. */
export function crossfadeWindow(clip: Clip): number {
  if (clip.transitionOut?.type !== 'fade') return 0;
  return effectiveDuration(clip.transitionOut, clip.duration);
}
