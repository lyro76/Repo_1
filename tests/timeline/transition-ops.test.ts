import { describe, expect, it } from 'vitest';
import { makeClip, makeProject } from '../helpers';
import { setJunctionTransition, setTransition } from '../../src/lib/timeline/ops';

describe('réglage des transitions', () => {
  const a = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 4 });
  const b = makeClip({ id: 'b', trackId: 'video-1', start: 4, duration: 1 });
  const project = makeProject([a, b]);

  it('borne la durée à la moitié du clip', () => {
    expect(setTransition(project, 'a', 'in', { type: 'fade', duration: 10 }).clips.a?.transitionIn).toEqual({ type: 'fade', duration: 2 });
    expect(setTransition(project, 'b', 'out', { type: 'fadeBlack', duration: 1 }).clips.b?.transitionOut).toEqual({ type: 'fadeBlack', duration: 0.5 });
    expect(setTransition(project, 'a', 'in', { type: 'fade', duration: 0 }).clips.a?.transitionIn?.duration).toBe(0.1);
  });

  it('supprime une transition', () => {
    const withFade = setTransition(project, 'a', 'out', { type: 'fade', duration: 1 });
    expect(setTransition(withFade, 'a', 'out', { type: 'none', duration: 1 }).clips.a?.transitionOut).toBeUndefined();
    expect(setTransition(project, 'a', 'out', undefined)).toBe(project);
  });

  it('applique la transition des deux côtés de la jonction', () => {
    const next = setJunctionTransition(project, 'a', { type: 'fade', duration: 0.4 });
    expect(next.clips.a?.transitionOut).toEqual({ type: 'fade', duration: 0.4 });
    expect(next.clips.b?.transitionIn).toEqual({ type: 'fade', duration: 0.4 });
  });

  it('jonction sans clip suivant collé', () => {
    const gap = makeProject([a, makeClip({ id: 'c', trackId: 'video-1', start: 6, duration: 2 })]);
    const next = setJunctionTransition(gap, 'a', { type: 'fadeBlack', duration: 1 });
    expect(next.clips.a?.transitionOut?.type).toBe('fadeBlack');
    expect(next.clips.c?.transitionIn).toBeUndefined();
  });
});
