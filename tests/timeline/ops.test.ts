import { describe, expect, it } from 'vitest';
import { makeClip, makeProject } from '../helpers';
import {
  addTrack,
  appendClip,
  deleteClips,
  duplicateClip,
  insertClip,
  moveClip,
  nearestFreeStart,
  removeTrack,
  splitClipAt,
  trimClip,
  updateClip,
} from '../../src/lib/timeline/ops';
import { trackClips } from '../../src/lib/timeline/clips';

describe('split', () => {
  it('coupe un clip en deux en conservant la continuité du média', () => {
    const clip = makeClip({ id: 'a', trackId: 'video-1', start: 2, inPoint: 1, duration: 6, speed: 1 });
    const project = makeProject([clip]);
    const next = splitClipAt(project, 'a', 5, 'b');
    expect(next.clips.a).toMatchObject({ start: 2, inPoint: 1, duration: 3 });
    expect(next.clips.b).toMatchObject({ start: 5, inPoint: 4, duration: 3, trackId: 'video-1' });
    expect(trackClips(next, 'video-1').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('tient compte de la vitesse pour le point d’entrée', () => {
    const clip = makeClip({ id: 'a', trackId: 'video-1', start: 0, inPoint: 0, duration: 4, speed: 2 });
    const next = splitClipAt(makeProject([clip]), 'a', 1, 'b');
    expect(next.clips.b?.inPoint).toBe(2);
  });

  it('ne coupe pas hors du clip ou trop près des bords', () => {
    const clip = makeClip({ id: 'a', trackId: 'video-1', start: 2, duration: 6 });
    const project = makeProject([clip]);
    expect(splitClipAt(project, 'a', 1, 'b')).toBe(project);
    expect(splitClipAt(project, 'a', 8, 'b')).toBe(project);
    expect(splitClipAt(project, 'a', 2.05, 'b')).toBe(project);
    expect(splitClipAt(project, 'zz', 4, 'b')).toBe(project);
  });

  it('répartit les transitions entre les deux moitiés', () => {
    const clip = makeClip({
      id: 'a',
      trackId: 'video-1',
      duration: 6,
      transitionIn: { type: 'fade', duration: 1 },
      transitionOut: { type: 'fadeBlack', duration: 1 },
    });
    const next = splitClipAt(makeProject([clip]), 'a', 3, 'b');
    expect(next.clips.a?.transitionIn?.type).toBe('fade');
    expect(next.clips.a?.transitionOut).toBeUndefined();
    expect(next.clips.b?.transitionIn).toBeUndefined();
    expect(next.clips.b?.transitionOut?.type).toBe('fadeBlack');
  });
});

describe('trim', () => {
  const clip = makeClip({ id: 'a', trackId: 'video-1', start: 4, inPoint: 2, duration: 6 });

  it('rogne le début en décalant le point d’entrée', () => {
    const next = trimClip(makeProject([clip]), 'a', 'start', 6, 20);
    expect(next.clips.a).toMatchObject({ start: 6, inPoint: 4, duration: 4 });
  });

  it('ne peut pas remonter avant le début du média', () => {
    const next = trimClip(makeProject([clip]), 'a', 'start', 0, 20);
    expect(next.clips.a).toMatchObject({ start: 2, inPoint: 0, duration: 8 });
  });

  it('rogne la fin dans la limite du média', () => {
    const project = makeProject([clip]);
    expect(trimClip(project, 'a', 'end', 7, 20).clips.a?.duration).toBe(3);
    expect(trimClip(project, 'a', 'end', 30, 10).clips.a?.duration).toBe(8);
    expect(trimClip(project, 'a', 'end', 30).clips.a?.duration).toBe(26);
  });

  it('respecte la durée minimale et les voisins', () => {
    const prev = makeClip({ id: 'p', trackId: 'video-1', start: 0, duration: 3 });
    const nextClip = makeClip({ id: 'n', trackId: 'video-1', start: 12, duration: 2 });
    const project = makeProject([prev, clip, nextClip]);
    expect(trimClip(project, 'a', 'start', 1, 20).clips.a?.start).toBe(3);
    expect(trimClip(project, 'a', 'end', 15, 50).clips.a?.duration).toBe(8);
    expect(trimClip(project, 'a', 'end', 4.01, 50).clips.a?.duration).toBeCloseTo(0.1);
    expect(trimClip(project, 'a', 'start', 9.99, 50).clips.a?.duration).toBeCloseTo(0.1);
  });

  it('un clip texte se rogne sans contrainte de média', () => {
    const text = makeClip({ id: 't', trackId: 'text-1', type: 'text', start: 1, duration: 3 });
    const next = trimClip(makeProject([text]), 't', 'start', 0);
    expect(next.clips.t).toMatchObject({ start: 0, inPoint: 0, duration: 4 });
  });
});

describe('déplacement', () => {
  it('trouve la place libre la plus proche', () => {
    const others = [makeClip({ trackId: 'video-1', start: 0, duration: 4 }), makeClip({ trackId: 'video-1', start: 6, duration: 4 })];
    expect(nearestFreeStart(others, 2, 4.5)).toBe(4);
    expect(nearestFreeStart(others, 2, 9)).toBe(10);
    expect(nearestFreeStart(others, 3, 4)).toBe(10);
    expect(nearestFreeStart([], 3, -5)).toBe(0);
  });

  it('déplace un clip sans chevauchement', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 4 });
    const b = makeClip({ id: 'b', trackId: 'video-1', start: 10, duration: 4 });
    const project = makeProject([a, b]);
    const next = moveClip(project, 'b', 2);
    expect(next.clips.b?.start).toBe(4);
    expect(trackClips(next, 'video-1').map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('change de piste si elle est compatible', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 4 });
    let project = makeProject([a]);
    project = addTrack(project, 'video', 'video-2', 'Vidéo 2');
    const moved = moveClip(project, 'a', 3, 'video-2');
    expect(moved.clips.a).toMatchObject({ trackId: 'video-2', start: 3 });
    expect(trackClips(moved, 'video-1')).toHaveLength(0);
    expect(trackClips(moved, 'video-2').map((c) => c.id)).toEqual(['a']);
    expect(moveClip(project, 'a', 3, 'audio-1')).toBe(project);
  });

  it('ne change rien si la position est identique', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1', start: 2, duration: 4 });
    const project = makeProject([a]);
    expect(moveClip(project, 'a', 2)).toBe(project);
  });
});

describe('suppression, duplication, insertion', () => {
  it('supprime des clips et nettoie les pistes', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1' });
    const b = makeClip({ id: 'b', trackId: 'video-1', start: 5 });
    const next = deleteClips(makeProject([a, b]), ['a', 'zz']);
    expect(Object.keys(next.clips)).toEqual(['b']);
    expect(next.tracks.find((t) => t.id === 'video-1')?.clipIds).toEqual(['b']);
  });

  it('duplique juste après l’original', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1', start: 1, duration: 3, props: { x: 1 } });
    const next = duplicateClip(makeProject([a]), 'a', 'a2');
    expect(next.clips.a2).toMatchObject({ start: 4, duration: 3, trackId: 'video-1' });
    expect(next.clips.a2?.props).not.toBe(a.props);
  });

  it('ajoute à la fin de la piste', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 3 });
    const project = makeProject([a]);
    const b = makeClip({ id: 'b', trackId: 'video-1', duration: 2 });
    const next = appendClip(project, b);
    expect(next.clips.b?.start).toBe(3);
    const c = makeClip({ id: 'c', trackId: 'video-1', duration: 2 });
    expect(insertClip(next, c, 1).clips.c?.start).toBe(5);
  });

  it('refuse un clip sur une piste incompatible', () => {
    const project = makeProject();
    const clip = makeClip({ id: 'x', trackId: 'audio-1', type: 'video' });
    expect(insertClip(project, clip, 0)).toBe(project);
  });

  it('met à jour un clip', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1' });
    const next = updateClip(makeProject([a]), 'a', { volume: 0.5, speed: 2 });
    expect(next.clips.a).toMatchObject({ volume: 0.5, speed: 2 });
  });
});

describe('pistes', () => {
  it('ajoute une piste après celles du même type', () => {
    const project = addTrack(makeProject(), 'video', 'video-2', 'Vidéo 2');
    expect(project.tracks.map((t) => t.id)).toEqual(['text-1', 'video-1', 'video-2', 'audio-1']);
  });

  it('supprime une piste et ses clips mais garde la dernière de chaque type', () => {
    const a = makeClip({ id: 'a', trackId: 'video-1' });
    let project = makeProject([a]);
    expect(removeTrack(project, 'video-1')).toBe(project);
    project = addTrack(project, 'video', 'video-2', 'Vidéo 2');
    const next = removeTrack(project, 'video-1');
    expect(next.tracks.map((t) => t.id)).toEqual(['text-1', 'video-2', 'audio-1']);
    expect(next.clips.a).toBeUndefined();
  });
});
