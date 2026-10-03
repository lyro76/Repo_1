import { create } from 'zustand';

export type Thumbnails = {
  /** Intervalle (s) entre deux miniatures dans le média source. */
  interval: number;
  urls: string[];
  aspect: number;
};

export type AnalysisStore = {
  thumbnails: Record<string, Thumbnails>;
  peaks: Record<string, Float32Array>;
  setThumbnails: (mediaId: string, thumbs: Thumbnails) => void;
  setPeaks: (mediaId: string, peaks: Float32Array) => void;
  clear: () => void;
};

export const useAnalysisStore = create<AnalysisStore>((set, get) => ({
  thumbnails: {},
  peaks: {},
  setThumbnails: (mediaId, thumbs) => set({ thumbnails: { ...get().thumbnails, [mediaId]: thumbs } }),
  setPeaks: (mediaId, peaks) => set({ peaks: { ...get().peaks, [mediaId]: peaks } }),
  clear: () => {
    for (const thumbs of Object.values(get().thumbnails)) {
      for (const url of thumbs.urls) if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    set({ thumbnails: {}, peaks: {} });
  },
}));
