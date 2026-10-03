export type History<T> = {
  present: T;
  past: T[];
  future: T[];
};

export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { present, past: [], future: [] };
}

/** Enregistre un nouvel état (vide la pile « rétablir »). */
export function pushState<T>(history: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(next, history.present)) return history;
  const past = [...history.past, history.present];
  if (past.length > limit) past.splice(0, past.length - limit);
  return { present: next, past, future: [] };
}

/** Remplace l'état courant sans créer d'entrée d'historique. */
export function replacePresent<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    present: next,
    past: [...history.past, history.present],
    future: history.future.slice(1),
  };
}
