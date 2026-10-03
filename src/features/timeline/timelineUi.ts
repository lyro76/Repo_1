import { create } from 'zustand';
import { fitZoom, scrollForZoom } from '@/lib/timeline/view';
import { projectDuration } from '@/lib/timeline/clips';
import { MAX_ZOOM, MIN_ZOOM, usePlaybackStore } from '@/store/playbackStore';
import { useProjectStore } from '@/store/projectStore';

export const HEADER_WIDTH = 168;
export const RULER_HEIGHT = 28;
export const LANE_HEIGHT = { video: 64, audio: 52, text: 36 } as const;

type TimelineUi = {
  viewportWidth: number;
  snapLine: number | null;
  setViewportWidth: (width: number) => void;
  setSnapLine: (time: number | null) => void;
};

export const useTimelineUi = create<TimelineUi>((set) => ({
  viewportWidth: 800,
  snapLine: null,
  setViewportWidth: (viewportWidth) => set({ viewportWidth }),
  setSnapLine: (snapLine) => set({ snapLine }),
}));

/** Zoome en gardant l'instant situé à `anchorPx` (dans la zone visible) immobile. */
export function zoomTo(newZoom: number, anchorPx?: number) {
  const playback = usePlaybackStore.getState();
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
  const viewport = useTimelineUi.getState().viewportWidth;
  const playheadPx = playback.currentTime * playback.zoom - playback.scrollLeft;
  const anchor = anchorPx ?? (playheadPx >= 0 && playheadPx <= viewport ? playheadPx : 0);
  const scrollLeft = scrollForZoom(playback.zoom, clamped, anchor, playback.scrollLeft);
  playback.setZoom(clamped);
  playback.setScrollLeft(scrollLeft);
}

export function zoomToFit() {
  const project = useProjectStore.getState().project;
  if (!project) return;
  const viewport = useTimelineUi.getState().viewportWidth;
  usePlaybackStore.getState().setZoom(fitZoom(projectDuration(project), viewport, MIN_ZOOM, MAX_ZOOM));
  usePlaybackStore.getState().setScrollLeft(0);
}
