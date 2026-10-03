import { useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useUIStore } from '@/store/uiStore';
import { nudgePlayhead, seekToEnd, seekToStart, togglePlayback } from './playbackActions';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button', 'color'].includes(type);
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** Actions déclenchées par des raccourcis, enregistrées par les autres modules. */
export const shortcutHandlers: Partial<Record<'split' | 'delete' | 'duplicate', () => void>> = {};

/** Raccourcis clavier globaux de l'éditeur. */
export function useEditorShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const ui = useUIStore.getState();
      if (ui.exportOpen) return;
      const store = useProjectStore.getState();
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (ctrl && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (ctrl && key === 'y') {
        event.preventDefault();
        store.redo();
        return;
      }
      if (ctrl && key === 'd') {
        event.preventDefault();
        shortcutHandlers.duplicate?.();
        return;
      }
      if (ctrl || event.altKey || ui.shortcutsOpen) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur?.();
          togglePlayback();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          nudgePlayhead(event.shiftKey ? -1 : -1 / (store.project?.fps ?? 30));
          break;
        case 'ArrowRight':
          event.preventDefault();
          nudgePlayhead(event.shiftKey ? 1 : 1 / (store.project?.fps ?? 30));
          break;
        case 'Home':
          event.preventDefault();
          seekToStart();
          break;
        case 'End':
          event.preventDefault();
          seekToEnd();
          break;
        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          shortcutHandlers.delete?.();
          break;
        case '?':
          event.preventDefault();
          ui.setShortcutsOpen(true);
          break;
        default:
          if (key === 's') {
            event.preventDefault();
            shortcutHandlers.split?.();
          }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
