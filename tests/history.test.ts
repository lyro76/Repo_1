import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createHistory, pushState, redo, undo } from '../src/lib/history';

describe('historique annuler / rétablir', () => {
  it('empile, annule et rétablit', () => {
    let h = createHistory(1);
    h = pushState(h, 2);
    h = pushState(h, 3);
    expect(h.present).toBe(3);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = undo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(false);
  });

  it('vide la pile « rétablir » après un nouvel état', () => {
    let h = createHistory('a');
    h = pushState(h, 'b');
    h = undo(h);
    h = pushState(h, 'c');
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(['a']);
  });

  it('respecte la limite', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i++) h = pushState(h, i, 3);
    expect(h.past).toEqual([7, 8, 9]);
  });

  it('ignore un état identique', () => {
    const h = createHistory(1);
    expect(pushState(h, 1)).toBe(h);
  });
});
