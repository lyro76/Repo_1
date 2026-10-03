import { create } from 'zustand';
import type { Format, MediaAsset, Project } from '@/types';
import { HISTORY_LIMIT } from '@/lib/history';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

type Mutator = (project: Project) => Project;

export type ProjectStore = {
  project: Project | null;
  media: Record<string, MediaAsset>;
  mediaUrls: Record<string, string>;
  past: Project[];
  future: Project[];
  /** Instantané pris au début d'une interaction continue (glisser, rogner). */
  transactionBase: Project | null;
  saveState: SaveState;

  load: (project: Project, media: MediaAsset[], blobs: Record<string, Blob>) => void;
  unload: () => void;

  /** Applique une mutation en l'enregistrant dans l'historique. */
  commit: (mutate: Mutator) => void;
  /** Démarre une interaction continue : l'historique n'est mis à jour qu'à `endTransaction`. */
  beginTransaction: () => void;
  updateTransient: (mutate: Mutator) => void;
  endTransaction: () => void;

  undo: () => boolean;
  redo: () => boolean;

  setMeta: (patch: Partial<Pick<Project, 'name' | 'format' | 'fps'>>) => void;
  setFormat: (format: Format) => void;

  registerMedia: (asset: MediaAsset, blob: Blob) => void;
  forgetMedia: (mediaId: string) => void;
  setSaveState: (state: SaveState) => void;
};

function revokeAll(urls: Record<string, string>) {
  for (const url of Object.values(urls)) URL.revokeObjectURL(url);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  media: {},
  mediaUrls: {},
  past: [],
  future: [],
  transactionBase: null,
  saveState: 'idle',

  load: (project, media, blobs) => {
    revokeAll(get().mediaUrls);
    const mediaMap: Record<string, MediaAsset> = {};
    const urls: Record<string, string> = {};
    for (const asset of media) {
      mediaMap[asset.id] = asset;
      const blob = blobs[asset.id];
      if (blob) urls[asset.id] = URL.createObjectURL(blob);
    }
    set({ project, media: mediaMap, mediaUrls: urls, past: [], future: [], transactionBase: null, saveState: 'saved' });
  },

  unload: () => {
    revokeAll(get().mediaUrls);
    set({ project: null, media: {}, mediaUrls: {}, past: [], future: [], transactionBase: null, saveState: 'idle' });
  },

  commit: (mutate) => {
    const { project, past } = get();
    if (!project) return;
    const next = mutate(project);
    if (next === project) return;
    const newPast = [...past, project];
    if (newPast.length > HISTORY_LIMIT) newPast.splice(0, newPast.length - HISTORY_LIMIT);
    set({ project: next, past: newPast, future: [], saveState: 'dirty' });
  },

  beginTransaction: () => {
    const { project, transactionBase } = get();
    if (!project || transactionBase) return;
    set({ transactionBase: project });
  },

  updateTransient: (mutate) => {
    const { project } = get();
    if (!project) return;
    const next = mutate(project);
    if (next !== project) set({ project: next });
  },

  endTransaction: () => {
    const { project, transactionBase, past } = get();
    if (!project || !transactionBase) return;
    if (project === transactionBase) {
      set({ transactionBase: null });
      return;
    }
    const newPast = [...past, transactionBase];
    if (newPast.length > HISTORY_LIMIT) newPast.splice(0, newPast.length - HISTORY_LIMIT);
    set({ past: newPast, future: [], transactionBase: null, saveState: 'dirty' });
  },

  undo: () => {
    const { project, past, future } = get();
    const previous = past[past.length - 1];
    if (!project || previous === undefined) return false;
    set({ project: previous, past: past.slice(0, -1), future: [project, ...future], saveState: 'dirty' });
    return true;
  },

  redo: () => {
    const { project, past, future } = get();
    const next = future[0];
    if (!project || next === undefined) return false;
    set({ project: next, past: [...past, project], future: future.slice(1), saveState: 'dirty' });
    return true;
  },

  setMeta: (patch) => {
    get().commit((p) => ({ ...p, ...patch, updatedAt: Date.now() }));
  },

  setFormat: (format) => {
    get().setMeta({ format });
  },

  registerMedia: (asset, blob) => {
    const { media, mediaUrls } = get();
    const old = mediaUrls[asset.id];
    if (old) URL.revokeObjectURL(old);
    set({
      media: { ...media, [asset.id]: asset },
      mediaUrls: { ...mediaUrls, [asset.id]: URL.createObjectURL(blob) },
    });
  },

  forgetMedia: (mediaId) => {
    const { media, mediaUrls } = get();
    const url = mediaUrls[mediaId];
    if (url) URL.revokeObjectURL(url);
    const nextMedia = { ...media };
    delete nextMedia[mediaId];
    const nextUrls = { ...mediaUrls };
    delete nextUrls[mediaId];
    set({ media: nextMedia, mediaUrls: nextUrls });
  },

  setSaveState: (saveState) => set({ saveState }),
}));

/** Sélecteurs pratiques. */
export const selectCanUndo = (s: ProjectStore) => s.past.length > 0;
export const selectCanRedo = (s: ProjectStore) => s.future.length > 0;
