import { create } from 'zustand';

export type Screen = 'home' | 'editor';
export type CenterTab = 'preview' | 'studio';
export type LeftTab = 'studio' | 'media';
export type RightTab = 'properties' | 'project';
export type ToastKind = 'info' | 'success' | 'error';

export type Toast = { id: number; message: string; kind: ToastKind };

export type UIStore = {
  screen: Screen;
  centerTab: CenterTab;
  leftTab: LeftTab;
  rightTab: RightTab;
  exportOpen: boolean;
  shortcutsOpen: boolean;
  toasts: Toast[];

  setScreen: (screen: Screen) => void;
  setCenterTab: (tab: CenterTab) => void;
  setLeftTab: (tab: LeftTab) => void;
  setRightTab: (tab: RightTab) => void;
  setExportOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  notify: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
};

let toastSeq = 0;

export const useUIStore = create<UIStore>((set, get) => ({
  screen: 'home',
  centerTab: 'studio',
  leftTab: 'studio',
  rightTab: 'properties',
  exportOpen: false,
  shortcutsOpen: false,
  toasts: [],

  setScreen: (screen) => set({ screen }),
  setCenterTab: (centerTab) => set({ centerTab, leftTab: centerTab === 'studio' ? 'studio' : get().leftTab }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  notify: (message, kind = 'info') => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, message, kind }] });
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));
