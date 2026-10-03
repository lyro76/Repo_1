import { describe, expect, it } from 'vitest';
import { clamp, formatTime, formatTimecode, formatDurationLabel, roundTime, rulerStep, formatBytes } from '../src/lib/time';

describe('time utils', () => {
  it('formate les temps', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3661)).toBe('1:01:01');
    expect(formatTimecode(1.5)).toBe('00:01.50');
    expect(formatDurationLabel(12)).toBe('12 s');
    expect(formatDurationLabel(65)).toBe('1 min 05 s');
  });

  it('clamp et arrondi', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(roundTime(1.23456)).toBe(1.235);
  });

  it('choisit un pas de règle lisible', () => {
    expect(rulerStep(100)).toBe(1);
    expect(rulerStep(10)).toBe(10);
    expect(rulerStep(1000)).toBe(0.1);
  });

  it('formate des tailles', () => {
    expect(formatBytes(500)).toBe('500 o');
    expect(formatBytes(2048)).toBe('2.0 Ko');
  });
});
