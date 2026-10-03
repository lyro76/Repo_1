import { describe, expect, it } from 'vitest';
import { makeClip } from '../helpers';
import { crossfadeWindow, transitionGainAt, transitionStateAt } from '../../src/lib/timeline/transitions';

describe('transitions', () => {
  it('fondu en entrée et en sortie', () => {
    const clip = makeClip({
      trackId: 'video-1',
      start: 2,
      duration: 10,
      transitionIn: { type: 'fade', duration: 2 },
      transitionOut: { type: 'fade', duration: 2 },
    });
    expect(transitionStateAt(clip, 2).opacity).toBe(0);
    expect(transitionStateAt(clip, 3).opacity).toBe(0.5);
    expect(transitionStateAt(clip, 6).opacity).toBe(1);
    expect(transitionStateAt(clip, 11).opacity).toBe(0.5);
    expect(transitionGainAt(clip, 11)).toBe(0.5);
    expect(crossfadeWindow(clip)).toBe(2);
  });

  it('fondu au noir', () => {
    const clip = makeClip({ trackId: 'video-1', start: 0, duration: 4, transitionOut: { type: 'fadeBlack', duration: 1 } });
    expect(transitionStateAt(clip, 3)).toEqual({ opacity: 1, black: 0 });
    expect(transitionStateAt(clip, 3.5).black).toBe(0.5);
    expect(crossfadeWindow(clip)).toBe(0);
  });

  it('limite la durée à la moitié du clip', () => {
    const clip = makeClip({ trackId: 'video-1', start: 0, duration: 2, transitionIn: { type: 'fade', duration: 5 } });
    expect(transitionStateAt(clip, 1).opacity).toBe(1);
    expect(transitionStateAt(clip, 0.5).opacity).toBe(0.5);
  });

  it('aucune transition', () => {
    const clip = makeClip({ trackId: 'video-1', transitionIn: { type: 'none', duration: 1 } });
    expect(transitionStateAt(clip, 0)).toEqual({ opacity: 1, black: 0 });
  });
});
