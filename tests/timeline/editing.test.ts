import { describe, expect, it } from 'vitest';
import { makeClip, makeProject } from '../helpers';
import { clipsUsingMedia, pickSplitTargets, setClipDuration, setClipSpeed, splitClipsAt } from '../../src/lib/timeline/ops';

describe('vitesse', () => {
  it('accélérer raccourcit le clip, ralentir l’allonge', () => {
    const clip = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 4, speed: 1 });
    const project = makeProject([clip]);
    expect(setClipSpeed(project, 'a', 2, 10).clips.a).toMatchObject({ speed: 2, duration: 2 });
    expect(setClipSpeed(project, 'a', 0.5, 10).clips.a).toMatchObject({ speed: 0.5, duration: 8 });
  });

  it('est bornée par le clip suivant et par le média', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 4 });
    const b = makeClip({ id: 'b', trackId: 'video-1', start: 5, duration: 2 });
    const project = makeProject([a, b]);
    expect(setClipSpeed(project, 'a', 0.5, 10).clips.a?.duration).toBe(5);
    const alone = makeProject([makeClip({ id: 'c', trackId: 'video-1', start: 0, inPoint: 1, duration: 4 })]);
    expect(setClipSpeed(alone, 'c', 0.5, 4).clips.c?.duration).toBe(6);
  });

  it('ignore une vitesse identique ou invalide', () => {
    const project = makeProject([makeClip({ id: 'a', trackId: 'video-1' })]);
    expect(setClipSpeed(project, 'a', 1)).toBe(project);
    expect(setClipSpeed(project, 'a', 0)).toBe(project);
  });
});

describe('durée', () => {
  it('fixe la durée via le bord de fin', () => {
    const project = makeProject([makeClip({ id: 't', trackId: 'text-1', type: 'text', start: 2, duration: 3 })]);
    expect(setClipDuration(project, 't', 7).clips.t?.duration).toBe(7);
    expect(setClipDuration(project, 't', 0).clips.t?.duration).toBeCloseTo(0.1);
  });
});

describe('coupe', () => {
  const a = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 4 });
  const m = makeClip({ id: 'm', trackId: 'audio-1', type: 'audio', start: 0, duration: 10 });
  const project = makeProject([a, m]);

  it('coupe le clip sélectionné seulement', () => {
    expect(pickSplitTargets(project, 2, 'm')).toEqual(['m']);
    expect(pickSplitTargets(project, 6, 'a')).toEqual([]);
  });

  it('sans sélection, coupe tout ce qui est sous la tête de lecture', () => {
    expect(pickSplitTargets(project, 2, null).sort()).toEqual(['a', 'm']);
    expect(pickSplitTargets(project, 6, null)).toEqual(['m']);
  });

  it('coupe plusieurs clips', () => {
    let n = 0;
    const { project: next, created } = splitClipsAt(project, ['a', 'm'], 2, () => `new-${++n}`);
    expect(created).toEqual(['new-1', 'new-2']);
    expect(Object.keys(next.clips)).toHaveLength(4);
    expect(next.clips['new-2']).toMatchObject({ start: 2, duration: 8, trackId: 'audio-1' });
  });

  it('liste les clips d’un média', () => {
    const withMedia = makeProject([makeClip({ id: 'x', trackId: 'video-1', mediaId: 'med' }), makeClip({ id: 'y', trackId: 'video-1', start: 6 })]);
    expect(clipsUsingMedia(withMedia, 'med')).toEqual(['x']);
  });
});
