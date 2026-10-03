import { describe, expect, it } from 'vitest';
import {
  centerCropSource,
  containRect,
  coverRect,
  pipCornerPosition,
  pipRect,
  pointInRect,
  recordingElapsed,
  textAnchorY,
  wrapText,
  type PipSettings,
} from '../src/features/capture/layout';

describe('géométrie du compositeur', () => {
  it('contain : écran 16:9 dans un canevas 9:16', () => {
    const r = containRect(1920, 1080, 1080, 1920);
    expect(r.width).toBe(1080);
    expect(r.height).toBeCloseTo(607.5);
    expect(r.y).toBeCloseTo((1920 - 607.5) / 2);
  });

  it('cover : remplit la destination', () => {
    const r = coverRect(1920, 1080, 1080, 1920);
    expect(r.height).toBe(1920);
    expect(r.width).toBeCloseTo(3413.33, 1);
    expect(r.x).toBeLessThan(0);
  });

  it('recadrage centré de la source', () => {
    expect(centerCropSource(1920, 1080, 1)).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(centerCropSource(1080, 1920, 1)).toEqual({ x: 0, y: 420, width: 1080, height: 1080 });
  });

  const pip: PipSettings = { x: 0.5, y: 0.5, size: 0.3, shape: 'circle' };

  it('incrustation ronde carrée et bornée au canevas', () => {
    const r = pipRect(pip, 1080, 1920, 16 / 9);
    expect(r.width).toBeCloseTo(324);
    expect(r.height).toBeCloseTo(324);
    const edge = pipRect({ ...pip, x: 1, y: 1 }, 1080, 1920, 16 / 9);
    expect(edge.x + edge.width).toBeCloseTo(1080);
    expect(edge.y + edge.height).toBeCloseTo(1920);
  });

  it('incrustation arrondie au ratio de la webcam', () => {
    const r = pipRect({ ...pip, shape: 'rounded' }, 1920, 1080, 16 / 9);
    expect(r.width / r.height).toBeCloseTo(16 / 9);
  });

  it('taille bornée', () => {
    expect(pipRect({ ...pip, size: 5 }, 1000, 1000, 1).width).toBeCloseTo(700);
    expect(pipRect({ ...pip, size: 0 }, 1000, 1000, 1).width).toBeCloseTo(150);
  });

  it('positions dans les coins', () => {
    const pos = pipCornerPosition('bottomRight', pip, 1080, 1920, 1);
    const r = pipRect({ ...pip, ...pos }, 1080, 1920, 1);
    expect(1080 - (r.x + r.width)).toBeCloseTo(1080 * 0.04);
    expect(1920 - (r.y + r.height)).toBeCloseTo(1080 * 0.04);
    const tl = pipCornerPosition('topLeft', pip, 1080, 1920, 1);
    const r2 = pipRect({ ...pip, ...tl }, 1080, 1920, 1);
    expect(r2.x).toBeCloseTo(43.2);
    expect(r2.y).toBeCloseTo(43.2);
  });

  it('test de point', () => {
    expect(pointInRect(5, 5, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(pointInRect(11, 5, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('positions de texte', () => {
    expect(textAnchorY('top')).toBeLessThan(textAnchorY('center'));
    expect(textAnchorY('center')).toBeLessThan(textAnchorY('bottom'));
  });

  it('retour à la ligne', () => {
    const measure = (s: string) => s.length * 10;
    expect(wrapText('un deux trois quatre', 90, measure)).toEqual(['un deux', 'trois', 'quatre']);
    expect(wrapText('a\nb', 1000, measure)).toEqual(['a', 'b']);
  });

  it('durée d’enregistrement hors pauses', () => {
    expect(recordingElapsed([{ start: 0, end: 1000 }, { start: 3000 }], 4500)).toBe(2500);
  });
});
