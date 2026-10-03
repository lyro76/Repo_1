import { describe, expect, it } from 'vitest';
import {
  computePeaks,
  fitZoom,
  peakBetween,
  pxToTime,
  scrollForZoom,
  snapThreshold,
  thumbnailIndex,
  timeToPx,
  visibleRange,
  wheelZoomFactor,
} from '../../src/lib/timeline/view';

describe('vue de la timeline', () => {
  it('convertit temps et pixels', () => {
    expect(timeToPx(2, 50)).toBe(100);
    expect(pxToTime(100, 50)).toBe(2);
    expect(pxToTime(100, 0)).toBe(0);
  });

  it('garde l’instant sous le pointeur lors du zoom', () => {
    // à 50 px/s, défilement 100, pointeur à 200 px => t = 6 s
    const scroll = scrollForZoom(50, 100, 200, 100);
    expect((scroll + 200) / 100).toBeCloseTo(6);
    expect(scrollForZoom(100, 10, 0, 0)).toBe(0);
  });

  it('ajuste le zoom à la durée', () => {
    expect(fitZoom(10, 1000, 4, 400)).toBeCloseTo(92);
    expect(fitZoom(0, 1000, 4, 400)).toBe(60);
    expect(fitZoom(10000, 100, 4, 400)).toBe(4);
  });

  it('plage visible et seuil d’aimantation', () => {
    expect(visibleRange(100, 500, 50)).toEqual({ start: 2, end: 12 });
    expect(snapThreshold(10, 100)).toBe(0.1);
  });

  it('facteur de zoom de la molette', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it('index de miniature borné', () => {
    expect(thumbnailIndex(5.5, 1, 10)).toBe(5);
    expect(thumbnailIndex(50, 1, 10)).toBe(9);
    expect(thumbnailIndex(-1, 1, 10)).toBe(0);
    expect(thumbnailIndex(1, 0, 10)).toBe(0);
  });

  it('calcule les pics audio', () => {
    const left = new Float32Array([0, 0.5, -0.25, 0, 0.1, -0.9, 0, 0]);
    const right = new Float32Array([0.6, 0, 0, 0, 0, 0, 0, 0.2]);
    const peaks = computePeaks([left, right], 4, 2); // 2 échantillons par pic
    expect(Array.from(peaks).map((v) => +v.toFixed(2))).toEqual([0.6, 0.25, 0.9, 0.2]);
    expect(computePeaks([], 44100, 50).length).toBe(0);
  });

  it('maximum entre deux temps', () => {
    const peaks = new Float32Array([0.1, 0.8, 0.3, 0.2]);
    expect(peakBetween(peaks, 2, 0, 1)).toBeCloseTo(0.8);
    expect(peakBetween(peaks, 2, 1, 2)).toBeCloseTo(0.3);
    expect(peakBetween(peaks, 2, 10, 11)).toBeCloseTo(0.2);
    expect(peakBetween(new Float32Array(0), 2, 0, 1)).toBe(0);
  });
});
