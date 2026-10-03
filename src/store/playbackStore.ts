import { create } from 'zustand';

export const MIN_ZOOM = 4; // px par seconde
export const MAX_ZOOM = 400;
export const DEFAULT_ZOOM = 60;

export type PlaybackStore = {
  currentTime: number;
  playing: boolean;
  /** Pixels par seconde sur la timeline. */
  zoom: number;
  scrollLeft: number;
  selectedClipId: string | null;
  snapEnabled: boolean;

  setCurrentTime: (time: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setZoom: (zoom: number) => void;
  setScrollLeft: (scrollLeft: number) => void;
  select: (clipId: string | null) => void;
  toggleSnap: () => void;
  reset: () => void;
};

export const usePlaybackStore = create<PlaybackStore>((set, get) => ({
  currentTime: 0,
  playing: false,
  zoom: DEFAULT_ZOOM,
  scrollLeft: 0,
  selectedClipId: null,
  snapEnabled: true,

  setCurrentTime: (time) => set({ currentTime: Math.max(0, time) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  togglePlay: () => set({ playing: !get().playing }),
  setZoom: (zoom) => set({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }),
  setScrollLeft: (scrollLeft) => set({ scrollLeft: Math.max(0, scrollLeft) }),
  select: (selectedClipId) => set({ selectedClipId }),
  toggleSnap: () => set({ snapEnabled: !get().snapEnabled }),
  reset: () => set({ currentTime: 0, playing: false, selectedClipId: null, scrollLeft: 0 }),
}));
