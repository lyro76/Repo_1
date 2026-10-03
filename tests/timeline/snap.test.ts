import { describe, expect, it } from 'vitest';
import { makeClip, makeProject } from '../helpers';
import { collectSnapPoints, snapClipStart, snapTime } from '../../src/lib/timeline/snap';

describe('aimantation', () => {
  const a = makeClip({ id: 'a', trackId: 'video-1', start: 0, duration: 4 });
  const b = makeClip({ id: 'b', trackId: 'video-1', start: 6, duration: 2 });
  const project = makeProject([a, b]);

  it('collecte les bords, la tête de lecture et l’origine', () => {
    expect(collectSnapPoints(project, { playhead: 5 })).toEqual([0, 4, 5, 6, 8]);
    expect(collectSnapPoints(project, { excludeClipIds: ['b'] })).toEqual([0, 4]);
  });

  it('aimante dans le seuil uniquement', () => {
    const points = [0, 4, 8];
    expect(snapTime(4.2, points, 0.3)).toEqual({ time: 4, snapped: true, point: 4 });
    expect(snapTime(5, points, 0.3)).toEqual({ time: 5, snapped: false });
  });

  it('aimante le bord le plus proche d’un clip déplacé', () => {
    const points = [0, 4, 8];
    expect(snapClipStart(1.9, 2, points, 0.3)).toMatchObject({ time: 2, snapped: true, point: 4 });
    expect(snapClipStart(4.1, 2, points, 0.3)).toMatchObject({ time: 4, snapped: true });
    expect(snapClipStart(10, 2, points, 0.3)).toEqual({ time: 10, snapped: false });
  });
});
